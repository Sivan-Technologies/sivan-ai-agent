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
  private secretKey = config.flutterwave.secretKey;
  private webhookSecret = config.flutterwave.webhookSecret;
  private timeoutMs = config.flutterwave.timeoutMs;

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
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    assertNairaBankTransferOnly(config.flutterwave.paymentMethods, "FLUTTERWAVE_PAYMENT_METHODS");

    const expiresInSeconds = config.flutterwave.dynamicAccountExpirySeconds;

    // Derive firstname/lastname from the synthetic email so the narration
    // shown in the bank transfer is human-readable.
    const local = input.customerEmail.split("@")[0]?.replace(/[^a-zA-Z0-9]+/g, " ").trim() || "Sivan Buyer";
    const parts = local.split(/\s+/).filter(Boolean);
    const firstname = parts[0] || "Sivan";
    const lastname = parts.slice(1).join(" ") || "Buyer";

    const body: Record<string, unknown> = {
      email: input.customerEmail,
      amount: input.amount,
      currency: "NGN",
      is_permanent: false,
      tx_ref: input.paymentReference,
      firstname,
      lastname,
      narration: input.paymentDescription,
    };

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/v3/virtual-account-numbers`,
        body,
        { headers: this.authHeaders(), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`Flutterwave virtual account creation failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data;
    if (response?.status !== "success" || !data?.account_number) {
      throw new Error(
        response?.message ||
        response?.error?.message ||
        "Flutterwave virtual account creation returned no account number"
      );
    }

    return {
      paymentReference: data.tx_ref || input.paymentReference,
      transactionReference: String(data.order_ref || data.flw_ref || input.paymentReference),
      accountNumber: data.account_number,
      accountName: data.account_name || "Sivan payment collection",
      bankName: data.bank_name,
      expiresAt: data.expiry_date || undefined,
      expiresInSeconds,
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
