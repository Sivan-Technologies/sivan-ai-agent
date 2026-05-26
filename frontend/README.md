# Sivan Escrow Agent Admin UI

This folder contains the admin monitoring UI for the Sivan Escrow Agent backend.

## Purpose
- Internal dashboard for monitoring task records and webhook events.
- Not intended for public buyer-facing distribution.
- Keep this admin UI deployed only for operations and debugging.

## Local development

```bash
cd frontend
npm install
npm run dev
```

## Build

```bash
cd frontend
npm run build
```

## Environment

- `VITE_API_BASE_URL` should point to the backend API base URL.
- Do not bake `ADMIN_API_KEY` into the frontend build. The dashboard asks for the admin key at runtime and stores it in browser session storage.

## Deployment

The frontend is only an admin UI. Deploy it only if you want a dashboard.
For WhatsApp distribution, the primary channel should be your backend receiving WhatsApp messages.
This frontend is optional; the user-facing experience should be driven by a separate WhatsApp bot repo.
Deploy behind access control where possible, even though backend admin APIs still require `x-admin-key`.
