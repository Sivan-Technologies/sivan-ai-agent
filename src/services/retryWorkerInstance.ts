import { RetryWorker } from "./retryWorker";
import { opsStore, escrowStore } from "../context";
import { notifyWhatsAppBotStrict } from "./notificationService";
import { getProviderForEscrow } from "./paymentService";
import { capturePaymentWarning } from "./monitoring";
import { reconcileEscrowPayment } from "./escrowService";
import { runDailyReconciliation } from "./reconciliationService";

export const retryWorker = new RetryWorker(opsStore, {
  whatsapp_notification: async (payload) => {
    if (!payload.to || !payload.message) {
      throw new Error("whatsapp_notification requires payload.to and payload.message");
    }
    await notifyWhatsAppBotStrict(
      String(payload.to),
      String(payload.message),
      payload.dealCard,
      Array.isArray(payload.media) ? (payload.media as string[]) : undefined
    );
  },
  payment_recheck: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("payment_recheck requires paymentReference");
    const escrow = payload.escrowId
      ? await escrowStore.getEscrowById(String(payload.escrowId))
      : await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for payment reference");
    const provider = await getProviderForEscrow(escrow);
    const transaction = await provider.verifyPayment(paymentReference);
    await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
  },
  paystack_recheck: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("paystack_recheck requires paymentReference");
    const escrow = payload.escrowId
      ? await escrowStore.getEscrowById(String(payload.escrowId))
      : await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for payment reference");
    const provider = await getProviderForEscrow(escrow);
    const transaction = await provider.verifyPayment(paymentReference);
    await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
  },
  webhook_recovery: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("webhook_recovery requires paymentReference");
    const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for webhook recovery payment reference");
    const provider = await getProviderForEscrow(escrow);
    const transaction = await provider.verifyPayment(paymentReference);
    await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
  },
  payout_review: async (payload) => {
    if (!payload.escrowId) throw new Error("payout_review requires escrowId");
    const escrow = await escrowStore.getEscrowById(String(payload.escrowId));
    if (!escrow) throw new Error("Escrow not found for payout review");
    capturePaymentWarning("Payout retry job requires manual operator review", {
      escrowId: escrow.escrowId,
      status: escrow.status,
      manualPayoutReference: escrow.manualPayoutReference,
      reason: payload.reason || "payout_review",
    });
  },
  daily_reconciliation: async (payload) => {
    await runDailyReconciliation({
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      providers: Array.isArray(payload.providers) ? payload.providers : undefined,
      reason: payload.reason || "queue_job",
      alertOnFindings: payload.alertOnFindings !== false,
    });
  },
}, {
  baseDelayMs: Number(process.env.QUEUE_RETRY_BASE_DELAY_MS || "30000"),
  maxDelayMs: Number(process.env.QUEUE_RETRY_MAX_DELAY_MS || "1800000"),
  lockTimeoutSeconds: Number(process.env.QUEUE_LOCK_TIMEOUT_SECONDS || "300"),
});
