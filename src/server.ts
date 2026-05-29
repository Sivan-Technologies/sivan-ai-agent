import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { PaystackClient } from "./services/paystackClient";
import { config, validateConfig } from "./config";
import { info, warn, error } from "./lib/logger";
import { SapAgent } from "./services/sapAgent";
import { AceDataClient } from "./services/aceData";
import { PaymentRouter } from "./services/paymentRouter";
import { AgentOrchestrator, TaskRequest } from "./services/agentOrchestrator";
import { notifyWhatsAppBot, notifyWhatsAppBotStrict, formatTaskSummary } from "./services/notificationService";
import { WorkflowStore } from "./services/workflowStore";
import { SettingsStore } from "./services/settingsStore";
import { EscrowRecord, EscrowStore } from "./services/escrowStore";
import { requireAdminAuth, logAdminAction } from "./middleware/adminAuth";
import { requireCoreApiAuth } from "./middleware/apiAuth";
import {
  adminSettingsSchema,
  adminReleaseApprovalSchema,
  abuseActionSchema,
  disputeEvidenceSchema,
  disputeResolutionSchema,
  escrowActionSchema,
  escrowCreateSchema,
  formatZodError,
  limitQuerySchema,
  paystackWebhookSchema,
  payoutAccountSchema,
  supportCaseCreateSchema,
  supportNoteCreateSchema,
  supportCaseUpdateSchema,
  supportSearchSchema,
  queueJobCreateSchema,
  queueRetrySchema,
  queueRunSchema,
  taskRequestSchema,
  userProfileSchema,
} from "./validation";
import { buildOperationalVisibility, captureOperationalError, capturePaymentWarning, listOperationalEvents } from "./services/monitoring";
import { getLatestSettlementVerification, runSettlementVerification } from "./services/settlementVerification";
import { ProductionOpsStore } from "./services/productionOpsStore";
import { AbusePreventionService } from "./services/abusePrevention";
import { RetryWorker } from "./services/retryWorker";
import crypto from "crypto";
import type { PaystackTransactionStatus } from "./services/paystackClient";

validateConfig();

// Initialize Sentry if configured
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.0 });
}

const app = express();
const sapAgent = new SapAgent(config.sap.rpcUrl, config.synapse.apiKey);
const aceData = new AceDataClient(config.aceData.baseUrl, config.aceData.apiKey);
const paymentRouter = new PaymentRouter(sapAgent);
const workflowStore = new WorkflowStore(config.app.databaseUrl, config.app.databaseProvider);
const settingsStore = new SettingsStore(config.app.databaseUrl, config.app.databaseProvider);
const escrowStore = new EscrowStore(config.app.databaseUrl, config.app.databaseProvider);
const opsStore = new ProductionOpsStore(config.app.databaseUrl, config.app.databaseProvider);
const abusePrevention = new AbusePreventionService(escrowStore, opsStore);
void settingsStore.initializeSchema();
void escrowStore.initializeSchema();
void opsStore.initializeSchema();
const orchestrator = new AgentOrchestrator(sapAgent, aceData, paymentRouter, workflowStore);
const paystackClient = new PaystackClient();
let lastAbuseTrendAlertAt = 0;

const corsOrigin = process.env.FRONTEND_URL || "*";
app.use(cors({ origin: corsOrigin }));

// Basic rate limiting to protect public endpoints
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use(limiter);

// Sentry request handler (if initialized)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
}

app.use(bodyParser.json({ verify: (req: any, res, buf) => { req.rawBody = buf.toString(); } }));

// Simple request logger
app.use((req, _res, next) => {
  info(`HTTP ${req.method} ${req.path}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

async function buildDatabaseStatus() {
  const startedAt = Date.now();
  const settings = await settingsStore.getSettings();
  await workflowStore.getWebhookEvents(1);
  await escrowStore.listEscrows(1);

  return {
    status: "ok",
    provider: config.app.databaseProvider,
    configured: Boolean(config.app.databaseUrl),
    settingsVersion: settings.version,
    latencyMs: Date.now() - startedAt,
  };
}

async function buildQueueStatus() {
  const status = await opsStore.queueStatus();
  return {
    status: status.dead > 0 || status.failed > 10 ? "attention" : "ok",
    ...status,
  };
}

async function buildStuckEscrowStatus(limit = 250) {
  const thresholdMinutes = Number(process.env.STUCK_ESCROW_ALERT_MINUTES || "1440");
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

async function buildAbuseAnalytics(limit = 500) {
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
    if (!["RELEASED", "FAILED", "CANCELLED"].includes(escrow.status)) current.active += 1;
    if (escrow.status === "DISPUTED") current.disputed += 1;
    if (escrow.status === "REVIEW_REQUIRED") current.reviewRequired += 1;
    current.latestAt = current.latestAt > escrow.updatedAt ? current.latestAt : escrow.updatedAt;
    buyerVelocity.set(escrow.buyerUserId, current);
  }

  const analytics = {
    totals: {
      signals: signals.length,
      criticalSignals: signals.filter((signal) => signal.severity === "critical").length,
      highSignals: signals.filter((signal) => signal.severity === "high").length,
      monitoredEscrows: escrows.length,
      activeActions: actions.filter((action) => !action.expiresAt || new Date(action.expiresAt).getTime() > Date.now()).length,
    },
    severityCounts,
    categoryCounts,
    actions: actions.slice(0, 50),
    reputationWatchlist: Array.from(subjectMap.values())
      .sort((a, b) => b.maxRiskScore - a.maxRiskScore || b.signals - a.signals)
      .slice(0, 25),
    fingerprintWatchlist: Array.from(fingerprintMap.values())
      .filter((row) => row.signals > 1 || row.maxRiskScore >= 60)
      .sort((a, b) => b.maxRiskScore - a.maxRiskScore || b.signals - a.signals)
      .slice(0, 25),
    velocityWatchlist: Array.from(buyerVelocity.values())
      .filter((row) => row.escrows >= Number(process.env.ABUSE_ESCROW_VELOCITY_LIMIT || "8") || row.disputed > 0 || row.reviewRequired > 0)
      .sort((a, b) => b.escrows - a.escrows || b.active - a.active)
      .slice(0, 25),
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

function paystackEmailForWhatsapp(whatsappNumber: string) {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `whatsapp_${digits || "user"}@sivan.local`;
}

async function buildEscrowDetail(escrowId: string) {
  const escrow = await escrowStore.getEscrowById(escrowId);
  if (!escrow) return null;

  const [buyer, seller, transactions, events] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
    escrowStore.listTransactions(escrow.escrowId),
    escrowStore.listEvents(escrow.escrowId, 100),
  ]);
  const payout = escrow.sellerUserId ? await escrowStore.getPayoutAccount(escrow.sellerUserId) : null;
  const buyerProfileComplete = Boolean(buyer?.firstName && buyer?.lastName);
  const sellerProfileComplete = Boolean(seller?.firstName && seller?.lastName);
  const payoutVerified = Boolean(payout && payout.verificationStatus === "verified");

  return {
    escrow,
    buyer,
    seller,
    payout,
    transactions,
    events,
    readiness: {
      buyerProfileComplete,
      sellerProfileComplete,
      payoutVerified,
      sellerAccepted: !["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status),
      fundingVerified: ["IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      buyerCompleted: ["COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      releaseRequested: escrow.status === "PENDING_RELEASE",
      nextAction:
        escrow.status === "REVIEW_REQUIRED"
          ? "payment_reconciliation_required"
          : escrow.status === "PENDING_ACCEPTANCE"
          ? "seller_acceptance_required"
          : escrow.currency === "NAIRA" && !sellerProfileComplete
          ? "seller_profile_required"
          : escrow.currency === "NAIRA" && !payoutVerified
          ? "seller_payout_verification_required"
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

async function buildDisputeRows(limit = 100) {
  const escrows = await escrowStore.listEscrows(limit);
  const disputeEscrows = escrows.filter((escrow) => escrow.status === "DISPUTED");
  return Promise.all(disputeEscrows.map(async (escrow) => {
    const [events, transactions, supportCases] = await Promise.all([
      escrowStore.listEvents(escrow.escrowId, 25),
      escrowStore.listTransactions(escrow.escrowId),
      opsStore.searchSupportCases(escrow.escrowId, 10),
    ]);
    const evidenceCount = events.filter((event) => event.eventType === "dispute_evidence_recorded").length;
    const openedAt = events.find((event) => event.eventType === "dispute_opened")?.createdAt || escrow.updatedAt;
    return {
      escrow,
      openedAt,
      evidenceCount,
      latestEventAt: events[0]?.createdAt || escrow.updatedAt,
      supportCases,
      transactions,
      events,
    };
  }));
}

async function disputeHistoryForEscrow(escrowId: string) {
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

async function notifyEscrowParticipants(escrow: EscrowRecord, message: string) {
  const [buyer, seller] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
  ]);
  const targets = [buyer?.whatsappNumber, seller?.whatsappNumber, escrow.sellerWhatsapp].filter(Boolean) as string[];
  await Promise.all(Array.from(new Set(targets)).map((target) => notifyWhatsAppBot(target, message)));
}

async function buildReconciliationRows(limit = 250) {
  const escrows = await escrowStore.listEscrows(limit);
  return Promise.all(
    escrows.map(async (escrow) => {
      const [buyer, seller, payout] = await Promise.all([
        escrowStore.getUserById(escrow.buyerUserId),
        escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
        escrow.sellerUserId ? escrowStore.getPayoutAccount(escrow.sellerUserId) : Promise.resolve(null),
      ]);
      const flags = new Set(escrow.reconciliationFlags || []);
      if (escrow.status === "REVIEW_REQUIRED") flags.add("payment_review_required");
      if (escrow.status === "RELEASED" && !escrow.manualPayoutReference) flags.add("missing_payout_reference");
      if (escrow.status === "PENDING_RELEASE") flags.add("release_awaiting_manual_payout");
      if ((escrow.reconciliationFlags || []).includes("payment_amount_mismatch")) flags.add("payment_amount_mismatch");

      return {
        escrowId: escrow.escrowId,
        buyer: buyer?.whatsappNumber || escrow.buyerUserId,
        seller: seller?.whatsappNumber || escrow.sellerWhatsapp || escrow.sellerUserId || "unassigned",
        expectedAmount: escrow.amount,
        receivedAmount: escrow.receivedAmount ?? null,
        currency: escrow.currency,
        paystackReference: escrow.paymentProvider === "paystack" ? escrow.paymentReference || null : null,
        paymentProvider: escrow.paymentProvider || null,
        paymentStatus: escrow.providerPaymentStatus || escrow.status,
        payoutReference: escrow.manualPayoutReference || null,
        payoutApprover: escrow.releasedBy || null,
        releaseTimestamp: escrow.releasedAt || null,
        status: escrow.status,
        flags: Array.from(flags),
        purpose: escrow.purpose,
        payoutVerified: payout?.verificationStatus === "verified",
        paymentCheckedAt: escrow.paymentCheckedAt || null,
      };
    })
  );
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function reconciliationRowsToCsv(rows: Awaited<ReturnType<typeof buildReconciliationRows>>) {
  const headers = [
    "escrow ID",
    "buyer",
    "seller",
    "expected amount",
    "received amount",
    "currency",
    "Paystack reference",
    "payment status",
    "payout reference",
    "release approver",
    "release timestamp",
    "status",
    "flags",
  ];
  const lines = rows.map((row) => [
    row.escrowId,
    row.buyer,
    row.seller,
    row.expectedAmount,
    row.receivedAmount,
    row.currency,
    row.paystackReference,
    row.paymentStatus,
    row.payoutReference,
    row.payoutApprover,
    row.releaseTimestamp,
    row.status,
    row.flags,
  ].map(csvEscape).join(","));
  return [headers.map(csvEscape).join(","), ...lines].join("\n");
}

function amountsMatch(expected: number, received: number) {
  return Math.round(expected * 100) === Math.round(received * 100);
}

async function reconcileEscrowPayment(
  escrowId: string,
  transaction: PaystackTransactionStatus,
  source: "webhook" | "admin_recheck"
): Promise<EscrowRecord> {
  const escrow = await escrowStore.getEscrowById(escrowId);
  if (!escrow) throw new Error("Escrow not found");

  if (transaction.status !== "success") {
    capturePaymentWarning("Paystack escrow transaction verification did not confirm success", {
      escrowId,
      paymentReference: transaction.reference,
      status: transaction.status,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: ["paystack_verification_not_success"],
      reason: `Paystack verification returned ${transaction.status}`,
      reference: transaction.reference,
      metadata: { ...transaction, source },
    });
  }

  if (!amountsMatch(escrow.amount, transaction.amount)) {
    capturePaymentWarning("Paystack escrow payment amount mismatch", {
      escrowId,
      paymentReference: transaction.reference,
      expectedAmount: escrow.amount,
      receivedAmount: transaction.amount,
      source,
    });
    return escrowStore.markPaymentReviewRequired(escrowId, {
      receivedAmount: transaction.amount,
      providerPaymentStatus: transaction.status,
      flags: ["payment_amount_mismatch"],
      reason: `Expected ${escrow.amount} ${escrow.currency}, received ${transaction.amount} ${transaction.currency}`,
      reference: transaction.reference,
      metadata: { ...transaction, source },
    });
  }

  const funded = await escrowStore.markFundedByPaymentReference(transaction.reference, { ...transaction, source });
  if (!funded) {
    throw new Error("Verified Paystack transaction did not match an escrow payment reference");
  }
  return funded;
}

const retryWorker = new RetryWorker(opsStore, {
  whatsapp_notification: async (payload) => {
    if (!payload.to || !payload.message) {
      throw new Error("whatsapp_notification requires payload.to and payload.message");
    }
    await notifyWhatsAppBotStrict(String(payload.to), String(payload.message));
  },
  paystack_recheck: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("paystack_recheck requires paymentReference");
    const escrow = payload.escrowId
      ? await escrowStore.getEscrowById(String(payload.escrowId))
      : await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for Paystack payment reference");
    const transaction = await paystackClient.fetchTransaction(paymentReference);
    await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
  },
  webhook_recovery: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("webhook_recovery requires paymentReference");
    const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for webhook recovery payment reference");
    const transaction = await paystackClient.fetchTransaction(paymentReference);
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
}, {
  baseDelayMs: Number(process.env.QUEUE_RETRY_BASE_DELAY_MS || "30000"),
  maxDelayMs: Number(process.env.QUEUE_RETRY_MAX_DELAY_MS || "1800000"),
  lockTimeoutSeconds: Number(process.env.QUEUE_LOCK_TIMEOUT_SECONDS || "300"),
});

if (process.env.QUEUE_WORKER_ENABLED === "true") {
  const intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || "15000");
  setInterval(() => {
    retryWorker.processBatch(Number(process.env.QUEUE_WORKER_BATCH_SIZE || "5"), "background-worker")
      .catch((err) => captureOperationalError("Background retry worker failed", err));
  }, intervalMs);
}

app.get("/health/readiness", async (req, res) => {
  try {
    if (!config.app.databaseUrl) {
      return res.status(500).json({ status: "unready", reason: "database not configured" });
    }
    const database = await buildDatabaseStatus();
    const operations = buildOperationalVisibility();
    res.status(200).json({ status: "ready", database, operations: { status: operations.status } });
  } catch (err: any) {
    res.status(500).json({ status: "unready", error: err.message || err });
  }
});

app.post("/api/tasks", requireCoreApiAuth, async (req, res) => {
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

app.post("/api/escrows", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid escrow request", details: formatZodError(parsed.error) });
    }

    const input = parsed.data;
    const abuseDecision = await abusePrevention.evaluateEscrowCreate({
      ...input,
      requestIp: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      deviceFingerprint: typeof req.headers["x-device-fingerprint"] === "string" ? req.headers["x-device-fingerprint"] : undefined,
    });
    if (!abuseDecision.allowed) {
      capturePaymentWarning("Escrow creation blocked by abuse prevention", {
        buyerWhatsapp: input.buyerWhatsapp,
        sellerWhatsapp: input.sellerWhatsapp,
        amount: input.amount,
        currency: input.currency,
        riskScore: abuseDecision.riskScore,
        reasons: abuseDecision.reasons,
      });
      return res.status(403).json({
        error: "ESCROW_RISK_BLOCKED",
        message: "This escrow requires support review before it can be created",
        risk: abuseDecision,
      });
    }

    const buyer = await escrowStore.upsertUserByWhatsapp(input.buyerWhatsapp, "buyer");
    const seller = input.sellerWhatsapp
      ? await escrowStore.upsertUserByWhatsapp(input.sellerWhatsapp, "seller")
      : null;

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller?.userId,
      sellerWhatsapp: input.sellerWhatsapp,
      amount: input.amount,
      currency: input.currency,
      purpose: input.purpose,
      createdByChannel: input.channel,
    });

    let payment: any = null;
    if (seller) {
      await notifyWhatsAppBot(
        seller.whatsappNumber,
        `You have been invited to Sivan escrow ${escrow.escrowId} for ${input.currency} ${input.amount}.\nPurpose: ${input.purpose}\nReply: accept ${escrow.escrowId}`
      );
    }

    const updated = await escrowStore.getEscrowById(escrow.escrowId);
    res.status(201).json({ escrow: updated, payment, sellerInviteSent: Boolean(seller), risk: abuseDecision });
  } catch (err: any) {
    captureOperationalError("Failed to create escrow", err);
    res.status(500).json({ error: err.message || "Escrow creation failed" });
  }
});

app.post("/api/users/profile", requireCoreApiAuth, async (req, res) => {
  const parsed = userProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid profile payload", details: formatZodError(parsed.error) });
  }
  const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber);
  const updated = await escrowStore.updateUserProfile(user.userId, parsed.data.firstName, parsed.data.lastName);
  res.status(200).json(updated);
});

app.post("/api/users/payout-account", requireCoreApiAuth, async (req, res) => {
  const parsed = payoutAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payout account payload", details: formatZodError(parsed.error) });
  }
  let resolution;
  try {
    resolution = await paystackClient.resolveBankAccount(parsed.data.accountNumber, parsed.data.bankCode);
  } catch (err: any) {
    const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber, "seller");
    const payout = await escrowStore.upsertPayoutAccount({
      userId: user.userId,
      bankName: parsed.data.bankName,
      bankCode: parsed.data.bankCode,
      accountNumber: parsed.data.accountNumber,
      accountName: parsed.data.accountName,
      verificationStatus: "failed",
    });
    return res.status(422).json({ error: err.message || "Bank account verification failed", payout });
  }
  const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber, "seller");
  const payout = await escrowStore.upsertPayoutAccount({
    userId: user.userId,
    bankName: parsed.data.bankName,
    bankCode: parsed.data.bankCode,
    accountNumber: parsed.data.accountNumber,
    accountName: resolution.accountName,
    verificationStatus: "verified",
  });
  res.status(200).json(payout);
});

app.get("/api/paystack/banks", requireCoreApiAuth, async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const banks = await paystackClient.listBanks();
    const filtered = query
      ? banks.filter((bank) => bank.name.toLowerCase().includes(query) || bank.code.includes(query) || (bank.slug || "").includes(query)).slice(0, 8)
      : banks;
    res.status(200).json(filtered);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch banks" });
  }
});

app.get("/api/escrows/:escrowId", requireCoreApiAuth, async (req, res) => {
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) return res.status(404).json({ error: "Escrow not found" });
  res.status(200).json(detail);
});

app.get("/api/escrows/:escrowId/dispute-history", requireCoreApiAuth, async (req, res) => {
  const history = await disputeHistoryForEscrow(req.params.escrowId);
  if (!history) return res.status(404).json({ error: "Escrow not found" });
  res.status(200).json(history);
});

app.post("/api/escrows/:escrowId/accept", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Seller WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const detailBefore = await buildEscrowDetail(req.params.escrowId);
    if (!detailBefore) return res.status(404).json({ error: "Escrow not found" });
    if (detailBefore.escrow.currency === "NAIRA") {
      if (!detailBefore.readiness.sellerProfileComplete || !detailBefore.readiness.payoutVerified) {
        return res.status(409).json({
          error: "SELLER_PAYOUT_SETUP_REQUIRED",
          message: "Seller profile and verified payout account are required before accepting a Naira escrow",
          escrow: detailBefore.escrow,
          readiness: detailBefore.readiness,
        });
      }
    }

    const accepted = await escrowStore.acceptEscrow(req.params.escrowId, parsed.data.actorWhatsapp);
    let payment: any = null;
    if (accepted.currency === "NAIRA" && !accepted.paymentReference) {
      const transaction = await paystackClient.initializeTransaction(
        accepted.amount,
        paystackEmailForWhatsapp(parsed.data.actorWhatsapp),
        config.paystack.callbackUrl
      );
      await escrowStore.attachPayment({
        escrowId: accepted.escrowId,
        paymentReference: transaction.reference,
        paymentAuthorizationUrl: transaction.authorizationUrl,
        paymentProvider: "paystack",
        status: "PENDING_PAYMENT",
      });
      payment = { provider: "paystack", reference: transaction.reference, authorizationUrl: transaction.authorizationUrl };
    } else if (accepted.currency === "USDC" && !accepted.paymentReference) {
      const reference = `x402-${accepted.escrowId}`;
      await escrowStore.attachPayment({
        escrowId: accepted.escrowId,
        paymentReference: reference,
        paymentProvider: "x402",
        status: "PENDING_PAYMENT",
      });
      payment = { provider: "x402", reference, settlementPolicy: "autonomous_usdc_release" };
    }
    const updated = await buildEscrowDetail(req.params.escrowId);
    if (updated?.escrow && payment) {
      const buyer = updated.buyer;
      if (buyer) {
        const instruction = payment.authorizationUrl
          ? `Seller accepted escrow ${updated.escrow.escrowId}.\nPay here: ${payment.authorizationUrl}`
          : `Seller accepted escrow ${updated.escrow.escrowId}.\nPayment reference: ${payment.reference}`;
        await notifyWhatsAppBot(buyer.whatsappNumber, instruction);
      }
    }
    res.status(200).json({ escrow: updated, payment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Escrow acceptance failed" });
  }
});

app.post("/api/escrows/:escrowId/release-request", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid release payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.requestRelease(
      req.params.escrowId,
      parsed.data.actorWhatsapp || "unknown",
      "whatsapp_dm"
    );
    res.status(200).json(updated);
  } catch (err: any) {
    if (/payout account/i.test(err.message || "")) {
      capturePaymentWarning("Release requested but seller payout account is missing or unverified", {
        escrowId: req.params.escrowId,
        actorWhatsapp: req.body?.actorWhatsapp,
      });
    }
    res.status(400).json({ error: err.message || "Release request failed" });
  }
});

app.post("/api/escrows/:escrowId/complete", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const updated = await escrowStore.completeEscrow(
      req.params.escrowId,
      parsed.data.actorWhatsapp,
      "whatsapp_dm"
    );
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Completion confirmation failed" });
  }
});

app.post("/api/escrows/:escrowId/dispute", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dispute payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.markDisputed(
      req.params.escrowId,
      parsed.data.actorWhatsapp || "unknown",
      "whatsapp_dm",
      parsed.data.reason
    );
    await opsStore.createSupportCase({
      subject: `Dispute opened for ${req.params.escrowId}`,
      priority: "high",
      relatedEscrowId: req.params.escrowId,
      relatedUser: parsed.data.actorWhatsapp,
      source: "whatsapp_dispute",
      createdBy: parsed.data.actorWhatsapp || "whatsapp",
      note: parsed.data.reason || "Dispute opened from WhatsApp",
    });
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Dispute failed" });
  }
});

app.post("/webhooks/paystack", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (!signature) {
      capturePaymentWarning("Missing Paystack webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await paystackClient.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Paystack webhook signature", { paymentReference: req.body?.data?.reference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

  const parsedEvent = paystackWebhookSchema.safeParse(req.body);
  if (!parsedEvent.success) {
    capturePaymentWarning("Invalid Paystack webhook payload", { details: formatZodError(parsedEvent.error) });
    return res.status(400).send({ error: "Invalid webhook payload", details: formatZodError(parsedEvent.error) });
  }

  const event = parsedEvent.data;
  info("Paystack webhook received", event.event, event.data.reference);

  const paymentReference = event.data.reference;
  const eventType = event.event || "unknown";
  if (paymentReference) {
    await workflowStore.addWebhookEvent(String(event.id || crypto.randomUUID()), paymentReference, eventType, JSON.stringify(event));
    const task = await workflowStore.findTaskByPaymentReference(paymentReference);
    if (task) {
      if (eventType === "charge.success") {
        const transaction = await paystackClient.fetchTransaction(paymentReference);
        if (transaction.status !== "success") {
          capturePaymentWarning("Paystack webhook was charge.success but transaction verification did not confirm success", {
            taskId: task.taskId,
            paymentReference,
            status: transaction.status,
          });
          return res.status(202).send({ status: "verification_pending" });
        }

        await workflowStore.updateTaskStatus(task.taskId, "payment_confirmed", `Paystack event verified: ${eventType}`);
        info("Updated workflow task status from verified Paystack webhook", { taskId: task.taskId, paymentReference });
        const execution = await orchestrator.executeConfirmedNairaTask(task.taskId);
        if ((execution as any).skipped) {
          info("Paystack webhook execution skipped", execution);
        }
      } else {
        const shouldKeepCurrentStatus = ["executing", "completed", "settled"].includes(task.paymentStatus);
        if (!shouldKeepCurrentStatus) {
          await workflowStore.updateTaskStatus(task.taskId, "payment_event_received", `Paystack event: ${eventType}`);
        }
        const updatedTask = await workflowStore.getTaskById(task.taskId);
        if (updatedTask) {
          await notifyWhatsAppBot(updatedTask.userEmail, formatTaskSummary(updatedTask));
        }
      }
    } else {
      const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
      if (escrow && eventType === "charge.success") {
        const transaction = await paystackClient.fetchTransaction(paymentReference);
        const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
        if (funded.status === "IN_PROGRESS") {
          info("Escrow funded from verified Paystack webhook", { escrowId: funded.escrowId, paymentReference });
          await notifyWhatsAppBot(funded.sellerWhatsapp || escrow.buyerUserId, `Escrow ${funded.escrowId} is funded. Seller may proceed.`);
        } else if (funded.status === "REVIEW_REQUIRED") {
          info("Escrow payment moved to review from Paystack webhook", { escrowId: funded.escrowId, paymentReference });
        }
      } else if (escrow) {
        await escrowStore.addEvent({
          escrowId: escrow.escrowId,
          actor: "paystack",
          actorRole: "payment_provider",
          channel: "webhook",
          previousStatus: escrow.status,
          nextStatus: escrow.status,
          eventType: "payment_event_received",
          reason: eventType,
          metadata: JSON.stringify(event),
        });
      } else {
        capturePaymentWarning("Paystack webhook did not match any workflow task or escrow", { paymentReference, eventType });
      }
    }
  }

    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    const reference = typeof req.body?.data?.reference === "string" ? req.body.data.reference : "";
    if (reference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: reference,
          eventType: req.body?.event || "unknown",
          reason: "paystack_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Paystack webhook recovery job", enqueueErr, { paymentReference: reference });
      }
    }
    captureOperationalError("Paystack webhook processing failed", err, { paymentReference: reference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

app.get("/admin/tasks", requireAdminAuth, async (req, res) => {
  const tasks = await workflowStore.getAllTasks();
  res.status(200).json(tasks);
});

app.get("/admin/tasks/:taskId", requireAdminAuth, async (req, res) => {
  const task = await workflowStore.getTaskById(req.params.taskId);
  if (!task) {
    return res.status(404).send({ error: "Task not found" });
  }
  res.status(200).json(task);
});

app.get("/admin/escrows", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const escrows = await escrowStore.listEscrows(parsed.data.limit);
  res.status(200).json(escrows);
});

app.get("/admin/escrows/:escrowId", requireAdminAuth, async (req, res) => {
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) {
    return res.status(404).json({ error: "Escrow not found" });
  }
  res.status(200).json(detail);
});

app.get("/admin/escrows/:escrowId/events", requireAdminAuth, async (req, res) => {
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

app.get("/admin/reconciliation", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const rows = await buildReconciliationRows(parsed.data.limit);
  const needsAttention = {
    paymentsNeedingReview: rows.filter((row) => row.status === "REVIEW_REQUIRED").length,
    releasesAwaitingPayout: rows.filter((row) => row.status === "PENDING_RELEASE").length,
    releasedMissingPayoutReference: rows.filter((row) => row.status === "RELEASED" && !row.payoutReference).length,
    paystackAmountMismatches: rows.filter((row) => row.flags.includes("payment_amount_mismatch")).length,
  };
  res.status(200).json({ rows, needsAttention });
});

app.get("/admin/reconciliation.csv", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const rows = await buildReconciliationRows(parsed.data.limit);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sivan-reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(reconciliationRowsToCsv(rows));
});

app.post("/admin/escrows/:escrowId/approve-release", requireAdminAuth, logAdminAction("approve_escrow_release"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminReleaseApprovalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payout reconciliation payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.approveManualRelease(req.params.escrowId, adminUser, parsed.data);
    info("Manual payout approval recorded", {
      escrowId: updated.escrowId,
      adminUser,
      manualPayoutReference: updated.manualPayoutReference,
      releasedAt: updated.releasedAt,
    });
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Release approval failed" });
  }
});

app.post("/admin/escrows/:escrowId/recheck-payment", requireAdminAuth, logAdminAction("recheck_escrow_payment"), async (req, res) => {
  try {
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    const paymentReference = typeof req.body?.paymentReference === "string" && req.body.paymentReference.trim()
      ? req.body.paymentReference.trim()
      : escrow.paymentReference;
    if (!paymentReference) {
      return res.status(400).json({ error: "Escrow has no Paystack payment reference" });
    }

    const transaction = await paystackClient.fetchTransaction(paymentReference);
    const updated = await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
    const detail = await buildEscrowDetail(updated.escrowId);
    res.status(200).json({ escrow: updated, detail, transaction });
  } catch (err: any) {
    capturePaymentWarning("Admin Paystack payment recheck failed", {
      escrowId: req.params.escrowId,
      error: err.message || err,
    });
    res.status(400).json({ error: err.message || "Payment recheck failed" });
  }
});

app.post("/admin/escrows/:escrowId/payout-review", requireAdminAuth, logAdminAction("enqueue_payout_review"), async (req, res) => {
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

app.post("/admin/escrows/:escrowId/dispute", requireAdminAuth, logAdminAction("admin_dispute_escrow"), async (req, res) => {
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

app.get("/admin/disputes", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await buildDisputeRows(parsed.data.limit));
});

app.post("/admin/escrows/:escrowId/dispute/evidence", requireAdminAuth, logAdminAction("record_dispute_evidence"), async (req, res) => {
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
  await escrowStore.addEvent({
    escrowId: escrow.escrowId,
    actor: evidence.submittedBy || adminUser,
    actorRole: evidence.source,
    channel: "admin",
    previousStatus: escrow.status,
    nextStatus: escrow.status,
    eventType: "dispute_evidence_recorded",
    reason: evidence.summary,
    metadata: JSON.stringify({
      evidenceType: evidence.evidenceType,
      uri: evidence.uri || null,
      recordedBy: adminUser,
    }),
  });
  const supportCases = await opsStore.searchSupportCases(escrow.escrowId, 1);
  if (supportCases[0]) {
    await opsStore.addSupportNote(
      supportCases[0].caseId,
      adminUser,
      `${evidence.evidenceType}: ${evidence.summary}${evidence.uri ? ` (${evidence.uri})` : ""}`,
      "dispute_evidence"
    );
  }
  if (evidence.notifyParticipants) {
    await notifyEscrowParticipants(escrow, `Dispute update for ${escrow.escrowId}: ${evidence.summary}`);
  }
  res.status(201).json(await buildEscrowDetail(escrow.escrowId));
});

app.post("/admin/escrows/:escrowId/dispute/resolve", requireAdminAuth, logAdminAction("resolve_dispute"), async (req, res) => {
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

app.get("/admin/webhooks", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const limit = parsed.data.limit;
  const events = await workflowStore.getWebhookEvents(limit);
  res.status(200).json(events);
});

app.get("/admin/db-status", requireAdminAuth, async (_req, res) => {
  try {
    const database = await buildDatabaseStatus();
    res.status(200).json(database);
  } catch (err: any) {
    captureOperationalError("Database status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Database check failed" });
  }
});

app.get("/admin/ops/status", requireAdminAuth, async (_req, res) => {
  try {
    const [database, operations] = await Promise.all([
      buildDatabaseStatus(),
      Promise.resolve(buildOperationalVisibility()),
    ]);
    const [queue, stuckEscrows] = await Promise.all([buildQueueStatus(), buildStuckEscrowStatus()]);
    res.status(200).json({
      status: database.status === "ok" && operations.status === "ok" && queue.status === "ok" && stuckEscrows.status === "ok" ? "ok" : "attention",
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

app.get("/admin/ops/events", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(listOperationalEvents(parsed.data.limit));
});

app.get("/admin/settlement/verification", requireAdminAuth, async (_req, res) => {
  const proof = getLatestSettlementVerification();
  if (!proof) {
    return res.status(404).json({
      status: "missing",
      message: "No settlement verification proof has been run in this process",
    });
  }
  res.status(200).json(proof);
});

app.get("/admin/queue/status", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await buildQueueStatus());
  } catch (err: any) {
    captureOperationalError("Queue status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Queue status check failed" });
  }
});

app.get("/admin/queue/jobs", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listQueueJobs(parsed.data.limit));
});

app.post("/admin/queue/jobs", requireAdminAuth, logAdminAction("enqueue_queue_job"), async (req, res) => {
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

app.get("/admin/queue/jobs/:jobId", requireAdminAuth, async (req, res) => {
  const job = await opsStore.getQueueJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Queue job not found" });
  res.status(200).json(job);
});

app.post("/admin/queue/jobs/:jobId/retry", requireAdminAuth, logAdminAction("retry_queue_job"), async (req, res) => {
  const parsed = queueRetrySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid queue retry payload", details: formatZodError(parsed.error) });
  }
  const job = await opsStore.retryQueueJob(req.params.jobId, parsed.data);
  if (!job) return res.status(404).json({ error: "Queue job not found" });
  res.status(200).json(job);
});

app.post("/admin/queue/run", requireAdminAuth, logAdminAction("run_retry_worker"), async (req, res) => {
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

app.get("/admin/abuse/signals", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listAbuseSignals(parsed.data.limit));
});

app.get("/admin/abuse/analytics", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await buildAbuseAnalytics(parsed.data.limit));
});

app.get("/admin/abuse/actions", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listAbuseActions(parsed.data.limit));
});

app.post("/admin/abuse/actions", requireAdminAuth, logAdminAction("record_abuse_action"), async (req, res) => {
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

app.get("/admin/support/cases", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.listSupportCases(parsed.data.limit));
});

app.get("/admin/support/search", requireAdminAuth, async (req, res) => {
  const parsed = supportSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await opsStore.searchSupportCases(parsed.data.q, parsed.data.limit));
});

app.post("/admin/support/cases", requireAdminAuth, logAdminAction("create_support_case"), async (req, res) => {
  const parsed = supportCaseCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid support case payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const supportCase = await opsStore.createSupportCase({ ...parsed.data, createdBy: adminUser });
  res.status(201).json(supportCase);
});

app.patch("/admin/support/cases/:caseId", requireAdminAuth, logAdminAction("update_support_case"), async (req, res) => {
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

app.get("/admin/support/cases/:caseId/notes", requireAdminAuth, async (req, res) => {
  res.status(200).json(await opsStore.listSupportNotes(req.params.caseId));
});

app.post("/admin/support/cases/:caseId/notes", requireAdminAuth, logAdminAction("add_support_note"), async (req, res) => {
  const parsed = supportNoteCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid support note payload", details: formatZodError(parsed.error) });
  }
  const adminUser = (req as any).adminUser || "unknown";
  const note = await opsStore.addSupportNote(req.params.caseId, adminUser, parsed.data.body, parsed.data.actionType);
  res.status(201).json(note);
});

app.post("/admin/settlement/verify", requireAdminAuth, logAdminAction("verify_settlement_integrations"), async (_req, res) => {
  try {
    const proof = await runSettlementVerification();
    res.status(proof.status === "failed" ? 502 : 200).json(proof);
  } catch (err: any) {
    captureOperationalError("Settlement verification endpoint failed", err);
    res.status(500).json({ status: "failed", error: err.message || "Settlement verification failed" });
  }
});

// Admin Settings Endpoints (requires authentication)
app.get("/admin/settings", requireAdminAuth, async (req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    res.status(200).json(settings);
  } catch (err: any) {
    error("Failed to fetch settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to fetch settings" });
  }
});

app.post("/admin/settings", requireAdminAuth, logAdminAction("update_settings"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings payload", details: formatZodError(parsed.error) });
    }
    const updates = parsed.data;

    // Update settings with optimistic locking
    const updated = await settingsStore.updateSettings({
      nairaFeePercent: updates.nairaFeePercent,
      nairaFeeFixed: updates.nairaFeeFixed,
      usdcFeePercent: updates.usdcFeePercent,
      usdcFeeFixed: updates.usdcFeeFixed,
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

app.get("/admin/audit-history", requireAdminAuth, async (req, res) => {
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

const port = Number(process.env.PORT || 4000);

export default app;

// Start the server when run directly
if (require.main === module) {
  app.listen(port, () => {
    info(`Webhook server listening on port ${port}`);
  });
}

// Sentry error handler and generic error handler
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use((err: any, _req: any, res: any, _next: any) => {
  error("Unhandled error in HTTP pipeline", err && (err.message || err));
  res.status(500).json({ error: err?.message || "internal server error" });
});
