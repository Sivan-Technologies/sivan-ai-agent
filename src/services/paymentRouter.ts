import { X402Client } from "./x402Client";
import { SapAgent } from "./sapAgent";
import { config } from "../config";
import { createNairaPaymentProvider, PaymentProvider } from "./nairaPaymentProvider";

export type PaymentMethod = "USDC" | "USDT" | "NAIRA";

export interface PaymentResult {
  method: PaymentMethod;
  status: string;
  reference: string;
  authorizationUrl?: string;
  paymentId?: string;
  details?: any;
}

export class PaymentRouter {
  private nairaPaymentProvider: PaymentProvider;
  private x402Client = new X402Client(
    config.x402.rpcUrl,
    config.x402.clientId,
    config.x402.clientSecret
  );
  constructor(private sapAgent?: SapAgent, nairaPaymentProvider?: PaymentProvider) {
    this.nairaPaymentProvider = nairaPaymentProvider || createNairaPaymentProvider(process.env.ACTIVE_PAYMENT_PROVIDER || "paystack");
  }

  public determinePaymentMethod(userPreference: string): PaymentMethod {
    const normalized = userPreference.trim().toLowerCase();
    if (normalized === "naira" || normalized === "fiat") {
      return "NAIRA";
    }
    if (normalized === "usdt") {
      return "USDT";
    }
    return "USDC";
  }

  public async processNairaPayment(amount: number, email: string): Promise<PaymentResult> {
    const transaction = await this.nairaPaymentProvider.initializeBankTransferPayment({
      amount,
      customerEmail: email,
      callbackUrl: config.paystack.callbackUrl || config.flutterwave.callbackUrl,
    });

    return {
      method: "NAIRA",
      status: "pending",
      reference: transaction.paymentReference,
      authorizationUrl: transaction.authorizationUrl,
      details: {
        provider: transaction.provider,
        authorizationUrl: transaction.authorizationUrl,
        accessCode: transaction.accessCode,
        transactionReference: transaction.transactionReference,
      },
    };
  }

  public async processCryptoEscrow(amount: number, currency: "USDC" | "USDT" = "USDC", recipient: string): Promise<PaymentResult> {
    const facility = await this.x402Client.createPaymentFacility(amount, currency, recipient, {
      purpose: "agent-service-payment",
    });

    return {
      method: currency,
      status: facility.status,
      reference: facility.facilitatorId,
      paymentId: facility.paymentId,
      details: facility,
    };
  }

  public async processUsdcEscrow(amount: number, recipient: string): Promise<PaymentResult> {
    return this.processCryptoEscrow(amount, "USDC", recipient);
  }

  public async processUsdtEscrow(amount: number, recipient: string): Promise<PaymentResult> {
    return this.processCryptoEscrow(amount, "USDT", recipient);
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

  public async settleCryptoPayment(paymentId: string, currency: "USDC" | "USDT" = "USDC"): Promise<PaymentResult> {
    const settlement = await this.x402Client.settlePayment(paymentId);
    return {
      method: currency,
      status: settlement.status,
      reference: settlement.facilitatorId,
      paymentId: settlement.paymentId,
      details: settlement,
    };
  }

  public async settleUsdcPayment(paymentId: string): Promise<PaymentResult> {
    return this.settleCryptoPayment(paymentId, "USDC");
  }

  public getSapAgent(): SapAgent | undefined {
    return this.sapAgent;
  }

  public getX402Client(): X402Client {
    return this.x402Client;
  }
}
