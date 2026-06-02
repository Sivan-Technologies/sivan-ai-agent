# CI And Render Secrets

Use this checklist after rotating secrets. Do not paste real secret values into docs, commits, issues, or chat.

## GitHub Actions Secrets

The production smoke workflow reads:

| Name | Purpose |
| --- | --- |
| `SIVAN_SMOKE_BASE_URL` | Backend Render URL, for example `https://sivan-escrow-agent.onrender.com`; the workflow also has a Render URL fallback so CI does not accidentally smoke-test `localhost` |
| `SIVAN_SMOKE_ADMIN_API_KEY` | Rotated admin key used only by smoke checks |

Optional repository variable:

| Name | Purpose |
| --- | --- |
| `SIVAN_SMOKE_REQUIRE_SETTLEMENT_PROOF` | Set `true` only when live settlement proof should be mandatory |

The GitHub CLI on this machine currently needs re-authentication before secrets can be set:

```bash
gh auth login -h github.com
gh secret set SIVAN_SMOKE_BASE_URL --body "https://sivan-escrow-agent.onrender.com"
gh secret set SIVAN_SMOKE_ADMIN_API_KEY --body "<rotated-admin-key>"
gh variable set SIVAN_SMOKE_REQUIRE_SETTLEMENT_PROOF --body "false"
gh workflow run production-smoke.yml
```

If GitHub Actions logs show `http://localhost:4000`, the workflow is not receiving a production base URL. The workflow now falls back to the Render backend URL, but the preferred production setup is still to set `SIVAN_SMOKE_BASE_URL` explicitly so staging and production can be separated later.

## Render Backend Service

Set or rotate these on the backend service:

```env
ADMIN_API_KEY=<rotated-admin-key>
ADMIN_JWT_SECRET=<rotated-jwt-secret>
CORE_API_SECRET=<rotated-core-secret>
PAYOUT_ENCRYPTION_KEY=<stable-32-byte-random-secret>
PAYOUT_TOKEN_SECRET=<stable-hmac-secret>
SENTRY_DSN=<sentry-dsn>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILE_SESSION_SAMPLE_RATE=0
SENTRY_ENABLE_LOGS=true
SENTRY_SEND_DEFAULT_PII=false
SENTRY_DEBUG_ENDPOINT_ENABLED=false
OPERATIONS_ALERT_PROVIDER=telegram
TELEGRAM_ALERT_BOT_TOKEN=<telegram-alert-bot-token>
TELEGRAM_ALERT_CHAT_ID=<telegram-alert-chat-id>
OPERATIONS_ALERT_WEBHOOK_URL=
OPERATIONS_ALERT_WEBHOOK_SECRET=<rotated-alert-shared-secret>
```

Also rotate provider secrets if they have been exposed: Paystack, Synapse/SAP, database password, and operations alert secrets.

## Render WhatsApp Bot Service

Set or rotate these on the bot service:

```env
CORE_API_SECRET=<same-rotated-core-secret-as-backend>
NOTIFY_SECRET=<rotated-notify-secret>
WHATSAPP_PROVIDER=twilio
TWILIO_AUTH_TOKEN=<rotated-twilio-auth-token>
META_ACCESS_TOKEN=<meta-system-user-token>
META_PHONE_NUMBER_ID=<meta-phone-number-id>
META_WHATSAPP_BUSINESS_ACCOUNT_ID=<meta-waba-id>
META_WEBHOOK_VERIFY_TOKEN=<random-meta-webhook-verify-token>
META_APP_SECRET=<meta-app-secret>
META_GRAPH_API_VERSION=v23.0
SENTRY_DSN=<sentry-dsn>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILE_SESSION_SAMPLE_RATE=0
SENTRY_ENABLE_LOGS=true
SENTRY_SEND_DEFAULT_PII=false
SENTRY_DEBUG_ENDPOINT_ENABLED=false
```

Keep Twilio credentials present until Meta has passed live inbound/outbound tests. The admin Ops panel can switch the active outbound provider through the backend proxy, but Render `WHATSAPP_PROVIDER` should be updated for the permanent deploy default.

## Verification

After updating Render and GitHub:

```bash
cd sivan-escrow-agent
npm run smoke

cd ../whatsapp-bot
npm run smoke
```

Then run the GitHub Actions workflow manually and confirm the scheduled run stays green.
