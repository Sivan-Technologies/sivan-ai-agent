import fs from "fs";
import path from "path";
import crypto from "crypto";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(
  __dirname,
  `../data/test-paystack-funding-e2e-${Date.now()}-${Math.random().toString(36).substring(7)}.db`
);
const PAYSTACK_SECRET = "sk_test_paystack_e2e_secret_key";
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

describe("Paystack Pay-In Funding & Paystack Automated Transfer Payout End-to-End Test", () => {
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

  it("executes complete lifecycle: Paystack Checkout Funding Webhook -> Delivery -> Completion -> Automated Paystack Payout Transfer -> Transfer Webhook", async () => {
    config.paystack.transferEnabled = true;

    const buyerPhone = "whatsapp:+2348012345678";
    const sellerPhone = "whatsapp:+2348087654321";

    const buyer = await escrowStore.upsertUserByWhatsapp(buyerPhone, "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp(sellerPhone, "seller");

    // 1. Seller registers profile and NUBAN bank details
    await request(app)
      .post("/api/users/profile")
      .set(coreHeaders)
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Paystack", lastName: "Merchant" });

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
    const agreementAmount = 75000;
    const createRes = await request(app)
      .post("/api/escrows")
      .set(coreHeaders)
      .send({
        clientRequestId: `e2e-paystack-funding-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: agreementAmount,
        currency: "NAIRA",
        purpose: "Full stack engineering & security audit",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;
    expect(escrowId).toBeDefined();
    expect(createRes.body.escrow.status).toBe("PENDING_ACCEPTANCE");

    // 3. Seller accepts the agreement
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set(coreHeaders)
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);

    // 4. Buyer requests Paystack payment instruction
    const payInstructionRes = await request(app)
      .post(`/api/escrows/${escrowId}/payment-instruction`)
      .set(coreHeaders)
      .send({
        actorWhatsapp: buyer.whatsappNumber,
        preferredProvider: "paystack",
      });

    expect(payInstructionRes.status).toBe(200);
    const fundingRef = payInstructionRes.body.paymentReference || acceptRes.body.payment.reference;
    expect(fundingRef).toBeDefined();

    // 5. Paystack delivers charge.success webhook for funding
    const expectedNaira = Number(payInstructionRes.body.totalPayable || payInstructionRes.body.expectedAmount || 76925);
    const totalExpectedKobo = Math.round(expectedNaira * 100);
    const paystackChargePayload = {
      event: "charge.success",
      id: 1002003,
      data: {
        reference: fundingRef,
        status: "success",
        amount: totalExpectedKobo,
        currency: "NGN",
        paid_at: new Date().toISOString(),
        channel: "bank_transfer",
      },
    };

    const webhookFundingRes = await request(app)
      .post("/webhooks/paystack")
      .set("x-paystack-signature", signPaystackWebhook(paystackChargePayload))
      .send(paystackChargePayload);

    expect(webhookFundingRes.status).toBe(200);

    // Verify agreement is now funded (IN_PROGRESS) with Paystack as the recorded payment provider
    const fundedEscrow = await escrowStore.getEscrowById(escrowId);
    expect(fundedEscrow?.status).toBe("IN_PROGRESS");
    expect(fundedEscrow?.paymentProvider).toContain("paystack");

    // 6. Seller submits delivery proof
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set(coreHeaders)
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Audit report and deployed contracts delivered",
        media: [],
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");

    // 7. Buyer confirms completion
    const completeRes = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(completeRes.status).toBe(200);

    // 8. Buyer requests release
    const releaseRequestRes = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set(coreHeaders)
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(releaseRequestRes.status).toBe(200);
    expect(releaseRequestRes.body.status).toBe("PENDING_RELEASE");

    // 9. Admin approves release -> triggers automated Paystack payout transfer
    const approveReleaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set(adminHeaders)
      .send({
        payoutNotes: "Automated Paystack transfer disbursement after successful delivery",
      });

    expect(approveReleaseRes.status).toBe(202);
    expect(approveReleaseRes.body.payout).toBeDefined();
    expect(approveReleaseRes.body.payout.provider).toBe("paystack");
    expect(approveReleaseRes.body.payout.status).toBe("pending");
    expect(approveReleaseRes.body.payout.reference).toContain(`SIVAN-release-${escrowId}`);

    const transferRef = approveReleaseRes.body.payout.reference;
    const transferCode = approveReleaseRes.body.payout.transferCode;

    // Verify release transaction is stored
    const releaseTx = await escrowStore.getTransactionByProviderReference("paystack", transferRef);
    expect(releaseTx).toBeDefined();
    expect(releaseTx?.transactionType).toBe("release");
    expect(releaseTx?.provider).toBe("paystack");
    expect(releaseTx?.status).toBe("payout_pending");

    // 10. Paystack delivers transfer.success webhook
    const transferSuccessPayload = {
      event: "transfer.success",
      id: 1002004,
      data: {
        reference: transferRef,
        transfer_code: transferCode,
        amount: Math.round(73575 * 100), // Net payout in kobo
        currency: "NGN",
        status: "success",
      },
    };

    const webhookTransferRes = await request(app)
      .post("/webhooks/paystack")
      .set("x-paystack-signature", signPaystackWebhook(transferSuccessPayload))
      .send(transferSuccessPayload);

    expect(webhookTransferRes.status).toBe(200);

    // 11. Verify payout event in audit log
    const auditEvents = await escrowStore.listEvents(escrowId);
    const payoutCompletedEvent = auditEvents.find(
      (e) => e.eventType === "payout_provider_event_received" && e.reason === "transfer.success"
    );
    expect(payoutCompletedEvent).toBeDefined();
  });
});
