/**
 * releaseFinalizer.ts
 *
 * One place where an agreement actually becomes RELEASED.
 *
 * Finalisation used to live inline in the admin approve-release route, which
 * meant it could only ever be reached by an admin whose payout provider
 * returned "succeeded" synchronously. Paystack does not: initiatePayout
 * answers "pending" and the real outcome arrives later on a transfer.success
 * webhook. The webhook had no way to finish the job, so every Paystack release
 * parked in PENDING_RELEASE forever and the only way through was to override
 * the provider to manual_bank_transfer.
 *
 * Both callers now share this function, so an asynchronous payout finishes
 * exactly the way a synchronous one does.
 */

import { escrowStore, opsStore } from "../context";
import { calculateEscrowPayoutQuote } from "./paymentService";
import { releaseAgreementToSivanBalance } from "./paymentBalanceClient";
import { notifyEscrowParticipants, participantLifecycleMessage } from "./escrowService";
import { info, warn, error } from "../lib/logger";
import { EscrowRecord } from "./escrowStore";

export interface FinalizeReleaseInput {
  escrowId: string;
  /** Who or what is finalising: an admin username, or a provider webhook. */
  actor: string;
  /** Provider that actually paid out, e.g. "paystack" or "manual_bank_transfer". */
  payoutProvider: string;
  /** The provider's payout reference. Required: the store will not release without one. */
  payoutReference: string;
  payoutNotes?: string;
}

export interface FinalizeReleaseResult {
  escrow: EscrowRecord;
  payoutQuote: Awaited<ReturnType<typeof calculateEscrowPayoutQuote>>;
  /** True when the agreement was already RELEASED before this call. */
  alreadyReleased: boolean;
  /** False when the seller's balance could not be credited. */
  balanceCredited: boolean;
}

export async function finalizeEscrowRelease(input: FinalizeReleaseInput): Promise<FinalizeReleaseResult> {
  const escrow = await escrowStore.getEscrowById(input.escrowId);
  if (!escrow) throw new Error("Escrow not found");

  // Providers retry webhooks, and an admin may have already released by hand.
  // approveManualRelease is idempotent on RELEASED, but the money movement and
  // the participant notification below are not, so remember what we found.
  const alreadyReleased = escrow.status === "RELEASED";

  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);

  const updated = await escrowStore.approveManualRelease(input.escrowId, input.actor, {
    manualPayoutReference: input.payoutReference,
    payoutProvider: input.payoutProvider,
    payoutNotes: input.payoutNotes,
    grossAmount: payoutQuote.grossAmount,
    platformFeeAmount: payoutQuote.platformFeeAmount,
    sellerNetAmount: payoutQuote.sellerNetAmount,
  });

  if (alreadyReleased) {
    info("Release finalisation skipped, agreement was already released", {
      escrowId: updated.escrowId,
      actor: input.actor,
      payoutReference: input.payoutReference,
    });
    return { escrow: updated, payoutQuote, alreadyReleased: true, balanceCredited: true };
  }

  info("Release finalised", {
    escrowId: updated.escrowId,
    actor: input.actor,
    payoutProvider: input.payoutProvider,
    payoutReference: input.payoutReference,
    grossAmount: payoutQuote.grossAmount,
    platformFeeAmount: payoutQuote.platformFeeAmount,
    sellerNetAmount: payoutQuote.sellerNetAmount,
  });

  // Move the money. A failure here means the agreement reads RELEASED while the
  // seller has not been paid, so it is recorded and queued for a human rather
  // than logged and forgotten.
  let balanceCredited = true;
  try {
    const balanceResult = await releaseAgreementToSivanBalance(
      updated,
      payoutQuote.sellerNetAmount,
      payoutQuote.platformFeeAmount
    );
    if (!balanceResult?.success) {
      balanceCredited = false;
      throw new Error(balanceResult?.error || "Balance release reported failure");
    }
  } catch (balErr: any) {
    balanceCredited = false;
    const reason = balErr?.message || String(balErr);
    error("Agreement released but the seller balance was not credited", {
      escrowId: updated.escrowId,
      sellerNetAmount: payoutQuote.sellerNetAmount,
      error: reason,
    });
    await escrowStore
      .addEvent({
        escrowId: updated.escrowId,
        actor: input.actor,
        actorRole: "system",
        channel: "system",
        previousStatus: updated.status,
        nextStatus: updated.status,
        eventType: "balance_release_failed",
        reason,
        metadata: {
          payoutProvider: input.payoutProvider,
          payoutReference: input.payoutReference,
          sellerNetAmount: payoutQuote.sellerNetAmount,
        },
      })
      .catch(() => undefined);
    await opsStore
      .enqueueJob("payout_review", {
        escrowId: updated.escrowId,
        provider: input.payoutProvider,
        reference: input.payoutReference,
        reason: `Seller balance not credited after release: ${reason}`,
      })
      .catch(() => undefined);
  }

  await notifyEscrowParticipants(
    updated,
    participantLifecycleMessage(
      updated,
      `Service completed. Payout was confirmed for ${updated.currency === "NAIRA" ? "NGN" : updated.currency} ${new Intl.NumberFormat("en-NG").format(payoutQuote.sellerNetAmount)}.`,
      `Payout provider: ${input.payoutProvider}\nProvider reference: ${updated.manualPayoutReference || input.payoutReference}`
    )
  ).catch((notifyErr: any) => {
    warn("Release notification failed", {
      escrowId: updated.escrowId,
      error: notifyErr?.message || String(notifyErr),
    });
  });

  return { escrow: updated, payoutQuote, alreadyReleased: false, balanceCredited };
}
