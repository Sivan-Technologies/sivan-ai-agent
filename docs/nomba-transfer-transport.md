# Nomba transfer-only payout transport

> Current status: ⏸️ paused. Nomba KYC is not complete yet, so API keys are unavailable. Keep this rail disabled and do not spend launch/proof effort here until Nomba credentials are issued.

Nomba is integrated as a payout/disbursement rail only. It is not a Naira pay-in provider for Sivan and must not be wired into card, checkout, or hosted payment collection.

## Current Status

| Item | Status | Notes |
| --- | --- | --- |
| Nomba transfer-only scope | ✅ Done | Nomba is payout/disbursement only; no Checkout, card, or virtual-account collection is enabled |
| Env variables | ✅ Done | Local `.env`, `.env.example`, and docs include all Nomba transfer/proof variables |
| OAuth token client | ✅ Done | Supports `POST /v1/auth/token/issue` with `accountId` header |
| Bank list client | ✅ Done | Supports `GET /v1/transfers/banks` |
| Bank account lookup client | ✅ Done | Supports `POST /v1/transfers/bank/lookup` |
| Bank transfer client | ✅ Done | Supports `POST /v2/transfers/bank` |
| Optional sub-account transfer path | ✅ Done | Uses `POST /v2/transfers/bank/{subAccountId}` when `NOMBA_SUB_ACCOUNT_ID` is set |
| Transfer requery client | ✅ Done | Supports `GET /v1/transactions/accounts/single?transactionRef=...` |
| Provider-neutral payout adapter | ✅ Done | `ACTIVE_PAYOUT_PROVIDER=nomba` is supported but disabled by default |
| Nomba webhook endpoint | ✅ Done / conservative | `/webhooks/nomba` verifies signature, stores event, links payout transaction, and queues payout review |
| Nomba proof script | ✅ Done | `npm run verify:nomba-transfer` is available |
| Local build/tests | ✅ Done | `npm run build`, `test/nombaPayoutClient.test.ts`, Nomba webhook E2E coverage, and the full local suite pass |
| Render sandbox credentials | ⏸️ Paused | KYC/API keys are unavailable; do not add fake credentials |
| Bank-list proof | ⏸️ Paused | Wait until credentials are issued |
| Account lookup proof | ⏸️ Paused | Wait until credentials are issued |
| Sandbox transfer proof | ⏸️ Paused | Requires explicit proof flags after credentials exist |
| Signed webhook delivery proof | ⏸️ Paused | Wait until Nomba dashboard/API access exists |
| Live low-value payout proof | ⏸️ Paused | Required before automated Nomba payouts can ever be enabled |
| Auto-finalize release from pending payout webhook | 🔴 Not enabled | Must wait until webhook/requery behaviour is proven live |

Readiness estimate for Nomba payout rail: **45%** while KYC/API keys are unavailable.

The code path is mostly implemented. The remaining 28% is provider proof, Render configuration, signed webhook delivery, and live low-value payout evidence.

Latest local verification on 2026-06-27:

- ✅ `npm run build` passed.
- ✅ `test/nombaPayoutClient.test.ts` passed.
- ✅ `/webhooks/nomba` rejects bad signatures and accepts valid signed payloads in E2E route tests.
- ✅ Full local suite passed: 21 test files, 122 tests.

## Scope

Implemented:

- OAuth token issue through `POST /v1/auth/token/issue`.
- Bank list pull through `GET /v1/transfers/banks`.
- Bank account lookup through `POST /v1/transfers/bank/lookup`.
- Parent-account bank transfer through `POST /v2/transfers/bank`.
- Optional sub-account bank transfer through `POST /v2/transfers/bank/{subAccountId}` when `NOMBA_SUB_ACCOUNT_ID` is set.
- Transfer requery through `GET /v1/transactions/accounts/single?transactionRef=...`.
- Nomba webhook HMAC-SHA256 signature verifier helper.
- Signed `POST /webhooks/nomba` ingestion that stores webhook events and queues payout review.
- Provider-neutral payout adapter support through `ACTIVE_PAYOUT_PROVIDER=nomba`.

Intentionally not implemented:

- Nomba Checkout.
- Nomba card payments.
- Nomba virtual account collection.
- Nomba as `ACTIVE_PAYMENT_PROVIDER`.

## Environment

Use sandbox first:

```env
ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer
NOMBA_BASE_URL=https://sandbox.nomba.com
NOMBA_CLIENT_ID=
NOMBA_CLIENT_SECRET=
NOMBA_ACCOUNT_ID=
NOMBA_WEBHOOK_SECRET=
NOMBA_WEBHOOK_URL=https://<api-domain>/webhooks/nomba
NOMBA_PAYOUT_ENABLED=false
NOMBA_SENDER_NAME=Sivan
NOMBA_SUB_ACCOUNT_ID=
NOMBA_PROOF_ACCOUNT_NUMBER=
NOMBA_PROOF_BANK_CODE=
NOMBA_PROOF_AMOUNT=100
NOMBA_PROOF_RUN_TRANSFER=false
NOMBA_PROOF_MERCHANT_TX_REF=
```

Only after sandbox and live proof:

```env
ACTIVE_PAYOUT_PROVIDER=nomba
NOMBA_BASE_URL=https://api.nomba.com
NOMBA_PAYOUT_ENABLED=true
```

Do not set `ACTIVE_PAYMENT_PROVIDER=nomba`; Nomba is not a Sivan collection rail.

## Provider-neutral payout flow

When admin approves a Naira release:

1. Sivan calculates gross amount, platform fee, and seller net amount.
2. Sivan loads the seller's encrypted payout account with raw account number available only server-side.
3. The active payout provider receives a normalized payout request.
4. Nomba receives:
   - `amount`
   - `accountNumber`
   - `accountName`
   - `bankCode`
   - `merchantTxRef`
   - `senderName`
   - `narration`
5. `merchantTxRef` is generated from Sivan's idempotency key and must be reused for the same release attempt.
6. If Nomba returns `SUCCESS`, Sivan can finalize the release.
7. If Nomba returns `NEW`, `PENDING`, or `PENDING_BILLING`, Sivan records `payout_pending` and must wait for webhook/requery before finalizing.
8. If Nomba returns `REFUND`, `FAILED`, or equivalent failure, Sivan records a failed payout state and support/ops must review before retry.

The Nomba webhook endpoint is intentionally conservative: it verifies the signature, stores the provider event, links it to the payout transaction when possible, and queues `payout_review`. It does not blindly release funds from a webhook alone until webhook payload shape, requery behaviour, and live proof are completed.

## Status mapping

| Nomba status | Sivan payout status |
| --- | --- |
| `SUCCESS`, `SUCCESSFUL` | `succeeded` |
| `NEW`, `PENDING`, `PENDING_BILLING`, `PROCESSING` | `pending` |
| `REFUND`, `REFUNDED`, `FAILED`, `FAILURE`, `REVERSED`, `CANCELLED` | `failed` |

## Proof checklist

Keep Nomba disabled until all are complete:

- [ ] Render env added with sandbox credentials.
- [ ] Bank list pull succeeds with `npm run verify:nomba-transfer`.
- [ ] Bank account lookup succeeds for a test account with `NOMBA_PROOF_ACCOUNT_NUMBER` and `NOMBA_PROOF_BANK_CODE`.
- [ ] Sandbox transfer succeeds with a unique `merchantTxRef` after setting `NOMBA_PROOF_RUN_TRANSFER=true` and `NOMBA_PAYOUT_ENABLED=true`.
- [ ] Pending transfer path records `payout_pending` without releasing escrow.
- [ ] Signed Nomba webhook proof passes against deployed webhook/signature key.
- [ ] Confirm webhook event links to the correct `nomba` payout transaction and queues payout review.
- [ ] Requery proof confirms final transfer state.
- [ ] Live low-value payout succeeds.
- [ ] Ops alert path is verified for failed/refunded payout.

## Safety rules

- Use one `merchantTxRef` per escrow release. Never generate a new reference while a previous transfer is pending.
- Treat unknown provider responses as pending, not successful.
- Do not retry a failed transfer until requery/webhook confirms the final state.
- Keep `NOMBA_PAYOUT_ENABLED=false` and `ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer` during pilot pay-in testing.

## Sandbox proof command

Safe bank-list proof:

```bash
npm run verify:nomba-transfer
```

Bank lookup proof:

```bash
NOMBA_PROOF_ACCOUNT_NUMBER=<test-account> \
NOMBA_PROOF_BANK_CODE=<bank-code> \
npm run verify:nomba-transfer
```

Sandbox transfer and requery proof:

```bash
NOMBA_PAYOUT_ENABLED=true \
NOMBA_PROOF_RUN_TRANSFER=true \
NOMBA_PROOF_ACCOUNT_NUMBER=<test-account> \
NOMBA_PROOF_BANK_CODE=<bank-code> \
NOMBA_PROOF_AMOUNT=100 \
npm run verify:nomba-transfer
```

Use sandbox credentials with `https://sandbox.nomba.com` and production credentials with `https://api.nomba.com`; do not mix environments.
