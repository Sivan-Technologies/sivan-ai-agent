import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

// ---------------------------------------------------------------------------
// Flutterwave v3 API client
//
// Endpoint reference:
//   Virtual accounts : POST   /v3/virtual-account-numbers
//   Verify by ref   : GET    /v3/transactions/verify_by_reference?tx_ref=...
//   Verify by ID    : GET    /v3/transactions/{id}/verify
//   Webhook secret  : verif-hash header (plain string equality, timing-safe)
// ---------------------------------------------------------------------------

export interface FlutterwaveVirtualAccountInstruction {
  paymentReference: string;
  transactionReference: string;
  authorizationUrl?: string;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  raw: unknown;
}

export interface FlutterwaveVerifiedCharge {
  paymentReference: string;
  transactionReference?: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  processorFee?: number;
  paidAt?: string;
  customerId?: string;
  raw: unknown;
}

function extractAxiosMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = (err as any).response?.data;
    return (
      data?.message ||
      data?.error?.message ||
      (err as any).message ||
      "Flutterwave request failed"
    );
  }
  return err instanceof Error ? err.message : "Flutterwave request failed";
}

export class FlutterwaveClient {
  private baseUrl = config.flutterwave.baseUrl.replace(/\/$/, "");
  private secretKey: string | undefined;
  private webhookSecret = config.flutterwave.webhookSecret;
  private timeoutMs = config.flutterwave.timeoutMs;

  constructor(platformMode?: "test" | "live" | "maintenance") {
    if (platformMode === "live") {
      this.secretKey = config.flutterwave.liveSecretKey || config.flutterwave.secretKey;
      this.baseUrl = "https://api.flutterwave.com";
    } else if (platformMode === "test") {
      this.secretKey = config.flutterwave.testSecretKey || config.flutterwave.secretKey;
      this.baseUrl = "https://api.flutterwave.com";
    } else {
      this.secretKey = config.flutterwave.secretKey;
      this.baseUrl = config.flutterwave.baseUrl.replace(/\/$/, "");
    }
  }

  public isCollectionConfigured() {
    return Boolean(this.secretKey && this.baseUrl);
  }

  /**
   * Verifies the Flutterwave webhook `verif-hash` header.
   * Flutterwave sends the hash as a plain string identical to your
   * FLW_WEBHOOK_SECRET — not an HMAC. Timing-safe compare prevents timing attacks.
   */
  public verifyWebhookSignature(signature: string): boolean {
    if (!this.webhookSecret || !signature) return false;
    try {
      const left = Buffer.from(this.webhookSecret);
      const right = Buffer.from(signature);
      return left.length === right.length && crypto.timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  private authHeaders() {
    if (!this.secretKey) throw new Error("Flutterwave secret key is not configured");
    return {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  /**
   * Creates a Flutterwave dynamic virtual account (NGN bank transfer).
   *
   * Uses the v3 single-call endpoint: POST /v3/virtual-account-numbers
   * No separate customer creation step required.
   *
   * @see https://developer.flutterwave.com/docs/collecting-payments/virtual-account
   */
  public async initializeBankTransferPayment(input: {
    amount: number;
    customerEmail: string;
    paymentReference: string;
    paymentDescription: string;
    redirectUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<FlutterwaveVirtualAccountInstruction> {
    if (!this.isCollectionConfigured()) {
      throw new Error("Flutterwave collection credentials are not configured");
    }

    const optionsMap: Record<string, string> = {
      bank_transfer: "banktransfer",
      card: "card",
      ussd: "ussd",
    };
    const paymentOptions = config.flutterwave.paymentMethods
      .map((method) => optionsMap[method.toLowerCase().trim()] || method.toLowerCase().trim())
      .join(",");

    const local = input.customerEmail.split("@")[0]?.replace(/[^a-zA-Z0-9]+/g, " ").trim() || "Sivan Buyer";
    const parts = local.split(/\s+/).filter(Boolean);
    const firstname = parts[0] || "Sivan";
    const lastname = parts.slice(1).join(" ") || "Buyer";

    const body: Record<string, unknown> = {
      tx_ref: input.paymentReference,
      amount: input.amount,
      currency: "NGN",
      redirect_url: input.redirectUrl || config.flutterwave.callbackUrl || config.paystack.callbackUrl || "https://sivan.online",
      payment_options: paymentOptions || "banktransfer",
      customer: {
        email: input.customerEmail,
        name: `${firstname} ${lastname}`.trim(),
      },
      customizations: {
        title: "Sivan Payments",
        description: input.paymentDescription,
      },
      meta: input.metadata,
    };

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/v3/payments`,
        body,
        { headers: this.authHeaders(), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`Flutterwave hosted payment initialization failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data;
    if (response?.status !== "success" || !data?.link) {
      throw new Error(
        response?.message ||
        response?.error?.message ||
        "Flutterwave hosted payment initialization returned no payment link"
      );
    }

    return {
      paymentReference: input.paymentReference,
      transactionReference: input.paymentReference,
      authorizationUrl: data.link,
      expiresInSeconds: config.flutterwave.dynamicAccountExpirySeconds,
      raw: response,
    };
  }

  /**
   * Verifies a Flutterwave transaction by its numeric charge/transaction ID.
   *
   * GET /v3/transactions/{id}/verify
   */
  public async verifyChargeById(chargeId: string): Promise<FlutterwaveVerifiedCharge> {
    let response: any;
    try {
      const res = await axios.get(
        `${this.baseUrl}/v3/transactions/${encodeURIComponent(chargeId)}/verify`,
        { headers: this.authHeaders(), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`Flutterwave transaction verify-by-id failed: ${extractAxiosMessage(err)}`);
    }
    return this.mapTransactionResponse(response, chargeId);
  }

  /**
   * Verifies a Flutterwave transaction by the tx_ref / paymentReference we set.
   *
   * GET /v3/transactions/verify_by_reference?tx_ref=...
   */
  public async verifyPayment(paymentReference: string): Promise<FlutterwaveVerifiedCharge> {
    let response: any;
    try {
      const res = await axios.get(
        `${this.baseUrl}/v3/transactions/verify_by_reference`,
        {
          headers: this.authHeaders(),
          params: { tx_ref: paymentReference },
          timeout: this.timeoutMs,
        }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`Flutterwave transaction verify-by-reference failed: ${extractAxiosMessage(err)}`);
    }
    return this.mapTransactionResponse(response, paymentReference);
  }

  public async listTransactions(input: { from: string; to: string; perPage?: number }): Promise<FlutterwaveVerifiedCharge[]> {
    const transactions: FlutterwaveVerifiedCharge[] = [];
    const perPage = input.perPage || 100;
    let page = 1;

    while (page <= 20) {
      let response: any;
      try {
        const res = await axios.get(
          `${this.baseUrl}/v3/transactions`,
          {
            headers: this.authHeaders(),
            params: {
              from: input.from.slice(0, 10),
              to: input.to.slice(0, 10),
              page,
              per_page: perPage,
            },
            timeout: this.timeoutMs,
          }
        );
        response = res.data;
      } catch (err) {
        throw new Error(`Flutterwave transaction list failed: ${extractAxiosMessage(err)}`);
      }

      if (response?.status !== "success" || !Array.isArray(response.data)) {
        throw new Error(response?.message || "Flutterwave transaction list returned no data");
      }

      transactions.push(...response.data.map((tx: any) => this.mapTransaction(tx, response, String(tx.tx_ref || tx.id || ""))));

      const meta = response.meta || {};
      const totalPages = Number(meta.total_pages || meta.pageCount || 0);
      if (!response.data.length || (totalPages && page >= totalPages)) break;
      if (response.data.length < perPage) break;
      page += 1;
    }

    return transactions.filter((transaction) => transaction.paymentReference);
  }

  private mapTransactionResponse(response: any, fallbackReference: string): FlutterwaveVerifiedCharge {
    const data = response?.data;
    if (response?.status !== "success" || !data) {
      throw new Error(
        response?.message ||
        response?.error?.message ||
        "Flutterwave transaction verification returned no data"
      );
    }
    return this.mapTransaction(data, response, fallbackReference);
  }

  private mapTransaction(
    tx: any,
    raw: any,
    fallbackReference = ""
  ): FlutterwaveVerifiedCharge {
    // v3 uses "successful" (not "succeeded") as the success status value.
    const rawStatus = String(tx.status || "").toLowerCase();
    const status = rawStatus === "successful" ? "successful" : rawStatus;

    const processorFee = Array.isArray(tx.app_fee)
      ? tx.app_fee.reduce((sum: number, fee: any) => sum + Number(fee?.amount || 0), 0)
      : Number.isFinite(Number(tx.app_fee))
        ? Number(tx.app_fee)
        : undefined;

    return {
      paymentReference: String(tx.tx_ref || fallbackReference).trim(),
      transactionReference: tx.id ? String(tx.id) : undefined,
      status,
      amount: Number(tx.amount || 0),
      currency: String(tx.currency || "").toUpperCase(),
      paymentMethod: String(tx.payment_type || "").toLowerCase(),
      processorFee: Number.isFinite(processorFee) ? (processorFee as number) : undefined,
      paidAt: tx.created_at,
      customerId: tx.customer?.id ? String(tx.customer.id) : undefined,
      raw,
    };
  }
}
