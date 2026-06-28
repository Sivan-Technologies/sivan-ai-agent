import { EscrowCurrency } from "./escrowStore";
import { settingsStore } from "../context";

export type ComplianceRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ComplianceRisk = {
  riskScore: number;
  riskLevel: ComplianceRiskLevel;
  riskReasons: string[];
  sellerDisputeRatio: number;
  sellerDisputeCount: number;
  sellerEscrowCount: number;
  sellerIsNew: boolean;
  checkedAt: string;
};

export type ComplianceRiskInput = {
  amount: number;
  currency: EscrowCurrency;
  sellerEscrowCount: number;
  sellerDisputeCount: number;
  highValueAmount?: number;
  newSellerEscrowCount?: number;
  highDisputeRatio?: number;
  highDisputeMinEscrows?: number;
  checkedAt?: string;
};

export async function highValueReviewAmount(currency: EscrowCurrency) {
  const settings = await settingsStore.getSettings();
  return currency === "NAIRA" ? settings.nairaHighValueReviewAmount : settings.usdcHighValueReviewAmount;
}

export function complianceRiskLevel(score: number): ComplianceRiskLevel {
  if (score >= 80) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

export function hasBlockingComplianceRisk(risk: ComplianceRisk) {
  return risk.riskLevel === "HIGH"
    || risk.riskLevel === "CRITICAL"
    || risk.riskReasons.includes("high_seller_dispute_ratio");
}

export async function scoreComplianceRisk(input: ComplianceRiskInput): Promise<ComplianceRisk> {
  const riskReasons: string[] = [];
  let riskScore = 0;
  const sellerEscrowCount = Math.max(0, input.sellerEscrowCount);
  const sellerDisputeCount = Math.max(0, input.sellerDisputeCount);
  const sellerDisputeRatio = sellerEscrowCount > 0 ? sellerDisputeCount / sellerEscrowCount : 0;
  const settings = await settingsStore.getSettings();
  const newSellerEscrowCount = input.newSellerEscrowCount ?? settings.complianceNewSellerEscrowCount;
  const highDisputeRatio = input.highDisputeRatio ?? settings.complianceHighDisputeRatio;
  const highDisputeMinEscrows = input.highDisputeMinEscrows ?? settings.complianceHighDisputeMinEscrows;
  const highValueAmount = input.highValueAmount ?? await highValueReviewAmount(input.currency);
  const sellerIsNew = sellerEscrowCount <= newSellerEscrowCount;

  if (sellerIsNew) {
    riskScore += 5;
    riskReasons.push("new_seller");
  }
  if (sellerEscrowCount >= highDisputeMinEscrows && sellerDisputeRatio > highDisputeRatio) {
    riskScore += 30;
    riskReasons.push("high_seller_dispute_ratio");
  }
  if (input.amount >= highValueAmount) {
    riskScore += 20;
    riskReasons.push("large_transaction");
  }

  riskScore = Math.min(100, riskScore);
  return {
    riskScore,
    riskLevel: complianceRiskLevel(riskScore),
    riskReasons,
    sellerDisputeRatio: Number(sellerDisputeRatio.toFixed(4)),
    sellerDisputeCount,
    sellerEscrowCount,
    sellerIsNew,
    checkedAt: input.checkedAt || new Date().toISOString(),
  };
}
