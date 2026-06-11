# Testing notification callbacks (local)

1. Set environment secrets in each service. Create `.env` from `.env.example` in both the root and `whatsapp-bot/` folders. Make sure `NOTIFICATION_SECRET` (backend) and `NOTIFY_SECRET` (bot) match. Also set the same `CORE_API_SECRET` in both services so the bot can create backend tasks.

2. Start the WhatsApp bot locally (in `whatsapp-bot/`):

```powershell
cd whatsapp-bot
npm install
cp .env.example .env
# edit .env to set TWILIO vars, PUBLIC_BASE_URL, CORE_API_SECRET, and NOTIFY_SECRET
npm run dev
```

3. Start the backend locally (root):

```powershell
npm install
cp .env.example .env
# edit .env to set NOTIFICATION_URL=http://localhost:3000, NOTIFICATION_SECRET, and CORE_API_SECRET
npm run dev
```

4. Send a test notify from the backend using the helper script:

```powershell
# from repo root
npm install node-fetch
node -r ts-node/register src/scripts/send-notify.ts "whatsapp:+123456789" "Hello from backend test"
```

5. Observing results: the bot console should log the incoming notify and Twilio message send attempts. If using Twilio test credentials, no real message will be delivered.

   For live Twilio sandbox testing, the destination phone must have joined the Twilio WhatsApp sandbox. If the backend creates the escrow and the seller sees it later in `MY DEALS` but receives no incoming invite, check:

   - `NOTIFICATION_SECRET` on the backend exactly matches `NOTIFY_SECRET` on the WhatsApp bot.
   - `NOTIFICATION_URL` points to the live WhatsApp bot base URL.
   - `GET /admin/ops/events` has no `Failed to send seller escrow invite` errors.
   - `GET /admin/queue/jobs` has no failed or dead `whatsapp_notification` retry jobs.
   - the seller phone has joined the Twilio sandbox, or the production WhatsApp sender is approved for outbound messages.

6. To test end-to-end via WhatsApp, use the real Twilio sandbox/webhook flow. The bot now validates `x-twilio-signature`, so a plain manual POST to `/webhooks/twilio` will be rejected unless you generate a valid Twilio signature for the exact URL and form body.

7. For local webhook testing, expose the bot with ngrok, set `PUBLIC_BASE_URL` to the ngrok HTTPS base URL, and configure Twilio's incoming message webhook to `https://<ngrok-id>.ngrok.io/webhooks/twilio`.
