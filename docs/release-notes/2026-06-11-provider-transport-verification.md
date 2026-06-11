# Provider Transport Verification - 2026-06-11

## Result

Provider-neutral Naira payment transport checks passed locally and against the deployed backend. This verifies the code paths and operational endpoints around Paystack, Monnify readiness, provider settings, platform mode, maintenance messaging, reconciliation, revenue, and DR visibility.

| Check | Result |
| --- | --- |
| TypeScript build | ✅ `npm run build` passed |
| Automated tests | ✅ `npm test -- --run` passed: 14 test files, 77 tests |
| Live backend smoke | ✅ `npm run smoke` passed against Render |
| Live DR check | ✅ `npm run dr:check` passed against Render |
| Live admin-page smoke | ✅ `npm run smoke:admin-page` passed against backend admin routes and Telegram auth session routes |
| Bank-transfer-only policy | ✅ `NAIRA_PAYMENT_METHODS=bank_transfer` enforced in provider docs/code paths |
| Monnify adapter readiness | ✅ Sandbox auth/init/verify-pending proof passed; live transfer proof pending |
| Monnify webhook route | ✅ Deployed route is reachable and rejects unsigned payloads fail-closed |
| Flutterwave backup readiness | 🟡 Documented only; adapter/webhook not implemented |

## Current Progress

```text
Provider-neutral Naira interface: 82%
Paystack behind provider interface: 100%
Monnify collection transport: 88%
Payment-provider admin switching: 90%
Provider live-test readiness: 60%
Monnify sandbox initialization proof: 25%
Monnify live-transfer proof: 0%
Flutterwave backup transport: 10%
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

This is not yet a live-transfer proof because no buyer transfer was completed and no signed `SUCCESSFUL_TRANSACTION` webhook was received.

## Remaining Work

- Run `docs/monnify-live-test.md` with a real Monnify sandbox bank-transfer payment.
- Confirm Monnify webhook signature and server-side verification from the provider dashboard.
- Confirm Monnify settlement event proof appears in Reconciliation and Revenue.
- Keep `PAYMENT_PROVIDER_FALLBACK_ENABLED=false` until Paystack and Monnify both pass live transfer tests.
- Do not implement Flutterwave code until Monnify proof is complete or both Paystack and Monnify are blocked operationally.
