import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { log } from "../lib/logger";

export interface X402PaymentResult {
  facilitatorId: string;
  paymentId: string;
  status: "pending" | "active" | "settled" | "failed";
  transactionHash?: string;
  amount: number;
  currency: string;
  createdAt: string;
  details: any;
}

export interface X402FacilitatorResponse {
  success: boolean;
  data?: X402PaymentResult;
  error?: string;
  retryable?: boolean;
}

export class X402Client {
  private axiosInstance: AxiosInstance;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;

  constructor(
    private baseUrl: string = config.x402.rpcUrl,
    private clientId: string = config.x402.clientId,
    private clientSecret: string = config.x402.clientSecret
  ) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: this.getHeaders(),
    });
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.clientSecret}`,
      "X-Client-Id": this.clientId,
      "X-Synapse-Network": config.x402.network,
      ...(config.x402.usdcMint ? { "X-USDC-Mint": config.x402.usdcMint } : {}),
      "Content-Type": "application/json",
    };
  }
  private async retryableCall<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        log(`Executing ${operationName}, attempt ${attempt}/${this.MAX_RETRIES}`);
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.MAX_RETRIES) {
          const delayMs = this.BASE_DELAY_MS * attempt;
          log(`${operationName} failed on attempt ${attempt}, retrying in ${delayMs}ms`, {
            error: lastError.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  }

  public async createPaymentFacility(
    amount: number,
    currency: string,
    recipient: string,
    metadata: Record<string, any> = {}
  ): Promise<X402PaymentResult> {
    log("Creating x402 payment facility", { amount, currency, recipient });
    const result = await this.retryableCall(async () => {
      const response = await this.axiosInstance.post<X402FacilitatorResponse>(
        "/v1/payment-facility/create",
        {
          amount,
          currency,
          recipient,
          network: config.x402.network,
          asset: config.x402.usdcMint || "USDC",
          metadata: {
            ...metadata,
            synapseNetwork: config.x402.network,
            usdcMint: config.x402.usdcMint || undefined,
          },
        }
      );

      if (!response.data?.success || !response.data?.data) {
        throw new Error(response.data?.error || "Failed to create payment facility");
      }

      return response.data.data;
    }, "createPaymentFacility");

    return result;
  }

  public async settlePayment(paymentId: string): Promise<X402PaymentResult> {
    log("Settling x402 payment", { paymentId });
    const result = await this.retryableCall(async () => {
      const response = await this.axiosInstance.post<X402FacilitatorResponse>(
        "/v1/payment-facility/settle",
        { payment_id: paymentId }
      );

      if (!response.data?.success || !response.data?.data) {
        throw new Error(response.data?.error || "Failed to settle payment");
      }

      return response.data.data;
    }, "settlePayment");

    return result;
  }
  public async getPaymentStatus(paymentId: string): Promise<X402PaymentResult> {
    log("Fetching x402 payment status", { paymentId });
    const result = await this.retryableCall(async () => {
      const response = await this.axiosInstance.get<X402FacilitatorResponse>(
        `/v1/payment-facility/status/${paymentId}`
      );

      if (!response.data?.success || !response.data?.data) {
        throw new Error(response.data?.error || "Failed to fetch payment status");
      }

      return response.data.data;
    }, "getPaymentStatus");

    return result;
  }
}
