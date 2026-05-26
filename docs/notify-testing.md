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

6. To test end-to-end via WhatsApp, use the real Twilio sandbox/webhook flow. The bot now validates `x-twilio-signature`, so a plain manual POST to `/webhooks/twilio` will be rejected unless you generate a valid Twilio signature for the exact URL and form body.

7. For local webhook testing, expose the bot with ngrok, set `PUBLIC_BASE_URL` to the ngrok HTTPS base URL, and configure Twilio's incoming message webhook to `https://<ngrok-id>.ngrok.io/webhooks/twilio`.
