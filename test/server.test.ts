import request from "supertest";
import { describe, it, expect } from "vitest";

process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = process.env.DATABASE_URL || "./data/test-server.db";
process.env.NOTIFICATION_URL = "";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.PAYSTACK_SECRET_KEY = "sk_test_server";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890";

// Import app after test environment overrides are set.
const app = (await import("../src/server")).default;

describe("server basic endpoints", () => {
  it("returns health ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns readiness ok", async () => {
    const res = await request(app).get("/health/readiness");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.database).toMatchObject({
      status: "ok",
      configured: true,
    });
  });

  it("saves and returns a user profile by WhatsApp number", async () => {
    const whatsappNumber = "whatsapp:+2348000000101";
    const save = await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber, firstName: "Ada", lastName: "Okoro" });

    expect(save.status).toBe(200);
    expect(save.body.firstName).toBe("Ada");

    const lookup = await request(app)
      .get("/api/users/profile")
      .query({ whatsappNumber })
      .set("x-core-api-key", "test-core-secret");

    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({
      whatsappNumber,
      firstName: "Ada",
      lastName: "Okoro",
    });
  });

  it("allows an explicitly allowlisted payout account in controlled test mode", async () => {
    const whatsappNumber = "whatsapp:+2348000000102";
    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber, firstName: "Test", lastName: "Seller" });

    const payout = await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber,
        bankName: "Opay",
        bankCode: "999992",
        accountNumber: "1234567890",
      });

    expect(payout.status).toBe(200);
    expect(payout.body).toMatchObject({
      accountNumber: "****7890",
      resolvedAccountName: "Test Seller",
      accountVerificationProvider: "sandbox_test_override",
      verificationStatus: "verified",
    });
  });

  it("authorizes participant deal detail and returns participant-filtered My Deals actions", async () => {
    const suffix = Date.now().toString().slice(-7);
    const buyerWhatsapp = `whatsapp:+23480${suffix}01`;
    const sellerWhatsapp = `whatsapp:+23480${suffix}02`;
    const outsiderWhatsapp = `whatsapp:+23480${suffix}99`;
    const created = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `participant-deal-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        buyerWhatsapp,
        sellerWhatsapp,
        amount: 10000,
        currency: "NAIRA",
        purpose: "Participant-safe deal card",
        channel: "whatsapp_dm",
      });

    expect(created.status).toBe(201);
    const escrowId = created.body.escrow.escrowId;

    const missingActor = await request(app)
      .get(`/api/escrows/${escrowId}`)
      .set("x-core-api-key", "test-core-secret");
    expect(missingActor.status).toBe(400);

    const outsider = await request(app)
      .get(`/api/escrows/${escrowId}`)
      .query({ actorWhatsapp: outsiderWhatsapp })
      .set("x-core-api-key", "test-core-secret");
    expect(outsider.status).toBe(403);

    const buyerDetail = await request(app)
      .get(`/api/escrows/${escrowId}`)
      .query({ actorWhatsapp: buyerWhatsapp })
      .set("x-core-api-key", "test-core-secret");
    expect(buyerDetail.status).toBe(200);
    expect(buyerDetail.body.participant).toMatchObject({
      role: "buyer",
      displayStatus: "Waiting for seller",
    });
    expect(buyerDetail.body.participant.allowedActions).toEqual(expect.arrayContaining(["status", "reference", "cancel"]));
    expect(buyerDetail.body.participant.allowedActions).not.toContain("accept");
    expect(buyerDetail.body).not.toHaveProperty("transactions");
    expect(buyerDetail.body).not.toHaveProperty("events");
    expect(buyerDetail.body).not.toHaveProperty("ledgerEntries");
    expect(buyerDetail.body).not.toHaveProperty("complianceRisk");
    expect(buyerDetail.body).not.toHaveProperty("payout");
    expect(buyerDetail.body).not.toHaveProperty("buyer");
    expect(buyerDetail.body).not.toHaveProperty("seller");

    const sellerDeals = await request(app)
      .get("/api/users/escrows")
      .query({ actorWhatsapp: sellerWhatsapp })
      .set("x-core-api-key", "test-core-secret");
    expect(sellerDeals.status).toBe(200);
    expect(sellerDeals.body.deals).toHaveLength(1);
    expect(sellerDeals.body.deals[0].participant).toMatchObject({
      role: "seller",
      displayStatus: "Waiting for seller",
    });
    expect(sellerDeals.body.deals[0].participant.allowedActions).toEqual(expect.arrayContaining(["accept", "status", "reference"]));
    expect(sellerDeals.body.deals[0].participant.allowedActions).not.toContain("cancel");
  });
});
