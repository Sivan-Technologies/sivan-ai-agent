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

  it("initializes a hosted payment page via the POST /v3/payments endpoint", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: "success",
        message: "Hosted payment page initialized",
        data: {
          link: "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/57ca14f7a6b07296b623",
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
      transactionReference: "flutterwave-SIV-100-abc12345",
      authorizationUrl: "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/57ca14f7a6b07296b623",
      expiresInSeconds: 3600,
    });

    // Should call exactly ONE endpoint.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/payments",
      expect.objectContaining({
        tx_ref: "flutterwave-SIV-100-abc12345",
        amount: 1500,
        currency: "NGN",
        payment_options: "banktransfer",
        customer: expect.objectContaining({
          email: "buyer@example.com",
          name: "buyer Buyer",
        }),
        customizations: expect.objectContaining({
          title: "Sivan Payments",
          description: "Sivan service agreement SIV-100",
        }),
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

  it("pulls and normalizes Flutterwave transactions for reconciliation", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: "success",
        data: [{
          id: 7654321,
          tx_ref: "flutterwave-SIV-200-recon",
          status: "successful",
          amount: 2500,
          currency: "NGN",
          payment_type: "bank_transfer",
          app_fee: 50,
          created_at: "2026-06-26T01:00:00.000Z",
        }],
        meta: { total_pages: 1 },
      },
    });

    const client = new FlutterwaveClient();
    const transactions = await client.listTransactions({
      from: "2026-06-25T00:00:00.000Z",
      to: "2026-06-26T00:00:00.000Z",
    });

    expect(transactions).toEqual([expect.objectContaining({
      paymentReference: "flutterwave-SIV-200-recon",
      transactionReference: "7654321",
      status: "successful",
      amount: 2500,
      currency: "NGN",
      paymentMethod: "bank_transfer",
      processorFee: 50,
    })]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.flutterwave.com/v3/transactions",
      expect.objectContaining({
        params: expect.objectContaining({
          from: "2026-06-25",
          to: "2026-06-26",
          page: 1,
          per_page: 100,
        }),
      })
    );
  });

  it("fails closed instead of silently swallowing errors when the payments API fails", async () => {
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
    ).rejects.toThrow(/hosted payment initialization failed/i);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
