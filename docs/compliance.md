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

## Layer 1: Financial Compliance

### MVP Identity Verification

MVP identity verification should require:

| Check | Source | Status |
| --- | --- | --- |
| Phone number | WhatsApp/Twilio sender | Implemented as primary user identity |
| Full name | Private WhatsApp DM | Implemented for buyer and seller profiles |
| Bank account number | Private WhatsApp DM | Implemented; now encrypted/tokenized at rest |
| Bank/account name resolution | Paystack `/bank/resolve` | Implemented through `PaystackClient.resolveBankAccount` |
| Name match score | Internal scoring | Next engineering task |

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

### Production KYC Phase

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
| Prembly | Good Phase 2 startup KYC provider for BVN/NIN/phone/face checks |
| Smile ID | Stronger later option for broader African KYC, ID verification, face, and liveness |

Paystack's customer validation flow can validate bank-account details with BVN, but it is asynchronous and tied to customer validation workflows. Use it for higher-risk Paystack-backed flows, not as the first MVP gate.

## Layer 1C: AML MVP

Sivan does not need bank-grade AML on day one, but every escrow should produce risk signals.

Track these signals:

| Signal | Example | MVP action |
| --- | --- | --- |
| Velocity | 10 escrows today | Increase risk score |
| Large transaction | Amount above `NAIRA_HIGH_VALUE_REVIEW_AMOUNT` | Manual review |
| Shared payout account | Multiple sellers use same account token | Manual review |
| High dispute rate | Seller dispute ratio above 30% | Manual review or account limit |
| New user | First transaction | Mild risk increase |
| Repeated device/fingerprint | Same device across many accounts | Risk increase |

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

## Layer 1D: Release Controls

Before any payout, Sivan should verify:

| Gate | Required for MVP |
| --- | --- |
| Buyer phone identity exists | Yes |
| Seller phone identity exists | Yes |
| Seller profile complete | Yes |
| Seller bank account resolved | Yes |
| Account name match acceptable | Next engineering task |
| Payment verified | Yes |
| No active dispute | Yes |
| Risk score below release threshold | Next engineering task |
| Admin approved Naira payout | Yes |

Recommended payout policy:

```text
PENDING_RELEASE
  -> run release readiness checks
  -> if checks pass, show admin payout approval action
  -> admin records payout reference
  -> RELEASED
```

If a release check fails, keep the escrow in `REVIEW_REQUIRED` or `PENDING_RELEASE` and create/support-link an operator review case.

## Layer 2: Data Protection

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

## Layer 3: Escrow Accounting

Sivan should add a ledger before volume grows.

Current system tracks escrow state and transactions. The next production accounting step is a double-entry-style ledger:

| Event | Debit | Credit |
| --- | --- | --- |
| Buyer funds escrow | Buyer receivable/payment rail | Escrow liability |
| Seller payout release | Escrow liability | Seller payable/payment rail |
| Buyer refund | Escrow liability | Buyer refund/payment rail |
| Fee capture | Escrow liability | Sivan revenue |

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

## Layer 4: Fraud Engine

Sivan already has abuse signals and reputation actions. Expand them into explicit compliance-grade risk decisions.

Initial scoring:

| Event | Score |
| --- | ---: |
| New user | +5 |
| Large amount | +20 |
| Velocity spike | +20 |
| Multiple devices | +15 |
| Multiple disputes | +30 |
| Shared payout account | +25 |
| Account name weak match | +25 |
| Account name failed match | +60 |

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

1. Add name match scoring for seller payout setup.
2. Store `name_match_score`, `name_match_level`, and `account_verified_at`.
3. Add shared payout account detection using the payout account token.
4. Add high-value amount review threshold.
5. Add release readiness checks before admin payout approval.
6. Add compliance/risk fields to admin escrow detail and reconciliation rows.
7. Add ledger entries for funding, release, refund, and fees.
8. Add Phase 2 KYC provider abstraction for Prembly/Smile/Paystack BVN validation.

## Sources

- Paystack Resolve Account Number API: https://docs-v2.paystack.com/identity-verification/verify-account-number/
- Paystack Customer Validation API: https://paystack.com/docs/identity-verification/validate-customer/
- Paystack Transfers documentation: https://paystack.com/docs/transfers/
- Prembly BVN verification documentation: https://docs.prembly.com/reference/bvn-basic

