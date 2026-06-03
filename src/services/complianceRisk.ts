import { EscrowCurrency } from "./escrowStore";

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

export function highValueReviewAmount(currency: EscrowCurrency) {
  return currency === "NAIRA"
    ? Number(process.env.NAIRA_HIGH_VALUE_REVIEW_AMOUNT || "500000")
    : Number(process.env.USDC_HIGH_VALUE_REVIEW_AMOUNT || "2500");
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

export function scoreComplianceRisk(input: ComplianceRiskInput): ComplianceRisk {
  const riskReasons: string[] = [];
  let riskScore = 0;
  const sellerEscrowCount = Math.max(0, input.sellerEscrowCount);
  const sellerDisputeCount = Math.max(0, input.sellerDisputeCount);
  const sellerDisputeRatio = sellerEscrowCount > 0 ? sellerDisputeCount / sellerEscrowCount : 0;
  const newSellerEscrowCount = input.newSellerEscrowCount ?? Number(process.env.COMPLIANCE_NEW_SELLER_ESCROW_COUNT || "1");
  const highDisputeRatio = input.highDisputeRatio ?? Number(process.env.COMPLIANCE_HIGH_DISPUTE_RATIO || "0.3");
  const highDisputeMinEscrows = input.highDisputeMinEscrows ?? Number(process.env.COMPLIANCE_HIGH_DISPUTE_MIN_ESCROWS || "3");
  const highValueAmount = input.highValueAmount ?? highValueReviewAmount(input.currency);
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
