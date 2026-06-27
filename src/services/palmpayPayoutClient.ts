import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { EscrowCurrency } from "./escrowStore";

export interface PalmPayPayoutRequest {
  orderId: string;
  payeeName: string;
  payeeBankCode: string;
  payeeBankAccNo: string;
  amount: number;
  currency: EscrowCurrency;
  remark?: string;
}

export interface PalmPayPayoutResult {
  orderId: string;
  orderNo?: string;
  status: "succeeded" | "pending" | "failed";
  amount: number;
  currency: EscrowCurrency;
  fee?: number;
  sessionId?: string;
  message?: string;
  raw: unknown;
}

export interface PalmPayPayoutWebhook {
  eventId: string;
  orderId: string;
  orderNo?: string;
  status: PalmPayPayoutResult["status"];
  eventType: string;
  raw: unknown;
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
    return data?.respMsg || data?.message || data?.error?.message || (err as any).message || "PalmPay payout request failed";
  }
  return err instanceof Error ? err.message : "PalmPay payout request failed";
}

function payoutStatusFromOrderStatus(orderStatus: unknown): PalmPayPayoutResult["status"] {
  const status = Number(orderStatus);
  if (status === 2) return "succeeded";
  if (status === 3 || status === 4) return "failed";
  return "pending";
}

export class PalmPayPayoutClient {
  private baseUrl = config.palmpay.baseUrl.replace(/\/$/, "");
  private appId = config.palmpay.appId;
  private merchantPrivateKey = config.palmpay.merchantPrivateKey;
  private platformPublicKey = config.palmpay.platformPublicKey;
  private timeoutMs = config.palmpay.timeoutMs;

  public isPayoutConfigured() {
    return Boolean(config.palmpay.payoutEnabled && this.appId && this.merchantPrivateKey && this.baseUrl);
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

  public async initiatePayout(input: PalmPayPayoutRequest): Promise<PalmPayPayoutResult> {
    if (!this.isPayoutConfigured()) {
      throw new Error("PalmPay payout is not configured/enabled");
    }
    if (input.currency !== "NAIRA") {
      throw new Error("PalmPay payout currently supports Naira payouts only");
    }

    const body: Record<string, unknown> = {
      requestTime: Date.now(),
      version: "V1.1",
      nonceStr: crypto.randomBytes(16).toString("hex"),
      orderId: input.orderId,
      payeeName: input.payeeName,
      payeeBankCode: input.payeeBankCode,
      payeeBankAccNo: input.payeeBankAccNo,
      amount: Math.round(input.amount * 100),
      currency: "NGN",
      notifyUrl: config.palmpay.payoutNotifyUrl,
      remark: input.remark || "Sivan escrow payout",
    };

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v2/merchant/payment/payout`,
        body,
        { headers: this.requestHeaders(body), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`PalmPay payout initiation failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data || {};
    if (response?.respCode !== "00000000" || !data?.orderId) {
      throw new Error(response?.respMsg || data?.errorMsg || "PalmPay payout initiation returned no order");
    }

    return {
      orderId: String(data.orderId || input.orderId),
      orderNo: data.orderNo ? String(data.orderNo) : undefined,
      status: payoutStatusFromOrderStatus(data.orderStatus),
      amount: Number(data.amount || body.amount || 0) / 100,
      currency: "NAIRA",
      fee: data.fee?.fee === undefined ? undefined : Number(data.fee.fee) / 100,
      sessionId: data.sessionId ? String(data.sessionId) : undefined,
      message: data.message || data.errorMsg || response?.respMsg,
      raw: response,
    };
  }

  public async queryPayoutStatus(orderIdOrNo: { orderId?: string; orderNo?: string }): Promise<PalmPayPayoutResult> {
    if (!this.isPayoutConfigured()) {
      throw new Error("PalmPay payout is not configured/enabled");
    }
    const body: Record<string, unknown> = {
      requestTime: Date.now(),
      version: "V1.1",
      nonceStr: crypto.randomBytes(16).toString("hex"),
    };
    if (orderIdOrNo.orderId) body.orderId = orderIdOrNo.orderId;
    if (orderIdOrNo.orderNo) body.orderNo = orderIdOrNo.orderNo;
    if (!body.orderId && !body.orderNo) throw new Error("PalmPay payout query requires orderId or orderNo");

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/api/v2/merchant/payment/queryPayStatus`,
        body,
        { headers: this.requestHeaders(body), timeout: this.timeoutMs }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`PalmPay payout query failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data || {};
    if (response?.respCode !== "00000000" || (!data?.orderId && !data?.orderNo)) {
      throw new Error(response?.respMsg || data?.errorMsg || "PalmPay payout query returned no order");
    }

    return {
      orderId: String(data.orderId || orderIdOrNo.orderId || ""),
      orderNo: data.orderNo ? String(data.orderNo) : undefined,
      status: payoutStatusFromOrderStatus(data.orderStatus),
      amount: Number(data.amount || 0) / 100,
      currency: "NAIRA",
      fee: data.fee?.fee === undefined ? undefined : Number(data.fee.fee) / 100,
      sessionId: data.sessionId ? String(data.sessionId) : undefined,
      message: data.message || data.errorMsg || response?.respMsg,
      raw: response,
    };
  }

  public normalizeWebhook(payload: any): PalmPayPayoutWebhook {
    const orderId = String(payload?.orderId || "").trim();
    const orderNo = String(payload?.orderNo || "").trim();
    if (!orderId && !orderNo) throw new Error("PalmPay payout webhook is missing orderId/orderNo");
    const eventType = `payout.order.${payload?.orderStatus ?? "unknown"}`;
    return {
      eventId: `palmpay:${eventType}:${orderId || "none"}:${orderNo || "none"}`,
      orderId,
      orderNo: orderNo || undefined,
      status: payoutStatusFromOrderStatus(payload?.orderStatus),
      eventType,
      raw: payload,
    };
  }
}
