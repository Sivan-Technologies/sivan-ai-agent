# Monnify Payment Transport

This document reduces the Monnify notes into the production path Sivan should actually build. It intentionally keeps Sivan bank-transfer only.

## Current Implementation State

Sivan now has the provider-neutral Naira interface in `src/services/nairaPaymentProvider.ts`, and Paystack is routed through it. Monnify is implemented as a contained adapter behind the same interface, but it must still pass the full sandbox/live checklist before being enabled for real users.

Implemented Monnify capabilities:

- Monnify API authentication with token caching
- account-name enquiry through `/api/v1/disbursements/account/validate`
- fallback payout account resolution when Paystack account resolution is unavailable and Monnify credentials are configured
- transfer-only transaction initialization
- Pay with Bank Transfer instruction generation
- Monnify payment verification by `paymentReference`
- signed `POST /webhooks/monnify` handling
- duplicate-safe webhook persistence
- server-side re-query before funding an escrow
- basic `SETTLEMENT` event capture linked to escrow events

Still pending:

- real Monnify sandbox/live transfer proof
- live-proven settlement proof from Monnify sandbox/live testing
- automated disbursement/payout, which should remain out of MVP until manual payout operations are proven

## Target Role

Monnify should be added as a Naira payment transport beside Paystack:

```text
WhatsApp command
  -> Sivan escrow engine
  -> ACTIVE_PAYMENT_PROVIDER=monnify
  -> Monnify bank-transfer instruction
  -> Monnify webhook
  -> Sivan verifies transaction server-side
  -> escrow moves to FUNDED/IN_PROGRESS
```

The admin Platform Controls page can now choose the active provider, backup provider, and emergency provider without changing escrow rules. Existing escrows keep their original provider after a payment reference is created.

## Required Environment Variables

Current variables:

```env
MONNIFY_API_KEY=
MONNIFY_SECRET_KEY=
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_TIMEOUT_MS=8000
```

Variables for the transport:

```env
ACTIVE_PAYMENT_PROVIDER=monnify
BACKUP_PAYMENT_PROVIDER=paystack
EMERGENCY_PAYMENT_PROVIDER=flutterwave
MONNIFY_CONTRACT_CODE=
NAIRA_PAYMENT_METHODS=bank_transfer
MONNIFY_PAYMENT_METHODS=bank_transfer
MONNIFY_WEBHOOK_URL=https://sivan-escrow-agent.onrender.com/webhooks/monnify
MONNIFY_SOURCE_ACCOUNT_NUMBER=
```

Use `https://sandbox.monnify.com` with sandbox keys until live access is approved. Use `https://api.monnify.com` only with live keys and after the live checklist passes.

## Collection Flow

1. Authenticate with Monnify using Basic auth over `apiKey:secretKey`.
2. Initialize a transaction with:
   - unique `paymentReference`
   - exact escrow amount
   - `currencyCode=NGN`
   - `contractCode`
   - `paymentMethods=["ACCOUNT_TRANSFER"]`
3. Prefer the direct bank-transfer path for Sivan:
   - initialize transaction
   - call Pay with Bank Transfer using Monnify's transaction reference
   - display the generated dynamic account details to the buyer
4. Store:
   - internal escrow ID
   - Monnify `paymentReference`
   - Monnify `transactionReference`
   - expected amount
   - currency
   - expiry timestamp
5. On webhook, verify the Monnify signature/hash before processing.
6. Re-query Monnify server-side before marking the escrow funded.
7. Mark funded only when:
   - `paymentStatus` is `PAID`
   - `paymentMethod` is `ACCOUNT_TRANSFER`
   - `currency`/`currencyCode` is `NGN`
   - amount paid matches the escrow amount exactly
   - payment reference maps to one open escrow

## Webhook Rules

Monnify sends `monnify-signature`. Sivan should compute the HMAC-SHA512 signature over the raw request body with the Monnify secret key and compare it using constant-time comparison.

Process only supported event types:

| Monnify event | Sivan action |
| --- | --- |
| `SUCCESSFUL_TRANSACTION` | Verify server-side, then mark escrow funded if amount/reference/currency/method match |
| `REJECTED_PAYMENT` | Move escrow to review with rejection reason and expected amount |
| `SETTLEMENT` | Attach settlement reference and settlement amount to reconciliation |
| `SUCCESSFUL_DISBURSEMENT` | Mark payout provider proof as successful if payout automation is later enabled |
| `FAILED_DISBURSEMENT` | Open payout review/support case |
| `REVERSED_DISBURSEMENT` | Freeze payout state and reconcile before retry |

Always acknowledge valid webhooks quickly after persistence. Put slow reconciliation work on the retry queue.

## Disbursement/Payout Position

Do not enable automated Monnify disbursement for MVP release unless the admin payout process is already proven live.

Recommended MVP payout posture:

```text
buyer funds escrow
  -> provider verifies payment
  -> buyer completes work
  -> buyer requests release
  -> admin checks payout safety row
  -> admin pays manually or through provider dashboard
  -> admin records payout reference only
```

If Monnify disbursement is added later:

- run Name Enquiry before every first payout account save
- support `PENDING_AUTHORIZATION` OTP status
- never retry ambiguous transfer states without re-querying provider status
- treat `REVERSED`, `FAILED`, and duplicate-detection errors as review cases

## Error Handling Policy

| Provider result | Sivan response |
| --- | --- |
| Token/auth failure | Provider unavailable; use backup provider if configured |
| Duplicate payment reference | Generate a new payment reference, never reuse old reference |
| Underpayment/rejected payment | `REVIEW_REQUIRED`; ask buyer for proof/top-up decision |
| Overpayment | `REVIEW_REQUIRED`; finance reconciliation before release |
| Webhook signature mismatch | Reject request and alert operations |
| Provider timeout | Do not mark funded; enqueue re-query |
| Unknown final status | Keep escrow pending/review and re-query |
| Failed/reversed payout | Freeze payout state and open support case |

## Implementation Sequence

1. ✅ Add a provider-neutral Naira payment interface.
2. ✅ Move Paystack collection behind that interface without changing live behavior.
3. ✅ Add Monnify collection client for transfer-only initialization.
4. ✅ Add `POST /webhooks/monnify` with raw body signature validation.
5. ✅ Normalize Monnify payment events into the existing escrow transaction model.
6. ✅ Add admin provider settings for active/backup/emergency provider.
7. 🟡 Add richer Monnify settlement fields to admin Reconciliation and Revenue tabs.
8. 🟡 Run `docs/monnify-live-test.md` before using Monnify for real users.

## Current Progress

```text
Monnify transport progress: 80%
```

| Area | Status | Notes |
| --- | --- | --- |
| Shared provider interface | ✅ Done | Monnify can now be implemented as a contained adapter |
| Paystack behavior preserved | ✅ Done | Current live Naira behavior remains Paystack bank transfer |
| Monnify auth token cache | ✅ Done | Existing client authenticates and caches token |
| Monnify account/name validation | ✅ Done for fallback verification | Used only for payout account resolution fallback |
| Monnify bank-transfer collection | ✅ Implemented / live proof pending | Init transaction and Pay with Bank Transfer instruction generation are implemented |
| Monnify webhook verification | ✅ Implemented / live proof pending | Raw-body HMAC-SHA512 validation and server-side verification are implemented |
| Monnify settlement/reconciliation | ✅ Implemented / live proof pending | Settlement events are persisted, linked to escrows, and surfaced in Revenue/Reconciliation analytics |
| Monnify live sandbox test | 🟡 Next | Run the checklist before enabling Monnify for real users |
