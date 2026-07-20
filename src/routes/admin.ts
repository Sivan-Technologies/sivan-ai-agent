import { Router } from "express";
import { config } from "../config";
import { requireAdminAuth, logAdminAction } from "../middleware/adminAuth";
import {
  limitQuerySchema,
  adminReleaseApprovalSchema,
  escrowActionSchema,
  disputeEvidenceSchema,
  disputeResolutionSchema,
  whatsappProviderSwitchSchema,
  adminSettingsSchema,
  paymentProviderSettingsSchema,
  reconciliationRunSchema,
  formatZodError,
} from "../validation";
import {
  workflowStore,
  escrowStore,
  opsStore,
  settingsStore,
  reconciliationStore,
  paymentRouter,
  disputeAnalyst,
} from "../context";
import {
  refreshEscrowPaymentLifecycleForRead,
  buildEscrowDetail,
  buildDisputeRows,
  recordDisputeEvidence,
  buildReconciliationRows,
  reconciliationRowsToCsv,
  buildRevenueAnalytics,
  buildDatabaseStatus,
  buildDisasterRecoveryStatus,
  buildQueueStatus,
  buildStuckEscrowStatus,
  notifyEscrowParticipants,
  participantLifecycleMessage,
  reconcileEscrowPayment,
} from "../services/escrowService";
import {
  getWhatsAppProviderStatus,
  switchWhatsAppProvider,
} from "../services/notificationService";
import {
  calculateEscrowPayoutQuote,
  getProviderForEscrow,
  providerConfigured as configCheck,
} from "../services/paymentService";
import { getActivePayoutProvider, getPayoutProviderForEscrow } from "../services/payoutProvider";
import { runDailyReconciliation } from "../services/reconciliationService";
import {
  capturePaymentWarning,
  captureOperationalError,
  listOperationalEvents,
  buildOperationalVisibility,
} from "../services/monitoring";
import { info, warn, error } from "../lib/logger";
import { EscrowRecord, EscrowTransactionRecord } from "../services/escrowStore";
import { searchTransactionReferences } from "../services/transactionReferences";

const router = Router();

router.get("/admin/search", requireAdminAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const referenceResults = await searchTransactionReferences(q, 50);
  res.status(200).json({ query: q, results: referenceResults.map((item) => ({ type: "transaction_reference", id: item.referenceId, title: item.referenceValue, subtitle: `${item.provider} · ${item.referenceType} · ${item.resourceType}:${item.resourceId}`, record: item })) });
});

router.get("/admin/tasks", requireAdminAuth, async (req, res) => {
  const tasks = await workflowStore.getAllTasks();
  res.status(200).json(tasks);
});

router.get("/admin/tasks/:taskId", requireAdminAuth, async (req, res) => {
  const task = await workflowStore.getTaskById(req.params.taskId);
  if (!task) {
    return res.status(404).send({ error: "Task not found" });
  }
  res.status(200).json(task);
});

router.get("/admin/escrows", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const rawEscrows = await escrowStore.listEscrows(parsed.data.limit);
  const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycleForRead(escrow, "admin_escrows"))))
    .filter(Boolean) as EscrowRecord[];
  
  const escrowIds = escrows.map((e) => e.escrowId);
  const transactionsList = await escrowStore.listTransactionsForEscrows(escrowIds);
  
  const transactionsByEscrow = transactionsList.reduce((acc, tx) => {
    acc[tx.escrowId] ||= [];
    acc[tx.escrowId].push(tx);
    return acc;
  }, {} as Record<string, EscrowTransactionRecord[]>);

  const rows = escrows.map((escrow) => {
    const transactions = transactionsByEscrow[escrow.escrowId] || [];
    const expiredPaymentReferences = transactions
      .filter((transaction) => transaction.transactionType === "funding" && transaction.status === "expired" && transaction.reference)
      .map((transaction) => transaction.reference);
    return { ...escrow, expiredPaymentReferences };
  });

  res.status(200).json(rows);
});

router.get("/admin/escrows/:escrowId", requireAdminAuth, async (req, res) => {
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) {
    return res.status(404).json({ error: "Escrow not found" });
  }
  res.status(200).json(detail);
});

router.get("/admin/escrows/:escrowId/events", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  const [events, transactions, supportCases] = await Promise.all([
    escrowStore.listEvents(req.params.escrowId, parsed.data.limit),
    escrowStore.listTransactions(req.params.escrowId),
    opsStore.searchSupportCases(req.params.escrowId, 25),
  ]);
  res.status(200).json({ escrowId: req.params.escrowId, events, transactions, supportCases });
});

router.get("/admin/reconciliation", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const rows = await buildReconciliationRows(parsed.data.limit);
  const needsAttention = {
    paymentsNeedingReview: rows.filter((row) => row.status === "REVIEW_REQUIRED").length,
    releasesAwaitingPayout: rows.filter((row) => row.status === "PENDING_RELEASE").length,
    releasedMissingPayoutReference: rows.filter((row) => row.status === "RELEASED" && !row.payoutReference).length,
    paymentAmountMismatches: rows.filter((row) => row.flags.includes("payment_amount_mismatch")).length,
  };
  res.status(200).json({ rows, needsAttention });
});

router.get("/admin/reconciliation.csv", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const rows = await buildReconciliationRows(parsed.data.limit);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sivan-reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(reconciliationRowsToCsv(rows));
});

router.get("/admin/reconciliation/runs", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json({ runs: await reconciliationStore.listRuns(parsed.data.limit) });
});

router.get("/admin/reconciliation/runs/:runId", requireAdminAuth, async (req, res) => {
  const run = await reconciliationStore.getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Reconciliation run not found" });
  const [findings, snapshots] = await Promise.all([
    reconciliationStore.listFindings(req.params.runId),
    reconciliationStore.listSnapshots(req.params.runId),
  ]);
  res.status(200).json({ run, findings, snapshots });
});

router.post("/admin/reconciliation/run", requireAdminAuth, logAdminAction("run_daily_reconciliation"), async (req, res) => {
  const parsed = reconciliationRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid reconciliation run payload", details: formatZodError(parsed.error) });
  }
  const result = await runDailyReconciliation({
    ...parsed.data,
    reason: "admin_manual",
  });
  res.status(result.run.status === "failed" ? 500 : 201).json(result);
});

router.get("/admin/revenue", requireAdminAuth, async (_req, res) => {
  res.status(200).json(await buildRevenueAnalytics());
});

router.post("/admin/escrows/:escrowId/approve-release", requireAdminAuth, logAdminAction("approve_escrow_release"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminReleaseApprovalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payout reconciliation payload", details: formatZodError(parsed.error) });
    }
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }
    const detailBeforeApproval = await buildEscrowDetail(req.params.escrowId);
    if (!detailBeforeApproval?.readiness.aggregateRiskReleaseReady) {
      const risk = detailBeforeApproval?.complianceRisk;
      capturePaymentWarning("Manual payout approval blocked by aggregate compliance risk", {
        escrowId: req.params.escrowId,
        risk,
      });
      await opsStore.createSupportCase({
        subject: `Compliance review required for ${req.params.escrowId}`,
        priority: risk?.riskLevel === "CRITICAL" ? "urgent" : "high",
        relatedEscrowId: req.params.escrowId,
        source: "compliance_release_gate",
        createdBy: adminUser,
        note: `Aggregate compliance risk blocked payout approval: ${(risk?.riskReasons || []).join(", ") || "risk threshold exceeded"}`,
      });
      return res.status(409).json({
        error: "COMPLIANCE_RISK_REVIEW_REQUIRED",
        message: "Aggregate compliance risk requires support review before payout approval",
        complianceRisk: risk,
      });
    }
    const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);
    const payoutProvider = escrow.currency === "NAIRA" ? getPayoutProviderForEscrow(escrow, config.databaseMode) : null;
    const payoutAccount = escrow.sellerUserId
      ? payoutProvider?.id === "manual_bank_transfer"
        ? await escrowStore.getPayoutAccount(escrow.sellerUserId)
        : await escrowStore.getPayoutAccountForTransfer(escrow.sellerUserId)
      : null;
    const payoutResult = payoutProvider
      ? await payoutProvider.initiatePayout({
          escrow,
          payoutAccount,
          amount: payoutQuote.sellerNetAmount,
          currency: escrow.currency,
          requestedBy: adminUser,
          idempotencyKey: `release-${escrow.escrowId}`,
          manualPayoutReference: parsed.data.manualPayoutReference,
          payoutNotes: parsed.data.payoutNotes,
        })
      : null;
    if (payoutResult && payoutResult.status !== "succeeded") {
      await escrowStore.addTransaction({
        escrowId: escrow.escrowId,
        provider: payoutResult.provider,
        transactionType: "release",
        status: `payout_${payoutResult.status}`,
        amount: payoutQuote.sellerNetAmount,
        currency: escrow.currency,
        reference: payoutResult.reference,
        rawPayload: JSON.stringify(payoutResult.rawPayload || {}),
      });
      await escrowStore.addEvent({
        escrowId: escrow.escrowId,
        actor: adminUser,
        actorRole: "admin",
        channel: "admin",
        previousStatus: escrow.status,
        nextStatus: escrow.status,
        eventType: "payout_not_finalized",
        reason: payoutResult.message,
        metadata: payoutResult,
      });
      return res.status(202).json({ escrow, payoutQuote, payout: payoutResult });
    }
    if (escrow.currency === "USDC" && escrow.paymentReference) {
      try {
        const paymentProvider = escrow.paymentProvider || "x402";
        if (paymentProvider === "sap") {
          const sap = paymentRouter.getSapAgent();
          if (!sap) throw new Error("Synapse SAP agent is not configured");
          await sap.releaseEscrow(escrow.paymentReference);
        } else {
          await paymentRouter.settleUsdcPayment(escrow.paymentReference);
        }
      } catch (err: any) {
        throw new Error(`On-chain USDC release failed: ${err.message || String(err)}`);
      }
    }

    const updated = await escrowStore.approveManualRelease(req.params.escrowId, adminUser, {
      ...parsed.data,
      manualPayoutReference: payoutResult?.reference || parsed.data.manualPayoutReference || "",
      payoutProvider: payoutResult?.provider || (escrow.currency === "NAIRA" ? "manual_bank_transfer" : "x402"),
      grossAmount: payoutQuote.grossAmount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      sellerNetAmount: payoutQuote.sellerNetAmount,
    });
    info("Manual payout approval recorded", {
      escrowId: updated.escrowId,
      adminUser,
      manualPayoutReference: updated.manualPayoutReference,
      payoutProvider: payoutResult?.provider || null,
      releasedAt: updated.releasedAt,
      grossAmount: payoutQuote.grossAmount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      sellerNetAmount: payoutQuote.sellerNetAmount,
    });
    await notifyEscrowParticipants(
      updated,
      participantLifecycleMessage(
        updated,
        `Service completed. Payout was confirmed for ${updated.currency === "NAIRA" ? "NGN" : updated.currency} ${new Intl.NumberFormat("en-NG").format(payoutQuote.sellerNetAmount)}.`,
        `Payout provider: ${payoutResult?.provider || "manual_bank_transfer"}\nProvider reference: ${updated.manualPayoutReference || payoutResult?.reference || parsed.data.manualPayoutReference}`
      )
    );
    res.status(200).json({ escrow: updated, payoutQuote, payout: payoutResult });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Release approval failed" });
  }
});

router.post("/admin/escrows/:escrowId/recheck-payment", requireAdminAuth, logAdminAction("recheck_escrow_payment"), async (req, res) => {
  try {
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    const paymentReference = typeof req.body?.paymentReference === "string" && req.body.paymentReference.trim()
      ? req.body.paymentReference.trim()
      : escrow.paymentReference;
    if (!paymentReference) {
      return res.status(400).json({ error: "Escrow has no payment reference" });
    }

    const provider = await getProviderForEscrow(escrow);
    const transaction = await provider.verifyPayment(paymentReference);
    const updated = await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
    const detail = await buildEscrowDetail(updated.escrowId);
    res.status(200).json({ escrow: updated, detail, transaction });
  } catch (err: any) {
    capturePaymentWarning("Admin payment recheck failed", {
      escrowId: req.params.escrowId,
      error: err.message || err,
    });
    res.status(400).json({ error: err.message || "Payment recheck failed" });
  }
});

router.post("/admin/escrows/:escrowId/payout-review", requireAdminAuth, logAdminAction("enqueue_payout_review"), async (req, res) => {
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  const adminUser = (req as any).adminUser || "unknown";
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim()
    ? req.body.reason.trim().slice(0, 1000)
    : "manual_payout_safety_review";
  const job = await opsStore.enqueueJob("payout_review", {
    escrowId: escrow.escrowId,
    status: escrow.status,
    reason,
    requestedBy: adminUser,
  }, { maxAttempts: 3 });
  await escrowStore.addEvent({
    escrowId: escrow.escrowId,
    actor: adminUser,
    actorRole: "admin",
    channel: "admin",
    previousStatus: escrow.status,
    nextStatus: escrow.status,
    eventType: "payout_review_enqueued",
    reason,
  });
  res.status(201).json(job);
});

router.post("/admin/escrows/:escrowId/dispute", requireAdminAuth, logAdminAction("admin_dispute_escrow"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = escrowActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dispute payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.markDisputed(req.params.escrowId, adminUser, "admin", parsed.data.reason);
    await opsStore.createSupportCase({
      subject: `Admin dispute for ${req.params.escrowId}`,
      priority: "high",
      relatedEscrowId: req.params.escrowId,
      source: "admin_dispute",
      createdBy: adminUser,
      note: parsed.data.reason || "Admin opened dispute",
    });
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Dispute failed" });
  }
});

router.get("/admin/disputes", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await buildDisputeRows(parsed.data.limit));
});

router.post("/admin/escrows/:escrowId/dispute/evidence", requireAdminAuth, logAdminAction("record_dispute_evidence"), async (req, res) => {
  const parsed = disputeEvidenceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid dispute evidence payload", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  if (escrow.status !== "DISPUTED") {
    return res.status(400).json({ error: `Evidence can only be added while escrow is DISPUTED, current status is ${escrow.status}` });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const evidence = parsed.data;
  const detail = await recordDisputeEvidence({
    escrow,
    actor: evidence.submittedBy || adminUser,
    actorRole: evidence.source,
    channel: "admin",
    evidence,
  });
  res.status(201).json(detail);
});

router.post("/admin/escrows/:escrowId/dispute/resolve", requireAdminAuth, logAdminAction("resolve_dispute"), async (req, res) => {
  const parsed = disputeResolutionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid dispute resolution payload", details: formatZodError(parsed.error) });
  }
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const updated = await escrowStore.resolveDispute(req.params.escrowId, adminUser, parsed.data);
    const supportCases = await opsStore.searchSupportCases(req.params.escrowId, 5);
    await Promise.all(supportCases.map(async (supportCase) => {
      await opsStore.updateSupportCase(supportCase.caseId, { status: "resolved", priority: supportCase.priority });
      await opsStore.addSupportNote(
        supportCase.caseId,
        adminUser,
        `Dispute resolved as ${parsed.data.outcome}: ${parsed.data.reason}${parsed.data.reference ? ` Reference: ${parsed.data.reference}` : ""}`,
        "dispute_resolved"
      );
    }));
    if (parsed.data.notifyParticipants) {
      await notifyEscrowParticipants(
        updated,
        `Dispute resolved for ${updated.escrowId}: ${parsed.data.outcome}. ${parsed.data.reason}`
      );
    }
    res.status(200).json({ escrow: updated, detail: await buildEscrowDetail(updated.escrowId), supportCases });
  } catch (err: any) {
    capturePaymentWarning("Admin dispute resolution failed", {
      escrowId: req.params.escrowId,
      error: err.message || err,
    });
    res.status(400).json({ error: err.message || "Dispute resolution failed" });
  }
});

router.get("/admin/escrows/:escrowId/ai-dispute-analysis", requireAdminAuth, async (req, res) => {
  try {
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    if (escrow.aiDisputeRecommendation) {
      try {
        const cached = JSON.parse(escrow.aiDisputeRecommendation);
        return res.status(200).json({ source: "cache", recommendation: cached });
      } catch {
        // Fall back to dynamic analysis if cache parsing fails
      }
    }

    const recommendation = await disputeAnalyst.analyzeDispute(req.params.escrowId);
    res.status(200).json({ source: "ai_analysis", recommendation });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "AI dispute analysis failed" });
  }
});

router.get("/admin/webhooks", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const limit = parsed.data.limit;
  const events = await workflowStore.getWebhookEvents(limit);
  res.status(200).json(events);
});

router.get("/admin/db-status", requireAdminAuth, async (_req, res) => {
  try {
    const database = await buildDatabaseStatus();
    res.status(200).json(database);
  } catch (err: any) {
    captureOperationalError("Database status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Database check failed" });
  }
});

router.get("/admin/dr/status", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await buildDisasterRecoveryStatus());
  } catch (err: any) {
    captureOperationalError("Disaster recovery status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Disaster recovery check failed" });
  }
});

router.get("/admin/ops/status", requireAdminAuth, async (_req, res) => {
  try {
    const [database, queue, stuckEscrows] = await Promise.all([
      buildDatabaseStatus(),
      buildQueueStatus(),
      buildStuckEscrowStatus(),
    ]);
    const operations = buildOperationalVisibility();
    res.status(200).json({
      status: database.status === "ok" && queue.status === "ok" && stuckEscrows.status === "ok" ? "ok" : "attention",
      database,
      operations,
      queue,
      stuckEscrows,
    });
  } catch (err: any) {
    captureOperationalError("Operations status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Operations status check failed" });
  }
});

router.get("/admin/whatsapp-provider", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await getWhatsAppProviderStatus());
  } catch (err: any) {
    captureOperationalError("WhatsApp provider status check failed", err);
    res.status(502).json({ error: err.message || "WhatsApp provider status check failed" });
  }
});

router.post("/admin/whatsapp-provider", requireAdminAuth, logAdminAction("switch_whatsapp_provider"), async (req, res) => {
  const parsed = whatsappProviderSwitchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid WhatsApp provider payload", details: formatZodError(parsed.error) });
  }

  try {
    res.status(200).json(await switchWhatsAppProvider(parsed.data.provider));
  } catch (err: any) {
    captureOperationalError("WhatsApp provider switch failed", err, { provider: parsed.data.provider });
    res.status(502).json({ error: err.message || "WhatsApp provider switch failed" });
  }
});

router.get("/admin/ops/events", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(listOperationalEvents(parsed.data.limit));
});

router.get("/admin/settings", requireAdminAuth, async (req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    res.status(200).json(settings);
  } catch (err: any) {
    error("Failed to fetch settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to fetch settings" });
  }
});

router.post("/admin/settings", requireAdminAuth, logAdminAction("update_settings"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings payload", details: formatZodError(parsed.error) });
    }
    const updates = parsed.data;
    const current = await settingsStore.getSettings();

    const updated = await settingsStore.updateSettings({
      nairaFeePercent: updates.nairaFeePercent,
      nairaFeeFixed: updates.nairaFeeFixed,
      usdcFeePercent: updates.usdcFeePercent,
      usdcFeeFixed: updates.usdcFeeFixed,
      nairaNewUserLimit: updates.nairaNewUserLimit ?? current.nairaNewUserLimit,
      nairaTrustedUserLimit: updates.nairaTrustedUserLimit ?? current.nairaTrustedUserLimit,
      nairaEstablishedUserLimit: updates.nairaEstablishedUserLimit ?? current.nairaEstablishedUserLimit,
      nairaSpecialApprovalLimit: updates.nairaSpecialApprovalLimit ?? current.nairaSpecialApprovalLimit,
      nairaBuyerActiveExposureLimit: updates.nairaBuyerActiveExposureLimit ?? current.nairaBuyerActiveExposureLimit,
      nairaPlatformActiveExposureLimit: updates.nairaPlatformActiveExposureLimit ?? current.nairaPlatformActiveExposureLimit,
      trustedUserSuccessfulEscrows: updates.trustedUserSuccessfulEscrows ?? current.trustedUserSuccessfulEscrows,
      establishedUserSuccessfulEscrows: updates.establishedUserSuccessfulEscrows ?? current.establishedUserSuccessfulEscrows,
      platformMode: updates.platformMode ?? current.platformMode,
      maintenanceMessage: updates.maintenanceMessage ?? current.maintenanceMessage,
      nairaPaymentMethod: "bank_transfer",
      nairaFeeModel: updates.nairaFeeModel ?? current.nairaFeeModel,
      nairaFeeTiers: updates.nairaFeeTiers ?? current.nairaFeeTiers,
      nairaFundingWindowHours: updates.nairaFundingWindowHours ?? current.nairaFundingWindowHours,
      nairaHighValueFundingWindowHours: updates.nairaHighValueFundingWindowHours ?? current.nairaHighValueFundingWindowHours,
      nairaHighValueFundingWindowAmount: updates.nairaHighValueFundingWindowAmount ?? current.nairaHighValueFundingWindowAmount,
      nairaFundingReminderBeforeExpiryHours: updates.nairaFundingReminderBeforeExpiryHours ?? current.nairaFundingReminderBeforeExpiryHours,
      payoutSharedAccountReviewCount: updates.payoutSharedAccountReviewCount ?? current.payoutSharedAccountReviewCount,
      complianceNewSellerEscrowCount: updates.complianceNewSellerEscrowCount ?? current.complianceNewSellerEscrowCount,
      complianceHighDisputeRatio: updates.complianceHighDisputeRatio ?? current.complianceHighDisputeRatio,
      complianceHighDisputeMinEscrows: updates.complianceHighDisputeMinEscrows ?? current.complianceHighDisputeMinEscrows,
      nairaHighValueReviewAmount: updates.nairaHighValueReviewAmount ?? current.nairaHighValueReviewAmount,
      usdcHighValueReviewAmount: updates.usdcHighValueReviewAmount ?? current.usdcHighValueReviewAmount,
      paymentLifecycleWorkerEnabled: updates.paymentLifecycleWorkerEnabled ?? current.paymentLifecycleWorkerEnabled,
      paymentLifecycleWorkerIntervalMs: updates.paymentLifecycleWorkerIntervalMs ?? current.paymentLifecycleWorkerIntervalMs,
      reconciliationWorkerEnabled: updates.reconciliationWorkerEnabled ?? current.reconciliationWorkerEnabled,
      queueWorkerEnabled: updates.queueWorkerEnabled ?? current.queueWorkerEnabled,
      stuckEscrowAlertMinutes: updates.stuckEscrowAlertMinutes ?? current.stuckEscrowAlertMinutes,
      autoReleaseEnabled: updates.autoReleaseEnabled ?? current.autoReleaseEnabled,
      deliveryInspectionWindowDays: updates.deliveryInspectionWindowDays ?? current.deliveryInspectionWindowDays,
      outageStatusPageUrl: updates.outageStatusPageUrl ?? current.outageStatusPageUrl,
      outageContacts: updates.outageContacts ?? current.outageContacts,
      expectedVersion: Number(updates.expectedVersion || 1),
      updatedBy: adminUser,
    });

    info(`Settings updated by ${adminUser}`, { version: updated.version });
    res.status(200).json(updated);
  } catch (err: any) {
    warn("Settings update failed", err.message || err);
    const message = err.message || "Settings update failed";
    if (message.includes("version mismatch")) {
      return res.status(409).json({ error: message });
    }
    res.status(400).json({ error: message });
  }
});

function providerConfigured(provider: string) {
  return configCheck(provider);
}

function providerStatus() {
  return [
    {
      provider: "monnify",
      label: "Monnify",
      implemented: true,
      configured: providerConfigured("monnify"),
      methods: ["bank_transfer"],
    },
    {
      provider: "palmpay",
      label: "PalmPay",
      implemented: true,
      configured: providerConfigured("palmpay"),
      methods: ["bank_transfer"],
    },
    {
      provider: "flutterwave",
      label: "Flutterwave",
      implemented: true,
      configured: providerConfigured("flutterwave"),
      methods: ["bank_transfer"],
    },
    {
      provider: "nomba",
      label: "Nomba",
      implemented: true,
      configured: providerConfigured("nomba"),
      methods: ["bank_transfer"],
    },
  ];
}

router.get("/admin/payment-providers", requireAdminAuth, async (_req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    res.status(200).json({
      activePaymentProvider: settings.activePaymentProvider,
      backupPaymentProvider: settings.backupPaymentProvider,
      emergencyPaymentProvider: settings.emergencyPaymentProvider,
      paymentProviderFallbackEnabled: settings.paymentProviderFallbackEnabled,
      platformMode: settings.platformMode,
      maintenanceMessage: settings.maintenanceMessage,
      nairaPaymentMethod: settings.nairaPaymentMethod,
      version: settings.version,
      providers: providerStatus(),
      fallbackPolicy: "fallback_only_for_new_payment_creation",
    });
  } catch (err: any) {
    error("Failed to fetch payment provider settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to fetch payment provider settings" });
  }
});

router.post("/admin/payment-providers/test-connection", requireAdminAuth, logAdminAction("test_payment_provider_connection"), async (req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    const provider = String(req.body.provider || settings.activePaymentProvider).trim().toLowerCase();

    if (provider === "flutterwave") {
      const { FlutterwaveClient } = await import("../services/flutterwaveClient.js");
      const client = new FlutterwaveClient();
      const today = new Date().toISOString().slice(0, 10);
      await client.listTransactions({ from: today, to: today, perPage: 1 });
      return res.status(200).json({
        status: "ok",
        provider: "flutterwave",
        message: "Flutterwave credentials verification succeeded! Connection check passed.",
      });
    }

    if (provider === "nomba") {
      const { NombaPayoutClient } = await import("../services/nombaPayoutClient.js");
      const client = new NombaPayoutClient(settings.platformMode);
      await client.listBanks();
      return res.status(200).json({
        status: "ok",
        provider: "nomba",
        message: "Nomba credentials verification succeeded! Connection check passed.",
      });
    }

    return res.status(400).json({ error: `Connection check is not implemented for provider: ${provider}` });
  } catch (err: any) {
    res.status(400).json({
      status: "error",
      error: err.message || err,
    });
  }
});

router.post("/admin/payment-providers", requireAdminAuth, logAdminAction("update_payment_providers"), async (req, res) => {
  try {
    const parsed = paymentProviderSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payment provider settings payload", details: formatZodError(parsed.error) });
    }
    const statuses = providerStatus();
    const activeStatus = statuses.find((provider) => provider.provider === parsed.data.activePaymentProvider);
    if (!activeStatus?.implemented || !activeStatus.configured) {
      return res.status(400).json({ error: `Active payment provider is not configured: ${parsed.data.activePaymentProvider}` });
    }
    if (parsed.data.paymentProviderFallbackEnabled) {
      const backupStatus = statuses.find((provider) => provider.provider === parsed.data.backupPaymentProvider);
      if (!backupStatus?.implemented || !backupStatus.configured) {
        return res.status(400).json({ error: "Fallback can only be enabled after the backup provider is implemented and configured" });
      }
    }

    const adminUser = (req as any).adminUser || "unknown";
    const current = await settingsStore.getSettings();
    const updated = await settingsStore.updateSettings({
      nairaFeePercent: current.nairaFeePercent,
      nairaFeeFixed: current.nairaFeeFixed,
      usdcFeePercent: current.usdcFeePercent,
      usdcFeeFixed: current.usdcFeeFixed,
      nairaNewUserLimit: current.nairaNewUserLimit,
      nairaTrustedUserLimit: current.nairaTrustedUserLimit,
      nairaEstablishedUserLimit: current.nairaEstablishedUserLimit,
      nairaSpecialApprovalLimit: current.nairaSpecialApprovalLimit,
      nairaBuyerActiveExposureLimit: current.nairaBuyerActiveExposureLimit,
      nairaPlatformActiveExposureLimit: current.nairaPlatformActiveExposureLimit,
      trustedUserSuccessfulEscrows: current.trustedUserSuccessfulEscrows,
      establishedUserSuccessfulEscrows: current.establishedUserSuccessfulEscrows,
      activePaymentProvider: parsed.data.activePaymentProvider,
      backupPaymentProvider: parsed.data.backupPaymentProvider,
      emergencyPaymentProvider: parsed.data.emergencyPaymentProvider,
      paymentProviderFallbackEnabled: parsed.data.paymentProviderFallbackEnabled,
      expectedVersion: parsed.data.expectedVersion,
      updatedBy: adminUser,
    });
    res.status(200).json({
      activePaymentProvider: updated.activePaymentProvider,
      backupPaymentProvider: updated.backupPaymentProvider,
      emergencyPaymentProvider: updated.emergencyPaymentProvider,
      paymentProviderFallbackEnabled: updated.paymentProviderFallbackEnabled,
      platformMode: updated.platformMode,
      maintenanceMessage: updated.maintenanceMessage,
      nairaPaymentMethod: updated.nairaPaymentMethod,
      version: updated.version,
      providers: providerStatus(),
      fallbackPolicy: "fallback_only_for_new_payment_creation",
    });
  } catch (err: any) {
    warn("Payment provider settings update failed", err.message || err);
    const message = err.message || "Payment provider settings update failed";
    if (message.includes("version mismatch")) return res.status(409).json({ error: message });
    res.status(400).json({ error: message });
  }
});

router.get("/admin/audit-history", requireAdminAuth, async (req, res) => {
  try {
    const parsed = limitQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
    }
    const limit = parsed.data.limit;
    const history = await settingsStore.getAuditHistory(limit);
    res.status(200).json(history);
  } catch (err: any) {
    captureOperationalError("Failed to fetch audit history", err);
    res.status(500).json({ error: err.message || "Failed to fetch audit history" });
  }
});

router.get("/admin/escrow/:escrowId/verify-audit-trail", requireAdminAuth, async (req, res) => {
  try {
    const { escrowId } = req.params;
    if (!escrowId) {
      return res.status(400).json({ error: "escrowId parameter is required" });
    }
    const result = await escrowStore.verifyEscrowAuditTrail(escrowId);
    res.status(200).json(result);
  } catch (err: any) {
    captureOperationalError("Failed to verify audit trail", err);
    res.status(500).json({ error: err.message || "Failed to verify audit trail" });
  }
});

export default router;
