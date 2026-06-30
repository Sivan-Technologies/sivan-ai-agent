import fs from "fs";
import path from "path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { hasBlockingComplianceRisk, scoreComplianceRisk } from "../src/services/complianceRisk";
import { settingsStore } from "../src/context";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-compliance-risk.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  await settingsStore.initializeSchema();
});

afterAll(async () => {
  await settingsStore.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

describe("scoreComplianceRisk", () => {
  it("adds a low-risk new-seller signal without blocking payout", async () => {
    const risk = await scoreComplianceRisk({
      amount: 10000,
      currency: "NAIRA",
      sellerEscrowCount: 1,
      sellerDisputeCount: 0,
      highValueAmount: 500000,
      checkedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(risk.riskScore).toBe(5);
    expect(risk.riskLevel).toBe("LOW");
    expect(risk.riskReasons).toEqual(["new_seller"]);
    expect(hasBlockingComplianceRisk(risk)).toBe(false);
  });

  it("blocks payout approval when seller dispute ratio is above the MVP threshold", async () => {
    const risk = await scoreComplianceRisk({
      amount: 20000,
      currency: "NAIRA",
      sellerEscrowCount: 4,
      sellerDisputeCount: 2,
      highDisputeRatio: 0.3,
      highDisputeMinEscrows: 3,
      highValueAmount: 500000,
      checkedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(risk.riskScore).toBe(30);
    expect(risk.riskReasons).toContain("high_seller_dispute_ratio");
    expect(risk.sellerDisputeRatio).toBe(0.5);
    expect(hasBlockingComplianceRisk(risk)).toBe(true);
  });

  it("marks high-value seller activity without requiring Phase 2 KYC", async () => {
    const risk = await scoreComplianceRisk({
      amount: 500000,
      currency: "NAIRA",
      sellerEscrowCount: 2,
      sellerDisputeCount: 0,
      newSellerEscrowCount: 1,
      highValueAmount: 500000,
      checkedAt: "2026-06-03T00:00:00.000Z",
    });

    expect(risk.riskScore).toBe(20);
    expect(risk.riskReasons).toEqual(["large_transaction"]);
    expect(hasBlockingComplianceRisk(risk)).toBe(false);
  });
});
