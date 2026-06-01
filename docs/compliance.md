# Sivan Compliance Plan

This document defines the production compliance path for Sivan's WhatsApp-first escrow MVP in Nigeria.

It is not legal advice. Treat it as an engineering and operations control plan to review with counsel, payment partners, and compliance advisors before scaling transaction volume.

## Position

Sivan should not start with full KYC for every user. The first live version should use a low-cost, risk-based model:

```text
WhatsApp phone identity
+ Paystack bank account resolution
+ account-name match scoring
+ internal risk scoring
+ manual payout approval
```

That gives Sivan a strong early trust foundation without adding unnecessary onboarding friction.

Full BVN/NIN/selfie verification should be added only when transaction size, fraud signals, or regulatory posture requires it.

## Compliance Layer Status

| Layer | Status | Summary |
| --- | --- | --- |
| Layer 1: Financial Compliance | 🟡 Partially complete | MVP phone/profile/bank resolution/name-match controls are implemented; full BVN/NIN/selfie KYC is not yet implemented |
| Layer 1C: AML MVP | 🟡 Partially complete | Velocity, high-value, shared-account, abuse signals, and operator review foundations exist; deeper dispute-ratio/user-level AML scoring remains next |
| Layer 1D: Release Controls | 🟡 Partially complete | Manual Naira payout approval, escrow-derived payout amount, payout verification, name-match, shared-account, and high-value gates exist; aggregate compliance risk gate and support-case automation remain next |
| Layer 2: Data Protection | ✅ Complete for MVP | Payout account tokenization, AES-256-GCM encryption, masking, and log redaction are implemented |
| Layer 3: Escrow Accounting | ✅ Complete for MVP | Funding, seller-net release, refund, and fee-capture ledger entries exist; full finance export/reconciliation reports remain future work |
| Layer 4: Fraud Engine | 🟡 Partially complete | Abuse signals, reputation actions, velocity/high-amount checks, shared-account/name-match release gates exist; deeper graph/dispute scoring remains next |
| Phase 2 KYC | 🔴 Not started | Prembly/Smile/Paystack identity-document validation abstraction is still future work |

Legend: ✅ complete for MVP, 🟡 partially complete, 🔴 not started, 🔮 future.

## Layer 1: Financial Compliance 🟡

### MVP Identity Verification

MVP identity verification should require:

| Check | Source | Status |
| --- | --- | --- |
| Phone number | WhatsApp/Twilio sender | ✅ Implemented as primary user identity |
| Full name | Private WhatsApp DM | ✅ Implemented for buyer and seller profiles |
| Bank account number | Private WhatsApp DM | ✅ Implemented; now encrypted/tokenized at rest |
| Bank/account name resolution | Paystack `/bank/resolve` | ✅ Implemented through `PaystackClient.resolveBankAccount` |
| Fallback bank search | Built-in Nigerian bank list | ✅ Implemented so setup can continue during Paystack bank-list outages |
| Fallback account name enquiry | Monnify Name Enquiry | 🟡 Implemented as optional fallback when credentials are configured |
| Name match score | Internal scoring | ✅ Implemented for MVP |
| BVN/NIN/selfie KYC | KYC provider | 🔴 Not started; Phase 2 |

Recommended flow:

```text
Seller enters first and last name
Seller selects bank
Seller enters account number
Backend resolves account through Paystack
Backend receives account_name
Backend computes name_match_score
Strong or medium match -> payout account verified
Weak match -> manual review
Failed match -> reject or support case
```

Paystack's Resolve Account Number API takes an account number and bank code and returns account details. Paystack documents this endpoint as free to use. Use this as Sivan's first verification layer.

### Name Match Scoring

Do not require exact names. Nigerian account names often include middle names, initials, ordering differences, or bank formatting.

Recommended scoring:

| Result | Example | Score | Decision |
| --- | --- | ---: | --- |
| Strong | `Jonathan Hart` vs `Jonathan Hart` | 95-100 | Auto approve |
| Medium | `Jonathan Hart` vs `Jonathan Benjamin Hart` | 80-94 | Auto approve for normal limits |
| Weak | `Jonathan Hart` vs `John Hart` | 55-79 | Manual review |
| Failed | `Jonathan Hart` vs `Michael James` | 0-54 | Reject or support case |

Store on the payout account:

```text
resolved_account_name
name_match_score
name_match_level
account_verified_at
account_verification_provider
```

Current implementation:

- `PaystackClient.resolveBankAccount` returns the resolved account name.
- If Paystack bank-list lookup is unavailable, the backend returns a built-in Nigerian bank fallback list so WhatsApp seller setup can continue.
- If Paystack account resolution fails and Monnify credentials are configured, the backend attempts Monnify Name Enquiry as a fallback account-name resolver.
- The backend compares seller profile name against the resolved account name.
- Strong and medium matches set `verification_status=verified`.
- Weak matches set `verification_status=pending` and block acceptance/release until manual review.
- Failed matches set `verification_status=failed` and return a verification error.

### Production KYC Phase 🔴

Do not add full KYC to the first live MVP unless a payment partner requires it.

Add Phase 2 KYC when:

- transaction size exceeds the manual review limit
- abuse signals cross the high-risk threshold
- a user has repeated disputes
- a seller requests high payout volume
- regulatory or payment partner requirements change

Recommended Phase 2 fields:

```text
kyc_level
bvn_verified
nin_verified
kyc_verified_at
kyc_provider
kyc_reference
```

Provider path:

| Provider | Recommended role |
| --- | --- |
| Paystack customer validation | Use when BVN + bank-account validation is needed for Paystack-specific workflows or dedicated account compliance |
| Monnify Name Enquiry | Optional fallback for Nigerian bank-account name enquiry when Monnify credentials are available |
| Prembly | Good Phase 2 startup KYC provider for BVN/NIN/phone/face checks |
| Smile ID | Stronger later option for broader African KYC, ID verification, face, and liveness |

Paystack's customer validation flow can validate bank-account details with identity documents, but bank support is country/bank dependent and the documented Validate Account flow is not the same low-friction Nigerian `/bank/resolve` lookup. Use it for higher-risk Paystack-backed flows where the required identity document is available, not as the first MVP gate.

## Layer 1C: AML MVP 🟡

Sivan does not need bank-grade AML on day one, but every escrow should produce risk signals.

Track these signals:

| Signal | Example | MVP action |
| --- | --- | --- |
| Velocity | 10 escrows today | ✅ Increases risk score |
| Large transaction | Amount above `NAIRA_HIGH_VALUE_REVIEW_AMOUNT` | ✅ Implemented release review gate |
| Shared payout account | Multiple sellers use same account token | ✅ Implemented payout review gate |
| High dispute rate | Seller dispute ratio above 30% | 🔴 Manual review/account limit scoring not yet implemented |
| New user | First transaction | 🟡 Basic user history exists; explicit new-user score still pending |
| Repeated device/fingerprint | Same device across many accounts | ✅ Risk/action foundation exists |

Store per escrow and per user:

```text
risk_score
risk_level
risk_reasons
risk_checked_at
```

Risk levels:

| Score | Level | Action |
| ---: | --- | --- |
| 0-20 | Low | Normal flow |
| 21-50 | Medium | Allow, record signal |
| 51-79 | High | Manual review before release |
| 80-100 | Critical | Block or require enhanced KYC |

## Layer 1D: Release Controls 🟡

Before any payout, Sivan should verify:

| Gate | Required for MVP |
| --- | --- |
| Buyer phone identity exists | ✅ Yes |
| Seller phone identity exists | ✅ Yes |
| Seller profile complete | ✅ Yes |
| Seller bank account resolved | ✅ Yes |
| Account name match acceptable | ✅ Yes |
| Payment verified | ✅ Yes |
| No active dispute | ✅ Yes |
| High-value review threshold | ✅ Yes |
| Shared payout account review | ✅ Yes |
| Aggregate user risk below release threshold | 🟡 Partial; deeper aggregate user risk is next |
| Admin approved Naira payout | ✅ Yes |
| Amount comes from escrow record | ✅ Yes |
| Admin enters payout amount manually | ❌ No |
| Admin records payout/reference ID only | ✅ Yes |

Recommended payout policy:

```text
PENDING_RELEASE
  -> run release readiness checks
  -> if checks pass, show admin payout approval action with escrow gross amount, fee, seller net payout, masked bank account, resolved name, and risk level
  -> admin pays the seller from Paystack dashboard, bank app, or later automated transfer
  -> admin records payout/reference ID only
  -> RELEASED
```

If a release check fails, keep the escrow in `REVIEW_REQUIRED` or block the release action with a specific compliance reason. Current release checks block weak/failed account-name matches, shared payout accounts, and high-value releases before admin payout approval.

Current payout approval behavior:

- ✅ The approval API accepts `manualPayoutReference` and optional notes only.
- ✅ Gross amount is loaded from the escrow record, not from admin input.
- ✅ Platform fee and seller net payout are calculated from platform fee settings.
- ✅ Release transactions and ledger entries record seller net payout.
- ✅ Fee-capture ledger entries record the platform fee when fee settings produce a positive fee.
- ✅ Admin Payout Safety shows gross amount, platform fee, seller net payout, masked payout account, resolved account name, and risk level.

## Layer 2: Data Protection ✅

Current status:

- payout account numbers are tokenized with HMAC
- payout account numbers are AES-256-GCM encrypted at rest
- payout account responses are masked as `****1234`
- logger redacts account numbers, checkout links, tokens, keys, signatures, and secret-like values
- `PAYOUT_ENCRYPTION_KEY` is required in production

Production requirements:

- keep `PAYOUT_ENCRYPTION_KEY` stable across deploys
- do not rotate it without a re-encryption migration
- use a separate `PAYOUT_TOKEN_SECRET` for deterministic account tokens
- keep `SENTRY_SEND_DEFAULT_PII=false`
- keep provider data scrubbing enabled in Sentry

## Layer 3: Escrow Accounting ✅

Sivan should add a ledger before volume grows.

Current system tracks escrow state and transactions. The backend now also writes a double-entry-style `ledger_entries` table for funding, seller-net release, refund, and fee-capture events:

| Event | Debit | Credit |
| --- | --- | --- |
| Buyer funds escrow | ✅ Buyer receivable/payment rail | ✅ Escrow liability |
| Seller net payout release | ✅ Escrow liability | ✅ Seller payable/payment rail |
| Buyer refund | ✅ Escrow liability | ✅ Buyer refund/payment rail |
| Fee capture | ✅ Escrow liability | ✅ Sivan revenue |

Recommended table:

```text
ledger_entries
- ledger_entry_id
- escrow_id
- transaction_id
- entry_type
- debit_account
- credit_account
- amount
- currency
- provider_reference
- created_at
```

Do this before high transaction volume. It prevents reconciliation and accounting problems later.

Remaining ledger work: add explicit fee-capture entries once fee policy is finalized.

## Layer 4: Fraud Engine 🟡

Sivan already has abuse signals and reputation actions. Expand them into explicit compliance-grade risk decisions.

Initial scoring:

| Event | Score |
| --- | ---: |
| New user | 🔴 +5 pending |
| Large amount | ✅ +20/review gate implemented |
| Velocity spike | ✅ +20/risk scoring implemented |
| Multiple devices | ✅ +15/action foundation implemented |
| Multiple disputes | 🔴 +30 pending |
| Shared payout account | ✅ +25/review gate implemented |
| Account name weak match | ✅ +25/review gate implemented |
| Account name failed match | ✅ +60/rejection gate implemented |

Output:

```json
{
  "risk_score": 72,
  "risk_level": "HIGH",
  "risk_reasons": [
    "large_transaction",
    "shared_payout_account",
    "weak_name_match"
  ]
}
```

High risk should trigger manual review before release. Critical risk should block payout until compliance review or enhanced KYC is complete.

## Recommended Next Engineering Sequence

1. ✅ Add name match scoring for seller payout setup.
2. ✅ Store `resolved_account_name`, `name_match_score`, `name_match_level`, `account_verified_at`, and `account_verification_provider`.
3. ✅ Add shared payout account detection using the payout account token.
4. ✅ Add high-value amount review threshold.
5. ✅ Add release readiness checks before admin payout approval.
6. ✅ Add compliance fields to escrow detail through payout/readiness payloads.
7. ✅ Add ledger entries for funding, release, and refund.
8. ✅ Add fee ledger entries for admin-approved seller payouts.
9. 🟡 Add Phase 2 KYC provider abstraction for Prembly/Smile/Paystack identity validation.

## Sources

- Paystack Resolve Account Number API: https://docs-v2.paystack.com/identity-verification/verify-account-number/
- Paystack Customer Validation API: https://paystack.com/docs/identity-verification/validate-customer/
- Paystack Transfers documentation: https://paystack.com/docs/transfers/
- Monnify customer verification and Name Enquiry documentation: https://developers.monnify.com/docs/verification-api/verifying-your-customers
- Prembly BVN verification documentation: https://docs.prembly.com/reference/bvn-basic
