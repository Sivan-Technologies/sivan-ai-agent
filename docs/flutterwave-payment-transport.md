# Flutterwave Backup Payment Transport

This document defines how Flutterwave should fit into Sivan without changing the escrow product. Flutterwave is an emergency Naira collection transport, not the escrow engine.

Sivan remains bank-transfer only. Do not add card collection, card charge, PAN handling, CVV handling, card token storage, or card fallback flows.

## Current Implementation State

Flutterwave is implemented as an emergency bank-transfer collection adapter. It is not enabled for real users until the backup checklist passes with a low-value transfer and signed webhook proof.

Current status:

- ✅ Provider-neutral Naira interface exists for Paystack and Monnify.
- ✅ Admin Platform Controls can list `flutterwave` as the emergency provider.
- ✅ Existing escrows keep the provider that created their payment reference.
- ✅ Global `NAIRA_PAYMENT_METHODS=bank_transfer` policy exists.
- ✅ Flutterwave collection adapter creates dynamic virtual bank accounts.
- ✅ Flutterwave webhook endpoint verifies the configured provider signature value.
- ✅ Flutterwave server-side verification rechecks charges before funding an escrow.
- 🔴 Flutterwave settlement reconciliation is not implemented.
- 🔴 Flutterwave live backup test has not run.

## Target Role

Flutterwave should be used only as backup continuity when preferred providers are unavailable or delayed:

```text
Normal pilot order:
1. Monnify
2. Paystack
3. PalmPay
4. Flutterwave emergency backup
```

The target flow is:

```text
WhatsApp command
  -> Sivan escrow engine
  -> EMERGENCY_PAYMENT_PROVIDER=flutterwave
  -> Flutterwave bank-transfer payment instruction
  -> Flutterwave webhook
  -> Sivan verifies transaction server-side
  -> escrow moves to FUNDED/IN_PROGRESS only after exact match
```

Do not route an existing Paystack or Monnify escrow through Flutterwave after a payment reference already exists. Provider switching is only for new payment creation.

## Required Environment Variables

Add these only when implementing or staging Flutterwave:

```env
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_BASE_URL=https://api.flutterwave.com
FLUTTERWAVE_WEBHOOK_SECRET=
FLUTTERWAVE_WEBHOOK_URL=https://sivan-escrow-agent.onrender.com/webhooks/flutterwave
FLUTTERWAVE_TIMEOUT_MS=8000
FLUTTERWAVE_PAYMENT_METHODS=bank_transfer
FLUTTERWAVE_DYNAMIC_ACCOUNT_EXPIRY_SECONDS=3600
```

Shared provider controls:

```env
NAIRA_PAYMENT_METHODS=bank_transfer
ACTIVE_PAYMENT_PROVIDER=monnify
BACKUP_PAYMENT_PROVIDER=paystack
EMERGENCY_PAYMENT_PROVIDER=flutterwave
PAYMENT_PROVIDER_FALLBACK_ENABLED=false
```

Keep fallback disabled until the active and backup providers have passed live transfer tests. Flutterwave should not be enabled for normal traffic until its backup checklist passes.

## Transport Contract

Flutterwave must plug into the same provider-neutral interface:

```text
initializeBankTransferPayment
verifyPayment
verifyWebhookSignature
normalizeWebhook
```

The adapter must normalize Flutterwave responses into Sivan events:

| Sivan event | Required behavior |
| --- | --- |
| `PAYMENT_PENDING` | Bank-transfer instruction created for exact escrow amount |
| `PAYMENT_VERIFIED` | Server-side verification confirms exact successful NGN transfer |
| `PAYMENT_REJECTED` | Underpayment, expired, failed, rejected, unknown reference, or non-transfer method |
| `SETTLEMENT_PENDING` | Provider collected funds but settlement is not yet reconciled |
| `SETTLEMENT_RECEIVED` | Settlement reference and amount are visible in Revenue/Reconciliation |
| `PAYOUT_READY` | Escrow passes Sivan readiness checks and manual payout approval can happen |
| `PAYOUT_FAILED` | Future payout automation failed or reversed; open operator review |

## Collection Rules

Flutterwave collection behavior:

1. Create a unique provider payment reference for each escrow.
2. Create a Flutterwave customer object for the payment session.
3. Create a dynamic virtual account for the exact escrow amount.
3. Store:
   - `provider=flutterwave`
   - Sivan escrow ID
   - Flutterwave payment reference
   - Flutterwave transaction ID/reference
   - expected amount
   - currency
   - transfer account or payment instruction details
   - expiry time if provided
4. Send only bank-transfer instructions to the buyer.
5. Never show card instructions in WhatsApp, admin, or API responses.
6. Never mark an escrow funded from a redirect/callback alone.
7. Always verify server-side before funding.

Funding is valid only when:

- provider is `flutterwave`
- reference maps to exactly one escrow
- status is successful/final
- currency is `NGN`
- amount paid matches escrow amount exactly
- payment method is bank transfer
- server-side verification confirms the webhook result

## Webhook Rules

Future endpoint:

```text
POST /webhooks/flutterwave
```

Rules:

- Verify Flutterwave webhook signature/hash using `FLUTTERWAVE_WEBHOOK_SECRET`.
- Reject invalid signatures.
- Persist every valid webhook event before processing.
- Handle duplicate webhook delivery idempotently.
- Re-query Flutterwave before changing escrow state.
- Put ambiguous provider states into `REVIEW_REQUIRED`.
- Do not mix Flutterwave references with Paystack or Monnify verification.

Supported event mapping should be:

| Flutterwave result | Sivan action |
| --- | --- |
| Successful transfer payment | Re-query provider, exact-match amount/currency/method/reference, then mark funded |
| Failed payment | Keep pending or move to review depending on money movement evidence |
| Duplicate reference | Do not create duplicate ledger entries |
| Underpayment | `REVIEW_REQUIRED`; operator decides top-up/refund path |
| Overpayment | `REVIEW_REQUIRED`; finance reconciliation before release |
| Settlement event | Attach settlement reference, settlement amount, and provider fee if available |
| Reversed/chargeback-like event | Freeze release path and open urgent support case |

## Error Handling Policy

The pasted Flutterwave error material shows structured errors with:

```json
{
  "status": "failed",
  "error": {
    "type": "REQUEST_NOT_VALID",
    "code": "10400",
    "message": "Request is not valid"
  }
}
```

Sivan handling:

| Flutterwave error family | Sivan response |
| --- | --- |
| `10400 REQUEST_NOT_VALID` | Adapter bug or malformed request; alert ops and do not create payment |
| `10401 UNAUTHORIZED` | Provider unavailable; do not retry blindly; use backup/emergency policy for new payments |
| `10403 FORBIDDEN` | Provider configuration or approval issue; disable Flutterwave route |
| `10404 RESOURCE_NOT_FOUND` | Treat reference as not verified; keep escrow pending/review |
| `10409 RESOURCE_CONFLICT` / duplicate reference | Generate a new reference for new payment creation; never reuse old references |
| `10422 UNPROCESSABLE` | Validate request payload and keep escrow pending |
| `10500 INTERNAL_SERVER_ERROR` | Enqueue re-query/retry; do not mark funded |
| Charge/payment failed codes | Keep escrow pending or review; never release funds |
| Finalized charge/update-not-allowed codes | Re-query final state and reconcile before any state change |

## Admin Position

Admin Platform Controls should show Flutterwave as:

```text
Provider: Flutterwave
Role: emergency
Implemented: yes
Configured: no until envs exist
Payment method: bank_transfer only
Live proof: not passed
```

When implemented, admins may choose Flutterwave only if:

- env credentials are configured
- bank-transfer-only policy is active
- webhook verification test passes
- backup checklist passes
- fallback is explicitly enabled

## Disbursement/Payout Position

Do not implement automated Flutterwave payout for the MVP.

Sivan payout remains:

```text
buyer completes
buyer requests release
admin checks payout safety
admin pays manually or through provider dashboard
admin records payout reference only
```

Automated Flutterwave payout can be evaluated later only after:

- manual payout pilot is stable
- duplicate payout prevention is proven
- provider balance/settlement reports are reconciled
- maker-checker approval exists
- failed/reversed payout handling is tested

## Current Progress

```text
Flutterwave backup transport progress: 65%
```

| Area | Status | Notes |
| --- | --- | --- |
| Strategy role | ✅ Defined | Emergency backup provider only |
| Bank-transfer-only policy | ✅ Defined | Uses global `NAIRA_PAYMENT_METHODS=bank_transfer` |
| Env placeholders | ✅ Documented | Do not add live secrets to source control |
| Adapter implementation | ✅ Implemented | `FlutterwavePaymentProvider` creates dynamic virtual accounts |
| Webhook endpoint | ✅ Implemented | `POST /webhooks/flutterwave` verifies signature and persists events |
| Server-side verification | ✅ Implemented | Rechecks charge status, amount, currency, method, and reference before funding |
| Settlement reconciliation | 🔴 Not started | Must feed Revenue/Reconciliation analytics |
| Live backup test | 🔴 Not started | Use `docs/flutterwave-backup-test.md` before enabling |

## Recommendation

Do not enable Flutterwave for real users before Monnify live proof unless Paystack and Monnify are both blocked operationally.

Best next order:

1. Finish Monnify live sandbox test.
2. Configure Flutterwave sandbox env only in staging.
3. Run Flutterwave backup test with a low-value transaction.
4. Add settlement reconciliation if Flutterwave becomes operationally useful.
5. Keep Flutterwave as emergency route until pricing and reliability are proven.
