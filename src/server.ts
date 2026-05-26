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
import { requireAdminAuth, logAdminAction } from "./middleware/adminAuth";
import { requireCoreApiAuth } from "./middleware/apiAuth";
import { adminSettingsSchema, formatZodError, limitQuerySchema, paystackWebhookSchema, taskRequestSchema } from "./validation";
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
const workflowStore = new WorkflowStore(config.app.databaseUrl);
const Database = require("better-sqlite3");
const db = new Database(config.app.databaseUrl);
const settingsStore = new SettingsStore(db);
// Initialize settings schema if not present
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_settings'").get()) {
  settingsStore.initializeSchema();
}
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

app.get("/health/readiness", (req, res) => {
  // readiness can include DB or downstream checks; keep simple for now
  try {
    // a light check that workflow store DB path is configured
    if (!config.app.databaseUrl) {
      return res.status(500).json({ status: "unready", reason: "database not configured" });
    }
    res.status(200).json({ status: "ready" });
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
    workflowStore.addWebhookEvent(String(event.id || crypto.randomUUID()), paymentReference, eventType, JSON.stringify(event));
    const task = workflowStore.findTaskByPaymentReference(paymentReference);
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

        workflowStore.updateTaskStatus(task.taskId, "payment_confirmed", `Paystack event verified: ${eventType}`);
        info("Updated workflow task status from verified Paystack webhook", { taskId: task.taskId, paymentReference });
        const execution = await orchestrator.executeConfirmedNairaTask(task.taskId);
        if ((execution as any).skipped) {
          info("Paystack webhook execution skipped", execution);
        }
      } else {
        const shouldKeepCurrentStatus = ["executing", "completed", "settled"].includes(task.paymentStatus);
        if (!shouldKeepCurrentStatus) {
          workflowStore.updateTaskStatus(task.taskId, "payment_event_received", `Paystack event: ${eventType}`);
        }
        const updatedTask = workflowStore.getTaskById(task.taskId);
        if (updatedTask) {
          await notifyWhatsAppBot(updatedTask.userEmail, formatTaskSummary(updatedTask));
        }
      }
    } else {
      capturePaymentWarning("Paystack webhook did not match any workflow task", { paymentReference, eventType });
    }
  }

    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    captureOperationalError("Paystack webhook processing failed", err);
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

app.get("/admin/tasks", requireAdminAuth, (req, res) => {
  const tasks = workflowStore.getAllTasks();
  res.status(200).json(tasks);
});

app.get("/admin/tasks/:taskId", requireAdminAuth, (req, res) => {
  const task = workflowStore.getTaskById(req.params.taskId);
  if (!task) {
    return res.status(404).send({ error: "Task not found" });
  }
  res.status(200).json(task);
});

app.get("/admin/webhooks", requireAdminAuth, (req, res) => {
  const parsed = limitQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
  }
  const limit = parsed.data.limit;
  const events = workflowStore.getWebhookEvents(limit);
  res.status(200).json(events);
});

// Admin Settings Endpoints (requires authentication)
app.get("/admin/settings", requireAdminAuth, (req, res) => {
  try {
    const settings = settingsStore.getSettings();
    res.status(200).json(settings);
  } catch (err: any) {
    error("Failed to fetch settings", err.message || err);
    res.status(500).json({ error: err.message || "Failed to fetch settings" });
  }
});

app.post("/admin/settings", requireAdminAuth, logAdminAction("update_settings"), (req, res) => {
  try {
    const adminUser = (req as any).adminUser || "unknown";
    const parsed = adminSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid settings payload", details: formatZodError(parsed.error) });
    }
    const updates = parsed.data;

    // Update settings with optimistic locking
    const updated = settingsStore.updateSettings({
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

app.get("/admin/audit-history", requireAdminAuth, (req, res) => {
  try {
    const parsed = limitQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: formatZodError(parsed.error) });
    }
    const limit = parsed.data.limit;
    const history = settingsStore.getAuditHistory(limit);
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
