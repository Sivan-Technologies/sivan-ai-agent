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
