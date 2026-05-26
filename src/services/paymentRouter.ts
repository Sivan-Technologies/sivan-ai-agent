import { PaystackClient } from "./paystackClient";
import { X402Client } from "./x402Client";
import { SapAgent } from "./sapAgent";
import { config } from "../config";

export type PaymentMethod = "USDC" | "NAIRA";

export interface PaymentResult {
  method: PaymentMethod;
  status: string;
  reference: string;
  authorizationUrl?: string;
  paymentId?: string;
  details?: any;
}

export class PaymentRouter {
  private paystackClient = new PaystackClient();
  private x402Client = new X402Client(
    config.x402.rpcUrl,
    config.x402.clientId,
    config.x402.clientSecret
  );
  constructor(private sapAgent?: SapAgent) {}

  public determinePaymentMethod(userPreference: string): PaymentMethod {
    const normalized = userPreference.trim().toLowerCase();
    if (normalized === "naira" || normalized === "fiat") {
      return "NAIRA";
    }
    return "USDC";
  }

  public async processNairaPayment(amount: number, email: string): Promise<PaymentResult> {
    const transaction = await this.paystackClient.initializeTransaction(
      amount,
      email,
      process.env.WEBHOOK_URL || ""
    );

    return {
      method: "NAIRA",
      status: "pending",
      reference: transaction.reference,
      authorizationUrl: transaction.authorizationUrl,
      details: {
        authorizationUrl: transaction.authorizationUrl,
        accessCode: transaction.accessCode,
      },
    };
  }

  public async processUsdcEscrow(amount: number, recipient: string): Promise<PaymentResult> {
    const facility = await this.x402Client.createPaymentFacility(amount, "USDC", recipient, {
      purpose: "agent-service-payment",
    });

    return {
      method: "USDC",
      status: facility.status,
      reference: facility.facilitatorId,
      paymentId: facility.paymentId,
      details: facility,
    };
  }

  public async processUsdcSapEscrow(amount: number, recipient: string): Promise<PaymentResult> {
    if (!this.sapAgent) {
      throw new Error("SAP agent is required to process on-chain USDC escrow");
    }
    const escrow = await this.sapAgent.createEscrow(amount, "USDC", recipient, {
      purpose: "on-chain usdc escrow",
    });
    return {
      method: "USDC",
      status: escrow.status,
      reference: escrow.escrowId,
      paymentId: escrow.escrowId,
      details: escrow,
    };
  }

  public async settleUsdcPayment(paymentId: string): Promise<PaymentResult> {
    const settlement = await this.x402Client.settlePayment(paymentId);
    return {
      method: "USDC",
      status: settlement.status,
      reference: settlement.facilitatorId,
      paymentId: settlement.paymentId,
      details: settlement,
    };
  }
}
