# Production Operations Runbooks

These runbooks keep money movement deterministic. Operators should prefer re-checking provider state, logging the decision, and using queue replay over manual database edits.

## Payment Mismatch

1. Open `/admin/reconciliation` and filter for `REVIEW_REQUIRED` or `payment_amount_mismatch`.
2. Use `POST /admin/escrows/:escrowId/recheck-payment` to fetch the latest Paystack transaction state.
3. If the amount is still wrong, keep the escrow in `REVIEW_REQUIRED`, create or update a support case, and ask the buyer for proof.
4. Do not release funds until expected amount, received amount, reference, and payer intent all match.

## Daily Provider Reconciliation

This is the finance-control loop: compare what Sivan believes against what payment providers report.

1. Keep `RECONCILIATION_WORKER_ENABLED=true` in production once provider credentials and ops alerting are configured.
2. Inspect run history at `/admin/reconciliation/runs`.
3. Inspect a specific run at `/admin/reconciliation/runs/:runId`; review `findings` before approving disputed releases.
4. Trigger a manual run after a payment incident:

```json
POST /admin/reconciliation/run
{
  "providers": ["palmpay"],
  "windowStart": "2026-06-25T00:00:00.000Z",
  "windowEnd": "2026-06-26T00:00:00.000Z",
  "alertOnFindings": true
}
```

5. Treat `missing_in_sivan`, `amount_drift`, `currency_drift`, and success-status drift as release blockers until finance resolves them.
6. Paystack and Flutterwave support bulk transaction pulls in code. PalmPay queries every Sivan-known PalmPay order reference through PalmPay `queryStatus`, so PalmPay amount/currency/status drift is covered for Sivan-created orders. Add a PalmPay settlement/report export before relying on PalmPay for full `missing_in_sivan` detection. Monnify currently re-verifies Sivan-created local references until its provider settlement/report endpoint is configured.
7. High/critical findings create a support case automatically. Do not close it until the provider record, Sivan transaction row, ledger entry, and escrow status agree.

## Wrong Amount

1. Confirm the Paystack reference belongs to the escrow.
2. Record an internal support note with expected amount, received amount, and provider reference.
3. If buyer underpaid, request top-up through a new escrow/payment flow.
4. If buyer overpaid, keep the escrow in review and reconcile the excess through your finance process before release.

## Missing Webhook

1. Use `/admin/webhooks?limit=100` to confirm no matching event arrived.
2. Run `POST /admin/escrows/:escrowId/recheck-payment`.
3. If provider verification fails due to a transient issue, enqueue a recovery job:

```json
{
  "jobType": "paystack_recheck",
  "payload": { "escrowId": "SIV-...", "paymentReference": "..." },
  "maxAttempts": 8
}
```

4. Run `POST /admin/queue/run` or wait for `QUEUE_WORKER_ENABLED=true`.

## Monnify Payment Incident

This applies when the active or backup Naira provider is set to Monnify. Current proven production Naira collection still uses Paystack until the Monnify live checklist passes.

1. Confirm whether the affected escrow was created with provider `monnify`; never verify a Monnify reference through Paystack or a Paystack reference through Monnify.
2. Check the Monnify payment reference, transaction reference, expected amount, currency, and payment method.
3. Re-query Monnify server-side before changing escrow state.
4. If the payment method is not `ACCOUNT_TRANSFER`, keep the escrow in review.
5. If the amount is underpaid, overpaid, rejected, or ambiguous, move or keep the escrow in `REVIEW_REQUIRED`.
6. If `monnify-signature` verification fails, reject the webhook and alert operations.
7. If Monnify is unavailable for new payments, switch only new payment creation to the configured backup provider. Existing Monnify escrows must keep using Monnify references for verification.

## Payout Failure

1. Confirm the escrow is `PENDING_RELEASE` or `RELEASED` and inspect payout reference/notes.
2. Enqueue `POST /admin/escrows/:escrowId/payout-review`.
3. Verify seller payout account through Paystack before any retry.
4. Use the admin Payout Safety row as the source of truth for amount: escrow amount comes from the escrow record, buyer-paid fees come from platform settings, buyer total funding is escrow amount plus fee, and seller net payout is the escrow amount to pay.
5. Admin records only the Paystack/bank payout reference. Do not manually override the payout amount in Sivan.
6. If a transfer may already have succeeded, do not retry payout until provider reconciliation confirms no duplicate movement.

## Stuck Escrow

1. Check `/admin/ops/status` and review `stuckEscrows.samples`.
2. Open `/admin/escrows/:escrowId/events` for the full timeline, transactions, and linked support cases.
3. If payment state is stale, run payment re-check or enqueue `paystack_recheck`.
4. If the user action is missing, create or update a support case and contact the buyer/seller.

## User Cancellation

1. Confirm escrow status and whether any payment has been received.
2. If unfunded, mark cancellation through the product/admin flow when available and add a support note.
3. If funded, keep the escrow in review until refund/release policy is decided and recorded.

## Double Webhook

1. Confirm duplicate provider references in `/admin/webhooks`.
2. Check escrow events; repeated webhooks should not duplicate release or task execution.
3. If state changed twice, stop automation, create an urgent support case, and reconcile provider/accounting state before further action.

## Refund Situation

1. Create a high-priority support case linked to the escrow.
2. Record buyer/seller agreement, payment reference, amount, and reason.
3. Verify no payout has already been completed.
4. Execute refund only through the approved finance/provider workflow and record the reference in support notes and escrow events.

## Queue Recovery

1. Check `/admin/queue/status` for `failed` and `dead` counts.
2. Inspect `/admin/queue/jobs/:jobId`.
3. Use `/admin/queue/jobs/:jobId/retry` with `resetAttempts=true` only after the root cause is fixed.
4. Run `/admin/queue/run` for immediate recovery, or rely on the background worker in production.

## Sentry Verification

1. Confirm `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, and `SENTRY_RELEASE` are set on the deployed service.
2. Temporarily set `SENTRY_DEBUG_ENDPOINT_ENABLED=true`.
3. Deploy, then call `GET /debug-sentry` on the backend or WhatsApp bot service.
4. Confirm the error, log, metric, and trace arrive in Sentry.
5. Immediately set `SENTRY_DEBUG_ENDPOINT_ENABLED=false` and redeploy.
6. Do not enable `SENTRY_SEND_DEFAULT_PII` unless privacy/compliance requirements have been reviewed.
