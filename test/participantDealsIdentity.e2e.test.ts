/**
 * End-to-end regression cover for GET /api/users/escrows identity matching.
 *
 * Three separate bugs made this endpoint return an empty list (or a 400) to a
 * user who demonstrably had deals. Each is asserted here against the real
 * Express app and a real SQLite store — no mocking of the route or the store.
 *
 *   1. Collapsing the resolved identity set to a single "primary" actor.
 *      sivan-payment always appends its OWN user id as actorUserId. That id is
 *      unknown to this service, but it won precedence, so role resolution
 *      failed on every row and the deals were discarded after being fetched.
 *
 *   2. A repeated query key (?actorUserId=a&actorUserId=b) arrives as an array
 *      and the zod schema rejected it, 400-ing the whole lookup. Linking a
 *      channel — the step meant to reveal your deals — hid all of them.
 *
 *   3. createdByChannel was missing from the payload, so every WhatsApp and
 *      Telegram deal was mislabelled as created on the web.
 */

import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-participant-deals-identity.db");
process.env.DATABASE_URL = TEST_DB_PATH;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.CORE_API_SECRET = "test-core-secret";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.NOTIFICATION_URL = "";

if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

const app = (await import("../src/server")).default;
const { escrowStore } = await import("../src/context");

const CORE = { "x-core-api-key": "test-core-secret" };

/**
 * A user id belonging to sivan-payment. This service has never seen it — it is
 * exactly the value that used to poison the lookup.
 */
const FOREIGN_PAYMENT_USER_ID = "usr_a6451f7c-0000-4000-8000-ffffffffffff";

const BUYER_WHATSAPP = "whatsapp:+2348000000777";
const BUYER_EMAIL = "demo.buyer.identity@sivan.test";

let buyerUserId = "";
let escrowId = "";

describe("GET /api/users/escrows — multi-identity participant matching", () => {
  beforeAll(async () => {
    const buyer = await escrowStore.upsertUserByWhatsapp(BUYER_WHATSAPP, "buyer");
    buyerUserId = buyer.userId;
    await escrowStore.updateUserProfile(buyer.userId, "Demo", "Buyer", BUYER_EMAIL);

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerWhatsapp: "whatsapp:+2348000000778",
      amount: 50000,
      currency: "NAIRA",
      purpose: "Identity matching end-to-end check",
      createdByChannel: "whatsapp",
    });
    escrowId = escrow.escrowId;
  });

  afterAll(async () => {
    await escrowStore.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // SQLite file lock on some platforms; harmless for a temp test db.
      }
    }
  });

  it("control: finds the deal by email alone", async () => {
    const res = await request(app)
      .get("/api/users/escrows")
      .query({ actorEmail: BUYER_EMAIL })
      .set(CORE);

    expect(res.status).toBe(200);
    expect(res.body.deals).toHaveLength(1);
    expect(res.body.deals[0].escrow.escrowId).toBe(escrowId);
  });

  it("bug 1: still finds the deal when sivan-payment appends its own unknown actorUserId", async () => {
    const res = await request(app)
      .get("/api/users/escrows")
      .query({ actorEmail: BUYER_EMAIL, actorUserId: FOREIGN_PAYMENT_USER_ID })
      .set(CORE);

    expect(res.status).toBe(200);
    // Before the fix this was [] — the foreign id won precedence and every row
    // was dropped by buildParticipantDealSummary returning null.
    expect(res.body.deals).toHaveLength(1);
    expect(res.body.deals[0].escrow.escrowId).toBe(escrowId);
    expect(res.body.deals[0].participant.role).toBe("buyer");
  });

  it("bug 2: a repeated actorUserId key does not 400 the lookup", async () => {
    const res = await request(app)
      .get(`/api/users/escrows?actorUserId=${buyerUserId}&actorUserId=${FOREIGN_PAYMENT_USER_ID}`)
      .set(CORE);

    // Before the fix: 400 "expected string, received array".
    expect(res.status).toBe(200);
    expect(res.body.deals).toHaveLength(1);
    expect(res.body.deals[0].escrow.escrowId).toBe(escrowId);
  });

  it("bug 2b: a repeated actorWhatsapp key is also tolerated", async () => {
    const res = await request(app)
      .get(`/api/users/escrows?actorWhatsapp=${encodeURIComponent(BUYER_WHATSAPP)}&actorWhatsapp=${encodeURIComponent("whatsapp:+2340000000000")}`)
      .set(CORE);

    expect(res.status).toBe(200);
    expect(res.body.deals).toHaveLength(1);
  });

  it("bug 3: the payload carries createdByChannel so the deal is labelled correctly", async () => {
    const res = await request(app)
      .get("/api/users/escrows")
      .query({ actorWhatsapp: BUYER_WHATSAPP })
      .set(CORE);

    expect(res.status).toBe(200);
    expect(res.body.deals).toHaveLength(1);
    // Before the fix this field was absent and the web app defaulted to "web".
    expect(res.body.deals[0].escrow.createdByChannel).toBe("whatsapp");
  });

  it("a genuinely unrelated identity still gets nothing", async () => {
    const res = await request(app)
      .get("/api/users/escrows")
      .query({ actorWhatsapp: "whatsapp:+2349999999999" })
      .set(CORE);

    expect(res.status).toBe(200);
    expect(res.body.deals).toHaveLength(0);
  });
});
