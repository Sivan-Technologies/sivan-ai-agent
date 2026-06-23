import "./instrument";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { config, validateConfig } from "./config";
import { info, error } from "./lib/logger";
import { settingsStore, initializeDatabaseSchemas } from "./context";
import { captureOperationalError } from "./services/monitoring";
import { runPaymentLifecycleSweep } from "./services/escrowService";
import { retryWorker } from "./services/retryWorkerInstance";

// Route Routers
import healthRouter from "./routes/health";
import usersRouter from "./routes/users";
import escrowsRouter from "./routes/escrows";
import webhooksRouter from "./routes/webhooks";
import adminRouter from "./routes/admin";
import opsRouter from "./routes/ops";

validateConfig();
initializeDatabaseSchemas();

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || "1"));

function safeSecretEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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

// Maintenance Mode Gate
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

// Mount modular routes
app.use(healthRouter);
app.use(usersRouter);
app.use(escrowsRouter);
app.use(webhooksRouter);
app.use(adminRouter);
app.use(opsRouter);

// Sentry Error Handler
Sentry.setupExpressErrorHandler(app);

app.use((err: any, _req: any, res: any, _next: any) => {
  error("Unhandled error in HTTP pipeline", err && (err.message || err));
  res.status(500).json({ error: err?.message || "internal server error", eventId: res.sentry || null });
});

// Background intervals
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

const port = Number(process.env.PORT || 4000);

export default app;

// Start the server when run directly
if (require.main === module) {
  app.listen(port, () => {
    info(`Webhook server listening on port ${port}`);
  });
}
