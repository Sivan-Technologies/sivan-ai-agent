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
      resolvedAccountName: "Seller User",
      nameMatchScore: 100,
      nameMatchLevel: "strong",
      accountVerifiedAt: new Date().toISOString(),
      accountVerificationProvider: "paystack_account_resolution",
      verificationStatus: "verified",
    });

    const escrow = await escrowStore.createEscrow({
      clientRequestId: "whatsapp-request-0001",
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 10000,
      currency: "NAIRA",
      purpose: "Logo design",
      createdByChannel: "whatsapp_dm",
    });
    const idempotentLookup = await escrowStore.findEscrowByClientRequestId("whatsapp-request-0001");
    expect(escrow.status).toBe("PENDING_ACCEPTANCE");
    expect(idempotentLookup?.escrowId).toBe(escrow.escrowId);
    expect(idempotentLookup?.clientRequestId).toBe("whatsapp-request-0001");
    const accepted = await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    expect(accepted.status).toBe("PENDING_PAYMENT");
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-ref-1",
      paymentAuthorizationUrl: "https://checkout.paystack.test/ref",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });

    const funded = await escrowStore.markFundedByPaymentReference("paystack-ref-1", { status: "success", amount: 10000, processorFee: 150 });
    await expect(escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/IN_PROGRESS/);
    const completed = await escrowStore.completeEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const pendingRelease = await escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const released = await escrowStore.approveManualRelease(escrow.escrowId, "admin", {
      manualPayoutReference: "manual-payout-1",
      payoutNotes: "Paid from Paystack dashboard",
      grossAmount: 10000,
      platformFeeAmount: 300,
      sellerNetAmount: 10000,
    });
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const ledgerEntries = await escrowStore.listLedgerEntries(escrow.escrowId);
    const rawPayout = (escrowStore as any).sqlite.prepare(`SELECT account_number, account_number_encrypted, account_number_last4 FROM payout_accounts WHERE payout_account_id = ?`).get(payout.payoutAccountId);

    expect(payout.verificationStatus).toBe("verified");
    expect(payout.accountNumber).toBe("****6789");
    expect(payout.accountNumberLast4).toBe("6789");
    expect(payout.resolvedAccountName).toBe("Seller User");
    expect(payout.nameMatchLevel).toBe("strong");
    expect(payout.nameMatchScore).toBe(100);
    expect(rawPayout.account_number).toMatch(/^acct:/);
    expect(rawPayout.account_number).not.toContain("0123456789");
    expect(rawPayout.account_number_encrypted).toMatch(/^enc:v1:/);
    expect(rawPayout.account_number_encrypted).not.toContain("0123456789");
    expect(rawPayout.account_number_last4).toBe("6789");
    expect(funded?.status).toBe("IN_PROGRESS");
    expect(funded?.receivedAmount).toBe(10000);
    expect(funded?.providerPaymentStatus).toBe("success");
    expect(completed.status).toBe("COMPLETED");
    expect(pendingRelease.status).toBe("PENDING_RELEASE");
    expect(released.status).toBe("RELEASED");
    expect(released.manualPayoutReference).toBe("manual-payout-1");
    expect(transactions.length).toBeGreaterThanOrEqual(2);
    expect(transactions.find((transaction) => transaction.transactionType === "funding")?.processorFee).toBe(150);
    expect(transactions.find((transaction) => transaction.transactionType === "release")?.amount).toBe(10000);
    expect(ledgerEntries.map((entry) => entry.entryType)).toEqual(expect.arrayContaining(["funding", "release", "fee"]));
    expect(ledgerEntries.find((entry) => entry.entryType === "release")?.amount).toBe(10000);
    expect(ledgerEntries.find((entry) => entry.entryType === "fee")?.amount).toBe(300);
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

  it("expires stale provider payment instructions without closing the escrow", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000091", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000092", "seller");
    await escrowStore.updateUserProfile(buyer.userId, "Buyer", "One");
    await escrowStore.updateUserProfile(seller.userId, "Seller", "One");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 10000,
      currency: "NAIRA",
      purpose: "expired payment instruction",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "monnify-expired-ref-1",
      paymentProvider: "monnify",
      paymentMetadata: {
        paymentReference: "monnify-expired-ref-1",
        totalPayable: 10300,
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
      status: "PENDING_PAYMENT",
    });

    const expired = await escrowStore.expirePendingPaymentIfDue(escrow.escrowId, new Date("2026-01-01T00:01:00.000Z"));
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const events = await escrowStore.listEvents(escrow.escrowId);

    expect(expired?.status).toBe("PENDING_PAYMENT");
    expect(expired?.paymentReference).toBeUndefined();
    expect(transactions.find((transaction) => transaction.reference === "monnify-expired-ref-1")?.status).toBe("expired");
    expect(events.some((event) => event.eventType === "payment_expired")).toBe(true);
  });

  it("expires the escrow after the funding window closes", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000191", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000192", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 10000,
      currency: "NAIRA",
      purpose: "funding window expiry",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "monnify-funding-window-ref-1",
      paymentProvider: "monnify",
      paymentMetadata: {
        paymentReference: "monnify-funding-window-ref-1",
        totalPayable: 10300,
        expiresAt: "2026-01-02T00:00:00.000Z",
      },
      fundingExpiresAt: "2026-01-01T00:00:00.000Z",
      status: "PENDING_PAYMENT",
    });

    const expired = await escrowStore.expirePendingPaymentIfDue(escrow.escrowId, new Date("2026-01-01T00:01:00.000Z"));
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const events = await escrowStore.listEvents(escrow.escrowId);

    expect(expired?.status).toBe("EXPIRED");
    expect(transactions.find((transaction) => transaction.reference === "monnify-funding-window-ref-1")?.status).toBe("expired");
    expect(events.some((event) => event.eventType === "escrow_funding_expired")).toBe(true);
  });

  it("regenerates payment instructions with a new active reference and expired audit history", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000291", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000292", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 10000,
      currency: "NAIRA",
      purpose: "payment regeneration",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "monnify-old-ref-1",
      paymentProvider: "monnify",
      paymentMetadata: { paymentReference: "monnify-old-ref-1" },
      fundingExpiresAt: "2026-01-02T00:00:00.000Z",
      activePaymentExpiresAt: "2026-01-01T00:00:00.000Z",
      status: "PENDING_PAYMENT",
    });
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "monnify-new-ref-2",
      paymentProvider: "monnify",
      paymentMetadata: { paymentReference: "monnify-new-ref-2" },
      fundingExpiresAt: "2026-01-02T00:00:00.000Z",
      activePaymentExpiresAt: "2026-01-01T01:00:00.000Z",
      status: "PENDING_PAYMENT",
      regenerate: true,
    });

    const updated = await escrowStore.getEscrowById(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const events = await escrowStore.listEvents(escrow.escrowId);

    expect(updated?.paymentReference).toBe("monnify-new-ref-2");
    expect(updated?.paymentRegenerationCount).toBe(1);
    expect(transactions.find((transaction) => transaction.reference === "monnify-old-ref-1")?.status).toBe("expired");
    expect(transactions.find((transaction) => transaction.reference === "monnify-new-ref-2")?.status).toBe("pending");
    expect(events.some((event) => event.eventType === "payment_instruction_regenerated")).toBe(true);
  });

  it("does not double-fund or duplicate ledger entries when a provider webhook is replayed", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000201", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000202", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 18000,
      currency: "NAIRA",
      purpose: "PalmPay replay safety test",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "PPSIVREPLAYSAFE",
      paymentProvider: "palmpay",
      status: "PENDING_PAYMENT",
    });

    const first = await escrowStore.markFundedByPaymentReference("PPSIVREPLAYSAFE", {
      provider: "palmpay",
      status: "success",
      amount: 18000,
    });
    const second = await escrowStore.markFundedByPaymentReference("PPSIVREPLAYSAFE", {
      provider: "palmpay",
      status: "success",
      amount: 18000,
    });
    const ledgerEntries = await escrowStore.listLedgerEntries(escrow.escrowId);
    const fundingEntries = ledgerEntries.filter((entry) => entry.entryType === "funding");
    const transactions = await escrowStore.listTransactions(escrow.escrowId);
    const fundingTransactions = transactions.filter((transaction) => transaction.transactionType === "funding");

    expect(first?.status).toBe("IN_PROGRESS");
    expect(second?.status).toBe("IN_PROGRESS");
    expect(fundingEntries).toHaveLength(1);
    expect(fundingTransactions).toHaveLength(1);
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

  it("allows only the buyer to cancel an unfunded escrow", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000021", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000022", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 11000,
      currency: "NAIRA",
      purpose: "Cancelled design",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-cancel-1",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });

    await expect(escrowStore.cancelUnfundedEscrow(escrow.escrowId, seller.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/Only the buyer/);
    const cancelled = await escrowStore.cancelUnfundedEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");
    const events = await escrowStore.listEvents(escrow.escrowId);
    const transactions = await escrowStore.listTransactions(escrow.escrowId);

    expect(cancelled.status).toBe("CANCELLED");
    expect(events.map((event) => event.eventType)).toContain("buyer_cancelled_unfunded");
    expect(transactions[0].status).toBe("cancelled");
  });

  it("blocks cancellation after escrow funding", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000031", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000032", "seller");
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 11000,
      currency: "NAIRA",
      purpose: "Funded design",
      createdByChannel: "whatsapp_dm",
    });
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-cancel-funded-1",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });
    await escrowStore.markFundedByPaymentReference("paystack-cancel-funded-1", { status: "success", amount: 11000 });

    await expect(escrowStore.cancelUnfundedEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/cannot be cancelled|Funded escrow/i);
  });

  it("blocks Naira release when payout name match is not acceptable", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000010101", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000010102", "seller");
    await escrowStore.upsertPayoutAccount({
      userId: seller.userId,
      bankName: "Test Bank",
      bankCode: "999",
      accountNumber: "2222222222",
      accountName: "John Hart",
      resolvedAccountName: "John Hart",
      nameMatchScore: 60,
      nameMatchLevel: "weak",
      accountVerificationProvider: "paystack_account_resolution",
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
    await escrowStore.acceptEscrow(escrow.escrowId, seller.whatsappNumber);
    await escrowStore.attachPayment({
      escrowId: escrow.escrowId,
      paymentReference: "paystack-name-review",
      paymentProvider: "paystack",
      status: "PENDING_PAYMENT",
    });
    await escrowStore.markFundedByPaymentReference("paystack-name-review", { status: "success", amount: 10000 });
    await escrowStore.completeEscrow(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm");

    await expect(escrowStore.requestRelease(escrow.escrowId, buyer.whatsappNumber, "whatsapp_dm")).rejects.toThrow(/name match/i);
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
      resolvedAccountName: "Seller User",
      nameMatchScore: 100,
      nameMatchLevel: "strong",
      accountVerifiedAt: new Date().toISOString(),
      accountVerificationProvider: "paystack_account_resolution",
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
    const ledgerEntries = await escrowStore.listLedgerEntries(escrow.escrowId);

    expect(resolved.status).toBe("RELEASED");
    expect(resolved.manualPayoutReference).toBe("dispute-payout-1");
    expect(events.map((event) => event.eventType)).toContain("dispute_resolved");
    expect(transactions.map((transaction) => transaction.status)).toContain("manual_dispute_release");
    expect(ledgerEntries.map((entry) => entry.entryType)).toContain("release");
  });

  it("verifies cryptographic audit trails and detects manual database tampering", async () => {
    const escrowStore = freshStore();
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000021", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348000000022", "seller");
    
    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 15000,
      currency: "NAIRA",
      purpose: "Cryptographic test deed",
      createdByChannel: "whatsapp_dm",
    });

    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor: buyer.whatsappNumber,
      actorRole: "buyer",
      channel: "whatsapp_dm",
      previousStatus: "CREATED",
      nextStatus: "PENDING_ACCEPTANCE",
      eventType: "escrow_created",
      reason: "Agreement created via WhatsApp",
    });

    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor: seller.whatsappNumber,
      actorRole: "seller",
      channel: "whatsapp_dm",
      previousStatus: "PENDING_ACCEPTANCE",
      nextStatus: "PENDING_PAYMENT",
      eventType: "escrow_accepted",
      reason: "Agreement accepted by seller",
    });

    // 1. Verify that the untouched chain passes verification successfully
    const auditResBefore = await escrowStore.verifyEscrowAuditTrail(escrow.escrowId);
    expect(auditResBefore.verified).toBe(true);

    // 2. Manually alter the database event record (simulating database tampering)
    const db = (escrowStore as any).sqlite;
    db.prepare("UPDATE escrow_events SET actor = 'hacker_whatsapp' WHERE event_type = 'escrow_accepted'").run();

    // 3. Verify that the altered chain fails verification and identifies the break
    const auditResAfter = await escrowStore.verifyEscrowAuditTrail(escrow.escrowId);
    expect(auditResAfter.verified).toBe(false);
    expect(auditResAfter.error).toContain("Hash mismatch at event");
  });
});
