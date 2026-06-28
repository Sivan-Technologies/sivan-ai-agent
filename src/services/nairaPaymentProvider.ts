import crypto from "crypto";
import { config } from "../config";
import { FlutterwaveClient, FlutterwaveVerifiedCharge } from "./flutterwaveClient";
import { MonnifyClient, MonnifyVerifiedTransaction } from "./monnifyClient";
import { PalmPayClient, PalmPayVerifiedTransaction } from "./palmpayClient";
import { PaystackClient, PaystackTransactionStatus } from "./paystackClient";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

export type NairaPaymentProviderId = "paystack" | "monnify" | "palmpay" | "flutterwave";

export interface BankTransferPaymentRequest {
  amount: number;
  customerEmail: string;
  callbackUrl?: string;
  escrowId?: string;
  paymentReference?: string;
}

export interface BankTransferPayment {
  provider: NairaPaymentProviderId | string;
  status: "pending";
  paymentReference: string;
  transactionReference?: string;
  authorizationUrl?: string;
  accessCode?: string;
  accountNumber?: string;
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  raw?: unknown;
}

export interface VerifiedNairaPayment {
  provider: NairaPaymentProviderId | string;
  status: string;
  paymentReference: string;
  transactionReference?: string;
  amount: number;
  currency: string;
  processorFee?: number;
  channel?: string;
  paidAt?: string;
  raw?: unknown;
}

export interface NormalizedPaymentWebhook {
  provider: NairaPaymentProviderId | string;
  eventId: string;
  eventType: string;
  paymentReference: string;
  transactionReference?: string;
  raw: unknown;
}

export interface PaymentProvider {
  id: NairaPaymentProviderId | string;
  initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment>;
  verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment>;
  verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean>;
  normalizeWebhook(payload: unknown): NormalizedPaymentWebhook;
}

function mapPaystackStatus(transaction: PaystackTransactionStatus): VerifiedNairaPayment {
  return {
    provider: "paystack",
    status: transaction.status,
    paymentReference: transaction.reference,
    transactionReference: transaction.reference,
    amount: transaction.amount,
    currency: transaction.currency,
    processorFee: transaction.processorFee,
    channel: transaction.channel,
    paidAt: transaction.paidAt,
    raw: transaction,
  };
}

function normalizeMonnifyStatus(transaction: MonnifyVerifiedTransaction): string {
  if (
    transaction.paymentStatus === "PAID" &&
    transaction.currency === "NGN" &&
    transaction.paymentMethod === "ACCOUNT_TRANSFER"
  ) {
    return "success";
  }
  if (transaction.paymentStatus === "PAID" && transaction.paymentMethod !== "ACCOUNT_TRANSFER") {
    return "invalid_payment_method";
  }
  if (transaction.paymentStatus === "PAID" && transaction.currency !== "NGN") {
    return "invalid_currency";
  }
  return transaction.paymentStatus.toLowerCase() || "unknown";
}

function mapMonnifyStatus(transaction: MonnifyVerifiedTransaction): VerifiedNairaPayment {
  return {
    provider: "monnify",
    status: normalizeMonnifyStatus(transaction),
    paymentReference: transaction.paymentReference,
    transactionReference: transaction.transactionReference,
    amount: transaction.amountPaid || transaction.totalPayable,
    currency: transaction.currency,
    processorFee: transaction.processorFee,
    channel: transaction.paymentMethod,
    paidAt: transaction.paidOn,
    raw: transaction.raw,
  };
}

function normalizePalmPayStatus(transaction: PalmPayVerifiedTransaction): string {
  const isSuccess = transaction.status === "success";
  if (isSuccess && transaction.currency === "NGN" && transaction.paymentMethod === "bank_transfer") {
    return "success";
  }
  if (isSuccess && transaction.paymentMethod !== "bank_transfer") {
    return "invalid_payment_method";
  }
  if (isSuccess && transaction.currency !== "NGN") {
    return "invalid_currency";
  }
  return transaction.status || "unknown";
}

function mapPalmPayStatus(transaction: PalmPayVerifiedTransaction): VerifiedNairaPayment {
  return {
    provider: "palmpay",
    status: normalizePalmPayStatus(transaction),
    paymentReference: transaction.paymentReference,
    transactionReference: transaction.transactionReference,
    amount: transaction.amount,
    currency: transaction.currency,
    processorFee: transaction.processorFee,
    channel: transaction.paymentMethod,
    paidAt: transaction.paidAt,
    raw: transaction.raw,
  };
}

function normalizeFlutterwaveStatus(transaction: FlutterwaveVerifiedCharge): string {
  // Flutterwave v3 returns "successful" (not "succeeded") as the success status.
  const isSuccess = transaction.status === "successful";
  if (isSuccess && transaction.currency === "NGN" && transaction.paymentMethod === "bank_transfer") {
    return "success";
  }
  if (isSuccess && transaction.paymentMethod !== "bank_transfer") {
    return "invalid_payment_method";
  }
  if (isSuccess && transaction.currency !== "NGN") {
    return "invalid_currency";
  }
  return transaction.status || "unknown";
}

function mapFlutterwaveStatus(transaction: FlutterwaveVerifiedCharge): VerifiedNairaPayment {
  return {
    provider: "flutterwave",
    status: normalizeFlutterwaveStatus(transaction),
    paymentReference: transaction.paymentReference,
    transactionReference: transaction.transactionReference,
    amount: transaction.amount,
    currency: transaction.currency,
    processorFee: transaction.processorFee,
    channel: transaction.paymentMethod,
    paidAt: transaction.paidAt,
    raw: transaction.raw,
  };
}

export class PaystackPaymentProvider implements PaymentProvider {
  public readonly id = "paystack";

  constructor(private client = new PaystackClient()) {}

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    assertNairaBankTransferOnly(config.paystack.channels, "PAYSTACK_CHANNELS");
    const transaction = await this.client.initializeTransaction(
      input.amount,
      input.customerEmail,
      input.callbackUrl || config.paystack.callbackUrl
    );

    return {
      provider: this.id,
      status: "pending",
      paymentReference: transaction.reference,
      transactionReference: transaction.reference,
      authorizationUrl: transaction.authorizationUrl,
      accessCode: transaction.accessCode,
      raw: transaction,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment> {
    return mapPaystackStatus(await this.client.fetchTransaction(paymentReference));
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return this.client.verifyWebhookSignature(rawBody, signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const paymentReference = String(payload?.data?.reference || "").trim();
    const eventType = String(payload?.event || "unknown").trim();
    if (!paymentReference && (eventType === "ping" || eventType === "test" || eventType.toLowerCase().includes("ping"))) {
      return {
        provider: this.id,
        eventId: `${this.id}:${eventType}:ping`,
        eventType,
        paymentReference: "ping",
        raw: payload,
      };
    }
    if (!paymentReference) throw new Error("Paystack webhook payload is missing payment reference");
    return {
      provider: this.id,
      eventId: String(payload?.id || `${this.id}:${eventType}:${paymentReference}`),
      eventType,
      paymentReference,
      raw: payload,
    };
  }
}

export class MonnifyPaymentProvider implements PaymentProvider {
  public readonly id = "monnify";

  constructor(private client = new MonnifyClient()) {}

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = input.paymentReference || `monnify-${input.escrowId || crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan escrow ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.monnify.webhookUrl || config.paystack.callbackUrl,
      metadata: {
        escrowId: input.escrowId,
        provider: this.id,
        paymentMethod: "ACCOUNT_TRANSFER",
      },
    });
    return {
      provider: this.id,
      status: "pending",
      paymentReference: instruction.paymentReference,
      transactionReference: instruction.transactionReference,
      authorizationUrl: instruction.checkoutUrl,
      accountNumber: instruction.accountNumber,
      accountName: instruction.accountName,
      bankName: instruction.bankName,
      bankCode: instruction.bankCode,
      expiresAt: instruction.expiresAt,
      expiresInSeconds: instruction.expiresInSeconds,
      raw: instruction.raw,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment> {
    return mapMonnifyStatus(await this.client.verifyPayment(paymentReference));
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return this.client.verifyWebhookSignature(rawBody, signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const eventType = String(payload?.eventType || "unknown").trim();
    const data = payload?.eventData || {};
    const paymentReference = String(
      data.paymentReference ||
      data.product?.reference ||
      data.reference ||
      ""
    ).trim();
    const transactionReference = String(data.transactionReference || "").trim();
    if (!paymentReference && (eventType === "ping" || eventType === "test" || eventType.toLowerCase().includes("ping"))) {
      return {
        provider: this.id,
        eventId: `${this.id}:${eventType}:ping`,
        eventType,
        paymentReference: "ping",
        raw: payload,
      };
    }
    if (!paymentReference) throw new Error("Monnify webhook payload is missing payment reference");
    return {
      provider: this.id,
      eventId: `${this.id}:${eventType}:${paymentReference}:${transactionReference || "none"}`,
      eventType,
      paymentReference,
      raw: payload,
    };
  }
}

function palmPayOrderId(escrowId?: string) {
  const cleanEscrowId = String(escrowId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12)
    .toUpperCase();
  return `PP${cleanEscrowId}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 32);
}

export class PalmPayPaymentProvider implements PaymentProvider {
  public readonly id = "palmpay";

  constructor(private client = new PalmPayClient()) {}

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = palmPayOrderId(input.escrowId);
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan service agreement ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.palmpay.callbackUrl || config.paystack.callbackUrl,
      metadata: {
        escrowId: input.escrowId,
        provider: this.id,
        paymentMethod: "bank_transfer",
      },
    });
    return {
      provider: this.id,
      status: "pending",
      paymentReference: instruction.paymentReference,
      transactionReference: instruction.transactionReference,
      authorizationUrl: instruction.checkoutUrl,
      accountNumber: instruction.accountNumber,
      accountName: instruction.accountName,
      bankName: instruction.bankName,
      expiresAt: instruction.expiresAt,
      expiresInSeconds: instruction.expiresInSeconds,
      raw: instruction.raw,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment> {
    return mapPalmPayStatus(await this.client.verifyPayment(paymentReference));
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    if (!signature) return false;
    try {
      const payload = JSON.parse(rawBody || "{}");
      return this.client.verifyWebhookSignature(payload, signature);
    } catch {
      return false;
    }
  }

  public verifyWebhookPayload(payload: Record<string, unknown>, signature: string): boolean {
    return this.client.verifyWebhookSignature(payload, signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const eventType = String(payload?.orderStatus !== undefined ? `order.${payload.orderStatus}` : payload?.eventType || "payment_result").trim();
    const paymentReference = String(payload?.orderId || "").trim();
    const transactionReference = String(payload?.orderNo || "").trim();
    if (!paymentReference) throw new Error("PalmPay webhook payload is missing payment reference");
    return {
      provider: this.id,
      eventId: `${this.id}:${eventType}:${paymentReference}:${transactionReference || "none"}`,
      eventType,
      paymentReference,
      transactionReference: transactionReference || undefined,
      raw: payload,
    };
  }
}

export class FlutterwavePaymentProvider implements PaymentProvider {
  public readonly id = "flutterwave";

  constructor(private client = new FlutterwaveClient()) {}

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = input.paymentReference || `flutterwave-${input.escrowId || crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan service agreement ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.flutterwave.webhookUrl || config.paystack.callbackUrl,
      metadata: {
        escrowId: input.escrowId,
        provider: this.id,
        paymentMethod: "bank_transfer",
      },
    });
    return {
      provider: this.id,
      status: "pending",
      paymentReference: instruction.paymentReference,
      transactionReference: instruction.transactionReference,
      authorizationUrl: instruction.authorizationUrl,
      accountNumber: instruction.accountNumber,
      accountName: instruction.accountName,
      bankName: instruction.bankName,
      expiresAt: instruction.expiresAt,
      expiresInSeconds: instruction.expiresInSeconds,
      raw: instruction.raw,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment> {
    const transaction = paymentReference.startsWith("chg_")
      ? await this.client.verifyChargeById(paymentReference)
      : await this.client.verifyPayment(paymentReference);
    return mapFlutterwaveStatus(transaction);
  }

  public async verifyWebhookSignature(_rawBody: string, signature: string): Promise<boolean> {
    return this.client.verifyWebhookSignature(signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const eventType = String(payload?.type || payload?.event || payload?.["event.type"] || "unknown").trim();
    const data = payload?.data || {};
    const paymentReference = String(
      data.tx_ref ||
      data.txRef ||
      data.reference ||
      payload?.tx_ref ||
      payload?.txRef ||
      payload?.reference ||
      ""
    ).trim();
    const chargeId = String(data.id || payload?.id || "").trim();
    if (!paymentReference) {
      throw new Error("Flutterwave webhook payload is missing payment reference");
    }
    return {
      provider: this.id,
      eventId: String(payload?.webhook_id || `${this.id}:${eventType}:${paymentReference}:${chargeId || "none"}`),
      eventType,
      paymentReference,
      transactionReference: chargeId || undefined,
      raw: payload,
    };
  }
}

export function createNairaPaymentProvider(provider = process.env.ACTIVE_PAYMENT_PROVIDER || "paystack"): PaymentProvider {
  const normalized = provider.trim().toLowerCase();
  if (!normalized || normalized === "paystack") return new PaystackPaymentProvider();
  if (normalized === "monnify") return new MonnifyPaymentProvider();
  if (normalized === "palmpay") return new PalmPayPaymentProvider();
  if (normalized === "flutterwave") return new FlutterwavePaymentProvider();
  throw new Error(`Naira payment provider is not implemented yet: ${provider}`);
}
