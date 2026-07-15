The Future Roadmap (What to build next)
To turn Sivan from a solid startup product into an industry giant, here are the next milestones to focus on:

## 🔮 Next Milestones to Focus On

### Semi-Automated Dispute Arbitration:
*   **Current**: If a dispute is filed, an admin has to manually inspect the files and trigger a release/refund.
*   **Upgrade**: Use the Ace Data Cloud AI to scan the R2 delivery proof (OCR read the text on delivery receipts, check the metadata) and provide the admin with an AI-generated recommendation: *"We verified the delivery document matches the seller's tracking reference. Recommended action: Payout to seller."*

### Reputation Locks & Draft Limits (Anti-Spam UX):
*   **Goal**: Minimize Twilio notification expenses caused by unpaid abandoned agreements.
*   *   **Single-Draft Limit**: Restrict unverified/new users to exactly one active unpaid draft at any given time.
*   *   **Auto-Expiry Acceleration**: Automatically expire unpaid drafts within 2–4 hours (instead of the default 24 hours) for unverified users to release database locks and prevent spam.

---

## 🏆 Completed Milestones & Features

*   🟢 **Comprehensive Interactive Button Suites (UI/UX Upgrade)**: Successfully created, registered, and integrated 11 dedicated Twilio interactive Content Templates (Welcome, Seller Invite, Confirm agreement, Action confirmation, Help Guide, and 6 transactional deal cards covering all states). Button actions have 0% typing syntax errors.
*   🟢 **Sleek Emojis & Aesthetic Polish**: Updated all button titles with matching, vibrant emojis (e.g., `✅`, `🤝`, `📋`, `💳`, `❌`, `🔙`, `💸`, `⚠️`, `🔑`, `🚀`) to align Sivan with modern premium neobanking and payment experiences.
*   🟢 **Robust Emoji Normalization**: Integrated automated symbol-stripping in the webhook's quick-reply handler to clean incoming emojis and ensure buttons work perfectly regardless of their visual decorations.
*   🟢 **Onboarding Rate Limit Bypass**: Implemented a secure backend bypass key for internal bot webhook requests, resolving 429 rate limit issues during high-volume agreement creations.
*   🟢 **Service Agreement Nomenclature Aligned**: Cleaned up bot copies and template scripts to use "Service Agreement" consistently, removing legacy escrow terminology from user-facing screens.
*   🟢 **Interactive Help & Guide System**: Registered and wired a native `sivan_help_guide` card to handle the `❓ Help & Guide` intent with pre-configured quick replies.
*   🟢 **Dynamic Fee Allocation Models (Production-Grade)**: Implemented support for Buyer Pays, Seller Pays, and 50/50 Split fee structures. Calculates quotas and updates payout allocations dynamically during the agreement lifecycle.
*   🟢 **Agreement Dispute Timers / Auto-Release (Configurable)**: Implemented dynamic timers where the admin can toggle auto-release ON/OFF and configure the inspection window dynamically via the Next.js admin dashboard hub. Added full API and database E2E coverage.