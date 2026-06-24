import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SettingsStore } from "../src/services/settingsStore";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = "./data/test-settings-store.db";

function settingsUpdate(overrides: Partial<Parameters<SettingsStore["updateSettings"]>[0]> = {}) {
  return {
    nairaFeePercent: 2.5,
    nairaFeeFixed: 50,
    usdcFeePercent: 1.5,
    usdcFeeFixed: 0.5,
    expectedVersion: 1,
    updatedBy: "test-admin",
    ...overrides,
  };
}

describe("SettingsStore", () => {
  let settingsStore: SettingsStore;

  beforeEach(async () => {
    const folder = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    settingsStore = new SettingsStore(TEST_DB_PATH, "sqlite");
    await settingsStore.initializeSchema();
  });

  afterEach(async () => {
    await settingsStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("creates default settings", async () => {
    const settings = await settingsStore.getSettings();

    expect(settings.nairaFeePercent).toBe(2.5);
    expect(settings.nairaFeeFixed).toBe(50);
    expect(settings.usdcFeePercent).toBe(1.5);
    expect(settings.usdcFeeFixed).toBe(0.5);
    expect(settings.nairaNewUserLimit).toBe(100000);
    expect(settings.nairaTrustedUserLimit).toBe(250000);
    expect(settings.nairaEstablishedUserLimit).toBe(500000);
    expect(settings.nairaSpecialApprovalLimit).toBe(1000000);
    expect(settings.nairaBuyerActiveExposureLimit).toBe(500000);
    expect(settings.nairaPlatformActiveExposureLimit).toBe(10000000);
    expect(settings.trustedUserSuccessfulEscrows).toBe(3);
    expect(settings.establishedUserSuccessfulEscrows).toBe(10);
    expect(settings.platformMode).toBe("test");
    expect(settings.maintenanceMessage).toMatch(/maintenance/i);
    expect(settings.nairaPaymentMethod).toBe("bank_transfer");
    expect(settings.version).toBe(1);
  });

  it("validates fee bounds", async () => {
    await expect(settingsStore.updateSettings(settingsUpdate({ nairaFeePercent: 51 }))).rejects.toThrow("Naira fee percent must be between 0 and 50");

    await expect(settingsStore.updateSettings(settingsUpdate({ usdcFeeFixed: -0.5 }))).rejects.toThrow("USDC fixed fee must be non-negative");
  });

  it("increments version and writes an audit record", async () => {
    const updated = await settingsStore.updateSettings(settingsUpdate({ nairaFeePercent: 3, nairaFeeFixed: 75 }));

    expect(updated.version).toBe(2);
    expect(updated.nairaFeePercent).toBe(3);

    const history = await settingsStore.getAuditHistory();
    expect(history).toHaveLength(1);
    expect(history[0].settingName).toBe("platform_settings");
    expect(history[0].changedBy).toBe("test-admin");
  });

  it("updates tier and exposure controls", async () => {
    const updated = await settingsStore.updateSettings(settingsUpdate({
      nairaNewUserLimit: 125000,
      nairaTrustedUserLimit: 300000,
      nairaEstablishedUserLimit: 600000,
      nairaSpecialApprovalLimit: 1200000,
      nairaBuyerActiveExposureLimit: 750000,
      nairaPlatformActiveExposureLimit: 15000000,
      trustedUserSuccessfulEscrows: 4,
      establishedUserSuccessfulEscrows: 12,
    }));

    expect(updated).toMatchObject({
      nairaNewUserLimit: 125000,
      nairaTrustedUserLimit: 300000,
      nairaEstablishedUserLimit: 600000,
      nairaSpecialApprovalLimit: 1200000,
      nairaBuyerActiveExposureLimit: 750000,
      nairaPlatformActiveExposureLimit: 15000000,
      trustedUserSuccessfulEscrows: 4,
      establishedUserSuccessfulEscrows: 12,
      version: 2,
    });
  });

  it("updates platform mode and maintenance message", async () => {
    const updated = await settingsStore.updateSettings(settingsUpdate({
      platformMode: "maintenance",
      maintenanceMessage: "Sivan is in scheduled maintenance for a short period. Please try again soon.",
      nairaPaymentMethod: "bank_transfer",
    }));

    expect(updated.platformMode).toBe("maintenance");
    expect(updated.maintenanceMessage).toContain("scheduled maintenance");
    expect(updated.nairaPaymentMethod).toBe("bank_transfer");
  });

  it("rejects invalid tier ordering", async () => {
    await expect(settingsStore.updateSettings(settingsUpdate({
      nairaNewUserLimit: 300000,
      nairaTrustedUserLimit: 200000,
    }))).rejects.toThrow("Naira escrow limits must increase");
  });

  it("calculates Naira fees", async () => {
    const settings = await settingsStore.getSettings();
    const fee = settingsStore.calculateNairaFee(10000, settings);

    expect(fee.totalPlatformFee).toBe(300);
    expect(fee.totalWithFee).toBe(10300);
    expect(fee.recipientNet).toBe(10000);
  });

  it("calculates USDC fees", async () => {
    const settings = await settingsStore.getSettings();
    const fee = settingsStore.calculateUSDCFee(1000, settings);

    expect(fee.totalPlatformFee).toBe(15.5);
    expect(fee.totalWithFee).toBe(1015.5);
    expect(fee.recipientNet).toBe(1000);
  });

  it("calculates tiered Naira fees and toggles models", async () => {
    const settings = await settingsStore.getSettings();

    // Toggle model to tiered
    const updated = await settingsStore.updateSettings(settingsUpdate({
      nairaFeeModel: "tiered",
      expectedVersion: settings.version,
    }));
    expect(updated.nairaFeeModel).toBe("tiered");

    // Test tier 1 flat fee (5,000 NGN -> 500 NGN)
    const fee1 = settingsStore.calculateNairaFee(5000, updated);
    expect(fee1.totalPlatformFee).toBe(500);
    expect(fee1.platformFeeFixed).toBe(500);
    expect(fee1.platformFeePercent).toBe(0);

    // Test tier 2 flat fee (15,000 NGN -> 900 NGN)
    const fee2 = settingsStore.calculateNairaFee(15000, updated);
    expect(fee2.totalPlatformFee).toBe(900);

    // Test tier 3 flat fee (22,000 NGN -> 1,000 NGN)
    const fee3 = settingsStore.calculateNairaFee(22000, updated);
    expect(fee3.totalPlatformFee).toBe(1000);

    // Test tier 4 percentage fee (40,000 NGN -> 3.75% -> 1,500 NGN)
    const fee4 = settingsStore.calculateNairaFee(40000, updated);
    expect(fee4.totalPlatformFee).toBe(1500);
    expect(fee4.platformFeePercent).toBe(1500);
    expect(fee4.platformFeeFixed).toBe(0);

    // Test tier 5 percentage fee (80,000 NGN -> 3.5% -> 2,800 NGN)
    const fee5 = settingsStore.calculateNairaFee(80000, updated);
    expect(fee5.totalPlatformFee).toBe(2800);

    // Test fallback / above 100k (200,000 NGN -> 3.5% -> 7,000 NGN)
    const fee6 = settingsStore.calculateNairaFee(200000, updated);
    expect(fee6.totalPlatformFee).toBe(7000);
  });

  it("validates invalid tiered Naira configurations", async () => {
    const settings = await settingsStore.getSettings();

    // Invalid JSON
    await expect(settingsStore.updateSettings(settingsUpdate({
      nairaFeeTiers: "{invalid}",
      expectedVersion: settings.version,
    }))).rejects.toThrow(/valid JSON array/i);

    // Empty array/non-array
    await expect(settingsStore.updateSettings(settingsUpdate({
      nairaFeeTiers: '"not-array"',
      expectedVersion: settings.version,
    }))).rejects.toThrow(/valid JSON array/i);
  });
});
