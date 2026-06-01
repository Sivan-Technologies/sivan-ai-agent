# Production Operations Runbooks

These runbooks keep money movement deterministic. Operators should prefer re-checking provider state, logging the decision, and using queue replay over manual database edits.

## Payment Mismatch

1. Open `/admin/reconciliation` and filter for `REVIEW_REQUIRED` or `payment_amount_mismatch`.
2. Use `POST /admin/escrows/:escrowId/recheck-payment` to fetch the latest Paystack transaction state.
3. If the amount is still wrong, keep the escrow in `REVIEW_REQUIRED`, create or update a support case, and ask the buyer for proof.
4. Do not release funds until expected amount, received amount, reference, and payer intent all match.

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

## Payout Failure

1. Confirm the escrow is `PENDING_RELEASE` or `RELEASED` and inspect payout reference/notes.
2. Enqueue `POST /admin/escrows/:escrowId/payout-review`.
3. Verify seller payout account through Paystack before any retry.
4. Use the admin Payout Safety row as the source of truth for amount: gross comes from the escrow record, fees come from platform settings, and seller net payout is the amount to pay.
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
