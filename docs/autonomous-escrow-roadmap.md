# Autonomous Escrow Roadmap

This document defines Sivan's long-term direction as a conversational autonomous escrow coordination agent.

The key principle is:

```text
AI orchestrates the conversation.
Backend rules enforce financial safety.
Payment rails move money only after deterministic checks pass.
```

Sivan should become autonomous over time, but autonomy must be progressive. The product handles real money, so the system cannot allow uncontrolled AI decisions to move funds.

## Deep Product Opinion

Sivan's strongest direction is not "AI chatbot for payments." That is too small and too risky.

The stronger direction is:

```text
Conversational autonomous settlement infrastructure
```

That means Sivan coordinates trust inside familiar chat environments while the backend enforces strict escrow rules.

The important insight is that escrow is mostly operational coordination:

- Who is the buyer?
- Who is the seller?
- Has the seller provided a payout destination?
- Has the buyer funded the escrow?
- Has Paystack confirmed payment?
- Is the transaction active?
- Did the buyer approve release?
- Is there a dispute?
- Is the payout allowed?
- Was every state transition logged?

Blockchain and AI can improve the system later, but the MVP succeeds or fails on transaction state, payment verification, payout coordination, auditability, and user trust.

## Architecture Principle

Do not let AI directly move money.

AI should interpret intent and guide users. The escrow engine should decide what actions are allowed.

### AI Layer

The AI/conversation layer handles:

- natural language parsing
- intent extraction
- onboarding prompts
- buyer/seller coordination
- group-to-private-DM handoff
- release/dispute intent detection
- user-friendly explanations

### Escrow Engine

The deterministic backend handles:

- allowed state transitions
- buyer/seller identity requirements
- payout account requirements
- funding verification
- release authorization
- dispute locking
- admin approval requirements
- audit logging
- idempotency

### Payment Layer

The payment layer handles:

- Paystack transfer-only payment initialization
- Paystack webhook verification
- Paystack transaction verification
- future Paystack transfer recipient creation
- future Paystack seller payout
- future x402/SAP/USDC settlement

## Why Progressive Autonomy Is Required

The wrong model is:

```text
User says "release"
  -> AI sends money immediately
```

That is unsafe because of:

- hacked WhatsApp accounts
- impersonation
- social engineering
- accidental release messages
- ambiguous language
- coercion
- prompt injection
- AI hallucination
- webhook or reconciliation bugs

The right model is:

```text
User says "release"
  -> AI extracts release intent
  -> escrow engine checks rules
  -> system asks for explicit confirmation
  -> admin/manual approval if required
  -> payout occurs only if all checks pass
```

This is how Sivan can become autonomous without becoming reckless.

## Recommended Autonomy Levels

### Level 1: MVP Coordination

AI coordinates the workflow. Critical money movement still requires explicit confirmation and manual admin approval.

Sivan can:

- detect escrow creation intent
- ask onboarding questions
- create payment instructions
- notify users when payment is funded
- detect release/dispute messages
- move the transaction into `PENDING_RELEASE` or `DISPUTED`

Sivan should not:

- automatically pay sellers
- decide disputes
- release money based only on AI interpretation

### Level 2: Smart Autonomy

Sivan can auto-release low-risk transactions when all deterministic checks pass.

Required checks:

- escrow is `FUNDED` or `IN_PROGRESS`
- buyer explicitly confirmed completion
- seller has verified payout details
- no dispute is active
- payment amount and reference match
- transaction is below risk threshold
- release confirmation is recent
- audit log is complete

Medium-risk transactions should require admin review.

### Level 3: True Autonomous Escrow

Sivan can coordinate settlement decisions using:

- transaction state
- buyer and seller reputation
- delivery evidence
- chat history
- dispute signals
- risk scoring
- payment history
- prior behavior
- fraud indicators

Even at this level, the backend must enforce hard rules. AI can recommend or trigger allowed actions, but it should not bypass the escrow engine.

## Required Escrow States

These states should become the canonical state machine:

| State | Meaning |
| --- | --- |
| `CREATED` | Escrow initialized |
| `PENDING_PROFILE` | Buyer or seller onboarding incomplete |
| `PENDING_PAYMENT` | Waiting for buyer funding |
| `FUNDED` | Payment verified |
| `IN_PROGRESS` | Seller can proceed |
| `COMPLETED` | Buyer approved completion |
| `PENDING_RELEASE` | Release requested, waiting for admin/manual approval |
| `RELEASED` | Seller payout completed |
| `DISPUTED` | Under review |
| `REVIEW_REQUIRED` | Payment or reconciliation issue needs admin review |
| `FAILED` | Payment or workflow failure |
| `CANCELLED` | Escrow cancelled before completion |

## State Transition Rules

Recommended MVP rules:

| From | To | Allowed When |
| --- | --- | --- |
| `CREATED` | `PENDING_PROFILE` | Buyer or seller profile is missing |
| `CREATED` | `PENDING_PAYMENT` | Buyer and seller are attached |
| `PENDING_PROFILE` | `PENDING_PAYMENT` | Required onboarding is complete |
| `PENDING_PAYMENT` | `FUNDED` | Paystack webhook and transaction verification pass |
| `PENDING_PAYMENT` | `REVIEW_REQUIRED` | Paystack verification fails or amount received does not match escrow amount |
| `FUNDED` | `IN_PROGRESS` | Seller is notified to proceed |
| `IN_PROGRESS` | `COMPLETED` | Buyer confirms work is complete |
| `COMPLETED` | `PENDING_RELEASE` | Buyer confirms release intent |
| `PENDING_RELEASE` | `RELEASED` | Admin approves payout in MVP |
| Any active state | `DISPUTED` | Buyer or seller raises dispute |
| Any pre-release state | `CANCELLED` | Admin or allowed cancellation rule applies |
| Any state | `FAILED` | Payment, webhook, or workflow failure occurs |

## Phase Completion Matrix

Current estimate:

```text
MVP escrow-core readiness: 94%
Production financial-readiness: 91%
Cross-repo production-readiness: 90%
```

Legend:

- ✅ Completed
- 🟡 In progress
- ⬜ Not started
- 🔮 Future/autonomy phase

| Phase | Goal | Status | Notes |
| --- | --- | --- | --- |
| Phase 0 | Core backend/API foundation | ✅ Completed | Express API, config, persistence, tests, admin endpoints exist |
| Phase 1 | Paystack transfer-only payment verification | ✅ Completed for MVP | Transfer-only initialization, webhook verification, reference matching, idempotency, amount mismatch detection, and admin re-check are implemented |
| Phase 2 | WhatsApp bot bridge | ✅ Completed for MVP | Twilio auth works, Meta Cloud API foundation now exists as a second transport, outbound messages work, webhook routes exist, optional Meta app-secret signature verification is wired, private DM flow exists, escrow creation is idempotent for repeated confirmations, seller invites no longer block buyer confirmation, and escrow commands now cover accept, status, complete, release, and dispute |
| Phase 3 | First-class users | ✅ Completed for MVP | `users` table exists, WhatsApp numbers are first-class identities, buyer profiles can be fetched for repeat WhatsApp deals, and seller profile setup is now guided in WhatsApp |
| Phase 4 | First-class escrows | ✅ Completed for MVP | `escrows` table exists separate from legacy `workflow_tasks`, with buyer/seller, amount, payout, payment, and audit links |
| Phase 5 | Transaction state machine | ✅ Completed for MVP | Release now requires explicit buyer completion before `PENDING_RELEASE`; buyer/seller authorization checks guard completion, release, and disputes |
| Phase 6 | Private DM onboarding | ✅ Completed for MVP | WhatsApp bot now uses Postgres-backed private conversation sessions, seller setup, account-number-first payout setup, bank search/selection, and escrow commands |
| Phase 7 | Seller payout setup | ✅ Completed for MVP | Seller acceptance pauses until profile and Paystack-verified payout account are complete; seller setup collects first name, last name, account number, then bank search/selection because Paystack resolution requires account number plus bank code |
| Phase 8 | Manual release approval | ✅ Completed for MVP | Naira release moves to `PENDING_RELEASE`; admin approval requires payout/reference ID only, derives gross amount from the escrow record, calculates platform fee/seller net payout, and stores reconciliation details |
| Phase 9 | Reconciliation operations | ✅ Completed for MVP | Admin dashboard shows funding reference, payment status, expected vs received amount, escrow-derived gross, platform fee, seller net payout, masked payout account, resolved name, payout reference, approver, release timestamp, filters, attention cards, and CSV export |
| Phase 10 | Support and dispute workflow | ✅ Completed for manual-resolution MVP | Admin Support and Disputes tabs now provide inbox, status tracking, internal notes, operator assignment, search, dispute linking, evidence capture, manual resolution outcomes, and support-note closure |
| Phase 11 | Production hardening | ✅ Completed for MVP | Monitoring, alert routing, expanded smoke checks, retry worker, backoff, dead-letter replay, stuck escrow visibility, abuse signals, support queue, payout safety review, event explorer, and admin Ops endpoints now exist |
| Phase 11A | Monitoring and alerts | ✅ Completed for MVP | Production Sentry Node instrumentation, optional tracing/profiling/log capture, Telegram/direct alert routing, generic alert webhook routing, failed webhook recovery alerts, payout review alerts, queue failure alerts, database status checks, stuck escrow visibility, and operator event visibility exist |
| Phase 11B | Live smoke testing pipeline | ✅ Completed for operator-run pipeline | Smoke checks cover health, readiness, database, operations, queue, webhooks, reconciliation, support, abuse, and optional settlement proof checks |
| Phase 11C | Production environment hardening | ✅ Foundation completed / 🟡 live ops required | Env docs, secret placeholders, stricter admin/API auth gates, explicit local-auth opt-in, CORS/rate limiting, HTTPS deploy assumptions, Postgres config guidance, and DR env checks exist; real secret rotation/IP controls and live restore proof are deployment tasks |
| Phase 11D | Abuse prevention expansion | ✅ Completed for MVP | Escrow creation scoring covers velocity, self-dealing, high amounts, repeated scam keywords, abuse signal persistence, request/device fingerprint metadata, reputation watchlist, cross-device graph visibility, automated reputation action suggestions, velocity dashboard, and operator analytics |
| Phase 11E | Transaction recovery procedures | ✅ Completed for MVP | Runbooks and admin recovery endpoints cover payment mismatch, wrong amount, missing webhook, payout failure, stuck escrow, cancellation, double webhook, refund situations, and queue replay |
| Phase 11F | Payout automation safety layer | ✅ Completed for manual-payout MVP | Admin Payout Safety tab now tracks pending releases, missing payout references, amount mismatches, payout review jobs, queue recovery, and duplicate-risk operator review before future autonomous payout retries |
| Phase 11G | Audit/event explorer | ✅ Completed for MVP | Admin Audit tab and escrow timeline endpoint expose events, transactions, operator actions, release history, payment history, dispute history, and linked support cases |
| Phase 11H | Dispute evidence and resolution | ✅ Completed for manual-resolution MVP | Admin Disputes tab lists open disputes, captures evidence records, links support cases, records manual outcomes, writes release/refund/cancel events, closes related support cases, and accepts participant evidence from WhatsApp/private API |
| Phase 11I | Deploy-time incident drills | ✅ Completed for operator-run drills | `npm run drill:incident` validates queue replay, webhook recovery readiness, and payout failure review paths after deploys, with execute mode for controlled recovery job creation; latest live read-only drill passed on 2026-06-02 |
| Phase 11J | User-facing dispute history and notifications | ✅ Completed for API/notification MVP | Participant dispute history API exists, and admin evidence/resolution actions can notify buyer and seller through WhatsApp when enabled |
| Phase 11K | Stronger fraud controls | ✅ Completed for operator-action MVP | Abuse actions persist watch/warn/limit/block/clear decisions, active actions affect escrow creation risk scoring, repeated fingerprints feed cross-device graph analytics, trend thresholds emit operational alerts, and suggested reputation actions are surfaced for operators |
| Phase 11L | Backup and disaster recovery | ✅ Completed for MVP | Admin DR status, `.env`-aware `npm run dr:check`, Neon Postgres PITR backup plan, backup/restore/rollback/outage env docs, and a disaster-recovery runbook now exist; the first Neon restore branch drill passed on 2026-06-02, restore proof was recorded, and production `npm run dr:check` now passes with restore freshness |
| Phase 11M | Compliance MVP | ✅ Completed for risk-gated MVP | See `docs/compliance.md`; name-match scoring, shared payout account detection, high-value release review, release readiness checks, escrow-derived seller-net payout approval, and funding/release/refund/fee ledger entries are implemented. Remaining work is Phase 2 KYC provider abstraction |
| Phase 12 | Smart autonomy | 🔮 Future | Auto-release only for low-risk transactions after rule checks |
| Phase 13 | SAP/x402/USDC production settlement | 🟡 In progress | Verification runner and proof endpoints exist; full production settlement remains blocked on live credential run and proof artifact |
| Phase 14 | Cross-repo production operations | 🟡 In progress | Escrow backend, WhatsApp bot, and Telegram admin auth build and test cleanly locally; live backend smoke, incident drill, and production DR checks passed on 2026-06-02; admin Ops can proxy WhatsApp provider status/switching for Twilio or Meta. Remaining work is GitHub CLI re-auth/secret verification, Meta live webhook verification, and recurring smoke/incident/DR cadence after deploys |

## What Is Completed So Far

The current system already has:

- ✅ backend health and readiness endpoints
- ✅ authenticated task creation with `CORE_API_SECRET`
- ✅ protected admin endpoints with `ADMIN_API_KEY`
- ✅ admin/core local auth bypasses require explicit `ALLOW_INSECURE_LOCAL_AUTH=true` outside production
- ✅ request validation with Zod
- ✅ Postgres-backed storage support
- ✅ production Postgres fallback: when `DATABASE_PROVIDER=postgres`, backend can use `POSTGRES_DATABASE_URL` if `DATABASE_URL` is blank or still a placeholder
- ✅ first-class `users`, `escrows`, `transactions`, `payout_accounts`, and `escrow_events`
- ✅ legacy `workflow_tasks` retained as agent-task history
- ✅ Paystack transfer-only checkout configuration
- ✅ Paystack transaction reference storage
- ✅ Paystack webhook signature verification with constant-time HMAC comparison
- ✅ Paystack transaction verification before Naira execution
- ✅ Paystack amount mismatch detection with `REVIEW_REQUIRED`
- ✅ admin Paystack transaction re-check by escrow reference
- ✅ webhook persistence
- ✅ idempotency guard against repeated webhook execution
- ✅ operational warning logs for invalid signatures, payment mismatch, verification failure, blocked release, and payout approval
- ✅ admin escrow ledger with release/dispute actions
- ✅ reconciliation dashboard fields: funding reference, payment status, expected amount, received amount, payout reference, approver, release timestamp
- ✅ reconciliation filters for `REVIEW_REQUIRED`, `PENDING_RELEASE`, `RELEASED`, missing payout references, and Paystack amount mismatches
- ✅ reconciliation CSV export for accounting and manual operations
- ✅ admin needs-attention view for payment reviews, payout queue, missing payout references, and amount mismatches
- ✅ Naira release policy: buyer completion confirmation, then release request, then manual admin approval
- ✅ explicit `COMPLETED` state before any release request
- ✅ buyer-only completion and release authorization checks
- ✅ participant-only non-admin dispute checks
- ✅ manual Naira payout reconciliation fields: reference, notes, approver, released timestamp
- ✅ seller invite/accept flow before payment initialization
- ✅ escrow creation idempotency for repeated WhatsApp `YES` confirmations
- ✅ seller invite notification is asynchronous so Twilio/bot latency does not block escrow creation responses
- ✅ Paystack bank/account verification for seller payout accounts
- ✅ fallback Nigerian bank list so WhatsApp bank search can continue when Paystack bank-list lookup is temporarily unavailable
- ✅ optional Monnify Name Enquiry fallback for payout account-name resolution when configured
- ✅ seller payout name-match scoring with strong/medium auto approval and weak/failed review outcomes
- ✅ shared payout account detection using deterministic payout account tokens
- ✅ high-value release review threshold before payout approval
- ✅ release readiness checks for payout verification, acceptable name match, and shared-account review
- ✅ compliance ledger entries for funding, release, and refund events
- ✅ backend user profile lookup for repeat WhatsApp buyers
- ✅ guided seller profile setup in WhatsApp: first name, last name, bank search, account number, account verification
- ✅ Naira escrow acceptance requires payout readiness before payment initialization
- ✅ improved transaction status replies with readiness, funding, payout, and next action
- ✅ USDC/x402 policy lane: autonomous release after deterministic checks
- ✅ WhatsApp notification callback
- ✅ WhatsApp notification callback fails closed when `NOTIFY_SECRET` is missing
- ✅ Twilio webhook signature validation in the bot
- ✅ WhatsApp private-DM escrow onboarding foundation
- ✅ WhatsApp conversation sessions persisted in Postgres for Render restart recovery
- ✅ WhatsApp commands: `accept SIV-...`, `status SIV-...`, `complete SIV-...`, `release SIV-...`, `dispute SIV-...`
- ✅ admin escrow detail shows payout reference, payout notes, release approver, and dispute state
- ✅ WhatsApp group behavior limited to intent detection and private handoff
- ✅ outbound WhatsApp message testing
- ✅ Telegram admin auth uses crypto-random session tokens, request/verify rate limiting, failed-attempt tracking, Helmet, and production CORS fail-closed behavior
- ✅ Telegram admin auth local build and tests pass
- ✅ WhatsApp bot local build and tests pass
- ✅ Admin dashboard keeps both production Ops visibility and Telegram Admin Auth session visibility after the latest cross-repo sync
- ✅ Render deployment for backend and bot
- ✅ documentation for WhatsApp escrow MVP flow
- ✅ admin operations visibility endpoints for database, alert, Sentry, and recent operational-event status
- ✅ operations alert routing for payment and operational warnings through Telegram or a generic webhook
- ✅ production Sentry instrumentation for backend and WhatsApp bot with early SDK init, Express error handler, env-driven tracing/profiling/logs, source maps, and event redaction
- ✅ admin Operations tab for database, Sentry, alert, queue, abuse, support, event, and settlement-verification visibility
- ✅ operator smoke-check script for live Render/backend health, readiness, database, operations, queue, webhook, reconciliation, support, and abuse checks
- ✅ scheduled/manual GitHub Actions production smoke workflow
- ✅ SAP/x402 verification runner and admin endpoints that produce settlement proof JSON when live credentials or payment IDs are configured
- ✅ durable production ops tables for retry queue jobs, abuse signals, support cases, and support notes
- ✅ abuse-prevention risk scoring for escrow creation: velocity, self-dealing, high amount, and scam-keyword signals
- ✅ high-risk escrow blocks and review signals with operator-visible abuse analytics
- ✅ admin Risk tab for abuse reputation watchlist, request/device fingerprint watch, velocity outliers, and recent signals
- ✅ support workflow foundation: Admin Support tab, support inbox, assignments, status updates, search, internal notes, and automatic case creation from disputes
- ✅ dispute desk foundation: Admin Disputes tab, evidence capture, manual resolution outcomes, release/refund/cancel event history, and related support-case closure
- ✅ user-facing dispute history API, participant WhatsApp evidence submission, plus optional participant WhatsApp notifications for dispute evidence and resolution updates
- ✅ deploy-time incident drill script and runbook for queue replay, webhook recovery, and payout failure recovery
- ✅ backup/disaster recovery status endpoint, admin Ops visibility, `npm run dr:check`, env documentation, and restore/rollback/outage runbook
- ✅ persistent abuse actions for watch/warn/limit/block/clear reputation controls, cross-device graph visibility, suggested reputation actions, and automated abuse trend alerts
- ✅ queue resilience foundation: persistent queue status, job ledger, worker claims, exponential backoff, stale lock recovery, manual replay, and dead-letter visibility
- ✅ Paystack webhook recovery jobs are enqueued automatically when webhook processing fails after a valid reference is present
- ✅ Admin Payout Safety tab and payout safety review queue exist before autonomous payout automation
- ✅ Admin Audit tab and escrow event explorer endpoint link timeline events, transactions, and related support cases
- ✅ production runbook for payment mismatch, wrong amount, missing webhook, payout failure, stuck escrow, cancellation, double webhook, refund, and queue recovery

## What Should Be Built Next

The next major engineering work should not be dispute AI yet.

Sivan is now actively in production-hardening mode around deterministic settlement infrastructure:

| Item | Status | Notes |
| --- | --- | --- |
| Smoke checks | ✅ Completed for operator script | `npm run smoke` checks public health/readiness plus admin database, operations, queue, webhook, reconciliation, support, and abuse surfaces when an admin key is supplied |
| Monitoring/operational visibility | ✅ Completed for MVP | Admin operations endpoints expose database status, alert configuration, Sentry configuration, and recent operational events; backend and WhatsApp bot both have production Sentry SDK setup |
| Alert routing | ✅ Completed for Telegram/webhook/Sentry MVP | Payment and operational warnings are captured in memory, sent to Sentry when configured, and can be forwarded to Telegram with `OPERATIONS_ALERT_PROVIDER=telegram` or to `OPERATIONS_ALERT_WEBHOOK_URL` |
| Queue resilience foundation | ✅ Completed for MVP | Durable queue jobs, worker claims, exponential backoff, stale lock recovery, manual replay, and dead-letter visibility exist |
| Abuse prevention foundation | ✅ Completed for MVP | Escrow creation risk scoring, request/device fingerprint metadata, abuse signal persistence, high-risk blocking, reputation watchlist, velocity dashboard, and operator analytics exist |
| Support workflow foundation | ✅ Completed for MVP | Admin Support tab, cases, notes, assignment/status updates, search, dispute case creation, and support queue visibility exist |
| Transaction recovery procedures | ✅ Completed for MVP | Operator runbook and admin recovery endpoints cover payment re-check, webhook recovery jobs, payout review jobs, support linking, and queue replay |
| Payout safety layer | ✅ Completed for manual-payout MVP | Manual release approval still gates Naira payouts; Admin Payout Safety tab, payout review jobs, recovery queue, and reconciliation views prevent blind autonomous retries |
| Audit/event explorer | ✅ Completed for MVP | Admin Audit tab plus `/admin/escrows/:escrowId/events` expose escrow timeline, transactions, and linked support cases |
| Cross-repo security hardening | ✅ Completed for current pass | Notify auth fails closed, Telegram OTP/session hardening is in place, Paystack HMAC comparison is constant-time, and admin/core local auth bypass requires explicit opt-in |
| Payout data protection | ✅ Implemented for current backend | New and legacy payout account numbers are tokenized, AES-256-GCM encrypted at rest, masked in API/store responses, and shared logging redacts account/payment/secret-like values. Production must set stable `PAYOUT_ENCRYPTION_KEY` and `PAYOUT_TOKEN_SECRET` before deploy |
| Compliance MVP | ✅ Completed for risk-gated MVP | Seller payout setup stores resolved account name, name-match score/level, verification provider/time, shared-account count/flag, and release readiness blocks weak/failed/shared/high-value payout paths |
| Production Postgres migration | ✅ Code-ready / 🟡 deploy verification needed | Backend supports Postgres stores and `POSTGRES_DATABASE_URL` fallback; next step is setting Render `DATABASE_PROVIDER=postgres`, using the internal DB URL, deploying, and running smoke checks |
| Telegram admin auth sync | ✅ Build/test clean locally | Current local repo includes session-token hardening and production CORS fail-closed behavior; push/deploy verification remains an operator step |
| WhatsApp bot sync | ✅ Build/test clean locally | Current local repo includes fail-closed notify auth; push/deploy verification remains an operator step |
| x402/SAP production verification implementation | ✅ Completed for operator-run proof | `npm run verify:settlement` and `/admin/settlement/verify` run SAP discovery and x402 status/probe checks, write proof JSON, and surface results in the admin Ops tab |
| x402/SAP live proof | 🟡 Requires operator credentials/run | Needs real SAP/x402 credentials plus either `X402_VERIFY_PAYMENT_ID` or intentional `X402_VERIFY_CREATE_PAYMENT=true`; do not mark production settlement fully verified until a live proof artifact exists |
| Dispute evidence and resolution | ✅ Completed for API/manual-resolution MVP | Dispute state, support cases, evidence capture, admin resolution, refund/release/cancel outcomes, audit history, and participant-visible dispute history API exist |
| User-facing dispute history and notifications | ✅ Completed for API/notification MVP | `/api/escrows/:escrowId/dispute-history` exposes participant-visible dispute history, and admin dispute evidence/resolution actions can notify participants |
| Deploy-time incident drills | ✅ Completed for operator-run drills | `npm run drill:incident` supports read-only and controlled execute-mode drills for queue replay, webhook recovery, and payout failure recovery; latest live read-only drill passed on 2026-06-02 |
| Backup and disaster recovery | ✅ Completed for MVP | `/admin/dr/status`, Admin Ops DR visibility, `.env`-aware `npm run dr:check`, and `docs/disaster-recovery.md` exist; live DR check confirms backup/rollback/outage readiness, the first Neon restore branch drill passed on 2026-06-02, restore proof is recorded, and production `npm run dr:check` now passes |
| Stronger fraud controls beyond MVP | ✅ Completed for operator-action MVP | Persistent abuse actions, active-action risk scoring, cross-device graph visibility, fingerprint watch analytics, automated reputation action suggestions, and automated abuse trend alerts now exist; deeper graph investigation UI remains future work |

Only after these are solid should Sivan add autonomous release rules or dispute AI.

## Database recommendation

Do not rely on a free/local database for production scale. Use managed Postgres with backups, restore testing, retention, monitoring, and a rollback plan before real money volume increases.
## Recommended MVP Release Policy

For the first MVP:

```text
Payment funding: automated after Paystack verification.
Work start: automated after funding.
Naira payment release: buyer completion confirmation + release request + manual admin approval.
USDC/x402 release: buyer completion confirmation + release request + deterministic backend checks.
Disputes: manual admin review.
```

This creates enough automation to prove the product while avoiding dangerous uncontrolled Naira payout automation.

## Future Smart Release Policy

Later, Sivan can auto-release if:

- buyer has explicitly confirmed completion
- seller payout destination is verified
- no dispute exists
- transaction amount is below an auto-release limit
- buyer and seller have acceptable trust score
- payment has fully settled
- release confirmation is recent
- no risk flags are present

The backend should log why the release was allowed.

Example release decision log:

```json
{
  "escrowId": "SIV-10291",
  "decision": "auto_release_allowed",
  "rulesPassed": [
    "buyer_confirmed_completion",
    "seller_payout_verified",
    "no_dispute",
    "amount_under_limit",
    "payment_verified"
  ],
  "riskScore": 12,
  "decidedAt": "2026-05-26T00:00:00.000Z"
}
```

## Auditability Requirements

As Sivan becomes more autonomous, auditability becomes more important.

Every important action should record:

- actor
- role
- channel
- previous state
- next state
- reason
- payment reference
- escrow ID
- timestamp
- raw provider event ID when relevant

This matters for:

- disputes
- reconciliation
- fraud review
- support
- compliance
- trust with users

## Recommendation Right Now

Keep hardening the deterministic escrow core before adding more AI.

Completed from the prior immediate implementation order:

1. ✅ `users`
2. ✅ `escrows`
3. ✅ `transactions`
4. ✅ state transition guard
5. ✅ WhatsApp conversation state
6. ✅ seller payout onboarding
7. ✅ admin manual release approval
8. ✅ explicit buyer completion before release
9. ✅ production-hardening visibility: monitoring, alerts, and smoke checks
10. ✅ retry worker system: queue claims, exponential backoff, stale lock recovery, manual replay, and dead-letter visibility
11. ✅ live smoke testing surface: health, readiness, database, operations, queue, webhook, reconciliation, support, and abuse checks
12. ✅ production environment hardening foundation: env docs, secret placeholders, stricter admin/API auth gates, explicit local-auth opt-in, rate limiting, CORS, and HTTPS deploy assumptions
13. ✅ abuse prevention expansion for MVP: velocity checks, self-dealing checks, high-amount checks, scam keyword scoring, abuse signal persistence, request/device fingerprint metadata, reputation watchlist, velocity dashboard, and operator visibility
14. ✅ transaction recovery procedures: payment mismatch, wrong amount, missing webhook, payout failure, stuck escrow, cancellation, double webhook, refund, and queue recovery runbook
15. ✅ support operations workflow: Admin Support tab, support inbox, status tracking, internal notes, assignment, search, and dispute-linked support cases
16. ✅ payout automation safety foundation: Admin Payout Safety tab, manual payout gate, payout review jobs, reconciliation views, recovery jobs, duplicate-risk prevention by operator review, and no blind autonomous retry
17. ✅ audit/event explorer: Admin Audit tab and escrow timeline endpoint with events, transactions, operator actions, release history, payment history, dispute history, and linked support cases
18. ✅ backup and disaster recovery foundation: Admin Ops DR status, `npm run dr:check`, backup env contract, restore-test tracking, rollback/outage procedure, and release-note template
19. ✅ cross-repo security hardening pass: fail-closed WhatsApp notify auth, crypto-random Telegram session tokens, Telegram auth rate limits, Paystack constant-time HMAC comparison, and explicit local-auth bypass opt-in

Next production-hardening focus:

1. ✅ Latest live smoke checks against the deployed Render backend passed on 2026-06-02; 🟡 GitHub CLI re-auth is still needed before secrets/workflow wiring can be verified from this machine.
2. 🟡 Verify x402/SAP settlement with real credentials and record proof links/logs.
3. ✅ Latest deploy-time incident drill passed on 2026-06-02 and proof was stored in `docs/release-notes/2026-06-02-production-checks.md`; repeat after each Render deploy.
4. ✅ First Neon restore branch drill passed on 2026-06-02, `BACKUP_LAST_RESTORE_TEST_AT=2026-06-02T09:27:13Z` was recorded, proof was stored in `docs/release-notes/2026-06-02-production-checks.md`, Render env was updated, and production `npm run dr:check` now passes.
5. ✅ Encrypt/tokenize payout account numbers at rest, mask payout API responses, and redact payout/payment secrets from logs.
6. ✅ Implement compliance MVP from `docs/compliance.md`: name-match scoring, shared payout account detection, high-value review, release readiness gates, and funding/release/refund ledger entries.
7. ✅ Add richer user-facing dispute evidence flow in WhatsApp/private API; richer participant screens remain future portal work.
8. ✅ Add cross-device graph visibility and automated reputation action suggestions; deeper graph investigation UI remains future work.
