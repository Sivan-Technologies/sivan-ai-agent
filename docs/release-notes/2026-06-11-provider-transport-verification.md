# Provider Transport Verification - 2026-06-11

## Result

Provider-neutral Naira payment transport checks passed locally and against the deployed backend. This verifies the code paths and operational endpoints around Paystack, Monnify readiness, provider settings, platform mode, maintenance messaging, reconciliation, revenue, and DR visibility.

| Check | Result |
| --- | --- |
| TypeScript build | ✅ `npm run build` passed |
| Automated tests | ✅ `npm test -- --run` passed: 14 test files, 81 tests |
| Live backend smoke | ✅ `npm run smoke` passed against Render |
| Live DR check | ✅ `npm run dr:check` passed against Render |
| Live admin-page smoke | ✅ `npm run smoke:admin-page` passed against backend admin routes and Telegram auth session routes |
| Bank-transfer-only policy | ✅ `NAIRA_PAYMENT_METHODS=bank_transfer` enforced in provider docs/code paths |
| Monnify adapter readiness | ✅ Sandbox auth/init/verify-pending and paid transfer verification proof passed; signed webhook delivery proof pending |
| Monnify webhook route | ✅ Deployed route is reachable and rejects unsigned payloads fail-closed |
| Flutterwave backup readiness | 🟡 Adapter/webhook/server-side verification implemented; low-value backup proof pending |

## Current Progress

```text
Provider-neutral Naira interface: 82%
Paystack behind provider interface: 100%
Monnify collection transport: 92%
Payment-provider admin switching: 90%
Provider live-test readiness: 75%
Monnify sandbox initialization proof: 100%
Monnify paid-transfer verification proof: 100%
Monnify signed webhook proof: 0%
Monnify live-readiness proof: 75%
Flutterwave backup transport: 65%
```

## Monnify Sandbox Initialization Proof

The Monnify adapter authenticated against sandbox, initialized a bank-transfer-only transaction, received a dynamic transfer account, and verified the payment reference server-side as `pending`.

```text
Provider: monnify
Payment reference: monnify-SIV-SANDBOX-75312368
Transaction reference present: yes
Transfer account present: yes
Bank returned: Sterling bank
Server-side verification status: pending
Currency: NGN
Channel: ACCOUNT_TRANSFER
```

Additional paid transfer proof now passed:

```text
Payment reference: monnify-click-proof-1781205462197
Transaction reference: MNFY|54|20260611201745|000028
Status: PAID
Amount paid: NGN 100
Expected amount: NGN 100
Method: ACCOUNT_TRANSFER
Settlement amount: NGN 90
```

This proves Monnify sandbox bank-transfer payment verification. Signed `SUCCESSFUL_TRANSACTION` webhook delivery into deployed Sivan is still pending.

## Remaining Work

- Confirm Monnify signed webhook delivery into deployed `/webhooks/monnify`.
- Confirm Monnify settlement event proof appears in Reconciliation and Revenue.
- Keep `PAYMENT_PROVIDER_FALLBACK_ENABLED=false` until Paystack and Monnify both pass live transfer tests.
- Run Flutterwave low-value backup proof before enabling it for users.
