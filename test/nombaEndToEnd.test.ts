import fs from "fs";
import path from "path";
import request from "supertest";
import crypto from "crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-nomba-e2e.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";
process.env.ACTIVE_PAYMENT_PROVIDER = "nomba";
process.env.NOMBA_TEST_CLIENT_ID = "test-nomba-client-id";
process.env.NOMBA_TEST_CLIENT_SECRET = "test-nomba-client-secret";
process.env.NOMBA_TEST_ACCOUNT_ID = "test-nomba-account-id";
process.env.NOMBA_WEBHOOK_SECRET = "test-nomba-webhook-secret";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "*";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");

describe("Nomba Pay-in & Payout E2E Lifecycle", () => {
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

  it("handles the complete Nomba Naira lifecycle: Create -> Accept -> Signed Webhook Reconcile -> Delivery -> Complete -> Release Request -> Admin Approve Payout", async () => {
    // 1. Setup buyer and seller users
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000020", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000021", "seller");

    // Complete seller profile & payout verification
    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: seller.whatsappNumber, firstName: "Bob", lastName: "Nomba" });

    await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: seller.whatsappNumber,
        bankName: "Opay",
        bankCode: "999992",
        accountNumber: "8102524846",
      });

    // 2. Create Escrow
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-nomba-create-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 20000,
        currency: "NAIRA",
        purpose: "Web design service contract",
        channel: "whatsapp_dm",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;
    expect(createRes.body.escrow.status).toBe("PENDING_ACCEPTANCE");

    // 3. Accept Escrow (Generates virtual account checkout reference)
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: seller.whatsappNumber });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.escrow.escrow.status).toBe("PENDING_PAYMENT");
    expect(acceptRes.body.escrow.escrow.paymentProvider).toBe("nomba_sandbox_override");

    const paymentReference = acceptRes.body.payment.reference;
    expect(paymentReference).toContain("sandbox-nomba-SIV-");

    const escrowRecord = await escrowStore.getEscrowById(escrowId);
    if (!escrowRecord) throw new Error("Escrow record not found");
    const { expectedFundingAmount } = await import("../src/services/escrowService");
    const expectedAmount = await expectedFundingAmount(escrowRecord);

    // 4. Fund Escrow via Signed Webhook Callback
    // We mock NombaPayoutClient's requeryTransfer (used in verifyPayment)
    const { nombaPaymentProvider } = await import("../src/context");
    const requerySpy = vi.spyOn((nombaPaymentProvider as any).client, "requeryTransfer").mockResolvedValue({
      merchantTxRef: paymentReference,
      transactionId: "TX-NOMBA-E2E-1",
      status: "succeeded",
      amount: expectedAmount, // expected amount including fee
      currency: "NAIRA",
      fee: 100,
      raw: {},
    });

    const payload = {
      event_type: "payment_success",
      requestId: `req-${Date.now()}`,
      data: {
        transaction: {
          merchantTxRef: paymentReference,
          amount: String(expectedAmount),
          status: "succeeded",
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", "test-nomba-webhook-secret")
      .update(rawBody, "utf8")
      .digest("base64");

    const webhookRes = await request(app)
      .post("/webhooks/nomba")
      .set("nomba-signature", signature)
      .send(payload);

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body).toMatchObject({ status: "received" });

    // Verify database escrow status progressed to IN_PROGRESS
    const escrowAfterWebhook = await escrowStore.getEscrowById(escrowId);
    expect(escrowAfterWebhook?.status).toBe("IN_PROGRESS");
    expect(requerySpy).not.toHaveBeenCalled();

    // 5. Submit Delivery Proof
    const deliveryProofRes = await request(app)
      .post(`/api/escrows/${escrowId}/delivery/proof`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: seller.whatsappNumber,
        summary: "Website code repository links submitted.",
        media: [],
        notifyBuyer: false,
      });

    expect(deliveryProofRes.status).toBe(201);
    expect(deliveryProofRes.body.escrow.status).toBe("DELIVERED");

    // 6. Complete Escrow
    const completeRes = await request(app)
      .post(`/api/escrows/${escrowId}/complete`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");

    // 7. Request Release
    const releaseRequestRes = await request(app)
      .post(`/api/escrows/${escrowId}/release-request`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: buyer.whatsappNumber });

    expect(releaseRequestRes.status).toBe(200);
    expect(releaseRequestRes.body.status).toBe("PENDING_RELEASE");

    // 8. Admin Approve Release (triggers automated Nomba payout)
    const approveReleaseRes = await request(app)
      .post(`/admin/escrows/${escrowId}/approve-release`)
      .set("x-admin-key", "test-admin-key")
      .send({
        payoutNotes: "E2E automated release approved for Nomba provider",
      });

    expect(approveReleaseRes.status).toBe(200);
    expect(approveReleaseRes.body.escrow.status).toBe("RELEASED");
    expect(approveReleaseRes.body.escrow.manualPayoutReference).toContain("TEST-NOMBA-");
  }, 30000);
});
