import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-delivery-timer.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.NOTIFICATION_URL = "";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");
const { runPaymentLifecycleSweep } = await import("../src/services/escrowService");

describe("Escrow Delivery Timer & Auto-Release Integration", () => {
  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // SQLite might still hold file handle
      }
    }
  });

  it("handles delivery submission, transitions to DELIVERED, and triggers auto-release after expiration", async () => {
    // 1. Create users
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000005", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000006", "seller");

    // Create an escrow via API
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `delivery-test-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 20000,
        currency: "NAIRA",
        purpose: "Mobile App Development",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;
    expect(createRes.body.escrow.status).toBe("PENDING_ACCEPTANCE");

    // Set up seller profile & verified payout account for Naira escrow acceptance
    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Test", lastName: "Seller" });

    await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "Opay",
        bankCode: "999992",
        accountNumber: "1234567890",
      });

    // 2. Accept the escrow by seller
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.escrow.escrow.status).toBe("PENDING_PAYMENT");

    // 3. Attach payment and fund
    await escrowStore.attachPayment({
      escrowId,
      paymentReference: `ref-${escrowId}`,
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });

    const funded = await escrowStore.markFundedByPaymentReference(`ref-${escrowId}`, {
      status: "success",
      amount: 20000,
      processorFee: 200,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // 4. Submit delivery proof
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Here is the completed mobile application source code.",
        media: [],
        notifyBuyer: false,
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");
    expect(deliveryProofRes.body.escrow.deliveredAt).toBeDefined();
    expect(deliveryProofRes.body.escrow.inspectionExpiresAt).toBeDefined();

    // 5. Run sweep before expiry -> should NOT complete/release
    const firstSweep = await runPaymentLifecycleSweep();
    expect(firstSweep.autoCompleted).toBe(0);

    const checkedEscrow = await escrowStore.getEscrowById(escrowId);
    expect(checkedEscrow?.status).toBe("DELIVERED");

    // 6. Simulate expiration by updating inspectionExpiresAt in DB
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hour ago
    (escrowStore as any).sqlite.prepare(
      "UPDATE escrows SET inspection_expires_at = ? WHERE escrow_id = ?"
    ).run(pastDate, escrowId);

    // 7. Run sweep after expiry -> should auto-complete and request release
    // Since currency is NAIRA (non-USDC), requestRelease should transition to PENDING_RELEASE for manual approval
    const secondSweep = await runPaymentLifecycleSweep();
    expect(secondSweep.autoCompleted).toBe(1);

    const finalEscrow = await escrowStore.getEscrowById(escrowId);
    expect(finalEscrow?.status).toBe("PENDING_RELEASE");
  }, 30000);

  it("handles auto-completion and auto-release for USDC escrows immediately to RELEASED", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000007", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000008", "seller");

    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `usdc-delivery-test-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 50,
        currency: "USDC",
        purpose: "Smart Contract Audit",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    await escrowStore.attachPayment({
      escrowId,
      paymentReference: `x402-${escrowId}`,
      paymentProvider: "x402",
      status: "IN_PROGRESS",
    });

    const funded = await escrowStore.getEscrowById(escrowId);
    expect(funded?.status).toBe("IN_PROGRESS");

    // Submit delivery proof
    await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Audit completed successfully.",
        media: [],
        notifyBuyer: false,
      });

    // Make it expired
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    (escrowStore as any).sqlite.prepare(
      "UPDATE escrows SET inspection_expires_at = ? WHERE escrow_id = ?"
    ).run(pastDate, escrowId);

    // Run sweep -> should transition to RELEASED directly
    const sweep = await runPaymentLifecycleSweep();
    expect(sweep.autoCompleted).toBe(1);

    const finalEscrow = await escrowStore.getEscrowById(escrowId);
    expect(finalEscrow?.status).toBe("RELEASED");
    expect(finalEscrow?.settlementPolicy).toBe("autonomous_usdc_release");
  }, 30000);
});
