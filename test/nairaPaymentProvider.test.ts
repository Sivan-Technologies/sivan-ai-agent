import { describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { FlutterwavePaymentProvider, MonnifyPaymentProvider, PaystackPaymentProvider } from "../src/services/nairaPaymentProvider";
import { config } from "../src/config";
import { PaystackClient } from "../src/services/paystackClient";
import { MonnifyClient } from "../src/services/monnifyClient";
import { FlutterwaveClient } from "../src/services/flutterwaveClient";

describe("PaystackPaymentProvider", () => {
  it("initializes bank-transfer-only payments through Paystack", async () => {
    (config.paystack as any).channels = ["bank_transfer"];
    const client = {
      initializeTransaction: vi.fn().mockResolvedValue({
        authorizationUrl: "https://checkout.paystack.com/test",
        reference: "paystack-ref-1",
        accessCode: "access-code-1",
      }),
      fetchTransaction: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PaystackClient;
    const provider = new PaystackPaymentProvider(client);

    const payment = await provider.initializeBankTransferPayment({
      amount: 10000,
      customerEmail: "buyer@example.com",
      callbackUrl: "https://sivan.example/callback",
      escrowId: "SIV-100",
    });

    expect(payment).toMatchObject({
      provider: "paystack",
      status: "pending",
      paymentReference: "paystack-ref-1",
      transactionReference: "paystack-ref-1",
      authorizationUrl: "https://checkout.paystack.com/test",
      accessCode: "access-code-1",
    });
    expect(client.initializeTransaction).toHaveBeenCalledWith(10000, "buyer@example.com", "https://sivan.example/callback");
  });

  it("rejects non-transfer Paystack channel configuration", async () => {
    (config.paystack as any).channels = ["bank_transfer", "card"];
    const provider = new PaystackPaymentProvider({
      initializeTransaction: vi.fn(),
      fetchTransaction: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PaystackClient);

    await expect(provider.initializeBankTransferPayment({
      amount: 10000,
      customerEmail: "buyer@example.com",
    })).rejects.toThrow(/bank transfer only/i);
  });

  it("normalizes Paystack transaction status", async () => {
    const provider = new PaystackPaymentProvider({
      initializeTransaction: vi.fn(),
      fetchTransaction: vi.fn().mockResolvedValue({
        status: "success",
        reference: "paystack-ref-2",
        amount: 15000,
        currency: "NGN",
        processorFee: 150,
        channel: "bank_transfer",
        paidAt: "2026-06-11T10:00:00Z",
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PaystackClient);

    await expect(provider.verifyPayment("paystack-ref-2")).resolves.toMatchObject({
      provider: "paystack",
      status: "success",
      paymentReference: "paystack-ref-2",
      transactionReference: "paystack-ref-2",
      amount: 15000,
      currency: "NGN",
      processorFee: 150,
      channel: "bank_transfer",
    });
  });

  it("normalizes Paystack webhook payloads", () => {
    const provider = new PaystackPaymentProvider();
    const event = provider.normalizeWebhook({
      id: 123,
      event: "charge.success",
      data: { reference: "paystack-ref-3" },
    });

    expect(event).toEqual({
      provider: "paystack",
      eventId: "123",
      eventType: "charge.success",
      paymentReference: "paystack-ref-3",
      raw: {
        id: 123,
        event: "charge.success",
        data: { reference: "paystack-ref-3" },
      },
    });
  });

  it("delegates Paystack webhook signature verification", async () => {
    (config.paystack as any).secretKey = "test-secret";
    const provider = new PaystackPaymentProvider();
    const payload = JSON.stringify({ event: "charge.success", data: { reference: "ref-1" } });
    const signature = crypto.createHmac("sha512", "test-secret").update(payload).digest("hex");

    await expect(provider.verifyWebhookSignature(payload, signature)).resolves.toBe(true);
  });
});

describe("MonnifyPaymentProvider", () => {
  it("initializes account-transfer-only Monnify payments", async () => {
    (config.monnify as any).paymentMethods = ["ACCOUNT_TRANSFER"];
    const client = {
      initializeBankTransferPayment: vi.fn().mockResolvedValue({
        paymentReference: "monnify-SIV-200",
        transactionReference: "MNFY|200",
        checkoutUrl: "https://sandbox.sdk.monnify.com/checkout/MNFY|200",
        accountNumber: "1234567890",
        accountName: "Sivan Escrow",
        bankName: "Monnify Bank",
        bankCode: "999",
        expiresAt: "2026-06-11T10:40:00Z",
        expiresInSeconds: 2400,
        raw: { ok: true },
      }),
      verifyPayment: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as MonnifyClient;
    const provider = new MonnifyPaymentProvider(client);

    await expect(provider.initializeBankTransferPayment({
      amount: 12000,
      customerEmail: "buyer@example.com",
      callbackUrl: "https://sivan.example/callback",
      escrowId: "SIV-200",
    })).resolves.toMatchObject({
      provider: "monnify",
      status: "pending",
      paymentReference: "monnify-SIV-200",
      transactionReference: "MNFY|200",
      accountNumber: "1234567890",
      bankName: "Monnify Bank",
      expiresInSeconds: 2400,
    });
  });

  it("normalizes paid Monnify account transfer as success", async () => {
    const provider = new MonnifyPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "monnify-ref-1",
        transactionReference: "MNFY|201",
        paymentStatus: "PAID",
        amountPaid: 15000,
        totalPayable: 15000,
        currency: "NGN",
        paymentMethod: "ACCOUNT_TRANSFER",
        processorFee: 75,
        paidOn: "2026-06-11T10:00:00Z",
        raw: { ok: true },
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as MonnifyClient);

    await expect(provider.verifyPayment("monnify-ref-1")).resolves.toMatchObject({
      provider: "monnify",
      status: "success",
      paymentReference: "monnify-ref-1",
      transactionReference: "MNFY|201",
      amount: 15000,
      currency: "NGN",
      channel: "ACCOUNT_TRANSFER",
    });
  });

  it("does not normalize non-transfer Monnify payments as success", async () => {
    const provider = new MonnifyPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "monnify-ref-card",
        paymentStatus: "PAID",
        amountPaid: 15000,
        totalPayable: 15000,
        currency: "NGN",
        paymentMethod: "CARD",
        raw: { ok: true },
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as MonnifyClient);

    await expect(provider.verifyPayment("monnify-ref-card")).resolves.toMatchObject({
      provider: "monnify",
      status: "invalid_payment_method",
      paymentReference: "monnify-ref-card",
    });
  });

  it("normalizes Monnify webhook payloads", () => {
    const provider = new MonnifyPaymentProvider();
    const event = provider.normalizeWebhook({
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: {
        paymentReference: "monnify-ref-2",
        transactionReference: "MNFY|202",
      },
    });

    expect(event).toMatchObject({
      provider: "monnify",
      eventId: "monnify:SUCCESSFUL_TRANSACTION:monnify-ref-2:MNFY|202",
      eventType: "SUCCESSFUL_TRANSACTION",
      paymentReference: "monnify-ref-2",
    });
  });
});

describe("FlutterwavePaymentProvider", () => {
  it("initializes dynamic bank-transfer-only Flutterwave virtual accounts", async () => {
    (config.flutterwave as any).paymentMethods = ["bank_transfer"];
    const client = {
      initializeBankTransferPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-SIV-300",
        transactionReference: "van_300",
        authorizationUrl: "https://checkout.flutterwave.com/v3/hosted/pay/test",
        accountNumber: "4032866864",
        accountName: "Please make a bank transfer to Sivan Buyer",
        bankName: "WEMA BANK",
        expiresAt: "2026-06-11T11:40:00Z",
        expiresInSeconds: 3600,
        raw: { ok: true },
      }),
      verifyPayment: vi.fn(),
      verifyChargeById: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as FlutterwaveClient;
    const provider = new FlutterwavePaymentProvider(client);

    await expect(provider.initializeBankTransferPayment({
      amount: 12000,
      customerEmail: "buyer@example.com",
      escrowId: "SIV-300",
    })).resolves.toMatchObject({
      provider: "flutterwave",
      status: "pending",
      paymentReference: "flutterwave-SIV-300",
      transactionReference: "van_300",
      authorizationUrl: "https://checkout.flutterwave.com/v3/hosted/pay/test",
      accountNumber: "4032866864",
      bankName: "WEMA BANK",
      expiresInSeconds: 3600,
    });
  });

  it("normalizes succeeded Flutterwave bank transfer as success", async () => {
    const provider = new FlutterwavePaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-ref-1",
        transactionReference: "chg_1",
        status: "succeeded",
        amount: 15000,
        currency: "NGN",
        paymentMethod: "bank_transfer",
        processorFee: 100,
        paidAt: "2026-06-11T10:00:00Z",
        raw: { ok: true },
      }),
      verifyChargeById: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as FlutterwaveClient);

    await expect(provider.verifyPayment("flutterwave-ref-1")).resolves.toMatchObject({
      provider: "flutterwave",
      status: "success",
      paymentReference: "flutterwave-ref-1",
      transactionReference: "chg_1",
      amount: 15000,
      currency: "NGN",
      channel: "bank_transfer",
    });
  });

  it("does not normalize non-transfer Flutterwave payments as success", async () => {
    const provider = new FlutterwavePaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-card-ref",
        status: "succeeded",
        amount: 15000,
        currency: "NGN",
        paymentMethod: "card",
        raw: { ok: true },
      }),
      verifyChargeById: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as FlutterwaveClient);

    await expect(provider.verifyPayment("flutterwave-card-ref")).resolves.toMatchObject({
      provider: "flutterwave",
      status: "invalid_payment_method",
      paymentReference: "flutterwave-card-ref",
    });
  });

  it("normalizes Flutterwave charge.completed webhook payloads", () => {
    const provider = new FlutterwavePaymentProvider();
    const event = provider.normalizeWebhook({
      webhook_id: "wbk_123",
      type: "charge.completed",
      data: {
        id: "chg_123",
        reference: "flutterwave-ref-2",
      },
    });

    expect(event).toMatchObject({
      provider: "flutterwave",
      eventId: "wbk_123",
      eventType: "charge.completed",
      paymentReference: "flutterwave-ref-2",
      transactionReference: "chg_123",
    });
  });
});
