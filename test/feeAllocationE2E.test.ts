import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { settingsStore } from "../src/context";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-fee-e2e.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890,1234567891";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");

describe("Fee Allocation End-to-End Test Flow", () => {
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

  it("handles the complete Seller Pays Fee lifecycle correctly", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348100000001", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348100000002", "seller");

    // Complete Alice Seller profile & payout setup
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

    // Create escrow where seller pays the fee
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-fee-seller-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 20000,
        currency: "NAIRA",
        purpose: "Freelance UI design contract",
        channel: "whatsapp_dm",
        feePayer: "seller",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.escrow.feePayer).toBe("seller");

    const escrowId = createRes.body.escrow.escrowId;

    // Accept escrow
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);
    const paymentRef = acceptRes.body.payment.reference;

    // Verify lookup API returns correct total to pay for Seller Pays model
    const lookupRes = await request(app)
      .get(`/api/escrows/payment-ref/${paymentRef}`)
      .set("x-core-api-key", "test-core-secret");

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.feePayer).toBe("seller");
    // Since seller pays the fee, buyer's total to pay must be EXACTLY the base amount
    expect(lookupRes.body.totalWithFee).toBe(20000);

    // Fund the escrow
    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 20000,
      processorFee: 425,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // Complete escrow
    await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Request release
    await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Approve release as admin & check payout net matches seller deduction
    const approveReleaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set("x-admin-key", "test-admin-key")
      .send({
        manualPayoutReference: "paystack-trn-11111",
        payoutNotes: "Seller paid fee approval verification",
      });

    expect(approveReleaseRes.status).toBe(200);
    const { payoutQuote } = approveReleaseRes.body;
    
    // Fee = 2.5% of 20000 + 50 = 500 + 50 = 550 NGN
    expect(payoutQuote.platformFeeAmount).toBe(550);
    expect(payoutQuote.totalWithFee).toBe(20000);
    // Seller gets net: 20000 - 550 = 19,450 NGN
    expect(payoutQuote.sellerNetAmount).toBe(19450);
  });

  it("handles the complete Split Pays Fee lifecycle correctly", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348100000003", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348100000004", "seller");

    // Complete seller profile & payout setup
    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Bob", lastName: "Seller" });

    await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "Access Bank",
        bankCode: "044",
        accountNumber: "1234567891",
      });

    // Create escrow where split is chosen
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-fee-split-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 20000,
        currency: "NAIRA",
        purpose: "Logo design contract",
        channel: "whatsapp_dm",
        feePayer: "split",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.escrow.feePayer).toBe("split");

    const escrowId = createRes.body.escrow.escrowId;

    // Accept escrow
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);
    const paymentRef = acceptRes.body.payment.reference;

    // Lookup metadata
    const lookupRes = await request(app)
      .get(`/api/escrows/payment-ref/${paymentRef}`)
      .set("x-core-api-key", "test-core-secret");

    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.feePayer).toBe("split");
    
    // Fee = 2.5% of 20000 + 50 = 550 NGN
    // Buyer pays base + (550 / 2) = 20000 + 275 = 20,275 NGN
    expect(lookupRes.body.platformFeeAmount).toBe(550);
    expect(lookupRes.body.totalWithFee).toBe(20275);

    // Fund the escrow
    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 20275,
      processorFee: 425,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // Complete escrow
    await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Request release
    await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Approve release as admin & check payout net
    const approveReleaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set("x-admin-key", "test-admin-key")
      .send({
        manualPayoutReference: "paystack-trn-22222",
        payoutNotes: "Split paid fee approval verification",
      });

    expect(approveReleaseRes.status).toBe(200);
    const { payoutQuote } = approveReleaseRes.body;
    expect(payoutQuote.platformFeeAmount).toBe(550);
    expect(payoutQuote.totalWithFee).toBe(20275);
    // Seller gets net: 20000 - (550 - 275) = 19,725 NGN
    expect(payoutQuote.sellerNetAmount).toBe(19725);
  });
});
