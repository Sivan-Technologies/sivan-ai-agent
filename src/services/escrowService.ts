import crypto from "crypto";
import { config } from "../config";
import axios from "axios";
import { EscrowCurrency, EscrowRecord, EscrowStore } from "./escrowStore";
import { uploadEvidenceUrlToR2, getPresignedDownloadUrl } from "./storageService";
import {
  notifyWhatsAppBot,
  notifyWhatsAppBotStrict,
  notifyTelegramBot,

  getWhatsAppProviderStatus,
  switchWhatsAppProvider,
} from "./notificationService";
import {
  captureOperationalError,
  capturePaymentWarning,
  buildOperationalVisibility,
} from "./monitoring";
import { scoreAccountName } from "./nameMatch";
import { hasBlockingComplianceRisk } from "./complianceRisk";
import {
  escrowStore,
  opsStore,
  settingsStore,
  workflowStore,
  paymentRouter,
} from "../context";
import {
  calculateEscrowPayoutQuote,
  calculateComplianceRisk,
  getProviderForEscrow,
  fundingDeadlineForEscrow,
} from "./paymentService";
import type { NormalizedPaymentEvent } from "./paymentEventNormalizer";
import { isSandboxPaymentReference } from "./payoutVerificationTestMode";
import { getTransactionTrace, syncEscrowTransactionReferences } from "./transactionReferences";
import {
  sellerInviteMessage,
  escrowCreatedMessage,
  participantLifecycleMessage,
} from "./messageFormatter";
import { resolveR2MediaUrls } from "./mediaResolver";
import { refreshEscrowPaymentLifecycle, refreshEscrowPaymentLifecycleForRead } from "./paymentLifecycleRefresh";
import { notifyEscrowParticipants, notifyEscrowFundedParticipants, notifyBuyerDeliverySubmitted } from "./notificationOrchestrator";
import { queueWhatsAppNotification, sendOrQueueWhatsAppNotification } from "./notificationDispatcher";
import { buildParticipantDeal } from "./dealCardBuilder";
import { roleForEscrowParticipant } from "./participantIdentity";

// --- god-service split: public API barrel re-exports (callers unchanged) ---
export * from "./escrowUtils";
export * from "./messageFormatter";
export * from "./mediaResolver";
export * from "./participantIdentity";
export * from "./dealCardBuilder";
export * from "./notificationDispatcher";
export * from "./notificationOrchestrator";
export * from "./paymentLifecycleRefresh";

let lastAbuseTrendAlertAt = 0;

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

export async function recordDisputeEvidence(input: {
  escrow: EscrowRecord;
  actor: string;
  actorRole: string;
  channel: string;
  evidence: {
    evidenceType: string;
    source: string;
    summary: string;
    uri?: string;
    submittedBy?: string;
    notifyParticipants?: boolean;
  };
}) {
  const { escrow, actor, actorRole, channel, evidence } = input;
  await escrowStore.addEvent({
    escrowId: escrow.escrowId,
    actor,
    actorRole,
    channel,
    previousStatus: escrow.status,
    nextStatus: escrow.status,
    eventType: "dispute_evidence_recorded",
    reason: evidence.summary,
    metadata: JSON.stringify({
      evidenceType: evidence.evidenceType,
      uri: evidence.uri || null,
      recordedBy: actor,
      submittedBy: evidence.submittedBy || actor,
    }),
  });
  const supportCases = await opsStore.searchSupportCases(escrow.escrowId, 1);
  if (supportCases[0]) {
    await opsStore.addSupportNote(
      supportCases[0].caseId,
      actor,
      `${evidence.evidenceType}: ${evidence.summary}${evidence.uri ? ` (${evidence.uri})` : ""}`,
      "dispute_evidence"
    );
  }
  if (evidence.notifyParticipants) {
    await notifyEscrowParticipants(escrow, `Issue review update for ${escrow.escrowId}: ${evidence.summary}`);
  }
  return buildEscrowDetail(escrow.escrowId);
}

export function externalDeliveryLinksAllowed() {
  return process.env.DELIVERY_PROOF_ALLOW_EXTERNAL_LINKS === "true";
}

export function containsExternalLink(value: string) {
  return /\bhttps?:\/\/|\bwww\./i.test(value);
}

export async function validateDeliveryProofMedia(
  media: Array<{ url: string; contentType?: string; filename?: string }>
): Promise<void> {
  if (config.databaseMode === "test") {
    return;
  }

  const allowedMimeTypes = [
    "application/pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "video/mp4",
  ];

  for (const item of media) {
    const url = item.url;
    if (!url) {
      throw new Error("Evidence file URL is required");
    }

    // 1. Storage Isolation Validation
    const sivanBucketPattern = /sivan-(test|live)-bucket/i;
    const match = url.match(sivanBucketPattern);
    if (match) {
      const mode = match[1];
      if (mode !== config.databaseMode) {
        throw new Error(`Evidence storage mismatch: Cannot use a ${mode} storage URL in ${config.databaseMode} mode`);
      }
    }

    // 2. Anti-reuse validation (Immutable evidence check)
    const isLinked = await escrowStore.isMediaUrlLinked(url);
    if (isLinked) {
      throw new Error(`Evidence URL has already been submitted in a different transaction: ${url}`);
    }

    // 3. HTTP HEAD/GET range checks to verify size and content-type
    const isTwilioUrl = url.includes("api.twilio.com");
    const hasTwilioCreds = Boolean(config.twilio?.accountSid && config.twilio?.authToken);

    if (isTwilioUrl && !hasTwilioCreds) {
      if (item.contentType) {
        const matchesMimetype = allowedMimeTypes.some((mime) => item.contentType?.toLowerCase().startsWith(mime));
        if (!matchesMimetype) {
          throw new Error(`Unsupported evidence file type: ${item.contentType}. Only PDF, JPG, PNG, and MP4 are allowed.`);
        }
      }
      continue;
    }

    const requestHeaders: Record<string, string> = { "User-Agent": "SivanEvidenceValidator/1.0" };
    if (isTwilioUrl && hasTwilioCreds) {
      const auth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
      requestHeaders["Authorization"] = `Basic ${auth}`;
    }

    try {
      const res = await axios.head(url, { timeout: 8000, headers: requestHeaders });
      const serverType = String(res.headers["content-type"] || "").toLowerCase();
      const serverLength = Number(res.headers["content-length"] || 0);

      const matchesMimetype = allowedMimeTypes.some((mime) => serverType.startsWith(mime));
      if (!matchesMimetype) {
        throw new Error(`Unsupported evidence file type: ${serverType || "unknown"}. Only PDF, JPG, PNG, and MP4 are allowed.`);
      }

      const isVideo = serverType.startsWith("video/");
      const limit = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (serverLength > limit) {
        throw new Error(`Evidence file size exceeds the limit of ${isVideo ? "50MB" : "10MB"}: ${(serverLength / (1024 * 1024)).toFixed(1)}MB`);
      }
    } catch (err: any) {
      try {
        const getHeaders = { ...requestHeaders, Range: "bytes=0-10" };
        const res = await axios.get(url, {
          headers: getHeaders,
          timeout: 8000,
        });
        const serverType = String(res.headers["content-type"] || "").toLowerCase();
        const serverLength = Number(res.headers["content-range"]?.split("/")?.[1] || res.headers["content-length"] || 0);

        const matchesMimetype = allowedMimeTypes.some((mime) => serverType.startsWith(mime));
        if (!matchesMimetype) {
          throw new Error(`Unsupported evidence file type: ${serverType || "unknown"}. Only PDF, JPG, PNG, and MP4 are allowed.`);
        }

        const isVideo = serverType.startsWith("video/");
        const limit = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (serverLength > limit) {
          throw new Error(`Evidence file size exceeds the limit of ${isVideo ? "50MB" : "10MB"}: ${(serverLength / (1024 * 1024)).toFixed(1)}MB`);
        }
      } catch (getErr: any) {
        throw new Error(`Invalid or unreachable evidence upload link: ${err.message || String(err)}`);
      }
    }
  }
}

export async function recordDeliveryProof(input: {
  escrow: EscrowRecord;
  /**
   * Audit label for who submitted this proof - a WhatsApp address or a userId,
   * whichever the caller authenticated with. Authorization happened before this
   * point; this value is recorded, not trusted.
   */
  actor: string;
  summary: string;
  media: Array<{ url: string; contentType?: string; filename?: string }>;
  notifyBuyer: boolean;
}) {
  const { escrow, actor, summary, media, notifyBuyer } = input;

  const safeSummary = summary.trim() || "Seller submitted delivery proof";

  // Validate the evidence files first
  await validateDeliveryProofMedia(media);

  // Upload whitelisted media files to Cloudflare R2
  const uploadedMedia = await Promise.all(
    media.map(async (m) => {
      const filename = m.filename || `evidence_${Date.now()}.${m.contentType?.split("/")?.[1] || "pdf"}`;
      const r2Key = await uploadEvidenceUrlToR2(m.url, filename);
      return {
        ...m,
        url: `r2://${r2Key}`,
        originalUrl: m.url,
      };
    })
  );

  // Storage tagging and immutable linking
  const storageMode = config.databaseMode;
  const paymentReference = escrow.paymentReference || "unfunded_or_test";

  // Audit trail logging payload
  const auditTrail = {
    uploadedBy: actor,
    uploadedAt: new Date().toISOString(),
    escrowStage: escrow.status,
    paymentReference,
    storageMode,
  };

  const updated = await escrowStore.markDelivered(
    escrow.escrowId,
    actor,
    "whatsapp_dm",

    safeSummary,
    JSON.stringify({
      summary: safeSummary,
      media: uploadedMedia,
      mediaCount: uploadedMedia.length,
      externalLinksAllowed: externalDeliveryLinksAllowed(),
      auditTrail,
    })
  );

  if (notifyBuyer) await notifyBuyerDeliverySubmitted(updated, safeSummary, uploadedMedia);
  return buildEscrowDetail(escrow.escrowId);
}

export async function buildReconciliationRows(limit = 250) {
  const rawEscrows = await escrowStore.listEscrows(limit);
  // Process lifecycle refreshes sequentially to avoid exhausting the Postgres
  // connection pool. The old Promise.all launched up to 250 concurrent refresh
  // calls, each potentially hitting an external provider API.
  const escrows: EscrowRecord[] = [];
  for (const raw of rawEscrows) {
    const refreshed = await refreshEscrowPaymentLifecycleForRead(raw, "reconciliation");
    if (refreshed) escrows.push(refreshed);
  }
  return Promise.all(
    escrows.map(async (escrow) => {
      const [buyer, seller, payout, payoutQuote, complianceRisk, events] = await Promise.all([
        escrowStore.getUserById(escrow.buyerUserId),
        escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
        escrow.sellerUserId ? escrowStore.getPayoutAccount(escrow.sellerUserId) : Promise.resolve(null),
        calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer),
        calculateComplianceRisk(escrow),
        escrowStore.listEvents(escrow.escrowId, 50),
      ]);
      const settlementEvent = events.find((event) => event.eventType === "settlement_received");
      let settlementMetadata: any = {};
      try {
        settlementMetadata = settlementEvent?.metadata ? JSON.parse(settlementEvent.metadata) : {};
      } catch {
        settlementMetadata = {};
      }
      const settlementTransaction = settlementMetadata.transaction || {};
      const settlementReference = settlementMetadata.settlementReference || null;
      const settlementAmount = settlementTransaction.settlementAmount !== undefined
        ? Number(settlementTransaction.settlementAmount)
        : settlementMetadata.settlementAmount !== undefined
          ? Number(settlementMetadata.settlementAmount)
          : null;
      const settlementProviderFee = settlementTransaction.totalPayable !== undefined && settlementTransaction.settlementAmount !== undefined
        ? Math.max(0, Number(settlementTransaction.totalPayable) - Number(settlementTransaction.settlementAmount))
        : null;
      const isCrypto = ["USDC", "USDT", "SOL"].includes(String(escrow.currency || "").toUpperCase());
      const cryptoNetwork = String((escrow as any).network || "solana").toLowerCase();
      const cryptoNetworkName = cryptoNetwork.charAt(0).toUpperCase() + cryptoNetwork.slice(1);

      const flags = new Set(escrow.reconciliationFlags || []);
      if (escrow.status === "REVIEW_REQUIRED") flags.add("payment_review_required");
      if (escrow.status === "RELEASED" && !escrow.manualPayoutReference && !isCrypto) flags.add("missing_payout_reference");
      if (escrow.status === "PENDING_RELEASE") flags.add("release_awaiting_manual_payout");
      if (escrow.paymentProvider === "monnify" && !settlementReference && ["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) {
        flags.add("settlement_pending");
      }
      if ((escrow.reconciliationFlags || []).includes("payment_amount_mismatch")) flags.add("payment_amount_mismatch");
      const payoutVerified = isCrypto ? true : payout?.verificationStatus === "verified";
      if (!isCrypto && payout?.sharedAccountFlag) flags.add("shared_payout_account_review");
      if (!isCrypto && payout && !["strong", "medium"].includes(payout.nameMatchLevel || "")) flags.add("payout_name_match_review");
      const reconciliationRiskLevel = flags.has("payment_amount_mismatch") || flags.has("shared_payout_account_review") || flags.has("payout_name_match_review")
        ? "HIGH"
        : flags.size > 0
        ? "MEDIUM"
        : "LOW";
      const riskLevel =
        complianceRisk.riskLevel === "CRITICAL" || reconciliationRiskLevel === "HIGH"
          ? complianceRisk.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH"
          : complianceRisk.riskLevel === "HIGH" || reconciliationRiskLevel === "MEDIUM"
          ? complianceRisk.riskLevel === "HIGH" ? "HIGH" : "MEDIUM"
          : complianceRisk.riskLevel === "MEDIUM"
          ? "MEDIUM"
          : "LOW";

      return {
        escrowId: escrow.escrowId,
        buyer: buyer?.whatsappNumber || escrow.buyerUserId,
        seller: seller?.whatsappNumber || escrow.sellerWhatsapp || escrow.sellerUserId || "unassigned",
        sellerName: seller ? [seller.firstName, seller.lastName].filter(Boolean).join(" ") || null : null,
        expectedAmount: escrow.currency === "NAIRA" ? payoutQuote.totalWithFee : escrow.amount,
        receivedAmount: escrow.receivedAmount ?? null,
        currency: escrow.currency,
        grossAmount: payoutQuote.grossAmount,
        platformFeeAmount: payoutQuote.platformFeeAmount,
        sellerNetAmount: payoutQuote.sellerNetAmount,
        amountSource: payoutQuote.amountSource,
        paymentReference: escrow.paymentReference || null,
        paymentProvider: escrow.paymentProvider || null,
        payoutReference: escrow.manualPayoutReference || (isCrypto && escrow.status === "RELEASED" ? (escrow.txHash || (escrow as any).fundingTxHash || (escrow as any).depositTxHash || null) : null),
        payoutApprover: escrow.releasedBy || null,
        releaseTimestamp: escrow.releasedAt || null,
        status: escrow.status,
        flags: Array.from(flags),
        purpose: escrow.purpose,
        payoutVerified: isCrypto ? true : payoutVerified,
        payoutBankName: isCrypto ? `${cryptoNetworkName} Wallet (${escrow.currency})` : (payout?.bankName || null),
        payoutBankCode: isCrypto ? cryptoNetwork : (payout?.bankCode || null),
        payoutAccountNumber: isCrypto ? ((escrow as any).walletAddress || (escrow as any).depositAddress || "Sivan Embedded Wallet") : (payout?.accountNumber || null),
        resolvedAccountName: isCrypto ? `Sivan ${cryptoNetworkName} Balance` : (payout?.resolvedAccountName || payout?.accountName || null),
        nameMatchScore: isCrypto ? 100 : (payout?.nameMatchScore ?? null),
        nameMatchLevel: isCrypto ? "strong" : (payout?.nameMatchLevel || null),
        complianceRiskScore: complianceRisk.riskScore,
        complianceRiskLevel: complianceRisk.riskLevel,
        complianceRiskReasons: complianceRisk.riskReasons,
        reconciliationRiskLevel,
        riskLevel,
        paymentCheckedAt: escrow.paymentCheckedAt || null,
      };
    })
  );
}

export function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function reconciliationRowsToCsv(rows: Awaited<ReturnType<typeof buildReconciliationRows>>) {
  const headers = [
    "escrow ID",
    "buyer",
    "seller",
    "expected amount",
    "received amount",
    "platform fee",
    "seller net payout",
    "amount source",
    "currency",
    "payment reference",
    "payment provider",
    "payment status",
    "settlement reference",
    "settlement amount",
    "settlement provider fee",
    "settlement received at",
    "payout reference",
    "release approver",
    "release timestamp",
    "payout bank",
    "payout account",
    "resolved account name",
    "name match",
    "compliance risk score",
    "compliance risk level",
    "compliance risk reasons",
    "reconciliation risk level",
    "risk level",
    "status",
    "flags",
  ];
  const lines = rows.map((row) => [
    row.escrowId,
    row.buyer,
    row.seller,
    row.expectedAmount,
    row.receivedAmount,
    row.platformFeeAmount,
    row.sellerNetAmount,
    row.amountSource,
    row.currency,
    row.paymentReference,
    row.paymentProvider,
    row.paymentReference ? "success" : "pending",
    row.paymentReference,
    row.receivedAmount ?? row.expectedAmount,
    row.platformFeeAmount,
    row.paymentCheckedAt,
    row.payoutReference,
    row.payoutApprover,
    row.releaseTimestamp,
    row.payoutBankName,
    row.payoutAccountNumber,
    row.resolvedAccountName,
    row.nameMatchLevel,
    row.complianceRiskScore,
    row.complianceRiskLevel,
    row.complianceRiskReasons,
    row.reconciliationRiskLevel,
    row.riskLevel,
    row.status,
    row.flags,
  ].map(csvEscape).join(","));
  return [headers.map(csvEscape).join(","), ...lines].join("\n");
}

export async function buildRevenueAnalytics() {
  const [ledgerEntries, fundingTransactions] = await Promise.all([
    escrowStore.listRevenueLedgerEntries(),
    escrowStore.listRevenueTransactions(),
  ]);
  const includeSandbox = config.databaseMode === "test" || process.env.ALLOW_SANDBOX_REVENUE === "true";
  const sandboxTransactions = includeSandbox
    ? []
    : fundingTransactions.filter((transaction) =>
        /sandbox|test_override/i.test(transaction.provider) || /^sandbox-/i.test(transaction.reference || "")
      );
  const sandboxEscrowIds = new Set(sandboxTransactions.map((transaction) => transaction.escrowId));
  const productionLedgerEntries = ledgerEntries.filter((entry) => !sandboxEscrowIds.has(entry.escrowId));
  const productionFundingTransactions = fundingTransactions.filter((transaction) => !sandboxEscrowIds.has(transaction.escrowId));
  const now = Date.now();
  const periods = [
    { key: "day", label: "Last 24 hours", days: 1 },
    { key: "week", label: "Last 7 days", days: 7 },
    { key: "month", label: "Last 30 days", days: 30 },
    { key: "all", label: "All time", days: null },
  ] as const;
  const currencies: EscrowCurrency[] = ["NAIRA", "USDC"];
  const inPeriod = (createdAt: string, days: number | null) => days === null || new Date(createdAt).getTime() >= now - days * 86400000;

  const snapshots = periods.map((period) => ({
    key: period.key,
    label: period.label,
    currencies: currencies.map((currency) => {
      const funding = productionLedgerEntries.filter((entry) => entry.entryType === "funding" && entry.currency === currency && inPeriod(entry.createdAt, period.days));
      const fees = productionLedgerEntries.filter((entry) => entry.entryType === "fee" && entry.currency === currency && inPeriod(entry.createdAt, period.days));
      const processorTransactions = productionFundingTransactions.filter((transaction) => transaction.currency === currency && inPeriod(transaction.updatedAt, period.days));
      const processorFees = processorTransactions.filter((transaction) => transaction.processorFee !== undefined);
      const processedVolume = funding.reduce((sum, entry) => sum + entry.amount, 0);
      const platformFees = fees.reduce((sum, entry) => sum + entry.amount, 0);
      const processorFeeTotal = processorFees.reduce((sum, transaction) => sum + (transaction.processorFee || 0), 0);
      return {
        currency,
        processedVolume,
        processedCount: funding.length,
        platformFees,
        platformFeeCount: fees.length,
        processorFees: processorFeeTotal,
        processorFeeKnownCount: processorFees.length,
        processorTransactionCount: processorTransactions.length,
        processorFeeCoveragePercent: processorTransactions.length
          ? Math.round((processorFees.length / processorTransactions.length) * 10000) / 100
          : 0,
        netRevenueAfterProcessorFees: platformFees - processorFeeTotal,
      };
    }),
  }));

  const processorBreakdown = Object.values(productionFundingTransactions.reduce((acc, transaction) => {
    const key = `${transaction.provider}:${transaction.currency}`;
    acc[key] ||= {
      provider: transaction.provider,
      currency: transaction.currency,
      processedVolume: 0,
      transactionCount: 0,
      processorFees: 0,
      processorFeeKnownCount: 0,
    };
    acc[key].processedVolume += transaction.amount;
    acc[key].transactionCount += 1;
    if (transaction.processorFee !== undefined) {
      acc[key].processorFees += transaction.processorFee;
      acc[key].processorFeeKnownCount += 1;
    }
    return acc;
  }, {} as Record<string, {
    provider: string;
    currency: EscrowCurrency;
    processedVolume: number;
    transactionCount: number;
    processorFees: number;
    processorFeeKnownCount: number;
  }>));
  const settlementEvents = (await escrowStore.listSettlementReceivedEvents()).filter((event) => !sandboxEscrowIds.has(event.escrowId));
  const settlementSummary = Object.values(settlementEvents.reduce((acc, event) => {
    let metadata: any = {};
    try {
      metadata = event.metadata ? JSON.parse(event.metadata) : {};
    } catch {
      metadata = {};
    }
    const provider = String(metadata.provider || "unknown");
    const transaction = metadata.transaction || {};
    const settlementAmount = Number(transaction.settlementAmount ?? metadata.settlementAmount ?? 0);
    const totalPayable = Number(transaction.totalPayable ?? transaction.amountPaid ?? settlementAmount);
    const providerFee = Math.max(0, totalPayable - settlementAmount);
    acc[provider] ||= {
      provider,
      settlementCount: 0,
      settlementAmount: 0,
      providerFees: 0,
      latestSettlementAt: event.createdAt,
    };
    acc[provider].settlementCount += 1;
    acc[provider].settlementAmount += Number.isFinite(settlementAmount) ? settlementAmount : 0;
    acc[provider].providerFees += Number.isFinite(providerFee) ? providerFee : 0;
    if (new Date(event.createdAt).getTime() > new Date(acc[provider].latestSettlementAt).getTime()) {
      acc[provider].latestSettlementAt = event.createdAt;
    }
    return acc;
  }, {} as Record<string, {
    provider: string;
    settlementCount: number;
    settlementAmount: number;
    providerFees: number;
    latestSettlementAt: string;
  }>));

  return {
    generatedAt: new Date().toISOString(),
    accountingBasis: {
      processedVolume: "verified funding ledger entries",
      platformFees: "captured platform fee ledger entries",
      processorFees: "actual provider-reported transaction fees only",
      testActivity: "sandbox and test-override transactions excluded",
    },
    excludedTestActivity: {
      transactionCount: sandboxTransactions.length,
      processedVolumeByCurrency: currencies.map((currency) => ({
        currency,
        amount: sandboxTransactions.filter((transaction) => transaction.currency === currency).reduce((sum, transaction) => sum + transaction.amount, 0),
      })),
    },
    periods: snapshots,
    processorBreakdown,
    settlementSummary,
  };
}

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


export async function buildDatabaseStatus() {
  const startedAt = Date.now();
  const settings = await settingsStore.getSettings();
  await workflowStore.getWebhookEvents(1);
  await escrowStore.listEscrows(1);

  return {
    status: "ok",
    provider: config.app.databaseProvider,
    configured: Boolean(config.app.databaseUrl),
    settingsVersion: settings.version,
    platformMode: settings.platformMode,
    latencyMs: Date.now() - startedAt,
  };
}

export async function buildDisasterRecoveryStatus() {
  const [database, settings] = await Promise.all([
    buildDatabaseStatus(),
    settingsStore.getSettings(),
  ]);
  const provider = process.env.BACKUP_PROVIDER || (config.app.databaseProvider === "postgres" ? "managed-postgres" : "local-sqlite");
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || (config.app.databaseProvider === "postgres" ? "7" : "0"));
  const restoreMaxAgeDays = Number(process.env.BACKUP_RESTORE_TEST_MAX_AGE_DAYS || "30");
  const lastRestoreTestAt = process.env.BACKUP_LAST_RESTORE_TEST_AT || "";
  const lastRestoreTestStatus = process.env.BACKUP_LAST_RESTORE_TEST_STATUS || "not_recorded";
  const lastRestoreTime = lastRestoreTestAt ? new Date(lastRestoreTestAt).getTime() : 0;
  const restoreTestFresh = Boolean(lastRestoreTime && Date.now() - lastRestoreTime <= restoreMaxAgeDays * 24 * 60 * 60 * 1000);
  const backupConfigured = config.app.databaseProvider === "postgres" && retentionDays > 0;
  const rollbackConfigured = Boolean(process.env.ROLLBACK_RELEASE_URL || process.env.RENDER_SERVICE_ID || process.env.VERCEL_PROJECT_ID);
  const outageConfigured = Boolean(settings.outageStatusPageUrl || settings.outageContacts);
  const productionNeedsAttention =
    process.env.NODE_ENV === "production" &&
    (!backupConfigured || !restoreTestFresh || !rollbackConfigured || !outageConfigured);

  return {
    status: productionNeedsAttention ? "attention" : "ok",
    checkedAt: new Date().toISOString(),
    database,
    backup: {
      provider,
      configured: backupConfigured,
      retentionDays,
      policyUrlConfigured: Boolean(process.env.BACKUP_POLICY_URL),
      restoreRunbookConfigured: Boolean(process.env.BACKUP_RESTORE_RUNBOOK_URL),
    },
    restore: {
      lastTestAt: lastRestoreTestAt || null,
      lastStatus: lastRestoreTestStatus,
      maxAgeDays: restoreMaxAgeDays,
      fresh: restoreTestFresh,
    },
    rollback: {
      configured: rollbackConfigured,
      releaseUrlConfigured: Boolean(process.env.ROLLBACK_RELEASE_URL),
      renderServiceConfigured: Boolean(process.env.RENDER_SERVICE_ID),
      vercelProjectConfigured: Boolean(process.env.VERCEL_PROJECT_ID),
    },
    outage: {
      configured: outageConfigured,
      statusPageConfigured: Boolean(settings.outageStatusPageUrl),
      contactsConfigured: Boolean(settings.outageContacts),
      statusPageUrl: settings.outageStatusPageUrl || null,
      contacts: settings.outageContacts || null,
    },
    runbook: process.env.BACKUP_RESTORE_RUNBOOK_URL || "docs/disaster-recovery.md",
  };
}

export async function buildQueueStatus() {
  const status = await opsStore.queueStatus();
  return {
    status: status.dead > 0 || status.failed > 10 ? "attention" : "ok",
    ...status,
  };
}

export async function buildStuckEscrowStatus(limit = 250) {
  const settings = await settingsStore.getSettings();
  const thresholdMinutes = settings.stuckEscrowAlertMinutes;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const now = Date.now();
  const watchedStatuses = new Set(["PENDING_PAYMENT", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "REVIEW_REQUIRED", "DISPUTED"]);
  const escrows = await escrowStore.listEscrows(limit);
  const stuck = escrows
    .filter((escrow) => watchedStatuses.has(escrow.status))
    .filter((escrow) => now - new Date(escrow.updatedAt).getTime() > thresholdMs)
    .map((escrow) => ({
      escrowId: escrow.escrowId,
      status: escrow.status,
      currency: escrow.currency,
      updatedAt: escrow.updatedAt,
      ageMinutes: Math.round((now - new Date(escrow.updatedAt).getTime()) / 60000),
      paymentReference: escrow.paymentReference || null,
    }));

  return {
    status: stuck.length > 0 ? "attention" : "ok",
    thresholdMinutes,
    count: stuck.length,
    samples: stuck.slice(0, 25),
  };
}

export async function buildAbuseAnalytics(limit = 500) {
  const [signals, escrows] = await Promise.all([
    opsStore.listAbuseSignals(limit),
    escrowStore.listEscrows(limit),
  ]);
  const actions = await opsStore.listAbuseActions(limit);
  const severityCounts = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.severity] = (acc[signal.severity] || 0) + 1;
    return acc;
  }, {});
  const categoryCounts = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.category] = (acc[signal.category] || 0) + 1;
    return acc;
  }, {});
  const subjectMap = new Map<string, { subjectType: string; subjectId: string; signals: number; maxRiskScore: number; lastSeenAt: string; reasons: string[] }>();
  const fingerprintMap = new Map<string, { fingerprint: string; signals: number; maxRiskScore: number; lastSeenAt: string; subjects: string[]; sources: string[] }>();
  for (const signal of signals) {
    const key = `${signal.subjectType}:${signal.subjectId}`;
    const current = subjectMap.get(key) || {
      subjectType: signal.subjectType,
      subjectId: signal.subjectId,
      signals: 0,
      maxRiskScore: 0,
      lastSeenAt: signal.createdAt,
      reasons: [],
    };
    current.signals += 1;
    current.maxRiskScore = Math.max(current.maxRiskScore, signal.riskScore);
    current.lastSeenAt = current.lastSeenAt > signal.createdAt ? current.lastSeenAt : signal.createdAt;
    if (signal.reason && !current.reasons.includes(signal.reason)) current.reasons.push(signal.reason);
    subjectMap.set(key, current);

    try {
      const metadata = signal.metadata ? JSON.parse(signal.metadata) : {};
      const fingerprints = [
        metadata.deviceFingerprint ? `device:${metadata.deviceFingerprint}` : "",
        metadata.requestIp ? `ip:${metadata.requestIp}` : "",
        metadata.userAgent ? `ua:${String(metadata.userAgent).slice(0, 120)}` : "",
      ].filter(Boolean);
      for (const fingerprint of fingerprints) {
        const row = fingerprintMap.get(fingerprint) || {
          fingerprint,
          signals: 0,
          maxRiskScore: 0,
          lastSeenAt: signal.createdAt,
          subjects: [],
          sources: [],
        };
        row.signals += 1;
        row.maxRiskScore = Math.max(row.maxRiskScore, signal.riskScore);
        row.lastSeenAt = row.lastSeenAt > signal.createdAt ? row.lastSeenAt : signal.createdAt;
        if (!row.subjects.includes(signal.subjectId)) row.subjects.push(signal.subjectId);
        if (metadata.channel && !row.sources.includes(metadata.channel)) row.sources.push(metadata.channel);
        fingerprintMap.set(fingerprint, row);
      }
    } catch {
      // Ignore malformed historical metadata.
    }
  }

  const buyerVelocity = new Map<string, { buyerUserId: string; escrows: number; active: number; disputed: number; reviewRequired: number; latestAt: string }>();
  for (const escrow of escrows) {
    const current = buyerVelocity.get(escrow.buyerUserId) || {
      buyerUserId: escrow.buyerUserId,
      escrows: 0,
      active: 0,
      disputed: 0,
      reviewRequired: 0,
      latestAt: escrow.updatedAt,
    };
    current.escrows += 1;
    if (!["RELEASED", "FAILED", "EXPIRED", "CANCELLED"].includes(escrow.status)) current.active += 1;
    if (escrow.status === "DISPUTED") current.disputed += 1;
    if (escrow.status === "REVIEW_REQUIRED") current.reviewRequired += 1;
    current.latestAt = current.latestAt > escrow.updatedAt ? current.latestAt : escrow.updatedAt;
    buyerVelocity.set(escrow.buyerUserId, current);
  }

  const reputationWatchlist = Array.from(subjectMap.values())
    .sort((a, b) => b.maxRiskScore - a.maxRiskScore || b.signals - a.signals)
    .slice(0, 25);
  const fingerprintWatchlist = Array.from(fingerprintMap.values())
    .filter((row) => row.signals > 1 || row.maxRiskScore >= 60)
    .sort((a, b) => b.maxRiskScore - a.maxRiskScore || b.signals - a.signals)
    .slice(0, 25);
  const activeActionTargets = new Set(actions
    .filter((action) => !action.expiresAt || new Date(action.expiresAt).getTime() > Date.now())
    .map((action) => `${action.subjectType}:${action.subjectId}`));
  const suggestedActions = [
    ...reputationWatchlist
      .filter((item) => !activeActionTargets.has(`${item.subjectType}:${item.subjectId}`))
      .filter((item) => item.maxRiskScore >= 70 || item.signals >= 3)
      .map((item) => ({
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        suggestedAction: item.maxRiskScore >= 95 ? "block" : item.maxRiskScore >= 85 ? "limit" : "watch",
        confidence: Math.min(100, item.maxRiskScore + Math.min(item.signals, 10)),
        reason: `${item.signals} abuse signals; max risk ${item.maxRiskScore}`,
        evidence: item.reasons.slice(0, 5),
      })),
    ...fingerprintWatchlist
      .filter((item) => !activeActionTargets.has(`device:${item.fingerprint}`))
      .filter((item) => item.subjects.length >= 2 || item.maxRiskScore >= 80)
      .map((item) => ({
        subjectType: "device",
        subjectId: item.fingerprint,
        suggestedAction: item.maxRiskScore >= 90 ? "limit" : "watch",
        confidence: Math.min(100, item.maxRiskScore + item.subjects.length),
        reason: `${item.signals} signals across ${item.subjects.length} linked subjects`,
        evidence: item.subjects.slice(0, 10),
      })),
  ].sort((a, b) => b.confidence - a.confidence).slice(0, 25);

  const analytics = {
    totals: {
      signals: signals.length,
      criticalSignals: signals.filter((signal) => signal.severity === "critical").length,
      highSignals: signals.filter((signal) => signal.severity === "high").length,
      monitoredEscrows: escrows.length,
      activeActions: actions.filter((action) => !action.expiresAt || new Date(action.expiresAt).getTime() > Date.now()).length,
      suggestedActions: suggestedActions.length,
    },
    severityCounts,
    categoryCounts,
    actions: actions.slice(0, 50),
    reputationWatchlist,
    fingerprintWatchlist,
    velocityWatchlist: Array.from(buyerVelocity.values())
      .filter((row) => row.escrows >= Number(process.env.ABUSE_ESCROW_VELOCITY_LIMIT || "8") || row.disputed > 0 || row.reviewRequired > 0)
      .sort((a, b) => b.escrows - a.escrows || b.active - a.active)
      .slice(0, 25),
    suggestedActions,
  };
  const alertThreshold = Number(process.env.ABUSE_TREND_ALERT_MIN_SIGNALS || "5");
  const now = Date.now();
  if (
    (analytics.totals.criticalSignals >= alertThreshold || analytics.fingerprintWatchlist.length >= alertThreshold) &&
    now - lastAbuseTrendAlertAt > 15 * 60_000
  ) {
    lastAbuseTrendAlertAt = now;
    capturePaymentWarning("Abuse trend threshold reached", {
      criticalSignals: analytics.totals.criticalSignals,
      fingerprintWatchCount: analytics.fingerprintWatchlist.length,
      threshold: alertThreshold,
    });
  }
  return analytics;
}
