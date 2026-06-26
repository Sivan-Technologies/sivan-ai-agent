# PalmPay payout automation plan

This document reviews the proposed PalmPay payout flow and defines the safe implementation path. It is separate from `palmpay-payment-transport.md` on purpose: collection/pay-in proves money entered Sivan, while payout/disbursement moves money out of Sivan. Those should be tested, permissioned, and launched independently.

## Review verdict

Your payout direction is correct, with one important rule:

```text
Admin approval should authorize payout.
PalmPay payout success should mark the escrow released.
```

Do not make admin approval alone equal `RELEASED` once automated payout is introduced. The safer state flow is:

```text
FUNDED
→ WORK_SUBMITTED
→ BUYER_CONFIRMED
→ ADMIN_APPROVED_RELEASE
→ PAYOUT_PENDING
→ PAYOUT_SUCCEEDED
→ RELEASED
```

If PalmPay fails or returns an uncertain/pending state:

```text
PAYOUT_FAILED or PAYOUT_REVIEW_REQUIRED
```

That preserves Sivan as the escrow state machine and keeps PalmPay as the transport rail.

## Current Sivan payout state

| Item | Status | Notes |
| --- | --- | --- |
| Admin-controlled release gate | ✅ Done | Admin remains the final human approval before release |
| Manual payout/reconciliation model | ✅ Done | This is the correct MVP before automated disbursement |
| Seller payout account capture/verification path | ✅ Done | Existing payout verification, name matching, account masking/encryption, shared-account review, and high-value review controls exist |
| Provider-neutral pay-in adapter | ✅ Done | PalmPay collection is already implemented through the payment provider adapter |
| Provider-neutral payout adapter | 🟡 Started | `PayoutProvider` exists with `manual_bank_transfer` active and automated providers fail-closed until implemented |
| Admin approval through payout transport | ✅ Done | Admin release now calls the active payout provider and only marks `RELEASED` after a succeeded payout result |
| PalmPay automated payout client | 🔴 Not started | Do not implement live money movement until provider proof is complete |
| PalmPay payout webhook proof | 🔴 Not started | Needs signed provider callback proof |
| Live low-value PalmPay payout proof | 🔴 Not started | Required before pilot automation |

## Recommended provider architecture

Create a payout layer separate from the payment collection layer:

```ts
interface PayoutProvider {
  id: "palmpay" | "manual_bank_transfer" | "flutterwave" | "monnify";
  verifyRecipient(input): Promise<RecipientVerificationResult>;
  initiatePayout(input): Promise<PayoutInitiationResult>;
  verifyPayout(reference): Promise<PayoutVerificationResult>;
  normalizePayoutWebhook(payload): NormalizedPayoutEvent;
  verifyPayoutWebhook(payload, signature): boolean;
}
```

PalmPay collection should stay in:

```text
PaymentProvider / PalmPayPaymentProvider
```

PalmPay payout should live in:

```text
PayoutProvider / PalmPayPayoutProvider
```

That separation prevents a payment reference from being accidentally treated as a payout reference, and vice versa.

## PalmPay payout APIs from the provided docs

These are the payout/disbursement endpoints Sivan would need after PalmPay confirms the product is enabled:

| Purpose | PalmPay path |
| --- | --- |
| Query merchant balance | `/api/v2/merchant/manage/account/queryBalance` |
| Query bank/MMO list | `/api/v2/general/merchant/queryBankList` |
| Verify bank/MMO account name | `/api/v2/payment/merchant/payout/queryBankAccount` |
| Verify PalmPay account | `/api/v2/payment/merchant/payout/queryAccount` |
| Initiate merchant payout | `/api/v2/merchant/payment/payout` |
| Query payout transaction | `/api/v2/merchant/payment/queryPayStatus` |
| Payout result notification | `notifyUrl` sent during payout initiation |

PalmPay payout callbacks must return exact plain text:

```text
success
```

## Implementation path

### Phase 0: Keep current MVP safe

Status: ✅ Current recommendation

Use PalmPay for collection/pay-in only. Keep payout manual/admin-controlled until collection proof is complete:

```text
payment created
→ webhook received
→ signature verified
→ server-side verification passed
→ amount matched
→ settlement/reconciliation visible
```

### Phase 1: Provider proof before payout code

Status: 🟡 Pending

Confirm with PalmPay:

- payout/disbursement product is enabled for the merchant
- merchant balance source for payout
- production IP whitelist requirements
- payout callback payload and signature format
- duplicate callback/retry behavior
- idempotency/reference rules for repeated `orderId`
- fees, VAT, failed transfer handling, reversal handling
- supported Nigerian bank codes and PalmPay wallet code
- whether account-name verification is mandatory before payout

### Phase 2: Add payout state tracking

Status: 🟡 Started

Add transaction-level payout status before changing escrow final status:

```text
PAYOUT_APPROVED
PAYOUT_PENDING
PAYOUT_SUCCEEDED
PAYOUT_FAILED
PAYOUT_REVERSED
PAYOUT_REVIEW_REQUIRED
```

Escrow should not become `RELEASED` until `PAYOUT_SUCCEEDED`.

### Phase 3: Build PalmPay payout client

Status: 🔴 Not started

Create:

```text
src/services/palmpayPayoutClient.ts
```

Required methods:

- `queryBalance()`
- `queryBankList()`
- `queryBankAccount()`
- `queryPalmPayAccount()`
- `initiatePayout()`
- `queryPayoutStatus()`
- `verifyWebhookSignature()`

Reuse the same PalmPay signing model:

```text
canonical non-empty body fields
→ MD5 uppercase
→ SHA1WithRSA using merchant private key
```

Use the PalmPay platform public key to verify callbacks.

### Phase 4: Build `PalmPayPayoutProvider`

Status: 🔴 Not started

Create:

```text
src/services/payoutProvider.ts
src/services/palmpayPayoutProvider.ts
```

Current implementation:

```text
src/services/payoutProvider.ts
```

Implemented provider:

```text
manual_bank_transfer
```

Automated providers:

```text
palmpay / flutterwave / monnify
```

These currently fail closed. That means admin approval cannot accidentally mark an escrow released through an unimplemented automated payout rail.

The provider must:

- verify recipient name/account before payout
- reject payout if escrow is not eligible
- reject payout if admin approval is missing
- use one idempotent payout order ID
- store PalmPay `orderNo`
- never mark release successful from initiation alone
- verify status through PalmPay before final release

### Phase 5: Add webhook and recovery

Status: 🔴 Not started

Add either:

```text
POST /webhooks/palmpay/payout
```

or reuse:

```text
POST /webhooks/palmpay
```

only if payload type detection is unambiguous.

Webhook rules:

- verify signature first
- store raw event
- treat duplicates as success
- return exact `success` to accepted provider notifications
- re-query PalmPay before marking payout successful
- move uncertain failures into `PAYOUT_REVIEW_REQUIRED`

### Phase 6: Live proof gate

Status: 🔴 Not started

Before enabling for users:

1. Run 5 low-value PalmPay payout tests.
2. Confirm callback arrives and verifies.
3. Confirm duplicate webhook does not double-release.
4. Confirm failed payout keeps escrow unreleased.
5. Confirm pending payout stays pending.
6. Confirm admin can see provider reference, account, amount, fee, and final state.
7. Confirm reconciliation report matches Sivan ledger.

## Environment flags

Do not enable automated payout by default. Use explicit flags:

```env
PALMPAY_PAYOUT_ENABLED=false
ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer
PALMPAY_PAYOUT_NOTIFY_URL=https://<api-domain>/webhooks/palmpay/payout
```

Only after proof:

```env
PALMPAY_PAYOUT_ENABLED=true
ACTIVE_PAYOUT_PROVIDER=palmpay
```

## What should be added to the payout MD?

Yes, this plan should live in the payout documentation, not only in the PalmPay collection doc. The payout doc should clearly say:

- PalmPay collection/pay-in is implemented.
- PalmPay automated payout is not implemented yet.
- The current production-safe MVP is manual payout after admin approval.
- Automated payout must be launched behind an env flag.
- `RELEASED` must happen only after payout success, not at payout initiation.

## Final recommendation

For Sivan’s next milestone:

```text
Primary pay-in: PalmPay
Payout mode: manual/admin-controlled
Automated payout: planned, disabled
```

That gives you the best balance: PalmPay lowers collection cost now, while Sivan avoids automating outbound money movement before the provider proofs are real.
