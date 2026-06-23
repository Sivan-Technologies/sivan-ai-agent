import { Router } from "express";
import * as Sentry from "@sentry/node";
import { config } from "../config";
import { buildDatabaseStatus } from "../services/escrowService";
import { buildOperationalVisibility } from "../services/monitoring";

const router = Router();

router.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

router.get("/health/readiness", async (req, res) => {
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

if (process.env.SENTRY_DEBUG_ENDPOINT_ENABLED === "true") {
  router.get("/debug-sentry", (_req, _res) => {
    Sentry.logger.info("Sivan escrow Sentry debug endpoint triggered", {
      action: "debug_sentry",
      service: "sivan-escrow-agent",
    });
    Sentry.metrics.count("sivan_escrow_debug_sentry", 1);
    throw new Error("Sivan escrow Sentry debug error");
  });
}

export default router;
