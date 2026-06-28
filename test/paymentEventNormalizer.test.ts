import { describe, expect, it } from "vitest";
import { normalizeProviderPaymentStatus, normalizeProviderPaymentType, normalizeVerifiedPaymentEvent } from "../src/services/paymentEventNormalizer";

describe("paymentEventNormalizer", () => {
  it.each([
    ["paystack", "success", "PAYMENT_VERIFIED", "success"],
    ["monnify", "success", "PAYMENT_VERIFIED", "success"],
    ["palmpay", "success", "PAYMENT_VERIFIED", "success"],
    ["flutterwave", "success", "PAYMENT_VERIFIED", "success"],
    ["palmpay", "paying", "PAYMENT_PENDING", "pending"],
    ["flutterwave", "invalid_payment_method", "PAYMENT_REJECTED", "failed"],
  ])("normalizes %s status %s into the canonical Sivan payment event", (provider, providerStatus, type, status) => {
    const event = normalizeVerifiedPaymentEvent({
      webhook: {
        provider,
        eventId: `${provider}:event:ref-1`,
        eventType: "provider.event",
        paymentReference: "ref-1",
        transactionReference: "provider-ref-1",
        raw: { provider },
      },
      verifiedPayment: {
        provider,
        status: providerStatus,
        paymentReference: "ref-1",
        transactionReference: "provider-ref-1",
        amount: 10500,
        currency: "NGN",
        raw: { verified: true },
      },
      escrow: {
        escrowId: "SIV-TEST-001",
        currency: "NAIRA",
      },
      expectedAmount: 10500,
      signatureVerified: true,
      raw: { webhook: true },
      occurredAt: "2026-06-28T00:00:00.000Z",
    });

    expect(event).toMatchObject({
      eventId: `${provider}:event:ref-1`,
      provider,
      type,
      escrowReference: "SIV-TEST-001",
      amount: {
        expected: 10500,
        paid: 10500,
        currency: "NGN",
      },
      status,
      providerReference: "provider-ref-1",
      raw: { webhook: true },
      signatureVerified: true,
      occurredAt: "2026-06-28T00:00:00.000Z",
      idempotencyKey: `${provider}:${provider}:event:ref-1:ref-1:provider-ref-1`,
    });
  });

  it("maps provider status values consistently", () => {
    expect(normalizeProviderPaymentType("success")).toBe("PAYMENT_VERIFIED");
    expect(normalizeProviderPaymentType("paying")).toBe("PAYMENT_PENDING");
    expect(normalizeProviderPaymentType("invalid_currency")).toBe("PAYMENT_REJECTED");
    expect(normalizeProviderPaymentStatus("success")).toBe("success");
    expect(normalizeProviderPaymentStatus("processing")).toBe("pending");
    expect(normalizeProviderPaymentStatus("failed")).toBe("failed");
  });
});
