import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { EscrowStore } from "../src/services/escrowStore";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-escrow-store.db");
let store: EscrowStore | null = null;

function freshStore() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  store = new EscrowStore(TEST_DB_PATH, "sqlite");
  return store;
}

describe("EscrowStore", () => {
  afterEach(async () => {
    await store?.close();
    store = null;
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("creates users, escrows, payout accounts, transactions, and events", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000001", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000002", "seller");
    const payout = await escrowStore.upsertPayoutAccount({
      userId: seller.userId,
      bankName: "Test Bank",
      bankCode: "999",
      accountNumber: "0123456789",
      accountName: "Seller User",
      verificationStatus: "verified",
    });

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 10000,
      currency: "NAIRA",
      purpose: "Logo design",
      createdByChannel: "whatsapp_dm",
    });
    expect(escrow.status).toBe("PENDING_ACCEPTANCE");
    const accepted = await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    expect(accepted.status).toBe("PENDING_PAYMENT");
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-ref-1",
      paymentAuthorizationUrl: "https://checkout.paystack.test/ref",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });

    const funded = await escrowStore.markFundedByPaymentReference("paystack-ref-1", { status: "success" });
    const pendingRelease = await escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const released = await escrowStore.approveManualRelease(escrow.escrowId, "admin", {
      manualPayoutReference: "manual-payout-1",
      payoutNotes: "Paid from Paystack dashboard",
    });
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);

    expect(payout.verificationStatus).toBe("verified");
    expect(funded?.status).toBe("IN_PROGRESS");
    expect(pendingRelease.status).toBe("PENDING_RELEASE");
    expect(released.status).toBe("RELEASED");
    expect(released.manualPayoutReference).toBe("manual-payout-1");
    expect(transactions.length).toBeGreaterThanOrEqual(2);
    expect(events.map((event) => event.eventType)).toContain("manual_release_approved");
  });

  it("auto-releases USDC escrows when release is requested", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000003", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000004", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 25,
      currency: "USDC",
      purpose: "Smart contract review",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: `x402-${escrow.escrowId}`,
      paymentProvider: "x402",
      status: "IN_PROGRESS",
    });

    const released = await escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    expect(released.status).toBe("RELEASED");
    expect(released.settlementPolicy).toBe("autonomous_usdc_release");
  });
});
