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
});
