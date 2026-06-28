import { describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { FlutterwavePaymentProvider, MonnifyPaymentProvider, PalmPayPaymentProvider, PaystackPaymentProvider, createNairaPaymentProvider } from "../src/services/nairaPaymentProvider";
import { config } from "../src/config";
import { PaystackClient } from "../src/services/paystackClient";
import { MonnifyClient } from "../src/services/monnifyClient";
import { FlutterwaveClient } from "../src/services/flutterwaveClient";
import { PalmPayClient } from "../src/services/palmpayClient";

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

describe("PalmPayPaymentProvider", () => {
  it("initializes PalmPay bank-transfer payments with PalmPay-safe references", async () => {
    const client = {
      initializeBankTransferPayment: vi.fn().mockResolvedValue({
        paymentReference: "PPSIV300MFD8A1B2C3",
        transactionReference: "2424220903032435363613",
        checkoutUrl: "https://openapi.transspay.net/open-api/api/v1/payment/h5/redirect",
        accountNumber: "8792003113",
        accountName: "Sivan Collection",
        bankName: "PalmPay Test Bank",
        expiresAt: "2026-06-26T10:30:00.000Z",
        expiresInSeconds: 1800,
        raw: { ok: true },
      }),
      verifyPayment: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PalmPayClient;
    const provider = new PalmPayPaymentProvider(client);

    await expect(provider.initializeBankTransferPayment({
      amount: 5500,
      customerEmail: "buyer@example.com",
      escrowId: "SIV-300682-FEB6",
    })).resolves.toMatchObject({
      provider: "palmpay",
      status: "pending",
      paymentReference: "PPSIV300MFD8A1B2C3",
      transactionReference: "2424220903032435363613",
      authorizationUrl: "https://openapi.transspay.net/open-api/api/v1/payment/h5/redirect",
      accountNumber: "8792003113",
      bankName: "PalmPay Test Bank",
    });

    expect(client.initializeBankTransferPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 5500,
      paymentReference: expect.stringMatching(/^PPSIV300682FE[A-Z0-9]+$/),
      metadata: expect.objectContaining({ provider: "palmpay", paymentMethod: "bank_transfer" }),
    }));
  });

  it("normalizes successful PalmPay bank transfers as success", async () => {
    const provider = new PalmPayPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "PPSIV300682FEB6",
        transactionReference: "2424220903032435363613",
        status: "success",
        amount: 5500,
        currency: "NGN",
        paymentMethod: "bank_transfer",
        raw: { ok: true },
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PalmPayClient);

    await expect(provider.verifyPayment("PPSIV300682FEB6")).resolves.toMatchObject({
      provider: "palmpay",
      status: "success",
      paymentReference: "PPSIV300682FEB6",
      amount: 5500,
      currency: "NGN",
      channel: "bank_transfer",
    });
  });

  it("does not normalize non-transfer PalmPay payments as success", async () => {
    const provider = new PalmPayPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "PPSIVCARDROUTE",
        transactionReference: "2424220903032435363613",
        status: "success",
        amount: 5500,
        currency: "NGN",
        paymentMethod: "pay_wallet",
        raw: { ok: true },
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PalmPayClient);

    await expect(provider.verifyPayment("PPSIVCARDROUTE")).resolves.toMatchObject({
      provider: "palmpay",
      status: "invalid_payment_method",
      paymentReference: "PPSIVCARDROUTE",
    });
  });

  it("does not normalize non-NGN PalmPay payments as success", async () => {
    const provider = new PalmPayPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "PPSIVUSDROUTE",
        transactionReference: "2424220903032435363613",
        status: "success",
        amount: 5500,
        currency: "USD",
        paymentMethod: "bank_transfer",
        raw: { ok: true },
      }),
      verifyWebhookSignature: vi.fn(),
    } as unknown as PalmPayClient);

    await expect(provider.verifyPayment("PPSIVUSDROUTE")).resolves.toMatchObject({
      provider: "palmpay",
      status: "invalid_currency",
      paymentReference: "PPSIVUSDROUTE",
    });
  });

  it("normalizes PalmPay payment notifications", () => {
    const provider = new PalmPayPaymentProvider();
    const event = provider.normalizeWebhook({
      orderId: "PPSIV300682FEB6",
      orderNo: "2424220903032435363613",
      orderStatus: 2,
    });

    expect(event).toMatchObject({
      provider: "palmpay",
      eventType: "order.2",
      paymentReference: "PPSIV300682FEB6",
      transactionReference: "2424220903032435363613",
    });
  });

  it("verifies PalmPay webhook signatures through the provider interface", async () => {
    const verifyWebhookSignature = vi.fn().mockReturnValue(true);
    const provider = new PalmPayPaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn(),
      verifyWebhookSignature,
    } as unknown as PalmPayClient);
    const payload = {
      orderId: "PPSIV300682FEB6",
      orderNo: "2424220903032435363613",
      orderStatus: 2,
    };

    await expect(provider.verifyWebhookSignature(JSON.stringify(payload), "valid-signature")).resolves.toBe(true);
    expect(verifyWebhookSignature).toHaveBeenCalledWith(payload, "valid-signature");
    await expect(provider.verifyWebhookSignature("not-json", "valid-signature")).resolves.toBe(false);
    await expect(provider.verifyWebhookSignature(JSON.stringify(payload), "")).resolves.toBe(false);
  });

  it("selects PalmPay from the provider factory", () => {
    expect(createNairaPaymentProvider("palmpay")).toBeInstanceOf(PalmPayPaymentProvider);
  });
});

describe("FlutterwavePaymentProvider", () => {
  it("initializes dynamic bank-transfer-only Flutterwave payments via checkout link", async () => {
    (config.flutterwave as any).paymentMethods = ["bank_transfer"];
    const client = {
      initializeBankTransferPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-SIV-300",
        transactionReference: "flutterwave-SIV-300",
        authorizationUrl: "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/57ca14f7a6b07296b623",
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
      transactionReference: "flutterwave-SIV-300",
      authorizationUrl: "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/57ca14f7a6b07296b623",
      expiresInSeconds: 3600,
    });
  });

  it("normalizes successful Flutterwave v3 bank transfer as success", async () => {
    // Flutterwave v3 returns "successful" (not "succeeded").
    const provider = new FlutterwavePaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-ref-1",
        transactionReference: "chg_1",
        status: "successful",
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

  it("does not normalize non-transfer Flutterwave v3 payments as success", async () => {
    const provider = new FlutterwavePaymentProvider({
      initializeBankTransferPayment: vi.fn(),
      verifyPayment: vi.fn().mockResolvedValue({
        paymentReference: "flutterwave-card-ref",
        status: "successful",
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
