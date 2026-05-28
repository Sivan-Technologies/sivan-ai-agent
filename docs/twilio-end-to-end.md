# Twilio end-to-end test (WhatsApp)

This document shows two approaches to validate end-to-end WhatsApp notifications.

Option A (fast, local simulate)

- Ensure the backend and bot are running locally as documented in `docs/notify-testing.md`.
- Use `src/scripts/send-notify.ts` to POST to the bot's `/api/notify` endpoint (respects `NOTIFICATION_SECRET`).
- Use `src/scripts/simulate-paystack-webhook.ts` to simulate a Paystack webhook (respects `PAYSTACK_WEBHOOK_SECRET`).

Example commands:

```powershell
# start bot
cd whatsapp-bot
npm run dev

# start backend
cd ..
npm run dev

# send a notify
node -r ts-node/register src/scripts/send-notify.ts "whatsapp:+123456789" "Test message"

# simulate paystack webhook
node -r ts-node/register src/scripts/simulate-paystack-webhook.ts "your-payment-reference"
```

Option B (real Twilio sandbox)

- Create a Twilio account and enable the WhatsApp sandbox. Get `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_NUMBER`.
- Run your bot locally and expose it using `ngrok`. Copy the https URL and set Twilio message webhook to `https://<ngrok-id>.ngrok.io/webhooks/twilio`.
- Update `whatsapp-bot/.env` with Twilio creds, `PUBLIC_BASE_URL` set to the exact public bot base URL, and `CORE_API_BASE_URL` pointing to your backend.
- Set the same `CORE_API_SECRET` in both `sivan-escrow-agent/.env` and `whatsapp-bot/.env`.
- From your phone, follow Twilio sandbox instructions to join and then send a WhatsApp message to create a task.
- To simulate payment, use `simulate-paystack-webhook.ts` with the payment reference returned by your task response.

Notes

- For production testing ensure both `NOTIFICATION_SECRET` (backend) and `NOTIFY_SECRET` (bot) match and are stored securely.
- Twilio request signature validation depends on `PUBLIC_BASE_URL` matching the URL configured in Twilio, including the correct `https` scheme and host.
- Use ngrok only for staging/testing and never expose production secrets through it.
