import axios from "axios";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { PalmPayPayoutClient } from "../src/services/palmpayPayoutClient";

vi.mock("axios", () => ({
  default: {
    isAxiosError: (err: unknown) => Boolean(err && typeof err === "object" && "isAxiosError" in err && (err as any).isAxiosError === true),
    post: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios, true);

function keyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function palmpaySign(payload: Record<string, unknown>, privateKey: string) {
  const canonical = Object.keys(payload)
    .filter((key) => key !== "sign" && payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== "")
    .sort()
    .map((key) => `${key}=${String(payload[key]).trim()}`)
    .join("&");
  const digest = crypto.createHash("md5").update(canonical, "utf8").digest("hex").toUpperCase();
  return crypto.createSign("RSA-SHA1").update(digest).sign(privateKey, "base64");
}

describe("PalmPayPayoutClient", () => {
  let merchantKeys: ReturnType<typeof keyPair>;
  let platformKeys: ReturnType<typeof keyPair>;

  beforeEach(() => {
    vi.clearAllMocks();
    merchantKeys = keyPair();
    platformKeys = keyPair();
    (config.palmpay as any).appId = "L231204055835021842101";
    (config.palmpay as any).merchantPrivateKey = merchantKeys.privateKey;
    (config.palmpay as any).platformPublicKey = platformKeys.publicKey;
    (config.palmpay as any).baseUrl = "https://open-gw-sandbox.palmpay-inc.com";
    (config.palmpay as any).countryCode = "NG";
    (config.palmpay as any).timeoutMs = 8000;
    (config.palmpay as any).payoutEnabled = true;
    (config.palmpay as any).payoutNotifyUrl = "https://sivan.example/webhooks/palmpay/payout";
  });

  it("initiates a signed PalmPay payout and converts amount to kobo", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        respCode: "00000000",
        respMsg: "success",
        data: {
          orderId: "PPO123",
          orderNo: "41220723093001",
          orderStatus: 2,
          amount: 10000,
          fee: { fee: 50 },
          sessionId: "100033240509135230000500932911",
          message: "success",
        },
      },
    });

    const client = new PalmPayPayoutClient();
    const result = await client.initiatePayout({
      orderId: "PPO123",
      payeeName: "Sivan Seller",
      payeeBankCode: "000023",
      payeeBankAccNo: "8152522525",
      amount: 100,
      currency: "NAIRA",
      remark: "Sivan proof",
    });

    expect(result).toMatchObject({
      orderId: "PPO123",
      orderNo: "41220723093001",
      status: "succeeded",
      amount: 100,
      fee: 0.5,
      sessionId: "100033240509135230000500932911",
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://open-gw-sandbox.palmpay-inc.com/api/v2/merchant/payment/payout",
      expect.objectContaining({
        orderId: "PPO123",
        amount: 10000,
        currency: "NGN",
        notifyUrl: "https://sivan.example/webhooks/palmpay/payout",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer L231204055835021842101",
          Signature: expect.any(String),
        }),
      })
    );
  });

  it("queries PalmPay payout status", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        respCode: "00000000",
        respMsg: "success",
        data: {
          orderId: "PPO123",
          orderNo: "41220723093001",
          orderStatus: 1,
          amount: 10000,
          fee: { fee: 50 },
          message: "processing",
        },
      },
    });

    const client = new PalmPayPayoutClient();
    await expect(client.queryPayoutStatus({ orderId: "PPO123" })).resolves.toMatchObject({
      orderId: "PPO123",
      orderNo: "41220723093001",
      status: "pending",
      amount: 100,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://open-gw-sandbox.palmpay-inc.com/api/v2/merchant/payment/queryPayStatus",
      expect.objectContaining({ orderId: "PPO123" }),
      expect.any(Object)
    );
  });

  it("verifies and normalizes signed PalmPay payout webhook payloads", () => {
    const payload = {
      orderId: "PPO123",
      orderNo: "41220723093001",
      appId: "L231204055835021842101",
      currency: "NGN",
      amount: 10000,
      orderStatus: 2,
      completeTime: 1782555000000,
    };
    const signature = palmpaySign(payload, platformKeys.privateKey);
    const client = new PalmPayPayoutClient();

    expect(client.verifyWebhookSignature(payload, signature)).toBe(true);
    expect(client.verifyWebhookSignature(payload, "bad-signature")).toBe(false);
    expect(client.normalizeWebhook(payload)).toMatchObject({
      orderId: "PPO123",
      orderNo: "41220723093001",
      status: "succeeded",
      eventType: "payout.order.2",
    });
  });
});
