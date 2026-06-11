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
    expect(fee.recipientNet).toBe(9700);
  });

  it("calculates USDC fees", async () => {
    const settings = await settingsStore.getSettings();
    const fee = settingsStore.calculateUSDCFee(1000, settings);

    expect(fee.totalPlatformFee).toBe(15.5);
    expect(fee.totalWithFee).toBe(1015.5);
    expect(fee.recipientNet).toBe(984.5);
  });
});
