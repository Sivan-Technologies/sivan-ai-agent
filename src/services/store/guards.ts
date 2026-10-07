/**
 * Provider detection, id generation, identity matching, payout-number
 * encryption and the write Mutex used by the escrow store.
 *
 * Extracted verbatim from escrowStore.ts per FUTURE_BUILD_GOD_SERVICE_SPLIT.md
 * Part 3 §3.1. Pure move: the only edit is adding `export`.
 */

import crypto from "crypto";
import type { Pool } from "pg";
import type { EscrowCurrency, PayoutAccountRecord, StoreProvider } from './types.js';

export function detectProvider(databaseUrl: string, provider?: string): StoreProvider {
  if (provider === "postgres" || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

/**
 * One Postgres schema per process, shared by every store in that process.
 *
 * Vitest runs each test file in its own worker, so this gives each suite the
 * isolation it gets from a temp SQLite file, while the five stores inside a
 * suite still share one namespace exactly as they share one SQLite file.
 * It is random per run, so nothing leaks between runs and no two concurrent
 * workers ever race to create the same schema.
 */
const TEST_PG_SCHEMA = `t_${crypto.randomBytes(8).toString("hex")}`;

export interface StoreTarget {
  databaseUrl: string;
  provider: StoreProvider;
  /** Postgres schema to isolate into. Only set under DATABASE_MODE=test_pg. */
  schema?: string;
}

/**
 * Decide which engine a store instance talks to.
 *
 * Normally this is just detectProvider(). Under DATABASE_MODE=test_pg it
 * instead forces every store onto the Postgres instance at TEST_DATABASE_URL,
 * OVERRIDING the caller's argument -- 17 test files hardcode
 * DATABASE_PROVIDER="sqlite" and those files must not be edited, so the
 * override has to outrank them.
 *
 * Each caller keeps its own isolated Postgres schema, derived from the
 * sqlite path it asked for. That preserves the per-suite isolation the
 * temp-file-per-suite pattern gives under SQLite.
 */
export function resolveStoreTarget(databaseUrl: string, provider?: string): StoreTarget {
  if (process.env.DATABASE_MODE === "test_pg") {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_MODE=test_pg requires TEST_DATABASE_URL to point at a Postgres instance");
    }
    return { databaseUrl: url, provider: "postgres", schema: TEST_PG_SCHEMA };
  }
  return { databaseUrl, provider: detectProvider(databaseUrl, provider) };
}

export function id(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function whatsappLookupVariants(whatsappNumber: string) {
  const trimmed = whatsappNumber.trim();
  const digits = trimmed.replace(/\D/g, "");
  return Array.from(new Set([
    trimmed,
    digits ? `whatsapp:+${digits}` : "",
    digits ? `whatsapp:${digits}` : "",
    digits,
  ].filter(Boolean)));
}

export function whatsappIdentityMatches(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const cleanLeft = left.trim().toLowerCase().replace(/^@/, "").replace(/^whatsapp:/i, "");
  const cleanRight = right.trim().toLowerCase().replace(/^@/, "").replace(/^whatsapp:/i, "");
  if (cleanLeft && cleanRight && cleanLeft === cleanRight) return true;
  const leftDigits = left.replace(/\D/g, "");
  const rightDigits = right.replace(/\D/g, "");
  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

export function payoutEncryptionKey() {
  const configured = process.env.PAYOUT_ENCRYPTION_KEY || "";
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PAYOUT_ENCRYPTION_KEY is required in production");
  }
  return crypto.createHash("sha256").update(configured || "sivan-local-dev-payout-key").digest();
}

export function payoutAccountToken(accountNumber: string) {
  const secret = process.env.PAYOUT_TOKEN_SECRET || process.env.PAYOUT_ENCRYPTION_KEY || process.env.CORE_API_SECRET || "sivan-local-dev-payout-token";
  return `acct:${crypto.createHmac("sha256", secret).update(accountNumber).digest("hex").slice(0, 40)}`;
}

export function highValueThreshold(currency: EscrowCurrency, nairaThreshold: number, usdcThreshold: number) {
  return currency === "NAIRA" ? nairaThreshold : usdcThreshold;
}

export function payoutNameMatchAcceptable(payout: PayoutAccountRecord) {
  return payout.nameMatchLevel === "strong" || payout.nameMatchLevel === "medium";
}

export function encryptAccountNumber(accountNumber: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", payoutEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accountNumber, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptAccountNumber(value?: string | null) {
  if (!value?.startsWith("enc:v1:")) return null;
  const [, , iv, tag, encrypted] = value.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", payoutEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function maskAccountNumber(accountNumber?: string | null, last4?: string | null) {
  const suffix = last4 || accountNumber?.replace(/\D/g, "").slice(-4) || "";
  return suffix ? `****${suffix}` : "****";
}

export class Mutex {
  private queue: Promise<void> = Promise.resolve();

  public async acquire(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.queue;
    this.queue = next;
    await current;
    return release!;
  }
}

/**
 * Serialise schema DDL across every process sharing a test_pg database.
 *
 * CREATE TABLE/SCHEMA IF NOT EXISTS is NOT race-safe in Postgres: two workers
 * running it concurrently collide on the catalog indexes
 * (pg_type_typname_nsp_index, pg_class_relname_nsp_index). A session advisory
 * lock makes initialisation single-file. test_pg only.
 */
export async function withSchemaLock<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const KEY = 727401;
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${KEY})`);
    return await fn();
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${KEY})`);
    } finally {
      client.release();
    }
  }
}
