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

  it("falls back to Flutterwave V3 hosted checkout when virtual-account APIs are unavailable", async () => {
    const notFound = Object.assign(new Error("Cannot POST /customers"), {
      response: { status: 404, data: "Cannot POST /customers" },
      isAxiosError: true,
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({
        data: {
          status: "success",
          data: {
            id: 12345,
            tx_ref: "fw-proof-1",
            link: "https://checkout.flutterwave.com/v3/hosted/pay/fw-proof-1",
          },
        },
      });

    const client = new FlutterwaveClient();
    await expect(client.initializeBankTransferPayment({
      amount: 1500,
      customerEmail: "buyer@example.com",
      paymentReference: "fw-proof-1",
      paymentDescription: "Sivan service agreement proof",
      redirectUrl: "https://sivan.example/callback",
      metadata: { escrowId: "SIV-100" },
    })).resolves.toMatchObject({
      paymentReference: "fw-proof-1",
      transactionReference: "12345",
      authorizationUrl: "https://checkout.flutterwave.com/v3/hosted/pay/fw-proof-1",
      expiresInSeconds: 3600,
    });

    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      "https://api.flutterwave.com/v3/payments",
      expect.objectContaining({
        tx_ref: "fw-proof-1",
        amount: 1500,
        currency: "NGN",
        redirect_url: "https://sivan.example/callback",
        payment_options: "banktransfer",
        customer: expect.objectContaining({ email: "buyer@example.com" }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer FLWSECK_TEST-secret",
          "X-Idempotency-Key": "fw-proof-1",
        }),
      })
    );
  });
});
