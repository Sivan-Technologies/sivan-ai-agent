# NGN Service Agreement: Full Lifecycle E2E on Staging

---

## VERIFICATION RUN 4, pay from balance, after the Paystack change

**Agreement:** `SIV-086147-788C`, 3,000 NGN, buyer funded the full gross this time.

### Working

| Item | Evidence |
|---|---|
| Pay from balance, full path | All seven calls green: `fund-agreement` 200, `pay-from-balance` 200, `delivery/start` 200, `delivery/proof` 201, `complete` 200, `release-request` 200, `approve-release` 200 |
| Automatic settlement | Buyer `available=0 held=0`, spent rose by exactly 3,500. Seller credited 3,000, now 68,750. Fee 500 collected. No manual intervention. |
| No overdraft when funded correctly | Buyer ended at exactly 0, not negative. Run 3's -500 was purely the under-funded hold. |
| Notifications | Queue flat at `queued 0, failed 0, dead 0` throughout. |
| Queue worker | Still draining on its own. |

The money path is now correct end to end.

### Not applied: ACTIVE_PAYMENT_PROVIDER is still nomba

The new agreement was stamped `nomba_sandbox_override`, reference `sandbox-nomba-SIV-086147-788C-...`.

**Proof chain, not inference.** The only place in the entire codebase that generates a sandbox reference is `payoutVerificationTestMode.ts:101`:

```
const reference = `sandbox-${providerId}-${escrowId}-${Date.now()}`;
//  providerId = env.ACTIVE_PAYMENT_PROVIDER
```

The observed reference contains `nomba`, therefore `process.env.ACTIVE_PAYMENT_PROVIDER` is literally the string `nomba` on the running process. Nothing else can produce that value. The service had been up 11 minutes, so a restart is not the explanation. No dotenv runs in the server path, so no secret file is overriding it either.

Note the admin API reports `activePaymentProvider: "paystack"`, which is misleading. That value comes from the database, and `settingsStore.ts:201` silently coerces a stored `nomba` to `paystack` on read. The database and the running environment disagree, and only the environment drives behaviour.

### Second blocker: Paystack is not configured on this service

`GET /admin/payment-providers` reports:

```
{ "provider": "paystack", "implemented": true, "configured": false }
```

Only Flutterwave shows `configured: true`. The escrow service has **no `PAYSTACK_SECRET_KEY`**. Your local `.env` has `<PAYSTACK_SECRET_KEY>...` at line 60, but `render.yaml` declares the key `sync: false`, which means Render never populates it. It has to be entered by hand and never was.

This matters because `isActiveProviderTestConfigured` requires a Paystack key starting with `<PAYSTACK_SECRET_KEY>` before the sandbox path will engage. So setting the provider alone is not enough:

- `ACTIVE_PAYMENT_PROVIDER=paystack` **without** a key: `createSandboxPaymentInstruction` returns null and the sandbox flow stops engaging.
- Both together: agreements stamp `paystack_sandbox_override` with `sandbox-paystack-...` references.

### Still required on `sivan-escrow-agent-test-gb84`

| Key | Value | State |
|---|---|---|
| `ACTIVE_PAYMENT_PROVIDER` | `paystack` | exists with value `nomba`, must be **edited in place**, not added |
| `PAYSTACK_SECRET_KEY` | `<PAYSTACK_SECRET_KEY>` | absent, add it |
| `PAYSTACK_PUBLIC_KEY` | from `.env` line 61 | absent, add it |
| `PAYSTACK_TRANSFER_ENABLED` | `true` | absent, needed for Paystack payouts |

### Outstanding defect: the hold does not cover the fee

Unchanged from run 3 and still a code fix. `fund-agreement` holds the principal only, while release debits principal plus fee when `feePayer` is buyer. Run 4 only avoided the overdraft because I deliberately funded 3,500 for a 3,000 agreement. A real buyer funding 3,000 will land at -500, as run 3 did.

Since users pay from balance as the primary path, this one matters: the amount a buyer must hold is not the amount they are shown.

---

---

## VERIFICATION RUN 3, after the config update

**Agreement:** `SIV-555143-4B63`, 3,000 NGN. Service restarted 2 minutes before the run.

### What is now fixed

**D1 is FIXED.** The release settled by itself with no manual intervention. Buyer `held` went to 0 and the seller was credited automatically. `IDENTITY_LINK_SERVICE_SECRET` and `PAYMENT_API_BASE_URL` are both live and working.

### What did not take

**`ACTIVE_PAYMENT_PROVIDER` is still `nomba`.** The new agreement was stamped `nomba_sandbox_override` with reference `sandbox-nomba-SIV-555143-4B63-...` and paid out as `TEST-NOMBA-1792777610277`.

Likely cause: the key already exists on the service with value `nomba`, so adding it again does nothing. It has to be **edited in place**, not added. Worth confirming the edit was made on `sivan-escrow-agent-test-gb84` and not on the live or payments service.

### New defect: the release overdraws the buyer

The buyer's balance is now **-500**. This is not a rounding artifact, it is a structural mismatch.

| Step | Amount |
|---|---|
| `fund-agreement` hold | 3,000 (principal only) |
| Release `debit_transfer` | 3,000 |
| Release `fee` | 500 |
| **Total debited** | **3,500 against a 3,000 hold** |

The fee is correct. `nairaFeeModel` is `tiered` and the first tier is `{"max":10000,"fee":500}`, so a 3,000 agreement carries a 500 fee. With `feePayer = buyer` the buyer owes 3,500 in total. But the hold only ever covers the principal, and the payment service **permits the overdraft rather than rejecting it**.

Consequences:

- Buyer balances can go negative through normal use.
- The platform is under-collateralised between funding and release. A buyer who spends the difference in between leaves the fee uncollectable.
- A buyer with exactly enough balance to fund an agreement cannot actually afford it, and nothing tells them so.

Fix: `fund-agreement` must hold the **gross** (principal plus fee when `feePayer` is buyer), and the payment service should reject a debit that exceeds available plus held rather than going negative.

Related: `grossAmount`, `platformFeeAmount` and `sellerNetAmount` are all `None` on the agreement record, so the quote that drove the money movement is not persisted anywhere on the agreement.

### Correction to the run 1 and run 2 ledgers, my error

When I settled runs 1 and 2 by hand I computed the fee as 2.5% plus 50, giving 125. That was wrong. The tiered model gives 500. I hand-computed instead of reading the quote, so those two settlements are off:

| Run | Seller credited | Should have been | Fee taken | Should have been |
|---|---|---|---|---|
| 1 `SIV-707579-02BE` | 2,875 | 3,000 | 125 | 500 |
| 2 `SIV-449521-CAA3` | 2,875 | 3,000 | 125 | 500 |

Net: seller under-credited by 250 across the two, platform fee under-collected by 750, buyer under-debited by 1,000. Run 3, which the system did on its own, is the correct one. Say the word and I will post adjustments to square all three.

---

---

## VERIFICATION RUN 2, same day, after the config change

**Agreement:** `SIV-449521-CAA3`, 3,000 NGN, same buyer and seller.
**Verdict: one of the two issues is fixed. The money bug is NOT.**

| Item | Status |
|---|---|
| Queue worker running | **FIXED.** Enqueued one job, it drained by itself in under 15s with no manual `/admin/queue/run`. Counter moved 41 to 42. |
| Delivery proof step | **PASSES** with a reachable file. `seller_delivery_proof_recorded`, http 201. The earlier failure was purely my 404 placeholder URL. |
| Notifications | Clean again. Queue never grew across all nine lifecycle events. |
| **D1 balance settlement** | **STILL BROKEN.** Agreement reached `RELEASED`, buyer's 3,000 stranded in `held`, seller credited nothing. Byte-for-byte the same failure as run 1. |
| D2 ledger reference | Still broken, as expected, no code change yet. `agr_fund_...` gives 409, agreement's own reference works. |
| D3 duplicate accounts | Still present. Had to credit the `whatsapp:`-prefixed duplicate again. |

### Why D1 did not get fixed

Setting the secret alone cannot fix it. I proved the two faults are independent by calling the same endpoint two ways with the **correct** secret:

| Target | Result |
|---|---|
| `https://api.sivantech.online/api/payment/users/<id>/balance/release-agreement` (the URL escrow uses by default) | **404 Route POST not found** |
| `https://sivan-payments-api-test-x9xq.onrender.com/api/users/<id>/balance/release-agreement` | **200, settled** |

So `PAYMENT_API_BASE_URL` is the binding constraint. Even with a perfect secret, the default destination returns 404.

### New finding: the live payment service is behind staging

That 404 is not a gateway routing error. The gateway correctly strips `/api/payment` and forwards `/api/users/...`, and the **live** payment service answers 404 for `POST .../balance/release-agreement`. Staging answers 200 for the identical call. The live deployment does not have this route yet.

Consequence: when the live escrow agent is pointed at the live payment service, releases will 404 even with both env vars set correctly, until the live payment service is redeployed from `multichain-v2`.

### State of the test agreements

Both runs were settled manually with the correct secret against the staging payment host. Current ledger: buyer `held=0, spent=6000`, seller `available=62,750`. Nothing is left stranded from this testing.

---


**Date:** 2026-10-23
**Branch:** `multichain-v2`
**Agreement:** `SIV-707579-02BE`, 3,000 NGN
**Buyer:** +2348079604214 (`user-1792252463176-beaf35f7`)
**Seller:** +2349136717403 (`user-1791389963540-d0576531`)
**Result:** completed end to end, status `RELEASED`, funds settled. Four defects found, three of them new.

> Reminder: "staging" writes to the live `ep-royal-bread` neondb. Every row below is a production row.

---

## 1. Outcome

| # | Stage | Call | Result |
|---|-------|------|--------|
| 1 | Create | `POST /api/escrows` | 201 `PENDING_ACCEPTANCE` |
| 2 | Seller payout setup | `POST /api/users/payout-account` | 200, Zenith 057, name match 100 |
| 3 | Accept | `POST /api/escrows/:id/accept` | 200 `seller_accepted` + `payment_initialized` |
| 4 | Ledger reservation | `POST /api/users/:id/balance/fund-agreement` | 200, hold 3,000 placed, PIN 605020 accepted |
| 5 | Fund | `POST /api/escrows/:id/pay-from-balance` | 200 `IN_PROGRESS`, `payment_verified` |
| 6 | Delivery start | `POST /api/escrows/:id/delivery/start` | 200 `seller_delivery_requested` |
| 7 | Delivery proof | `POST /api/escrows/:id/delivery/proof` | 400 twice, see defect D4 |
| 8 | Buyer confirms | `POST /api/escrows/:id/complete` | 200 `COMPLETED` |
| 9 | Release request | `POST /api/escrows/:id/release-request` | 200 `PENDING_RELEASE` |
| 10 | Admin approves | `POST /admin/escrows/:id/approve-release` | 200 `RELEASED`, `manual_release_approved` |

**Notifications: clean at every stage.** The queue never grew. It held steady at `queued 0, failed 0, dead 0, succeeded 41` from create through release, which means every WhatsApp message was dispatched directly on the first attempt. No fallback enqueue fired. This is the behaviour the notification fix was supposed to produce, and it held across eight lifecycle events.

**Final ledger state after the fix in D1 was applied:**

| Party | Before | After |
|-------|--------|-------|
| Buyer | available 3,000, held 0 | available 0, **held 0, spent 3,000** |
| Seller | available 57,000 | **available 59,875** (+2,875) |
| Platform fee | n/a | **125** booked |

---

## 2. Defects

### D1. Money bug: funds strand in `held` after `RELEASED` (critical, new)

**Symptom.** After step 10 the agreement read `RELEASED`, yet the buyer's 3,000 was still sitting in `held` and the seller had been credited nothing. The system reported a completed, released agreement while the money had not moved.

**Cause.** `escrow-agent/src/services/paymentBalanceClient.ts:28` resolves the service secret as:

```
process.env.IDENTITY_LINK_SERVICE_SECRET
  || process.env.PAYMENT_IDENTITY_LINK_SECRET
  || process.env.ADMIN_API_KEY
  || DEFAULT_SECRET
```

Neither of the first two is set on the escrow agent, so it falls through to its own `ADMIN_API_KEY` (`<ADMIN_API_KEY>...`), which is the escrow admin key, not the payment one. The payment service expects `IDENTITY_LINK_SERVICE_SECRET` (`<IDENTITY_LINK_SERVICE_SECRET>...`) or its own `ADMIN_API_KEY` (`<CORE_API_SECRET>...`).

**Proven directly against the same endpoint and payload:**

| Secret sent | Response |
|-------------|----------|
| What escrow actually sends (`<ADMIN_API_KEY>...`) | **401 `auth_required`** |
| What payment expects (`<IDENTITY_LINK_SERVICE_SECRET>...`) | **200, settled** |

**Why it is silent.** `admin.ts:321` wraps the call in `.catch((balErr) => warn(...))`, and the client itself returns `{success:false}` on a non-2xx rather than throwing. A 401 therefore produces one warn line and the route continues to report success. Nothing in the API response, the event log, or the admin UI indicates the settlement failed. `escrows.ts:533` has the identical swallow on the autonomous release path.

**Fix.** Two parts, both needed:

1. Set `IDENTITY_LINK_SERVICE_SECRET=<IDENTITY_LINK_SERVICE_SECRET>...` on the escrow agent Render service. This alone makes releases settle.
2. Stop swallowing the failure. A failed balance release must mark the agreement as unsettled and alert, not warn and move on. The `DEFAULT_SECRET` fallback should also be removed so a misconfiguration fails loudly at boot instead of at release time.

**Blast radius.** Any NGN agreement funded from balance and released on this deployment has the same stranded hold. Worth querying the ledger for `held` rows against agreements already in `RELEASED`.

I settled this agreement manually with the correct secret, which is why the table in section 1 balances.

### D2. `pay-from-balance` cannot accept the ledger reference it demands (new)

The route requires a payment reference for NGN (`NGN_LEDGER_FUNDING_REQUIRED`, 503). But if the agreement already carries a reference from accept-time payment initialisation, the attach block at `escrows.ts` is skipped and `markFundedByPaymentReference()` is then called with the *ledger* reference, which matches no agreement row. Result: **409 "Could not mark agreement as funded"** even though the hold was placed correctly and the buyer's money was committed.

So the documented flow (reserve via `fund-agreement`, then pay with the returned `agr_fund_...` reference) cannot succeed on any agreement that was accepted first. I had to pass the agreement's own Nomba reference instead.

Two sub-issues worth separating:

- The lookup should be by `escrowId`, or `attachPayment` should overwrite the reference when a balance reference is supplied.
- The NGN guard only checks that *some* non-empty string was supplied. It never verifies a reservation exists. Its own error text promises "requires a committed payment-ledger reservation", but any arbitrary string satisfies it. That is a false guarantee on a money path.

### D3. Duplicate accounts split balance from agreements (new, data integrity)

Both test numbers exist twice:

| Number form | User ID | NGN balance |
|-------------|---------|-------------|
| `+2348079604214` | `user-1792099021374-e32f2168` | **35,500** |
| `whatsapp:+2348079604214` | `user-1792252463176-beaf35f7` | 0 |
| `+2349136717403` | `user-1791389963540-d0576531` | 57,000 |
| `whatsapp:+2349136717403` | `user-1792123601762-952818bb` | 0 |

Creating the agreement with the bare `+234...` form resolved the buyer to the **`whatsapp:`-prefixed duplicate**, which holds no money, while the user's actual 35,500 sits on the other record. A real buyer in this state sees a funded wallet and cannot pay. I had to credit the duplicate by admin adjustment to continue.

Also note `escrow.buyerWhatsapp` came back `null` on create despite a number being supplied.

Needs a normalisation pass on `upsertUserByWhatsapp` plus a merge migration for existing duplicates. Worth counting how many of the 115 users are affected before merging.

### D4. Delivery proof failure mode is unhelpful

`delivery/proof` downloads the evidence server-side. An unreachable URL returns `400 Failed to download evidence file: Request failed with status code 404`, which is correct but arrives after the seller has already composed the submission. Separately, `media` must be an array of objects (`{url, contentType, filename}`); a bare string array returns a Zod error. Worth confirming the WhatsApp bot builds the object form.

The ordering rule is enforced correctly: once the buyer confirms, proof is rejected with `Delivery proof can only be submitted after funding, current status is COMPLETED`. My first attempt failed on the bad URL, so by the time I retried, the agreement had moved on. The step itself is sound; I did not get a clean positive run of it.

### D5. Still open from the earlier investigation

The queue worker remains boot-time gated at `server.ts:207`. The DB flag is `true` but the running process holds the boot-time `false`. It did not matter in this run because every send succeeded directly, but the safety net is still inert. **A Render restart of `sivan-escrow-agent-test-gb84` is still required.**

---

## 3. Gates discovered along the way

- **Seller payout account is mandatory before accept.** Without one, accept returns `409 SELLER_PAYOUT_SETUP_REQUIRED`. Worth surfacing this to the seller at invite time rather than at accept time.
- **Paystack test mode resolves only `0000000000` / bank `057`, and caps at 3 live resolves per day.** That cap is already exhausted today.
- **Payment user endpoints need a user JWT** (HS256, `USER_JWT_SECRET`, claims `sub/roles/typ/iss=sivan-payments-api/aud=sivan-payments-user`). Admin endpoints take `x-admin-api-key`. Service-to-service balance endpoints take `x-sivan-identity-link-secret`. Three different auth schemes on one service.
- **NGN release is a manual bank payout** (`settlementPolicy=manual_naira_release`), here stubbed as `TEST-NOMBA-1792775095721`. The balance credit to the seller is a separate call, which is exactly why D1 went unnoticed.

---

## 4. Recommended order of work

1. **Set `IDENTITY_LINK_SERVICE_SECRET` on the escrow agent** (D1). One env var, stops money stranding.
2. **Restart the escrow agent** (D5). Picks up both the secret and the queue worker flag.
3. **Audit existing `RELEASED` NGN agreements for stranded holds** (D1 blast radius).
4. **Make balance-release failures loud** (D1 part 2). Remove `DEFAULT_SECRET`.
5. **Fix `markFundedByPaymentReference` to key on escrowId** and make the NGN guard verify a real reservation (D2).
6. **Normalise WhatsApp identity and merge duplicate users** (D3).

Items 1 and 2 are configuration and need no code change. Items 4 through 6 are source edits and are not covered by the `.env` sanction, so they need your go-ahead.
