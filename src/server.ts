import "./instrument";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { PaystackClient } from "./services/paystackClient";
import { createNairaPaymentProvider, VerifiedNairaPayment } from "./services/nairaPaymentProvider";
import { config, validateConfig } from "./config";
import { info, warn, error } from "./lib/logger";
import { SapAgent } from "./services/sapAgent";
import { AceDataClient } from "./services/aceData";
import { PaymentRouter } from "./services/paymentRouter";
import { AgentOrchestrator, TaskRequest } from "./services/agentOrchestrator";
import { getWhatsAppProviderStatus, notifyWhatsAppBot, notifyWhatsAppBotStrict, formatTaskSummary, switchWhatsAppProvider } from "./services/notificationService";
import { WorkflowStore } from "./services/workflowStore";
import { FeeCalculation, SettingsStore } from "./services/settingsStore";
import { EscrowCurrency, EscrowRecord, EscrowStore } from "./services/escrowStore";
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
  escrowLimitReviewDecisionSchema,
  deliveryProofSchema,
  formatZodError,
  limitQuerySchema,
  participantEscrowQuerySchema,
  participantDisputeEvidenceSchema,
  paymentProviderSettingsSchema,
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
  whatsappProviderSwitchSchema,
} from "./validation";
import { buildOperationalVisibility, captureOperationalError, capturePaymentWarning, listOperationalEvents } from "./services/monitoring";
import { getLatestSettlementVerification, runSettlementVerification } from "./services/settlementVerification";
import { ProductionOpsStore } from "./services/productionOpsStore";
import { AbusePreventionService } from "./services/abusePrevention";
import { RetryWorker } from "./services/retryWorker";
import { scoreAccountName } from "./services/nameMatch";
import { filterBanks } from "./services/bankFallback";
import { MonnifyClient } from "./services/monnifyClient";
import { FlutterwaveClient } from "./services/flutterwaveClient";
import { ComplianceRisk, hasBlockingComplianceRisk, highValueReviewAmount, scoreComplianceRisk } from "./services/complianceRisk";
import { createSandboxPaymentInstruction, getPayoutVerificationTestResolution, isSandboxPaymentReference } from "./services/payoutVerificationTestMode";
import crypto from "crypto";

validateConfig();

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || "1"));
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
const paystackPaymentProvider = createNairaPaymentProvider("paystack");
const monnifyPaymentProvider = createNairaPaymentProvider("monnify");
const flutterwavePaymentProvider = createNairaPaymentProvider("flutterwave");
const monnifyClient = new MonnifyClient();
const flutterwaveClient = new FlutterwaveClient();
let lastAbuseTrendAlertAt = 0;

function createProviderForId(provider?: string) {
  return createNairaPaymentProvider(provider || "paystack");
}

function providerConfigured(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "paystack") return Boolean(config.paystack.secretKey);
  if (normalized === "monnify") return monnifyClient.isCollectionConfigured();
  if (normalized === "flutterwave") return flutterwaveClient.isCollectionConfigured();
  return false;
}

function sellerInviteMessage(escrowId: string, currency: string, amount: number, purpose: string) {
  return `You have been invited to Sivan service agreement ${escrowId} for ${currency} ${amount}.\nPurpose: ${purpose}\nReply: accept ${escrowId}`;
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstPresent(...values: any[]) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function queueWhatsAppNotification(params: {
  to: string;
  message: string;
  reason: string;
  escrowId?: string;
  dealCard?: any;
  context?: Record<string, any>;
}) {
  void notifyWhatsAppBotStrict(params.to, params.message, params.dealCard).catch(async (err) => {
    const context = {
      escrowId: params.escrowId,
      to: params.to,
      reason: params.reason,
      ...params.context,
    };
    const isRateLimited = err instanceof Error && /\b429\b|Too Many Requests/i.test(err.message);
    if (isRateLimited) {
      capturePaymentWarning("WhatsApp notification rate-limited; queued for retry", context);
    } else {
      captureOperationalError("Failed to send WhatsApp notification", err, context);
    }
    try {
      await opsStore.enqueueJob("whatsapp_notification", {
        to: params.to,
        message: params.message,
        escrowId: params.escrowId,
        reason: params.reason,
        ...(params.dealCard ? { dealCard: params.dealCard } : {}),
      }, {
        maxAttempts: 5,
        runAfter: new Date(Date.now() + (isRateLimited ? 60_000 : 15_000)).toISOString(),
      });
    } catch (enqueueErr) {
      captureOperationalError("Failed to enqueue WhatsApp notification retry", enqueueErr, context);
    }
  });
}

function queueSellerInviteNotification(params: {
  sellerWhatsapp: string;
  escrowId: string;
  currency: string;
  amount: number;
  purpose: string;
  context?: Record<string, any>;
}) {
  const message = sellerInviteMessage(params.escrowId, params.currency, params.amount, params.purpose);
  queueWhatsAppNotification({
    to: params.sellerWhatsapp,
    message,
    reason: "seller_invite",
    escrowId: params.escrowId,
    context: params.context,
  });
}

async function getActiveNairaPaymentProvider() {
  const settings = await settingsStore.getSettings();
  if (!providerConfigured(settings.activePaymentProvider)) {
    throw new Error(`Active Naira payment provider is not configured: ${settings.activePaymentProvider}`);
  }
  return createProviderForId(settings.activePaymentProvider);
}

function getProviderForEscrow(escrow: Pick<EscrowRecord, "paymentProvider">) {
  return createProviderForId(escrow.paymentProvider || process.env.ACTIVE_PAYMENT_PROVIDER || "paystack");
}

function fundingWindowHoursForEscrow(escrow: Pick<EscrowRecord, "currency" | "amount">) {
  if (escrow.currency !== "NAIRA") return 24;
  return escrow.amount >= config.nairaPayments.highValueFundingWindowAmount
    ? config.nairaPayments.highValueFundingWindowHours
    : config.nairaPayments.fundingWindowHours;
}

function fundingDeadlineForEscrow(escrow: Pick<EscrowRecord, "currency" | "amount">) {
  return new Date(Date.now() + fundingWindowHoursForEscrow(escrow) * 60 * 60 * 1000).toISOString();
}

function uniqueProviderReference(providerId: string, escrowId: string) {
  return `${providerId}-${escrowId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function formatFundingInstruction(escrow: EscrowRecord, payment: any) {
  const currency = escrow.currency === "NAIRA" ? "NGN" : escrow.currency;
  const total = new Intl.NumberFormat("en-NG").format(payment.totalPayable || escrow.amount);
  const escrowAmount = new Intl.NumberFormat("en-NG").format(escrow.amount);
  const feeAmount = new Intl.NumberFormat("en-NG").format(payment.platformFeeAmount || 0);
  if (payment.authorizationUrl) {
    return [
      `Payment instructions for ${escrow.escrowId}`,
      `Total to pay: ${currency} ${total}`,
      `Service amount: ${currency} ${escrowAmount}`,
      `Sivan fee: ${currency} ${feeAmount}`,
      "",
      `Complete payment through licensed provider: ${payment.authorizationUrl}`,
      payment.expiresAt ? `Payment link expires: ${payment.expiresAt}` : null,
    ].filter(Boolean).join("\n");
  }
  if (payment.accountNumber) {
    return [
      `Payment instructions for ${escrow.escrowId}`,
      `Transfer ${currency} ${total}`,
      `Bank: ${payment.bankName || "assigned bank"}`,
      `Account number: ${payment.accountNumber}`,
      `Account name: ${payment.accountName || "Sivan payment collection"}`,
      `Reference: ${payment.reference}`,
      "",
      `Service amount: ${currency} ${escrowAmount}`,
      `Sivan fee: ${currency} ${feeAmount}`,
      payment.expiresAt ? `Payment details expire: ${payment.expiresAt}` : null,
    ].filter(Boolean).join("\n");
  }
  return [
    `Payment instructions for ${escrow.escrowId}`,
    `Payment reference: ${payment.reference}`,
    `Total to pay: ${currency} ${total}`,
    `Service amount: ${currency} ${escrowAmount}`,
    `Sivan fee: ${currency} ${feeAmount}`,
  ].join("\n");
}

async function createNairaPaymentInstruction(escrow: EscrowRecord, options: { regenerate?: boolean; buyerWhatsapp?: string } = {}) {
  const provider = escrow.paymentProvider ? getProviderForEscrow(escrow) : await getActiveNairaPaymentProvider();
  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency);
  const paymentReference = uniqueProviderReference(provider.id, escrow.escrowId);
  const transaction = await provider.initializeBankTransferPayment({
    amount: payoutQuote.totalWithFee,
    customerEmail: paystackEmailForWhatsapp(options.buyerWhatsapp || escrow.buyerUserId),
    callbackUrl: config.paystack.callbackUrl,
    escrowId: escrow.escrowId,
    paymentReference,
  });
  const fundingExpiresAt = escrow.fundingExpiresAt || fundingDeadlineForEscrow(escrow);
  await escrowStore.attachPayment({
    escrowId: escrow.escrowId,
    paymentReference: transaction.paymentReference,
    paymentAuthorizationUrl: transaction.authorizationUrl,
    paymentProvider: transaction.provider,
    paymentMetadata: {
      ...transaction,
      escrowAmount: escrow.amount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      totalPayable: payoutQuote.totalWithFee,
      fundingExpiresAt,
      feePolicy: "buyer_pays_fee_on_top",
    },
    fundingExpiresAt,
    activePaymentExpiresAt: transaction.expiresAt,
    status: "PENDING_PAYMENT",
    regenerate: Boolean(options.regenerate),
  });
  return {
    provider: transaction.provider,
    reference: transaction.paymentReference,
    transactionReference: transaction.transactionReference,
    authorizationUrl: transaction.authorizationUrl,
    accountNumber: transaction.accountNumber,
    accountName: transaction.accountName,
    bankName: transaction.bankName,
    bankCode: transaction.bankCode,
    expiresAt: transaction.expiresAt,
    expiresInSeconds: transaction.expiresInSeconds,
    escrowAmount: escrow.amount,
    platformFeeAmount: payoutQuote.platformFeeAmount,
    totalPayable: payoutQuote.totalWithFee,
    fundingExpiresAt,
  };
}

async function activeNairaPaymentInstructionForEscrow(detail: Awaited<ReturnType<typeof buildEscrowDetail>>) {
  if (!detail?.escrow.paymentReference) return null;
  const transaction = await escrowStore.getTransactionByReference(detail.escrow.paymentReference);
  if (!transaction || transaction.status === "expired") return null;
  let rawPayload: any = {};
  try {
    rawPayload = transaction.rawPayload ? JSON.parse(transaction.rawPayload) : {};
  } catch {
    rawPayload = {};
  }
  return {
    provider: detail.escrow.paymentProvider,
    reference: detail.escrow.paymentReference,
    transactionReference: rawPayload.transactionReference || null,
    authorizationUrl: detail.escrow.paymentAuthorizationUrl || rawPayload.authorizationUrl,
    accountNumber: rawPayload.accountNumber,
    accountName: rawPayload.accountName,
    bankName: rawPayload.bankName,
    bankCode: rawPayload.bankCode,
    expiresAt: detail.escrow.activePaymentExpiresAt || rawPayload.expiresAt,
    expiresInSeconds: rawPayload.expiresInSeconds,
    escrowAmount: detail.escrow.amount,
    platformFeeAmount: detail.payoutQuote.platformFeeAmount,
    totalPayable: detail.payoutQuote.totalWithFee,
    fundingExpiresAt: detail.escrow.fundingExpiresAt,
    reusedActiveInstruction: true,
  };
}

function safeSecretEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function twilioDebuggerSecretValid(req: express.Request) {
  const configured = process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET || "";
  if (!configured) return process.env.NODE_ENV !== "production";
  const provided = String(req.query.secret || req.headers["x-sivan-twilio-debugger-secret"] || "");
  return Boolean(provided) && safeSecretEquals(provided, configured);
}

function hasValidStaticServiceAuth(req: express.Request) {
  const coreSecret = process.env.CORE_API_SECRET || "";
  const adminKey = process.env.ADMIN_API_KEY || "";
  const providedCoreSecret = req.headers["x-core-api-key"];
  const providedAdminKey = req.headers["x-admin-key"];

  return Boolean(
    coreSecret &&
    typeof providedCoreSecret === "string" &&
    safeSecretEquals(providedCoreSecret, coreSecret)
  ) || Boolean(
    adminKey &&
    typeof providedAdminKey === "string" &&
    safeSecretEquals(providedAdminKey, adminKey)
  );
}

const corsOrigin = process.env.FRONTEND_URL || "*";
app.use(cors({ origin: corsOrigin }));

// Basic rate limiting to protect public endpoints.
// Valid bot/core/admin service calls have their own authentication and must not
// be throttled by public IP limits during WhatsApp multi-step flows.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  skip: hasValidStaticServiceAuth,
});
app.use(limiter);

app.use(bodyParser.urlencoded({
  extended: false,
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(bodyParser.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));

// Simple request logger
app.use((req, _res, next) => {
  info(`HTTP ${req.method} ${req.path}`);
  next();
});

app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
  if (!hasValidStaticServiceAuth(req)) return next();
  try {
    const settings = await settingsStore.getSettings();
    if (settings.platformMode !== "maintenance") return next();
    return res.status(503).json({
      error: "PLATFORM_MAINTENANCE",
      message: settings.maintenanceMessage,
      mode: settings.platformMode,
    });
  } catch (err: any) {
    captureOperationalError("Failed to evaluate platform mode", err, { path: req.path });
    return res.status(503).json({
      error: "PLATFORM_MODE_UNAVAILABLE",
      message: "Sivan is temporarily unavailable. Please try again soon.",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

if (process.env.SENTRY_DEBUG_ENDPOINT_ENABLED === "true") {
  app.get("/debug-sentry", (_req, _res) => {
    Sentry.logger.info("Sivan escrow Sentry debug endpoint triggered", {
      action: "debug_sentry",
      service: "sivan-escrow-agent",
    });
    Sentry.metrics.count("sivan_escrow_debug_sentry", 1);
    throw new Error("Sivan escrow Sentry debug error");
  });
}

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
    platformMode: settings.platformMode,
    latencyMs: Date.now() - startedAt,
  };
}

async function buildDisasterRecoveryStatus() {
  const database = await buildDatabaseStatus();
  const provider = process.env.BACKUP_PROVIDER || (config.app.databaseProvider === "postgres" ? "managed-postgres" : "local-sqlite");
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || (config.app.databaseProvider === "postgres" ? "7" : "0"));
  const restoreMaxAgeDays = Number(process.env.BACKUP_RESTORE_TEST_MAX_AGE_DAYS || "30");
  const lastRestoreTestAt = process.env.BACKUP_LAST_RESTORE_TEST_AT || "";
  const lastRestoreTestStatus = process.env.BACKUP_LAST_RESTORE_TEST_STATUS || "not_recorded";
  const lastRestoreTime = lastRestoreTestAt ? new Date(lastRestoreTestAt).getTime() : 0;
  const restoreTestFresh = Boolean(lastRestoreTime && Date.now() - lastRestoreTime <= restoreMaxAgeDays * 24 * 60 * 60 * 1000);
  const backupConfigured = config.app.databaseProvider === "postgres" && retentionDays > 0;
  const rollbackConfigured = Boolean(process.env.ROLLBACK_RELEASE_URL || process.env.RENDER_SERVICE_ID || process.env.VERCEL_PROJECT_ID);
  const outageConfigured = Boolean(process.env.OUTAGE_STATUS_PAGE_URL || process.env.OUTAGE_CONTACTS);
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
      statusPageConfigured: Boolean(process.env.OUTAGE_STATUS_PAGE_URL),
      contactsConfigured: Boolean(process.env.OUTAGE_CONTACTS),
    },
    runbook: process.env.BACKUP_RESTORE_RUNBOOK_URL || "docs/disaster-recovery.md",
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

function paystackEmailForWhatsapp(whatsappNumber: string) {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `whatsapp_${digits || "user"}@sivan.local`;
}

type PayoutQuote = FeeCalculation & {
  currency: EscrowCurrency;
  grossAmount: number;
  platformFeeAmount: number;
  sellerNetAmount: number;
  amountSource: "escrow_record";
};

async function calculateEscrowPayoutQuote(amount: number, currency: EscrowCurrency): Promise<PayoutQuote> {
  const settings = await settingsStore.getSettings();
  const fees = currency === "NAIRA"
    ? settingsStore.calculateNairaFee(amount, settings)
    : settingsStore.calculateUSDCFee(amount, settings);
  const platformFeeAmount = Math.max(0, fees.totalPlatformFee);
  const sellerNetAmount = amount;
  return {
    ...fees,
    totalPlatformFee: platformFeeAmount,
    recipientNet: sellerNetAmount,
    currency,
    grossAmount: amount,
    platformFeeAmount,
    sellerNetAmount,
    amountSource: "escrow_record",
  };
}

async function calculateComplianceRisk(escrow: EscrowRecord): Promise<ComplianceRisk> {
  const sellerEscrows = escrow.sellerUserId
    ? (await escrowStore.listEscrows(500)).filter((row) => row.sellerUserId === escrow.sellerUserId || row.sellerWhatsapp === escrow.sellerWhatsapp)
    : [];
  const sellerEscrowCount = sellerEscrows.length;
  const disputedStatuses = sellerEscrows.filter((row) => row.status === "DISPUTED").length;
  const disputedByEvent = await Promise.all(sellerEscrows.map(async (row) => {
    const events = await escrowStore.listEvents(row.escrowId, 50);
    return events.some((event) => event.eventType === "dispute_opened");
  }));
  const sellerDisputeCount = Math.max(disputedStatuses, disputedByEvent.filter(Boolean).length);

  return scoreComplianceRisk({
    amount: escrow.amount,
    currency: escrow.currency,
    sellerDisputeCount,
    sellerEscrowCount,
  });
}

async function refreshEscrowPaymentLifecycle(escrowId: string) {
  const before = await escrowStore.getEscrowById(escrowId);
  const escrow = await escrowStore.expirePendingPaymentIfDue(escrowId);
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

async function buildEscrowDetail(escrowId: string) {
  const escrow = await refreshEscrowPaymentLifecycle(escrowId);
  if (!escrow) return null;

  const [buyer, seller, transactions, events, ledgerEntries] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
    escrowStore.listTransactions(escrow.escrowId),
    escrowStore.listEvents(escrow.escrowId, 100),
    escrowStore.listLedgerEntries(escrow.escrowId),
  ]);
  const payout = escrow.sellerUserId ? await escrowStore.getPayoutAccount(escrow.sellerUserId) : null;
  const buyerProfileComplete = Boolean(buyer?.firstName && buyer?.lastName);
  const sellerProfileComplete = Boolean(seller?.firstName && seller?.lastName);
  const payoutVerified = Boolean(payout && payout.verificationStatus === "verified");
  const payoutNameMatchAcceptable = Boolean(payout && ["strong", "medium"].includes(payout.nameMatchLevel || ""));
  const payoutReleaseReady = Boolean(payoutVerified && payoutNameMatchAcceptable && !payout?.sharedAccountFlag);
  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency);
  const complianceRisk = await calculateComplianceRisk(escrow);
  const aggregateRiskReleaseReady = !hasBlockingComplianceRisk(complianceRisk);

  return {
    escrow,
    buyer,
    seller,
    payout,
    payoutQuote,
    transactions,
    events,
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
  Array.from(new Set(targets)).forEach((target) => queueWhatsAppNotification({
    to: target,
    message,
    reason: "escrow_participant_update",
    escrowId: escrow.escrowId,
  }));
}

function participantLifecycleMessage(escrow: EscrowRecord, statusLine: string, nextLine: string) {
  const currency = escrow.currency === "NAIRA" ? "NGN" : escrow.currency;
  return [
    `Sivan update for ${escrow.escrowId}`,
    `${escrow.purpose}`,
    `${currency} ${new Intl.NumberFormat("en-NG").format(escrow.amount)}`,
    "",
    statusLine,
    nextLine,
    "",
    `Reply STATUS ${escrow.escrowId} to view the agreement.`,
  ].join("\n");
}

function whatsappIdentityMatches(left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  const leftDigits = left.replace(/\D/g, "");
  const rightDigits = right.replace(/\D/g, "");
  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

async function roleForEscrowParticipant(escrow: EscrowRecord, actorWhatsapp: string): Promise<"buyer" | "seller" | null> {
  const [buyer, seller] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
  ]);
  if (whatsappIdentityMatches(buyer?.whatsappNumber, actorWhatsapp)) return "buyer";
  if (whatsappIdentityMatches(seller?.whatsappNumber, actorWhatsapp) || whatsappIdentityMatches(escrow.sellerWhatsapp, actorWhatsapp)) return "seller";
  return null;
}

type ParticipantDealAction = "accept" | "status" | "pay" | "cancel" | "complete" | "release" | "dispute" | "evidence" | "reference" | "deliver";

function participantDealStatus(status: EscrowRecord["status"]) {
  const labels: Record<EscrowRecord["status"], string> = {
    CREATED: "Getting ready",
    PENDING_PROFILE: "Seller setup required",
    PENDING_ACCEPTANCE: "Waiting for seller",
    PENDING_PAYMENT: "Waiting for buyer payment",
    FUNDED: "Payment confirmed",
    IN_PROGRESS: "Work in progress",
    COMPLETED: "Completion awaiting confirmation",
    PENDING_RELEASE: "Completion confirmation under review",
    RELEASED: "Service completed",
    DISPUTED: "Issue under review",
    REVIEW_REQUIRED: "Under manual review",
    FAILED: "Action required",
    EXPIRED: "Payment window expired",
    CANCELLED: "Cancelled",
  };
  return labels[status];
}

function participantDealActionsForEscrow(escrow: EscrowRecord, role: "buyer" | "seller"): ParticipantDealAction[] {
  const actions = new Set<ParticipantDealAction>(["status", "reference"]);

  if (role === "seller" && ["PENDING_PROFILE", "PENDING_ACCEPTANCE"].includes(escrow.status)) actions.add("accept");
  if (role === "buyer" && ["PENDING_PROFILE", "PENDING_ACCEPTANCE", "PENDING_PAYMENT"].includes(escrow.status)) actions.add("cancel");
  if (role === "buyer" && escrow.status === "PENDING_PAYMENT") actions.add("pay");
  if (role === "buyer" && ["FUNDED", "IN_PROGRESS"].includes(escrow.status)) actions.add("complete");
  if (role === "seller" && ["FUNDED", "IN_PROGRESS"].includes(escrow.status)) actions.add("deliver");
  if (role === "buyer" && escrow.status === "COMPLETED") actions.add("release");
  if (["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "REVIEW_REQUIRED"].includes(escrow.status)) actions.add("dispute");
  if (escrow.status === "DISPUTED") actions.add("evidence");

  return Array.from(actions);
}

function participantDealActions(detail: Awaited<ReturnType<typeof buildEscrowDetail>>, role: "buyer" | "seller"): ParticipantDealAction[] {
  if (!detail) return [];
  return participantDealActionsForEscrow(detail.escrow, role);
}

async function buildParticipantDealSummary(escrow: EscrowRecord, actorWhatsapp: string) {
  const role = await roleForEscrowParticipant(escrow, actorWhatsapp);
  if (!role) return null;
  return {
    escrow: {
      escrowId: escrow.escrowId,
      amount: escrow.amount,
      currency: escrow.currency,
      status: escrow.status,
      purpose: escrow.purpose,
      createdAt: escrow.createdAt,
      updatedAt: escrow.updatedAt,
      fundingExpiresAt: escrow.fundingExpiresAt,
      activePaymentExpiresAt: escrow.activePaymentExpiresAt,
      paymentRegenerationCount: escrow.paymentRegenerationCount || 0,
      ...(role === "buyer" && escrow.paymentAuthorizationUrl
        ? { paymentAuthorizationUrl: escrow.paymentAuthorizationUrl }
        : {}),
    },
    readiness: {
      sellerProfileComplete: !["PENDING_PROFILE"].includes(escrow.status),
      payoutVerified: !["PENDING_PROFILE"].includes(escrow.status),
      sellerAccepted: !["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status),
      fundingVerified: ["IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      buyerCompleted: ["COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      releaseRequested: escrow.status === "PENDING_RELEASE",
      nextAction: participantDealStatus(escrow.status),
    },
    participant: {
      role,
      displayStatus: participantDealStatus(escrow.status),
      allowedActions: participantDealActionsForEscrow(escrow, role),
    },
  };
}

async function buildParticipantDeal(detail: Awaited<ReturnType<typeof buildEscrowDetail>>, actorWhatsapp: string) {
  if (!detail) return null;
  const role = await roleForEscrowParticipant(detail.escrow, actorWhatsapp);
  if (!role) return null;
  return {
    escrow: {
      escrowId: detail.escrow.escrowId,
      amount: detail.escrow.amount,
      currency: detail.escrow.currency,
      status: detail.escrow.status,
      purpose: detail.escrow.purpose,
      createdAt: detail.escrow.createdAt,
      updatedAt: detail.escrow.updatedAt,
      fundingExpiresAt: detail.escrow.fundingExpiresAt,
      activePaymentExpiresAt: detail.escrow.activePaymentExpiresAt,
      paymentRegenerationCount: detail.escrow.paymentRegenerationCount || 0,
      ...(role === "buyer" && detail.escrow.paymentAuthorizationUrl
        ? { paymentAuthorizationUrl: detail.escrow.paymentAuthorizationUrl }
        : {}),
    },
    readiness: {
      sellerProfileComplete: detail.readiness.sellerProfileComplete,
      payoutVerified: detail.readiness.payoutVerified,
      sellerAccepted: detail.readiness.sellerAccepted,
      fundingVerified: detail.readiness.fundingVerified,
      buyerCompleted: detail.readiness.buyerCompleted,
      releaseRequested: detail.readiness.releaseRequested,
      nextAction: detail.readiness.nextAction,
    },
    participant: {
      role,
      displayStatus: participantDealStatus(detail.escrow.status),
      allowedActions: participantDealActions(detail, role),
    },
  };
}

async function notifyEscrowFundedParticipants(escrow: EscrowRecord) {
  const detail = await buildEscrowDetail(escrow.escrowId);
  if (!detail) return;
  const buyerWhatsapp = detail.buyer?.whatsappNumber;
  const sellerWhatsapp = detail.seller?.whatsappNumber || detail.escrow.sellerWhatsapp;
  const message = participantLifecycleMessage(
    detail.escrow,
    "Payment has been confirmed through the licensed provider.",
    "Reply STATUS or tap View status to see what to do next."
  );

  await Promise.all([
    buyerWhatsapp ? buildParticipantDeal(detail, buyerWhatsapp).then((dealCard) =>
      queueWhatsAppNotification({
        to: buyerWhatsapp,
        message,
        reason: "escrow_funded",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
    sellerWhatsapp ? buildParticipantDeal(detail, sellerWhatsapp).then((dealCard) =>
      queueWhatsAppNotification({
        to: sellerWhatsapp,
        message,
        reason: "escrow_funded",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
  ]);
}

async function recordDisputeEvidence(input: {
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

function externalDeliveryLinksAllowed() {
  return process.env.DELIVERY_PROOF_ALLOW_EXTERNAL_LINKS === "true";
}

function containsExternalLink(value: string) {
  return /\bhttps?:\/\/|\bwww\./i.test(value);
}

async function notifyBuyerDeliverySubmitted(escrow: EscrowRecord, summary: string) {
  const detail = await buildEscrowDetail(escrow.escrowId);
  const buyerWhatsapp = detail?.buyer?.whatsappNumber;
  if (!detail || !buyerWhatsapp) return;
  const dealCard = await buildParticipantDeal(detail, buyerWhatsapp);
  queueWhatsAppNotification({
    to: buyerWhatsapp,
    message: participantLifecycleMessage(
      detail.escrow,
      "The service provider has submitted delivery proof.",
      `Review the delivery, then reply COMPLETE ${detail.escrow.escrowId} if you are satisfied or DISPUTE ${detail.escrow.escrowId} if there is a problem.`
    ),
    reason: "seller_delivery_submitted",
    escrowId: detail.escrow.escrowId,
    dealCard: dealCard ? {
      escrow: dealCard.escrow,
      participant: dealCard.participant,
    } : undefined,
    context: { summary: summary || "Seller submitted delivery proof" },
  });
}

async function recordDeliveryProof(input: {
  escrow: EscrowRecord;
  actorWhatsapp: string;
  summary: string;
  media: Array<{ url: string; contentType?: string; filename?: string }>;
  notifyBuyer: boolean;
}) {
  const { escrow, actorWhatsapp, summary, media, notifyBuyer } = input;
  const safeSummary = summary.trim() || "Seller submitted delivery proof";
  await escrowStore.addEvent({
    escrowId: escrow.escrowId,
    actor: actorWhatsapp,
    actorRole: "seller",
    channel: "whatsapp_dm",
    previousStatus: escrow.status,
    nextStatus: escrow.status,
    eventType: "seller_delivery_proof_recorded",
    reason: safeSummary,
    metadata: JSON.stringify({
      summary: safeSummary,
      media,
      mediaCount: media.length,
      externalLinksAllowed: externalDeliveryLinksAllowed(),
    }),
  });

  if (notifyBuyer) await notifyBuyerDeliverySubmitted(escrow, safeSummary);
  return buildEscrowDetail(escrow.escrowId);
}

async function buildReconciliationRows(limit = 250) {
  const rawEscrows = await escrowStore.listEscrows(limit);
  const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycle(escrow.escrowId))))
    .filter(Boolean) as EscrowRecord[];
  return Promise.all(
    escrows.map(async (escrow) => {
      const [buyer, seller, payout, payoutQuote, complianceRisk, events] = await Promise.all([
        escrowStore.getUserById(escrow.buyerUserId),
        escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
        escrow.sellerUserId ? escrowStore.getPayoutAccount(escrow.sellerUserId) : Promise.resolve(null),
        calculateEscrowPayoutQuote(escrow.amount, escrow.currency),
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
      const flags = new Set(escrow.reconciliationFlags || []);
      if (escrow.status === "REVIEW_REQUIRED") flags.add("payment_review_required");
      if (escrow.status === "RELEASED" && !escrow.manualPayoutReference) flags.add("missing_payout_reference");
      if (escrow.status === "PENDING_RELEASE") flags.add("release_awaiting_manual_payout");
      if (escrow.paymentProvider === "monnify" && !settlementReference && ["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) {
        flags.add("settlement_pending");
      }
      if ((escrow.reconciliationFlags || []).includes("payment_amount_mismatch")) flags.add("payment_amount_mismatch");
      const payoutVerified = payout?.verificationStatus === "verified";
      if (payout?.sharedAccountFlag) flags.add("shared_payout_account_review");
      if (payout && !["strong", "medium"].includes(payout.nameMatchLevel || "")) flags.add("payout_name_match_review");
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
        paystackReference: escrow.paymentProvider === "paystack" ? escrow.paymentReference || null : null,
        paymentProvider: escrow.paymentProvider || null,
        paymentStatus: escrow.providerPaymentStatus || escrow.status,
        settlementReference,
        settlementAmount,
        settlementProviderFee,
        settlementReceivedAt: settlementEvent?.createdAt || null,
        payoutReference: escrow.manualPayoutReference || null,
        payoutApprover: escrow.releasedBy || null,
        releaseTimestamp: escrow.releasedAt || null,
        status: escrow.status,
        flags: Array.from(flags),
        purpose: escrow.purpose,
        payoutVerified,
        payoutBankName: payout?.bankName || null,
        payoutBankCode: payout?.bankCode || null,
        payoutAccountNumber: payout?.accountNumber || null,
        resolvedAccountName: payout?.resolvedAccountName || payout?.accountName || null,
        nameMatchScore: payout?.nameMatchScore ?? null,
        nameMatchLevel: payout?.nameMatchLevel || null,
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
    "platform fee",
    "seller net payout",
    "amount source",
    "currency",
    "Paystack reference",
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
    row.paystackReference,
    row.paymentProvider,
    row.paymentStatus,
    row.settlementReference,
    row.settlementAmount,
    row.settlementProviderFee,
    row.settlementReceivedAt,
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

async function buildRevenueAnalytics() {
  const [ledgerEntries, fundingTransactions] = await Promise.all([
    escrowStore.listRevenueLedgerEntries(),
    escrowStore.listRevenueTransactions(),
  ]);
  const sandboxTransactions = fundingTransactions.filter((transaction) =>
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
  const settlementEvents = (await Promise.all(
    Array.from(new Set(productionFundingTransactions.map((transaction) => transaction.escrowId))).map((escrowId) =>
      escrowStore.listEvents(escrowId, 50)
    )
  )).flat().filter((event) => event.eventType === "settlement_received");
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

function amountsMatch(expected: number, received: number) {
  return Math.round(expected * 100) === Math.round(received * 100);
}

async function expectedFundingAmount(escrow: EscrowRecord) {
  const quote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency);
  return escrow.currency === "NAIRA" ? quote.totalWithFee : escrow.amount;
}

async function reconcileEscrowPayment(
  escrowId: string,
  transaction: VerifiedNairaPayment,
  source: "webhook" | "admin_recheck"
): Promise<EscrowRecord> {
  const escrow = await refreshEscrowPaymentLifecycle(escrowId);
  if (!escrow) throw new Error("Escrow not found");
  const storedTransaction = await escrowStore.getTransactionByReference(transaction.paymentReference);

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
      metadata: { ...transaction, source, activePaymentReference: escrow.paymentReference || null },
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
      metadata: { ...transaction, source, expiredStatus: escrow.status },
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
      metadata: { ...transaction, source },
    });
  }

  const expectedAmount = await expectedFundingAmount(escrow);
  if (!amountsMatch(expectedAmount, transaction.amount)) {
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
      metadata: { ...transaction, source, expectedAmount, escrowAmount: escrow.amount },
    });
  }

  const funded = await escrowStore.markFundedByPaymentReference(transaction.paymentReference, { ...transaction, source });
  if (!funded) {
    throw new Error(`Verified ${transaction.provider} transaction did not match an escrow payment reference`);
  }
  return funded;
}

const retryWorker = new RetryWorker(opsStore, {
  whatsapp_notification: async (payload) => {
    if (!payload.to || !payload.message) {
      throw new Error("whatsapp_notification requires payload.to and payload.message");
    }
    await notifyWhatsAppBotStrict(String(payload.to), String(payload.message), payload.dealCard);
  },
  paystack_recheck: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("paystack_recheck requires paymentReference");
    const escrow = payload.escrowId
      ? await escrowStore.getEscrowById(String(payload.escrowId))
      : await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for Paystack payment reference");
    const transaction = await getProviderForEscrow(escrow).verifyPayment(paymentReference);
    await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
  },
  webhook_recovery: async (payload) => {
    const paymentReference = String(payload.paymentReference || "").trim();
    if (!paymentReference) throw new Error("webhook_recovery requires paymentReference");
    const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
    if (!escrow) throw new Error("No escrow found for webhook recovery payment reference");
    const transaction = await getProviderForEscrow(escrow).verifyPayment(paymentReference);
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

async function runPaymentLifecycleSweep(limit = Number(process.env.PAYMENT_LIFECYCLE_WORKER_BATCH_SIZE || "250")) {
  const escrows = await escrowStore.listEscrows(limit);
  const pending = escrows.filter((escrow) => escrow.status === "PENDING_PAYMENT");
  await Promise.all(pending.map((escrow) => refreshEscrowPaymentLifecycle(escrow.escrowId)));
  return { scanned: escrows.length, refreshed: pending.length };
}

if (process.env.QUEUE_WORKER_ENABLED === "true") {
  const intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || "15000");
  setInterval(() => {
    retryWorker.processBatch(Number(process.env.QUEUE_WORKER_BATCH_SIZE || "5"), "background-worker")
      .catch((err) => captureOperationalError("Background retry worker failed", err));
  }, intervalMs);
}

if (process.env.PAYMENT_LIFECYCLE_WORKER_ENABLED === "true") {
  const intervalMs = Number(process.env.PAYMENT_LIFECYCLE_WORKER_INTERVAL_MS || "300000");
  setInterval(() => {
    runPaymentLifecycleSweep()
      .catch((err) => captureOperationalError("Payment lifecycle sweep failed", err));
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
    if (input.clientRequestId) {
      const existing = await escrowStore.findEscrowByClientRequestId(input.clientRequestId);
      if (existing) {
        return res.status(200).json({
          escrow: existing,
          payment: null,
          sellerInviteSent: false,
          idempotent: true,
        });
      }
    }

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
    if (input.currency === "NAIRA") {
      const settings = await settingsStore.getSettings();
      const exposure = await escrowStore.getNairaExposureForBuyer(buyer.userId);
      const tier = exposure.successfulEscrows >= settings.establishedUserSuccessfulEscrows
        ? "ESTABLISHED"
        : exposure.successfulEscrows >= settings.trustedUserSuccessfulEscrows
          ? "TRUSTED"
          : "NEW";
      const tierLimit = tier === "ESTABLISHED"
        ? settings.nairaEstablishedUserLimit
        : tier === "TRUSTED"
          ? settings.nairaTrustedUserLimit
          : settings.nairaNewUserLimit;
      const policy = {
        tier,
        successfulEscrows: exposure.successfulEscrows,
        tierLimit,
        specialApprovalLimit: settings.nairaSpecialApprovalLimit,
        buyerActiveExposure: exposure.buyerActiveExposure,
        platformActiveExposure: exposure.platformActiveExposure,
        buyerActiveExposureLimit: settings.nairaBuyerActiveExposureLimit,
        platformActiveExposureLimit: settings.nairaPlatformActiveExposureLimit,
        requestedAmount: input.amount,
      };
      if (input.amount > settings.nairaSpecialApprovalLimit) {
        return res.status(403).json({ error: "ESCROW_LIMIT_EXCEEDED", message: "Requested amount exceeds Sivan's maximum supported Naira escrow limit", policy });
      }
      const reviewReason = input.amount > tierLimit
        ? { error: "ESCROW_LIMIT_REVIEW_REQUIRED", message: "This amount requires operator approval for the buyer's current trust tier" }
        : exposure.buyerActiveExposure + input.amount > settings.nairaBuyerActiveExposureLimit
          ? { error: "BUYER_EXPOSURE_LIMIT_REACHED", message: "This buyer's active Naira exposure limit requires operator review" }
          : exposure.platformActiveExposure + input.amount > settings.nairaPlatformActiveExposureLimit
            ? { error: "PLATFORM_EXPOSURE_LIMIT_REACHED", message: "Sivan's active Naira exposure limit requires operator review before another escrow can be created" }
            : null;
      if (reviewReason) {
        const review = await escrowStore.createOrGetLimitReview({
          clientRequestId: input.clientRequestId,
          buyerUserId: buyer.userId,
          buyerWhatsapp: input.buyerWhatsapp,
          sellerWhatsapp: input.sellerWhatsapp,
          amount: input.amount,
          currency: input.currency,
          purpose: input.purpose,
          createdByChannel: input.channel,
          reasonCode: reviewReason.error,
          policy,
        });
        return res.status(409).json({ ...reviewReason, policy, review });
      }
    }
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
      clientRequestId: input.clientRequestId,
      createdByChannel: input.channel,
    });

    let payment: any = null;
    if (seller) {
      queueSellerInviteNotification({
        sellerWhatsapp: seller.whatsappNumber,
        escrowId: escrow.escrowId,
        currency: input.currency,
        amount: input.amount,
        purpose: input.purpose,
        context: { channel: input.channel },
      });
    }

    const updated = await escrowStore.getEscrowById(escrow.escrowId);
    res.status(201).json({ escrow: updated, payment, sellerInviteSent: Boolean(seller), risk: abuseDecision });
  } catch (err: any) {
    captureOperationalError("Failed to create escrow", err);
    res.status(500).json({ error: err.message || "Escrow creation failed" });
  }
});

app.post("/api/users/profile", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = userProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid profile payload", details: formatZodError(parsed.error) });
    }
    const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber);
    const updated = await escrowStore.updateUserProfile(user.userId, parsed.data.firstName, parsed.data.lastName);
    res.status(200).json(updated);
  } catch (err: any) {
    captureOperationalError("Failed to save user profile", err, { whatsappNumber: req.body?.whatsappNumber });
    res.status(503).json({ error: "PROFILE_SAVE_UNAVAILABLE", message: "Profile save is temporarily unavailable" });
  }
});

app.get("/api/users/profile", requireCoreApiAuth, async (req, res) => {
  const whatsappNumber = typeof req.query.whatsappNumber === "string" ? req.query.whatsappNumber : "";
  const parsed = userProfileSchema.shape.whatsappNumber.safeParse(whatsappNumber);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid WhatsApp number" });
  }
  const user = await escrowStore.findUserByWhatsapp(parsed.data);
  if (!user) {
    return res.status(404).json({ error: "User profile not found" });
  }
  res.status(200).json(user);
});

app.post("/api/users/payout-account", requireCoreApiAuth, async (req, res) => {
  const parsed = payoutAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payout account payload", details: formatZodError(parsed.error) });
  }
  const user = await escrowStore.upsertUserByWhatsapp(parsed.data.whatsappNumber, "seller");
  const sellerName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  let resolution = getPayoutVerificationTestResolution({
    accountNumber: parsed.data.accountNumber,
    whatsappNumber: parsed.data.whatsappNumber,
    sellerName,
  }, parsed.data.bankCode);
  let verificationProvider = "paystack_account_resolution";
  if (resolution) {
    verificationProvider = "sandbox_test_override";
    warn("Using allowlisted sandbox payout verification override", {
      whatsappNumber: parsed.data.whatsappNumber,
      bankCode: parsed.data.bankCode,
      accountNumberLast4: parsed.data.accountNumber.slice(-4),
    });
  } else {
    try {
      resolution = await paystackClient.resolveBankAccount(parsed.data.accountNumber, parsed.data.bankCode);
    } catch (err: any) {
      if (monnifyClient.isConfigured()) {
        try {
          resolution = await monnifyClient.validateBankAccount(parsed.data.accountNumber, parsed.data.bankCode);
          verificationProvider = "monnify_name_enquiry";
        } catch (monnifyErr: any) {
          warn("Paystack and Monnify account verification failed", {
            paystackError: err?.message || String(err),
            monnifyError: monnifyErr?.message || String(monnifyErr),
          });
        }
      }
    }
  }

  if (!resolution) {
    const payout = await escrowStore.upsertPayoutAccount({
      userId: user.userId,
      bankName: parsed.data.bankName,
      bankCode: parsed.data.bankCode,
      accountNumber: parsed.data.accountNumber,
      accountName: parsed.data.accountName,
      verificationStatus: "failed",
    });
    return res.status(422).json({ error: "Bank account verification failed", payout });
  }

  const nameMatch = scoreAccountName(sellerName, resolution.accountName);
  const sharedAccountCount = (await escrowStore.countUsersWithPayoutAccountNumber(parsed.data.accountNumber, user.userId)) + 1;
  const sharedAccountFlag = sharedAccountCount >= Number(process.env.PAYOUT_SHARED_ACCOUNT_REVIEW_COUNT || "2");
  const verificationStatus =
    nameMatch.level === "failed"
      ? "failed"
      : nameMatch.acceptable && !sharedAccountFlag
      ? "verified"
      : "pending";
  const payout = await escrowStore.upsertPayoutAccount({
    userId: user.userId,
    bankName: parsed.data.bankName,
    bankCode: parsed.data.bankCode,
    accountNumber: parsed.data.accountNumber,
    accountName: resolution.accountName,
    resolvedAccountName: resolution.accountName,
    nameMatchScore: nameMatch.score,
    nameMatchLevel: nameMatch.level,
    accountVerifiedAt: verificationStatus === "verified" ? new Date().toISOString() : undefined,
    accountVerificationProvider: verificationProvider,
    sharedAccountCount,
    sharedAccountFlag,
    verificationStatus,
  });
  if (verificationStatus !== "verified") {
    return res.status(nameMatch.level === "failed" ? 422 : 409).json({
      error: nameMatch.level === "failed" ? "ACCOUNT_NAME_MATCH_FAILED" : "PAYOUT_REQUIRES_REVIEW",
      message: sharedAccountFlag
        ? "This payout account is shared by multiple sellers and requires compliance review"
        : "The resolved account name needs manual compliance review before payout approval",
      payout,
    });
  }
  res.status(200).json(payout);
});

app.get("/api/paystack/banks", requireCoreApiAuth, async (req, res) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    const banks = await paystackClient.listBanks();
    res.status(200).json(filterBanks(banks, query, query ? 8 : 100));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch banks" });
  }
});

app.get("/api/users/escrows", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = participantEscrowQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Participant WhatsApp is required", details: formatZodError(parsed.error) });
    }
    const rawEscrows = await escrowStore.listEscrowsForWhatsapp(parsed.data.actorWhatsapp, parsed.data.limit);
    const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycle(escrow.escrowId))))
      .filter(Boolean) as EscrowRecord[];
    const deals = await Promise.all(escrows.map(async (escrow) => {
      try {
        return await buildParticipantDealSummary(escrow, parsed.data.actorWhatsapp);
      } catch (err: any) {
        console.warn("Skipping participant deal summary", {
          escrowId: escrow.escrowId,
          actorWhatsapp: parsed.data.actorWhatsapp,
          error: err?.message || err,
        });
        return null;
      }
    }));
    res.status(200).json({ deals: deals.filter(Boolean) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Unable to load participant deals" });
  }
});

app.get("/api/escrows/:escrowId", requireCoreApiAuth, async (req, res) => {
  const parsed = participantEscrowQuerySchema.pick({ actorWhatsapp: true }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Participant WhatsApp is required", details: formatZodError(parsed.error) });
  }
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) return res.status(404).json({ error: "Escrow not found" });
  const participantDeal = await buildParticipantDeal(detail, parsed.data.actorWhatsapp);
  if (!participantDeal) return res.status(403).json({ error: "Only escrow participants can view this deal" });
  res.status(200).json(participantDeal);
});

app.get("/api/escrows/:escrowId/dispute-history", requireCoreApiAuth, async (req, res) => {
  const parsed = participantEscrowQuerySchema.pick({ actorWhatsapp: true }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Participant WhatsApp is required", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  if (!await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp)) {
    return res.status(403).json({ error: "Only escrow participants can view dispute history" });
  }
  const history = await disputeHistoryForEscrow(req.params.escrowId);
  if (!history) return res.status(404).json({ error: "Escrow not found" });
  res.status(200).json(history);
});

app.post("/api/escrows/:escrowId/payment-instruction", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const detail = await buildEscrowDetail(req.params.escrowId);
    if (!detail) return res.status(404).json({ error: "Escrow not found" });
    if (detail.buyer?.whatsappNumber !== parsed.data.actorWhatsapp) {
      return res.status(403).json({ error: "Only the escrow buyer can request payment details" });
    }
    if (detail.escrow.currency !== "NAIRA") {
      return res.status(409).json({ error: "Payment instruction regeneration is available only for Naira escrows" });
    }
    if (detail.escrow.status === "EXPIRED") {
      return res.status(409).json({ error: "This escrow has expired. Create a new escrow to continue." });
    }
    if (detail.escrow.status !== "PENDING_PAYMENT") {
      return res.status(409).json({ error: `Payment details are not available while escrow is ${detail.escrow.status}` });
    }
    const activeInstruction = await activeNairaPaymentInstructionForEscrow(detail);
    if (activeInstruction) {
      return res.status(200).json({
        escrow: detail,
        payment: activeInstruction,
      });
    }

    const payment = await createNairaPaymentInstruction(detail.escrow, {
      regenerate: true,
      buyerWhatsapp: parsed.data.actorWhatsapp,
    });
    const updated = await buildEscrowDetail(req.params.escrowId);
    res.status(200).json({ escrow: updated, payment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Payment instruction refresh failed" });
  }
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
      try {
        payment = await createNairaPaymentInstruction(accepted, { buyerWhatsapp: detailBefore.buyer?.whatsappNumber });
      } catch (err: any) {
        const sandboxPayment = createSandboxPaymentInstruction(accepted.escrowId);
        if (!sandboxPayment) throw err;
        warn("Using sandbox payment instruction after Naira payment initialization failure", {
          escrowId: accepted.escrowId,
          provider: accepted.paymentProvider || "active_provider",
          paymentError: err?.message || String(err),
        });
        const fundingExpiresAt = accepted.fundingExpiresAt || fundingDeadlineForEscrow(accepted);
        await escrowStore.attachPayment({
          escrowId: accepted.escrowId,
          paymentReference: sandboxPayment.reference,
          paymentProvider: sandboxPayment.provider,
          paymentMetadata: {
            provider: sandboxPayment.provider,
            reference: sandboxPayment.reference,
            fundingExpiresAt,
            testOnly: true,
          },
          fundingExpiresAt,
          status: "PENDING_PAYMENT",
        });
        payment = {
          provider: sandboxPayment.provider,
          reference: sandboxPayment.reference,
          fundingExpiresAt,
          testOnly: true,
        };
      }
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
        const instruction = `Service provider accepted agreement ${updated.escrow.escrowId}.\n\n${formatFundingInstruction(updated.escrow, payment)}`;
        await notifyWhatsAppBot(buyer.whatsappNumber, instruction);
      }
    }
    res.status(200).json({ escrow: updated, payment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Escrow acceptance failed" });
  }
});

app.post("/api/escrows/:escrowId/test-fund", requireCoreApiAuth, async (req, res) => {
  const parsed = escrowActionSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.actorWhatsapp) {
    return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
  }
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) return res.status(404).json({ error: "Escrow not found" });
  if (detail.buyer?.whatsappNumber !== parsed.data.actorWhatsapp) {
    return res.status(403).json({ error: "Only the escrow buyer can simulate sandbox funding" });
  }
  if (
    detail.escrow.status !== "PENDING_PAYMENT" ||
    detail.escrow.paymentProvider !== "paystack_sandbox_override" ||
    !isSandboxPaymentReference(detail.escrow.paymentReference)
  ) {
    return res.status(409).json({ error: "Sandbox funding is available only for pending sandbox payment references" });
  }
  const sandboxFundingAmount = await expectedFundingAmount(detail.escrow);
  const funded = await escrowStore.markFundedByPaymentReference(detail.escrow.paymentReference!, {
    amount: sandboxFundingAmount,
    escrowAmount: detail.escrow.amount,
    currency: detail.escrow.currency,
    status: "sandbox_success",
    channel: "sandbox_test_override",
  });
  if (!funded) return res.status(409).json({ error: "Sandbox payment reference could not be funded" });
  res.status(200).json(await buildEscrowDetail(req.params.escrowId));
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
    await notifyEscrowParticipants(
      updated,
      participantLifecycleMessage(
        updated,
        updated.status === "PENDING_RELEASE" ? "Completion confirmation is under provider review." : "Completion confirmation needs manual review.",
        updated.status === "PENDING_RELEASE"
          ? "Sivan will notify both parties when the service agreement is closed."
          : "Sivan support will review this before the agreement is closed."
      )
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

app.post("/api/escrows/:escrowId/delivery/start", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Seller WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp);
    if (role !== "seller") return res.status(403).json({ error: "Only the seller can submit delivery proof" });
    if (!["FUNDED", "IN_PROGRESS"].includes(escrow.status)) {
      return res.status(400).json({ error: `Delivery proof can only be submitted after funding, current status is ${escrow.status}` });
    }
    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor: parsed.data.actorWhatsapp,
      actorRole: "seller",
      channel: "whatsapp_dm",
      previousStatus: escrow.status,
      nextStatus: escrow.status,
      eventType: "seller_delivery_requested",
      reason: "Seller started delivery proof submission",
      metadata: JSON.stringify({ source: "whatsapp" }),
    });
    res.status(200).json(await buildEscrowDetail(escrow.escrowId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Delivery proof could not be started" });
  }
});

app.post("/api/escrows/:escrowId/delivery/proof", requireCoreApiAuth, async (req, res) => {
  const parsed = deliveryProofSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid delivery proof payload", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp);
  if (role !== "seller") return res.status(403).json({ error: "Only the seller can submit delivery proof" });
  if (!["FUNDED", "IN_PROGRESS"].includes(escrow.status)) {
    return res.status(400).json({ error: `Delivery proof can only be submitted after funding, current status is ${escrow.status}` });
  }
  if (!externalDeliveryLinksAllowed() && containsExternalLink(parsed.data.summary)) {
    return res.status(400).json({ error: "External delivery links are not accepted during the MVP. Upload the file or describe the delivery instead." });
  }
  if (!parsed.data.summary.trim() && !parsed.data.media.length) {
    return res.status(400).json({ error: "Delivery proof must include a message or media" });
  }
  const detail = await recordDeliveryProof({
    escrow,
    actorWhatsapp: parsed.data.actorWhatsapp,
    summary: parsed.data.summary,
    media: parsed.data.media,
    notifyBuyer: parsed.data.notifyBuyer,
  });
  res.status(201).json(detail);
});

app.post("/api/escrows/:escrowId/cancel", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const updated = await escrowStore.cancelUnfundedEscrow(
      req.params.escrowId,
      parsed.data.actorWhatsapp,
      "whatsapp_dm"
    );
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Escrow cancellation failed" });
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

app.post("/api/escrows/:escrowId/dispute/evidence", requireCoreApiAuth, async (req, res) => {
  const parsed = participantDisputeEvidenceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid dispute evidence payload", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  if (escrow.status !== "DISPUTED") {
    return res.status(400).json({ error: `Evidence can only be added while escrow is DISPUTED, current status is ${escrow.status}` });
  }
  const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp);
  if (!role) return res.status(403).json({ error: "Only escrow participants can submit dispute evidence" });
  const detail = await recordDisputeEvidence({
    escrow,
    actor: parsed.data.actorWhatsapp,
    actorRole: role,
    channel: "whatsapp_dm",
    evidence: { ...parsed.data, source: parsed.data.source || role },
  });
  res.status(201).json(detail);
});

app.post("/webhooks/twilio-debugger", async (req, res) => {
  if (!twilioDebuggerSecretValid(req)) {
    return res.status(process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET ? 401 : 503).json({
      error: process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET ? "Unauthorized" : "TWILIO_DEBUGGER_WEBHOOK_SECRET is required",
    });
  }

  const body = req.body || {};
  const payload = parseMaybeJson(body.Payload || body.payload || body.EventPayload || body.eventPayload || body);
  const payloadObject = payload && typeof payload === "object" ? payload : {};
  const level = String(firstPresent(body.Level, body.level, payloadObject.level, payloadObject.Level, "warning")).toUpperCase();
  const eventSid = String(firstPresent(body.Sid, body.sid, payloadObject.sid, payloadObject.Sid, payloadObject.event_sid, payloadObject.eventSid, "unknown"));
  const accountSid = firstPresent(body.AccountSid, body.account_sid, body.accountSid, payloadObject.account_sid, payloadObject.AccountSid, payloadObject.accountSid, "unknown");
  const errorCode = firstPresent(payloadObject.error_code, payloadObject.errorCode, payloadObject.ErrorCode, payloadObject.code, payloadObject.Code, body.ErrorCode, body.error_code, "unknown");
  const message = firstPresent(
    payloadObject.message,
    payloadObject.Message,
    payloadObject.description,
    payloadObject.Description,
    payloadObject.error_description,
    payloadObject.errorDescription,
    body.Message,
    body.message,
    body.Description,
    body.description,
    "Twilio Debugger event received"
  );
  const hasSpecificPayload = eventSid !== "unknown" || accountSid !== "unknown" || errorCode !== "unknown" || message !== "Twilio Debugger event received";
  if (!hasSpecificPayload) {
    warn("Twilio Debugger event received without structured details", {
      bodyKeys: Object.keys(body).slice(0, 20),
      rawBodyLength: ((req as any).rawBody || "").length,
    });
    return res.status(200).json({ received: true, ignored: "missing_structured_details" });
  }

  capturePaymentWarning(`Twilio Debugger ${level}: ${message}`, {
    provider: "twilio",
    eventSid,
    accountSid,
    parentAccountSid: firstPresent(body.ParentAccountSid, body.parent_account_sid, payloadObject.parent_account_sid, payloadObject.ParentAccountSid),
    timestamp: firstPresent(body.Timestamp, body.timestamp, payloadObject.timestamp, payloadObject.Timestamp, new Date().toISOString()),
    level,
    errorCode,
    moreInfo: firstPresent(payloadObject.more_info, payloadObject.MoreInfo, payloadObject.moreInfo, body.MoreInfo, body.more_info),
  });

  res.status(200).json({ received: true });
});

app.post("/webhooks/paystack", async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (!signature) {
      capturePaymentWarning("Missing Paystack webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await paystackPaymentProvider.verifyWebhookSignature(rawBody, signature);
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
  const normalizedWebhook = paystackPaymentProvider.normalizeWebhook(event);
  info("Paystack webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);

  const paymentReference = normalizedWebhook.paymentReference;
  const eventType = normalizedWebhook.eventType;
  if (paymentReference) {
    await workflowStore.addWebhookEvent(normalizedWebhook.eventId || crypto.randomUUID(), paymentReference, eventType, JSON.stringify(event));
    const task = await workflowStore.findTaskByPaymentReference(paymentReference);
    if (task) {
      if (eventType === "charge.success") {
        const transaction = await paystackPaymentProvider.verifyPayment(paymentReference);
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
        const transaction = await paystackPaymentProvider.verifyPayment(paymentReference);
        const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
        if (funded.status === "IN_PROGRESS") {
          info("Escrow funded from verified Paystack webhook", { escrowId: funded.escrowId, paymentReference });
          await notifyEscrowFundedParticipants(funded);
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
          provider: "paystack",
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

app.post("/webhooks/monnify", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let normalizedPaymentReference = "";
  try {
    const signature = req.headers["monnify-signature"] as string;
    if (!signature) {
      capturePaymentWarning("Missing Monnify webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await monnifyPaymentProvider.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Monnify webhook signature", { paymentReference: req.body?.eventData?.paymentReference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    const normalizedWebhook = monnifyPaymentProvider.normalizeWebhook(req.body);
    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("Monnify webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `monnify:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    if (normalizedWebhook.eventType === "SETTLEMENT") {
      const transactions = Array.isArray(req.body?.eventData?.transactions) ? req.body.eventData.transactions : [];
      for (const transaction of transactions) {
        const paymentReference = String(transaction.paymentReference || transaction.product?.reference || "").trim();
        if (!paymentReference) continue;
        const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
        if (!escrow) continue;
        await escrowStore.addEvent({
          escrowId: escrow.escrowId,
          actor: "monnify",
          actorRole: "payment_provider",
          channel: "webhook",
          previousStatus: escrow.status,
          nextStatus: escrow.status,
          eventType: "settlement_received",
          reason: req.body?.eventData?.settlementReference || "monnify_settlement",
          metadata: {
            provider: "monnify",
            settlementReference: req.body?.eventData?.settlementReference,
            settlementAmount: req.body?.eventData?.amount,
            transaction,
          },
        });
      }
      return res.status(200).send({ status: "received" });
    }

    if (normalizedWebhook.eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.status(200).send({ status: "received" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("Monnify webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send({ status: "unmatched" });
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "monnify") {
      capturePaymentWarning("Monnify webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send({ error: "Payment reference belongs to a different provider" });
    }

    const transaction = await monnifyPaymentProvider.verifyPayment(normalizedWebhook.paymentReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("Monnify verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send({ status: "verification_reference_mismatch" });
    }

    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified Monnify webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from Monnify webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "monnify",
          eventType: req.body?.eventType || "unknown",
          reason: "monnify_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Monnify webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("Monnify webhook processing failed", err, { paymentReference: normalizedPaymentReference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

app.post("/webhooks/flutterwave", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let normalizedPaymentReference = "";
  try {
    const signature = String(
      req.headers["verif-hash"] ||
      req.headers["flutterwave-signature"] ||
      req.headers["x-flutterwave-signature"] ||
      ""
    );
    if (!signature) {
      capturePaymentWarning("Missing Flutterwave webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await flutterwavePaymentProvider.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Flutterwave webhook signature", { paymentReference: req.body?.data?.reference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    const normalizedWebhook = flutterwavePaymentProvider.normalizeWebhook(req.body);
    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("Flutterwave webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `flutterwave:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    if (normalizedWebhook.eventType !== "charge.completed") {
      return res.status(200).send({ status: "received" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("Flutterwave webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send({ status: "unmatched" });
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "flutterwave") {
      capturePaymentWarning("Flutterwave webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send({ error: "Payment reference belongs to a different provider" });
    }

    const verificationReference = normalizedWebhook.transactionReference || normalizedWebhook.paymentReference;
    const transaction = await flutterwavePaymentProvider.verifyPayment(verificationReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("Flutterwave verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send({ status: "verification_reference_mismatch" });
    }

    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified Flutterwave webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from Flutterwave webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "flutterwave",
          eventType: req.body?.type || req.body?.event || "unknown",
          reason: "flutterwave_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Flutterwave webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("Flutterwave webhook processing failed", err, { paymentReference: normalizedPaymentReference || "unknown" });
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
  const rawEscrows = await escrowStore.listEscrows(parsed.data.limit);
  const escrows = (await Promise.all(rawEscrows.map((escrow) => refreshEscrowPaymentLifecycle(escrow.escrowId))))
    .filter(Boolean) as EscrowRecord[];
  const rows = await Promise.all(escrows.map(async (escrow) => {
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const expiredPaymentReferences = transactions
      .filter((transaction) => transaction.transactionType === "funding" && transaction.status === "expired" && transaction.reference)
      .map((transaction) => transaction.reference);
    return { ...escrow, expiredPaymentReferences };
  }));
  res.status(200).json(rows);
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

app.get("/admin/revenue", requireAdminAuth, async (_req, res) => {
  res.status(200).json(await buildRevenueAnalytics());
});

app.post("/admin/escrows/:escrowId/approve-release", requireAdminAuth, logAdminAction("approve_escrow_release"), async (req, res) => {
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
    const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency);
    const updated = await escrowStore.approveManualRelease(req.params.escrowId, adminUser, {
      ...parsed.data,
      grossAmount: payoutQuote.grossAmount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      sellerNetAmount: payoutQuote.sellerNetAmount,
    });
    info("Manual payout approval recorded", {
      escrowId: updated.escrowId,
      adminUser,
      manualPayoutReference: updated.manualPayoutReference,
      releasedAt: updated.releasedAt,
      grossAmount: payoutQuote.grossAmount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      sellerNetAmount: payoutQuote.sellerNetAmount,
    });
    await notifyEscrowParticipants(
      updated,
      participantLifecycleMessage(
        updated,
        `Service completed. Provider payout reference was recorded for ${updated.currency === "NAIRA" ? "NGN" : updated.currency} ${new Intl.NumberFormat("en-NG").format(payoutQuote.sellerNetAmount)}.`,
        `Provider reference: ${updated.manualPayoutReference || parsed.data.manualPayoutReference}`
      )
    );
    res.status(200).json({ escrow: updated, payoutQuote });
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
      return res.status(400).json({ error: "Escrow has no payment reference" });
    }

    const transaction = await getProviderForEscrow(escrow).verifyPayment(paymentReference);
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
  const detail = await recordDisputeEvidence({
    escrow,
    actor: evidence.submittedBy || adminUser,
    actorRole: evidence.source,
    channel: "admin",
    evidence,
  });
  res.status(201).json(detail);
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

app.get("/admin/dr/status", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await buildDisasterRecoveryStatus());
  } catch (err: any) {
    captureOperationalError("Disaster recovery status check failed", err);
    res.status(503).json({ status: "error", error: err.message || "Disaster recovery check failed" });
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

app.get("/admin/whatsapp-provider", requireAdminAuth, async (_req, res) => {
  try {
    res.status(200).json(await getWhatsAppProviderStatus());
  } catch (err: any) {
    captureOperationalError("WhatsApp provider status check failed", err);
    res.status(502).json({ error: err.message || "WhatsApp provider status check failed" });
  }
});

app.post("/admin/whatsapp-provider", requireAdminAuth, logAdminAction("switch_whatsapp_provider"), async (req, res) => {
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
    return res.status(200).json({
      status: "not_run",
      environment: config.app.env,
      sap: { status: "not_run" },
      x402: { status: "not_run" },
      warnings: [],
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

app.get("/admin/escrow-limit-reviews", requireAdminAuth, async (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  res.status(200).json(await escrowStore.listLimitReviews(parsed.data.limit));
});

app.post("/admin/escrow-limit-reviews/:reviewId/approve", requireAdminAuth, logAdminAction("approve_escrow_limit_review"), async (req, res) => {
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
        .catch((err) => captureOperationalError("Failed to notify buyer about approved limit review", err, { reviewId: claimed.reviewId }));
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

app.post("/admin/escrow-limit-reviews/:reviewId/reject", requireAdminAuth, logAdminAction("reject_escrow_limit_review"), async (req, res) => {
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
      .catch((err) => captureOperationalError("Failed to notify buyer about rejected limit review", err, { reviewId: existing.reviewId }));
  }
  res.status(200).json({ review });
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
    const current = await settingsStore.getSettings();

    // Update settings with optimistic locking
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

function providerStatus() {
  return [
    {
      provider: "paystack",
      label: "Paystack",
      implemented: true,
      configured: providerConfigured("paystack"),
      methods: ["bank_transfer"],
    },
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
      implemented: false,
      configured: false,
      methods: ["bank_transfer"],
    },
    {
      provider: "flutterwave",
      label: "Flutterwave",
      implemented: true,
      configured: providerConfigured("flutterwave"),
      methods: ["bank_transfer"],
    },
  ];
}

app.get("/admin/payment-providers", requireAdminAuth, async (_req, res) => {
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

app.post("/admin/payment-providers", requireAdminAuth, logAdminAction("update_payment_providers"), async (req, res) => {
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

Sentry.setupExpressErrorHandler(app);

app.use((err: any, _req: any, res: any, _next: any) => {
  error("Unhandled error in HTTP pipeline", err && (err.message || err));
  res.status(500).json({ error: err?.message || "internal server error", eventId: res.sentry || null });
});

const port = Number(process.env.PORT || 4000);

export default app;

// Start the server when run directly
if (require.main === module) {
  app.listen(port, () => {
    info(`Webhook server listening on port ${port}`);
  });
}
