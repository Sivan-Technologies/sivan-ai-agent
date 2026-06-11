# Monnify Live Test Checklist

Use this checklist before allowing Monnify to process real Sivan escrow payments. Run it first in sandbox, then repeat with live credentials and a low-value real transaction.

## Scope

This checklist covers bank-transfer collection only. Do not test card payments for Sivan.

## Preflight

- [ ] Monnify merchant account is approved for the intended Sivan funds flow.
- [ ] API key, secret key, and contract code are available from the Monnify dashboard.
- [ ] Backend uses sandbox base URL for sandbox tests:

```env
MONNIFY_BASE_URL=https://sandbox.monnify.com
```

- [ ] Backend uses production base URL only for live tests:

```env
MONNIFY_BASE_URL=https://api.monnify.com
```

- [ ] `NAIRA_PAYMENT_METHODS=bank_transfer`.
- [ ] `MONNIFY_PAYMENT_METHODS=bank_transfer` if the legacy Monnify-specific variable is still set.
- [ ] Webhook URL is configured in Monnify dashboard:

```text
https://sivan-escrow-agent.onrender.com/webhooks/monnify
```

- [ ] Operations alerts are active.
- [ ] Admin Reconciliation, Revenue, Events, Support, and Queue tabs are reachable.
- [ ] A rollback plan exists if Monnify has a live incident.

## 1. Authentication

- [ ] Backend can generate a Monnify access token.
- [ ] Token is cached for less than its expiry window.
- [ ] Invalid key/secret fails closed and does not expose credentials in logs.

Expected result:

```text
Provider status: configured
Auth result: success
Secret leakage: none
```

## 2. Transfer-Only Payment Initialization

- [ ] Create a low-value escrow.
- [ ] Confirm Sivan chooses Monnify only when `ACTIVE_PAYMENT_PROVIDER=monnify`.
- [ ] Initialize Monnify transaction with a unique payment reference.
- [ ] Confirm request uses only:

```json
["ACCOUNT_TRANSFER"]
```

- [ ] Confirm Sivan stores `paymentReference`, `transactionReference`, expected amount, currency, and expiry.
- [ ] Confirm buyer receives bank-transfer payment instructions, not card instructions.

Expected result:

```text
Escrow status: PENDING_PAYMENT
Provider: monnify
Payment method: ACCOUNT_TRANSFER
```

## 3. Successful Payment Webhook

- [ ] Pay exact amount by bank transfer.
- [ ] Confirm `SUCCESSFUL_TRANSACTION` webhook arrives.
- [ ] Verify `monnify-signature` using raw request body.
- [ ] Re-query Monnify by payment reference.
- [ ] Confirm exact amount, currency, reference, and `ACCOUNT_TRANSFER`.
- [ ] Move escrow to funded/in-progress state.
- [ ] Write transaction and ledger entries.

Expected result:

```text
Escrow funding verified: yes
Duplicate processing: no
Audit event: payment_verified
```

## 4. Duplicate Webhook Handling

- [ ] Replay the same valid webhook payload.
- [ ] Confirm Sivan records or recognizes the duplicate.
- [ ] Confirm escrow state, ledger, and notifications are not duplicated.

Expected result:

```text
Webhook accepted or ignored idempotently
No duplicate funding transaction
No duplicate ledger entry
```

## 5. Failed Or Rejected Payment

- [ ] Simulate or wait for a rejected/expired/underpaid payment.
- [ ] Confirm Sivan does not mark the escrow funded.
- [ ] Confirm escrow moves to `REVIEW_REQUIRED` when money movement needs operator review.
- [ ] Confirm admin sees reason, expected amount, paid amount, and provider reference.

Expected result:

```text
Escrow status: REVIEW_REQUIRED or PENDING_PAYMENT
Release blocked: yes
Support/reconciliation visibility: yes
```

## 6. Amount Matching

Test all cases:

- [ ] Exact amount paid.
- [ ] Underpayment.
- [ ] Overpayment.
- [ ] Correct amount but wrong/unknown reference.
- [ ] Correct reference but wrong currency/method.

Expected result:

```text
Only exact NGN ACCOUNT_TRANSFER payment for the expected reference can fund escrow
All mismatches stay in review
```

## 7. Settlement Reconciliation

- [ ] Receive or query settlement detail.
- [ ] Match settlement reference to included transaction references.
- [ ] Confirm settlement amount and provider fee are visible in reconciliation/revenue reporting.
- [ ] Confirm settlement delays do not incorrectly block buyer/seller state where the policy says collection verification is enough.

Expected result:

```text
Settlement proof linked
Provider fee visible
Finance export/reconciliation complete
```

## 8. Payout Readiness

- [ ] Seller payout account passes name enquiry.
- [ ] Buyer completes work.
- [ ] Buyer requests release.
- [ ] Admin Payout Safety shows gross amount, platform fee, seller net, masked account, resolved account name, risk level, and payout reference field only.
- [ ] Admin records manual payout reference.

Expected result:

```text
Escrow status: RELEASED only after admin approval
Payout amount cannot be manually overridden
```

## 9. Refund Or Manual Hold

- [ ] Open a dispute before release.
- [ ] Confirm payout is blocked.
- [ ] Record evidence and support notes.
- [ ] Run refund/manual-hold decision through the dispute process.
- [ ] Record provider/bank reference in audit notes.

Expected result:

```text
No automatic payout during dispute
Operator decision visible in audit trail
```

## 10. Backup Provider Drill

- [ ] Set Monnify unavailable in staging or simulate auth/timeout failure.
- [ ] Confirm new payment initialization can fall back to `BACKUP_PAYMENT_PROVIDER=paystack` only if policy allows.
- [ ] Confirm existing Monnify escrows continue using Monnify references for verification and are not mixed with Paystack references.

Expected result:

```text
New payments can use backup provider
Existing payments remain tied to original provider
```

## Go/No-Go Decision

Monnify is ready for controlled pilot only when:

- [ ] all sandbox tests pass
- [ ] one live low-value transfer test passes
- [ ] webhook signature verification is proven
- [ ] duplicate webhook idempotency is proven
- [ ] amount mismatch review is proven
- [ ] admin reconciliation is proven
- [ ] payout remains manual/admin approved
- [ ] operations alerts are active
