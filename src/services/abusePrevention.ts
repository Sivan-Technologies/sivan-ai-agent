import { EscrowStore } from "./escrowStore";
import { ProductionOpsStore } from "./productionOpsStore";

export interface AbuseDecision {
  allowed: boolean;
  riskScore: number;
  severity: "low" | "medium" | "high" | "critical";
  reasons: string[];
}

function severity(score: number): AbuseDecision["severity"] {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export class AbusePreventionService {
  constructor(private escrowStore: EscrowStore, private opsStore: ProductionOpsStore) {}

  public async evaluateEscrowCreate(input: {
    buyerWhatsapp: string;
    sellerWhatsapp?: string;
    amount: number;
    currency: "NAIRA" | "USDC";
    purpose: string;
    channel: string;
    requestIp?: string;
    userAgent?: string;
    deviceFingerprint?: string;
  }): Promise<AbuseDecision> {
    const reasons: string[] = [];
    let riskScore = 0;
    const blockScore = Number(process.env.ABUSE_BLOCK_SCORE || "95");
    const reviewScore = Number(process.env.ABUSE_REVIEW_SCORE || "60");
    const velocityLimit = Number(process.env.ABUSE_ESCROW_VELOCITY_LIMIT || "8");
    const highAmountNaira = Number(process.env.ABUSE_HIGH_AMOUNT_NAIRA || "1000000");
    const highAmountUsdc = Number(process.env.ABUSE_HIGH_AMOUNT_USDC || "5000");

    const [recent, buyer] = await Promise.all([
      this.escrowStore.listEscrows(250),
      this.escrowStore.findUserByWhatsapp(input.buyerWhatsapp),
    ]);
    const buyerRecent = buyer
      ? recent.filter((escrow) => escrow.buyerUserId === buyer.userId || escrow.sellerWhatsapp === input.buyerWhatsapp)
      : [];
    if (buyerRecent.length >= velocityLimit) {
      riskScore += 35;
      reasons.push(`High escrow velocity: ${buyerRecent.length} recent records`);
    }

    if (input.sellerWhatsapp && input.sellerWhatsapp === input.buyerWhatsapp) {
      riskScore += 40;
      reasons.push("Buyer and seller WhatsApp addresses match");
    }

    if ((input.currency === "NAIRA" && input.amount >= highAmountNaira) || (input.currency === "USDC" && input.amount >= highAmountUsdc)) {
      riskScore += 25;
      reasons.push(`High amount for ${input.currency}`);
    }

    if (/(gift\s*card|airdrop|double|guaranteed profit|investment return|seed phrase|private key)/i.test(input.purpose)) {
      riskScore += 35;
      reasons.push("Purpose contains high-risk scam/fraud keywords");
    }

    if (input.channel === "api") {
      riskScore += 10;
      reasons.push("Direct API-created escrow should be monitored");
    }

    if (input.deviceFingerprint) {
      reasons.push("Device fingerprint captured for reputation tracking");
    }
    if (input.requestIp || input.userAgent) {
      reasons.push("Request fingerprint metadata captured");
    }

    riskScore = Math.min(100, riskScore);
    const decision: AbuseDecision = {
      allowed: riskScore < blockScore,
      riskScore,
      severity: severity(riskScore),
      reasons,
    };

    if (riskScore >= reviewScore || !decision.allowed) {
      await this.opsStore.recordAbuseSignal({
        subjectType: "escrow_create",
        subjectId: input.buyerWhatsapp,
        category: "escrow_risk",
        severity: decision.severity,
        riskScore,
        reason: reasons.join("; ") || "Escrow create matched risk review threshold",
        metadata: JSON.stringify(input),
      });
    }

    return decision;
  }
}
