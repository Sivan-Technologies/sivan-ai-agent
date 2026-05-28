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

### Application and workflow

- `NODE_ENV` - `development` or `production`.
- `LOG_LEVEL` - `info`, `debug`, `warn`, or `error`.
- `DATABASE_PROVIDER` - Storage provider. Use `sqlite` locally or `postgres` on Render.
- `DATABASE_URL` - SQLite file path when `DATABASE_PROVIDER=sqlite`, or Render internal Postgres URL when `DATABASE_PROVIDER=postgres`.
- `POSTGRES_DATABASE_URL` - Optional Render internal Postgres URL fallback used when `DATABASE_PROVIDER=postgres` and `DATABASE_URL` is blank or still a placeholder.
- `POSTGRES_SSL` - Optional Postgres SSL toggle. Defaults to SSL for Postgres. Set `false` only for local non-SSL Postgres.
- `SENTRY_DSN` - Optional Sentry DSN for production error and payment/webhook alerting.
- `OPERATIONS_ALERT_WEBHOOK_URL` - Optional HTTPS endpoint that receives operational/payment warning events as JSON.
- `OPERATIONS_ALERT_WEBHOOK_SECRET` - Optional shared secret sent as `x-sivan-alert-secret` to the operations alert webhook.
- `ADMIN_API_KEY` - Required in production for admin endpoints.
- `CORE_API_SECRET` - Shared secret required in production for `/api/tasks` calls from the WhatsApp bot.
- `WEBHOOK_URL` - Public URL for webhook callbacks.
- `SMOKE_BASE_URL` - Base URL used by `npm run smoke`; use the Render backend URL in production checks.
- `SMOKE_ADMIN_API_KEY` - Optional admin key used by `npm run smoke` for protected database and operations checks. Falls back to `ADMIN_API_KEY`.
- `SMOKE_REQUIRE_SETTLEMENT_PROOF` - Set `true` to make smoke checks require a previously run settlement verification proof.
- `ABUSE_BLOCK_SCORE` - Risk score at or above which escrow creation is blocked. Defaults to `95`.
- `ABUSE_REVIEW_SCORE` - Risk score at or above which an abuse signal is recorded for operator review. Defaults to `60`.
- `ABUSE_ESCROW_VELOCITY_LIMIT` - Recent escrow count for a buyer before velocity risk is flagged. Defaults to `8`.
- `ABUSE_HIGH_AMOUNT_NAIRA` - Naira amount threshold that adds high-amount risk. Defaults to `1000000`.
- `ABUSE_HIGH_AMOUNT_USDC` - USDC amount threshold that adds high-amount risk. Defaults to `5000`.
- `PORT` - HTTP port for the webhook server.
- `AGENT_TASK_TYPE` - Default task type for the agent workflow.
- `USER_PAYMENT_PREFERENCE` - `NAIRA` or `USDC` to route payments.
- `USER_EMAIL` - Buyer email for Paystack transaction initialization.
- `PAYMENT_AMOUNT` - Numeric payment amount.
- `TASK_INSTRUCTIONS` - AI instructions for the agent task.

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

NODE_ENV=development
LOG_LEVEL=debug
DATABASE_PROVIDER=sqlite
DATABASE_URL=./data/sivan-escrow-agent.db
POSTGRES_DATABASE_URL=
POSTGRES_SSL=true
SENTRY_DSN=
OPERATIONS_ALERT_WEBHOOK_URL=
OPERATIONS_ALERT_WEBHOOK_SECRET=
ADMIN_API_KEY=change-me-to-a-strong-admin-secret
CORE_API_SECRET=change-me-to-the-same-value-used-by-whatsapp-bot
WEBHOOK_URL=https://yourapp.example.com/webhooks
SMOKE_BASE_URL=https://yourapp.example.com
SMOKE_ADMIN_API_KEY=
SMOKE_REQUIRE_SETTLEMENT_PROOF=false
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

## Render Postgres

For Render production, set the backend service to use the internal database URL:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://sivan_user:password@internal-render-host/sivan_db
POSTGRES_DATABASE_URL=postgresql://sivan_user:password@internal-render-host/sivan_db
POSTGRES_SSL=true
```

Use the external database URL only from your local machine or database tools.
