import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

export interface FlutterwaveVirtualAccountInstruction {
  paymentReference: string;
  transactionReference: string;
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

function splitCustomerName(email: string) {
  const local = email.split("@")[0]?.replace(/[^a-zA-Z0-9]+/g, " ").trim() || "Sivan Buyer";
  const parts = local.split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || "Sivan",
    last: parts.slice(1).join(" ") || "Buyer",
  };
}

function totalFees(fees: any) {
  if (!Array.isArray(fees)) return undefined;
  const total = fees.reduce((sum, fee) => sum + Number(fee?.amount || 0), 0);
  return Number.isFinite(total) ? total : undefined;
}

export class FlutterwaveClient {
  private baseUrl = config.flutterwave.baseUrl.replace(/\/$/, "");
  private secretKey = config.flutterwave.secretKey;
  private webhookSecret = config.flutterwave.webhookSecret;
  private timeoutMs = config.flutterwave.timeoutMs;

  public isCollectionConfigured() {
    return Boolean(this.secretKey && this.baseUrl);
  }

  public verifyWebhookSignature(signature: string) {
    if (!this.webhookSecret || !signature) return false;
    const left = Buffer.from(this.webhookSecret);
    const right = Buffer.from(signature);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private headers(idempotencyKey?: string) {
    if (!this.secretKey) throw new Error("Flutterwave secret key is not configured");
    return {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
    };
  }

  public async initializeBankTransferPayment(input: {
    amount: number;
    customerEmail: string;
    paymentReference: string;
    paymentDescription: string;
    metadata?: Record<string, unknown>;
  }): Promise<FlutterwaveVirtualAccountInstruction> {
    if (!this.isCollectionConfigured()) throw new Error("Flutterwave collection credentials are not configured");
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    assertNairaBankTransferOnly(config.flutterwave.paymentMethods, "FLUTTERWAVE_PAYMENT_METHODS");

    const customerName = splitCustomerName(input.customerEmail);
    const customerIdempotencyKey = `${input.paymentReference}:customer`;
    const customerResponse = await axios.post(
      `${this.baseUrl}/customers`,
      {
        name: customerName,
        email: input.customerEmail,
        meta: input.metadata || {},
      },
      { headers: this.headers(customerIdempotencyKey), timeout: this.timeoutMs }
    );
    const customer = customerResponse.data?.data;
    if (customerResponse.data?.status !== "success" || !customer?.id) {
      throw new Error(customerResponse.data?.message || customerResponse.data?.error?.message || "Unable to create Flutterwave customer");
    }

    const expiresInSeconds = config.flutterwave.dynamicAccountExpirySeconds;
    const virtualAccountResponse = await axios.post(
      `${this.baseUrl}/virtual-accounts`,
      {
        reference: input.paymentReference,
        customer_id: customer.id,
        expiry: expiresInSeconds,
        amount: input.amount,
        currency: "NGN",
        account_type: "dynamic",
        narration: input.paymentDescription,
        meta: input.metadata || {},
      },
      { headers: this.headers(`${input.paymentReference}:virtual-account`), timeout: this.timeoutMs }
    );
    const account = virtualAccountResponse.data?.data;
    if (virtualAccountResponse.data?.status !== "success" || !account?.reference || !account?.id) {
      throw new Error(virtualAccountResponse.data?.message || virtualAccountResponse.data?.error?.message || "Unable to create Flutterwave virtual account");
    }

    return {
      paymentReference: account.reference || input.paymentReference,
      transactionReference: account.id,
      accountNumber: account.account_number,
      accountName: account.note || account.account_display_name || "Sivan escrow",
      bankName: account.account_bank_name,
      expiresAt: account.account_expiration_datetime,
      expiresInSeconds,
      raw: {
        customer: customerResponse.data,
        virtualAccount: virtualAccountResponse.data,
      },
    };
  }

  public async verifyChargeById(chargeId: string): Promise<FlutterwaveVerifiedCharge> {
    const response = await axios.get(`${this.baseUrl}/charges/${encodeURIComponent(chargeId)}`, {
      headers: this.headers(),
      timeout: this.timeoutMs,
    });
    return this.mapChargeResponse(response.data, chargeId);
  }

  public async verifyPayment(paymentReference: string): Promise<FlutterwaveVerifiedCharge> {
    const response = await axios.get(`${this.baseUrl}/charges`, {
      headers: this.headers(),
      params: { reference: paymentReference },
      timeout: this.timeoutMs,
    });
    const charges = response.data?.data;
    const charge = Array.isArray(charges)
      ? charges.find((item) => String(item?.reference || "").trim() === paymentReference) || charges[0]
      : charges;
    if (response.data?.status !== "success" || !charge) {
      throw new Error(response.data?.message || response.data?.error?.message || "Unable to verify Flutterwave charge by reference");
    }
    return this.mapCharge(charge, response.data);
  }

  private mapChargeResponse(response: any, fallbackReference: string): FlutterwaveVerifiedCharge {
    if (response?.status !== "success" || !response?.data) {
      throw new Error(response?.message || response?.error?.message || "Unable to verify Flutterwave charge");
    }
    return this.mapCharge(response.data, response, fallbackReference);
  }

  private mapCharge(charge: any, raw: any, fallbackReference = ""): FlutterwaveVerifiedCharge {
    return {
      paymentReference: String(charge.reference || fallbackReference).trim(),
      transactionReference: String(charge.id || "").trim() || undefined,
      status: String(charge.status || "").toLowerCase(),
      amount: Number(charge.amount || 0),
      currency: String(charge.currency || "").toUpperCase(),
      paymentMethod: String(charge.payment_method_details?.type || charge.payment_method?.type || "").toLowerCase(),
      processorFee: totalFees(charge.fees),
      paidAt: charge.created_datetime,
      customerId: charge.customer_id || charge.customer?.id,
      raw,
    };
  }
}
