import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-auto-release-e2e.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;
const { escrowStore, settingsStore } = await import("../src/context");
const { checkInspectionExpirations } = await import("../src/services/escrowService");

describe("Auto Release API End-to-End Test Flow", () => {
  beforeAll(async () => {
    await settingsStore.initializeSchema();
    await escrowStore.initializeSchema();
  });

  afterAll(async () => {
    await escrowStore.close();
    await settingsStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // Handle locks gracefully
      }
    }
  });

  it("handles auto-release toggles dynamically through the admin settings endpoint and transitions accordingly", async () => {
    // 1. Setup buyer & seller profiles
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348300000001", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348300000002", "seller");

    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "David", lastName: "Seller" });

    await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "Access Bank",
        bankCode: "044",
        accountNumber: "1234567890",
      });

    // 2. Create Escrow
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-timer-toggle-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 30000,
        currency: "NAIRA",
        purpose: "Development of web widget",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    // 3. Accept Escrow
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);
    const paymentRef = acceptRes.body.payment.reference;

    // 4. Fund Escrow
    await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 30000,
      processorFee: 425,
    });

    // 5. Submit Work Delivery (Seller submits work proof)
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Widget build delivery link and zip code",
        media: [],
        notifyBuyer: false,
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");
    expect(deliveryProofRes.body.escrow.inspectionExpiresAt).toBeDefined();

    // 6. Test: Auto-Release Disabled by Admin Settings API
    const settingsBefore = await settingsStore.getSettings();
    const updateSettingsRes1 = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send({
        nairaFeePercent: settingsBefore.nairaFeePercent,
        nairaFeeFixed: settingsBefore.nairaFeeFixed,
        usdcFeePercent: settingsBefore.usdcFeePercent,
        usdcFeeFixed: settingsBefore.usdcFeeFixed,
        autoReleaseEnabled: false,
        deliveryInspectionWindowDays: 3,
        expectedVersion: settingsBefore.version,
      });

    expect(updateSettingsRes1.status).toBe(200);
    expect(updateSettingsRes1.body.autoReleaseEnabled).toBe(false);

    // Manually backdate the inspection timer in the DB to make it expired
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    await escrowStore.runTransaction(async () => {
      await escrowStore.sqlite!.prepare(
        "UPDATE escrows SET inspection_expires_at = ? WHERE escrow_id = ?"
      ).run(expiredTime, escrowId);
    });

    // Run sweeper check
    const transitionedDisabled = await checkInspectionExpirations();
    expect(transitionedDisabled).toBe(0); // Sweep bypassed because toggle is disabled

    const escrowStatusDisabled = await escrowStore.getEscrowById(escrowId);
    expect(escrowStatusDisabled?.status).toBe("DELIVERED"); // Status stays DELIVERED

    // 7. Test: Auto-Release Enabled by Admin Settings API
    const settingsAfter = await settingsStore.getSettings();
    const updateSettingsRes2 = await request(app)
      .post("/admin/settings")
      .set("x-admin-key", "test-admin-key")
      .send({
        nairaFeePercent: settingsAfter.nairaFeePercent,
        nairaFeeFixed: settingsAfter.nairaFeeFixed,
        usdcFeePercent: settingsAfter.usdcFeePercent,
        usdcFeeFixed: settingsAfter.usdcFeeFixed,
        autoReleaseEnabled: true,
        deliveryInspectionWindowDays: 3,
        expectedVersion: settingsAfter.version,
      });

    expect(updateSettingsRes2.status).toBe(200);
    expect(updateSettingsRes2.body.autoReleaseEnabled).toBe(true);

    // Run sweeper check again
    const transitionedEnabled = await checkInspectionExpirations();
    expect(transitionedEnabled).toBe(1); // 1 escrow successfully auto-completed

    const escrowStatusEnabled = await escrowStore.getEscrowById(escrowId);
    expect(escrowStatusEnabled?.status).toBe("PENDING_RELEASE"); // Status transitioned successfully to PENDING_RELEASE
  });
});
