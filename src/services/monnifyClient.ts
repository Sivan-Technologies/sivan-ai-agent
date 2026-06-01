import axios from "axios";
import { config } from "../config";
import { log } from "../lib/logger";
import { PaystackAccountResolution } from "./paystackClient";

export class MonnifyClient {
  private baseUrl = config.monnify.baseUrl;
  private apiKey = config.monnify.apiKey;
  private secretKey = config.monnify.secretKey;
  private cachedToken = "";
  private tokenExpiresAt = 0;

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
      { headers: { Authorization: `Basic ${credentials}` } }
    );

    const token = response.data?.responseBody?.accessToken;
    if (!response.data?.requestSuccessful || !token) {
      throw new Error("Unable to authenticate with Monnify");
    }

    this.cachedToken = token;
    this.tokenExpiresAt = Date.now() + Number(response.data.responseBody.expiresIn || 300) * 1000;
    return this.cachedToken;
  }

  public async validateBankAccount(accountNumber: string, bankCode: string): Promise<PaystackAccountResolution> {
    log("Resolving bank account with Monnify name enquiry", { accountNumber, bankCode });
    const token = await this.getAccessToken();
    const response = await axios.get(`${this.baseUrl}/api/v1/disbursements/account/validate`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { accountNumber, bankCode },
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
