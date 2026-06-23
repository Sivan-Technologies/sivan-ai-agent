import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { FlutterwaveClient } from "../src/services/flutterwaveClient";

vi.mock("axios", () => ({
  default: {
    // isAxiosError is used by the client to detect axios errors in catch blocks.
    isAxiosError: (err: unknown) => Boolean(err && typeof err === "object" && "isAxiosError" in err && (err as any).isAxiosError === true),
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios, true);

describe("FlutterwaveClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config.flutterwave as any).secretKey = "FLWSECK_TEST-secret";
    (config.flutterwave as any).baseUrl = "https://api.flutterwave.com";
    (config.flutterwave as any).paymentMethods = ["bank_transfer"];
    (config.flutterwave as any).dynamicAccountExpirySeconds = 3600;
    (config.nairaPayments as any).methods = ["bank_transfer"];
  });

  it("creates a v3 virtual account via the single-call POST /v3/virtual-account-numbers endpoint", async () => {
    // Flutterwave v3 creates the virtual account in one call (no separate customer step).
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: "success",
        message: "Virtual account created",
        data: {
          response_code: "02",
          response_message: "Transaction fetched successfully",
          flw_ref: "FLW-MOCK-REF-001",
          order_ref: "URF_1719072000_001",
          account_number: "4032866864",
          account_name: "Sivan - Sivan Buyer",
          frequency: 1,
          bank_name: "WEMA BANK",
          created_at: "2026-06-23 14:00:00",
          expiry_date: "2026-06-23 15:00:00",
          amount: 1500,
          tx_ref: "flutterwave-SIV-100-abc12345",
        },
      },
    });

    const client = new FlutterwaveClient();
    const result = await client.initializeBankTransferPayment({
      amount: 1500,
      customerEmail: "buyer@example.com",
      paymentReference: "flutterwave-SIV-100-abc12345",
      paymentDescription: "Sivan service agreement SIV-100",
      metadata: { escrowId: "SIV-100" },
    });

    expect(result).toMatchObject({
      paymentReference: "flutterwave-SIV-100-abc12345",
      accountNumber: "4032866864",
      accountName: "Sivan - Sivan Buyer",
      bankName: "WEMA BANK",
      expiresAt: "2026-06-23 15:00:00",
      expiresInSeconds: 3600,
    });

    // Should call exactly ONE endpoint — no separate customer step.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/virtual-account-numbers",
      expect.objectContaining({
        email: "buyer@example.com",
        amount: 1500,
        currency: "NGN",
        is_permanent: false,
        tx_ref: "flutterwave-SIV-100-abc12345",
        narration: "Sivan service agreement SIV-100",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer FLWSECK_TEST-secret",
        }),
      })
    );
  });

  it("verifies a transaction by reference using GET /v3/transactions/verify_by_reference", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: "success",
        message: "Transaction fetched successfully",
        data: {
          id: 1234567,
          tx_ref: "flutterwave-SIV-100-abc12345",
          status: "successful",
          amount: 1500,
          currency: "NGN",
          payment_type: "bank_transfer",
          app_fee: 42,
          created_at: "2026-06-23T14:05:00.000Z",
          customer: { id: 999, email: "buyer@example.com" },
        },
      },
    });

    const client = new FlutterwaveClient();
    const result = await client.verifyPayment("flutterwave-SIV-100-abc12345");

    expect(result).toMatchObject({
      paymentReference: "flutterwave-SIV-100-abc12345",
      transactionReference: "1234567",
      status: "successful",
      amount: 1500,
      currency: "NGN",
      paymentMethod: "bank_transfer",
      processorFee: 42,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/transactions/verify_by_reference",
      expect.objectContaining({
        params: { tx_ref: "flutterwave-SIV-100-abc12345" },
        headers: expect.objectContaining({
          Authorization: "Bearer FLWSECK_TEST-secret",
        }),
      })
    );
  });

  it("verifies a transaction by numeric charge ID using GET /v3/transactions/{id}/verify", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: "success",
        message: "Transaction fetched successfully",
        data: {
          id: 1234567,
          tx_ref: "flutterwave-SIV-100-abc12345",
          status: "successful",
          amount: 1500,
          currency: "NGN",
          payment_type: "bank_transfer",
          app_fee: 42,
        },
      },
    });

    const client = new FlutterwaveClient();
    const result = await client.verifyChargeById("1234567");

    expect(result.transactionReference).toBe("1234567");
    expect(result.status).toBe("successful");

    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/transactions/1234567/verify",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer FLWSECK_TEST-secret",
        }),
      })
    );
  });

  it("fails closed instead of silently swallowing errors when the virtual-account API fails", async () => {
    const networkErr = Object.assign(new Error("Request failed with status code 400"), {
      response: {
        status: 400,
        data: { status: "error", message: "tx_ref has already been used" },
      },
      isAxiosError: true,
    });
    mockedAxios.post.mockRejectedValueOnce(networkErr);

    const client = new FlutterwaveClient();
    await expect(
      client.initializeBankTransferPayment({
        amount: 1500,
        customerEmail: "buyer@example.com",
        paymentReference: "flutterwave-SIV-100-abc12345",
        paymentDescription: "Sivan service agreement SIV-100",
        metadata: { escrowId: "SIV-100" },
      })
    ).rejects.toThrow(/virtual account creation failed/i);

    // Must NOT fall back to a hosted checkout — single endpoint, single call.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
