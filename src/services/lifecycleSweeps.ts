/**
 * Scheduled sweeps: expire inspection windows and refresh payment lifecycle in
 * batches. Invoked by the background workers in server.ts.
 *
 * Extracted from escrowService.ts as part of the god-service split. Not covered
 * by the plan's responsibility map. No logic changes.
 */
import { escrowStore, settingsStore } from "../context";
import { capturePaymentWarning } from "./monitoring";
import { participantLifecycleMessage } from "./messageFormatter";
import { notifyEscrowParticipants } from "./notificationOrchestrator";
import { refreshEscrowPaymentLifecycle } from "./paymentLifecycleRefresh";

export async function checkInspectionExpirations() {
  const delivered = await escrowStore.listEscrowsByStatus("DELIVERED", 250);
  
  let transitionedCount = 0;
  const now = new Date().toISOString();
  
  const settings = await settingsStore.getSettings();
  if (!settings.autoReleaseEnabled) {
    return 0;
  }
  for (const escrow of delivered) {
    if (escrow.inspectionExpiresAt && now >= escrow.inspectionExpiresAt) {
      try {
        await escrowStore.completeEscrow(escrow.escrowId, "system-sweep", "system_lifecycle_sweep");
        const updated = await escrowStore.requestRelease(escrow.escrowId, "system-sweep", "system_lifecycle_sweep", {
          nairaHighValueAmount: settings.nairaHighValueReviewAmount,
          usdcHighValueAmount: settings.usdcHighValueReviewAmount,
        });
        await notifyEscrowParticipants(
          updated,
          participantLifecycleMessage(
            updated,
            "The inspection window has expired. Work has been automatically confirmed as completed.",
            updated.status === "RELEASED"
              ? "Autonomous USDC release executed successfully."
              : "Payout request has been queued for manual review."
          )
        );
        transitionedCount++;
      } catch (err: any) {
        capturePaymentWarning("Sweep failed to auto-complete delivered escrow", {
          escrowId: escrow.escrowId,
          error: err.message,
        });
      }
    }
  }
  return transitionedCount;
}

export async function runPaymentLifecycleSweep(limit = Number(process.env.PAYMENT_LIFECYCLE_WORKER_BATCH_SIZE || "250")) {
  const pending = await escrowStore.listEscrowsByStatus("PENDING_PAYMENT", limit);
  
  // Process sequentially rather than via Promise.all. The old code launched up
  // to 250 concurrent refreshEscrowPaymentLifecycle calls, each of which may
  // hit an external provider API (x402, Paystack, Monnify) AND run database
  // queries. On Render free tier this exhausted the Postgres connection pool
  // and crashed the entire process with "timeout exceeded when trying to
  // connect", taking every route down.
  let refreshedCount = 0;
  for (const escrow of pending) {
    try {
      await refreshEscrowPaymentLifecycle(escrow.escrowId);
      refreshedCount++;
    } catch (err: any) {
      // One failing agreement must not stop the sweep. The most common failure
      // is a stale x402 payment reference returning 404 after 3 retries, which
      // is harmless - the agreement simply stays in PENDING_PAYMENT until the
      // next sweep or until a webhook arrives.
      console.warn("Payment lifecycle sweep: single agreement refresh failed", {
        escrowId: escrow.escrowId,
        error: err?.message || err,
      });
    }
  }

  const autoCompletedCount = await checkInspectionExpirations();
  
  return { scanned: pending.length, refreshed: refreshedCount, autoCompleted: autoCompletedCount };
}
