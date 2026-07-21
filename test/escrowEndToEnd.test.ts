import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, `../data/test-escrow-e2e-${Date.now()}-${Math.random().toString(36).substring(7)}.db`);
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890";


const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");

describe("Escrow End-to-End Lifecycle & Release Paths", () => {
  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // Handle SQLite file locks gracefully
      }
    }
  });

  it("handles the complete Naira lifecycle: Create -> Accept -> Fund -> Delivery -> Complete -> Release Request -> Admin Approve Payout", async () => {
    // 1. Setup buyer and seller users
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000010", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000011", "seller");

    // Complete seller profile & payout verification (required for Naira acceptance)
    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Alice", lastName: "Seller" });

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
        clientRequestId: `e2e-naira-create-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 15000,
        currency: "NAIRA",
        purpose: "Copywriting service contract",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;
    expect(createRes.body.escrow.status).toBe("PENDING_ACCEPTANCE");

    // 3. Accept Escrow
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.escrow.escrow.status).toBe("PENDING_PAYMENT");

    // 4. Fund Escrow
    const paymentRef = acceptRes.body.payment.reference;
    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 15000,
      processorFee: 425,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // 5. Submit Delivery Proof (Seller uploads work proof)
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Article draft document and reference links attached.",
        media: [],
        notifyBuyer: false,
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");
    expect(deliveryProofRes.body.escrow.deliveredAt).toBeDefined();

    // 6. Complete Escrow (Buyer approves delivery)
    const completeRes = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");

    // 7. Request Release (Buyer requests payment release to seller)
    const releaseRequestRes = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(releaseRequestRes.status).toBe(200);
    expect(releaseRequestRes.body.status).toBe("PENDING_RELEASE");

    // 8. Admin Payout Approval (Admin processes manual payout)
    const approveReleaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set("x-admin-key", "test-admin-key")
      .send({
        manualPayoutReference: "paystack-trn-998877",
        payoutNotes: "E2E manual payout release approved",
      });

    expect(approveReleaseRes.status).toBe(200);
    expect(approveReleaseRes.body.escrow.status).toBe("RELEASED");
    expect(approveReleaseRes.body.escrow.manualPayoutReference).toContain("TEST-NOMBA-");
  }, 30000);

  it("handles the complete USDC lifecycle: Create -> Accept -> Fund -> Delivery -> Complete -> Autonomous Release", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000012", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000013", "seller");

    // 1. Create USDC Escrow
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-usdc-create-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 80,
        currency: "USDC",
        purpose: "Smart contract translation",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    // 2. Accept Escrow
    await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    // 3. Fund Escrow (For USDC, we simulate funding by attaching the payment status as IN_PROGRESS)
    await escrowStore.attachPayment({
      escrowId,
      paymentReference: `x402-${escrowId}`,
      paymentProvider: "x402",
      status: "IN_PROGRESS",
    });

    const funded = await escrowStore.getEscrowById(escrowId);
    expect(funded?.status).toBe("IN_PROGRESS");

    // 4. Submit Delivery Proof
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Smart contract translation file uploaded.",
        media: [],
        notifyBuyer: false,
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");

    // 5. Complete Escrow
    const completeRes = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");

    // 6. Request Release (USDC should release autonomously and move immediately to RELEASED)
    const releaseRes = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.status).toBe("RELEASED");
    expect(releaseRes.body.settlementPolicy).toBe("autonomous_usdc_release");
  }, 30000);
});
