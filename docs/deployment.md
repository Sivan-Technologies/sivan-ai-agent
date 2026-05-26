# Deployment Guide

## Folder structure for deployment

- `./` - Root backend folder for Render.
  - Deploy this root repository to Render as the backend service.
  - The backend exposes:
    - `POST /api/tasks` to create new tasks. This requires the `x-core-api-key` header with `CORE_API_SECRET`.
    - `GET /api/health` for health checks.
    - `POST /webhooks/paystack` for Paystack webhook events.
    - `GET /admin/tasks`, `GET /admin/tasks/:taskId`, `GET /admin/webhooks` for admin debugging. These require the `x-admin-key` header with `ADMIN_API_KEY`.

- `./frontend/` - optional admin dashboard folder.
  - Contains a React admin UI for operations and monitoring.
  - Set `VITE_API_BASE_URL` to the backend service URL if you deploy it.

- `../whatsapp-bot/` - standalone WhatsApp integration repo.
  - Use a separate repository for Meta/WhatsApp bot logic.
  - The bot should call the Render backend API and not include core escrow implementation.
  - This separation preserves the security and maintainability of your core service.

## Render backend configuration

1. In Render, create a new **Web Service**.
2. Set the root directory to the repository root (default).
3. Use the build command:

```bash
npm install
npm run build
```

4. Use the start command:

```bash
npm start
```

5. Set required environment variables in Render:

- `SAP_RPC_URL`
- `SYNAPSE_API_KEY`
- `ACE_DATA_BASE_URL`
- `ACE_DATA_API_KEY`
- `X402_RPC_URL`
- `X402_CLIENT_ID`
- `X402_CLIENT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_BASE_URL`
- `PAYSTACK_WEBHOOK_SECRET`
- `DATABASE_URL`
- `SENTRY_DSN` (recommended for production alerting)
- `ADMIN_API_KEY`
- `CORE_API_SECRET`
- `WEBHOOK_URL`
- `NODE_ENV=production`
- `FRONTEND_URL=https://<your-admin-ui-url>.example.com`
- `NOTIFICATION_URL` (Twilio bot notify endpoint, e.g. `https://your-whatsapp-bot.example.com`)
- `NOTIFICATION_SECRET` (shared secret for `/api/notify` requests)

6. Ensure `DATABASE_URL` points to a persistent SQLite file path on a mounted disk for the current implementation. If you want Postgres, migrate the `WorkflowStore` and `SettingsStore` first; the current code uses `better-sqlite3`.

## Admin UI configuration

1. The `frontend/` folder contains an optional admin monitoring UI.
2. Install dependencies and build locally with:

```bash
cd frontend
npm install
npm run build
```

3. Use `VITE_API_BASE_URL` to point to the backend API base URL.

4. Deploy this folder only if you want an internal admin dashboard.

> Buyer-facing flow should be WhatsApp first, not this admin UI.

## WhatsApp integration notes

- Build the WhatsApp bot in `C:\Users\barha\Documents\Programming\Sam\whatsapp-bot` or a separate repo.
- The WhatsApp bot should authenticate inbound Twilio WhatsApp webhooks by validating `x-twilio-signature`.
- It should forward parsed user requests to `/api/tasks` with `x-core-api-key: CORE_API_SECRET` and notify users about payment links and task status.
- Set `PUBLIC_BASE_URL` in the bot to the exact public bot URL configured in Twilio, otherwise Twilio signature validation will fail.
- Keep the bot code separate so your core escrow engine remains isolated.

- Use a mounted persistent disk for SQLite, or migrate the store layer before using a managed Postgres database.
- Configure Render health checks against `/api/health`.
- Use HTTPS-backed `FRONTEND_URL` for CORS restrictions in the backend.
- Configure Sentry alerts for Paystack verification failures, unmatched webhooks, webhook processing failures, and task execution failures.
- Add a CI pipeline that builds both `frontend/` and the root backend.
