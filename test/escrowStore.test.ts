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

    const funded = await escrowStore.markFundedByPaymentReference("paystack-ref-1", { status: "success", amount: 10000 });
    await expect(escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/IN_PROGRESS/);
    const completed = await escrowStore.completeEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const pendingRelease = await escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const released = await escrowStore.approveManualRelease(escrow.escrowId, "admin", {
      manualPayoutReference: "manual-payout-1",
      payoutNotes: "Paid from Paystack dashboard",
    });
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);

    expect(payout.verificationStatus).toBe("verified");
    expect(funded?.status).toBe("IN_PROGRESS");
    expect(funded?.receivedAmount).toBe(10000);
    expect(funded?.providerPaymentStatus).toBe("success");
    expect(completed.status).toBe("COMPLETED");
    expect(pendingRelease.status).toBe("PENDING_RELEASE");
    expect(released.status).toBe("RELEASED");
    expect(released.manualPayoutReference).toBe("manual-payout-1");
    expect(transactions.length).toBeGreaterThanOrEqual(2);
    expect(events.map((event) => event.eventType)).toContain("manual_release_approved");
  });

  it("auto-releases USDC escrows after buyer completion and release request", async () => {
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

    await expect(escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/IN_PROGRESS/);
    await escrowStore.completeEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const released = await escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    expect(released.status).toBe("RELEASED");
    expect(released.settlementPolicy).toBe("autonomous_usdc_release");
  });

  it("blocks non-buyers from completing or requesting release", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000007", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000008", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 25000,
      currency: "NAIRA",
      purpose: "Landing page build",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-ref-authz",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });
    await escrowStore.markFundedByPaymentReference("paystack-ref-authz", { status: "success", amount: 25000 });

    await expect(escrowStore.completeEscrow(escrow.escrowId, seller.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/Only the buyer/);
    await escrowStore.completeEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    await expect(escrowStore.requestRelease(escrow.escrowId, seller.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/Only the buyer/);
  });

  it("marks Paystack funding mismatches for review without activating the escrow", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000005", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000006", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 15000,
      currency: "NAIRA",
      purpose: "Video editing",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-mismatch-1",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });

    const reviewed = await escrowStore.markPaymentReviewRequired(escrow.escrowId, {
      receivedAmount: 10000,
      providerPaymentStatus: "success",
      flags: ["payment_amount_mismatch"],
      reason: "Expected 15000 NAIRA, received 10000 NGN",
      reference: "paystack-mismatch-1",
    });
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);

    expect(reviewed.status).toBe("REVIEW_REQUIRED");
    expect(reviewed.receivedAmount).toBe(10000);
    expect(reviewed.reconciliationFlags).toContain("payment_amount_mismatch");
    expect(events.map((event) => event.eventType)).toContain("payment_review_required");
    expect(transactions[0].status).toBe("review_required");
  });

  it("records manual dispute resolution outcomes", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000011", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000012", "seller");
    await escrowStore.upsertPayoutAccount({
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
      amount: 20000,
      currency: "NAIRA",
      purpose: "Disputed content delivery",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.markDisputed(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm", "Buyer says work was not delivered");
    const resolved = await escrowStore.resolveDispute(escrow.escrowId, "admin", {
      outcome: "release_to_seller",
      reason: "Evidence showed seller delivered the work",
      reference: "dispute-payout-1",
    });
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);

    expect(resolved.status).toBe("RELEASED");
    expect(resolved.manualPayoutReference).toBe("dispute-payout-1");
    expect(events.map((event) => event.eventType)).toContain("dispute_resolved");
    expect(transactions.map((transaction) => transaction.status)).toContain("manual_dispute_release");
  });
});
