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
import { notifyWhatsAppBot, formatTaskSummary } from "./services/notificationService";
import { WorkflowStore } from "./services/workflowStore";
import { SettingsStore } from "./services/settingsStore";
import { EscrowStore } from "./services/escrowStore";
import { requireAdminAuth, logAdminAction } from "./middleware/adminAuth";
import { requireCoreApiAuth } from "./middleware/apiAuth";
import {
  adminSettingsSchema,
  adminReleaseApprovalSchema,
  escrowActionSchema,
  escrowCreateSchema,
  formatZodError,
  limitQuerySchema,
  paystackWebhookSchema,
  payoutAccountSchema,
  taskRequestSchema,
  userProfileSchema,
} from "./validation";
import { captureOperationalError, capturePaymentWarning } from "./services/monitoring";
import crypto from "crypto";

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
void settingsStore.initializeSchema();
void escrowStore.initializeSchema();
const orchestrator = new AgentOrchestrator(sapAgent, aceData, paymentRouter, workflowStore);
const paystackClient = new PaystackClient();

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
      releaseRequested: escrow.status === "PENDING_RELEASE",
      nextAction:
        escrow.status === "PENDING_ACCEPTANCE"
          ? "seller_acceptance_required"
          : escrow.currency === "NAIRA" && !sellerProfileComplete
          ? "seller_profile_required"
          : escrow.currency === "NAIRA" && !payoutVerified
          ? "seller_payout_verification_required"
          : escrow.status === "PENDING_PAYMENT"
          ? "buyer_payment_required"
          : escrow.status === "IN_PROGRESS"
          ? "delivery_or_release_required"
          : escrow.status === "PENDING_RELEASE"
          ? "admin_manual_payout_required"
          : "monitor",
    },
  };
}

app.get("/health/readiness", async (req, res) => {
  try {
    if (!config.app.databaseUrl) {
      return res.status(500).json({ status: "unready", reason: "database not configured" });
    }
    const database = await buildDatabaseStatus();
    res.status(200).json({ status: "ready", database });
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
    res.status(201).json({ escrow: updated, payment, sellerInviteSent: Boolean(seller) });
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
    res.status(400).json({ error: err.message || "Release request failed" });
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
      warn("Missing Paystack signature header");
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await paystackClient.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      warn("Invalid Paystack signature");
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
        if (transaction.status !== "success") {
          capturePaymentWarning("Paystack escrow webhook verification did not confirm success", {
            escrowId: escrow.escrowId,
            paymentReference,
            status: transaction.status,
          });
          return res.status(202).send({ status: "verification_pending" });
        }

        const funded = await escrowStore.markFundedByPaymentReference(paymentReference, transaction);
        if (funded) {
          info("Escrow funded from verified Paystack webhook", { escrowId: funded.escrowId, paymentReference });
          await notifyWhatsAppBot(funded.sellerWhatsapp || escrow.buyerUserId, `Escrow ${funded.escrowId} is funded. Seller may proceed.`);
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
    captureOperationalError("Paystack webhook processing failed", err);
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

app.post("/admin/escrows/:escrowId/approve-release", requireAdminAuth, logAdminAction("approve_escrow_release"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminReleaseApprovalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payout reconciliation payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.approveManualRelease(req.params.escrowId, adminUser, parsed.data);
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Release approval failed" });
  }
});

app.post("/admin/escrows/:escrowId/dispute", requireAdminAuth, logAdminAction("admin_dispute_escrow"), async (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = escrowActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dispute payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.markDisputed(req.params.escrowId, adminUser, "admin", parsed.data.reason);
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Dispute failed" });
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
