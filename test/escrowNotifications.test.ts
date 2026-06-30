import fs from "fs";
import path from "path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-escrow-notifications.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "https://notify.sivan.test";
process.env.NOTIFICATION_SECRET = "test-notify-secret";
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-example";
process.env.PAYOUT_VERIFICATION_TEST_MODE = "true";
process.env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS = "1234567890";
process.env.PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS = "whatsapp:+2348000000312";

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => "ok",
  json: async () => ({ ok: true }),
}));

vi.stubGlobal("fetch", fetchMock);

const app = (await import("../src/server")).default;
const { escrowStore, opsStore } = await import("../src/context");

function notificationPayloads() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/api/notify"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body || "{}")));
}

describe("Escrow WhatsApp notification delivery", () => {
  beforeAll(() => {
    fetchMock.mockClear();
  });

  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // SQLite may still have the file open while the app is alive.
      }
    }
  });

  it("notifies both buyer and seller with deal cards when a WhatsApp agreement is created, then notifies buyer with payment details after seller accepts", async () => {
    const buyerWhatsapp = "whatsapp:+2348000000311";
    const sellerWhatsapp = "whatsapp:+2348000000312";

    await request(app)
      .post("/api/users/profile")
      .set("x-core-api-key", "test-core-secret")
      .send({ whatsappNumber: sellerWhatsapp, firstName: "Seller", lastName: "Pilot" });

    await request(app)
      .post("/api/users/payout-account")
      .set("x-core-api-key", "test-core-secret")
      .send({
        whatsappNumber: sellerWhatsapp,
        bankName: "Access Bank",
        bankCode: "044",
        accountNumber: "1234567890",
      });

    const created = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `notify-create-${Date.now()}`,
        buyerWhatsapp,
        sellerWhatsapp,
        amount: 20000,
        currency: "NAIRA",
        purpose: "Graphics design for my brand",
        channel: "whatsapp_dm",
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      buyerNotificationSent: true,
      sellerInviteSent: true,
    });
    const escrowId = created.body.escrow.escrowId;

    const createPayloads = notificationPayloads();
    const buyerCreate = createPayloads.find((payload) => payload.to === buyerWhatsapp);
    const sellerCreate = createPayloads.find((payload) => payload.to === sellerWhatsapp);

    expect(buyerCreate).toMatchObject({
      to: buyerWhatsapp,
      dealCard: {
        escrow: expect.objectContaining({ escrowId, status: "PENDING_ACCEPTANCE" }),
        participant: expect.objectContaining({ role: "buyer" }),
      },
    });
    expect(buyerCreate.message).toContain(`Sivan agreement created: ${escrowId}`);
    expect(buyerCreate.message).toContain(`STATUS ${escrowId}`);

    expect(sellerCreate).toMatchObject({
      to: sellerWhatsapp,
      dealCard: {
        escrow: expect.objectContaining({ escrowId, status: "PENDING_ACCEPTANCE" }),
        participant: expect.objectContaining({
          role: "seller",
          allowedActions: expect.arrayContaining(["accept", "status"]),
        }),
      },
    });
    expect(sellerCreate.message).toContain(`ACCEPT ${escrowId}`);

    fetchMock.mockClear();

    const accepted = await request(app)
      .post(`/api/escrows/${escrowId}/accept`)
      .set("x-core-api-key", "test-core-secret")
      .send({ actorWhatsapp: sellerWhatsapp });

    expect(accepted.status).toBe(200);
    expect(accepted.body.escrow.escrow.status).toBe("PENDING_PAYMENT");

    const acceptPayloads = notificationPayloads();
    const buyerPayment = acceptPayloads.find((payload) => payload.to === buyerWhatsapp);
    expect(buyerPayment).toMatchObject({
      to: buyerWhatsapp,
      dealCard: {
        escrow: expect.objectContaining({ escrowId, status: "PENDING_PAYMENT" }),
        participant: expect.objectContaining({
          role: "buyer",
          allowedActions: expect.arrayContaining(["pay", "status"]),
        }),
      },
    });
    expect(buyerPayment.message).toContain(`Service provider accepted agreement ${escrowId}`);
  });

  it("queues a retry job when the WhatsApp notification provider fails during agreement creation", async () => {
    fetchMock.mockRejectedValueOnce(new Error("notify provider down"));

    const created = await request(app)
      .post("/api/escrows")
      .set("x-core-api-key", "test-core-secret")
      .send({
        clientRequestId: `notify-failure-${Date.now()}`,
        buyerWhatsapp: "whatsapp:+2348000000411",
        sellerWhatsapp: "whatsapp:+2348000000412",
        amount: 5500,
        currency: "NAIRA",
        purpose: "Transport to see me",
        channel: "whatsapp_dm",
      });

    expect(created.status).toBe(201);
    const jobs = await opsStore.listQueueJobs(10);
    expect(jobs.some((job) =>
      job.jobType === "whatsapp_notification" &&
      job.payload.includes("notify-failure") === false &&
      job.payload.includes(created.body.escrow.escrowId)
    )).toBe(true);
  });
});
