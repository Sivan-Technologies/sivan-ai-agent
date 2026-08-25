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

export interface PaystackTransferRecipient {
  recipientCode: string;
  recipientId: number;
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
}

export interface PaystackTransferResult {
  transferCode: string;
  reference: string;
  status: "success" | "pending" | "failed" | "otp" | "reversed" | string;
  amount: number;
  recipientCode: string;
  reason?: string;
  createdAt?: string;
}

export class PaystackClient {
  private baseUrl = config.paystack.baseUrl;
  private secretKey = config.paystack.secretKey;
  private webhookSecret = config.paystack.webhookSecret || config.paystack.secretKey;
  private receiverAccount = config.paystack.receiverAccount;
  private channels = config.paystack.channels;
  private timeoutMs = config.paystack.timeoutMs;

  public isCollectionConfigured() {
    return Boolean(this.secretKey);
  }

  public isTransferConfigured() {
    return Boolean(this.secretKey) && config.paystack.transferEnabled;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      "Content-Type": "application/json",
    };
  }

  public async initializeTransaction(amount: number, email: string, callbackUrl: string): Promise<PaystackTransaction> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to initialize a Paystack transaction");
    }

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
    if (!signature) return false;
    log("Verifying Paystack webhook signature");
    const secrets = [this.webhookSecret, this.secretKey].filter((secret, index, list): secret is string =>
      Boolean(secret) && list.indexOf(secret) === index
    );
    const provided = Buffer.from(signature, "hex");
    return secrets.some((secret) => {
      const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
      const expected = Buffer.from(hash, "hex");
      return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    });
  }

  public async fetchTransaction(reference: string): Promise<PaystackTransactionStatus> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to verify a Paystack transaction");
    }

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
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to resolve Paystack bank accounts");
    }

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

  /**
   * Creates (or retrieves an existing) Paystack transfer recipient for a bank account.
   * The returned recipientCode must be cached on the payout account (providerRecipientCode)
   * so it is reused on future payouts to the same seller.
   */
  public async createTransferRecipient(
    accountNumber: string,
    bankCode: string,
    accountName: string,
    currency = "NGN"
  ): Promise<PaystackTransferRecipient> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to create a Paystack transfer recipient");
    }

    log("Creating Paystack transfer recipient", { accountNumber, bankCode });
    const response = await axios.post(
      `${this.baseUrl}/transferrecipient`,
      {
        type: "nuban",
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency,
      },
      { headers: this.getHeaders(), timeout: this.timeoutMs }
    );

    if (!response.data?.status || !response.data.data?.recipient_code) {
      throw new Error("Invalid Paystack transfer recipient response");
    }

    const d = response.data.data;
    return {
      recipientCode: d.recipient_code,
      recipientId: d.id,
      accountNumber: d.details?.account_number || accountNumber,
      accountName: d.details?.account_name || accountName,
      bankCode: d.details?.bank_code || bankCode,
      bankName: d.details?.bank_name || "",
    };
  }

  /**
   * Initiates a single transfer to a registered recipient.
   * Paystack transfers are asynchronous — status arrives via `transfer.success` or `transfer.failed` webhook.
   */
  public async initiateTransfer(
    amountNgn: number,
    recipientCode: string,
    reference: string,
    reason?: string
  ): Promise<PaystackTransferResult> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to initiate a Paystack transfer");
    }

    log("Initiating Paystack transfer", { amountNgn, recipientCode, reference });
    const response = await axios.post(
      `${this.baseUrl}/transfer`,
      {
        source: "balance",
        amount: Math.round(amountNgn * 100),
        recipient: recipientCode,
        reference,
        reason: reason || "Sivan service agreement payout",
      },
      { headers: this.getHeaders(), timeout: this.timeoutMs }
    );

    if (!response.data?.status || !response.data.data) {
      throw new Error("Invalid Paystack transfer initiation response");
    }

    const d = response.data.data;
    return {
      transferCode: d.transfer_code,
      reference: d.reference || reference,
      status: d.status,
      amount: d.amount / 100,
      recipientCode: d.recipient?.recipient_code || recipientCode,
      reason: d.reason,
      createdAt: d.created_at,
    };
  }

  /**
   * Verifies the final status of a transfer by its reference.
   * Use this to reconcile a transfer whose webhook was missed.
   */
  public async verifyTransfer(reference: string): Promise<PaystackTransferResult> {
    if (!this.secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is required to verify a Paystack transfer");
    }

    log("Verifying Paystack transfer", { reference });
    const response = await axios.get(
      `${this.baseUrl}/transfer/verify/${encodeURIComponent(reference)}`,
      { headers: this.getHeaders(), timeout: this.timeoutMs }
    );

    if (!response.data?.status || !response.data.data) {
      throw new Error("Invalid Paystack transfer verification response");
    }

    const d = response.data.data;
    return {
      transferCode: d.transfer_code,
      reference: d.reference || reference,
      status: d.status,
      amount: d.amount / 100,
      recipientCode: d.recipient?.recipient_code || "",
      reason: d.reason,
      createdAt: d.created_at,
    };
  }
}
