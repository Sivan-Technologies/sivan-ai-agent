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

  it("should enforce the configured new-user Naira escrow limit", async () => {
    const res = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        buyerWhatsapp: "whatsapp:+2348000000101",
        sellerWhatsapp: "whatsapp:+2348000000102",
        amount: 100001,
        currency: "NAIRA",
        purpose: "tier limit enforcement test",
        channel: "whatsapp_dm",
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "ESCROW_LIMIT_REVIEW_REQUIRED",
      policy: {
        tier: "NEW",
        tierLimit: 100000,
        requestedAmount: 100001,
      },
    });
  });

  it("should queue, approve, and reject one-time escrow limit reviews", async () => {
    const settingsResponse = await request(app).get("/admin/settings").set("x-admin-key", "test-admin-key");
    const settings = settingsResponse.body;
    const update = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send({
        nairaFeePercent: settings.nairaFeePercent,
        nairaFeeFixed: settings.nairaFeeFixed,
        usdcFeePercent: settings.usdcFeePercent,
        usdcFeeFixed: settings.usdcFeeFixed,
        nairaNewUserLimit: 200000,
        nairaTrustedUserLimit: 300000,
        nairaEstablishedUserLimit: 500000,
        nairaSpecialApprovalLimit: 1000000,
        nairaBuyerActiveExposureLimit: 250000,
        nairaPlatformActiveExposureLimit: 10000000,
        trustedUserSuccessfulEscrows: 3,
        establishedUserSuccessfulEscrows: 10,
        expectedVersion: settings.version,
      });
    expect(update.status).toBe(200);

    const normal = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        clientRequestId: "review-normal-1",
        buyerWhatsapp: "whatsapp:+2348000000201",
        sellerWhatsapp: "whatsapp:+2348000000202",
        amount: 150000,
        currency: "NAIRA",
        purpose: "normal limit test",
        channel: "whatsapp_dm",
      });
    expect(normal.status).toBe(201);

    const exposureBlocked = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        clientRequestId: "review-exposure-1",
        buyerWhatsapp: "whatsapp:+2348000000201",
        sellerWhatsapp: "whatsapp:+2348000000203",
        amount: 150000,
        currency: "NAIRA",
        purpose: "buyer exposure review test",
        channel: "whatsapp_dm",
      });
    expect(exposureBlocked.status).toBe(409);
    expect(exposureBlocked.body.error).toBe("BUYER_EXPOSURE_LIMIT_REACHED");
    expect(exposureBlocked.body.review.status).toBe("pending");

    const approved = await request(app)
      .post(`/admin/escrow-limit-reviews/${exposureBlocked.body.review.reviewId}/approve`)
      .set("x-admin-key", "test-admin-key")
      .send({ notes: "Buyer transaction context reviewed and approved for this request only." });
    expect(approved.status).toBe(200);
    expect(approved.body.review.status).toBe("approved");
    expect(approved.body.escrow.amount).toBe(150000);

    const tierBlocked = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        clientRequestId: "review-tier-reject-1",
        buyerWhatsapp: "whatsapp:+2348000000211",
        sellerWhatsapp: "whatsapp:+2348000000212",
        amount: 250000,
        currency: "NAIRA",
        purpose: "tier rejection test",
        channel: "whatsapp_dm",
      });
    expect(tierBlocked.status).toBe(409);
    expect(tierBlocked.body.error).toBe("ESCROW_LIMIT_REVIEW_REQUIRED");

    const repeated = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-key")
      .send({
        clientRequestId: "review-tier-reject-1",
        buyerWhatsapp: "whatsapp:+2348000000211",
        sellerWhatsapp: "whatsapp:+2348000000212",
        amount: 250000,
        currency: "NAIRA",
        purpose: "tier rejection test",
        channel: "whatsapp_dm",
      });
    expect(repeated.body.review.reviewId).toBe(tierBlocked.body.review.reviewId);

    const rejected = await request(app)
      .post(`/admin/escrow-limit-reviews/${tierBlocked.body.review.reviewId}/reject`)
      .set("x-admin-key", "test-admin-key")
      .send({ notes: "Buyer needs additional successful escrow history before this amount." });
    expect(rejected.status).toBe(200);
    expect(rejected.body.review.status).toBe("rejected");

    const reviews = await request(app).get("/admin/escrow-limit-reviews?limit=20").set("x-admin-key", "test-admin-key");
    expect(reviews.status).toBe(200);
    expect(reviews.body.some((review: any) => review.status === "approved" && review.approvedEscrowId)).toBe(true);
    expect(reviews.body.some((review: any) => review.status === "rejected")).toBe(true);
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

  it("should expose WhatsApp provider status through protected admin proxy", async () => {
    const unauthorized = await request(app).get("/admin/whatsapp-provider");
    expect(unauthorized.status).toBe(401);

    const status = await request(app)
      .get("/admin/whatsapp-provider")
      .set("x-admin-key", "test-admin-key");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      activeProvider: "unknown",
      configured: false,
      providers: {
        twilio: { configured: false },
        meta: { configured: false },
      },
    });

    const invalid = await request(app)
      .post("/admin/whatsapp-provider")
      .set("x-admin-key", "test-admin-key")
      .send({ provider: "telegram" });
    expect(invalid.status).toBe(400);
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

    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({
      status: "not_run",
      sap: { status: "not_run" },
      x402: { status: "not_run" },
    });
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

  it("should expose protected revenue analytics with separate currencies and accounting basis", async () => {
    const unauthorized = await request(app).get("/admin/revenue");
    expect(unauthorized.status).toBe(401);

    const res = await request(app)
      .get("/admin/revenue")
      .set("x-admin-key", "test-admin-key");

    expect(res.status).toBe(200);
    expect(res.body.accountingBasis).toMatchObject({
      processedVolume: "verified funding ledger entries",
      platformFees: "captured platform fee ledger entries",
      processorFees: "actual provider-reported transaction fees only",
      testActivity: "sandbox and test-override transactions excluded",
    });
    expect(res.body.excludedTestActivity).toMatchObject({
      transactionCount: expect.any(Number),
      processedVolumeByCurrency: expect.any(Array),
    });
    expect(res.body.periods.map((period: any) => period.key)).toEqual(["day", "week", "month", "all"]);
    expect(res.body.periods[0].currencies.map((row: any) => row.currency)).toEqual(["NAIRA", "USDC"]);
    expect(Array.isArray(res.body.processorBreakdown)).toBe(true);
  });
});
