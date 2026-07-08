import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-refund-e2e.db");
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
const { escrowStore } = await import("../src/context");

describe("Escrow Refund & Dispute E2E Flow", () => {
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

  it("handles a funded Naira escrow dispute and processes a manual refund successfully", async () => {
    // 1. Setup buyer and seller users
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000020", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000021", "seller");

    // Complete seller profile & payout verification
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
        accountNumber: "1234567890",
      });

    // 2. Create Escrow
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `e2e-refund-create-${Date.now()}`,
        buyerWhatsapp: buyer.whatsappNumber,
        sellerWhatsapp: seller.whatsappNumber,
        amount: 10000,
        currency: "NAIRA",
        purpose: "UI design deliverables",
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

    // 4. Fund Escrow (simulating exact matching payment amount)
    const paymentRef = acceptRes.body.payment.reference;
    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      status: "success",
      amount: 10000,
      processorFee: 200,
    });
    expect(funded?.status).toBe("IN_PROGRESS");

    // 5. Open Dispute (Admin places escrow in dispute state)
    const disputeRes = await request(app)
      .post(`/admin/escrows/${escrowId}/dispute`)
      .set("x-admin-key", "test-admin-key")
      .send({ reason: "Buyer claims seller has delivered nothing after 3 days" });

    expect(disputeRes.status).toBe(200);
    expect(disputeRes.body.status).toBe("DISPUTED");

    // 6. Resolve Dispute with "refund_buyer" outcome
    const resolveRes = await request(app)
      .post(`/admin/escrows/${escrowId}/dispute/resolve`)
      .set("x-admin-key", "test-admin-key")
      .send({
        outcome: "refund_buyer",
        reason: "Dispute settled. Refunding buyer since seller agreed.",
        reference: "ref-manual-refund-9988",
        notifyParticipants: false,
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.escrow.status).toBe("CANCELLED");

    // 7. Verify the transaction entries inside the DB store
    const transactions = await escrowStore.listTransactions(escrowId);
    const refundTx = transactions.find((tx) => tx.transactionType === "refund");
    
    expect(refundTx).toBeDefined();
    expect(refundTx?.status).toBe("manual_refund_recorded");
    expect(refundTx?.amount).toBe(10000);
    expect(refundTx?.reference).toBe("ref-manual-refund-9988");
  }, 30000);
});
