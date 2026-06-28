import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { log } from "../lib/logger";
import { PaystackAccountResolution } from "./paystackClient";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

export interface MonnifyBankTransferInstruction {
  paymentReference: string;
  transactionReference: string;
  checkoutUrl?: string;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  raw: unknown;
}

export interface MonnifyVerifiedTransaction {
  paymentReference: string;
  transactionReference?: string;
  paymentStatus: string;
  amountPaid: number;
  totalPayable: number;
  currency: string;
  paymentMethod: string;
  processorFee?: number;
  paidOn?: string;
  settlementAmount?: number;
  raw: unknown;
}

export class MonnifyClient {
  private baseUrl: string;
  private apiKey: string;
  private secretKey: string;
  private contractCode: string;
  private timeoutMs = config.monnify.timeoutMs;
  private cachedToken = "";
  private tokenExpiresAt = 0;

  constructor(platformMode?: "test" | "live" | "maintenance") {
    if (platformMode === "live") {
      this.apiKey = config.monnify.liveApiKey || config.monnify.apiKey;
      this.secretKey = config.monnify.liveSecretKey || config.monnify.secretKey;
      this.contractCode = config.monnify.liveContractCode || config.monnify.contractCode;
      this.baseUrl = config.monnify.liveBaseUrl;
    } else if (platformMode === "test") {
      this.apiKey = config.monnify.testApiKey || config.monnify.apiKey;
      this.secretKey = config.monnify.testSecretKey || config.monnify.secretKey;
      this.contractCode = config.monnify.testContractCode || config.monnify.contractCode;
      this.baseUrl = config.monnify.baseUrl;
    } else {
      this.apiKey = config.monnify.apiKey;
      this.secretKey = config.monnify.secretKey;
      this.contractCode = config.monnify.contractCode;
      this.baseUrl = config.monnify.baseUrl;
    }
  }

  public isConfigured() {
    return Boolean(this.apiKey && this.secretKey);
  }

  private async getAccessToken() {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60_000) return this.cachedToken;
    if (!this.isConfigured()) throw new Error("Monnify credentials are not configured");

    const credentials = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString("base64");
    const response = await axios.post(
      `${this.baseUrl}/api/v1/auth/login`,
      {},
      { headers: { Authorization: `Basic ${credentials}` }, timeout: this.timeoutMs }
    );

    const token = response.data?.responseBody?.accessToken;
    if (!response.data?.requestSuccessful || !token) {
      throw new Error("Unable to authenticate with Monnify");
    }

    this.cachedToken = token;
    this.tokenExpiresAt = Date.now() + Number(response.data.responseBody.expiresIn || 300) * 1000;
    return this.cachedToken;
  }

  private async authorizedHeaders() {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  public isCollectionConfigured() {
    return Boolean(this.apiKey && this.secretKey && this.contractCode);
  }

  public verifyWebhookSignature(rawBody: string, signature: string) {
    if (!this.secretKey || !signature) return false;
    const computed = crypto.createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    const left = Buffer.from(computed);
    const right = Buffer.from(signature);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  public async initializeBankTransferPayment(input: {
    amount: number;
    customerEmail: string;
    paymentReference: string;
    paymentDescription: string;
    redirectUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MonnifyBankTransferInstruction> {
    if (!this.isCollectionConfigured()) throw new Error("Monnify collection credentials are not configured");
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    assertNairaBankTransferOnly(config.monnify.paymentMethods, "MONNIFY_PAYMENT_METHODS");

    const headers = { ...(await this.authorizedHeaders()), "Content-Type": "application/json" };
    const initResponse = await axios.post(
      `${this.baseUrl}/api/v1/merchant/transactions/init-transaction`,
      {
        amount: input.amount,
        customerEmail: input.customerEmail,
        paymentReference: input.paymentReference,
        paymentDescription: input.paymentDescription,
        currencyCode: "NGN",
        contractCode: this.contractCode,
        redirectUrl: input.redirectUrl || config.monnify.webhookUrl || config.paystack.callbackUrl,
        paymentMethods: ["ACCOUNT_TRANSFER"],
        metadata: input.metadata || {},
      },
      { headers, timeout: this.timeoutMs }
    );
    const initBody = initResponse.data?.responseBody;
    if (!initResponse.data?.requestSuccessful || !initBody?.transactionReference || !initBody?.paymentReference) {
      throw new Error(initResponse.data?.responseMessage || "Unable to initialize Monnify transaction");
    }

    const transferResponse = await axios.post(
      `${this.baseUrl}/api/v1/merchant/bank-transfer/init-payment`,
      { transactionReference: initBody.transactionReference },
      { headers, timeout: this.timeoutMs }
    );
    const transferBody = transferResponse.data?.responseBody || {};
    if (!transferResponse.data?.requestSuccessful) {
      throw new Error(transferResponse.data?.responseMessage || "Unable to initialize Monnify bank transfer payment");
    }

    const expiresInSeconds = Number(transferBody.expiresIn || transferBody.expiresInSeconds || transferBody.accountDurationSeconds || 2400);
    const expiresAt = transferBody.expiryTime || transferBody.expiresAt || new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return {
      paymentReference: initBody.paymentReference,
      transactionReference: initBody.transactionReference,
      checkoutUrl: initBody.checkoutUrl,
      accountNumber: transferBody.accountNumber || transferBody.account?.accountNumber,
      accountName: transferBody.accountName || transferBody.account?.accountName,
      bankName: transferBody.bankName || transferBody.account?.bankName,
      bankCode: transferBody.bankCode || transferBody.account?.bankCode,
      expiresAt,
      expiresInSeconds,
      raw: { init: initResponse.data, transfer: transferResponse.data },
    };
  }

  public async verifyPayment(paymentReference: string): Promise<MonnifyVerifiedTransaction> {
    const response = await axios.get(`${this.baseUrl}/api/v2/merchant/transactions/query`, {
      headers: await this.authorizedHeaders(),
      params: { paymentReference },
      timeout: this.timeoutMs,
    });
    const body = response.data?.responseBody;
    if (!response.data?.requestSuccessful || !body) {
      throw new Error(response.data?.responseMessage || "Unable to verify Monnify transaction");
    }
    return {
      paymentReference: body.paymentReference || paymentReference,
      transactionReference: body.transactionReference,
      paymentStatus: String(body.paymentStatus || body.status || "").toUpperCase(),
      amountPaid: Number(body.amountPaid ?? 0),
      totalPayable: Number(body.totalPayable ?? body.amount ?? 0),
      currency: String(body.currencyCode || body.currency || "NGN").toUpperCase(),
      paymentMethod: String(body.paymentMethod || "").toUpperCase(),
      processorFee: body.fee == null && body.totalFee == null ? undefined : Number(body.fee ?? body.totalFee),
      paidOn: body.paidOn || body.completedOn,
      settlementAmount: body.settlementAmount == null ? undefined : Number(body.settlementAmount),
      raw: response.data,
    };
  }

  public async validateBankAccount(accountNumber: string, bankCode: string): Promise<PaystackAccountResolution> {
    log("Resolving bank account with Monnify name enquiry", { accountNumber, bankCode });
    const response = await axios.get(`${this.baseUrl}/api/v1/disbursements/account/validate`, {
      headers: await this.authorizedHeaders(),
      params: { accountNumber, bankCode },
      timeout: this.timeoutMs,
    });

    const body = response.data?.responseBody;
    if (!response.data?.requestSuccessful || !body?.accountName) {
      throw new Error(response.data?.responseMessage || "Unable to verify bank account with Monnify");
    }

    return {
      accountNumber: body.accountNumber || accountNumber,
      accountName: body.accountName,
      bankCode: body.bankCode || bankCode,
    };
  }
}
