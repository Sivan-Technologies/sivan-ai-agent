import { beforeEach, describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import axios from "axios";
import { PaystackClient } from "../src/services/paystackClient";
import { config } from "../src/config";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaystackClient.verifyWebhookSignature", () => {
  it("validates a known signature", async () => {
    // set a temporary secret in config for the test
    (config.paystack as any).secretKey = "test-secret";
    const client = new PaystackClient();
    const payload = JSON.stringify({ event: "test", data: { reference: "ref-1" } });
    const signature = crypto.createHmac("sha512", "test-secret").update(payload).digest("hex");

    const ok = await client.verifyWebhookSignature(payload, signature);
    expect(ok).toBe(true);
  });

  it("rejects invalid signatures without throwing", async () => {
    (config.paystack as any).secretKey = "test-secret";
    const client = new PaystackClient();
    const payload = JSON.stringify({ event: "test", data: { reference: "ref-1" } });

    await expect(client.verifyWebhookSignature(payload, "invalid")).resolves.toBe(false);
  });
});

describe("PaystackClient.initializeTransaction", () => {
  it("initializes Naira checkout with bank transfer only", async () => {
    (config.paystack as any).secretKey = "sk_test_secret";
    (config.paystack as any).baseUrl = "https://api.paystack.co";
    (config.paystack as any).receiverAccount = "escrow-receiver";
    (config.paystack as any).channels = ["bank_transfer"];

    const mockedAxios = vi.mocked(axios);
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.com/test",
          reference: "ref-transfer-1",
          access_code: "access-transfer-1",
        },
      },
    });

    const client = new PaystackClient();
    const result = await client.initializeTransaction(
      5000,
      "buyer@example.com",
      "https://sivan-escrow-agent.onrender.com/api/health"
    );

    expect(result.reference).toBe("ref-transfer-1");
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/initialize",
      expect.objectContaining({
        email: "buyer@example.com",
        amount: 500000,
        currency: "NGN",
        callback_url: "https://sivan-escrow-agent.onrender.com/api/health",
        channels: ["bank_transfer"],
        metadata: { receiver: "escrow-receiver" },
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk_test_secret",
        }),
      })
    );
  });
});

describe("PaystackClient.listBanks", () => {
  it("falls back to built-in Nigerian banks when Paystack bank list is unavailable", async () => {
    (config.paystack as any).secretKey = "sk_test_secret";
    (config.paystack as any).baseUrl = "https://api.paystack.co";

    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockRejectedValueOnce(new Error("network unavailable"));

    const client = new PaystackClient();
    const banks = await client.listBanks();

    expect(banks.some((bank) => bank.code === "058")).toBe(true);
    expect(banks.some((bank) => /kuda/i.test(bank.name))).toBe(true);
  });
});

describe("PaystackClient.listTransactions", () => {
  it("pulls and normalizes Paystack transactions for reconciliation", async () => {
    (config.paystack as any).secretKey = "sk_test_secret";
    (config.paystack as any).baseUrl = "https://api.paystack.co";

    const mockedAxios = vi.mocked(axios);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: true,
        data: [{
          reference: "paystack-ref-1",
          status: "success",
          amount: 125000,
          currency: "NGN",
          fees: 1500,
          channel: "bank_transfer",
          paid_at: "2026-06-26T01:00:00.000Z",
        }],
        meta: { page: 1, pageCount: 1 },
      },
    });

    const client = new PaystackClient();
    const transactions = await client.listTransactions({
      from: "2026-06-25T00:00:00.000Z",
      to: "2026-06-26T00:00:00.000Z",
    });

    expect(transactions).toEqual([expect.objectContaining({
      reference: "paystack-ref-1",
      status: "success",
      amount: 1250,
      currency: "NGN",
      processorFee: 15,
      channel: "bank_transfer",
    })]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction",
      expect.objectContaining({
        params: expect.objectContaining({
          from: "2026-06-25",
          to: "2026-06-26",
          perPage: 100,
          page: 1,
        }),
      })
    );
  });
});
