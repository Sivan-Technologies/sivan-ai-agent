import axios from "axios";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { PalmPayClient } from "../src/services/palmpayClient";

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

describe("PalmPayClient", () => {
  let merchantKeys: ReturnType<typeof keyPair>;
  let platformKeys: ReturnType<typeof keyPair>;

  beforeEach(() => {
    vi.clearAllMocks();
    merchantKeys = keyPair();
    platformKeys = keyPair();
    (config.palmpay as any).appId = "L231204055835021842101";
    (config.palmpay as any).merchantId = "123113005404881";
    (config.palmpay as any).merchantPrivateKey = merchantKeys.privateKey;
    (config.palmpay as any).merchantPublicKey = merchantKeys.publicKey;
    (config.palmpay as any).platformPublicKey = platformKeys.publicKey;
    (config.palmpay as any).baseUrl = "https://open-gw-sandbox.palmpay-inc.com";
    (config.palmpay as any).webhookUrl = "https://sivan.example/webhooks/palmpay";
    (config.palmpay as any).callbackUrl = "https://sivan.example/payment/callback";
    (config.palmpay as any).paymentMethods = ["bank_transfer"];
    (config.palmpay as any).orderExpireSeconds = 1800;
    (config.palmpay as any).timeoutMs = 8000;
    (config.nairaPayments as any).methods = ["bank_transfer"];
  });

  it("creates a PalmPay bank-transfer order and sends amount in kobo", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        respCode: "00000000",
        respMsg: "success",
        data: {
          orderNo: "2424220903032435363613",
          orderStatus: 1,
          checkoutUrl: "https://openapi.transspay.net/open-api/api/v1/payment/h5/redirect",
          payerBankName: "PalmPay Test Bank",
          payerAccountName: "Sivan Collection",
          payerVirtualAccNo: "8792003113",
        },
      },
    });

    const client = new PalmPayClient();
    const result = await client.initializeBankTransferPayment({
      amount: 5500,
      customerEmail: "buyer@sivan.local",
      paymentReference: "PPSIV300682FEB6",
      paymentDescription: "Sivan service agreement SIV-300682-FEB6",
      metadata: { escrowId: "SIV-300682-FEB6" },
    });

    expect(result).toMatchObject({
      paymentReference: "PPSIV300682FEB6",
      transactionReference: "2424220903032435363613",
      checkoutUrl: "https://openapi.transspay.net/open-api/api/v1/payment/h5/redirect",
      accountNumber: "8792003113",
      bankName: "PalmPay Test Bank",
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://open-gw-sandbox.palmpay-inc.com/api/v2/payment/merchant/createorder",
      expect.objectContaining({
        orderId: "PPSIV300682FEB6",
        amount: 550000,
        currency: "NGN",
        productType: "bank_transfer",
        notifyUrl: "https://sivan.example/webhooks/palmpay",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer L231204055835021842101",
          CountryCode: "NG",
          Signature: expect.any(String),
        }),
      })
    );
  });

  it("verifies PalmPay order status and converts kobo back to naira", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        respCode: "00000000",
        respMsg: "success",
        data: {
          orderId: "PPSIV300682FEB6",
          orderNo: "2424220903032435363613",
          currency: "NGN",
          amount: 550000,
          orderStatus: 2,
          productType: "bank_transfer",
          completedTime: 1782068314917,
        },
      },
    });

    const result = await new PalmPayClient().verifyPayment("PPSIV300682FEB6");

    expect(result).toMatchObject({
      paymentReference: "PPSIV300682FEB6",
      transactionReference: "2424220903032435363613",
      status: "success",
      amount: 5500,
      currency: "NGN",
      paymentMethod: "bank_transfer",
    });
  });

  it("lists PalmPay transactions by known Sivan references for reconciliation", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          respCode: "00000000",
          respMsg: "success",
          data: {
            orderId: "PPSIV300682FEB6",
            orderNo: "2424220903032435363613",
            currency: "NGN",
            amount: 550000,
            orderStatus: 2,
            productType: "bank_transfer",
            completedTime: 1782068314917,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          respCode: "00000000",
          respMsg: "success",
          data: {
            orderId: "PPSIV8E5A15C029",
            orderNo: "2424220903032435363614",
            currency: "NGN",
            amount: 1000000,
            orderStatus: 1,
            productType: "bank_transfer",
          },
        },
      });

    const result = await new PalmPayClient().listTransactions({
      references: ["PPSIV300682FEB6", "PPSIV300682FEB6", "PPSIV8E5A15C029", ""],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      paymentReference: "PPSIV300682FEB6",
      status: "success",
      amount: 5500,
      currency: "NGN",
    });
    expect(result[1]).toMatchObject({
      paymentReference: "PPSIV8E5A15C029",
      status: "paying",
      amount: 10000,
      currency: "NGN",
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it("verifies callback signatures with PalmPay platform public key", () => {
    const payload = {
      orderId: "PPSIV300682FEB6",
      orderNo: "2424220903032435363613",
      appId: "L231204055835021842101",
      currency: "NGN",
      amount: 550000,
      orderStatus: 2,
    };
    const canonical = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${String((payload as any)[key]).trim()}`)
      .join("&");
    const digest = crypto.createHash("md5").update(canonical).digest("hex").toUpperCase();
    const signature = encodeURIComponent(crypto.createSign("RSA-SHA1").update(digest).sign(platformKeys.privateKey, "base64"));

    expect(new PalmPayClient().verifyWebhookSignature({ ...payload, sign: signature }, signature)).toBe(true);
  });
});
