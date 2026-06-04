# Environment Variables

This file documents the environment variables required to run the Sivan Escrow Agent. Do not commit real secrets to source control.

## Required Environment Variables

### Synapse SDK / SAP / x402

- `SYNAPSE_API_KEY` - Canonical Synapse API key. Use this for Synapse RPC, SAP requests, and x402 facilitator auth unless a specific provider gives you separate x402 credentials.
- `SYNAPSE_RPC_URL` - Synapse Solana RPC endpoint used by the official Synapse Client SDK.
- `SYNAPSE_WS_URL` - Optional Synapse WebSocket endpoint.
- `SYNAPSE_GRPC_URL` - Optional Synapse gRPC/Geyser endpoint.
- `SYNAPSE_X402_FACILITATOR_URL` - x402 facilitator URL, for example `https://facilitator.payai.network`.
- `SYNAPSE_X402_NETWORK` - x402 network such as `solana-devnet` or `solana-mainnet`.
- `SYNAPSE_USDC_MINT` - Optional explicit USDC mint address for the selected Solana network.
- `SAP_RPC_URL` - Legacy alias for `SYNAPSE_RPC_URL`; leave blank unless you must override SAP separately.
- `SAP_AGENT_PRIVATE_KEY` - Agent private signing key or wallet secret for SAP operations. This is not replaced by the Synapse API key.
- `SAP_AGENT_PUBLIC_KEY` - Agent public key or wallet address.

### Ace Data Cloud

- `ACE_DATA_API_KEY` - Ace Data Cloud API key.
- `ACE_DATA_BASE_URL` - Ace Data Cloud API base URL.

### Legacy x402 aliases

- `X402_RPC_URL` - Legacy alias for `SYNAPSE_X402_FACILITATOR_URL`.
- `X402_CLIENT_ID` - Optional x402 client identifier if your facilitator requires it.
- `X402_CLIENT_SECRET` - Optional x402 secret. If blank or placeholder, the app uses `SYNAPSE_API_KEY`.
- `SETTLEMENT_VERIFY_TASK_TYPE` - SAP discovery task type used by `npm run verify:settlement`.
- `SETTLEMENT_PROOF_OUTPUT` - Optional JSON file path where settlement verification proof is written.
- `SAP_VERIFY_REGISTER_AGENT` - Set `true` only when you want verification to attempt agent registration.
- `X402_VERIFY_PAYMENT_ID` - Existing x402 payment ID to verify through status polling.
- `X402_VERIFY_CREATE_PAYMENT` - Set `true` only when you want verification to create a tiny x402 probe payment facility.
- `X402_VERIFY_AMOUNT` - Probe amount used when `X402_VERIFY_CREATE_PAYMENT=true`.
- `X402_VERIFY_RECIPIENT` - Recipient used when `X402_VERIFY_CREATE_PAYMENT=true`; defaults to `SAP_AGENT_PUBLIC_KEY`.

### Paystack / Naira Bridge

- `PAYSTACK_SECRET_KEY` - Paystack secret key for API calls.
- `PAYSTACK_PUBLIC_KEY` - Paystack public key for frontend or checkout metadata if needed.
- `PAYSTACK_BASE_URL` - Paystack API base URL.
- `PAYSTACK_WEBHOOK_SECRET` - Secret for validating Paystack webhook signatures.
- `PAYSTACK_RECEIVER_ACCOUNT` - Optional receiver account identifier for Paystack.
- `PAYSTACK_CHANNELS` - Comma-separated Paystack checkout channels. Use `bank_transfer` for transfer-only escrow collection.
- `PAYSTACK_CALLBACK_URL` - Browser redirect URL after Paystack checkout. This is not the webhook URL.
- `PAYSTACK_TIMEOUT_MS` - Timeout for Paystack API calls, including account resolution. Defaults to `8000`; keep it below the WhatsApp webhook timeout so seller setup returns a retry message instead of hanging.
- `PAYOUT_VERIFICATION_TEST_MODE` - Controlled E2E test override. Set `true` only while using a Paystack `sk_test_...` key. It allows exact-account payout verification, creates a clearly marked sandbox payment reference when Paystack test transaction initialization is unavailable, and permits buyer-only sandbox funding through the protected core API. It never activates with live Paystack credentials or real payment references.
- `PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS` - Required comma-separated exact account allowlist for the controlled payout-verification test override. Never use a wildcard or production payout account.
- `PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS` - Optional comma-separated WhatsApp identity allowlist that further restricts the controlled payout-verification test override.
- `MONNIFY_API_KEY` - Optional Monnify API key. When set with `MONNIFY_SECRET_KEY`, Sivan can use Monnify Name Enquiry as a fallback for payout account resolution.
- `MONNIFY_SECRET_KEY` - Optional Monnify secret key for access-token generation.
- `MONNIFY_BASE_URL` - Monnify API base URL. Use sandbox for testing and production URL only after Monnify live access is approved.
- `MONNIFY_TIMEOUT_MS` - Timeout for Monnify auth/name-enquiry calls. Defaults to `8000`.

### Application and workflow

- `NODE_ENV` - `development` or `production`.
- `LOG_LEVEL` - `info`, `debug`, `warn`, or `error`.
- `DATABASE_PROVIDER` - Storage provider. Use `sqlite` locally or `postgres` for production managed Postgres.
- `DATABASE_URL` - SQLite file path when `DATABASE_PROVIDER=sqlite`, or the production managed Postgres URL when `DATABASE_PROVIDER=postgres`.
- `POSTGRES_DATABASE_URL` - Optional managed Postgres URL fallback used when `DATABASE_PROVIDER=postgres` and `DATABASE_URL` is blank or still a placeholder.
- `POSTGRES_SSL` - Optional Postgres SSL toggle. Defaults to SSL for Postgres. Set `false` only for local non-SSL Postgres.
- `POSTGRES_CONNECTION_TIMEOUT_MS` - Postgres connection timeout for backend pools. Defaults to `5000`; keep bounded so WhatsApp requests fail cleanly instead of surfacing Render 502s.
- `POSTGRES_QUERY_TIMEOUT_MS` - Postgres query timeout for backend pools. Defaults to `8000`; keep near or below `CORE_API_TIMEOUT_MS` used by the WhatsApp bot.
- `TRUST_PROXY_HOPS` - Number of reverse-proxy hops Express should trust for `req.ip`. Use `1` on Render so IP controls read the client IP from forwarded headers.
- `SENTRY_DSN` - Optional Sentry DSN for production error, log, trace, and profiling telemetry. Set this in Render for the backend service.
- `SENTRY_ENVIRONMENT` - Sentry environment name. Use `production`, `staging`, or `development`.
- `SENTRY_RELEASE` - Optional release identifier. Use a git SHA, deploy ID, or semantic version so Sentry can group issues by release.
- `SENTRY_TRACES_SAMPLE_RATE` - Sentry transaction trace sample rate. Recommended default is `0.1` in production and `0` locally unless debugging.
- `SENTRY_PROFILE_SESSION_SAMPLE_RATE` - Sentry Node profiling session sample rate. Keep `0` by default; temporarily raise only while investigating performance.
- `SENTRY_ENABLE_LOGS` - Set `true` to send structured Sentry logs.
- `SENTRY_SEND_DEFAULT_PII` - Keep `false` unless you have reviewed privacy/compliance requirements. The app also redacts common secrets before sending events.
- `SENTRY_DEBUG_ENDPOINT_ENABLED` - Set `true` only for a short verification window to expose `/debug-sentry`; return it to `false` immediately after confirming events arrive.
- `OPERATIONS_ALERT_WEBHOOK_URL` - Optional HTTPS endpoint that receives operational/payment warning events as JSON.
- `OPERATIONS_ALERT_WEBHOOK_SECRET` - Optional shared secret sent as `x-sivan-alert-secret` to the operations alert webhook.
- `OPERATIONS_ALERT_PROVIDER` - Optional alert transport selector. Use `telegram` to send operations alerts directly through Telegram Bot API, or leave blank to use the generic webhook when `OPERATIONS_ALERT_WEBHOOK_URL` is set.
- `TELEGRAM_ALERT_BOT_TOKEN` - Telegram bot token used for direct operations alerts when `OPERATIONS_ALERT_PROVIDER=telegram`.
- `TELEGRAM_ALERT_CHAT_ID` - Telegram user/group/channel chat id that receives direct operations alerts.
- `ADMIN_API_KEY` - Required in production for admin endpoints.
- `ADMIN_IP_ALLOWLIST` - Optional comma-separated admin network allowlist. Supports exact IPs and IPv4 CIDR ranges, for example `203.0.113.10,198.51.100.0/24`. Leave blank until you know the operator/VPN/static IPs.
- `CORE_API_SECRET` - Shared secret required in production for `/api/tasks` calls from the WhatsApp bot.
- `CORE_API_IP_ALLOWLIST` - Optional comma-separated allowlist for core API callers such as the WhatsApp bot. Supports exact IPs and IPv4 CIDR ranges. Leave blank if the caller runs from dynamic egress without a stable IP.
- `PAYOUT_ENCRYPTION_KEY` - Required in production. Used to AES-256-GCM encrypt payout account numbers at rest. Generate a 32-byte random secret and keep it stable across deploys; rotating it requires a planned data re-encryption migration.
- `PAYOUT_TOKEN_SECRET` - Optional separate HMAC secret used to derive deterministic payout account tokens for uniqueness/lookups without storing raw account numbers. If blank, the app falls back to `PAYOUT_ENCRYPTION_KEY`.
- `PAYOUT_SHARED_ACCOUNT_REVIEW_COUNT` - Number of distinct sellers using the same payout account token that triggers manual compliance review. Defaults to `2`.
- `NAIRA_HIGH_VALUE_REVIEW_AMOUNT` - Naira release amount threshold that moves release to compliance review before payout approval. Defaults to `500000`.
- `USDC_HIGH_VALUE_REVIEW_AMOUNT` - USDC release amount threshold that blocks autonomous release for manual review. Defaults to `2500`.
- `COMPLIANCE_NEW_SELLER_ESCROW_COUNT` - Seller escrow count threshold treated as a new-seller risk signal. Defaults to `1`.
- `COMPLIANCE_HIGH_DISPUTE_RATIO` - Seller dispute-ratio threshold that blocks payout approval through aggregate compliance risk. Defaults to `0.3`.
- `COMPLIANCE_HIGH_DISPUTE_MIN_ESCROWS` - Minimum seller escrow history before high-dispute-ratio scoring is applied. Defaults to `3`.
- `WEBHOOK_URL` - Public URL for webhook callbacks.
- `SMOKE_BASE_URL` - Base URL used by `npm run smoke`; use the Render backend URL in production checks.
- `SMOKE_ADMIN_API_KEY` - Optional admin key used by `npm run smoke` for protected database and operations checks. Falls back to `ADMIN_API_KEY`.
- `SMOKE_REQUIRE_SETTLEMENT_PROOF` - Set `true` to make smoke checks require a previously run settlement verification proof.
- `ADMIN_PAGE_SMOKE_BASE_URL` - Base URL used by `npm run smoke:admin-page`; falls back to `SMOKE_BASE_URL`, `VITE_API_BASE_URL`, or `http://localhost:4000`.
- `ADMIN_PAGE_SMOKE_ADMIN_API_KEY` - Admin key used by `npm run smoke:admin-page`; falls back to `SMOKE_ADMIN_API_KEY` or `ADMIN_API_KEY`.
- `ADMIN_PAGE_AUTH_BASE_URL` - Optional Telegram admin auth service URL used by `npm run smoke:admin-page`; falls back to `VITE_ADMIN_AUTH_BASE_URL`.
- `ADMIN_PAGE_AUTH_JWT` - Optional pre-issued Telegram admin JWT for smoke checking `/auth/me`, `/admin/stats`, `/admin/sessions`, and `/admin/auth-audit`.
- `ADMIN_PAGE_AUTH_JWT_SECRET` - Optional secret used to mint a short-lived smoke JWT when `ADMIN_PAGE_AUTH_JWT` is not provided. It must match the Telegram auth service `SESSION_TOKEN_SECRET`.
- `BACKUP_PROVIDER` - Human-readable backup provider label shown in admin DR status. Use `neon-postgres-pitr` when production uses Neon Postgres.
- `BACKUP_RETENTION_DAYS` - Number of days production database backups are retained. Use the real managed database retention, not an aspirational value.
- `BACKUP_POLICY_URL` - Optional private runbook/provider URL proving where backup policy is documented.
- `BACKUP_RESTORE_RUNBOOK_URL` - Runbook path or URL for restore testing. Defaults to `docs/disaster-recovery.md`.
- `BACKUP_RESTORE_TEST_MAX_AGE_DAYS` - Maximum age before the last restore drill is considered stale. Defaults to `30`.
- `BACKUP_LAST_RESTORE_TEST_AT` - ISO timestamp for the last successful restore drill.
- `BACKUP_LAST_RESTORE_TEST_STATUS` - Last restore drill result, for example `passed`, `failed`, or `not_recorded`.
- `ROLLBACK_RELEASE_URL` - Optional release/deploy URL used by operators to rollback backend/frontend/bot deploys.
- `OUTAGE_STATUS_PAGE_URL` - Optional public/internal status page URL for outage communication.
- `OUTAGE_CONTACTS` - Comma-separated on-call/operator contacts for production incidents.
- `DR_BASE_URL` - Base URL used by `npm run dr:check`; falls back to `SMOKE_BASE_URL`.
- `DR_ADMIN_API_KEY` - Admin key used by `npm run dr:check`; falls back to `SMOKE_ADMIN_API_KEY` or `ADMIN_API_KEY`.
- `DR_REQUIRE_FRESH_RESTORE` - Set `true` to fail DR checks unless the restore drill timestamp is fresh.
- `QUEUE_WORKER_ENABLED` - Set `true` to run the background retry worker inside the API process. Keep `false` if you prefer manual `/admin/queue/run` execution or a separate worker process.
- `QUEUE_WORKER_INTERVAL_MS` - Background retry worker polling interval. Defaults to `15000`.
- `QUEUE_WORKER_BATCH_SIZE` - Maximum jobs processed per background worker tick. Defaults to `5`.
- `QUEUE_LOCK_TIMEOUT_SECONDS` - Time before a stuck `running` queue job can be recovered. Defaults to `300`.
- `QUEUE_RETRY_BASE_DELAY_MS` - Initial retry backoff delay. Defaults to `30000`.
- `QUEUE_RETRY_MAX_DELAY_MS` - Maximum retry backoff delay. Defaults to `1800000`.
- `STUCK_ESCROW_ALERT_MINUTES` - Escrow age threshold used by operations status for stuck active escrows. Defaults to `1440`.
- `ABUSE_BLOCK_SCORE` - Risk score at or above which escrow creation is blocked. Defaults to `95`.
- `ABUSE_REVIEW_SCORE` - Risk score at or above which an abuse signal is recorded for operator review. Defaults to `60`.
- `ABUSE_ESCROW_VELOCITY_LIMIT` - Recent escrow count for a buyer before velocity risk is flagged. Defaults to `8`.
- `ABUSE_HIGH_AMOUNT_NAIRA` - Naira amount threshold that adds high-amount risk. Defaults to `1000000`.
- `ABUSE_HIGH_AMOUNT_USDC` - USDC amount threshold that adds high-amount risk. Defaults to `5000`.
- `ABUSE_TREND_ALERT_MIN_SIGNALS` - Critical signal or repeated-fingerprint threshold for automated abuse trend alerts. Defaults to `5`.
- `PORT` - HTTP port for the webhook server.
- `AGENT_TASK_TYPE`, `USER_PAYMENT_PREFERENCE`, `USER_EMAIL`, `PAYMENT_AMOUNT`, and `TASK_INSTRUCTIONS` - Optional local demo runner values only. Leave these blank/commented in production because real escrow data must come from API/WhatsApp/admin input.

## Recommended secrets management

- Store production secrets in a secure vault if possible.
- Use `.env` locally and `.env.example` only for documentation.
- Never commit `.env` or real credentials to source control.

## Example `.env.example`

```env
SYNAPSE_API_KEY=your-synapse-api-key
SYNAPSE_RPC_URL=https://staging.oobeprotocol.ai:8080/rpc
SYNAPSE_WS_URL=
SYNAPSE_GRPC_URL=
SYNAPSE_X402_FACILITATOR_URL=https://facilitator.payai.network
SYNAPSE_X402_NETWORK=solana-devnet
SYNAPSE_USDC_MINT=
SAP_RPC_URL=
SAP_AGENT_PRIVATE_KEY=your-sap-agent-private-key
SAP_AGENT_PUBLIC_KEY=your-sap-agent-public-key

ACE_DATA_API_KEY=your-ace-data-cloud-api-key
ACE_DATA_BASE_URL=https://api.acedata.cloud

X402_RPC_URL=
X402_CLIENT_ID=
X402_CLIENT_SECRET=
SETTLEMENT_VERIFY_TASK_TYPE=content-creation
SETTLEMENT_PROOF_OUTPUT=./data/settlement-verification-proof.json
SAP_VERIFY_REGISTER_AGENT=false
X402_VERIFY_PAYMENT_ID=
X402_VERIFY_CREATE_PAYMENT=false
X402_VERIFY_AMOUNT=0.01
X402_VERIFY_RECIPIENT=

PAYSTACK_SECRET_KEY=your-paystack-secret-key
PAYSTACK_PUBLIC_KEY=your-paystack-public-key
PAYSTACK_BASE_URL=https://api.paystack.co
PAYSTACK_WEBHOOK_SECRET=your-paystack-webhook-secret
PAYSTACK_RECEIVER_ACCOUNT=your-paystack-receiver-account
PAYSTACK_CHANNELS=bank_transfer
PAYSTACK_CALLBACK_URL=https://yourapp.example.com/payment/callback
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_BASE_URL=https://sandbox.monnify.com

NODE_ENV=development
LOG_LEVEL=debug
DATABASE_PROVIDER=sqlite
DATABASE_URL=./data/sivan-escrow-agent.db
POSTGRES_DATABASE_URL=
POSTGRES_SSL=true
POSTGRES_CONNECTION_TIMEOUT_MS=5000
POSTGRES_QUERY_TIMEOUT_MS=8000
TRUST_PROXY_HOPS=1
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=
SENTRY_TRACES_SAMPLE_RATE=0
SENTRY_PROFILE_SESSION_SAMPLE_RATE=0
SENTRY_ENABLE_LOGS=false
SENTRY_SEND_DEFAULT_PII=false
SENTRY_DEBUG_ENDPOINT_ENABLED=false
OPERATIONS_ALERT_WEBHOOK_URL=
OPERATIONS_ALERT_WEBHOOK_SECRET=
OPERATIONS_ALERT_PROVIDER=
TELEGRAM_ALERT_BOT_TOKEN=
TELEGRAM_ALERT_CHAT_ID=
ADMIN_API_KEY=change-me-to-a-strong-admin-secret
ADMIN_IP_ALLOWLIST=
CORE_API_SECRET=change-me-to-the-same-value-used-by-whatsapp-bot
CORE_API_IP_ALLOWLIST=
PAYOUT_ENCRYPTION_KEY=change-me-32-byte-random-secret
PAYOUT_TOKEN_SECRET=change-me-separate-hmac-secret
PAYOUT_SHARED_ACCOUNT_REVIEW_COUNT=2
NAIRA_HIGH_VALUE_REVIEW_AMOUNT=500000
USDC_HIGH_VALUE_REVIEW_AMOUNT=2500
COMPLIANCE_NEW_SELLER_ESCROW_COUNT=1
COMPLIANCE_HIGH_DISPUTE_RATIO=0.3
COMPLIANCE_HIGH_DISPUTE_MIN_ESCROWS=3
WEBHOOK_URL=https://yourapp.example.com/webhooks
SMOKE_BASE_URL=https://yourapp.example.com
SMOKE_ADMIN_API_KEY=
SMOKE_REQUIRE_SETTLEMENT_PROOF=false
ADMIN_PAGE_SMOKE_BASE_URL=https://yourapp.example.com
ADMIN_PAGE_SMOKE_ADMIN_API_KEY=
ADMIN_PAGE_AUTH_BASE_URL=https://telegram-admin-auth.example.com
ADMIN_PAGE_AUTH_JWT=
ADMIN_PAGE_AUTH_JWT_SECRET=
ABUSE_BLOCK_SCORE=95
ABUSE_REVIEW_SCORE=60
ABUSE_ESCROW_VELOCITY_LIMIT=8
ABUSE_HIGH_AMOUNT_NAIRA=1000000
ABUSE_HIGH_AMOUNT_USDC=5000
PORT=4000
AGENT_TASK_TYPE=content-creation
USER_PAYMENT_PREFERENCE=NAIRA
USER_EMAIL=buyer@example.com
PAYMENT_AMOUNT=50
TASK_INSTRUCTIONS=Write a product description for a trustless escrow service.
```

## Production Postgres

For production, set the backend service to use the managed Postgres URL. With Neon, use the pooled connection string for app runtime. For schema migrations, restore drills, exports, or tools that need session-level behavior, use the direct non-pooled Neon connection string.

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://user:password@neon-pooler-host/db?sslmode=verify-full&channel_binding=require
POSTGRES_DATABASE_URL=postgresql://user:password@neon-pooler-host/db?sslmode=verify-full&channel_binding=require
POSTGRES_SSL=true
```

Do not commit real database URLs. Store them only in `.env`, Render env vars, GitHub Actions secrets, or the selected secret manager.
