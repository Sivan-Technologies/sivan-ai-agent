import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { EscrowStore } from "../src/services/escrowStore";

/**
 * Telegram account linking - identity invariants.
 *
 * The property under test is the one that produced duplicate accounts: a
 * messaging handle must ATTACH to an account, never CREATE one, and a single
 * Telegram account must never be claimed by two Sivan users.
 *
 * `legacyStore` deliberately builds a PRE-migration database rather than a
 * fresh one. A fresh database only proves the CREATE TABLE is correct, but
 * production is an existing database, so the ALTER path is the one that can
 * actually break - and the one worth testing.
 */

const TEST_DB_PATH = path.resolve(__dirname, "../data/test-telegram-link.db");
let store: EscrowStore | null = null;

/** A database as production has it today: users keyed on phone, no Telegram columns. */
function legacyStore() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

  const legacy = new Database(TEST_DB_PATH);
  legacy.exec(`
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      whatsapp_number TEXT NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role_history TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  const insert = legacy.prepare(
    `INSERT INTO users (user_id, whatsapp_number, role_history, created_at, updated_at) VALUES (?, ?, '["buyer"]', ?, ?)`
  );
  insert.run("user-ada", "+2348010000001", now, now);
  insert.run("user-bola", "+2348010000002", now, now);
  legacy.close();

  store = new EscrowStore(TEST_DB_PATH, "sqlite");
  return store;
}

describe("Telegram account linking", () => {
  afterEach(async () => {
    await store?.close();
    store = null;
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("migrates an existing database without disturbing its data", async () => {
    const escrowStore = legacyStore();
    const ada = await escrowStore.getUserById("user-ada");
    expect(ada?.whatsappNumber).toBe("+2348010000001");
    expect(ada?.telegramUserId).toBeUndefined();
  });

  it("does not create an account for an unrecognised Telegram id", async () => {
    // This is the exact step that used to mint a duplicate account.
    const escrowStore = legacyStore();
    expect(await escrowStore.findUserByTelegramId("555000111")).toBeNull();
  });

  it("attaches Telegram to the existing account rather than creating one", async () => {
    const escrowStore = legacyStore();
    const token = await escrowStore.generatePairingToken("user-ada");
    const linked = await escrowStore.linkTelegramAccount(token, "555000111", "ada_tg");

    expect(linked?.userId).toBe("user-ada");
    expect(linked?.telegramUserId).toBe("555000111");
    expect(linked?.telegramVerifiedAt).toBeTruthy();
  });

  it("resolves one account from either handle", async () => {
    const escrowStore = legacyStore();
    await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-ada"), "555000111", "ada_tg");

    const viaTelegram = await escrowStore.findUserByTelegramId("555000111");
    const viaWhatsapp = await escrowStore.findUserByWhatsapp("+2348010000001");
    expect(viaTelegram?.userId).toBe(viaWhatsapp?.userId);
  });

  it("does not create a second account when the Telegram SIM differs from the WhatsApp SIM", async () => {
    // The scenario that motivated this work: same human, two phone numbers.
    const escrowStore = legacyStore();
    await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-ada"), "555000111", "ada_tg");

    expect(await escrowStore.findUserByWhatsapp("+2349029999999")).toBeNull();
    expect((await escrowStore.findUserByTelegramId("555000111"))?.userId).toBe("user-ada");
  });

  it("rejects a replayed pairing token", async () => {
    const escrowStore = legacyStore();
    const token = await escrowStore.generatePairingToken("user-ada");
    await escrowStore.linkTelegramAccount(token, "555000111", "ada_tg");

    expect(await escrowStore.linkTelegramAccount(token, "555000111")).toBeNull();
  });

  it("returns null for an unknown token without revealing whether it existed", async () => {
    const escrowStore = legacyStore();
    expect(await escrowStore.linkTelegramAccount("SVN-ZZZZ-99", "555000111")).toBeNull();
  });

  it("refuses to let two accounts claim one Telegram account", async () => {
    const escrowStore = legacyStore();
    await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-ada"), "555000111", "ada_tg");

    const bolaToken = await escrowStore.generatePairingToken("user-bola");
    await expect(escrowStore.linkTelegramAccount(bolaToken, "555000111", "bola_tg"))
      .rejects.toThrow(/already linked to another Sivan account/);

    // The failed attempt must leave the original link intact.
    expect((await escrowStore.findUserByTelegramId("555000111"))?.userId).toBe("user-ada");
  });

  it("releases the Telegram id on unlink so it can be claimed later", async () => {
    const escrowStore = legacyStore();
    await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-ada"), "555000111", "ada_tg");

    await escrowStore.unlinkTelegram("user-ada");
    expect(await escrowStore.findUserByTelegramId("555000111")).toBeNull();

    const relinked = await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-bola"), "555000111", "bola_tg");
    expect(relinked?.userId).toBe("user-bola");
  });

  it("keeps WhatsApp linking working alongside Telegram", async () => {
    // Regression guard: the two channels are independent handles on one account.
    const escrowStore = legacyStore();
    await escrowStore.linkTelegramAccount(await escrowStore.generatePairingToken("user-ada"), "555000111", "ada_tg");

    const ada = await escrowStore.getUserById("user-ada");
    expect(ada?.whatsappNumber).toBe("+2348010000001");
    expect(ada?.telegramUserId).toBe("555000111");
  });
});
