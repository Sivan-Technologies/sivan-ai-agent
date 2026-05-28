# Sivan Escrow Agent

Sivan Escrow Agent is a WhatsApp-first escrow and AI task orchestration system for trust-based freelance and service payments.

The project is designed for people who already negotiate work through WhatsApp, Telegram, Discord, and informal communities, but need a safer way to collect money before work starts and confirm payment before releasing execution.

Today, the strongest working flow is Nigerian Naira collection through Paystack using **bank transfer only**. Paystack confirms payment through a signed webhook before the backend runs the AI/SAP work. USDC/x402 and SAP paths are wired into the architecture, but still need live production credentials and deeper end-to-end verification before they should be treated as production-ready.

## What Sivan Can Do Today

- Receive task requests from the standalone WhatsApp bot.
- Protect task creation with a shared `CORE_API_SECRET`.
- Parse user intent into task type, amount, instructions, and payment preference.
- Create Naira payment requests through Paystack.
- Restrict Paystack checkout to bank transfer via `PAYSTACK_CHANNELS=bank_transfer`.
- Store the real Paystack transaction reference for webhook matching.
- Wait for Paystack payment confirmation before running Naira tasks.
- Verify Paystack webhook signatures.
- Verify the Paystack transaction status after a `charge.success` webhook.
- Prevent duplicate Paystack webhooks from double-running task execution.
- Execute AI task work through the Ace Data Cloud integration path.
- Send task/payment updates back to the WhatsApp bot.
- Provide protected admin endpoints for tasks, webhook events, fee settings, and audit history.
- Run a React admin dashboard for internal monitoring.
- Manage first-class buyer/seller escrow records with payout readiness checks.
- Detect Paystack amount mismatches and move affected escrows to `REVIEW_REQUIRED`.
- Re-check Paystack transactions from the admin panel if a webhook was missed or Render was sleeping.
- Show an admin reconciliation view for payments needing review, releases awaiting payout, missing payout references, and Paystack amount mismatches.
- Export reconciliation CSVs for operations and accounting.
- Require explicit buyer completion before any escrow can move into release.
- Expose protected operations visibility endpoints for database, Sentry, alert, and recent warning/error status.
- Run live smoke checks with `npm run smoke`.
- Track durable queue status, abuse signals, support cases, and support notes for production operations.
- Risk-score escrow creation for obvious abuse patterns such as velocity spikes, self-dealing, high amounts, and scam keywords.
- Auto-create support cases when disputes are opened.

## Current Public Services

Backend API:

```text
https://sivan-escrow-agent.onrender.com
```

WhatsApp bot:

```text
https://whatsapp-bot-ix7t.onrender.com
```

Backend health:

```text
https://sivan-escrow-agent.onrender.com/api/health
```

WhatsApp bot health:

```text
https://whatsapp-bot-ix7t.onrender.com/api/health
```

## Transaction Flow

For the full recommended WhatsApp group/private-DM escrow architecture, see:

```text
docs/whatsapp-escrow-mvp-flow.md
```

For the phased autonomous escrow roadmap, see:

```text
docs/autonomous-escrow-roadmap.md
```

### 1. User Sends A WhatsApp Message

A customer sends a message to the Sivan WhatsApp bot, for example:

```text
Create a logo concept for my bakery. Budget 5000 naira.
```

The WhatsApp bot validates Twilio's webhook signature, parses the message, and sends an authenticated request to the backend:

```text
POST /api/tasks
```

The request includes:

- task type
- payment preference
- amount
- WhatsApp sender identity
- task instructions

### 2. Backend Creates The Task

The backend validates the request body with Zod, creates a workflow record, and routes the payment based on the user's preference.

For Naira, it calls Paystack and creates a transfer-only checkout/payment request.

### 3. Paystack Generates A Transfer Payment Link

Sivan initializes a Paystack transaction with:

```json
{
  "currency": "NGN",
  "channels": ["bank_transfer"]
}
```

Paystack returns:

- `authorization_url`
- `reference`
- `access_code`

Sivan stores the real Paystack `reference`, because this is what Paystack sends back in webhooks.

### 4. Bot Sends Payment Link To User

The WhatsApp bot replies with the task ID and Paystack payment link.

The user opens the Paystack link and pays by bank transfer.

Sivan is not directly collecting card details and should not handle card data. Paystack handles the payment page and transfer instructions.

### 5. Paystack Sends Webhook

After Paystack detects successful payment, Paystack sends a webhook to:

```text
https://sivan-escrow-agent.onrender.com/webhooks/paystack
```

The backend:

- checks the Paystack signature
- validates the webhook body
- extracts the transaction reference
- finds the matching workflow task
- calls Paystack transaction verification
- confirms the transaction status is `success`

### 6. Sivan Executes The Task

Only after verified payment confirmation does Sivan execute the task.

This is the key escrow behavior: work does not run for Naira tasks until payment is confirmed.

### 7. WhatsApp Notification Is Sent

After the task progresses, the backend calls the WhatsApp bot notification endpoint:

```text
POST /api/notify
```

The bot sends a WhatsApp update to the user.

## API Endpoints

### Public Health

```text
GET /api/health
GET /health/readiness
```

### Task Creation

```text
POST /api/tasks
```

Requires:

```text
x-core-api-key: CORE_API_SECRET
```

### Escrow Participant Actions

```text
POST /api/escrows/:escrowId/complete
POST /api/escrows/:escrowId/release-request
POST /api/escrows/:escrowId/dispute
```

These require `x-core-api-key: CORE_API_SECRET`. Release requests require the buyer to confirm completion first.

### Paystack Webhook

```text
POST /webhooks/paystack
```

Paystack must send:

```text
x-paystack-signature
```

### Admin Endpoints

All admin endpoints require:

```text
x-admin-key: ADMIN_API_KEY
```

Endpoints:

```text
GET /admin/tasks
GET /admin/tasks/:taskId
GET /admin/webhooks
GET /admin/db-status
GET /admin/escrows
GET /admin/escrows/:escrowId
GET /admin/escrows/:escrowId/events
POST /admin/escrows/:escrowId/recheck-payment
POST /admin/escrows/:escrowId/payout-review
POST /admin/escrows/:escrowId/approve-release
GET /admin/reconciliation
GET /admin/reconciliation.csv
GET /admin/ops/status
GET /admin/ops/events
GET /admin/settlement/verification
POST /admin/settlement/verify
GET /admin/queue/status
GET /admin/queue/jobs
POST /admin/queue/jobs
GET /admin/queue/jobs/:jobId
POST /admin/queue/jobs/:jobId/retry
POST /admin/queue/run
GET /admin/abuse/signals
GET /admin/abuse/analytics
GET /admin/support/cases
GET /admin/support/search
POST /admin/support/cases
PATCH /admin/support/cases/:caseId
GET /admin/support/cases/:caseId/notes
POST /admin/support/cases/:caseId/notes
GET /admin/settings
POST /admin/settings
GET /admin/audit-history
```

## Environment Variables

Copy `.env.example` to `.env` locally and configure provider credentials.

Important backend variables:

```env
NODE_ENV=production
PORT=4000
DATABASE_PROVIDER=sqlite
DATABASE_URL=/tmp/sivan-escrow-agent.db
POSTGRES_DATABASE_URL=

ADMIN_API_KEY=change-me
CORE_API_SECRET=change-me
OPERATIONS_ALERT_WEBHOOK_URL=
OPERATIONS_ALERT_WEBHOOK_SECRET=

ACE_DATA_API_KEY=your-ace-data-key
ACE_DATA_BASE_URL=https://api.acedata.cloud

PAYSTACK_SECRET_KEY=sk_test_or_live_key
PAYSTACK_PUBLIC_KEY=pk_test_or_live_key
PAYSTACK_BASE_URL=https://api.paystack.co
PAYSTACK_CHANNELS=bank_transfer
PAYSTACK_CALLBACK_URL=https://sivan-escrow-agent.onrender.com/api/health
WEBHOOK_URL=https://sivan-escrow-agent.onrender.com/webhooks/paystack
SMOKE_BASE_URL=https://sivan-escrow-agent.onrender.com
SMOKE_ADMIN_API_KEY=
SMOKE_REQUIRE_SETTLEMENT_PROOF=false
ABUSE_BLOCK_SCORE=95
ABUSE_REVIEW_SCORE=60
ABUSE_ESCROW_VELOCITY_LIMIT=8
ABUSE_HIGH_AMOUNT_NAIRA=1000000
ABUSE_HIGH_AMOUNT_USDC=5000

NOTIFICATION_URL=https://whatsapp-bot-ix7t.onrender.com
NOTIFICATION_SECRET=same-value-as-whatsapp-notify-secret

SYNAPSE_API_KEY=your-synapse-key
SYNAPSE_RPC_URL=your-synapse-rpc-url
SYNAPSE_X402_FACILITATOR_URL=your-x402-facilitator-url
SYNAPSE_X402_NETWORK=solana-devnet
```

For Render Postgres production, use the internal Render database URL:

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://sivan_user:password@internal-render-host/sivan_db
POSTGRES_DATABASE_URL=postgresql://sivan_user:password@internal-render-host/sivan_db
POSTGRES_SSL=true
```

`POSTGRES_DATABASE_URL` is supported as a production fallback for Render. If `DATABASE_PROVIDER=postgres` and `DATABASE_URL` is blank or still a placeholder, the backend uses `POSTGRES_DATABASE_URL`.

SAP wallet variables are still required for full SAP/on-chain production use:

```env
SAP_AGENT_PRIVATE_KEY=your-real-sap-wallet-private-key
SAP_AGENT_PUBLIC_KEY=your-real-sap-wallet-public-key
```

For a temporary non-SAP demo deployment, placeholders may keep the production server booting, but they should not be used for real on-chain settlement.

## Paystack Dashboard Setup

Use Paystack test mode while testing.

Test webhook URL:

```text
https://sivan-escrow-agent.onrender.com/webhooks/paystack
```

Test callback URL:

```text
https://sivan-escrow-agent.onrender.com/api/health
```

Make sure:

- `PAYSTACK_SECRET_KEY` starts with `sk_test_` in test mode.
- `PAYSTACK_PUBLIC_KEY` starts with `pk_test_` in test mode.
- Paystack IP whitelist is empty/off during Render testing unless you have static outbound IPs.
- `PAYSTACK_CHANNELS=bank_transfer` is set in Render.

## Local Development

Install dependencies:

```bash
npm install
```

Run the backend in development mode:

```bash
npm run dev
```

Run the webhook/API server:

```bash
npm run serve
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test -- --run
```

Run smoke checks against a local or deployed backend:

```bash
SMOKE_BASE_URL=https://sivan-escrow-agent.onrender.com SMOKE_ADMIN_API_KEY=$ADMIN_API_KEY npm run smoke
```

Run the retry worker manually for immediate recovery:

```bash
curl -X POST "$API_BASE_URL/admin/queue/run" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"limit":10}'
```

For background retry processing, set `QUEUE_WORKER_ENABLED=true` and tune `QUEUE_WORKER_INTERVAL_MS`, `QUEUE_WORKER_BATCH_SIZE`, `QUEUE_RETRY_BASE_DELAY_MS`, and `QUEUE_RETRY_MAX_DELAY_MS`.

Run SAP/x402 production verification and write a proof JSON:

```bash
SETTLEMENT_PROOF_OUTPUT=./data/settlement-verification-proof.json npm run verify:settlement
```

For x402 live proof, set `X402_VERIFY_PAYMENT_ID` to an existing payment ID. Only set `X402_VERIFY_CREATE_PAYMENT=true` when you intentionally want the verifier to create a tiny payment facility.

Operational recovery playbooks are in:

```text
docs/production-runbooks.md
```

Start production build:

```bash
npm start
```

## Admin Dashboard

The admin dashboard lives in:

```text
frontend/
```

Run locally:

```bash
cd frontend
npm install
npm run dev
```

Set:

```env
VITE_API_BASE_URL=https://sivan-escrow-agent.onrender.com
```

The dashboard is for internal operators, not the main buyer-facing product.

Current operator features:

- escrow ledger filters for `REVIEW_REQUIRED`, `PENDING_RELEASE`, `RELEASED`, missing payout reference, and Paystack amount mismatch
- needs-attention cards for payments needing review, releases awaiting payout, released escrows missing payout references, and amount mismatches
- reconciliation CSV export with escrow ID, buyer/seller, expected amount, received amount, Paystack reference, payout reference, release approver, release timestamp, and status
- Paystack payment re-check button for escrow recovery when a webhook was missed or delayed
- operations status for database readiness, Sentry/alert configuration, and recent operational warnings/errors
- settlement verification runner for SAP discovery and x402 status/probe proof
- retry queue creation, manual worker run, exponential backoff, stale lock recovery, retry replay, and dead-letter visibility
- abuse signals, request/device fingerprint watch, reputation watchlist, and velocity dashboard for suspicious escrow creation patterns
- support cases, assignment/status tracking, search, and internal notes for founder/operator support workflows
- escrow event timelines with transactions and linked support cases
- payout safety queue for pending releases, missing payout references, amount mismatches, and recovery jobs

## WhatsApp Bot

The WhatsApp bot is a separate repo:

```text
https://github.com/Samswitchy/whatsapp-bot
```

It handles:

- Twilio webhook signature validation
- incoming WhatsApp messages
- simple message parsing
- calling `POST /api/tasks`
- sending payment links and task updates

Twilio webhook URL:

```text
https://whatsapp-bot-ix7t.onrender.com/webhooks/twilio
```

## What Is Not Fully Production-Ready Yet

- Group-to-private-DM escrow initiation works as a foundation, but the customer experience still needs more polish.
- Full SAP on-chain escrow settlement needs real SAP wallet credentials and live integration tests.
- x402 USDC payment flow needs live facilitator verification and settlement testing.
- Dispute AI is intentionally not implemented yet; disputes now create support cases, but evidence capture and resolution outcomes still need implementation.
- Queue persistence/status exists, but the retry worker and dead-letter replay tooling are still next.
- Abuse prevention has MVP risk scoring and analytics, but device fingerprinting, fraud reputation, and richer velocity dashboards are still future work.
- Support workflows have cases and internal notes, but canned actions, SLAs, and escalation automation are still future work.
- SQLite remains supported for local development, but Render production should use Postgres with `DATABASE_PROVIDER=postgres`.
- Vite/Vitest dev dependency audit warnings should be upgraded carefully.
- Monitoring logs exist for payment failures and release events, but production alert routing should still be configured in Sentry/Datadog.
- WhatsApp UX is functional but should continue moving toward a more guided, customer-friendly conversation.

## Summary

Sivan currently works as a WhatsApp-first escrow workflow backend that can:

1. receive a task,
2. create a Paystack bank-transfer payment request,
3. wait for verified Paystack webhook confirmation,
4. execute the task after payment,
5. track everything in admin endpoints,
6. notify the user through WhatsApp.

The key product promise is simple:

> A buyer funds the task first by transfer, Sivan verifies payment, then the AI/service workflow starts.
