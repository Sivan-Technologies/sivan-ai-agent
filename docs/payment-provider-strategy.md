# Payment Provider Strategy

Sivan should treat every payment company as a transport, not as the escrow engine. The backend should keep one escrow state machine and receive normalized provider events, whether the payment came from Paystack, Monnify, PalmPay, or Flutterwave.

## Provider Order

Recommended pilot order:

1. PalmPay
2. Flutterwave as emergency backup
3. Monnify after approval
4. OPay when approved/available

Flutterwave can remain available for emergency continuity, but it should not become the first-choice pilot rail if its fees are materially higher.

## Transport Selection

Target environment shape:

```env
ACTIVE_PAYMENT_PROVIDER=palmpay
BACKUP_PAYMENT_PROVIDER=flutterwave
EMERGENCY_PAYMENT_PROVIDER=flutterwave
ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer
PALMPAY_PAYOUT_ENABLED=false
```

The escrow engine should not branch on provider-specific concepts. Provider clients should normalize raw responses and webhooks into internal events:

| Internal event | Meaning |
| --- | --- |
| `PAYMENT_PENDING` | A payment instruction has been created and the buyer can pay |
| `PAYMENT_VERIFIED` | Provider confirmed exact successful payment for the expected escrow amount |
| `PAYMENT_EXPIRED` | Provider payment instruction expired before verified funding |
| `PAYMENT_REJECTED` | Provider reported underpayment, invalid payment, expired payment, or rejected payment |
| `SETTLEMENT_PENDING` | Provider has collected funds but settlement to Sivan wallet/bank is not yet final |
| `SETTLEMENT_RECEIVED` | Provider settlement has landed and can be reconciled |
| `PAYOUT_READY` | Escrow is eligible for manual/admin payout processing |
| `PAYOUT_PENDING` | Payout/disbursement has been initiated but final status is not known |
| `PAYOUT_SUCCEEDED` | Payout/disbursement has succeeded |
| `PAYOUT_FAILED` | Payout/disbursement failed or reversed and needs operator review |

## Canonical Payment Event Layer

All verified pay-in webhooks now pass through `src/services/paymentEventNormalizer.ts` before mutating escrow state. This gives Sivan one canonical event shape for Paystack, Monnify, PalmPay, and Flutterwave:

```ts
type NormalizedPaymentEvent = {
  eventId: string;
  provider: "paystack" | "monnify" | "palmpay" | "flutterwave";
  type: "PAYMENT_PENDING" | "PAYMENT_VERIFIED" | "PAYMENT_REJECTED" | "SETTLEMENT_RECEIVED";
  escrowReference: string;
  amount: { expected: number; paid: number; currency: "NGN" | "USDC" };
  status: "success" | "failed" | "pending";
  providerReference: string;
  raw: unknown;
  signatureVerified: boolean;
  occurredAt: string;
  idempotencyKey: string;
};
```

Production rule:

```text
Provider webhook → signature verification → provider re-query → canonical event → escrow state machine → ledger/audit/notifications
```

Raw provider payloads are still stored for audit, but escrow funding decisions use the verified provider transaction plus the canonical event metadata.

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

Payment instruction expiry is now split from escrow expiry. When a provider returns expiry metadata for a pending payment instruction, Sivan marks only that provider reference as expired, keeps the escrow in `PENDING_PAYMENT`, and lets the buyer regenerate a fresh bank-transfer instruction on the same escrow before the funding deadline. Old provider references are never reused and remain in transaction history. If a provider later reports money for an expired or inactive reference, Sivan sends the escrow to `REVIEW_REQUIRED` instead of auto-funding it. The full escrow moves to `EXPIRED` only when the configured funding window closes before verified payment. Lifecycle refresh also sends a one-time reminder before the funding deadline and stores `last_payment_reminder_at` for audit; production should enable `PAYMENT_LIFECYCLE_WORKER_ENABLED=true` so this runs without waiting for a user/admin page view.

Flutterwave is implemented as an emergency backup collection adapter using dynamic virtual accounts for bank transfer only. The backend can create a Flutterwave virtual account, persist `provider=flutterwave`, verify signed `charge.completed` webhooks, re-query Flutterwave by charge ID before funding, and support admin recheck by the stored payment reference. The adapter now fails closed if Flutterwave's dynamic virtual-account API is unavailable; it must not fall back to hosted checkout because hosted checkout can expose card payment options. Do not enable Flutterwave for users until the backup checklist passes with a low-value transfer and signed webhook proof. Do not use Flutterwave for card payments.

## Progress

```text
Provider-neutral Naira interface: 92%
Canonical payment event normalizer: 100%
Paystack behind provider interface: 100%
Monnify collection transport: 92%
Payment-provider admin switching: 90%
Flutterwave backup transport: 70%
PalmPay collection transport: 93%
PalmPay payout automation: 78%
Nomba transfer-only payout rail: 45%
Provider live-test readiness: 75%
Monnify sandbox initialization proof: 100%
Monnify paid-transfer verification proof: 100%
Monnify signed webhook proof: 0%
Monnify live-readiness proof: 75%
Flutterwave live backup proof: 0%
Nomba sandbox transfer proof: 0% - paused until KYC/API keys
Nomba signed payout webhook proof: 0% - paused until KYC/API keys
Nomba live low-value payout proof: 0% - paused until KYC/API keys
Overall production readiness: 82%
```

| Area | Status | Notes |
| --- | --- | --- |
| Provider-neutral interface | ✅ Done | `PaymentProvider`, `initializeBankTransferPayment`, `verifyPayment`, `verifyWebhookSignature`, and `normalizeWebhook` exist |
| Canonical payment event normalizer | ✅ Done | `paymentEventNormalizer` converts verified provider events into one Sivan event shape before escrow mutation |
| Paystack adapter | ✅ Done | Paystack now runs behind the provider interface and remains bank-transfer only |
| Provider ID on escrow/transactions | ✅ Done | Escrows already store `payment_provider`; transactions/ledger now use the active provider name |
| Bank-transfer-only guard | ✅ Done | Global `NAIRA_PAYMENT_METHODS=bank_transfer` policy is enforced across implemented Naira providers; provider-specific aliases must also resolve to bank transfer |
| Monnify name enquiry fallback | ✅ Done for payout verification fallback | Existing `MonnifyClient` can validate account name when configured |
| Monnify collection initialization | ✅ Implemented / paid sandbox proof passed | Monnify adapter initializes transfer-only transactions and stores transfer instruction metadata; sandbox auth/init/verify-pending and paid transfer verification passed on 2026-06-11 |
| Monnify webhook endpoint | ✅ Implemented / signed payment proof pending | `POST /webhooks/monnify` verifies raw-body HMAC, persists events, handles duplicates, and re-queries before funding; deployed route rejected unsigned payload on 2026-06-11 |
| Provider-aware recovery/recheck | ✅ Done | Admin recheck and retry jobs verify through each escrow's stored `paymentProvider` |
| Admin provider/settings controls | ✅ Implemented / smoke verified | DB-backed provider routing, platform mode, maintenance message, and bank-transfer-only policy controls exist in admin Platform Controls with audit history; deployed admin-page smoke passed on 2026-06-11 |
| Monnify settlement events | ✅ Implemented / live proof pending | `SETTLEMENT` webhooks are persisted, linked to matching escrows, and surfaced in Revenue/Reconciliation analytics; live settlement proof remains next |
| Flutterwave backup transport | 🟡 Implemented / live proof pending | Dynamic virtual account adapter, signed webhook endpoint, server-side charge verification, admin provider visibility, and hosted-checkout/card fail-closed guard exist; low-value backup transfer proof and settlement reconciliation remain next |
| PalmPay transport | 🟡 Implemented / provider proof pending | PalmPay adapter, signed API client, callback verification, `/webhooks/palmpay`, admin visibility, provider selection, and local tests are implemented. Remaining work is Render env setup, sandbox order proof, signed callback proof, settlement/reconciliation proof, and live low-value proof. See `docs/palmpay-payment-transport.md` |
| PalmPay payout automation | 🟡 Implemented / disabled by default | `PayoutProvider` exists with `manual_bank_transfer` active. PalmPay payout client/provider, query, signed payout webhook ingestion, and proof script are implemented. Keep disabled until sandbox/live payout proof passes. See `docs/palmpay-payout-automation.md` |
| Nomba transfer-only payout rail | ⏸️ Paused / disabled by default | Nomba payout code exists, but Nomba KYC is not complete and API keys are unavailable. Do not spend launch effort here until credentials are issued. Keep `NOMBA_PAYOUT_ENABLED=false` and do not set `ACTIVE_PAYOUT_PROVIDER=nomba`. See `docs/nomba-transfer-transport.md` |

## Emoji Production Dashboard

| Track | Status | Production meaning |
| --- | --- | --- |
| ✅ Provider-neutral escrow engine | Done | Sivan keeps one escrow state machine instead of letting providers become the escrow engine |
| ✅ Bank-transfer-only policy | Done | Naira MVP blocks card collection paths across implemented payment providers |
| ✅ Paystack collection rail | Done / proven baseline | Stable fallback/baseline rail for bank-transfer collection |
| ✅ Monnify sandbox paid-transfer proof | Done | Sandbox payment creation and paid transfer verification have passed |
| ✅ Flutterwave backup adapter | Implemented | Backup collection adapter exists, signed webhook verification exists, but live proof still pending |
| ✅ PalmPay collection adapter | Implemented | Signed request/callback client, provider adapter, webhook route, and admin visibility exist |
| ✅ PalmPay payout client/provider | Implemented / disabled | Payout transport, query, signed webhook ingestion, and proof script exist; automation remains off until proof |
| ⏸️ Nomba transfer-only client/provider | Paused / disabled | Code exists, but KYC/API keys are unavailable, so Nomba is not part of the immediate launch path |
| ⏸️ Nomba proof script | Paused | `npm run verify:nomba-transfer` should wait until KYC is complete and API keys exist |
| ⏸️ Nomba webhook endpoint | Paused / conservative | `/webhooks/nomba` exists but should not be configured/enabled until Nomba credentials are issued |
| ⏸️ Render Nomba env | Paused | Do not add fake or incomplete Nomba credentials to Render |
| ⏸️ Nomba sandbox bank-list proof | Paused | Cannot run until `NOMBA_CLIENT_ID`, `NOMBA_CLIENT_SECRET`, and `NOMBA_ACCOUNT_ID` are issued |
| ⏸️ Nomba sandbox account lookup proof | Paused | Wait for KYC/API keys |
| ⏸️ Nomba sandbox transfer proof | Paused | Wait for KYC/API keys |
| ⏸️ Nomba signed webhook proof | Paused | Wait for Nomba dashboard/API access |
| 🟡 PalmPay Render env | Pending | PalmPay production/sandbox env still needs proof on deployed backend |
| 🟡 PalmPay sandbox order proof | Pending | Adapter exists; provider proof still needed |
| 🟡 Daily reconciliation | Partial | Paystack/Flutterwave bulk pull and PalmPay known-reference checks exist; provider-specific settlement proof still remains |
| 🔴 Live low-value PalmPay proof | Not started | No real-money low-value PalmPay proof recorded yet |
| 🔴 Live low-value Nomba payout proof | Not started | Nomba must not be enabled for automated payout until this passes |
| 🔴 Automated payout finalization from provider webhook | Not enabled | Provider webhook currently queues review for safety; final auto-release after pending payout needs live-proof policy |

Current honest production percentage: **82%**.

Latest local verification on 2026-06-28:

- ✅ `npm run build` passed.
- ✅ Full local E2E/unit suite passed: 22 test files, 133 tests.
- ✅ Provider-focused tests passed for Paystack, Monnify provider adapter, PalmPay collection/payout, Flutterwave, Nomba payout client, reconciliation/admin routes, escrow lifecycle, and notification delivery.
- ✅ `/webhooks/palmpay` and `/webhooks/palmpay/payout` are covered by E2E tests for invalid signature rejection and valid signed webhook acceptance.
- ✅ Canonical payment event tests prove Paystack, Monnify, PalmPay, and Flutterwave normalize into the same internal event shape.
- ⏸️ Nomba remains paused because KYC/API keys are not available yet.

Why not higher: the architecture and adapters are strong, but production fintech readiness is not just code. The remaining gap is external PalmPay proof: Render env, sandbox order proof, signed callback delivery, live low-value payment/payout proof, and settlement/reconciliation evidence. Nomba is intentionally paused until KYC/API keys exist.

Safe launch posture today:

```env
ACTIVE_PAYMENT_PROVIDER=palmpay
BACKUP_PAYMENT_PROVIDER=flutterwave
ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer
PALMPAY_PAYOUT_ENABLED=false
NOMBA_PAYOUT_ENABLED=false
PAYMENT_PROVIDER_FALLBACK_ENABLED=false
```
