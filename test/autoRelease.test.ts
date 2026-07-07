import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-auto-release.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

// Dynamically import stores after setting process.env
const { settingsStore, escrowStore } = await import("../src/context");
const { checkInspectionExpirations } = await import("../src/services/escrowService");
const { EscrowRecord } = await import("../src/services/escrowStore");

describe("Auto Release and Configurable Dispute Timers", () => {
  beforeAll(async () => {
    await settingsStore.initializeSchema();
    await escrowStore.initializeSchema();
  });

  afterAll(async () => {
    await escrowStore.close();
    await settingsStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // Handle locks gracefully
      }
    }
  });

  it("allows admin to update autoReleaseEnabled and deliveryInspectionWindowDays in control settings", async () => {
    const settings = await settingsStore.getSettings();
    const originalVersion = settings.version;

    // Update settings
    const updated = await settingsStore.updateSettings({
      autoReleaseEnabled: false,
      deliveryInspectionWindowDays: 14,
      expectedVersion: originalVersion,
      updatedBy: "admin",
    });

    expect(updated.autoReleaseEnabled).toBe(false);
    expect(updated.deliveryInspectionWindowDays).toBe(14);
  });

  it("enforces validation rules for deliveryInspectionWindowDays", async () => {
    const settings = await settingsStore.getSettings();
    const originalVersion = settings.version;

    // Must be >= 1 day
    await expect(
      settingsStore.updateSettings({
        deliveryInspectionWindowDays: 0,
        expectedVersion: originalVersion,
        updatedBy: "admin",
      })
    ).rejects.toThrow("Delivery inspection window must be between 1 and 30 days");

    // Must be <= 30 days
    await expect(
      settingsStore.updateSettings({
        deliveryInspectionWindowDays: 31,
        expectedVersion: originalVersion,
        updatedBy: "admin",
      })
    ).rejects.toThrow("Delivery inspection window must be between 1 and 30 days");
  });

  it("uses the deliveryInspectionWindowDays configuration dynamically when marking delivered", async () => {
    // Set inspection window to 5 days
    const settings = await settingsStore.getSettings();
    await settingsStore.updateSettings({
      deliveryInspectionWindowDays: 5,
      expectedVersion: settings.version,
      updatedBy: "admin",
    });

    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000001", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000002", "seller");

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 5000,
      currency: "NAIRA",
      purpose: "E2E delivery timer proof",
      createdByChannel: "api",
    });

    // Mark as funded/in_progress so we can mark it delivered
    await escrowStore.transitionEscrow(escrow.escrowId, "FUNDED", {
      actor: "system",
      actorRole: "system",
      channel: "api",
      eventType: "payment_reconciliation_succeeded",
      reason: "funded",
    });

    const marked = await escrowStore.markDelivered(
      escrow.escrowId,
      seller.whatsappNumber,
      "api",
      "Draft delivered",
      "{}"
    );

    expect(marked.status).toBe("DELIVERED");
    expect(marked.inspectionExpiresAt).toBeDefined();

    // Check that the expiration is set exactly 5 days from now (with margin)
    const expiresTime = new Date(marked.inspectionExpiresAt!).getTime();
    const expectedTime = Date.now() + 5 * 24 * 60 * 60 * 1000;
    const diff = Math.abs(expiresTime - expectedTime);
    expect(diff).toBeLessThan(10000); // 10 seconds tolerance
  });

  it("skips auto-release sweep if autoReleaseEnabled is disabled", async () => {
    // Create an expired escrow in DELIVERED state
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000003", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000004", "seller");

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 5000,
      currency: "NAIRA",
      purpose: "E2E disabled auto-release",
      createdByChannel: "api",
    });

    // Move to delivered with expired inspection timer
    await escrowStore.transitionEscrow(escrow.escrowId, "DELIVERED", {
      actor: "system",
      actorRole: "system",
      channel: "api",
      eventType: "seller_delivery_proof_recorded",
      reason: "delivered",
    });

    // Manually backdate the inspection timer in the DB to make it expired
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    await escrowStore.runTransaction(async () => {
      await escrowStore.sqlite!.prepare(
        "UPDATE escrows SET inspection_expires_at = ? WHERE escrow_id = ?"
      ).run(expiredTime, escrow.escrowId);
    });

    // Ensure autoReleaseEnabled is false
    const settings = await settingsStore.getSettings();
    await settingsStore.updateSettings({
      autoReleaseEnabled: false,
      expectedVersion: settings.version,
      updatedBy: "admin",
    });

    // Run sweep
    const transitioned = await checkInspectionExpirations();
    expect(transitioned).toBe(0); // Should be 0 since sweep is disabled

    const current = await escrowStore.getEscrowById(escrow.escrowId);
    expect(current?.status).toBe("DELIVERED"); // Status unchanged
  });

  it("performs auto-release sweep when autoReleaseEnabled is enabled", async () => {
    // Create another expired escrow in DELIVERED state
    const buyer = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000005", "buyer");
    const seller = await escrowStore.upsertUserByWhatsapp("whatsapp:+2348200000006", "seller");

    // Complete Alice Seller profile & payout setup (required for requestRelease transition)
    await escrowStore.sqlite!.prepare(
      "UPDATE users SET first_name = 'Alice', last_name = 'Seller' WHERE user_id = ?"
    ).run(seller.userId);

    await escrowStore.upsertPayoutAccount({
      userId: seller.userId,
      bankName: "Access Bank",
      bankCode: "044",
      accountNumber: "1234567890",
      accountName: "Alice Seller",
      verificationStatus: "verified",
      nameMatchLevel: "strong",
    });

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller.userId,
      sellerWhatsapp: seller.whatsappNumber,
      amount: 5000,
      currency: "NAIRA",
      purpose: "E2E enabled auto-release",
      createdByChannel: "api",
    });

    // Move to delivered with expired inspection timer
    await escrowStore.transitionEscrow(escrow.escrowId, "DELIVERED", {
      actor: "system",
      actorRole: "system",
      channel: "api",
      eventType: "seller_delivery_proof_recorded",
      reason: "delivered",
    });

    // Manually backdate the inspection timer in the DB to make it expired
    const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    await escrowStore.runTransaction(async () => {
      await escrowStore.sqlite!.prepare(
        "UPDATE escrows SET inspection_expires_at = ? WHERE escrow_id = ?"
      ).run(expiredTime, escrow.escrowId);
    });

    // Enable auto-release in settings
    const settings = await settingsStore.getSettings();
    await settingsStore.updateSettings({
      autoReleaseEnabled: true,
      expectedVersion: settings.version,
      updatedBy: "admin",
    });

    // Run sweep
    const transitioned = await checkInspectionExpirations();
    expect(transitioned).toBe(1); // 1 escrow auto-completed

    const current = await escrowStore.getEscrowById(escrow.escrowId);
    expect(current?.status).toBe("PENDING_RELEASE"); // Status updated to PENDING_RELEASE
  });
});
