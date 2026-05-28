# Sivan WhatsApp Escrow MVP Flow

This document defines the recommended MVP architecture for Sivan as a WhatsApp-first escrow coordination system.

For the phased autonomy model and completion matrix, see `docs/autonomous-escrow-roadmap.md`.

The key product shift is important:

Sivan should not be a random bank-transfer bot. Sivan should be an escrow coordination layer, payment verification layer, and settlement orchestration layer.

The real product value is not only payment collection. It is coordinating trust between buyer and seller through clear transaction states, payment verification, release control, payout tracking, and audit history.

## Core Principle

Never collect sensitive information inside WhatsApp groups.

Groups are only for:

- escrow discovery
- escrow initiation
- public visibility that an escrow was requested

Private one-to-one chat is used for:

- profile setup
- payout details
- payment links
- release confirmation
- disputes
- identity and account setup

This protects users and keeps the system operationally clean.

## High-Level Architecture

```text
WhatsApp group
  -> Sivan detects escrow intent
  -> Bot moves users to private DM
  -> Buyer and seller profile setup
  -> Escrow record created
  -> Paystack transfer payment initialized
  -> Escrow funded by buyer
  -> Seller delivers outside Sivan
  -> Buyer releases or disputes
  -> Admin/manual approval for MVP payout
  -> Settlement completed
```

## Current MVP Payment Direction

For the Naira MVP, Sivan should use Paystack's transfer payment flow rather than giving users a permanent business bank account directly.

Recommended flow:

```text
Escrow created
  -> Paystack payment initialized
  -> Unique payment reference generated
  -> Buyer pays by transfer through Paystack instructions/link
  -> Paystack webhook confirms payment
  -> Sivan verifies signature, reference, amount, and status
  -> Escrow marked FUNDED
```

Paystack does not literally become the escrow bank account. Paystack is the payment collection and verification rail. Sivan remains the coordination and state-management layer.

This is better than giving one permanent business account directly because:

- reconciliation is cleaner
- every escrow has a unique reference
- webhook automation is possible
- accounting is less confusing
- disputes and audit history are easier to trace

## User Roles

Every escrow must have two attached parties:

| Role | Meaning |
| --- | --- |
| Buyer | The payer who funds escrow |
| Seller | The recipient who will eventually receive payout |

No transaction should move to funding or release without both parties attached.

## Recommended User Model

Every Sivan user should eventually have:

| Field | Purpose |
| --- | --- |
| `id` | Internal user identifier |
| `whatsapp_number` | Primary identity |
| `first_name` | Profile |
| `last_name` | Profile |
| `role_history` | Buyer/seller usage history |
| `bank_name` | Payout destination |
| `account_number` | Payout destination |
| `account_name` | Payout confirmation |
| `paystack_recipient_code` | Future Paystack transfer recipient |
| `privy_wallet` | Future crypto identity |
| `created_at` | Audit |
| `updated_at` | Audit |

Payout details should be collected during onboarding or seller setup, not at release time.

## Recommended Escrow Model

| Field | Purpose |
| --- | --- |
| `id` | Internal escrow identifier |
| `escrow_code` | Human-readable ID, for example `SIV-10291` |
| `buyer_id` | Buyer user ID |
| `seller_id` | Seller user ID |
| `amount` | Escrow amount |
| `currency` | `NGN`, `USDC`, etc. |
| `status` | Escrow state |
| `description` | What the transaction is for |
| `paystack_reference` | Funding payment reference |
| `created_at` | Audit |
| `updated_at` | Audit |

## Recommended Transaction Model

| Field | Purpose |
| --- | --- |
| `id` | Internal transaction identifier |
| `escrow_id` | Linked escrow |
| `paystack_reference` | Paystack payment reference |
| `payment_status` | Funding status |
| `transfer_status` | Payout status |
| `transfer_reference` | Future Paystack transfer reference |
| `webhook_logs` | Stored webhook events |
| `created_at` | Audit |
| `updated_at` | Audit |

## Escrow States

These states should become the operational backbone of Sivan:

| State | Meaning |
| --- | --- |
| `CREATED` | Escrow initialized but not ready for payment |
| `PENDING_PROFILE` | One or both users still need onboarding |
| `PENDING_PAYMENT` | Waiting for buyer funding |
| `FUNDED` | Payment verified and escrow funded |
| `IN_PROGRESS` | Seller can proceed with delivery |
| `COMPLETED` | Buyer approved completion |
| `PENDING_RELEASE` | Release requested, awaiting admin/manual approval |
| `RELEASED` | Payout sent to seller |
| `DISPUTED` | Under review |
| `FAILED` | Payment or processing problem |
| `CANCELLED` | Escrow cancelled before completion |

For the MVP, do not jump directly from `COMPLETED` to automatic payout. Use `PENDING_RELEASE` and manual admin approval first.

## Recommended Conversation Flow

### Phase 1: Group Discovery

Inside a WhatsApp group, a user says:

```text
Create escrow for 10000 naira
```

or:

```text
@Sivan create escrow
```

Sivan replies in the group:

```text
Secure escrow request detected.
Please continue setup in private chat with Sivan.
Do not share payment, bank, or personal details in the group.
```

### Phase 2: Private Buyer Onboarding

Sivan opens or continues a private DM with the initiating user.

If the user profile does not exist:

```text
Welcome to Sivan.
Before using escrow, please complete your secure profile setup.
What is your first name?
```

Then:

```text
What is your last name?
```

If the user may act as a seller later:

```text
How would you like to receive payouts?
Please provide your bank name and account number.
```

Later, the backend should validate bank details with Paystack account resolution before storing a payout recipient.

### Phase 3: Counterparty Setup

Sivan asks:

```text
Who is the seller?
Please share their WhatsApp number.
```

Or, in future group mode, Sivan can detect a tagged user.

Sivan then messages the second party privately:

```text
You have been invited to a protected escrow transaction on Sivan.
Complete your profile setup to continue.
```

The seller completes:

- first name
- last name
- payout bank details

### Phase 4: Escrow Creation

Once both users are attached and required profile information exists, the backend creates:

```text
Escrow ID: SIV-10291
Buyer: User A
Seller: User B
Amount: NGN 10000
Status: PENDING_PAYMENT
```

### Phase 5: Payment Initialization

Sivan initializes Paystack payment collection.

The backend creates:

- Paystack reference
- transfer-only checkout/payment link
- escrow transaction record

Sivan sends the buyer:

```text
Escrow created successfully.
Amount: NGN 10000
Reference: SIV-10291
Complete payment using the secure transfer link below.
```

### Phase 6: Payment Confirmation

The buyer pays through Paystack's transfer instructions.

Paystack sends a webhook to:

```text
POST /webhooks/paystack
```

The backend verifies:

- webhook signature
- payment reference
- transaction amount
- transaction status
- matching escrow record

Then Sivan updates:

```text
Status: FUNDED
```

Both parties are notified:

```text
Escrow funded successfully.
Seller may now proceed with delivery.
```

### Phase 7: Work Delivery

The seller delivers the work outside Sivan.

Sivan tracks only:

- transaction state
- messages/events needed for audit
- release/dispute decisions

### Phase 8: Release Flow

Buyer says:

```text
Release payment
```

Sivan confirms:

```text
Are you sure you want to release NGN 10000 to the seller?
Reply YES to confirm.
```

For MVP:

```text
Status: PENDING_RELEASE
```

An admin reviews and manually approves payout.

After approval, payout can be processed through Paystack transfer APIs or manually, depending on operational maturity.

Then:

```text
Status: RELEASED
```

Seller is notified:

```text
Payment has been released successfully.
```

## Dispute Flow

Buyer or seller can say:

```text
Dispute transaction
```

Sivan updates:

```text
Status: DISPUTED
```

Admin panel should handle:

- manual review
- evidence collection
- timeline of payment and messages
- settlement decision
- final release or refund action

Dispute AI should come later. The MVP should first preserve clean states and evidence.

## MVP Rules

1. Groups are only for discovery, initiation, and visibility.
2. Private DM handles onboarding, payout details, payment links, disputes, identity, and release confirmation.
3. All users must onboard before participating in settlement.
4. Seller payout destination must be collected before release.
5. Never ask for payout details at the moment of release.
6. Every escrow must have a transaction ID, buyer, seller, amount, reference, state, and audit history.
7. MVP payouts should require manual admin approval.
8. Do not fully automate release until reconciliation, fraud handling, and dispute workflows are mature.

## Future Privy And Crypto Flow

Later, users can connect:

- Privy embedded wallet
- Solana wallet
- USDC payout address

This enables hybrid fiat and crypto settlement:

```text
Naira buyer funding
  -> Paystack verification
  -> seller payout to bank
```

or:

```text
USDC buyer funding
  -> x402/SAP verification
  -> seller payout to wallet
```

The current architecture should keep this path open, but not force crypto into the first user experience.

## Implementation Roadmap From Current Code

The current code already has:

- authenticated `/api/tasks`
- Paystack transfer-only initialization
- Paystack webhook verification
- workflow persistence
- admin endpoints
- WhatsApp bot bridge
- notification callback

Current engineering status:

1. ✅ Add first-class `users` table.
2. ✅ Add first-class `escrows` table separate from task records.
3. ✅ Add transaction state machine with the states listed above.
4. ✅ Add private DM conversation state in the WhatsApp bot.
5. ✅ Add seller onboarding and payout-account capture.
6. ✅ Add Paystack bank/account resolution.
7. ✅ Add explicit buyer completion before release.
8. ✅ Add `PENDING_RELEASE` admin approval flow.
9. ✅ Add manual payout tracking before automated Paystack transfers.
10. 🟡 Add dispute state and admin evidence collection.
11. ✅ Add audit log for every state transition.
12. 🟡 Continue production hardening: smoke checks, monitoring, alert routing, and live x402/SAP verification.

## Product Positioning

Sivan is a trust utility for mobile commerce.

Its strongest MVP promise is:

```text
Create an escrow in WhatsApp.
Fund it by transfer.
Release only when the buyer approves.
Keep payment and payout details private.
Track every state in the backend.
```
