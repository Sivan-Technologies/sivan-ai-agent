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
  private readonly MAX_RETRIES = 1;
  private readonly BASE_DELAY_MS = 500;

  constructor(
    private baseUrl: string = config.x402.rpcUrl,
    private clientId: string = config.x402.clientId,
    private clientSecret: string = config.x402.clientSecret
  ) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 3500,
      headers: this.getHeaders(),
    });

    this.axiosInstance.interceptors.request.use(async (reqConfig) => {
      try {
        const { settingsStore } = await import("../context.js");
        const settings = await settingsStore.getSettings();
        const netName = (settings.cryptoNetwork || "solana").toLowerCase();
        const netMode = (settings.networkMode || "devnet").toLowerCase();
        let formattedNetwork = `${netName}-${netMode}`;
        if (netName === "avalanche" && netMode === "devnet") formattedNetwork = "avalanche-fuji";
        if (netName === "ethereum" && netMode === "devnet") formattedNetwork = "ethereum-sepolia";
        if (netName === "arbitrum" && netMode === "mainnet") formattedNetwork = "arbitrum-one";
        if (netName === "arbitrum" && netMode === "devnet") formattedNetwork = "arbitrum-sepolia";

        reqConfig.headers["X-Synapse-Network"] = formattedNetwork;
      } catch {
        // Fallback to static env configuration
      }
      return reqConfig;
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

  public async verifyConnectivity(options: {
    paymentId?: string;
    createProbe?: boolean;
    amount?: number;
    recipient?: string;
  } = {}) {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    if (options.paymentId) {
      const status = await this.getPaymentStatus(options.paymentId);
      return {
        status: "ok" as const,
        mode: "status_probe" as const,
        facilitatorUrl: this.baseUrl,
        network: config.x402.network,
        paymentId: status.paymentId,
        paymentStatus: status.status,
        transactionHash: status.transactionHash,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    if (options.createProbe) {
      if (!options.recipient) {
        throw new Error("X402 probe recipient is required when createProbe is enabled");
      }

      const facility = await this.createPaymentFacility(
        options.amount || 0.01,
        "USDC",
        options.recipient,
        {
          purpose: "sivan-production-verification",
          checkedAt,
        }
      );

      return {
        status: "ok" as const,
        mode: "create_probe" as const,
        facilitatorUrl: this.baseUrl,
        network: config.x402.network,
        paymentId: facility.paymentId,
        paymentStatus: facility.status,
        transactionHash: facility.transactionHash,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    }

    return {
      status: "skipped" as const,
      mode: "configuration_only" as const,
      facilitatorUrl: this.baseUrl,
      network: config.x402.network,
      reason: "Set X402_VERIFY_PAYMENT_ID or X402_VERIFY_CREATE_PAYMENT=true for live facilitator proof",
      latencyMs: Date.now() - startedAt,
      checkedAt,
    };
  }
}
