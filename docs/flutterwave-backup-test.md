# Flutterwave Backup Test Checklist

Use this checklist before allowing Flutterwave to act as Sivan's emergency Naira collection provider. This is a backup-provider checklist, not a primary launch checklist.

## Scope

This checklist covers bank-transfer collection only.

Do not test or enable:

- card payments
- raw card details
- CVV/PAN collection
- card tokens
- card fallback

## Preflight

- [ ] Flutterwave account is approved for the intended Sivan funds flow.
- [ ] Flutterwave credentials are available in the provider dashboard.
- [ ] Provider agreement permits escrow-like collection, manual release, dispute holds, and delayed payout.
- [ ] Sivan backend has the provider-neutral Naira interface deployed.
- [ ] Admin Platform Controls are reachable.
- [ ] Operations alerts are active.
- [ ] Admin Reconciliation, Revenue, Webhooks, Support, Queue, and Payout Safety tabs are reachable.
- [ ] Rollback plan exists before enabling Flutterwave.

Expected env shape:

```env
NAIRA_PAYMENT_METHODS=bank_transfer
ACTIVE_PAYMENT_PROVIDER=monnify
BACKUP_PAYMENT_PROVIDER=paystack
EMERGENCY_PAYMENT_PROVIDER=flutterwave
PAYMENT_PROVIDER_FALLBACK_ENABLED=false

FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_BASE_URL=https://api.flutterwave.com
FLUTTERWAVE_WEBHOOK_SECRET=
FLUTTERWAVE_WEBHOOK_URL=https://sivan-escrow-agent.onrender.com/webhooks/flutterwave
FLUTTERWAVE_TIMEOUT_MS=8000
FLUTTERWAVE_PAYMENT_METHODS=bank_transfer
FLUTTERWAVE_DYNAMIC_ACCOUNT_EXPIRY_SECONDS=3600
```

## 1. Provider Configuration

- [ ] Flutterwave appears in Admin Platform Controls.
- [ ] Flutterwave shows configured only when required env vars are present.
- [ ] Flutterwave cannot become active unless configured.
- [ ] Fallback remains disabled until this checklist passes.
- [ ] Existing Paystack/Monnify escrows keep their original provider.

Expected result:

```text
Flutterwave role: emergency
Fallback: disabled
Existing escrows: provider unchanged
```

## 2. Payment Initialization

- [ ] Switch test/staging active provider to Flutterwave only after implementation.
- [ ] Create a low-value Naira escrow.
- [ ] Confirm Sivan creates a unique Flutterwave reference.
- [ ] Confirm Sivan creates a dynamic virtual account for the exact amount.
- [ ] Confirm buyer receives bank-transfer instructions only.
- [ ] Confirm no card instruction appears anywhere.
- [ ] Confirm Sivan stores expected amount, currency, reference, provider, and expiry if provided.

Expected result:

```text
Escrow status: PENDING_PAYMENT
Provider: flutterwave
Method: bank_transfer
Card path: absent
```

## 3. Webhook Signature Verification

- [ ] Configure Flutterwave webhook URL:

```text
https://sivan-escrow-agent.onrender.com/webhooks/flutterwave
```

- [ ] Send or receive a valid Flutterwave webhook.
- [ ] Verify webhook signature/hash using configured secret.
- [ ] Reject webhook when signature is missing.
- [ ] Reject webhook when signature is invalid.
- [ ] Persist valid webhook before state processing.

Expected result:

```text
Valid webhook: persisted
Invalid webhook: rejected
Secret leakage: none
```

## 4. Successful Payment Verification

- [ ] Pay exact amount by bank transfer.
- [ ] Confirm Flutterwave webhook arrives.
- [ ] Re-query Flutterwave server-side by charge ID from webhook.
- [ ] Re-query Flutterwave server-side by stored payment reference from admin recheck.
- [ ] Confirm:
  - status is successful/final
  - amount paid equals escrow amount
  - currency is NGN
  - method is bank transfer
  - provider reference belongs to the escrow
- [ ] Move escrow to funded/in-progress state only after server-side verification.
- [ ] Write transaction, ledger, and audit events.

Expected result:

```text
Escrow funding verified: yes
Duplicate funding: no
Ledger entry: funding
```

## 5. Duplicate Webhook Handling

- [ ] Replay the same valid webhook.
- [ ] Confirm Sivan does not create duplicate transactions.
- [ ] Confirm Sivan does not create duplicate funding ledger entries.
- [ ] Confirm participant notifications are not duplicated.

Expected result:

```text
Webhook idempotency: passed
Escrow state: unchanged after replay
```

## 6. Failed Or Rejected Payment

Test:

- [ ] failed payment
- [ ] expired payment
- [ ] rejected payment
- [ ] provider timeout
- [ ] provider `10400` validation error
- [ ] provider `10401` auth error
- [ ] provider `10500` server error

Expected result:

```text
Escrow is not funded
Operator visibility exists
Retry/recheck is queued only when safe
```

## 7. Amount And Reference Matching

Test:

- [ ] exact amount
- [ ] underpayment
- [ ] overpayment
- [ ] correct amount with unknown reference
- [ ] correct reference with wrong amount
- [ ] correct reference with wrong method
- [ ] correct reference with wrong currency

Expected result:

```text
Only exact NGN bank-transfer payment for the expected reference can fund escrow
All mismatches go to review
```

## 8. Settlement Reconciliation

- [ ] Receive or query settlement status.
- [ ] Confirm settlement reference is captured.
- [ ] Confirm settlement amount is captured.
- [ ] Confirm provider fee is captured if Flutterwave reports it.
- [ ] Confirm Revenue tab shows provider settlement summary.
- [ ] Confirm Reconciliation CSV includes provider settlement fields.

Expected result:

```text
Settlement reference: visible
Settlement amount: visible
Provider fee: visible if reported
Finance review: possible without database edits
```

## 9. Payout Readiness

- [ ] Seller payout account is verified before release.
- [ ] Buyer completes escrow.
- [ ] Buyer requests release.
- [ ] Admin Payout Safety shows:
  - escrow amount
  - platform fee
  - seller net payout
  - masked bank
  - resolved account name
  - risk level
  - payout reference field only
- [ ] Admin records manual payout reference.

Expected result:

```text
Manual payout approval: required
Admin amount override: blocked
Escrow status: RELEASED only after approval
```

## 10. Dispute Or Manual Hold

- [ ] Open a dispute before release.
- [ ] Confirm payout is blocked.
- [ ] Record evidence from buyer and seller.
- [ ] Record operator decision.
- [ ] Record refund/release reference after external finance action.

Expected result:

```text
No automatic release during dispute
Support case/audit trail: complete
Provider reference: recorded
```

## 11. Emergency Fallback Drill

- [ ] Simulate Paystack and Monnify unavailable for new payment creation.
- [ ] Enable Flutterwave only for new payment creation.
- [ ] Confirm existing Paystack escrows still verify through Paystack.
- [ ] Confirm existing Monnify escrows still verify through Monnify.
- [ ] Confirm new Flutterwave escrows store `provider=flutterwave`.
- [ ] Disable Flutterwave route after drill if it is not needed for real traffic.

Expected result:

```text
New payment fallback: works
Existing references: not mixed
Rollback: works
```

## Go/No-Go Decision

Flutterwave can be used as emergency backup only when:

- [ ] bank-transfer-only initialization is proven
- [ ] webhook signature verification is proven
- [ ] server-side verification is proven
- [ ] duplicate webhook handling is proven
- [ ] amount/reference mismatch handling is proven
- [ ] settlement visibility is proven
- [ ] manual payout approval still gates release
- [ ] fallback only applies to new payment creation
- [ ] one low-value real backup transaction passes
- [ ] operator rollback is tested

## Current Status

```text
Flutterwave backup readiness: 65%
```

| Area | Status | Notes |
| --- | --- | --- |
| Backup role | ✅ Defined | Emergency provider only |
| Checklist | ✅ Created | This file is the go/no-go checklist |
| Env shape | ✅ Documented | Keep secrets out of source control |
| Backend adapter | ✅ Implemented | Dynamic virtual account collection, bank-transfer only |
| Webhook endpoint | ✅ Implemented | `/webhooks/flutterwave` fail-closes without a valid signature |
| Server-side verification | ✅ Implemented | Webhook path rechecks charge ID; admin recheck uses stored payment reference |
| Live test | 🔴 Not started | Do not enable for users before this passes |
