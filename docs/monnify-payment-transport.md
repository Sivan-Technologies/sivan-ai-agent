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
- payment-instruction expiry that expires only the stale provider reference while the escrow remains fundable until its funding deadline

Still pending:

- signed Monnify webhook delivery proof into deployed Sivan
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
5. If the provider instruction expiry timestamp passes before verified funding, mark that funding transaction `expired`, clear it as the active payment reference, and keep the escrow `PENDING_PAYMENT` so the buyer can request fresh payment details.
6. On webhook, verify the Monnify signature/hash before processing.
7. Re-query Monnify server-side before marking the escrow funded.
8. Mark funded only when:
   - `paymentStatus` is `PAID`
   - `paymentMethod` is `ACCOUNT_TRANSFER`
   - `currency`/`currencyCode` is `NGN`
   - amount paid matches the escrow amount exactly
   - payment reference maps to one open escrow

If Monnify reports a payment after Sivan already marked the payment instruction expired or inactive, keep the escrow out of automatic funding and route it to manual payment review. The full escrow moves to `EXPIRED` only when the configured funding window closes.

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
7. ✅ Add richer Monnify settlement fields to admin Reconciliation and Revenue tabs.
8. ✅ Verify provider-neutral code paths with local build/tests and deployed smoke/DR checks.
9. ✅ Verify Monnify sandbox authentication, transaction initialization, bank-transfer account generation, and pending server-side verification.
10. ✅ Verify a paid Monnify sandbox bank-transfer transaction server-side.
11. 🟡 Prove signed Monnify webhook delivery into deployed `/webhooks/monnify` before using Monnify for real users.
12. ✅ Expire stale provider payment instructions without closing the escrow, regenerate fresh references on the same escrow before the funding deadline, send a one-time funding reminder before escrow expiry, and route late payments to expired/inactive references to manual review.

## Current Progress

```text
Monnify transport progress: 92%
Monnify sandbox initialization proof: 100%
Monnify paid-transfer verification proof: 100%
Monnify signed webhook proof: 0%
Monnify live-readiness proof: 75%
```

| Area | Status | Notes |
| --- | --- | --- |
| Shared provider interface | ✅ Done | Monnify can now be implemented as a contained adapter |
| Paystack behavior preserved | ✅ Done | Current live Naira behavior remains Paystack bank transfer |
| Monnify auth token cache | ✅ Done | Existing client authenticates and caches token |
| Monnify account/name validation | ✅ Done for fallback verification | Used only for payout account resolution fallback |
| Monnify bank-transfer collection | ✅ Implemented / paid sandbox proof passed | Init transaction, Pay with Bank Transfer instruction generation, and paid server-side verification are implemented |
| Monnify webhook verification | ✅ Implemented / signed delivery proof pending | Raw-body HMAC-SHA512 validation and server-side verification are implemented; deployed signed provider webhook receipt remains next |
| Monnify settlement/reconciliation | ✅ Implemented / live proof pending | Settlement events are persisted, linked to escrows, and surfaced in Revenue/Reconciliation analytics |
| Local build/test proof | ✅ Passed on 2026-06-11 | `npm run build` passed; `npm test -- --run` passed with 14 files and 81 tests |
| Live backend smoke proof | ✅ Passed on 2026-06-11 | `npm run smoke` passed against the deployed Render backend after allowing network access |
| Live DR proof | ✅ Passed on 2026-06-11 | `npm run dr:check` passed against the deployed Render backend after allowing network access |
| Live admin session smoke proof | ✅ Passed on 2026-06-11 | `npm run smoke:admin-page` passed against backend admin routes and Telegram auth session routes |
| Monnify sandbox initialization proof | ✅ Passed on 2026-06-11 | Sandbox auth, bank-transfer instruction generation, and server-side verification of a pending transaction passed |
| Monnify sandbox transfer-account proof | ✅ Passed on 2026-06-11 | Generated sandbox payment reference `monnify-proof-1781193317611`, transaction reference `MNFY\|54\|20260611165519\|000008`, Sterling bank virtual account ending `1050`, then verified the transaction as `PENDING` |
| Monnify paid-transfer verification proof | ✅ Passed on 2026-06-11 | Generated sandbox payment reference `monnify-click-proof-1781205462197`, transaction reference `MNFY\|54\|20260611201745\|000028`, funded NGN 100 by account transfer, then verified status `PAID`, amount `100`, currency `NGN`, method `ACCOUNT_TRANSFER`, settlement amount `90` |
| Monnify webhook route fail-closed proof | ✅ Passed on 2026-06-11 | Deployed `/webhooks/monnify` rejected an unsigned payload instead of processing it |
| Monnify signed webhook delivery proof | 🟡 Next | Confirm Monnify sends the signed `SUCCESSFUL_TRANSACTION` webhook to deployed `/webhooks/monnify` and Sivan persists it |
