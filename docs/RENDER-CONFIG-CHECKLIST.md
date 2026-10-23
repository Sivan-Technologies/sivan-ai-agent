# Render configuration checklist: escrow agent (staging)

Service to edit: **`sivan-escrow-agent-test-gb84`**

## Status as of 2026-10-23, verified against live behaviour

| Variable | State |
|---|---|
| `IDENTITY_LINK_SERVICE_SECRET` | **applied.** Balance releases settle automatically. |
| `PAYMENT_API_BASE_URL` | **applied.** Calls reach the staging payment service, no more 404. |
| `ACTIVE_PAYMENT_PROVIDER` | **applied.** Agreements now stamp `paystack` with real Paystack references. |
| `PAYSTACK_SECRET_KEY` | **applied.** `/admin/payment-providers` reports `configured: true`. |
| `PAYSTACK_TRANSFER_ENABLED` | **applied.** Payout provider resolves to `paystack`. |
| Queue worker | **running.** Jobs drain within 15s without a manual trigger. |

**One new blocker, in code rather than configuration.** With Paystack active, releases no longer finalise: the transfer returns `pending`, `approve-release` returns 202 early, and the `transfer.success` webhook only logs. See `E2E-NGN-LIFECYCLE-2026-10-23.md`, run 5. Until that handler exists, finalise with the `payoutProvider: "manual_bank_transfer"` override on `approve-release`.

## Where to set these

1. Go to **dashboard.render.com**
2. Click the service **`sivan-escrow-agent-test-gb84`**
3. Left sidebar: **Environment**
4. Section: **Environment Variables** then **Add Environment Variable**
5. Add each key and value from the table below
6. Click **Save Changes**

Saving triggers a redeploy automatically. You do not need a separate restart.

Note: the repo has `escrow-agent/render.yaml`, but it declares services named `sivan-escrow-agent-test` and `sivan-escrow-agent-live`, not `...-test-gb84`. The running service was created outside the blueprint, so **editing `render.yaml` does not change it**. The dashboard is the source of truth today. The blueprint should be corrected separately so a future deploy does not reintroduce the drift.

## The variables

| Key | Value | Why |
|---|---|---|
| `IDENTITY_LINK_SERVICE_SECRET` | `<IDENTITY_LINK_SERVICE_SECRET>` | Shared secret with the payment service. Without it the escrow agent falls back to its own `ADMIN_API_KEY` and balance releases get 401. |
| `PAYMENT_API_BASE_URL` | `https://sivan-payments-api-test-x9xq.onrender.com` | Without it the code defaults to the live gateway, which returns 404 for this route. This is the binding fault. |
| `ACTIVE_PAYMENT_PROVIDER` | `paystack` | Currently set to `nomba` on the service. This is why agreements are recorded as `nomba_sandbox_override`. |
| `PAYSTACK_TRANSFER_ENABLED` | `true` | Defaults to `false`. Without it, payouts will not use Paystack even when pay in is Paystack. |
| `ACTIVE_PAYOUT_PROVIDER` | `paystack` | Fallback when provider mirroring does not match. Currently `manual_bank_transfer`. |
| `NOMBA_PAYOUT_ENABLED` | `false` | Optional. Closes the Nomba payout path entirely. |

The identity secret is a **shared** value. It must match `IDENTITY_LINK_SERVICE_SECRET` on `sivan-payments-api-test-x9xq`, which already has it. Do not generate a new one for the escrow agent.

## Why Paystack was not being used

Three sources already say Paystack:

- your `.env`: `ACTIVE_PAYMENT_PROVIDER=paystack`
- `render.yaml`: `paystack`
- the database settings: `activePaymentProvider = paystack`

The deployed service says `nomba`, and the deployed service is the only one that counts.

The chain that produced the Nomba behaviour:

1. `payoutVerificationTestMode.ts:95` builds the sandbox payment instruction from `env.ACTIVE_PAYMENT_PROVIDER`, producing `nomba_sandbox_override` and reference `sandbox-nomba-...`.
2. `payoutProvider.ts:321` `getPayoutProviderForEscrow` **mirrors the pay in provider onto the payout**. It strips `_sandbox_override`, sees `nomba`, finds `NOMBA_PAYOUT_ENABLED=true`, and selects `NombaPayoutProvider`.
3. In test platform mode that provider returns a simulated `TEST-NOMBA-<timestamp>` reference, which is the `manualPayoutReference` seen on released agreements.

### Bug worth noting

`createSandboxPaymentInstruction` reads `process.env.ACTIVE_PAYMENT_PROVIDER` **directly and never consults the database settings**. The admin setting `activePaymentProvider` is therefore ignored on this path. Changing the provider in the admin UI will appear to work and will have no effect on which provider is recorded. Provider selection should read from `settingsStore`, with env as the seed only.

### After the change

Once `ACTIVE_PAYMENT_PROVIDER=paystack` and `PAYSTACK_TRANSFER_ENABLED=true` are live, a new agreement should show:

- `paymentProvider` = `paystack_sandbox_override`
- `paymentReference` = `sandbox-paystack-SIV-...`
- payout provider = `paystack`

Existing agreements keep their recorded Nomba provider. The value is stored per agreement at accept time, so only new agreements pick up the change.

## Separate from Render: the live payment service

`POST /api/users/:id/balance/release-agreement` returns **404** on the live payment service behind `api.sivantech.online`, while staging returns 200 for the identical call. The live deployment is running older code and is missing the route. Redeploy the live payment service from `multichain-v2` before going live, or releases will fail there regardless of configuration.

## Credential hygiene

Two secrets are committed in plaintext in tracked files and need rotation after the config is stable:

- `escrow-agent/src/services/paymentBalanceClient.ts:3`, the live identity link secret as a hardcoded `DEFAULT_SECRET`
- `escrow-agent/render.yaml`, the Telegram bot token, six occurrences

Rotate the identity link secret only **after** the env var is set on both services, otherwise the call breaks again.
