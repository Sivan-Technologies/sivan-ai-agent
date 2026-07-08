import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { EscrowCurrency } from "./escrowStore";

export interface NombaPayoutRequest {
  merchantTxRef: string;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  amount: number;
  currency: EscrowCurrency;
  senderName?: string;
  narration?: string;
}

export interface NombaPayoutResult {
  merchantTxRef: string;
  transactionId?: string;
  status: "succeeded" | "pending" | "failed";
  amount: number;
  currency: EscrowCurrency;
  fee?: number;
  message?: string;
  raw: unknown;
}

export interface NombaBank {
  code: string;
  name: string;
  nipCode?: string | null;
  logo?: string;
}

export interface NombaAccountLookupResult {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

function extractAxiosMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = (err as any).response?.data;
    return data?.description || data?.message || data?.error?.message || (err as any).message || "Nomba request failed";
  }
  return err instanceof Error ? err.message : "Nomba request failed";
}

function normalizeTransferStatus(status: unknown): NombaPayoutResult["status"] {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "SUCCESS" || normalized === "SUCCESSFUL") return "succeeded";
  if (["NEW", "PENDING", "PENDING_BILLING", "PROCESSING", "PROCESSING_BILLING"].includes(normalized)) return "pending";
  if (["REFUND", "REFUNDED", "FAILED", "FAILURE", "REVERSED", "CANCELLED", "CANCELED"].includes(normalized)) return "failed";
  return "pending";
}

function extractToken(data: any) {
  const body = data?.data || data || {};
  return {
    accessToken: body.access_token || body.accessToken || body.token,
    refreshToken: body.refresh_token || body.refreshToken,
    expiresIn: Number(body.expires_in || body.expiresIn || 1800),
  };
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function nombaWebhookString(payload: any, timestamp: string, missingValue: "" | "undefined") {
  const data = payload?.data || {};
  const transaction = data?.transaction || data || {};
  const merchant = data?.merchant || {};
  return [
    payload?.event_type || payload?.eventType,
    payload?.requestId || payload?.request_id,
    merchant.name,
    merchant.walletId,
    transaction.transactionId || transaction.id || transaction.transactionRef,
    transaction.type,
    transaction.status,
    transaction.amount,
    transaction.fee,
    transaction.transactionAmount,
    transaction.transactionFee,
    transaction.createdAt,
    transaction.timeCreated,
    transaction.terminalId,
    transaction.merchantTxRef || transaction.meta?.merchantTxRef,
    timestamp,
  ].map((value) => {
    const defined = firstDefined(value);
    return defined === undefined ? missingValue : String(defined);
  }).join("");
}

export class NombaPayoutClient {
  private baseUrl: string;
  private clientId?: string;
  private clientSecret?: string;
  private accountId?: string;
  private timeoutMs = config.nomba.timeoutMs;
  private accessToken?: string;
  private tokenExpiresAt = 0;

  public getBaseUrl() {
    return this.baseUrl;
  }

  constructor(platformMode?: "test" | "live" | "maintenance") {
    if (platformMode === "live") {
      this.clientId = config.nomba.liveClientId || config.nomba.clientId;
      this.clientSecret = config.nomba.liveClientSecret || config.nomba.clientSecret;
      this.accountId = config.nomba.liveAccountId || config.nomba.accountId;
      this.baseUrl = config.nomba.liveBaseUrl.replace(/\/$/, "");
    } else if (platformMode === "test") {
      this.clientId = config.nomba.testClientId || config.nomba.clientId;
      this.clientSecret = config.nomba.testClientSecret || config.nomba.clientSecret;
      this.accountId = config.nomba.testAccountId || config.nomba.accountId;
      this.baseUrl = config.nomba.baseUrl.replace(/\/$/, "");
    } else {
      this.clientId = config.nomba.clientId;
      this.clientSecret = config.nomba.clientSecret;
      this.accountId = config.nomba.accountId;
      this.baseUrl = config.nomba.baseUrl.replace(/\/$/, "");
    }
  }

  public isCollectionConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.accountId);
  }

  public isPayoutConfigured() {
    return Boolean(
      config.nomba.payoutEnabled &&
      this.clientId &&
      this.clientSecret &&
      this.accountId &&
      this.baseUrl
    );
  }

  private async issueToken() {
    if (!this.clientId || !this.clientSecret || !this.accountId) {
      throw new Error("Nomba client credentials and account ID are required");
    }

    let response: any;
    try {
      const res = await axios.post(
        `${this.baseUrl}/v1/auth/token/issue`,
        {
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        {
          headers: {
            "Content-Type": "application/json",
            accountId: this.accountId,
          },
          timeout: this.timeoutMs,
        }
      );
      response = res.data;
    } catch (err) {
      throw new Error(`Nomba token issue failed: ${extractAxiosMessage(err)}`);
    }

    const token = extractToken(response);
    if (!token.accessToken) {
      throw new Error("Nomba token issue returned no access token");
    }

    this.accessToken = String(token.accessToken);
    const earlyRefreshMs = 5 * 60 * 1000;
    this.tokenExpiresAt = Date.now() + Math.max(60, token.expiresIn) * 1000 - earlyRefreshMs;
    return this.accessToken;
  }

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    return this.issueToken();
  }

  private async authHeaders() {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accountId: this.accountId,
    };
  }

  public async listBanks(): Promise<NombaBank[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/transfers/banks`, {
        headers: await this.authHeaders(),
        timeout: this.timeoutMs,
      });
      const data = res.data?.data;
      const banks = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      return banks
        .filter((bank: any) => bank?.code && bank?.name)
        .map((bank: any) => ({
          code: String(bank.code),
          name: String(bank.name),
          nipCode: bank.nipCode ?? null,
          logo: bank.logo ? String(bank.logo) : undefined,
        }));
    } catch (err) {
      throw new Error(`Nomba bank-list request failed: ${extractAxiosMessage(err)}`);
    }
  }

  public async lookupBankAccount(accountNumber: string, bankCode: string): Promise<NombaAccountLookupResult> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/v1/transfers/bank/lookup`,
        { accountNumber, bankCode },
        { headers: await this.authHeaders(), timeout: this.timeoutMs }
      );
      const data = res.data?.data || {};
      if (res.data?.code !== "00" || !data.accountName) {
        throw new Error(res.data?.description || "Nomba account lookup failed");
      }
      return {
        accountNumber: String(data.accountNumber || accountNumber),
        accountName: String(data.accountName),
        bankCode,
      };
    } catch (err) {
      throw new Error(`Nomba account lookup failed: ${extractAxiosMessage(err)}`);
    }
  }

  public async initiateBankTransfer(input: NombaPayoutRequest): Promise<NombaPayoutResult> {
    if (!this.isPayoutConfigured()) {
      throw new Error("Nomba payout is not configured/enabled");
    }
    if (input.currency !== "NAIRA") {
      throw new Error("Nomba transfer currently supports Naira payouts only");
    }

    const body = {
      amount: Math.round(input.amount * 100) / 100,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      bankCode: input.bankCode,
      merchantTxRef: input.merchantTxRef,
      senderName: input.senderName || config.nomba.senderName,
      narration: input.narration || `Sivan escrow payout ${input.merchantTxRef}`,
    };
    const path = config.nomba.subAccountId
      ? `/v2/transfers/bank/${encodeURIComponent(config.nomba.subAccountId)}`
      : "/v2/transfers/bank";

    let response: any;
    try {
      const res = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: await this.authHeaders(),
        timeout: this.timeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      response = res.data;
    } catch (err) {
      throw new Error(`Nomba bank transfer failed: ${extractAxiosMessage(err)}`);
    }

    const data = response?.data || {};
    const providerStatus = data.status || response?.status || response?.description;
    if (!data?.id && !data?.status && response?.code !== "201") {
      throw new Error(response?.description || response?.message || "Nomba bank transfer returned no transaction");
    }

    return {
      merchantTxRef: String(data?.meta?.merchantTxRef || data?.merchantTxRef || input.merchantTxRef),
      transactionId: data?.id ? String(data.id) : undefined,
      status: normalizeTransferStatus(providerStatus),
      amount: Number(data.amount || body.amount || input.amount),
      currency: "NAIRA",
      fee: data.fee === undefined ? undefined : Number(data.fee),
      message: response?.message || response?.description || data?.status,
      raw: response,
    };
  }

  public async requeryTransfer(transactionRef: string): Promise<NombaPayoutResult> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/transactions/accounts/single`, {
        headers: await this.authHeaders(),
        params: { transactionRef },
        timeout: this.timeoutMs,
      });
      const data = res.data?.data || {};
      return {
        merchantTxRef: String(data?.meta?.merchantTxRef || data?.merchantTxRef || transactionRef),
        transactionId: data?.id ? String(data.id) : transactionRef,
        status: normalizeTransferStatus(data.status),
        amount: Number(data.amount || 0),
        currency: "NAIRA",
        fee: data.fee === undefined ? undefined : Number(data.fee),
        message: res.data?.message || res.data?.description || data.status,
        raw: res.data,
      };
    } catch (err) {
      throw new Error(`Nomba transfer requery failed: ${extractAxiosMessage(err)}`);
    }
  }

  public async createCheckoutOrder(input: {
    amount: number;
    customerEmail: string;
    paymentReference: string;
    redirectUrl?: string;
  }): Promise<{ checkoutLink: string; orderReference: string; raw: any }> {
    try {
      const payload = {
        order: {
          amount: input.amount,
          currency: "NGN",
          customerEmail: input.customerEmail,
          merchantTxRef: input.paymentReference,
          allowedPaymentMethods: ["Transfer"],
          redirectUrl: input.redirectUrl || config.flutterwave.callbackUrl,
        }
      };

      const res = await axios.post(
        `${this.baseUrl}/v1/checkout/order`,
        payload,
        {
          headers: await this.authHeaders(),
          timeout: this.timeoutMs,
        }
      );

      const response = res.data;
      const data = response?.data;
      if (response?.code !== "00" || !data?.checkoutLink) {
        throw new Error(
          response?.description ||
          response?.message ||
          "Nomba checkout order creation returned no checkoutLink"
        );
      }

      return {
        checkoutLink: data.checkoutLink,
        orderReference: data.orderReference || input.paymentReference,
        raw: response,
      };
    } catch (err) {
      throw new Error(`Nomba checkout order creation failed: ${extractAxiosMessage(err)}`);
    }
  }

  public verifyWebhookSignature(rawBody: string | Buffer, receivedSignature?: string | string[], timestamp?: string | string[]) {
    const signature = Array.isArray(receivedSignature) ? receivedSignature[0] : receivedSignature;
    if (!config.nomba.webhookSecret || !signature) return false;

    const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const time = Array.isArray(timestamp) ? timestamp[0] : timestamp;
    const candidates = [body];
    if (time) {
      candidates.push(`${time}.${body}`, `${time}${body}`);
      try {
        const payload = JSON.parse(body);
        candidates.push(
          nombaWebhookString(payload, time, ""),
          nombaWebhookString(payload, time, "undefined")
        );
      } catch {
        // Keep raw-body candidates when the body is not valid JSON.
      }
    }

    return candidates.some((payload) => {
      const digest = crypto.createHmac("sha256", config.nomba.webhookSecret).update(payload, "utf8");
      const base64 = digest.digest("base64");
      const hex = crypto.createHmac("sha256", config.nomba.webhookSecret).update(payload, "utf8").digest("hex");
      return safeCompare(base64, signature) || safeCompare(hex, signature);
    });
  }
}
