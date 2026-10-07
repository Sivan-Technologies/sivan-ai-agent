import { describe, expect, it } from "vitest";
import { extractErrorLocation, formatTelegramAlert, type OperationalEvent } from "../src/services/monitoring";

describe("Operational Alert Diagnostic Location Tracking", () => {
  it("extracts caller, file, and line from an Error stack trace", () => {
    const error = new Error("Simulated database failure");
    error.stack = `Error: Simulated database failure
    at Object.query (/app/node_modules/pg/lib/client.js:100:10)
    at runPaymentLifecycleSweep (/app/src/services/lifecycleSweeps.ts:55:10)
    at /app/src/server.ts:216:7`;

    const loc = extractErrorLocation(error);
    expect(loc.service).toBe("sivan-escrow-agent");
    expect(loc.caller).toBe("runPaymentLifecycleSweep");
    expect(loc.location).toBe("src/services/lifecycleSweeps.ts:55");
  });

  it("extracts anonymous caller when an error occurs directly in a root script", () => {
    const error = new Error("Quota exceeded");
    error.stack = `Error: Quota exceeded
    at /app/src/server.ts:208:15
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

    const loc = extractErrorLocation(error);
    expect(loc.service).toBe("sivan-escrow-agent");
    expect(loc.caller).toBe("anonymous");
    expect(loc.location).toBe("src/server.ts:208");
  });

  it("formats Telegram alert with diagnostic repo, location, and caller lines", () => {
    const event: OperationalEvent = {
      id: "ops-test-1",
      level: "error",
      message: "Background retry worker failed",
      service: "sivan-escrow-agent",
      location: "src/server.ts:208",
      caller: "retryWorker.processBatch",
      createdAt: "2026-10-07T14:45:00.000Z",
      error: "Your account or project has exceeded the quota.",
      context: { provider: "neon" },
    };

    const text = formatTelegramAlert(event);
    expect(text).toContain("🚨 Sivan ERROR Alert");
    expect(text).toContain("Service: sivan-escrow-agent");
    expect(text).toContain("Location: src/server.ts:208");
    expect(text).toContain("Caller: retryWorker.processBatch()");
    expect(text).toContain("Action: Background retry worker failed");
    expect(text).toContain("Error: Your account or project has exceeded the quota.");
  });
});
