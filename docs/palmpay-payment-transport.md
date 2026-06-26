# PalmPay payment transport

Last reviewed: 2026-06-26  
Primary use: Naira bank-transfer collection for Sivan service agreements

## Executive summary

PalmPay is now wired into Sivan as a provider-neutral Naira payment transport. The escrow engine still owns the agreement state machine; PalmPay only creates/verifies the payment rail and sends signed payment-result notifications.

Recommended provider strategy after this integration:

```env
ACTIVE_PAYMENT_PROVIDER=palmpay
BACKUP_PAYMENT_PROVIDER=flutterwave
EMERGENCY_PAYMENT_PROVIDER=manual_bank_transfer
PAYMENT_PROVIDER_FALLBACK_ENABLED=false
NAIRA_PAYMENT_METHODS=bank_transfer
PALMPAY_PAYMENT_METHODS=bank_transfer
```

Keep fallback disabled until PalmPay has passed real sandbox/live low-value proof. A PalmPay reference must always be verified through PalmPay, not Flutterwave, Monnify, or Paystack.

## Implementation status

| Area | Status | Evidence |
| --- | --- | --- |
| PalmPay config/env support | ✅ Done | `src/config.ts`, `.env.example` |
| PalmPay API client | ✅ Done | `src/services/palmpayClient.ts` |
| MD5 + SHA1WithRSA request signing | ✅ Done | `PalmPayClient.signPayload()` |
| Callback signature verification | ✅ Done | `PalmPayClient.verifyWebhookSignature()` |
| Provider-neutral adapter | ✅ Done | `PalmPayPaymentProvider` in `src/services/nairaPaymentProvider.ts` |
| Provider factory selection | ✅ Done | `createNairaPaymentProvider("palmpay")` |
| Active-provider config check | ✅ Done | `providerConfigured("palmpay")` |
| Admin provider visibility | ✅ Done | `/admin/payment-providers` now marks PalmPay implemented/configured when env exists |
| Payment creation path | ✅ Done | `POST /api/v2/payment/merchant/createorder` |
| Payment verification path | ✅ Done | `POST /api/v2/payment/merchant/order/queryStatus` |
| Webhook/callback path | ✅ Done | `POST /webhooks/palmpay` |
| PalmPay plain-text callback response | ✅ Done | Handler returns exact `success` string on accepted notifications |
| Kobo amount conversion | ✅ Done | Sivan NGN amount is sent as kobo; PalmPay kobo is converted back to NGN before reconciliation |
| PalmPay-safe merchant order IDs | ✅ Done | Adapter generates <=32 character alphanumeric references |
| Duplicate webhook safety | ✅ Done through existing webhook ledger | `workflowStore.addWebhookEvent()` records event IDs before reconciliation |
| Server-side verification before funding escrow | ✅ Done | Webhook handler re-queries PalmPay before calling `reconcileEscrowPayment()` |
| WhatsApp display compatibility | ✅ Done | No bot change required; bot renders backend payment instructions generically |
| Unit/provider tests | ✅ Done | `test/palmpayClient.test.ts`, `test/nairaPaymentProvider.test.ts` |
| Full local backend test suite | ✅ Done | 105/105 backend tests passed on 2026-06-26 |
| Full local WhatsApp test suite | ✅ Done | 55/55 passed, 1 intentional skip, on 2026-06-26 |
| Deployed Render env configured | 🟡 Pending | Add PalmPay env vars in Render, then redeploy |
| Real PalmPay sandbox order proof | 🟡 Pending | Requires sandbox credentials and reachable callback URL |
| Real PalmPay signed callback proof | 🟡 Pending | Requires PalmPay to send signed notification to `/webhooks/palmpay` |
| Live low-value proof | 🔴 Not started | Do only after sandbox proof and production approval |
| Automated payout via PalmPay | 🔴 Not implemented | Current MVP keeps manual payout/release control |

## End-to-end Sivan flow

1. Buyer creates a Naira service agreement in WhatsApp.
2. Seller accepts after payout/profile setup.
3. Backend chooses active Naira provider from platform settings.
4. If active provider is `palmpay`, Sivan creates a PalmPay order.
5. Sivan stores:
   - `paymentProvider=palmpay`
   - PalmPay-safe `paymentReference`
   - PalmPay `orderNo` as transaction reference
   - checkout URL and/or virtual account details when returned
6. WhatsApp bot shows the buyer backend-provided payment instructions.
7. Buyer pays through PalmPay.
8. PalmPay calls:

```text
POST https://sivan-escrow-agent.onrender.com/webhooks/palmpay
```

9. Sivan verifies the PalmPay callback signature with `PALMPAY_PLATFORM_PUBLIC_KEY`.
10. Sivan stores the webhook event.
11. If `orderStatus=2`, Sivan re-queries PalmPay server-side.
12. Sivan reconciles exact provider, reference, amount, currency, and bank-transfer status.
13. If valid, agreement moves to funded/in-progress state and participants are notified.
14. Delivery confirmation and release remain controlled by Sivan, not PalmPay.

## PalmPay endpoints used

| Purpose | Method | Path |
| --- | --- | --- |
| Create collection order | `POST` | `/api/v2/payment/merchant/createorder` |
| Query collection order | `POST` | `/api/v2/payment/merchant/order/queryStatus` |
| Receive payment notification | `POST` | Sivan `/webhooks/palmpay` |

Base URLs:

```text
Sandbox:    https://open-gw-sandbox.palmpay-inc.com
Production: https://open-gw-prod.palmpay-inc.com
```

## Required environment variables

Sandbox:

```env
ACTIVE_PAYMENT_PROVIDER=palmpay
BACKUP_PAYMENT_PROVIDER=flutterwave
EMERGENCY_PAYMENT_PROVIDER=manual_bank_transfer
PAYMENT_PROVIDER_FALLBACK_ENABLED=false

NAIRA_PAYMENT_METHODS=bank_transfer
PALMPAY_PAYMENT_METHODS=bank_transfer
PALMPAY_BASE_URL=https://open-gw-sandbox.palmpay-inc.com
PALMPAY_WEBHOOK_URL=https://sivan-escrow-agent.onrender.com/webhooks/palmpay
PALMPAY_CALLBACK_URL=https://sivan-escrow-agent.onrender.com/payment/callback
PALMPAY_COUNTRY_CODE=NG
PALMPAY_TIMEOUT_MS=8000
PALMPAY_ORDER_EXPIRE_SECONDS=1800

PALMPAY_APP_ID=<your PalmPay App ID>
PALMPAY_MERCHANT_ID=<your PalmPay Merchant ID>
PALMPAY_MERCHANT_PRIVATE_KEY=<your merchant private key>
PALMPAY_MERCHANT_PUBLIC_KEY=<your merchant public key>
PALMPAY_PLATFORM_PUBLIC_KEY=<PalmPay platform public key>
```

Production changes:

```env
PALMPAY_BASE_URL=https://open-gw-prod.palmpay-inc.com
```

Production may also require PalmPay IP whitelisting. Confirm this with PalmPay before live testing.

## How to create PalmPay keys

PalmPay uses two RSA key relationships:

1. Merchant key pair
   - Sivan keeps the merchant private key.
   - Sivan uploads the merchant public key to PalmPay.
   - Sivan signs outbound API requests with the merchant private key.

2. PalmPay platform public key
   - PalmPay gives this to Sivan.
   - Sivan uses it to verify PalmPay callbacks.

### Recommended production key-generation method

Generate a new 2048-bit RSA key pair in a secure machine/session:

```bash
openssl genrsa -out palmpay_merchant_private.pem 2048
openssl rsa -in palmpay_merchant_private.pem -pubout -out palmpay_merchant_public.pem
```

Then convert to one-line base64 if your env provider does not handle multiline PEM cleanly:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' palmpay_merchant_private.pem
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' palmpay_merchant_public.pem
```

Put the private key into:

```env
PALMPAY_MERCHANT_PRIVATE_KEY=<private key or escaped PEM>
```

Put the public key into:

```env
PALMPAY_MERCHANT_PUBLIC_KEY=<public key or escaped PEM>
```

Upload the merchant public key to PalmPay. Never upload or send the merchant private key.

After PalmPay gives the platform public key, set:

```env
PALMPAY_PLATFORM_PUBLIC_KEY=<PalmPay platform public key>
```

### Important key safety notes

- Do not commit `.pem` files.
- Do not paste production private keys into tickets, chats, screenshots, or markdown.
- The test keys in PalmPay documentation are for sandbox/debugging only.
- If a private key was exposed publicly, generate a fresh pair and rotate it.
- Store Render env vars as secrets, not in source files.

## Signature implementation review

PalmPay signing rules from the provided document:

1. Remove the `sign` field.
2. Keep only non-empty fields.
3. Trim values.
4. Sort field names lexicographically/ASCII ascending.
5. Join as `key=value&key2=value2`.
6. MD5 hash the joined string.
7. Uppercase the MD5 digest.
8. Sign the digest with merchant private key using `SHA1WithRSA`.
9. Send the result in the `Signature` request header.

Sivan implementation:

```text
canonicalString(payload)
  -> md5Upper(canonical)
  -> crypto.createSign("RSA-SHA1")
  -> Signature header
```

Callback verification uses the same canonicalization, excludes `sign`, URL-decodes the callback `sign`, and verifies with `PALMPAY_PLATFORM_PUBLIC_KEY`.

Review verdict: ✅ The implemented signing and callback verification match the PalmPay document.

## Amount review

PalmPay expects smallest currency unit.

Sivan stores Naira as normal NGN values, for example:

```text
Sivan total: NGN 5,500
PalmPay request amount: 550000
```

On verification, PalmPay amount is converted back:

```text
PalmPay amount: 550000
Sivan verification amount: NGN 5,500
```

Review verdict: ✅ Amount conversion is handled. This is critical for preventing false amount mismatch reviews.

## Order/reference review

PalmPay merchant order number rule:

```text
32 characters max, numbers/English letters only, no special symbols.
```

Sivan references such as `palmpay-SIV-300682-FEB6-...` would violate this, so the adapter generates PalmPay-safe references like:

```text
PPSIV300682FEMFD8A1B2C3
```

Review verdict: ✅ PalmPay-safe references are generated for new PalmPay orders.

## Webhook review

PalmPay requires:

```text
HTTP 200
Body: success
```

Sivan behavior:

- Missing/invalid signature: rejects.
- Valid non-success status: stores event and returns `success`.
- `orderStatus=2`: stores event, re-queries PalmPay, then reconciles.
- Unmatched reference: logs warning and returns `success` to avoid retry storms.
- Processing error: enqueues webhook recovery and returns error.

Review verdict: ✅ Webhook behavior matches PalmPay retry rules and Sivan safety rules.

## Current limitations

| Limitation | Status | Reason |
| --- | --- | --- |
| PalmPay payout automation | 🔴 Not implemented | MVP should keep manual payout/release control until pay-in is proven. See `docs/palmpay-payout-automation.md` |
| Settlement reconciliation from PalmPay settlement reports | 🟡 Pending | Current code records payment events; settlement reporting needs live/provider data |
| Real sandbox callback proof | 🟡 Pending | Needs PalmPay sandbox call into deployed Render URL |
| Production IP whitelist | 🟡 Pending | Must be confirmed/configured with PalmPay before live |
| Native app/webview wallet deep-link handling | 🔴 Not implemented in Sivan | Current WhatsApp MVP uses H5/payment instructions, not embedded app WebView |

## Test plan

### Stage 0: Local verification

Status: ✅ Completed

Commands already passed:

```bash
npm run build
npm test -- --run test/palmpayClient.test.ts test/nairaPaymentProvider.test.ts
npm test -- --run
```

Results:

```text
Backend: 105/105 passed
WhatsApp bot: 55/55 passed, 1 intentional skip
```

### Stage 1: Render sandbox setup

1. Add all `PALMPAY_*` env vars to Render.
2. Set `ACTIVE_PAYMENT_PROVIDER=palmpay`.
3. Keep `PAYMENT_PROVIDER_FALLBACK_ENABLED=false`.
4. Redeploy backend.
5. Check admin provider status:

```text
GET /admin/payment-providers
```

Expected:

```json
{
  "provider": "palmpay",
  "implemented": true,
  "configured": true
}
```

### Stage 2: Create a sandbox PalmPay payment

Create a fresh low-value Naira agreement after deploy. Use an amount that matches PalmPay sandbox test bands.

For internal proof:

```text
NGN 1,000 - NGN 5,000
```

Expected:

- escrow stores `paymentProvider=palmpay`
- payment reference starts with PalmPay-safe `PP...`
- payment instruction shows PalmPay checkout URL and/or bank-transfer details
- no `sandbox-paystack` reference is created

### Stage 3: Callback proof

After completing/simulating payment in PalmPay sandbox:

Expected:

- PalmPay sends signed callback to `/webhooks/palmpay`
- Sivan verifies callback signature
- Sivan stores webhook event as `palmpay:order.2`
- Sivan re-queries PalmPay
- Sivan marks agreement funded only if exact amount/currency/provider match

### Stage 4: Live low-value proof

Only after sandbox proof:

1. Switch to production PalmPay URL.
2. Confirm IP whitelist.
3. Create 5 live low-value test agreements.
4. Confirm payment, callback, server-side verification, settlement visibility, and reconciliation.
5. Keep manual payout/release control.

Automated payout is intentionally excluded from the PalmPay pay-in launch gate. It has its own plan in `docs/palmpay-payout-automation.md`.

## PalmPay review for provider/team handoff

Sivan is implementing PalmPay as a bank-transfer-only Naira collection rail for service agreements. Sivan does not store card data, does not collect PAN/CVV, and does not treat PalmPay as the escrow ledger. PalmPay is the payment transport; Sivan remains the agreement state machine and reconciliation layer.

What we need from PalmPay:

1. Confirm the correct merchant account/App ID for sandbox and production.
2. Confirm product activation for `bank_transfer`.
3. Confirm whether `productType=bank_transfer` is sufficient for temporary account generation.
4. Confirm whether `goodsDetails` is required for this merchant category.
5. Confirm callback payload fields for bank-transfer success.
6. Confirm if callback `sign` is always in the JSON body, not only the header.
7. Confirm IP whitelist requirements for production.
8. Provide the platform public key for sandbox and production.
9. Confirm settlement report/export or API for reconciliation.

## Final readiness verdict

PalmPay is code-integrated and locally verified, but not yet production-ready.

Current state:

```text
Code implementation: ✅ Ready
Local tests: ✅ Ready
Render env: 🟡 Pending
Sandbox order proof: 🟡 Pending
Signed callback proof: 🟡 Pending
Live low-value proof: 🔴 Not started
Pilot readiness: 🟡 Close, after PalmPay proof
```

Do not enable PalmPay for real users until:

```text
payment created
→ webhook received
→ signature verified
→ server-side verification passed
→ amount matched
→ currency matched
→ duplicate-safe
→ reconciliation visible
```
