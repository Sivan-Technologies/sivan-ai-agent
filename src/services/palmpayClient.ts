import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

export interface PalmPayBankTransferInstruction {
  paymentReference: string;
  transactionReference?: string;
  checkoutUrl?: string;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  accountId?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  raw: unknown;
}

export interface PalmPayVerifiedTransaction {
  paymentReference: string;
  transactionReference?: string;
  status: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paidAt?: string;
  processorFee?: number;
  raw: unknown;
}

export interface PalmPayTransactionListInput {
  references: string[];
}

function normalizeBase64Key(key: string, type: "PRIVATE" | "PUBLIC") {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("-----BEGIN")) return trimmed;
  const wrapped = trimmed.match(/.{1,64}/g)?.join("\n") || trimmed;
  return `-----BEGIN ${type} KEY-----\n${wrapped}\n-----END ${type} KEY-----`;
}

function md5Upper(value: string) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex").toUpperCase();
}

function isPresent(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function canonicalString(payload: Record<string, unknown>) {
  return Object.keys(payload)
    .filter((key) => key !== "sign" && isPresent(payload[key]))
    .sort()
    .map((key) => `${key}=${String(payload[key]).trim()}`)
    .join("&");
}

function extractAxiosMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = (err as any).response?.data;
    return data?.respMsg || data?.message || data?.error?.message || (err as any).message || "PalmPay request failed";
  }
  return err instanceof Error ? err.message : "PalmPay request failed";
}

function statusFromOrderStatus(orderStatus: unknown) {
  const status = Number(orderStatus);
  if (status === 2) return "success";
  if (status === 3) return "failed";
  if (status === 4) return "closed";
  if (status === 1) return "paying";
  if (status === 0) return "pending";
  return String(orderStatus || "unknown").toLowerCase();
}

export class PalmPayClient {
  private baseUrl: string;
  private appId: string;
  private merchantPrivateKey: string;
  private platformPublicKey: string;
  private timeoutMs = config.palmpay.timeoutMs;

  constructor(platformMode?: "test" | "live" | "maintenance") {
    if (platformMode === "live") {
      this.appId = config.palmpay.liveAppId || config.palmpay.appId;
      this.merchantPrivateKey = config.palmpay.liveMerchantPrivateKey || config.palmpay.merchantPrivateKey;
      this.platformPublicKey = config.palmpay.livePlatformPublicKey || config.palmpay.platformPublicKey;
      this.baseUrl = config.palmpay.liveBaseUrl.replace(/\/$/, "");
    } else if (platformMode === "test") {
      this.appId = config.palmpay.testAppId || config.palmpay.appId;
      this.merchantPrivateKey = config.palmpay.testMerchantPrivateKey || config.palmpay.merchantPrivateKey;
      this.platformPublicKey = config.palmpay.testPlatformPublicKey || config.palmpay.platformPublicKey;
      this.baseUrl = config.palmpay.baseUrl.replace(/\/$/, "");
    } else {
      this.appId = config.palmpay.appId;
      this.merchantPrivateKey = config.palmpay.merchantPrivateKey;
      this.platformPublicKey = config.palmpay.platformPublicKey;
      this.baseUrl = config.palmpay.baseUrl.replace(/\/$/, "");
    }
  }

  public isCollectionConfigured() {
    return Boolean(this.appId && this.merchantPrivateKey && this.platformPublicKey && this.baseUrl);
  }

  private requestHeaders(body: Record<string, unknown>) {
    if (!this.appId) throw new Error("PalmPay app ID is not configured");
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.appId}`,
      CountryCode: config.palmpay.countryCode,
      Signature: this.signPayload(body),
    };
  }

  public signPayload(body: Record<string, unknown>) {
    if (!this.merchantPrivateKey) throw new Error("PalmPay merchant private key is not configured");
    const digest = md5Upper(canonicalString(body));
    return crypto
      .createSign("RSA-SHA1")
      .update(digest)
      .sign(normalizeBase64Key(this.merchantPrivateKey, "PRIVATE"), "base64");
  }

  public verifyWebhookSignature(payload: Record<string, unknown>, signature: string) {
    if (!this.platformPublicKey || !signature) return false;
    try {
      const digest = md5Upper(canonicalString(payload));
      const decodedSignature = decodeURIComponent(signature);
      return crypto
        .createVerify("RSA-SHA1")
        .update(digest)
        .verify(normalizeBase64Key(this.platformPublicKey, "PUBLIC"), decodedSignature, "base64");
    } catch {
      return false;
    }
  }

  public async initializeBankTransferPayment(input: {
    amount: number;
    customerEmail: string;
    paymentReference: string;
    paymentDescription: string;
    redirectUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PalmPayBankTransferInstruction> {
    if (!this.isCollectionConfigured()) throw new Error("PalmPay collection credentials are not configured");
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    assertNairaBankTransferOnly(config.palmpay.paymentMethods, "PALMPAY_PAYMENT_METHODS");

    const amountInKobo = Math.round(input.amount * 100);
    const now = Date.now();
    const body: Record<string, unknown> = {
      requestTime: now,
      version: "V1.1",
      nonceStr: crypto.randomBytes(16).toString("hex"),
      amount: amountInKobo,
      currency: "NGN",
      notifyUrl: config.palmpay.webhookUrl,
      callBackUrl: input.redirectUrl || config.palmpay.callbackUrl || config.paystack.callbackUrl,
      orderId: input.paymentReference,
      title: "Sivan service agreement",
      description: input.paymentDescription,
      userId: input.customerEmail.slice(0, 50),
      country: "NG",
      productType: "bank_transfer",
      orderExpireTime: config.palmpay.orderExpireSeconds,
      goodsDetails: JSON.stringify([{ goodsId: input.metadata?.escrowId || input.paymentReference }]),
      remark: input.metadata?.escrowId ? `Sivan ${input.metadata.escrowId}` : "Sivan payment",
    };

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v2/payment/merchant/createorder`,
        body,
        { headers: this.requestHeaders(body), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`PalmPay bank-transfer order creation failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data || {};
    if (response?.respCode !== "00000000" || !data?.orderNo) {
      throw new Error(response?.respMsg || data?.message || "PalmPay order creation returned no order number");
    }

    const expiresInSeconds = config.palmpay.orderExpireSeconds;
    const expiresAt = new Date(now + expiresInSeconds * 1000).toISOString();
    return {
      paymentReference: input.paymentReference,
      transactionReference: String(data.orderNo),
      checkoutUrl: data.checkoutUrl,
      accountNumber: data.payerVirtualAccNo,
      accountName: data.payerAccountName,
      bankName: data.payerBankName,
      accountId: data.payerAccountId,
      expiresAt,
      expiresInSeconds,
      raw: response,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<PalmPayVerifiedTransaction> {
    if (!this.isCollectionConfigured()) throw new Error("PalmPay collection credentials are not configured");
    const body: Record<string, unknown> = {
      requestTime: Date.now(),
      version: "V1.1",
      nonceStr: crypto.randomBytes(16).toString("hex"),
      orderId: paymentReference,
    };

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v2/payment/merchant/order/queryStatus`,
        body,
        { headers: this.requestHeaders(body), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`PalmPay order verification failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data || {};
    if (response?.respCode !== "00000000" || !data?.orderId) {
      throw new Error(response?.respMsg || data?.errorMsg || "PalmPay order verification returned no order");
    }

    const amountInNaira = Number(data.amount || 0) / 100;
    return {
      paymentReference: String(data.orderId || paymentReference),
      transactionReference: data.orderNo ? String(data.orderNo) : undefined,
      status: statusFromOrderStatus(data.orderStatus),
      amount: amountInNaira,
      currency: String(data.currency || "NGN").toUpperCase(),
      paymentMethod: String(data.productType || data.payMethod || "bank_transfer").toLowerCase(),
      paidAt: data.completedTime ? new Date(Number(data.completedTime)).toISOString() : undefined,
      raw: response,
    };
  }

  public async listTransactions(input: PalmPayTransactionListInput): Promise<PalmPayVerifiedTransaction[]> {
    const references = Array.from(new Set((input.references || []).map((reference) => reference.trim()).filter(Boolean)));
    if (!references.length) return [];
    const transactions: PalmPayVerifiedTransaction[] = [];
    for (const reference of references) {
      transactions.push(await this.verifyPayment(reference));
    }
    return transactions;
  }
}
