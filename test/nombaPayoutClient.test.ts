import axios from "axios";
import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config";
import { NombaPayoutClient } from "../src/services/nombaPayoutClient";

vi.mock("axios", () => ({
  default: {
    isAxiosError: (err: unknown) => Boolean(err && typeof err === "object" && "isAxiosError" in err && (err as any).isAxiosError === true),
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios, true);

describe("NombaPayoutClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (config.nomba as any).clientId = "nomba-client-id";
    (config.nomba as any).clientSecret = "nomba-client-secret";
    (config.nomba as any).accountId = "nomba-account-id";
    (config.nomba as any).baseUrl = "https://sandbox.nomba.com";
    (config.nomba as any).timeoutMs = 8000;
    (config.nomba as any).payoutEnabled = true;
    (config.nomba as any).senderName = "Sivan";
    (config.nomba as any).subAccountId = "";
    (config.nomba as any).webhookSecret = "nomba-webhook-secret";
  });

  it("fetches banks with OAuth token and accountId header", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { data: { access_token: "access-token", expires_in: 1800 } },
    });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        code: "00",
        data: {
          results: [
            { name: "First Bank of Nigeria", code: "011", nipCode: null, logo: "https://bank/logo.png" },
          ],
        },
      },
    });

    const client = new NombaPayoutClient();
    await expect(client.listBanks()).resolves.toEqual([
      { name: "First Bank of Nigeria", code: "011", nipCode: null, logo: "https://bank/logo.png" },
    ]);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://sandbox.nomba.com/v1/auth/token/issue",
      expect.objectContaining({
        grant_type: "client_credentials",
        client_id: "nomba-client-id",
        client_secret: "nomba-client-secret",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ accountId: "nomba-account-id" }),
      })
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://sandbox.nomba.com/v1/transfers/banks",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          accountId: "nomba-account-id",
        }),
      })
    );
  });

  it("looks up a bank account before transfer", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { data: { access_token: "access-token", expires_in: 1800 } } })
      .mockResolvedValueOnce({
        data: {
          code: "00",
          description: "Success",
          data: { accountNumber: "0554772814", accountName: "M.A Animashaun" },
        },
      });

    const client = new NombaPayoutClient();
    await expect(client.lookupBankAccount("0554772814", "053")).resolves.toEqual({
      accountNumber: "0554772814",
      accountName: "M.A Animashaun",
      bankCode: "053",
    });

    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      "https://sandbox.nomba.com/v1/transfers/bank/lookup",
      { accountNumber: "0554772814", bankCode: "053" },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      })
    );
  });

  it("initiates a Nomba bank transfer and keeps merchantTxRef as idempotency key", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { data: { access_token: "access-token", expires_in: 1800 } } })
      .mockResolvedValueOnce({
        data: {
          code: "00",
          description: "Success",
          data: {
            id: "API-TRANSFER-02415-8857",
            status: "SUCCESS",
            amount: 3500,
            fee: 50,
            meta: { merchantTxRef: "NOMBA_release_SIV_123" },
          },
        },
      });

    const client = new NombaPayoutClient();
    await expect(client.initiateBankTransfer({
      merchantTxRef: "NOMBA_release_SIV_123",
      accountNumber: "055472814",
      accountName: "M.A Animashaun",
      bankCode: "058",
      amount: 3500,
      currency: "NAIRA",
      narration: "Sivan escrow release",
    })).resolves.toMatchObject({
      merchantTxRef: "NOMBA_release_SIV_123",
      transactionId: "API-TRANSFER-02415-8857",
      status: "succeeded",
      amount: 3500,
      fee: 50,
      currency: "NAIRA",
    });

    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      "https://sandbox.nomba.com/v2/transfers/bank",
      expect.objectContaining({
        amount: 3500,
        accountNumber: "055472814",
        accountName: "M.A Animashaun",
        bankCode: "058",
        merchantTxRef: "NOMBA_release_SIV_123",
        senderName: "Sivan",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      })
    );
  });

  it("treats 201/PENDING_BILLING transfer responses as pending", async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { data: { access_token: "access-token", expires_in: 1800 } } })
      .mockResolvedValueOnce({
        data: {
          code: "201",
          description: "PROCESSING",
          message: "Unable to process response, please rely on web hook",
          data: { id: "API-TRANSFER-PENDING", status: "PENDING_BILLING" },
        },
      });

    const client = new NombaPayoutClient();
    await expect(client.initiateBankTransfer({
      merchantTxRef: "NOMBA_release_SIV_PENDING",
      accountNumber: "055472814",
      accountName: "M.A Animashaun",
      bankCode: "058",
      amount: 3500,
      currency: "NAIRA",
    })).resolves.toMatchObject({
      status: "pending",
      transactionId: "API-TRANSFER-PENDING",
    });
  });

  it("verifies webhook signatures with HMAC-SHA256 over the raw body", () => {
    const client = new NombaPayoutClient();
    const rawBody = JSON.stringify({ event_type: "payout_success", data: { id: "API-TRANSFER-1" } });
    const signature = crypto.createHmac("sha256", "nomba-webhook-secret").update(rawBody).digest("base64");

    expect(client.verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(client.verifyWebhookSignature(rawBody, "wrong-signature")).toBe(false);
  });

  it("verifies Nomba's documented canonical webhook signature string", () => {
    const client = new NombaPayoutClient();
    const payload = {
      event_type: "payout_success",
      requestId: "request-123",
      data: {
        merchant: {
          name: "Sivan",
          walletId: "wallet-123",
        },
        transaction: {
          transactionId: "API-TRANSFER-1",
          type: "transfer",
          status: "SUCCESS",
          amount: 3500,
          fee: 50,
          transactionAmount: 3500,
          transactionFee: 50,
          createdAt: "2026-06-27T09:00:00Z",
          timeCreated: "2026-06-27T09:00:00Z",
          terminalId: "terminal-1",
          merchantTxRef: "NOMBA_release_SIV_123",
        },
      },
    };
    const timestamp = "2026-06-27T09:01:00Z";
    const canonical =
      "payout_success" +
      "request-123" +
      "Sivan" +
      "wallet-123" +
      "API-TRANSFER-1" +
      "transfer" +
      "SUCCESS" +
      "3500" +
      "50" +
      "3500" +
      "50" +
      "2026-06-27T09:00:00Z" +
      "2026-06-27T09:00:00Z" +
      "terminal-1" +
      "NOMBA_release_SIV_123" +
      timestamp;
    const signature = crypto.createHmac("sha256", "nomba-webhook-secret").update(canonical).digest("base64");

    expect(client.verifyWebhookSignature(JSON.stringify(payload), signature, timestamp)).toBe(true);
  });
});
