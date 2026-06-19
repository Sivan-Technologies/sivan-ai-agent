import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { FlutterwaveClient } from "../src/services/flutterwaveClient";

vi.mock("axios", () => ({
  default: {
    isAxiosError: vi.fn(),
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

  it("creates Flutterwave dynamic virtual accounts for bank-transfer-only collection", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          status: "success",
          data: {
            id: "cus_test_1",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: "success",
          data: {
            id: "van_test_1",
            reference: "fw-proof-1",
            account_number: "4032866864",
            account_bank_name: "WEMA BANK",
            account_expiration_datetime: "2026-06-19T10:00:00Z",
            note: "Please make a bank transfer to Sivan Buyer",
          },
        },
      });

    const client = new FlutterwaveClient();
    await expect(client.initializeBankTransferPayment({
      amount: 1500,
      customerEmail: "buyer@example.com",
      paymentReference: "fw-proof-1",
      paymentDescription: "Sivan service agreement proof",
      metadata: { escrowId: "SIV-100" },
    })).resolves.toMatchObject({
      paymentReference: "fw-proof-1",
      transactionReference: "van_test_1",
      accountNumber: "4032866864",
      accountName: "Please make a bank transfer to Sivan Buyer",
      bankName: "WEMA BANK",
      expiresAt: "2026-06-19T10:00:00Z",
      expiresInSeconds: 3600,
    });

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://api.flutterwave.com/virtual-accounts",
      expect.objectContaining({
        reference: "fw-proof-1",
        customer_id: "cus_test_1",
        amount: 1500,
        currency: "NGN",
        account_type: "dynamic",
        expiry: 3600,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer FLWSECK_TEST-secret",
          "X-Idempotency-Key": "fw-proof-1:virtual-account",
        }),
      })
    );
  });

  it("fails closed instead of falling back to hosted checkout when virtual-account APIs are unavailable", async () => {
    const notFound = Object.assign(new Error("Cannot POST /customers"), {
      response: { status: 404, data: "Cannot POST /customers" },
      isAxiosError: true,
    });
    mockedAxios.post.mockRejectedValueOnce(notFound);

    const client = new FlutterwaveClient();
    await expect(client.initializeBankTransferPayment({
      amount: 1500,
      customerEmail: "buyer@example.com",
      paymentReference: "fw-proof-1",
      paymentDescription: "Sivan service agreement proof",
      redirectUrl: "https://sivan.example/callback",
      metadata: { escrowId: "SIV-100" },
    })).rejects.toThrow("Cannot POST /customers");

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/v3/payments"),
      expect.anything(),
      expect.anything()
    );
  });
});
