# 2026-06-04 Escrow Limit Review Deployment

## Deployment

- Backend/admin commit: `4deedc3` (`Add escrow limit review workflow`)
- WhatsApp bot commit: `6657589` (`Handle escrow limit reviews in WhatsApp`)
- Backend deployed through the `airspexta` branch.
- WhatsApp bot deployed through the `airspexta` branch.
- Admin frontend merge `bf5a5a7` was pushed to `main`, but the Vercel production URL continued serving the previous bundle. Direct CLI deployment was blocked because the saved Vercel token is invalid. Run `vercel login`, then deploy `frontend/` with `vercel --prod`.

## Production Verification

The live verification used API-originated test requests so no WhatsApp test messages were sent. Original platform settings were captured before the test and restored in a `finally` path.

| Scenario | Result |
| --- | --- |
| Normal low-value creation | ✅ `201`, escrow `SIV-111160-BC18` |
| New-buyer over-tier request | ✅ `409 ESCROW_LIMIT_REVIEW_REQUIRED`, durable review created |
| Admin one-time approval | ✅ Review marked `approved`, escrow `SIV-113428-19FC` created without changing global policy |
| Admin rejection | ✅ Review marked `rejected`, no escrow created |
| Buyer active-exposure limit | ✅ `409 BUYER_EXPOSURE_LIMIT_REACHED`, review created and rejected |
| Settings restoration | ✅ New-buyer limit restored to ₦100,000 and buyer active-exposure limit restored to ₦500,000 |
| Backend production smoke | ✅ All health, readiness, database, DR, operations, queue, webhook, reconciliation, support, abuse, dispute, and event checks passed |
| WhatsApp production smoke | ✅ Bot/core health passed; Twilio signature and notify-secret enforcement returned expected `401` |
| Admin frontend production bundle | 🟡 Code merged to `main`; Vercel re-auth/direct deployment still required |

## Local Verification

- Backend full suite: ✅ 51 tests passed.
- Backend focused admin/review workflow: ✅ 16 tests passed.
- WhatsApp bot suite: ✅ 17 tests passed, 1 intentional webhook test skipped.
- Backend and admin frontend production builds: ✅ passed.
- WhatsApp bot production build: ✅ passed.

## Operational Notes

- Requests above the configured special approval maximum remain hard-blocked and cannot be overridden.
- Tier, buyer-exposure, and platform-exposure blocks create durable review records.
- Approval applies only to the reviewed request and does not modify global limits.
- Admin decisions require notes and are recorded with operator identity and timestamps.
- WhatsApp-originated reviews notify the buyer after approval/rejection and send the normal seller invite after approval.
