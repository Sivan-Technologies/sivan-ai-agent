/**
 * Assembles the full read-model of an escrow (participants, payment state,
 * compliance, transaction trace) and the dispute views built on top of it.
 *
 * Extracted verbatim from escrowService.ts as step 9 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */
import { escrowStore, opsStore } from "../context";
import { calculateEscrowPayoutQuote, calculateComplianceRisk } from "./paymentService";
import { hasBlockingComplianceRisk } from "./complianceRisk";
import { getTransactionTrace, syncEscrowTransactionReferences } from "./transactionReferences";
import { resolveR2MediaUrls } from "./mediaResolver";
import { refreshEscrowPaymentLifecycleForRead } from "./paymentLifecycleRefresh";

export async function buildEscrowDetail(escrowId: string) {
  const escrow = await refreshEscrowPaymentLifecycleForRead(escrowId, "escrow_detail");
  if (!escrow) return null;

  const [buyer, seller, transactions, events, ledgerEntries] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
    escrowStore.listTransactions(escrow.escrowId),
    escrowStore.listEvents(escrow.escrowId, 100),
    escrowStore.listLedgerEntries(escrow.escrowId),
  ]);
  await syncEscrowTransactionReferences(escrow, transactions);
  const transactionTrace = await getTransactionTrace('escrow', escrow.escrowId);
  const resolvedEvents = await resolveR2MediaUrls(events);
  const payout = escrow.sellerUserId ? await escrowStore.getPayoutAccount(escrow.sellerUserId) : null;
  const buyerProfileComplete = Boolean(buyer?.firstName && buyer?.lastName);
  const sellerProfileComplete = Boolean(seller?.firstName && seller?.lastName);
  const payoutVerified = Boolean(payout && payout.verificationStatus === "verified");
  const payoutNameMatchAcceptable = Boolean(payout && ["strong", "medium"].includes(payout.nameMatchLevel || ""));
  const payoutReleaseReady = Boolean(payoutVerified && payoutNameMatchAcceptable && !payout?.sharedAccountFlag);
  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);
  const complianceRisk = await calculateComplianceRisk(escrow);
  const aggregateRiskReleaseReady = !hasBlockingComplianceRisk(complianceRisk);

  return {
    transactionTrace,
    escrow,
    buyer,
    seller,
    payout,
    payoutQuote,
    transactions,
    events: resolvedEvents,
    ledgerEntries,
    complianceRisk,
    readiness: {
      buyerProfileComplete,
      sellerProfileComplete,
      payoutVerified,
      payoutNameMatchAcceptable,
      sharedPayoutAccountFlag: Boolean(payout?.sharedAccountFlag),
      payoutReleaseReady,
      aggregateRiskReleaseReady,
      sellerAccepted: !["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status),
      fundingVerified: ["IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      buyerCompleted: ["COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      releaseRequested: escrow.status === "PENDING_RELEASE",
      nextAction:
        escrow.status === "EXPIRED"
          ? "payment_expired"
          : escrow.status === "REVIEW_REQUIRED"
          ? "payment_reconciliation_required"
          : escrow.status === "PENDING_ACCEPTANCE"
          ? "seller_acceptance_required"
          : escrow.currency === "NAIRA" && !sellerProfileComplete
          ? "seller_profile_required"
          : escrow.currency === "NAIRA" && !payoutVerified
          ? "seller_payout_verification_required"
          : escrow.currency === "NAIRA" && !payoutNameMatchAcceptable
          ? "seller_payout_name_match_review_required"
          : escrow.currency === "NAIRA" && payout?.sharedAccountFlag
          ? "shared_payout_account_review_required"
          : escrow.status === "PENDING_PAYMENT"
          ? "buyer_payment_required"
          : escrow.status === "IN_PROGRESS"
          ? "buyer_completion_required"
          : escrow.status === "COMPLETED"
          ? "release_request_required"
          : escrow.status === "PENDING_RELEASE"
          ? "admin_manual_payout_required"
          : "monitor",
    },
  };
}

export async function buildDisputeRows(limit = 100) {
  const escrows = await escrowStore.listEscrows(limit);
  const disputeEscrows = escrows.filter((escrow) => escrow.status === "DISPUTED");
  return Promise.all(disputeEscrows.map(async (escrow) => {
    const [events, transactions, supportCases] = await Promise.all([
      escrowStore.listEvents(escrow.escrowId, 25),
      escrowStore.listTransactions(escrow.escrowId),
      opsStore.searchSupportCases(escrow.escrowId, 10),
    ]);
    const resolvedEvents = await resolveR2MediaUrls(events);
    const evidenceCount = events.filter((event) => event.eventType === "dispute_evidence_recorded").length;
    const openedAt = events.find((event) => event.eventType === "dispute_opened")?.createdAt || escrow.updatedAt;
    return {
      escrow,
      openedAt,
      evidenceCount,
      latestEventAt: events[0]?.createdAt || escrow.updatedAt,
      supportCases,
      transactions,
      events: resolvedEvents,
    };
  }));
}

export async function disputeHistoryForEscrow(escrowId: string) {
  const detail = await buildEscrowDetail(escrowId);
  if (!detail) return null;
  const eventTypes = new Set(["dispute_opened", "dispute_evidence_recorded", "dispute_resolved"]);
  return {
    escrowId,
    status: detail.escrow.status,
    events: detail.events.filter((event) => eventTypes.has(event.eventType)),
    transactions: detail.transactions.filter((transaction) => ["refund", "release"].includes(transaction.transactionType)),
  };
}
