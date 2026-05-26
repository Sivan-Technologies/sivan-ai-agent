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
MVP escrow-core readiness: 85%
Production financial-readiness: 72%
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
| Phase 2 | WhatsApp bot bridge | 🟡 Mostly completed | Twilio auth works, outbound messages work, webhook route exists, private DM flow exists, and escrow commands exist |
| Phase 3 | First-class users | 🟡 In progress | `users` table exists, WhatsApp numbers are first-class identities, and seller profile setup is now guided in WhatsApp |
| Phase 4 | First-class escrows | 🟡 In progress | `escrows` table now exists separate from legacy `workflow_tasks` |
| Phase 5 | Transaction state machine | 🟡 In progress | Canonical states are stored, release/dispute transitions are guarded, and payment review states are enforced |
| Phase 6 | Private DM onboarding | ✅ Completed for MVP | WhatsApp bot now uses Postgres-backed private conversation sessions, seller setup, bank search/selection, and escrow commands |
| Phase 7 | Seller payout setup | ✅ Completed for MVP | Seller acceptance pauses until profile and Paystack-verified payout account are complete |
| Phase 8 | Manual release approval | ✅ Completed for MVP | Naira release moves to `PENDING_RELEASE`; admin approval requires payout reference and stores reconciliation details |
| Phase 9 | Reconciliation operations | ✅ Completed for MVP | Admin dashboard shows funding reference, payment status, expected vs received amount, payout reference, approver, and release timestamp |
| Phase 10 | Dispute workflow | 🟡 In progress | Dispute state exists from WhatsApp/admin; evidence capture and resolution outcomes are next |
| Phase 11 | Smart autonomy | 🔮 Future | Auto-release only for low-risk transactions after rule checks |
| Phase 12 | SAP/x402/USDC production settlement | 🔮 Future | SDK and config are partially wired; requires real credentials and live testing |

## What Is Completed So Far

The current system already has:

- ✅ backend health and readiness endpoints
- ✅ authenticated task creation with `CORE_API_SECRET`
- ✅ protected admin endpoints with `ADMIN_API_KEY`
- ✅ request validation with Zod
- ✅ Postgres-backed storage support
- ✅ first-class `users`, `escrows`, `transactions`, `payout_accounts`, and `escrow_events`
- ✅ legacy `workflow_tasks` retained as agent-task history
- ✅ Paystack transfer-only checkout configuration
- ✅ Paystack transaction reference storage
- ✅ Paystack webhook signature verification
- ✅ Paystack transaction verification before Naira execution
- ✅ Paystack amount mismatch detection with `REVIEW_REQUIRED`
- ✅ admin Paystack transaction re-check by escrow reference
- ✅ webhook persistence
- ✅ idempotency guard against repeated webhook execution
- ✅ operational warning logs for invalid signatures, payment mismatch, verification failure, blocked release, and payout approval
- ✅ admin escrow ledger with release/dispute actions
- ✅ reconciliation dashboard fields: funding reference, payment status, expected amount, received amount, payout reference, approver, release timestamp
- ✅ Naira release policy: buyer request plus manual admin approval
- ✅ manual Naira payout reconciliation fields: reference, notes, approver, released timestamp
- ✅ seller invite/accept flow before payment initialization
- ✅ Paystack bank/account verification for seller payout accounts
- ✅ guided seller profile setup in WhatsApp: first name, last name, bank search, account number, account verification
- ✅ Naira escrow acceptance requires payout readiness before payment initialization
- ✅ improved transaction status replies with readiness, funding, payout, and next action
- ✅ USDC/x402 policy lane: autonomous release after deterministic checks
- ✅ WhatsApp notification callback
- ✅ Twilio webhook signature validation in the bot
- ✅ WhatsApp private-DM escrow onboarding foundation
- ✅ WhatsApp conversation sessions persisted in Postgres for Render restart recovery
- ✅ WhatsApp commands: `accept SIV-...`, `status SIV-...`, `release SIV-...`, `dispute SIV-...`
- ✅ admin escrow detail shows payout reference, payout notes, release approver, and dispute state
- ✅ WhatsApp group behavior limited to intent detection and private handoff
- ✅ outbound WhatsApp message testing
- ✅ Render deployment for backend and bot
- ✅ documentation for WhatsApp escrow MVP flow

## What Should Be Built Next

The next major engineering work should not be dispute AI yet.

The next work should be production hardening around deterministic settlement infrastructure:

1. Add reconciliation filters/exports for Paystack funding and manual Naira payouts.
2. Add live Render smoke checks for Paystack webhook replay and admin re-check.
3. Add production x402/SAP settlement verification before expanding autonomous USDC release.

Only after these are solid should Sivan add autonomous release rules or dispute AI.

## Recommended MVP Release Policy

For the first MVP:

```text
Payment funding: automated after Paystack verification.
Work start: automated after funding.
Naira payment release: buyer confirmation + manual admin approval.
USDC/x402 release: autonomous after deterministic backend checks.
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

Build the deterministic escrow core before adding more AI.

The recommended immediate implementation order:

1. `users`
2. `escrows`
3. `transactions`
4. state transition guard
5. WhatsApp conversation state
6. seller payout onboarding
7. admin manual release approval

This will convert Sivan from a working payment-task prototype into a real escrow coordination product.
