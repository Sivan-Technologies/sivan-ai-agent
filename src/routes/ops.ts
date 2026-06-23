import { Router } from "express";
import { requireCoreApiAuth } from "../middleware/apiAuth";
import { requireAdminAuth, logAdminAction } from "../middleware/adminAuth";
import {
  taskRequestSchema,
  limitQuerySchema,
  queueJobCreateSchema,
  queueRetrySchema,
  queueRunSchema,
  abuseActionSchema,
  supportCaseCreateSchema,
  supportSearchSchema,
  supportCaseUpdateSchema,
  supportNoteCreateSchema,
  escrowLimitReviewDecisionSchema,
  formatZodError,
} from "../validation";
import {
  orchestrator,
  opsStore,
  escrowStore,
  settingsStore,
} from "../context";
import {
  captureOperationalError,
  capturePaymentWarning,
} from "../services/monitoring";
import {
  buildQueueStatus,
  buildAbuseAnalytics,
  queueSellerInviteNotification,
} from "../services/escrowService";
import { notifyWhatsAppBot } from "../services/notificationService";
import { retryWorker } from "../services/retryWorkerInstance";
import {
  runSettlementVerification,
  getLatestSettlementVerification,
} from "../services/settlementVerification";
import { TaskRequest } from "../services/agentOrchestrator";

const router = Router();

router.post("/api/tasks", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = taskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid task request", details: formatZodError(parsed.error) });
    }
    const taskResult = await orchestrator.runTask(parsed.data as TaskRequest);
    return res.status(201).json(taskResult);
  } catch (err: any) {
    captureOperationalError("Failed to create task", err);
    return res.status(500).json({ error: err.message || "Task creation failed" });
  }
});

router.get("/admin/queue/status", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await buildQueueStatus());
  } catch (err: any) {
    captureOperationalError("Queue status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Queue status check failed" });
  }
});

router.get("/admin/queue/jobs", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listQueueJobs(parsed.data.limit));
});

router.post("/admin/queue/jobs", requireAdminAuth, logAdminAction("enqueue_queue_job"), async (req, res) => {
  const parsed = queueJobCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid queue job payload", details: formatZodError(parsed.error) });
  }
  const job = await opsStore.enqueueJob(parsed.data.jobType, parsed.data.payload, {
    maxAttempts: parsed.data.maxAttempts,
    runAfter: parsed.data.runAfter,
  });
  res.status(201).json(job);
});

router.get("/admin/queue/jobs/:jobId", requireAdminAuth, async (req, res) => {
  const job = await opsStore.getQueueJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Queue job not found" });
  res.status(200).json(job);
});

router.post("/admin/queue/jobs/:jobId/retry", requireAdminAuth, logAdminAction("retry_queue_job"), async (req, res) => {
  const parsed = queueRetrySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid queue retry payload", details: formatZodError(parsed.error) });
  }
  const job = await opsStore.retryQueueJob(req.params.jobId, parsed.data);
  if (!job) return res.status(404).json({ error: "Queue job not found" });
  res.status(200).json(job);
});

router.post("/admin/queue/run", requireAdminAuth, logAdminAction("run_retry_worker"), async (req, res) => {
  const parsed = queueRunSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid queue run payload", details: formatZodError(parsed.error) });
  }
  try {
    const result = await retryWorker.processBatch(parsed.data.limit, (req as any).adminUser || "admin-runner");
    res.status(200).json({ result, queue: await buildQueueStatus() });
  } catch (err: any) {
    captureOperationalError("Admin retry worker run failed", err);
    res.status(500).json({ error: err.message || "Retry worker run failed" });
  }
});

router.get("/admin/abuse/signals", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listAbuseSignals(parsed.data.limit));
});

router.get("/admin/abuse/analytics", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await buildAbuseAnalytics(parsed.data.limit));
});

router.get("/admin/abuse/actions", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listAbuseActions(parsed.data.limit));
});

router.post("/admin/abuse/actions", requireAdminAuth, logAdminAction("record_abuse_action"), async (req, res) => {
  const parsed = abuseActionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid abuse action payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const action = await opsStore.recordAbuseAction({ ...parsed.data, createdBy: adminUser });
  capturePaymentWarning("Abuse reputation action recorded", {
    subjectType: action.subjectType,
    subjectId: action.subjectId,
    action: action.action,
    createdBy: adminUser,
  });
  res.status(201).json(action);
});

router.get("/admin/support/cases", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listSupportCases(parsed.data.limit));
});

router.get("/admin/support/search", requireAdminAuth, async (req, res) => {
  const parsed = supportSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.searchSupportCases(parsed.data.q, parsed.data.limit));
});

router.post("/admin/support/cases", requireAdminAuth, logAdminAction("create_support_case"), async (req, res) => {
  const parsed = supportCaseCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid support case payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const supportCase = await opsStore.createSupportCase({ ...parsed.data, createdBy: adminUser });
  res.status(201).json(supportCase);
});

router.patch("/admin/support/cases/:caseId", requireAdminAuth, logAdminAction("update_support_case"), async (req, res) => {
  const parsed = supportCaseUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid support case update payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const updated = await opsStore.updateSupportCase(req.params.caseId, parsed.data);
  if (!updated) return res.status(404).json({ error: "Support case not found" });
  if (parsed.data.note) {
    await opsStore.addSupportNote(req.params.caseId, adminUser, parsed.data.note, "case_updated");
  }
  res.status(200).json(updated);
});

router.get("/admin/support/cases/:caseId/notes", requireAdminAuth, async (req, res) => {
  res.status(200).json(await opsStore.listSupportNotes(req.params.caseId));
});

router.post("/admin/support/cases/:caseId/notes", requireAdminAuth, logAdminAction("add_support_note"), async (req, res) => {
  const parsed = supportNoteCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid support note payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const note = await opsStore.addSupportNote(req.params.caseId, adminUser, parsed.data.body, parsed.data.actionType);
  res.status(201).json(note);
});

router.get("/admin/escrow-limit-reviews", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await escrowStore.listLimitReviews(parsed.data.limit));
});

router.post("/admin/escrow-limit-reviews/:reviewId/approve", requireAdminAuth, logAdminAction("approve_escrow_limit_review"), async (req, res) => {
  const parsed = escrowLimitReviewDecisionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review decision", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const existing = await escrowStore.getLimitReviewById(req.params.reviewId);
  if (!existing) return res.status(404).json({ error: "Escrow limit review not found" });
  if (existing.status === "approved" && existing.approvedEscrowId) {
    return res.status(200).json({ review: existing, escrow: await escrowStore.getEscrowById(existing.approvedEscrowId), idempotent: true });
  }
  if (existing.status === "rejected") return res.status(409).json({ error: "Rejected escrow limit reviews cannot be approved" });

  const settings = await settingsStore.getSettings();
  if (existing.amount > settings.nairaSpecialApprovalLimit) {
    return res.status(409).json({ error: "Review amount now exceeds the configured special approval maximum" });
  }
  const claimed = await escrowStore.claimLimitReview(req.params.reviewId);
  if (!claimed) return res.status(409).json({ error: "Escrow limit review is already being processed" });

  try {
    const existingEscrow = claimed.clientRequestId
      ? await escrowStore.findEscrowByClientRequestId(claimed.clientRequestId)
      : null;
    const seller = claimed.sellerWhatsapp
      ? await escrowStore.upsertUserByWhatsapp(claimed.sellerWhatsapp, "seller")
      : null;
    const escrow = existingEscrow || await escrowStore.createEscrow({
      buyerUserId: claimed.buyerUserId,
      sellerUserId: seller?.userId,
      sellerWhatsapp: claimed.sellerWhatsapp,
      amount: claimed.amount,
      currency: claimed.currency,
      purpose: claimed.purpose,
      clientRequestId: claimed.clientRequestId,
      createdByChannel: claimed.createdByChannel,
    });
    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor: adminUser,
      actorRole: "admin",
      channel: "admin",
      eventType: "escrow_limit_review_approved",
      reason: parsed.data.notes,
      metadata: JSON.stringify({ reviewId: claimed.reviewId, reasonCode: claimed.reasonCode }),
    });
    const review = await escrowStore.decideLimitReview(claimed.reviewId, {
      status: "approved",
      decidedBy: adminUser,
      decisionNotes: parsed.data.notes,
      approvedEscrowId: escrow.escrowId,
    });
    if (claimed.createdByChannel.startsWith("whatsapp")) {
      void notifyWhatsAppBot(claimed.buyerWhatsapp, `Sivan approved your escrow limit review. Escrow ${escrow.escrowId} was created for NAIRA ${escrow.amount}.`)
        .catch((err: any) => captureOperationalError("Failed to notify buyer about approved limit review", err, { reviewId: claimed.reviewId }));
    }
    if (seller && claimed.createdByChannel.startsWith("whatsapp")) {
      queueSellerInviteNotification({
        sellerWhatsapp: seller.whatsappNumber,
        escrowId: escrow.escrowId,
        currency: escrow.currency,
        amount: escrow.amount,
        purpose: escrow.purpose,
        context: { reviewId: claimed.reviewId, channel: claimed.createdByChannel },
      });
    }
    return res.status(200).json({ review, escrow });
  } catch (err: any) {
    await escrowStore.decideLimitReview(req.params.reviewId, { status: "pending", decisionNotes: `Approval failed: ${err.message || err}` });
    captureOperationalError("Escrow limit review approval failed", err, { reviewId: req.params.reviewId });
    return res.status(500).json({ error: "Escrow limit review approval failed" });
  }
});

router.post("/admin/escrow-limit-reviews/:reviewId/reject", requireAdminAuth, logAdminAction("reject_escrow_limit_review"), async (req, res) => {
  const parsed = escrowLimitReviewDecisionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review decision", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const existing = await escrowStore.getLimitReviewById(req.params.reviewId);
  if (!existing) return res.status(404).json({ error: "Escrow limit review not found" });
  if (existing.status === "approved") return res.status(409).json({ error: "Approved escrow limit reviews cannot be rejected" });
  const review = await escrowStore.decideLimitReview(existing.reviewId, {
    status: "rejected",
    decidedBy: adminUser,
    decisionNotes: parsed.data.notes,
  });
  if (existing.createdByChannel.startsWith("whatsapp")) {
    void notifyWhatsAppBot(existing.buyerWhatsapp, `Sivan could not approve your escrow limit review for NAIRA ${existing.amount}. Reason: ${parsed.data.notes}`)
      .catch((err: any) => captureOperationalError("Failed to notify buyer about rejected limit review", err, { reviewId: existing.reviewId }));
  }
  res.status(200).json({ review });
});

router.get("/admin/settlement/verification", requireAdminAuth, async (_req, res) => {
  const proof = getLatestSettlementVerification();
  if (!proof) {
    return res.status(200).json({
      status: "not_run",
      environment: settingsStore.getSettings().then((s) => s.platformMode).catch(() => "unknown"),
      sap: { status: "not_run" },
      x402: { status: "not_run" },
      warnings: [],
      message: "No settlement verification proof has been run in this process",
    });
  }
  res.status(200).json(proof);
});

router.post("/admin/settlement/verify", requireAdminAuth, logAdminAction("verify_settlement_integrations"), async (_req, res) => {
  try {
    const proof = await runSettlementVerification();
    res.status(proof.status === "failed" ? 502 : 200).json(proof);
  } catch (err: any) {
    captureOperationalError("Settlement verification endpoint failed", err);
    res.status(500).json({ status: "failed", error: err.message || "Settlement verification failed" });
  }
});

export default router;
