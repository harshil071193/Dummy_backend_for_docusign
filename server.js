require('dotenv').config();

const express = require('express');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

async function getDocuSignAccessToken() {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userGuid = process.env.DOCUSIGN_USER_GUID;
  const authBase = process.env.DOCUSIGN_AUTH_BASE || 'https://account-d.docusign.com';
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!integrationKey || !userGuid || !privateKey) {
    const error = new Error(
      'DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_GUID, DOCUSIGN_PRIVATE_KEY must be set in .env'
    );
    error.code = 'DOCUSIGN_CONFIG_MISSING';
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: integrationKey,
    sub: userGuid,
    aud: authBase.replace(/^https?:\/\//, ''), // e.g. account-d.docusign.com
    scope: 'signature impersonation',
    iat: now,
    exp: now + 3600, // 1 hour
  };

  const signedJwt = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

  const tokenUrl = `${authBase}/oauth/token`;

  const body = new URLSearchParams();
  body.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  body.append('assertion', signedJwt);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await response.json();

  if (!response.ok) {
    console.error('DocuSign JWT grant error:', json);
    const error = new Error('DOCUSIGN_JWT_GRANT_FAILED');
    error.status = response.status;
    error.details = json;
    throw error;
  }

  return {
    accessToken: json.access_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
  };
}

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'docusign-demo-backend' });
});

/**
 * POST /docusign/create-envelope
 *
 * Creates an envelope from a DocuSign template and returns the envelopeId.
 * This is for demo/local testing only.
 */
app.post('/docusign/create-envelope', async (req, res) => {
  try {
    const { email, name, templateId, fieldData, requireIdVerification } = req.body || {};
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const baseUrl = 'https://demo.docusign.net/restapi/v2.1';

    if (!accountId) {
      return res.status(500).json({
        error: 'DOCUSIGN_ACCOUNT_ID_MISSING',
        message: 'DOCUSIGN_ACCOUNT_ID must be set in .env',
      });
    }

    if (!email || !name) {
      return res.status(400).json({
        error: 'INVALID_PARAMS',
        message: 'email and name are required',
      });
    }

    const { accessToken } = await getDocuSignAccessToken();

    // Build template roles - preserve all template tabs (including attachments)
    const templateRole = {
      email,
      name,
      roleName: 'Inspector', // must match the role name in your DocuSign template
      clientUserId: 'mobile-operator-1',
    };

    // Add ID Verification if requested AND workflow ID is configured
    // NOTE: This requires a premium DocuSign account with ID Verification workflow configured
    // Go to Admin > Signing and Sending > Identity Verification to set up workflows
    // The workflowId should match the ID of your configured workflow
    // If DOCUSIGN_IDV_WORKFLOW_ID is not set or empty, ID Verification will be skipped
    const workflowId = process.env.DOCUSIGN_IDV_WORKFLOW_ID;
    if (requireIdVerification && workflowId && workflowId.trim() !== '') {
      templateRole.recipientAuthentication = {
        idvWorkflow: {
          workflowId: workflowId.trim(),
        },
      };
    }

    // Only override tabs if fieldData is provided and not empty
    // Otherwise, DocuSign will preserve all template tabs (checkboxes, attachments, etc.)
    if (fieldData && Object.keys(fieldData).length > 0) {
      templateRole.tabs = fieldData;
    }
    // If no fieldData, don't include tabs at all - this preserves template's original tabs

    const body = {
      templateId: templateId || '1fb76cf5-0a18-41a0-9bcf-3ca7cb83b57f',
      templateRoles: [templateRole],
      status: 'sent',
    };

    const envelopeResp = await fetch(
      `${baseUrl}/accounts/${accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const json = await envelopeResp.json();

    if (!envelopeResp.ok) {
      console.error('DocuSign create envelope error:', json);
      return res.status(envelopeResp.status).json({
        error: 'CREATE_ENVELOPE_FAILED',
        details: json,
      });
    }

    return res.json({ envelopeId: json.envelopeId });
  } catch (err) {
    console.error('Unexpected error in /docusign/create-envelope:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /docusign/access-token
 *
 * Returns a DocuSign access token using JWT grant.
 * This is ONLY for demo / local testing. Do not deploy as-is to production.
 */
app.get('/docusign/access-token', async (req, res) => {
  try {
    const token = await getDocuSignAccessToken();
    return res.json(token);
  } catch (err) {
    console.error('Unexpected error in /docusign/access-token:', err);
    if (err.code === 'DOCUSIGN_CONFIG_MISSING') {
      return res.status(500).json({
        error: 'DOCUSIGN_CONFIG_MISSING',
        message: err.message,
      });
    }
    if (err.message === 'DOCUSIGN_JWT_GRANT_FAILED') {
      return res.status(err.status || 500).json({
        error: 'DOCUSIGN_JWT_GRANT_FAILED',
        details: err.details,
      });
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /docusign/recipient-view-url
 *
 * Returns an embedded signing (recipient view) URL for an existing envelope.
 */
app.post('/docusign/recipient-view-url', async (req, res) => {
  try {
    const { envelopeId, email, name } = req.body || {};
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const baseUrl = 'https://demo.docusign.net/restapi/v2.1';

    if (!accountId) {
      return res.status(500).json({
        error: 'DOCUSIGN_ACCOUNT_ID_MISSING',
        message: 'DOCUSIGN_ACCOUNT_ID must be set in .env',
      });
    }

    if (!envelopeId || !email || !name) {
      return res.status(400).json({
        error: 'INVALID_PARAMS',
        message: 'envelopeId, email and name are required',
      });
    }

    const { accessToken } = await getDocuSignAccessToken();

    const body = {
      returnUrl: 'https://example.com/docusign/return',
      authenticationMethod: 'none',
      email,
      userName: name,
      clientUserId: 'mobile-operator-1',
    };

    const viewResp = await fetch(
      `${baseUrl}/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const json = await viewResp.json();

    if (!viewResp.ok) {
      console.error('DocuSign recipient view error:', json);
      return res.status(viewResp.status).json({
        error: 'RECIPIENT_VIEW_FAILED',
        details: json,
      });
    }

    return res.json({ url: json.url });
  } catch (err) {
    console.error('Unexpected error in /docusign/recipient-view-url:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * POST /docusign/id-verification-url
 *
 * Returns an ID verification (selfie) URL for an existing envelope.
 * This uses DocuSign's ID Verification workflow.
 */
app.post('/docusign/id-verification-url', async (req, res) => {
  try {
    const { envelopeId, email, name } = req.body || {};
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const baseUrl = 'https://demo.docusign.net/restapi/v2.1';

    if (!accountId) {
      return res.status(500).json({
        error: 'DOCUSIGN_ACCOUNT_ID_MISSING',
        message: 'DOCUSIGN_ACCOUNT_ID must be set in .env',
      });
    }

    if (!envelopeId || !email || !name) {
      return res.status(400).json({
        error: 'INVALID_PARAMS',
        message: 'envelopeId, email and name are required',
      });
    }

    const { accessToken } = await getDocuSignAccessToken();

    // For ID Verification, we use the recipient view endpoint
    // DocuSign will show ID verification steps if configured on the envelope/template
    const body = {
      returnUrl: 'https://example.com/docusign/return',
      authenticationMethod: 'none',
      email,
      userName: name,
      clientUserId: 'mobile-operator-1',
    };

    const viewResp = await fetch(
      `${baseUrl}/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const json = await viewResp.json();

    if (!viewResp.ok) {
      console.error('DocuSign ID verification view error:', json);
      return res.status(viewResp.status).json({
        error: 'ID_VERIFICATION_VIEW_FAILED',
        details: json,
      });
    }

    return res.json({ url: json.url });
  } catch (err) {
    console.error('Unexpected error in /docusign/id-verification-url:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`DocuSign demo backend listening on http://localhost:${port}`);
});
