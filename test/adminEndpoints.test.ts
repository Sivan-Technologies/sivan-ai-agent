import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-admin-settings.db");
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.CORE_API_SECRET = "test-core-key";
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.NOTIFICATION_URL = "";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;

describe("Admin Settings API Integration", () => {
  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // SQLite may still have the file open while the app is alive.
      }
    }
  });

  it("should reject unauthorized access to admin settings", async () => {
    const res = await request(app).get("/admin/settings");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/i);
  });

  it("should fetch fee settings with admin credentials", async () => {
    const res = await request(app)
      .get("/admin/settings")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nairaFeePercent: 2.5,
      nairaFeeFixed: 50,
      usdcFeePercent: 1.5,
      usdcFeeFixed: 0.5,
      version: 1,
    });
  });

  it("should update fee settings and return the updated config", async () => {
    const updatePayload = {
      nairaFeePercent: 3.5,
      nairaFeeFixed: 75,
      usdcFeePercent: 2.0,
      usdcFeeFixed: 0.75,
      expectedVersion: 1,
    };

    const res = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send(updatePayload);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nairaFeePercent: 3.5,
      nairaFeeFixed: 75,
      usdcFeePercent: 2.0,
      usdcFeeFixed: 0.75,
      version: 2,
    });
  });

  it("should return conflict when updating with a stale expectedVersion", async () => {
    const stalePayload = {
      nairaFeePercent: 4.0,
      nairaFeeFixed: 100,
      usdcFeePercent: 2.5,
      usdcFeeFixed: 1.0,
      expectedVersion: 1,
    };

    const res = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send(stalePayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Settings version mismatch");
  });

  it("should expose audit history after settings updates", async () => {
    const res = await request(app)
      .get("/admin/audit-history?limit=20")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("settingName");
    expect(res.body[0]).toHaveProperty("newValue");
    expect(res.body[0]).toHaveProperty("changedBy");
  });

  it("should expose protected database status", async () => {
    const unauthorized = await request(app).get("/admin/db-status");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/db-status")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      provider: "sqlite",
      configured: true,
    });
    expect(res.body).toHaveProperty("settingsVersion");
    expect(res.body).toHaveProperty("latencyMs");
    expect(res.body).not.toHaveProperty("databaseUrl");
  });

  it("should expose protected operations visibility", async () => {
    const unauthorized = await request(app).get("/admin/ops/status");
    expect(unauthorized.status).toBe(401);

    const status = await request(app)
      .get("/admin/ops/status")
      .set("x-admin-key", "test-admin-key");

    expect(status.status).toBe(200);
    expect(status.body).toHaveProperty("database");
    expect(status.body).toHaveProperty("operations");
    expect(status.body.operations).toHaveProperty("sentryConfigured");
    expect(status.body.operations).toHaveProperty("alertsConfigured");

    const events = await request(app)
      .get("/admin/ops/events?limit=10")
      .set("x-admin-key", "test-admin-key");

    expect(events.status).toBe(200);
    expect(Array.isArray(events.body)).toBe(true);
  });

  it("should expose protected disaster recovery readiness without secrets", async () => {
    const unauthorized = await request(app).get("/admin/dr/status");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/dr/status")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("backup");
    expect(res.body).toHaveProperty("restore");
    expect(res.body).toHaveProperty("rollback");
    expect(res.body).toHaveProperty("outage");
    expect(res.body.backup).toHaveProperty("configured");
    expect(res.body.restore).toHaveProperty("fresh");
    expect(res.body).not.toHaveProperty("databaseUrl");
    expect(JSON.stringify(res.body)).not.toContain("postgresql://");
  });

  it("should protect settlement verification proof endpoints", async () => {
    const unauthorized = await request(app).get("/admin/settlement/verification");
    expect(unauthorized.status).toBe(401);

    const latest = await request(app)
      .get("/admin/settlement/verification")
      .set("x-admin-key", "test-admin-key");

    expect([200, 404]).toContain(latest.status);
    expect(latest.body).toHaveProperty("status");
  });

  it("should expose production ops workflow endpoints", async () => {
    const headers = { "x-admin-key": "test-admin-key" };

    const queue = await request(app).get("/admin/queue/status").set(headers);
    expect(queue.status).toBe(200);
    expect(queue.body).toMatchObject({
      status: expect.any(String),
      queued: expect.any(Number),
      failed: expect.any(Number),
      dead: expect.any(Number),
    });

    const job = await request(app)
      .post("/admin/queue/jobs")
      .set(headers)
      .send({
        jobType: "whatsapp_notification",
        payload: { to: "whatsapp:+2348000000000", message: "Smoke notification" },
        maxAttempts: 2,
      });
    expect(job.status).toBe(201);
    expect(job.body).toHaveProperty("jobId");

    const jobDetail = await request(app).get(`/admin/queue/jobs/${job.body.jobId}`).set(headers);
    expect(jobDetail.status).toBe(200);
    expect(jobDetail.body.status).toBe("queued");

    const retried = await request(app)
      .post(`/admin/queue/jobs/${job.body.jobId}/retry`)
      .set(headers)
      .send({ resetAttempts: true });
    expect(retried.status).toBe(200);
    expect(retried.body.status).toBe("queued");

    const run = await request(app)
      .post("/admin/queue/run")
      .set(headers)
      .send({ limit: 5 });
    expect(run.status).toBe(200);
    expect(run.body.result.processed).toBeGreaterThanOrEqual(1);

    const abuse = await request(app).get("/admin/abuse/signals?limit=10").set(headers);
    expect(abuse.status).toBe(200);
    expect(Array.isArray(abuse.body)).toBe(true);

    const abuseAnalytics = await request(app).get("/admin/abuse/analytics?limit=50").set(headers);
    expect(abuseAnalytics.status).toBe(200);
    expect(abuseAnalytics.body).toHaveProperty("totals");
    expect(abuseAnalytics.body).toHaveProperty("reputationWatchlist");
    expect(abuseAnalytics.body).toHaveProperty("velocityWatchlist");
    expect(abuseAnalytics.body).toHaveProperty("suggestedActions");

    const abuseAction = await request(app)
      .post("/admin/abuse/actions")
      .set(headers)
      .send({ subjectType: "user", subjectId: "whatsapp:+2348000000000", action: "watch", reason: "test watch action" });
    expect(abuseAction.status).toBe(201);
    expect(abuseAction.body).toMatchObject({ action: "watch", subjectId: "whatsapp:+2348000000000" });

    const abuseActions = await request(app).get("/admin/abuse/actions?limit=10").set(headers);
    expect(abuseActions.status).toBe(200);
    expect(Array.isArray(abuseActions.body)).toBe(true);

    const support = await request(app).get("/admin/support/cases?limit=10").set(headers);
    expect(support.status).toBe(200);
    expect(Array.isArray(support.body)).toBe(true);

    const disputes = await request(app).get("/admin/disputes?limit=10").set(headers);
    expect(disputes.status).toBe(200);
    expect(Array.isArray(disputes.body)).toBe(true);

    const created = await request(app)
      .post("/admin/support/cases")
      .set(headers)
      .send({ subject: "Buyer cannot find payment link", priority: "normal", source: "test", note: "Initial support note" });
    expect(created.status).toBe(201);
    expect(created.body).toHaveProperty("caseId");

    const note = await request(app)
      .post(`/admin/support/cases/${created.body.caseId}/notes`)
      .set(headers)
      .send({ body: "Follow-up note", actionType: "follow_up" });
    expect(note.status).toBe(201);
    expect(note.body).toHaveProperty("noteId");

    const updated = await request(app)
      .patch(`/admin/support/cases/${created.body.caseId}`)
      .set(headers)
      .send({ status: "pending", assignedTo: "ops", note: "Assigned to operations" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: "pending", assignedTo: "ops" });

    const search = await request(app).get("/admin/support/search?q=Buyer").set(headers);
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body)).toBe(true);
  });

  it("should allow escrow participants to submit dispute evidence through the core API", async () => {
    const created = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        buyerWhatsapp: "whatsapp:+2348000000001",
        sellerWhatsapp: "whatsapp:+2348000000002",
        amount: 10000,
        currency: "NAIRA",
        purpose: "dispute evidence test",
        channel: "whatsapp_dm",
      });
    expect(created.status).toBe(201);
    const escrowId = created.body.escrow.escrowId;

    const disputed = await request(app)
      .post(`/api/escrows/${escrowId}/dispute`)
      .set("x-core-api-key", "test-core-key")
      .send({ actorWhatsapp: "whatsapp:+2348000000001", reason: "Testing participant evidence" });
    expect(disputed.status).toBe(200);
    expect(disputed.body.status).toBe("DISPUTED");

    const evidence = await request(app)
      .post(`/api/escrows/${escrowId}/dispute/evidence`)
      .set("x-core-api-key", "test-core-key")
      .send({
        actorWhatsapp: "whatsapp:+2348000000001",
        evidenceType: "message",
        summary: "Buyer submitted private WhatsApp evidence",
        notifyParticipants: false,
      });
    expect(evidence.status).toBe(201);
    expect(evidence.body.events.some((event: any) => event.eventType === "dispute_evidence_recorded")).toBe(true);

    const outsider = await request(app)
      .post(`/api/escrows/${escrowId}/dispute/evidence`)
      .set("x-core-api-key", "test-core-key")
      .send({
        actorWhatsapp: "whatsapp:+2348000000999",
        evidenceType: "message",
        summary: "Outsider evidence should fail",
      });
    expect(outsider.status).toBe(403);
  });

  it("should expose protected escrow ledger", async () => {
    const unauthorized = await request(app).get("/admin/escrows");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/escrows")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("should expose protected reconciliation summary and CSV export", async () => {
    const unauthorized = await request(app).get("/admin/reconciliation");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/reconciliation?limit=20")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.needsAttention).toMatchObject({
      paymentsNeedingReview: expect.any(Number),
      releasesAwaitingPayout: expect.any(Number),
      releasedMissingPayoutReference: expect.any(Number),
      paystackAmountMismatches: expect.any(Number),
    });

    const csv = await request(app)
      .get("/admin/reconciliation.csv?limit=20")
      .set("x-admin-key", "test-admin-key");

    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("escrow ID");
    expect(csv.text).toContain("Paystack reference");
  });
});
