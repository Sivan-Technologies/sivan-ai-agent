import fs from "fs";
import path from "path";
import crypto from "crypto";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-admin-settings.db");
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_IP_ALLOWLIST = "";
process.env.ADMIN_ALLOWED_IPS = "";
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.NOTIFICATION_URL = "";
process.env.ACTIVE_PAYMENT_PROVIDER = "flutterwave";
process.env.BACKUP_PAYMENT_PROVIDER = "palmpay";
process.env.EMERGENCY_PAYMENT_PROVIDER = "flutterwave";
process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED = "false";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "8102524846";
process.env.PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS = "whatsapp:+2348000000902";
process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET = "test-twilio-debugger-secret";
process.env.NOMBA_WEBHOOK_SECRET = "test-nomba-webhook-secret";
const palmpayPlatformKeys = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
process.env.PALMPAY_PLATFORM_PUBLIC_KEY = palmpayPlatformKeys.publicKey;

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;

function palmpaySign(payload: Record<string, unknown>) {
  const canonical = Object.keys(payload)
    .filter((key) => key !== "sign" && payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== "")
    .sort()
    .map((key) => `${key}=${String(payload[key]).trim()}`)
    .join("&");
  const digest = crypto.createHash("md5").update(canonical, "utf8").digest("hex").toUpperCase();
  return crypto.createSign("RSA-SHA1").update(digest).sign(palmpayPlatformKeys.privateKey, "base64");
}

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

  it("should receive Twilio Debugger events only with the shared secret", async () => {
    const unauthorized = await request(app)
      .post("/webhooks/twilio-debugger")
      .send({ Sid: "NOAUTH", Level: "Error", Payload: "{}" });
    expect(unauthorized.status).toBe(401);

    const accepted = await request(app)
      .post("/webhooks/twilio-debugger?secret=test-twilio-debugger-secret")
      .send({
        AccountSid: "AC123",
        Sid: "NO00000000000000000000000000000001",
        Timestamp: "2026-06-13T04:12:29Z",
        Level: "Error",
        PayloadType: "application/json",
        Payload: JSON.stringify({
          error_code: 63024,
          message: "Twilio could not deliver a WhatsApp message",
          more_info: "https://www.twilio.com/docs/api/errors/63024",
        }),
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ received: true });

    const formEncoded = await request(app)
      .post("/webhooks/twilio-debugger?secret=test-twilio-debugger-secret")
      .type("form")
      .send({
        AccountSid: "ACFORM",
        Sid: "NOFORM0000000000000000000000000001",
        Timestamp: "2026-06-13T06:42:08Z",
        Level: "Warning",
        Payload: JSON.stringify({
          error_code: 11200,
          message: "HTTP retrieval failure",
          more_info: "https://www.twilio.com/docs/api/errors/11200",
        }),
      });
    expect(formEncoded.status).toBe(200);
    expect(formEncoded.body).toMatchObject({ received: true });

    const generic = await request(app)
      .post("/webhooks/twilio-debugger?secret=test-twilio-debugger-secret")
      .send({});
    expect(generic.status).toBe(200);
    expect(generic.body).toMatchObject({ received: true, ignored: "missing_structured_details" });
  });

  it("should verify signed Nomba payout webhooks before accepting them", async () => {
    const payload = {
      event_type: "payout_success",
      requestId: "nomba-request-001",
      data: {
        merchant: {
          name: "Sivan",
          walletId: "wallet-001",
        },
        transaction: {
          transactionId: "API-TRANSFER-NOMBA-001",
          type: "transfer",
          status: "SUCCESS",
          amount: 100,
          fee: 0,
          transactionAmount: 100,
          transactionFee: 0,
          createdAt: "2026-06-27T10:00:00Z",
          timeCreated: "2026-06-27T10:00:00Z",
          terminalId: "terminal-001",
          merchantTxRef: "NOMBA_release_SIV_TEST",
        },
      },
    };
    const timestamp = "2026-06-27T10:01:00Z";
    const canonical =
      "payout_success" +
      "nomba-request-001" +
      "Sivan" +
      "wallet-001" +
      "API-TRANSFER-NOMBA-001" +
      "transfer" +
      "SUCCESS" +
      "100" +
      "0" +
      "100" +
      "0" +
      "2026-06-27T10:00:00Z" +
      "2026-06-27T10:00:00Z" +
      "terminal-001" +
      "NOMBA_release_SIV_TEST" +
      timestamp;
    const signature = crypto.createHmac("sha256", "test-nomba-webhook-secret").update(canonical).digest("base64");

    const rejected = await request(app)
      .post("/webhooks/nomba")
      .set("nomba-signature", "bad-signature")
      .set("nomba-timestamp", timestamp)
      .send(payload);
    expect(rejected.status).toBe(400);

    const accepted = await request(app)
      .post("/webhooks/nomba")
      .set("nomba-signature", signature)
      .set("nomba-timestamp", timestamp)
      .send(payload);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ status: "received" });
  });

  it("should verify signed PalmPay collection and payout webhooks before accepting them", async () => {
    const collectionPayload = {
      orderId: "PPSIVSIGNEDTEST",
      orderNo: "2424231018025438544222",
      appId: "LTEST",
      currency: "NGN",
      amount: 10000,
      orderStatus: 2,
      completeTime: 1782555000000,
    };
    const badCollection = await request(app)
      .post("/webhooks/palmpay")
      .send({ ...collectionPayload, sign: "bad-signature" });
    expect(badCollection.status).toBe(400);

    const goodCollection = await request(app)
      .post("/webhooks/palmpay")
      .send({ ...collectionPayload, sign: palmpaySign(collectionPayload) });
    expect(goodCollection.status).toBe(202);
    expect(goodCollection.text).toBe("success");

    const payoutPayload = {
      orderId: "PPOPROOFTEST",
      orderNo: "41220723093001",
      appId: "LTEST",
      currency: "NGN",
      amount: 10000,
      orderStatus: 2,
      sessionId: "100033240509135230000500932911",
      completeTime: 1782555000000,
    };
    const badPayout = await request(app)
      .post("/webhooks/palmpay/payout")
      .send({ ...payoutPayload, sign: "bad-signature" });
    expect(badPayout.status).toBe(400);

    const goodPayout = await request(app)
      .post("/webhooks/palmpay/payout")
      .send({ ...payoutPayload, sign: palmpaySign(payoutPayload) });
    expect(goodPayout.status).toBe(200);
    expect(goodPayout.text).toBe("success");
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
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
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

  it("should expose and update protected Naira payment provider controls", async () => {
    const unauthorized = await request(app).get("/admin/payment-providers");
    expect(unauthorized.status).toBe(401);

    const status = await request(app)
      .get("/admin/payment-providers")
      .set("x-admin-key", "test-admin-key");
    expect(status.status).toBe(200);
    expect(status.body.activePaymentProvider).toBe("flutterwave");
    expect(status.body.providers.some((provider: any) => provider.provider === "monnify")).toBe(true);

    const invalid = await request(app)
      .post("/admin/payment-providers")
      .set("x-admin-key", "test-admin-key")
      .send({
        activePaymentProvider: "boguspay",
        backupPaymentProvider: "flutterwave",
        emergencyPaymentProvider: "flutterwave",
        paymentProviderFallbackEnabled: false,
        expectedVersion: status.body.version,
      });
    expect(invalid.status).toBe(400);

    const updated = await request(app)
      .post("/admin/payment-providers")
      .set("x-admin-key", "test-admin-key")
      .send({
        activePaymentProvider: "flutterwave",
        backupPaymentProvider: "monnify",
        emergencyPaymentProvider: "flutterwave",
        paymentProviderFallbackEnabled: false,
        expectedVersion: status.body.version,
      });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      activePaymentProvider: "flutterwave",
      backupPaymentProvider: "monnify",
      emergencyPaymentProvider: "flutterwave",
      paymentProviderFallbackEnabled: false,
    });
  });

  it("should switch maintenance mode and return the admin maintenance message to customer APIs", async () => {
    const currentResponse = await request(app).get("/admin/settings").set("x-admin-key", "test-admin-key");
    expect(currentResponse.status).toBe(200);
    const current = currentResponse.body;
    const maintenanceMessage = "Sivan is in scheduled maintenance for testing. Please try again shortly.";

    const maintenanceUpdate = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send({
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
        platformMode: "maintenance",
        maintenanceMessage,
        nairaPaymentMethod: "bank_transfer",
        expectedVersion: current.version,
      });
    expect(maintenanceUpdate.status).toBe(200);
    expect(maintenanceUpdate.body.platformMode).toBe("maintenance");

    const customerRequest = await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: "whatsapp:+2348000000991",
        firstName: "Mode",
        lastName: "Tester",
      });
    expect(customerRequest.status).toBe(503);
    expect(customerRequest.body).toMatchObject({
      error: "PLATFORM_MAINTENANCE",
      message: maintenanceMessage,
    });

    const restore = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send({
        nairaFeePercent: maintenanceUpdate.body.nairaFeePercent,
        nairaFeeFixed: maintenanceUpdate.body.nairaFeeFixed,
        usdcFeePercent: maintenanceUpdate.body.usdcFeePercent,
        usdcFeeFixed: maintenanceUpdate.body.usdcFeeFixed,
        nairaNewUserLimit: maintenanceUpdate.body.nairaNewUserLimit,
        nairaTrustedUserLimit: maintenanceUpdate.body.nairaTrustedUserLimit,
        nairaEstablishedUserLimit: maintenanceUpdate.body.nairaEstablishedUserLimit,
        nairaSpecialApprovalLimit: maintenanceUpdate.body.nairaSpecialApprovalLimit,
        nairaBuyerActiveExposureLimit: maintenanceUpdate.body.nairaBuyerActiveExposureLimit,
        nairaPlatformActiveExposureLimit: maintenanceUpdate.body.nairaPlatformActiveExposureLimit,
        trustedUserSuccessfulEscrows: maintenanceUpdate.body.trustedUserSuccessfulEscrows,
        establishedUserSuccessfulEscrows: maintenanceUpdate.body.establishedUserSuccessfulEscrows,
        platformMode: "test",
        maintenanceMessage,
        nairaPaymentMethod: "bank_transfer",
        expectedVersion: maintenanceUpdate.body.version,
      });
    expect(restore.status).toBe(200);
    expect(restore.body.platformMode).toBe("test");
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
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: "whatsapp:+2348000000001", reason: "Testing participant evidence" });
    expect(disputed.status).toBe(200);
    expect(disputed.body.status).toBe("DISPUTED");

    const evidence = await request(app)
      .post(`/api/escrows/${escrowId}/dispute/evidence`)
      .set("x-core-api-key", "test-core-secret")
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
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: "whatsapp:+2348000000999",
        evidenceType: "message",
        summary: "Outsider evidence should fail",
      });
    expect(outsider.status).toBe(403);
  });

  it("should let the funded seller submit delivery proof without external links", async () => {
    const headers = { "x-core-api-key": "test-core-secret" };
    const suffix = Date.now().toString().slice(-6);
    const buyerWhatsapp = `whatsapp:+23480${suffix}31`;
    const sellerWhatsapp = "whatsapp:+2348000000902";

    await request(app)
      .post("/api/users/profile")
      .set(headers)
      .send({ whatsappNumber: sellerWhatsapp, firstName: "John", lastName: "Herry" });

    await request(app)
      .post("/api/users/payout-account")
      .set(headers)
      .send({
        whatsappNumber: sellerWhatsapp,
        bankName: "Opay",
        bankCode: "999992",
        accountNumber: "8102524846",
      });

    const created = await request(app)
      .post("/api/escrows")
      .set(headers)
      .send({
        clientRequestId: `delivery-proof-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        buyerWhatsapp,
        sellerWhatsapp,
        amount: 12000,
        currency: "NAIRA",
        purpose: "delivery proof test",
        channel: "whatsapp_dm",
      });
    expect(created.status).toBe(201);
    const escrowId = created.body.escrow.escrowId;

    const accepted = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set(headers)
      .send({ actorWhatsapp: sellerWhatsapp });
    expect(accepted.status).toBe(200);

    const funded = await request(app)
      .post(`/api/escrows/${escrowId}/test-fund`)
      .set(headers)
      .send({ actorWhatsapp: buyerWhatsapp });
    expect(funded.status).toBe(200);
    expect(funded.body.escrow.status).toBe("IN_PROGRESS");

    const blockedLink = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set(headers)
      .send({
        actorWhatsapp: sellerWhatsapp,
        summary: "Delivered here https://example.com/file",
      });
    expect(blockedLink.status).toBe(400);
    expect(blockedLink.body.error).toMatch(/External delivery links/i);

    const started = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/start`)
      .set(headers)
      .send({ actorWhatsapp: sellerWhatsapp });
    expect(started.status).toBe(200);

    const proof = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set(headers)
      .send({
        actorWhatsapp: sellerWhatsapp,
        summary: "Package sent and receipt attached",
        media: [{ url: "https://api.twilio.com/media/ME123", contentType: "image/jpeg", filename: "receipt.jpg" }],
        notifyBuyer: false,
      });
    expect(proof.status).toBe(201);
    expect(proof.body.events.some((event: any) => event.eventType === "seller_delivery_proof_recorded")).toBe(true);
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
      paymentAmountMismatches: expect.any(Number),
    });

    const csv = await request(app)
      .get("/admin/reconciliation.csv?limit=20")
      .set("x-admin-key", "test-admin-key");

    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("escrow ID");
    expect(csv.text).toContain("payment reference");
  });

  it("should run and expose daily provider reconciliation history", async () => {
    const unauthorized = await request(app)
      .post("/admin/reconciliation/run")
      .send({ providers: ["palmpay"] });
    expect(unauthorized.status).toBe(401);

    const run = await request(app)
      .post("/admin/reconciliation/run")
      .set("x-admin-key", "test-admin-key")
      .send({
        providers: ["palmpay"],
        windowStart: "2026-06-25T00:00:00.000Z",
        windowEnd: "2026-06-26T00:00:00.000Z",
        alertOnFindings: false,
      });

    expect(run.status).toBe(201);
    expect(run.body.run).toMatchObject({
      status: "completed",
      providers: ["palmpay"],
    });
    expect(run.body.run.summary.providerSummaries.palmpay).toMatchObject({
      providerPullSupported: true,
      providerPullMode: "known_reference_query",
      missingInSivanDetectionSupported: false,
    });
    expect(run.body.findings.some((finding: any) => finding.findingType === "provider_pull_unsupported")).toBe(false);

    const history = await request(app)
      .get("/admin/reconciliation/runs?limit=5")
      .set("x-admin-key", "test-admin-key");
    expect(history.status).toBe(200);
    expect(history.body.runs.some((item: any) => item.runId === run.body.run.runId)).toBe(true);

    const detail = await request(app)
      .get(`/admin/reconciliation/runs/${run.body.run.runId}`)
      .set("x-admin-key", "test-admin-key");
    expect(detail.status).toBe(200);
    expect(detail.body.run.summary.providerSummaries.palmpay.providerPullMode).toBe("known_reference_query");
    expect(Array.isArray(detail.body.snapshots)).toBe(true);
  });

  it("should enforce escrow-derived manual payout approval with accounting and audit proof", async () => {
    const headers = { "x-core-api-key": "test-core-secret" };
    const adminHeaders = { "x-admin-key": "test-admin-key" };
    const buyerWhatsapp = "whatsapp:+2348000000901";
    const sellerWhatsapp = "whatsapp:+2348000000902";

    const buyerProfile = await request(app)
      .post("/api/users/profile")
      .set(headers)
      .send({ whatsappNumber: buyerWhatsapp, firstName: "Buyer", lastName: "Pilot" });
    expect(buyerProfile.status).toBe(200);

    const sellerProfile = await request(app)
      .post("/api/users/profile")
      .set(headers)
      .send({ whatsappNumber: sellerWhatsapp, firstName: "John", lastName: "Herry" });
    expect(sellerProfile.status).toBe(200);

    const payout = await request(app)
      .post("/api/users/payout-account")
      .set(headers)
      .send({
        whatsappNumber: sellerWhatsapp,
        bankName: "Opay",
        bankCode: "999992",
        accountNumber: "8102524846",
      });
    expect(payout.status).toBe(200);
    expect(payout.body).toMatchObject({
      accountNumber: "****4846",
      bankName: "Opay",
      resolvedAccountName: "John Herry",
      verificationStatus: "verified",
      accountVerificationProvider: "sandbox_test_override",
    });

    const created = await request(app)
      .post("/api/escrows")
      .set(headers)
      .send({
        clientRequestId: "admin-payout-pilot-e2e-1",
        buyerWhatsapp,
        sellerWhatsapp,
        amount: 25000,
        currency: "NAIRA",
        purpose: "admin payout pilot proof",
        channel: "whatsapp_dm",
      });
    expect(created.status).toBe(201);
    const escrowId = created.body.escrow.escrowId;

    const accepted = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set(headers)
      .send({ actorWhatsapp: sellerWhatsapp });
    expect(accepted.status).toBe(200);
    expect(accepted.body.escrow.escrow.status).toBe("PENDING_PAYMENT");
    expect(accepted.body.escrow.escrow.paymentProvider).toBe("flutterwave_sandbox_override");

    const funded = await request(app)
      .post(`/api/escrows/${escrowId}/test-fund`)
      .set(headers)
      .send({ actorWhatsapp: buyerWhatsapp });
    expect(funded.status).toBe(200);
    expect(funded.body.escrow.status).toBe("IN_PROGRESS");
    expect(funded.body.ledgerEntries.some((entry: any) => entry.entryType === "funding")).toBe(true);

    const completed = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set(headers)
      .send({ actorWhatsapp: buyerWhatsapp });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");

    const releaseRequested = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set(headers)
      .send({ actorWhatsapp: buyerWhatsapp });
    expect(releaseRequested.status).toBe(200);
    expect(releaseRequested.body.status).toBe("PENDING_RELEASE");

    const reconciliation = await request(app)
      .get("/admin/reconciliation?limit=250")
      .set(adminHeaders);
    expect(reconciliation.status).toBe(200);
    const payoutRow = reconciliation.body.rows.find((row: any) => row.escrowId === escrowId);
    expect(payoutRow).toMatchObject({
      escrowId,
      grossAmount: 25000,
      amountSource: "escrow_record",
      currency: "NAIRA",
      payoutVerified: true,
      payoutBankName: "Opay",
      payoutAccountNumber: "****4846",
      resolvedAccountName: "John Herry",
      nameMatchLevel: "strong",
      reconciliationRiskLevel: "MEDIUM",
      status: "PENDING_RELEASE",
    });
    expect(payoutRow.platformFeeAmount).toBeGreaterThan(0);
    expect(payoutRow.expectedAmount).toBe(payoutRow.grossAmount + payoutRow.platformFeeAmount);
    expect(payoutRow.sellerNetAmount).toBe(payoutRow.grossAmount);
    expect(payoutRow.receivedAmount).toBe(payoutRow.expectedAmount);
    expect(payoutRow.flags).toContain("release_awaiting_manual_payout");
    expect(payoutRow.riskLevel).toMatch(/LOW|MEDIUM|HIGH|CRITICAL/);
    expect(payoutRow.complianceRiskScore).toEqual(expect.any(Number));
    expect(payoutRow.complianceRiskLevel).toMatch(/LOW|MEDIUM|HIGH|CRITICAL/);
    expect(Array.isArray(payoutRow.complianceRiskReasons)).toBe(true);

    const rejectedManualAmount = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set(adminHeaders)
      .send({
        manualPayoutReference: "paystack-transfer-ref-extra-amount",
        sellerNetAmount: 1,
      });
    expect(rejectedManualAmount.status).toBe(400);
    expect(rejectedManualAmount.body.error).toBe("Invalid payout reconciliation payload");

    const approved = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set(adminHeaders)
      .send({
        manualPayoutReference: "paystack-transfer-ref-001",
        payoutNotes: "Admin pilot payout approved from Paystack dashboard.",
      });
    expect(approved.status).toBe(200);
    expect(approved.body.escrow).toMatchObject({
      escrowId,
      status: "RELEASED",
      manualPayoutReference: "TEST-paystack-transfer-ref-001",
      releasedBy: "unknown",
    });
    expect(approved.body.payoutQuote).toMatchObject({
      grossAmount: payoutRow.grossAmount,
      platformFeeAmount: payoutRow.platformFeeAmount,
      sellerNetAmount: payoutRow.sellerNetAmount,
      amountSource: "escrow_record",
    });

    const events = await request(app)
      .get(`/admin/escrows/${escrowId}/events?limit=100`)
      .set(adminHeaders);
    expect(events.status).toBe(200);
    expect(events.body.events.some((event: any) => event.eventType === "manual_release_approved")).toBe(true);
    expect(events.body.transactions.some((transaction: any) => (
      transaction.transactionType === "release" &&
      transaction.amount === payoutRow.sellerNetAmount &&
      transaction.reference === "TEST-paystack-transfer-ref-001"
    ))).toBe(true);

    const detail = await request(app)
      .get(`/admin/escrows/${escrowId}`)
      .set(adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.ledgerEntries.some((entry: any) => entry.entryType === "funding" && entry.amount === payoutRow.expectedAmount)).toBe(true);
    expect(detail.body.ledgerEntries.some((entry: any) => entry.entryType === "release" && entry.amount === payoutRow.sellerNetAmount)).toBe(true);
    expect(detail.body.ledgerEntries.some((entry: any) => entry.entryType === "fee" && entry.amount === payoutRow.platformFeeAmount)).toBe(true);

    const csv = await request(app)
      .get("/admin/reconciliation.csv?limit=250")
      .set(adminHeaders);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("seller net payout");
    expect(csv.text).toContain("payout account");
    expect(csv.text).toContain("resolved account name");
    expect(csv.text).toContain("compliance risk score");
    expect(csv.text).toContain("reconciliation risk level");
    expect(csv.text).toContain("TEST-paystack-transfer-ref-001");
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
