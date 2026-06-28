import type { EscrowRecord } from "./escrowStore";
import type { NormalizedPaymentWebhook, NairaPaymentProviderId, VerifiedNairaPayment } from "./nairaPaymentProvider";

export type NormalizedPaymentEventProvider = NairaPaymentProviderId;

export type NormalizedPaymentEventType =
  | "PAYMENT_PENDING"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_REJECTED"
  | "SETTLEMENT_PENDING"
  | "SETTLEMENT_RECEIVED"
  | "PAYOUT_READY"
  | "PAYOUT_FAILED";

export type NormalizedPaymentEventStatus = "success" | "failed" | "pending";

export interface NormalizedPaymentEvent {
  eventId: string;
  provider: NormalizedPaymentEventProvider;
  type: NormalizedPaymentEventType;
  escrowReference: string;
  amount: {
    expected: number;
    paid: number;
    currency: "NGN" | "USDC";
  };
  status: NormalizedPaymentEventStatus;
  providerReference: string;
  raw: unknown;
  signatureVerified: boolean;
  occurredAt: string;
  idempotencyKey: string;
}

export interface NormalizeVerifiedPaymentEventInput {
  webhook: NormalizedPaymentWebhook;
  verifiedPayment: VerifiedNairaPayment;
  escrow?: Pick<EscrowRecord, "escrowId" | "currency"> | null;
  expectedAmount: number;
  signatureVerified: boolean;
  raw: unknown;
  occurredAt?: string;
}

function normalizeCurrency(currency: string): "NGN" | "USDC" {
  const normalized = String(currency || "").toUpperCase();
  if (normalized === "USDC") return "USDC";
  return "NGN";
}

export function normalizeProviderPaymentStatus(status: string): NormalizedPaymentEventStatus {
  const normalized = String(status || "").toLowerCase();
  if (["success", "successful", "paid", "sandbox_success"].includes(normalized)) return "success";
  if (["pending", "paying", "processing", "in_progress"].includes(normalized)) return "pending";
  return "failed";
}

export function normalizeProviderPaymentType(status: string): NormalizedPaymentEventType {
  const normalized = String(status || "").toLowerCase();
  if (["success", "successful", "paid", "sandbox_success"].includes(normalized)) return "PAYMENT_VERIFIED";
  if (["pending", "paying", "processing", "in_progress"].includes(normalized)) return "PAYMENT_PENDING";
  return "PAYMENT_REJECTED";
}

export function normalizeVerifiedPaymentEvent(input: NormalizeVerifiedPaymentEventInput): NormalizedPaymentEvent {
  const provider = input.verifiedPayment.provider as NormalizedPaymentEventProvider;
  const paymentReference = input.verifiedPayment.paymentReference || input.webhook.paymentReference;
  const providerReference = input.verifiedPayment.transactionReference || input.webhook.transactionReference || paymentReference;
  const occurredAt = input.occurredAt || input.verifiedPayment.paidAt || new Date().toISOString();
  const currency = normalizeCurrency(input.verifiedPayment.currency || input.escrow?.currency || "NGN");
  const type = normalizeProviderPaymentType(input.verifiedPayment.status);
  const status = normalizeProviderPaymentStatus(input.verifiedPayment.status);
  const eventId = input.webhook.eventId || `${provider}:${input.webhook.eventType}:${paymentReference}:${providerReference}`;

  return {
    eventId,
    provider,
    type,
    escrowReference: input.escrow?.escrowId || paymentReference,
    amount: {
      expected: input.expectedAmount,
      paid: Number(input.verifiedPayment.amount || 0),
      currency,
    },
    status,
    providerReference,
    raw: input.raw,
    signatureVerified: input.signatureVerified,
    occurredAt,
    idempotencyKey: `${provider}:${eventId}:${paymentReference}:${providerReference}`,
  };
}

export function normalizeSettlementEvent(input: {
  provider: NormalizedPaymentEventProvider;
  eventId: string;
  escrowReference: string;
  providerReference: string;
  amount: number;
  currency?: "NGN" | "USDC";
  raw: unknown;
  signatureVerified: boolean;
  occurredAt?: string;
}): NormalizedPaymentEvent {
  return {
    eventId: input.eventId,
    provider: input.provider,
    type: "SETTLEMENT_RECEIVED",
    escrowReference: input.escrowReference,
    amount: {
      expected: input.amount,
      paid: input.amount,
      currency: input.currency || "NGN",
    },
    status: "success",
    providerReference: input.providerReference,
    raw: input.raw,
    signatureVerified: input.signatureVerified,
    occurredAt: input.occurredAt || new Date().toISOString(),
    idempotencyKey: `${input.provider}:${input.eventId}:${input.escrowReference}:${input.providerReference}`,
  };
}
