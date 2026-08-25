import fs from "fs";
import path from "path";
import crypto from "crypto";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(
  __dirname,
  `../data/test-paystack-e2e-${Date.now()}-${Math.random().toString(36).substring(7)}.db`
);
const PAYSTACK_SECRET = "sk_test_paystack_e2e_key";
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";
process.env.NODE_ENV = "test";
process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;
process.env.PAYSTACK_TRANSFER_ENABLED = "true";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "0123456789,1122334455,1234567890";

const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");
const { config } = await import("../src/config");

function signPaystackWebhook(payload: Record<string, unknown>): string {
  return crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}

describe("Paystack Automated Payout End-to-End Test Suite", () => {
  const adminHeaders = { "x-admin-key": "test-admin-key" };
  const coreHeaders = { "x-core-api-key": "test-core-secret" };

  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // SQLite file cleanup
      }
    }
  });

  it("completes the full end-to-end lifecycle: Paystack Pay-In -> Seller Payout via Paystack Transfer -> Webhook Confirmation", async () => {
    config.paystack.transferEnabled = true;

    const buyerPhone = "whatsapp:+2348011112222";
    const sellerPhone = "whatsapp:+2348033334444";

    const buyer = await escrowStore.upsertUserByWhatsapp(buyerPhone, "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp(sellerPhone, "seller");

    // 1. Setup seller profile & payout bank account
    await request(app)
      .post("/api/users/profile")
      .set(coreHeaders)
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Sivan", lastName: "Seller" });

    await request(app)
      .post("/api/users/payout-account")
      .set(coreHeaders)
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "Guaranty Trust Bank",
        bankCode: "058",
        accountNumber: "0123456789",
      });

    // 2. Create Service Agreement
    const createRes = await request(app)
      .post("/api/escrows")
      .set(coreHeaders)
      .send({
        clientRequestId: `e2e-paystack-create-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 50000,
        currency: "NAIRA",
        purpose: "Full-stack web application development",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;
    expect(escrowId).toBeDefined();

    // 3. Seller accepts the service agreement
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set(coreHeaders)
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);

    // 4. Mark funded via Paystack
    const paymentRef = acceptRes.body.payment.reference;
    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 50000,
      processorFee: 750,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // 5. Seller submits delivery proof
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set(coreHeaders)
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Web application deployed to production servers",
        media: [],
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");

    // 6. Buyer completes agreement
    const completeRes = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(completeRes.status).toBe(200);

    // 7. Request Release
    const releaseRequestRes = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(releaseRequestRes.status).toBe(200);

    // 8. Admin approves release with automated Paystack payout transfer
    const releaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set(adminHeaders)
      .send({
        payoutNotes: "Automated Paystack disbursement for delivered web development",
      });

    // Payout initiated asynchronously via Paystack Transfer API
    expect(releaseRes.status).toBe(202);
    expect(releaseRes.body.payout).toBeDefined();
    expect(releaseRes.body.payout.provider).toBe("paystack");
    expect(releaseRes.body.payout.status).toBe("pending");
    expect(releaseRes.body.payout.reference).toContain(`SIVAN-release-${escrowId}`);

    const transferRef = releaseRes.body.payout.reference;
    const transferCode = releaseRes.body.payout.transferCode;

    // 9. Verify transaction record exists in database
    const recordedTx = await escrowStore.getTransactionByProviderReference("paystack", transferRef);
    expect(recordedTx).toBeDefined();
    expect(recordedTx?.transactionType).toBe("release");
    expect(recordedTx?.provider).toBe("paystack");

    // 10. Paystack transfer.success webhook arrives
    const transferSuccessWebhook = {
      event: "transfer.success",
      id: 998878,
      data: {
        reference: transferRef,
        transfer_code: transferCode,
        amount: 4905000,
        currency: "NGN",
        status: "success",
      },
    };

    const transferWebhookRes = await request(app)
      .post("/webhooks/paystack")
      .set("x-paystack-signature", signPaystackWebhook(transferSuccessWebhook))
      .send(transferSuccessWebhook);

    expect(transferWebhookRes.status).toBe(200);

    // Verify webhook event recorded in agreement audit events
    const events = await escrowStore.listEvents(escrowId);
    const payoutEvent = events.find(e => e.eventType === "payout_provider_event_received");
    expect(payoutEvent).toBeDefined();
    expect(payoutEvent?.reason).toBe("transfer.success");
  });

  it("handles transfer.failed webhook by recording event", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348011110000", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348077778888", "seller");

    const createRes = await request(app)
      .post("/api/escrows")
      .set(coreHeaders)
      .send({
        clientRequestId: `e2e-paystack-fail-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 10000,
        currency: "NAIRA",
        purpose: "Design Service",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    const failedRef = `SIVAN-release-${escrowId}`;

    await escrowStore.addTransaction({
      escrowId,
      provider: "paystack",
      transactionType: "release",
      status: "payout_pending",
      amount: 10000,
      currency: "NAIRA",
      reference: failedRef,
    });

    const failedWebhook = {
      event: "transfer.failed",
      id: 998879,
      data: {
        reference: failedRef,
        transfer_code: "TRF_FAILED_123",
        amount: 1000000,
        currency: "NGN",
        status: "failed",
      },
    };

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("x-paystack-signature", signPaystackWebhook(failedWebhook))
      .send(failedWebhook);

    expect(res.status).toBe(200);

    // Verify event was recorded
    const events = await escrowStore.listEvents(escrowId);
    const failEvent = events.find(e => e.reason === "transfer.failed");
    expect(failEvent).toBeDefined();
  });

  it("supports dynamic Admin Payout Provider override: switches from Nomba pay-in to Paystack payout", async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348011119999", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348055556666", "seller");

    await request(app)
      .post("/api/users/profile")
      .set(coreHeaders)
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Override", lastName: "Seller" });

    await request(app)
      .post("/api/users/payout-account")
      .set(coreHeaders)
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "United Bank for Africa",
        bankCode: "033",
        accountNumber: "1122334455",
      });

    const createRes = await request(app)
      .post("/api/escrows")
      .set(coreHeaders)
      .send({
        clientRequestId: `e2e-override-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 30000,
        currency: "NAIRA",
        purpose: "Custom Illustration",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set(coreHeaders)
      .send({ actorWhatsapp: seller.whatsappNumber });

    // Mark funded with Nomba as pay-in provider
    const paymentRef = acceptRes.body.payment.reference;
    await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 30000,
      processorFee: 450,
    });

    // Deliver
    await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set(coreHeaders)
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Illustrations completed",
        media: [],
      });

    // Complete
    await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Request release
    await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    // Admin explicitly overrides payout provider to Paystack
    const releaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set(adminHeaders)
      .send({
        payoutProvider: "paystack",
        payoutNotes: "Admin switching payout provider to Paystack for faster settlement",
      });

    expect(releaseRes.status).toBe(202);
    expect(releaseRes.body.payout.provider).toBe("paystack");
    expect(releaseRes.body.payout.status).toBe("pending");
  });
});
