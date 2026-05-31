import { describe, it, expect, vi } from "vitest";
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
