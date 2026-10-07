/**
 * Finance-facing reporting: the reconciliation table, its CSV export, and
 * revenue analytics.
 *
 * Extracted from escrowService.ts as part of the god-service split. Not covered
 * by the plan's responsibility map. No logic changes.
 */
import { config } from "../config";
import { escrowStore } from "../context";
import { EscrowRecord, EscrowCurrency } from "./escrowStore";
import { refreshEscrowPaymentLifecycleForRead } from "./paymentLifecycleRefresh";
import { calculateEscrowPayoutQuote, calculateComplianceRisk } from "./paymentService";

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
