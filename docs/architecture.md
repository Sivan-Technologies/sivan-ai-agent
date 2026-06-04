# Architecture Overview

## System Components

1. **SAP Agent Service**
   - Implemented in `src/services/sapAgent.ts`.
   - Registers the agent, discovers matching tools, and manages on-chain escrow state.
   - Uses JSON-RPC 2.0 calls with retry logic.

2. **Ace Data Cloud Integration**
   - Implemented in `src/services/aceData.ts`.
   - Executes AI tasks with text generation, document summarization, and data extraction.
   - Accepts task instructions from the orchestrator and returns structured output.

3. **Payment Router**
   - Implemented in `src/services/paymentRouter.ts`.
   - Decides whether to use Naira or USDC settlement based on user preference.
   - Calls Paystack or x402 service flows accordingly.

4. **x402 Payment Facility**
   - Implemented in `src/services/x402Client.ts`.
   - Creates USDC payment facilities, settles payments, and polls status.
   - Uses retry-safe HTTP calls and consistent response handling.

5. **Paystack Fiat Bridge**
   - Implemented in `src/services/paystackClient.ts`.
   - Initializes Naira transactions and verifies webhook signatures.
   - Confirms payment status for Naira settlement.

6. **Orchestration Layer**
   - Implemented in `src/services/agentOrchestrator.ts`.
   - Coordinates discovery, execution, payment routing, and settlement.
   - Ensures the workflow runs end-to-end without manual intervention.

7. **Webhook Server**
   - Implemented in `src/server.ts`.
   - Receives Paystack webhook events and validates signatures.
   - Triggers workflow progress once payment is confirmed.

## Workflow Layers

- **Discovery Layer**: `sapAgent.ts` discovers tools and selects execution candidates.
- **Execution Layer**: `aceData.ts` runs AI work and returns results.
- **Decision Layer**: `paymentRouter.ts` chooses Naira or USDC settlement.
- **Payment Layer**: `paystackClient.ts` handles fiat; `x402Client.ts` handles USDC.
- **Orchestration Layer**: `agentOrchestrator.ts` ties the whole flow together.
- **Webhook Layer**: `server.ts` listens for Paystack events to finalize workflows.

## Hybrid Settlement Model

- **Naira flow**: buyer preference triggers Paystack initialization and stores Paystack's transaction reference for webhook matching. AI execution waits until a signed Paystack `charge.success` webhook is received and the transaction verifies successfully.
- **USDC flow**: x402 payment facility is created on the USDC path, the agent executes the task, and the payment is settled on success.

## Security and Trust

- All keys and secrets are stored in environment variables.
- Sensitive values are excluded from source control via `.gitignore`.
- SAP and Ace Data Cloud API interactions are authenticated.
- Payment settlement uses x402 and Paystack primitives with retry-safe logic.
- `/api/tasks` requires `CORE_API_SECRET` in production through the `x-core-api-key` header.
- Admin endpoints require `ADMIN_API_KEY` through the `x-admin-key` header.
- The WhatsApp bot validates Twilio webhook signatures before forwarding user requests.
- Public request bodies and webhook payloads are validated with Zod schemas before workflow code runs.
- Paystack `charge.success` processing uses an atomic workflow status claim so duplicate webhook delivery cannot double-run Naira execution.
- Payment/webhook anomalies are routed through monitoring helpers and can be reported to Sentry when `SENTRY_DSN` is configured.
- Operations status endpoints expose database readiness, backup/disaster recovery posture, Sentry/alert configuration, and recent operational warnings/errors.
- Payment and operational warnings can be forwarded directly to Telegram with `OPERATIONS_ALERT_PROVIDER=telegram` or to an operations alert webhook through `OPERATIONS_ALERT_WEBHOOK_URL`.
- Escrow release requires explicit buyer completion before release request; non-admin disputes require buyer/seller participation.

## Progress Summary (Percent Complete)

- **Overall progress:** 86%

- **Mostly complete (>=90%):**
   - **SAP Agent Service:** 90% (core interfaces and RPC wiring implemented; on-chain escrow hooks present but require full integration tests and security review)
   - **Ace Data Cloud Integration:** 100% (client implemented and orchestrator integration present)
   - **Payment Router (logic):** 95% (can choose Naira vs USDC and routes to respective clients; minor hardening and edge-case handling remain)
   - **Paystack webhook persistence and tracker:** 100% (webhook receiver, transaction-reference matching, transaction verification, and `WorkflowStore` persistence implemented)
   - **Project rename + docs (branding, GTM):** 100% (README/CHANGELOG updates and WhatsApp GTM doc added)
   - **Escrow state machine:** 95% (buyer completion and authorization checks gate release; manual dispute evidence/resolution exists, while maker-checker approval and provider-side refund proof remain next)
   - **Operations visibility:** 95% (admin operations endpoints, DR status, Sentry/alert hooks, smoke checks, incident drills, and live Neon restore proof exist; recurring operational cadence and external dashboards remain)

- **Partially complete (work in progress):**
   - **x402 Payment Facility integration:** 90% — client and flows implemented; needs live end-to-end verification with x402 credentials and settlement monitoring.
   - **Agent Orchestrator:** 85% — orchestrates discovery, execution, and payment routing; needs stronger error handling, retries, and idempotency guarantees for production.

- **Pending / Early-stage (~0-50% done):**
   - **Demo frontend/runner:** 10% (a `run-demo.ts` CLI script exists; an interactive UI or public webhook demo is not implemented)
   - **Admin dashboard:** 10% (basic query endpoints added to `server.ts`; UI and RBAC missing)
   - **On-chain SAP escrow (production-ready):** 40% (create/release/status methods exist in `SapAgent`; additional integration tests and security review required)
   - **CI / Tests / Monitoring:** 88% (unit/integration tests, Sentry hooks, operations endpoints, correctly wired scheduled/manual GitHub smoke checks, incident drills, and DR checks exist; Meta live verification, key rotation, and external dashboards remain)

## What remains (actionable items)

- Short-term (required to demo end-to-end):
   - Wire real credentials and run an end-to-end demo for both Paystack (Naira) and x402 (USDC) flows.
   - Provide public webhook guidance and ngrok (or similar) steps for Paystack testing.
   - Add task dedup keys for user-submitted requests and continue expanding operational error handling around external providers.

- Mid-term (production readiness):
   - Implement on-chain SAP escrow full flow (create, monitor, release) with testnet coverage.
   - Add request/response schema validation, contract tests for payment clients, and unit tests for orchestrator logic.
   - Add CI (GitHub Actions) that runs lint, typecheck, and tests; add pre-commit formatting rules.
   - Configure live monitoring and alerting destinations (Sentry project, Telegram or operations alert webhook, Prometheus/Cloudwatch metrics, basic dashboards).
   - Add database migrations (or simple versioning) for the SQLite store or migrate to a managed datastore.

- Long-term / scaling:
   - Replace the in-process workflow store with a durable queue (Redis/Sidekiq/Kafka) for scale and retries.
   - Add multi-instance coordination and leader election for scheduled polling (x402, SAP) to avoid duplicate settlements.
   - Add role-based admin UI, audit logs, and exportable workflow traces for compliance.

## Suggested Improvements & Quick Wins

- Add unit tests around `WorkflowStore`, `PaymentRouter`, and `AgentOrchestrator` to lock behavior and prevent regressions.
- Add idempotency tokens on payment initialization and webhook handling to avoid double-processing.
- Improve logging context (include `taskId`, `paymentReference`, `agentKey`) and structured logs for easier querying.
- Add feature flags for switching USDC channels (`x402` vs `sap`) at runtime and toggling test/live modes for payment clients.
- Provide a `docs/quickstart.md` with exact `ngrok` commands and example Paystack webhook setup to allow reviewers to exercise the flows without local build issues.

## Current Risks

- Native dependency (`better-sqlite3`) requires Windows build tools; this blocks straightforward `npm install` on developer machines without Visual Studio C++ workloads. Consider using a pure-JS SQLite client (e.g., `sqlite`/`sqlite3` with prebuilt bindings) or document the required build toolchain.
- No automated tests or CI means regressions can be introduced silently.
- Missing production-grade secrets management and rotation guidance.

---

If you want, I can:

- Implement the demo runner UI (web UI) or a more robust CLI and the ngrok/webhook guide next.
- Add unit tests for the core services and a minimal GitHub Actions CI pipeline.

Which should I do next? (I suggest starting with the end-to-end demo + ngrok guide so we can validate payment paths.)
