import { describe, expect, it } from "vitest";
import { hasBlockingComplianceRisk, scoreComplianceRisk } from "../src/services/complianceRisk";

describe("scoreComplianceRisk", () => {
  it("adds a low-risk new-seller signal without blocking payout", () => {
    const risk = scoreComplianceRisk({
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

  it("blocks payout approval when seller dispute ratio is above the MVP threshold", () => {
    const risk = scoreComplianceRisk({
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

  it("marks high-value seller activity without requiring Phase 2 KYC", () => {
    const risk = scoreComplianceRisk({
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
