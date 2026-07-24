import path from "path";
import request from "supertest";
import { describe, it, expect } from "vitest";

process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = `./data/test-usdc-pay-${Date.now()}.db`;
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NODE_ENV = "test";
process.env.SYNAPSE_X402_FACILITATOR_URL = "";

const { paymentRouter } = await import("../src/context");

// Mock paymentRouter methods BEFORE importing server app
paymentRouter.processUsdcEscrow = async (amount: number) => ({
  method: "USDC",
  status: "pending",
  reference: `x402-ref-${Date.now()}`,
  paymentId: `x402-pid-${Date.now()}`,
  details: {
    depositAddress: "SolanaUsdcTestDepositAddress1111111111111111",
    network: "Solana Devnet",
  },
});

paymentRouter.getX402Client = () => ({
  getPaymentStatus: async () => ({ status: "pending" }),
  createPaymentFacility: async () => ({ status: "pending", paymentId: "mock-pid", facilitatorId: "mock-ref" }),
  settlePayment: async () => ({ status: "completed" }),
} as any);

const app = (await import("../src/server")).default;

describe("USDC Payment Instruction Endpoint", () => {
  it("should successfully generate and retrieve payment instructions for an accepted USDC escrow without Naira restriction error", async () => {
    const buyerWhatsapp = "whatsapp:+2348011112222";
    const sellerWhatsapp = "whatsapp:+2348033334444";

    // 1. Create a 50 USDC escrow
    const createRes = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `req-usdc-pay-${Date.now()}`,
        buyerWhatsapp,
        sellerWhatsapp,
        amount: 50,
        currency: "USDC",
        purpose: "Product scope data",
      });

    expect(createRes.status).toBe(201);
    const escrowId = createRes.body.escrow.escrowId;

    // 2. Seller accepts the USDC escrow -> transitions status to PENDING_PAYMENT
    const acceptRes = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: sellerWhatsapp,
      });

    expect(acceptRes.status).toBe(200);

    // 3. Request payment instruction for the accepted USDC escrow as buyer
    const payRes = await request(app)
      .post(`/api/escrows/${escrowId}/payment-instruction`)
      .set("x-core-api-key", "test-core-secret")
      .send({
        actorWhatsapp: buyerWhatsapp,
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.payment).toBeDefined();
    expect(payRes.body.payment.provider).toBeDefined();
    expect(payRes.body.payment.reference).toBeDefined();
    expect(payRes.body.payment.depositAddress).toBeDefined();
    expect(payRes.body.payment.network).toBeDefined();
    expect(payRes.body.payment.escrowAmount).toBe(50);
  });
});
