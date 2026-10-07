/**
 * Polls the payment provider for an escrow and advances its funding state,
 * notifying participants on transition.
 *
 * Extracted verbatim from escrowService.ts as step 8 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */
import { EscrowRecord } from "./escrowStore";
import { config } from "../config";
import { escrowStore, paymentRouter } from "../context";
import { getProviderForEscrow } from "./paymentService";
import { isSandboxPaymentReference } from "./payoutVerificationTestMode";
import { participantLifecycleMessage } from "./messageFormatter";
import { notifyEscrowParticipants, notifyEscrowFundedParticipants } from "./notificationOrchestrator";
import { reconcileEscrowPayment } from "./paymentReconciliation";

export async function refreshEscrowPaymentLifecycle(escrowId: string) {
  let escrow = await escrowStore.expirePendingPaymentIfDue(escrowId);

  if (escrow?.status === "PENDING_PAYMENT" && escrow.paymentReference) {
    try {
      if (escrow.currency === "USDC") {
        const paymentProvider = escrow.paymentProvider || "x402";
        let status: "pending" | "active" | "settled" | "failed" = "pending";

        try {
          if (paymentProvider === "sap") {
            const sap = paymentRouter.getSapAgent();
            if (!sap) throw new Error("Synapse SAP agent is not configured");
            const sapStatus = await sap.getEscrowStatus(escrow.paymentReference);
            status = (sapStatus.status === "funded" || sapStatus.status === "active") ? "active" : "pending";
          } else {
            const x402Status = await paymentRouter.getX402Client().getPaymentStatus(escrow.paymentReference);
            status = x402Status.status;
          }
        } catch (err: any) {
          console.warn("Failed to check live USDC payment status from provider", {
            escrowId: escrow.escrowId,
            error: err?.message || err,
          });
          // For sandbox test overrides, simulate funding if reference has override suffix or matches tests
          if (escrow.paymentReference.includes("sandbox") || escrow.paymentReference.startsWith("x402-")) {
            status = "pending";
          }
        }

        if (status === "active" || status === "settled") {
          const preReconcileSnapshot = await escrowStore.getEscrowById(escrowId);
          const alreadyFunded = preReconcileSnapshot && preReconcileSnapshot.status !== "PENDING_PAYMENT";
          const funded = await reconcileEscrowPayment(
            escrow.escrowId,
            {
              provider: paymentProvider,
              paymentReference: escrow.paymentReference,
              status: "success",
              amount: escrow.amount,
              currency: "USDC",
            },
            "admin_recheck",
            undefined,
            { skipLifecycleRefresh: true }
          );
          if (funded.status === "IN_PROGRESS" && !alreadyFunded) {
            await notifyEscrowFundedParticipants(funded);
          }
          escrow = funded;
        }
      } else {
        if (isSandboxPaymentReference(escrow.paymentReference)) {
          return escrow;
        }
        const provider = await getProviderForEscrow(escrow);
        const transaction = await provider.verifyPayment(escrow.paymentReference);
        if (transaction && (transaction.status === "success" || transaction.status === "successful")) {
          const preReconcileSnapshot = await escrowStore.getEscrowById(escrowId);
          const alreadyFunded = preReconcileSnapshot && preReconcileSnapshot.status !== "PENDING_PAYMENT";
          const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck", undefined, { skipLifecycleRefresh: true });
          if (funded.status === "IN_PROGRESS" && !alreadyFunded) {
            await notifyEscrowFundedParticipants(funded);
          }
          escrow = funded;
        }
      }
    } catch (err: any) {
      console.warn("Failed to check provider payment status during read sync", {
        escrowId: escrow.escrowId,
        error: err?.message || err,
      });
    }
  }

  const before = await escrowStore.getEscrowById(escrowId);
  if (before && escrow && before.status !== "EXPIRED" && escrow.status === "EXPIRED") {
    await notifyEscrowParticipants(
      escrow,
      participantLifecycleMessage(
        escrow,
        "This escrow expired because payment was not received within the funding window.",
        "Create a new escrow if both parties still want to continue."
      )
    );
  }
  if (escrow?.status === "PENDING_PAYMENT" && escrow.fundingExpiresAt && !escrow.lastPaymentReminderAt) {
    const fundingExpiresAt = new Date(escrow.fundingExpiresAt);
    const reminderAt = new Date(fundingExpiresAt.getTime() - config.nairaPayments.fundingReminderBeforeExpiryHours * 60 * 60 * 1000);
    const now = new Date();
    if (!Number.isNaN(fundingExpiresAt.getTime()) && now.getTime() >= reminderAt.getTime() && now.getTime() < fundingExpiresAt.getTime()) {
      const reminded = await escrowStore.markPaymentReminderSent(escrow.escrowId, now.toISOString());
      await notifyEscrowParticipants(
        reminded || escrow,
        participantLifecycleMessage(
          reminded || escrow,
          "Payment is still pending and this escrow will expire soon.",
          "Buyer can reply PAY to get the current payment details."
        )
      );
      return reminded || escrow;
    }
  }
  return escrow;
}

export async function refreshEscrowPaymentLifecycleForRead(escrow: EscrowRecord | string, context: string) {
  try {
    const record = typeof escrow === "string" ? await escrowStore.getEscrowById(escrow) : escrow;
    if (!record) return null;
    if (record.status !== "PENDING_PAYMENT") {
      return record;
    }
    return await refreshEscrowPaymentLifecycle(record.escrowId);
  } catch (err: any) {
    const id = typeof escrow === "string" ? escrow : escrow?.escrowId;
    console.warn("Payment lifecycle refresh failed on read path", {
      escrowId: id,
      context,
      error: err?.message || err,
    });
    return typeof escrow === "string" ? escrowStore.getEscrowById(escrow) : escrow;
  }
}
