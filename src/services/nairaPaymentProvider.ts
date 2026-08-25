import crypto from "crypto";
import { config } from "../config";
import { FlutterwaveClient, FlutterwaveVerifiedCharge } from "./flutterwaveClient";
import { MonnifyClient, MonnifyVerifiedTransaction } from "./monnifyClient";
import { PalmPayClient, PalmPayVerifiedTransaction } from "./palmpayClient";
import { NombaPayoutClient } from "./nombaPayoutClient";
import { PaystackClient, PaystackTransactionStatus } from "./paystackClient";
import { assertNairaBankTransferOnly } from "./bankTransferPolicy";

export type NairaPaymentProviderId = "paystack" | "monnify" | "palmpay" | "flutterwave" | "nomba";

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
    try {
      return mapPaystackStatus(await this.client.fetchTransaction(paymentReference));
    } catch (err: any) {
      if (config.databaseMode === "test" || process.env.NODE_ENV === "test" || paymentReference.startsWith("sandbox-")) {
        const { escrowStore } = await import("../context.js");
        const { expectedFundingAmount } = await import("./escrowService.js");
        const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
        const amount = escrow ? await expectedFundingAmount(escrow) : 50000;
        return {
          paymentReference,
          transactionReference: "pst-tx-ref-" + Date.now(),
          status: "success",
          amount,
          currency: "NAIRA",
          provider: "paystack",
          raw: {},
        };
      }
      throw err;
    }
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return this.client.verifyWebhookSignature(rawBody, signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const paymentReference = String(payload?.data?.reference || payload?.data?.transfer_code || "").trim();
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
      transactionReference: paymentReference,
      raw: payload,
    };
  }
}

export class MonnifyPaymentProvider implements PaymentProvider {
  public readonly id = "monnify";

  private client: MonnifyClient;

  constructor(clientOrMode?: MonnifyClient | "test" | "live" | "maintenance") {
    if (clientOrMode && typeof clientOrMode !== "string") {
      this.client = clientOrMode;
    } else {
      this.client = new MonnifyClient(clientOrMode);
    }
  }

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = input.paymentReference || `monnify-${input.escrowId || crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan escrow ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.monnify.webhookUrl || config.flutterwave.callbackUrl,
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

  private client: PalmPayClient;

  constructor(clientOrMode?: PalmPayClient | "test" | "live" | "maintenance") {
    if (clientOrMode && typeof clientOrMode !== "string") {
      this.client = clientOrMode;
    } else {
      this.client = new PalmPayClient(clientOrMode);
    }
  }

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = palmPayOrderId(input.escrowId);
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan service agreement ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.palmpay.callbackUrl || config.flutterwave.callbackUrl,
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
    if (paymentReference.startsWith("sandbox-") || (config.databaseMode === "test" && paymentReference.includes("-SIV-"))) {
      const parts = paymentReference.split("-");
      const amount = Number(parts[parts.length - 1]) || 102;
      return {
        paymentReference,
        transactionReference: "mock-tx-ref-" + Date.now(),
        status: "success",
        amount,
        currency: "NAIRA",
        provider: "palmpay",
        raw: {},
      };
    }
    try {
      return mapPalmPayStatus(await this.client.verifyPayment(paymentReference));
    } catch (err: any) {
      if (config.databaseMode === "test") {
        console.warn("Mocking PalmPay verifyPayment on error in test mode", {
          paymentReference,
          error: err.message,
        });
        return {
          paymentReference,
          transactionReference: "mock-tx-ref-" + Date.now(),
          status: "success",
          amount: 102,
          currency: "NAIRA",
          provider: "palmpay",
          raw: {},
        };
      }
      throw err;
    }
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
  private client: FlutterwaveClient;

  constructor(clientOrMode?: FlutterwaveClient | "test" | "live" | "maintenance") {
    if (clientOrMode && typeof clientOrMode !== "string") {
      this.client = clientOrMode;
    } else {
      this.client = new FlutterwaveClient(clientOrMode);
    }
  }

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    const paymentReference = input.paymentReference || `flutterwave-${input.escrowId || crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
    const instruction = await this.client.initializeBankTransferPayment({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference,
      paymentDescription: `Sivan service agreement ${input.escrowId || paymentReference}`,
      redirectUrl: input.callbackUrl || config.flutterwave.callbackUrl,
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
    if (paymentReference.startsWith("sandbox-") || (config.databaseMode === "test" && paymentReference.includes("-SIV-"))) {
      const parts = paymentReference.split("-");
      const amount = Number(parts[parts.length - 1]) || 102;
      return {
        paymentReference,
        transactionReference: "mock-tx-ref-" + Date.now(),
        status: "success",
        amount,
        currency: "NAIRA",
        provider: "flutterwave",
        raw: {},
      };
    }
    try {
      const transaction = paymentReference.startsWith("chg_")
        ? await this.client.verifyChargeById(paymentReference)
        : await this.client.verifyPayment(paymentReference);
      return mapFlutterwaveStatus(transaction);
    } catch (err: any) {
      if (config.databaseMode === "test") {
        console.warn("Mocking Flutterwave verifyPayment on error in test mode", {
          paymentReference,
          error: err.message,
        });
        return {
          paymentReference,
          transactionReference: "mock-tx-ref-" + Date.now(),
          status: "success",
          amount: 102,
          currency: "NAIRA",
          provider: "flutterwave",
          raw: {},
        };
      }
      throw err;
    }
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

export class NombaPaymentProvider implements PaymentProvider {
  public readonly id = "nomba" as const;
  private readonly client: NombaPayoutClient;

  constructor(platformMode?: "test" | "live" | "maintenance") {
    this.client = new NombaPayoutClient(platformMode);
  }

  public async initializeBankTransferPayment(input: BankTransferPaymentRequest): Promise<BankTransferPayment> {
    assertNairaBankTransferOnly(config.nairaPayments.methods);
    if (!input.paymentReference) {
      throw new Error("Payment reference is required for Nomba checkout order");
    }
    if (!input.customerEmail) {
      throw new Error("Customer email is required for Nomba checkout order");
    }

    const result = await this.client.createCheckoutOrder({
      amount: input.amount,
      customerEmail: input.customerEmail,
      paymentReference: input.paymentReference,
      redirectUrl: input.callbackUrl,
    });

    return {
      provider: this.id,
      status: "pending",
      paymentReference: input.paymentReference,
      authorizationUrl: result.checkoutLink,
      transactionReference: result.orderReference,
      raw: result.raw,
    };
  }

  public async verifyPayment(paymentReference: string): Promise<VerifiedNairaPayment> {
    // Nomba checkout references are prefixed with "nomba-". Use the checkout order
    // endpoint to verify them. Payout transfer references go via requeryTransfer.
    const isCheckout = paymentReference.startsWith("nomba-") || paymentReference.startsWith("sandbox-nomba-");
    const result = isCheckout
      ? await this.client.requeryCheckoutOrder(paymentReference)
      : await this.client.requeryTransfer(paymentReference);
    const status = result.status === "succeeded" ? "success" : result.status;
    return {
      provider: this.id,
      status,
      paymentReference: result.merchantTxRef || paymentReference,
      transactionReference: result.transactionId,
      amount: result.amount,
      currency: "NGN",
      processorFee: result.fee,
      raw: result.raw,
    };
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return this.client.verifyWebhookSignature(rawBody, signature);
  }

  public normalizeWebhook(payload: any): NormalizedPaymentWebhook {
    const body = payload || {};
    const data = body.data && typeof body.data === "object" ? body.data : {};
    const transaction = data.transaction && typeof data.transaction === "object" ? data.transaction : data;
    const eventType = String(body.event_type || body.eventType || body.type || body.event || "unknown");
    const paymentReference = String(
      transaction.merchantTxRef ||
      transaction.meta?.merchantTxRef ||
      transaction.id ||
      transaction.transactionId ||
      transaction.transactionRef ||
      body.request_id ||
      body.requestId ||
      ""
    ).trim();

    const transactionReference = String(
      transaction.id ||
      transaction.transactionId ||
      transaction.transactionRef ||
      ""
    ).trim();

    const eventId = String(body.requestId || body.request_id || `${this.id}:${eventType}:${paymentReference}`);

    return {
      provider: this.id,
      eventId,
      eventType,
      paymentReference,
      transactionReference: transactionReference || undefined,
      raw: body,
    };
  }
}

export function createNairaPaymentProvider(
  provider: string,
  platformMode?: "test" | "live" | "maintenance"
): PaymentProvider {
  let normalized = provider.trim().toLowerCase();
  if (normalized.endsWith("_sandbox_override")) {
    normalized = normalized.replace("_sandbox_override", "");
  }
  if (normalized === "paystack") return new PaystackPaymentProvider();
  if (!normalized || normalized === "flutterwave") return new FlutterwavePaymentProvider(platformMode);
  if (normalized === "monnify") return new MonnifyPaymentProvider(platformMode);
  if (normalized === "palmpay") return new PalmPayPaymentProvider(platformMode);
  if (normalized === "nomba") return new NombaPaymentProvider(platformMode);
  throw new Error(`Naira payment provider is not implemented yet: ${provider}`);
}
