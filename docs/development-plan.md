# Development Plan

## Current status

1. Foundation complete
   - TypeScript project scaffold and dependencies are in place.
   - Env configuration and `.env.example` are defined.
   - Modular service layers for SAP, Ace Data Cloud, Paystack, and x402 are implemented.
2. Workflow implementation
   - `agentOrchestrator.ts` exists to coordinate discovery, execution, and settlement.
   - Paystack webhook server is implemented for Naira payment confirmation.
   - x402 payment facility methods now support create, settle, and status polling.
3. Escrow core implementation
   - First-class users, escrows, payout accounts, transactions, and escrow events exist.
   - Buyer completion is now required before release requests.
   - Manual Naira release approval and reconciliation tracking are implemented.
4. Production hardening underway
   - Operations status endpoints expose database, disaster recovery, Sentry, alert, and recent warning/error state.
   - Payment and operational warnings can be routed to Sentry and an operations alert webhook.
   - `npm run smoke` provides deploy smoke checks for health, readiness, database, disaster recovery, and operations status.
   - `npm run dr:check` validates backup, restore-test freshness, rollback, and outage-readiness configuration after deploys.

## Phase 1: Stabilize the current workflow

1. Validate current flows end-to-end.
   - test agent discovery and tool selection.
   - test Ace Data Cloud execution paths.
   - test Paystack and x402 payment flows independently.
2. Harden external calls.
   - ensure retry and backoff logic in `sapAgent.ts` and `x402Client.ts`.
   - add consistent error handling and logging across services.

## Phase 2: Persistence and state management

1. Add persistent workflow state storage.
   - record task lifecycle, payment status, and execution output.
2. Improve orchestration reliability.
   - recover from partial failures.
   - continue workflows after webhook callbacks.

## Phase 3: Production readiness

1. Run smoke checks after each deploy.
   - configure `SMOKE_BASE_URL` and `SMOKE_ADMIN_API_KEY`.
   - fail deployment promotion if health/readiness or operations checks fail.
2. Run disaster-recovery checks and restore drills.
   - configure `BACKUP_*`, `ROLLBACK_RELEASE_URL`, and `OUTAGE_CONTACTS`.
   - restore production backup into staging at least every 30 days.
   - record smoke, incident drill, and DR check results in release notes.
3. Finalize SAP mainnet / real endpoint integration.
   - replace placeholder SAP endpoint values with real RPC URLs.
   - ensure `sapAgent.ts` method signatures match the deployed environment.
4. Finalize x402 production integration.
   - confirm `createPaymentFacility`, `settlePayment`, and `getPaymentStatus` endpoints.
5. Continue observability.
   - keep Sentry and operations alert webhook configured.
   - add metrics or status output for scaling.

## Phase 4: Scaling and automation

1. Add queue or worker architecture for task processing.
2. Add webhook-driven triggers rather than manual environment-driven task inputs.
3. Add monitoring and alerting for automated settlement flows.

## Phase 5: Testing, packaging, and delivery

1. Add unit and integration tests for core flows.
2. Add Docker/CI packaging and deployment instructions.
3. Document the final workflow and submission details.

## Notes for the bounty

- The current repository already demonstrates the main agent components.
- The next priority is durable state, production endpoints, and audit-ready logging.
- Focus on showing the hybrid settlement workflow clearly and reliably.
