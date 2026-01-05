## DocuSign Demo Backend (JWT Grant)

This is a **small Node.js server** for demo/testing only. It performs **DocuSign JWT Grant** and exposes `/docusign/access-token` for the mobile app.

> For production, your real backend should implement the same logic, not this demo server.

---

### 1. Setup

1. Go to the demo backend folder:

```bash
cd docusign-demo-backend
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` from example:

```bash
cp .env.example .env
```

4. Edit `.env` and fill:

**Required:**
- `DOCUSIGN_INTEGRATION_KEY` – your Integration Key (Client ID)
- `DOCUSIGN_USER_GUID` – GUID of the DocuSign user to impersonate
- `DOCUSIGN_AUTH_BASE` – `https://account-d.docusign.com` for sandbox
- `DOCUSIGN_PRIVATE_KEY` – your RSA private key (PEM) from DocuSign app
- `DOCUSIGN_ACCOUNT_ID` – your DocuSign Account ID (numeric)

**Optional (for ID Verification - requires premium account):**
- `DOCUSIGN_IDV_WORKFLOW_ID` – ID Verification workflow ID (leave empty if not using ID Verification)

> **Do not commit `.env`** – it contains secrets.

---

### 2. Run the server

```bash
npm start
```

By default it listens on `http://localhost:4000`.

- Health check: `GET http://localhost:4000/health`
- Get DocuSign token: `GET http://localhost:4000/docusign/access-token`

If everything is configured correctly, `/docusign/access-token` returns:

```json
{
  "accessToken": "<DOCUSIGN_ACCESS_TOKEN>",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

---

### 3. How mobile will use this (for demo)

In the mobile app (e.g. in `DocuSignESignatureScreen`), you can temporarily call this demo backend:

```ts
const response = await fetch('http://10.101.103.206:4000/docusign/access-token'); // Android emulator
const json = await response.json();
const backendToken = json.accessToken;

await DocuSignAuthService.authenticateWithAccessToken(backendToken);
```

> On a real device, replace `10.0.2.2` with your machine’s LAN IP (e.g. `http://192.168.x.x:4000`).

After that, the DocuSign native module has a valid `accessToken` and the rest of the flow (create envelope from template, signing URL, etc.) will work for the demo.

---

### 4. Important

- This server is **only for local/demo usage**.
- Real production backend should follow `docs/DOCUSIGN_JWT_BACKEND_INTEGRATION.md` and `docs/DOCUSIGN_BACKEND_REQUIREMENTS_OVERVIEW.md`.
# Dummy_backend_for_docusign
