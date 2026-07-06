# Release Notes — July 6, 2026

## Summary of Changes

We implemented a secure payment simulation layer for sandbox testing, resolved duplicate WhatsApp notification loops that were exhausting Twilio limits, and fixed image attachment forwarding for delivery proofs on the staging environment.

---

## Detailed Improvements

### 1. Interactive Sandbox Payment Simulator
- **New Simulator Interface**: Created a mobile-friendly payment simulation page at `/sandbox-pay` (managed by `src/routes/sandbox.ts`) that showcases deal descriptions, Escrow IDs, and exact Naira payment amounts.
- **Trigger Webhook Action**: Integrated a "Simulate Successful Payment" button that securely resolves payments in the database and triggers the webhook lifecycle to mark the escrow as funded (`IN_PROGRESS`).
- **Strict Security Gate**: The page is strictly disabled in production (`databaseMode: "live"`), returning a `403 Forbidden` error.

### 2. Payment Link Mappings & On-the-Fly Reconstruction
- **Initial Link Attachment**: Configured Sivan's sandbox payment generator to attach this new simulation URL as the `authorizationUrl` for newly accepted agreements.
- **Pay Now Fallback Recovery**: Modified `activeNairaPaymentInstructionForEscrow` in `src/services/paymentService.ts` to dynamically reconstruct sandbox checkout links on the fly for old sandbox references where the URL was not stored.

### 3. Eliminated Duplicate Notification Loops (Twilio Protection)
- **Status Read Deduping**: Fixed a critical bug in `refreshEscrowPaymentLifecycle` where checking the `STATUS` of a funded escrow would trigger new "Payment confirmed" messages repeatedly.
- **DB State Snapshots**: Sivan now captures the DB state before reconciling payment. It will only send the funded notification when the status actively transitions from `PENDING_PAYMENT` to `IN_PROGRESS`, resolving the Twilio message exhaustion issue.

### 4. Enabled Real R2 Uploads in Test Mode
- **Credentials-Based Upload**: Updated `storageService.ts` to perform actual file downloads and uploads to Cloudflare R2 when R2 credentials are present, rather than unconditionally mocking uploads in `test` database mode.
- **Delivery Proof Forwarding**: Allows the staging server to download Twilio media uploads via Basic Auth, save them to the test bucket, and forward valid presigned URLs to the buyer, resolving the missing delivery image issue on WhatsApp.

### 5. Render Service Alignment
- Added missing `NOTIFICATION_URL` values to `render.yaml` for both the `live` and `test` agent services to resolve silent notification failures.
