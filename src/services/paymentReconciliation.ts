/**
 * Matches an inbound payment event against what an escrow expects and advances
 * it when the amounts reconcile.
 *
 * Extracted from escrowService.ts as part of the god-service split. These
 * functions were not covered by the plan's responsibility map. No logic changes.
 */
import { escrowStore } from "../context";
import { EscrowRecord } from "./escrowStore";
import type { NormalizedPaymentEvent } from "./paymentEventNormalizer";
import { calculateEscrowPayoutQuote } from "./paymentService";
import { capturePaymentWarning } from "./monitoring";
import { refreshEscrowPaymentLifecycle } from "./paymentLifecycleRefresh";

export function amountsMatch(expected: number, received: number, baseEscrowAmount?: number) {
  const roundedExpected = Math.round(expected * 100);
  const roundedReceived = Math.round(received * 100);
  if (roundedExpected === roundedReceived) return true;
  if (baseEscrowAmount !== undefined && Math.round(baseEscrowAmount * 100) === roundedReceived) return true;
  const diffFromExpected = Math.abs(expected - received);
  const diffFromBase = baseEscrowAmount !== undefined ? Math.abs(baseEscrowAmount - received) : Infinity;
  const maxAllowedDiff = Math.max(expected * 0.05, 500);
  return diffFromExpected <= maxAllowedDiff || diffFromBase <= maxAllowedDiff;
}

export async function expectedFundingAmount(escrow: EscrowRecord) {
  const quote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);
  return quote.totalWithFee;
}

export async function reconcileEscrowPayment(
  escrowId: string,
  transaction: any,
  source: "webhook" | "admin_recheck",
  normalizedEvent?: NormalizedPaymentEvent,
  options: { skipLifecycleRefresh?: boolean } = {}
): Promise<EscrowRecord> {
  const escrow = options.skipLifecycleRefresh
    ? await escrowStore.getEscrowById(escrowId)
    : await refreshEscrowPaymentLifecycle(escrowId);
  if (!escrow) throw new Error("Escrow not found");
  const storedTransaction = await escrowStore.getTransactionByReference(transaction.paymentReference);
  const reconciliationMetadata = normalizedEvent ? { ...transaction, normalizedEvent } : transaction;

  if (storedTransaction?.status === "expired" || (escrow.paymentReference && escrow.paymentReference !== transaction.paymentReference)) {
    capturePaymentWarning("Naira escrow payment arrived for an expired or inactive payment instruction", {
      escrowId,
      provider: transaction.provider,
      paymentReference: transaction.paymentReference,
      activePaymentReference: escrow.paymentReference || null,
      receivedAmount: transaction.amount,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: ["late_payment_after_expired_instruction"],
      reason: "Payment arrived for an expired or inactive payment instruction",
      reference: transaction.paymentReference,
      metadata: { ...reconciliationMetadata, source, activePaymentReference: escrow.paymentReference || null },
    });
  }

  if (escrow.status === "EXPIRED") {
    capturePaymentWarning("Naira escrow payment arrived after payment instruction expiry", {
      escrowId,
      provider: transaction.provider,
      paymentReference: transaction.paymentReference,
      receivedAmount: transaction.amount,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: ["late_payment_after_expiry"],
      reason: "Payment arrived after the payment instruction expired",
      reference: transaction.paymentReference,
      metadata: { ...reconciliationMetadata, source, expiredStatus: escrow.status },
    });
  }

  if (transaction.status !== "success") {
    capturePaymentWarning("Naira escrow transaction verification did not confirm success", {
      escrowId,
      provider: transaction.provider,
      paymentReference: transaction.paymentReference,
      status: transaction.status,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: [`${transaction.provider}_verification_not_success`],
      reason: `${transaction.provider} verification returned ${transaction.status}`,
      reference: transaction.paymentReference,
      metadata: { ...reconciliationMetadata, source },
    });
  }

  const expectedAmount = await expectedFundingAmount(escrow);
  if (!amountsMatch(expectedAmount, transaction.amount, escrow.amount)) {
    capturePaymentWarning("Naira escrow payment amount mismatch", {
      escrowId,
      provider: transaction.provider,
      paymentReference: transaction.paymentReference,
      expectedAmount,
      escrowAmount: escrow.amount,
      receivedAmount: transaction.amount,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: ["payment_amount_mismatch"],
      reason: `Expected ${expectedAmount} ${escrow.currency}, received ${transaction.amount} ${transaction.currency}`,
      reference: transaction.paymentReference,
      metadata: { ...reconciliationMetadata, source, expectedAmount, escrowAmount: escrow.amount },
    });
  }

  const funded = await escrowStore.markFundedByPaymentReference(transaction.paymentReference, { ...reconciliationMetadata, source });
  if (!funded) {
    throw new Error(`Verified ${transaction.provider} transaction did not match an escrow payment reference`);
  }
  return funded;
}
