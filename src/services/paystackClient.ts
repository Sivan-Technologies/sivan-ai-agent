import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { log, warn } from "../lib/logger";
import { NIGERIA_BANK_FALLBACKS } from "./bankFallback";

export interface PaystackTransaction {
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}

export interface PaystackTransactionStatus {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  processorFee?: number;
  channel?: string;
  paidAt?: string;
}

export interface PaystackBank {
  name: string;
  code: string;
  slug?: string;
}

export interface PaystackAccountResolution {
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export class PaystackClient {
  private baseUrl = config.paystack.baseUrl;
  private secretKey = config.paystack.secretKey;
  private receiverAccount = config.paystack.receiverAccount;
  private channels = config.paystack.channels;
  private timeoutMs = config.paystack.timeoutMs;

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/json",
    };
  }

  public async initializeTransaction(amount: number, email: string, callbackUrl: string): Promise<PaystackTransaction> {
    log("Initializing Paystack transaction", { amount, email });

    const response = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      {
        email,
        amount: Math.round(amount * 100),
        currency: "NGN",
        callback_url: callbackUrl,
        channels: this.channels,
        metadata: { receiver: this.receiverAccount },
      },
      { headers: this.getHeaders(), timeout: this.timeoutMs }
    );

    if (!response.data || !response.data.status) {
      throw new Error("Invalid Paystack initialize response");
    }

    return {
      authorizationUrl: response.data.data.authorization_url,
      reference: response.data.data.reference,
      accessCode: response.data.data.access_code,
    };
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    log("Verifying Paystack webhook signature");
    const hash = crypto.createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const expected = Buffer.from(hash, "hex");
    const provided = Buffer.from(signature, "hex");
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  }

  public async fetchTransaction(reference: string): Promise<PaystackTransactionStatus> {
    log("Fetching Paystack transaction status", { reference });
    const response = await axios.get(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: this.getHeaders(),
      timeout: this.timeoutMs,
    });

    if (!response.data || !response.data.status) {
      throw new Error("Invalid Paystack transaction verification response");
    }

    const data = response.data.data;
    return {
      status: data.status,
      reference: data.reference,
      amount: data.amount / 100,
      currency: data.currency,
      processorFee: typeof data.fees === "number" ? data.fees / 100 : undefined,
      channel: data.channel,
      paidAt: data.paid_at,
    };
  }

  public async listBanks(): Promise<PaystackBank[]> {
    log("Fetching Paystack bank list");
    if (!this.secretKey) return NIGERIA_BANK_FALLBACKS;

    try {
      const response = await axios.get(`${this.baseUrl}/bank?country=nigeria&perPage=100`, {
        headers: this.getHeaders(),
        timeout: this.timeoutMs,
      });

      if (!response.data || !response.data.status || !Array.isArray(response.data.data)) {
        throw new Error("Invalid Paystack bank list response");
      }

      return response.data.data.map((bank: any) => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug,
      }));
    } catch (err: any) {
      warn("Paystack bank list unavailable; using fallback bank list", {
        status: err?.response?.status,
        message: err?.message || "unknown error",
      });
      return NIGERIA_BANK_FALLBACKS;
    }
  }

  public async resolveBankAccount(accountNumber: string, bankCode: string): Promise<PaystackAccountResolution> {
    log("Resolving Paystack bank account", { accountNumber, bankCode });
    const response = await axios.get(
      `${this.baseUrl}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      { headers: this.getHeaders(), timeout: this.timeoutMs }
    );

    if (!response.data || !response.data.status || !response.data.data?.account_name) {
      throw new Error("Unable to verify bank account with Paystack");
    }

    return {
      accountNumber: response.data.data.account_number,
      accountName: response.data.data.account_name,
      bankCode,
    };
  }
}
