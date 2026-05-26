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

### Paystack / Naira Bridge

- `PAYSTACK_SECRET_KEY` - Paystack secret key for API calls.
- `PAYSTACK_BASE_URL` - Paystack API base URL.
- `PAYSTACK_WEBHOOK_SECRET` - Secret for validating Paystack webhook signatures.
- `PAYSTACK_RECEIVER_ACCOUNT` - Optional receiver account identifier for Paystack.

### Application and workflow

- `NODE_ENV` - `development` or `production`.
- `LOG_LEVEL` - `info`, `debug`, `warn`, or `error`.
- `DATABASE_URL` - SQLite database file path for workflow persistence.
- `SENTRY_DSN` - Optional Sentry DSN for production error and payment/webhook alerting.
- `ADMIN_API_KEY` - Required in production for admin endpoints.
- `CORE_API_SECRET` - Shared secret required in production for `/api/tasks` calls from the WhatsApp bot.
- `WEBHOOK_URL` - Public URL for webhook callbacks.
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

PAYSTACK_SECRET_KEY=your-paystack-secret-key
PAYSTACK_BASE_URL=https://api.paystack.co
PAYSTACK_WEBHOOK_SECRET=your-paystack-webhook-secret
PAYSTACK_RECEIVER_ACCOUNT=your-paystack-receiver-account

NODE_ENV=development
LOG_LEVEL=debug
DATABASE_URL=./data/sivan-escrow-agent.db
SENTRY_DSN=
ADMIN_API_KEY=change-me-to-a-strong-admin-secret
CORE_API_SECRET=change-me-to-the-same-value-used-by-whatsapp-bot
WEBHOOK_URL=https://yourapp.example.com/webhooks
PORT=4000
AGENT_TASK_TYPE=content-creation
USER_PAYMENT_PREFERENCE=NAIRA
USER_EMAIL=buyer@example.com
PAYMENT_AMOUNT=50
TASK_INSTRUCTIONS=Write a product description for a trustless escrow service.
```
