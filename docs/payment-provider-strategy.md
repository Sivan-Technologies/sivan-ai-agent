# Payment Provider Strategy

Sivan should treat every payment company as a transport, not as the escrow engine. The backend should keep one escrow state machine and receive normalized provider events, whether the payment came from Paystack, Monnify, PalmPay, or Flutterwave.

## Provider Order

Recommended pilot order:

1. Monnify
2. Paystack
3. PalmPay
4. Flutterwave as emergency backup

Flutterwave can remain available for emergency continuity, but it should not become the first-choice pilot rail if its fees are materially higher.

## Transport Selection

Target environment shape:

```env
ACTIVE_PAYMENT_PROVIDER=monnify
BACKUP_PAYMENT_PROVIDER=paystack
EMERGENCY_PAYMENT_PROVIDER=flutterwave
```

The escrow engine should not branch on provider-specific concepts. Provider clients should normalize raw responses and webhooks into internal events:

| Internal event | Meaning |
| --- | --- |
| `PAYMENT_PENDING` | A payment instruction has been created and the buyer can pay |
| `PAYMENT_VERIFIED` | Provider confirmed exact successful payment for the expected escrow amount |
| `PAYMENT_REJECTED` | Provider reported underpayment, invalid payment, expired payment, or rejected payment |
| `SETTLEMENT_PENDING` | Provider has collected funds but settlement to Sivan wallet/bank is not yet final |
| `SETTLEMENT_RECEIVED` | Provider settlement has landed and can be reconciled |
| `PAYOUT_READY` | Escrow is eligible for manual/admin payout processing |
| `PAYOUT_PENDING` | Payout/disbursement has been initiated but final status is not known |
| `PAYOUT_SUCCEEDED` | Payout/disbursement has succeeded |
| `PAYOUT_FAILED` | Payout/disbursement failed or reversed and needs operator review |

## Bank Transfer Only

Sivan's Naira MVP should accept bank transfer only. Provider payloads must restrict payment methods to transfer rails where supported:

```json
{
  "paymentMethods": ["ACCOUNT_TRANSFER"]
}
```

Do not add card collection, card charge, PAN handling, CVV handling, or card-token storage to Sivan. If a provider's documentation includes card examples, ignore those examples for Sivan's build.

## Test Checklist Files

Each provider should get its own live-test checklist before pilot use:

- `docs/monnify-live-test.md`
- `docs/paystack-live-test.md`
- `docs/palmpay-live-test.md`
- `docs/flutterwave-backup-test.md`

Every checklist should prove:

- payment initialization
- transfer-only payment instruction
- webhook received
- webhook signature/hash validation
- duplicate webhook idempotency
- failed/rejected payment handling
- amount and currency matching
- settlement status/reconciliation
- payout readiness
- refund/manual hold case
- admin review and audit trail

## Current Status

Paystack is the currently proven Naira collection rail. It runs behind `PaymentProvider.initializeBankTransferPayment`, `verifyPayment`, `verifyWebhookSignature`, and `normalizeWebhook`, and live behavior remains Paystack bank-transfer only until another provider passes live testing.

Monnify is now implemented as a provider-neutral Naira collection adapter. The backend can authenticate with Monnify, initialize a transaction, generate a bank-transfer payment instruction, verify payments by `paymentReference`, validate `monnify-signature` over the raw webhook body, persist webhook events, and re-query Monnify before funding an escrow. Build, automated tests, deployed smoke checks, DR checks, admin-page session smoke, Monnify sandbox initialization, paid sandbox transfer verification, and fail-closed webhook reachability checks passed on 2026-06-11. Monnify is not yet live-enabled for users because signed provider webhook delivery into deployed Sivan still needs to be proven.

Flutterwave is implemented as an emergency backup collection adapter using dynamic virtual accounts for bank transfer only. The backend can create a Flutterwave virtual account, persist `provider=flutterwave`, verify signed `charge.completed` webhooks, re-query Flutterwave by charge ID before funding, and support admin recheck by the stored payment reference. Do not enable Flutterwave for users until the backup checklist passes with a low-value transfer and signed webhook proof. Do not use Flutterwave for card payments.

## Progress

```text
Provider-neutral Naira interface: 82%
Paystack behind provider interface: 100%
Monnify collection transport: 92%
Payment-provider admin switching: 90%
Flutterwave backup transport: 65%
Provider live-test readiness: 75%
Monnify sandbox initialization proof: 100%
Monnify paid-transfer verification proof: 100%
Monnify signed webhook proof: 0%
Monnify live-readiness proof: 75%
Flutterwave live backup proof: 0%
```

| Area | Status | Notes |
| --- | --- | --- |
| Provider-neutral interface | ✅ Done | `PaymentProvider`, `initializeBankTransferPayment`, `verifyPayment`, `verifyWebhookSignature`, and `normalizeWebhook` exist |
| Paystack adapter | ✅ Done | Paystack now runs behind the provider interface and remains bank-transfer only |
| Provider ID on escrow/transactions | ✅ Done | Escrows already store `payment_provider`; transactions/ledger now use the active provider name |
| Bank-transfer-only guard | ✅ Done | Global `NAIRA_PAYMENT_METHODS=bank_transfer` policy is enforced across implemented Naira providers; provider-specific aliases must also resolve to bank transfer |
| Monnify name enquiry fallback | ✅ Done for payout verification fallback | Existing `MonnifyClient` can validate account name when configured |
| Monnify collection initialization | ✅ Implemented / paid sandbox proof passed | Monnify adapter initializes transfer-only transactions and stores transfer instruction metadata; sandbox auth/init/verify-pending and paid transfer verification passed on 2026-06-11 |
| Monnify webhook endpoint | ✅ Implemented / signed payment proof pending | `POST /webhooks/monnify` verifies raw-body HMAC, persists events, handles duplicates, and re-queries before funding; deployed route rejected unsigned payload on 2026-06-11 |
| Provider-aware recovery/recheck | ✅ Done | Admin recheck and retry jobs verify through each escrow's stored `paymentProvider` |
| Admin provider/settings controls | ✅ Implemented / smoke verified | DB-backed provider routing, platform mode, maintenance message, and bank-transfer-only policy controls exist in admin Platform Controls with audit history; deployed admin-page smoke passed on 2026-06-11 |
| Monnify settlement events | ✅ Implemented / live proof pending | `SETTLEMENT` webhooks are persisted, linked to matching escrows, and surfaced in Revenue/Reconciliation analytics; live settlement proof remains next |
| Flutterwave backup transport | 🟡 Implemented / live proof pending | Dynamic virtual account adapter, signed webhook endpoint, server-side charge verification, and admin provider visibility exist; low-value backup transfer proof and settlement reconciliation remain next |
| PalmPay transport | 🔴 Not started | Keep as future backup/provider adapter |
