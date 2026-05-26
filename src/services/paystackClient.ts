import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { log, error } from "../lib/logger";

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
  paidAt?: string;
}

export class PaystackClient {
  private baseUrl = config.paystack.baseUrl;
  private secretKey = config.paystack.secretKey;
  private receiverAccount = config.paystack.receiverAccount;

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
        metadata: { receiver: this.receiverAccount },
      },
      { headers: this.getHeaders() }
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
    return hash === signature;
  }

  public async fetchTransaction(reference: string): Promise<PaystackTransactionStatus> {
    log("Fetching Paystack transaction status", { reference });
    const response = await axios.get(`${this.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: this.getHeaders(),
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
      paidAt: data.paid_at,
    };
  }
}
