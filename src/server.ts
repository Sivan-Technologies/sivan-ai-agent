import "./instrument";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import crypto from "crypto";
import { config, validateConfig } from "./config";
import { info, error } from "./lib/logger";
import { requestStorage } from "./utils/logger";
import { settingsStore, initializeDatabaseSchemas } from "./context";
import { captureOperationalError } from "./services/monitoring";
import { runPaymentLifecycleSweep } from "./services/escrowService";
import { retryWorker } from "./services/retryWorkerInstance";
import { runDailyReconciliation } from "./services/reconciliationService";

// Route Routers
import healthRouter from "./routes/health";
import usersRouter from "./routes/users";
import escrowsRouter from "./routes/escrows";
import webhooksRouter from "./routes/webhooks";
import adminRouter from "./routes/admin";
import opsRouter from "./routes/ops";
import sandboxRouter from "./routes/sandbox";

validateConfig();
initializeDatabaseSchemas();

const app = express();

app.use((req: any, res, next) => {
  const reqId = req.headers["x-sivan-request-id"] || `siv-req-${crypto.randomUUID()}`;
  req.requestId = reqId;
  res.setHeader("x-sivan-request-id", reqId);
  requestStorage.run(reqId, () => {
    next();
  });
});
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

// The permissive wildcard is reserved for explicit local development. Gating it
// on `NODE_ENV !== "production"` previously meant an unset or misspelled
// NODE_ENV (a common container misconfiguration) served `Access-Control-Allow-
// Origin: *` from a real deployment, letting any site call this API from a
// victim's browser. The wildcard is now only reachable with an explicit
// NODE_ENV=development.

// Anywhere else, an unset FRONTEND_URL denies cross-origin requests outright
// (`origin: false` sends no Access-Control-Allow-Origin header) rather than
// falling back to `*`.
//
// This is validated at startup by assertCorsOriginConfigured() rather than at
// module import, so that importing this module - as the test suite does - does
// not require the variable to be set. An import-time throw took the whole
// suite down with it.
const corsOrigin = process.env.FRONTEND_URL;
const isDevelopment = process.env.NODE_ENV === "development";

export function assertCorsOriginConfigured(): void {
  if (!corsOrigin && !isDevelopment) {
    throw new Error(
      "FRONTEND_URL must be specified unless NODE_ENV=development; CORS wildcard is disabled."
    );
  }
}

app.use(cors({ origin: corsOrigin || (isDevelopment ? "*" : false) }));


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
  if (!req.path.startsWith("/api/") || req.path === "/api/health" || req.path === "/health") return next();
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

// Normalize incoming admin and API route prefixes from proxies and gateways
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/admin/admin/")) {
    req.url = req.url.replace(/^\/api\/admin\/admin\//, "/admin/");
  } else if (req.url.startsWith("/admin/admin/")) {
    req.url = req.url.replace(/^\/admin\/admin\//, "/admin/");
  } else if (req.url.startsWith("/api/admin/")) {
    req.url = req.url.replace(/^\/api\/admin\//, "/admin/");
  }
  next();
});

// Mount modular routes
app.use(healthRouter);
app.use(usersRouter);
app.use(escrowsRouter);
app.use(webhooksRouter);
app.use(adminRouter);
app.use(opsRouter);
app.use(sandboxRouter);

// Sentry Error Handler
Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: any, res: any, _next: any) => {
  // Log the full detail server-side, but never echo raw exception text back to
  // the caller. Unhandled errors here originate from the database driver,
  // payment provider SDKs and other internals, so their messages can disclose
  // schema, query fragments, upstream URLs or credentials. The request id and
  // Sentry event id give support everything needed to correlate a report.
  error("Unhandled error in HTTP pipeline", err && (err.message || err));
  res.status(500).json({
    error: "internal server error",
    requestId: req?.requestId || null,
    eventId: res.sentry || null,
  });
});

// Background intervals — started based on database settings
settingsStore.getSettings().then((settings) => {
  if (settings.queueWorkerEnabled) {
    const intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || "15000");
    setInterval(() => {
      retryWorker.processBatch(Number(process.env.QUEUE_WORKER_BATCH_SIZE || "5"), "background-worker")
        .catch((err) => captureOperationalError("Background retry worker failed", err));
    }, intervalMs);
    info("Queue retry worker started", { intervalMs });
  }

  if (settings.paymentLifecycleWorkerEnabled) {
    const intervalMs = settings.paymentLifecycleWorkerIntervalMs;
    setInterval(() => {
      runPaymentLifecycleSweep()
        .catch((err) => captureOperationalError("Payment lifecycle sweep failed", err));
    }, intervalMs);
    info("Payment lifecycle worker started", { intervalMs });
  }

  if (settings.reconciliationWorkerEnabled) {
    const intervalMs = Number(process.env.RECONCILIATION_WORKER_INTERVAL_MS || String(24 * 60 * 60 * 1000));
    const initialDelayMs = Number(process.env.RECONCILIATION_WORKER_INITIAL_DELAY_MS || "60000");
    const run = () => {
      runDailyReconciliation({ reason: "scheduled" })
        .catch((err) => captureOperationalError("Daily reconciliation worker failed", err));
    };
    setTimeout(run, initialDelayMs);
    setInterval(run, intervalMs);
    info("Reconciliation worker started", { intervalMs, initialDelayMs });
  }
}).catch((err) => {
  error("Failed to read settings for worker startup — workers disabled", err?.message || err);
});

const port = Number(process.env.PORT || 4000);

export default app;

// Start the server when run directly
if (require.main === module) {
  // Refuse to boot a real deployment that would serve a permissive CORS policy.
  // Checked here rather than at import so the test suite can load this module.
  assertCorsOriginConfigured();
  app.listen(port, () => {
    info(`Webhook server listening on port ${port}`);
  });
}

