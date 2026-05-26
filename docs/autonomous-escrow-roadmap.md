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
| `FUNDED` | `IN_PROGRESS` | Seller is notified to proceed |
| `IN_PROGRESS` | `COMPLETED` | Buyer confirms work is complete |
| `COMPLETED` | `PENDING_RELEASE` | Buyer confirms release intent |
| `PENDING_RELEASE` | `RELEASED` | Admin approves payout in MVP |
| Any active state | `DISPUTED` | Buyer or seller raises dispute |
| Any pre-release state | `CANCELLED` | Admin or allowed cancellation rule applies |
| Any state | `FAILED` | Payment, webhook, or workflow failure occurs |

## Phase Completion Matrix

| Phase | Goal | Status | Notes |
| --- | --- | --- | --- |
| Phase 0 | Core backend/API foundation | Completed | Express API, config, persistence, tests, admin endpoints exist |
| Phase 1 | Paystack transfer-only payment verification | Mostly completed | Transfer-only initialization, webhook verification, reference matching, idempotency are implemented; Render Paystack env still needs final validation |
| Phase 2 | WhatsApp bot bridge | Mostly completed | Twilio auth works, outbound messages work, webhook route exists; conversational state is still simple |
| Phase 3 | First-class users | Not started | Need `users` table and profile onboarding |
| Phase 4 | First-class escrows | Not started | Need `escrows` table separate from task records |
| Phase 5 | Transaction state machine | Not started | Need canonical states and transition guards |
| Phase 6 | Private DM onboarding | Not started | Need conversation sessions and profile collection |
| Phase 7 | Seller payout setup | Not started | Need payout details, Paystack bank resolution, payout recipient storage |
| Phase 8 | Manual release approval | Not started | Need `PENDING_RELEASE`, admin approve/reject, audit trail |
| Phase 9 | Dispute workflow | Not started | Need dispute state, evidence capture, admin resolution |
| Phase 10 | Smart autonomy | Future | Auto-release only for low-risk transactions after rule checks |
| Phase 11 | SAP/x402/USDC production settlement | Future | SDK and config are partially wired; requires real credentials and live testing |

## What Is Completed So Far

The current system already has:

- backend health and readiness endpoints
- authenticated task creation with `CORE_API_SECRET`
- protected admin endpoints with `ADMIN_API_KEY`
- request validation with Zod
- Paystack transfer-only checkout configuration
- Paystack transaction reference storage
- Paystack webhook signature verification
- Paystack transaction verification before Naira execution
- webhook persistence
- idempotency guard against repeated webhook execution
- WhatsApp notification callback
- Twilio webhook signature validation in the bot
- outbound WhatsApp message testing
- Render deployment for backend and bot
- admin dashboard foundation
- documentation for WhatsApp escrow MVP flow

## What Should Be Built Next

The next major engineering work should not be dispute AI yet.

The next work should be deterministic settlement infrastructure:

1. Add `users` table.
2. Add `escrows` table.
3. Add `transactions` table.
4. Add escrow state machine.
5. Add audit log for every state transition.
6. Add WhatsApp private-DM conversation sessions.
7. Add seller onboarding and payout account capture.
8. Add Paystack bank/account verification.
9. Add `PENDING_RELEASE` state.
10. Add admin manual release approval.

Only after these are solid should Sivan add autonomous release rules or dispute AI.

## Recommended MVP Release Policy

For the first MVP:

```text
Payment funding: automated after Paystack verification.
Work start: automated after funding.
Payment release: buyer confirmation + manual admin approval.
Disputes: manual admin review.
```

This creates enough automation to prove the product while avoiding dangerous uncontrolled payout automation.

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

