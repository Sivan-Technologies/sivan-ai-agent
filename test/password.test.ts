import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  unusablePasswordHash,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "../src/lib/password";

/**
 * The legacy digest, reproduced here INDEPENDENTLY of the implementation.
 *
 * Deliberately not imported - it is a private function, and a test that called
 * the same code it is verifying would pass even if both were wrong. This is
 * the format that already exists in the production users table, so if these
 * tests and the implementation ever disagree, the implementation is wrong and
 * real users are locked out.
 */
function legacyHash(password: string): string {
  return crypto
    .createHash("sha256")
    .update(password + (process.env.JWT_SECRET || "sivan_salt"))
    .digest("hex");
}

describe("password hashing", () => {
  beforeAll(() => {
    // Pin the pepper so the legacy vectors below are deterministic regardless
    // of what the developer running the suite happens to have exported.
    process.env.JWT_SECRET = "test-jwt-secret";
  });

  it("produces a self-describing scrypt hash, not a bare digest", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const parts = hash.split("$");

    expect(parts[0]).toBe("scrypt");
    expect(parts).toHaveLength(6);
    // The parameters must be embedded so they can be raised later without
    // invalidating credentials already in the table.
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384);
    expect(hash).not.toMatch(/^[a-f0-9]{64}$/i);
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-passphrase");

    expect((await verifyPassword("s3cret-passphrase", hash)).valid).toBe(true);
    expect((await verifyPassword("s3cret-passphras", hash)).valid).toBe(false);
    expect((await verifyPassword("S3cret-passphrase", hash)).valid).toBe(false);
    expect((await verifyPassword("", hash)).valid).toBe(false);
  });

  /**
   * THE DEFECT THAT MOTIVATED THE REWRITE.
   *
   * Under sha256(password + globalPepper), two users who chose the same
   * password stored byte-identical hashes - so one cracked hash broke every
   * account sharing it, and the table was readable with a single rainbow table.
   */
  it("gives two identical passwords different hashes (per-user salt)", async () => {
    const a = await hashPassword("same-password-both-users");
    const b = await hashPassword("same-password-both-users");

    expect(a).not.toBe(b);
    // Both must still verify - different salts, same plaintext.
    expect((await verifyPassword("same-password-both-users", a)).valid).toBe(true);
    expect((await verifyPassword("same-password-both-users", b)).valid).toBe(true);
  });

  describe("legacy SHA-256 migration", () => {
    /**
     * Existing users MUST be able to log in after this deploy. If this test
     * fails, every account created before the migration is locked out.
     */
    it("accepts an existing legacy credential", async () => {
      const stored = legacyHash("my-old-password");
      const result = await verifyPassword("my-old-password", stored);

      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(true);
    });

    it("still rejects a wrong password against a legacy credential", async () => {
      const stored = legacyHash("my-old-password");
      const result = await verifyPassword("not-my-old-password", stored);

      expect(result.valid).toBe(false);
      // Nothing to migrate on a failed attempt - rehashing here would let an
      // attacker overwrite a credential they never proved they knew.
      expect(result.needsRehash).toBe(false);
    });

    it("does not ask to rehash a credential already on current parameters", async () => {
      const hash = await hashPassword("already-modern");
      const result = await verifyPassword("already-modern", hash);

      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(false);
    });

    it("asks to rehash a credential stored under weaker parameters", async () => {
      // A hash written by an older deploy with a lower cost factor.
      const salt = crypto.randomBytes(16);
      const derived = crypto.scryptSync("weak-params", salt, 32, { N: 1024, r: 8, p: 1 });
      const stored = ["scrypt", 1024, 8, 1, salt.toString("base64url"), derived.toString("base64url")].join("$");

      const result = await verifyPassword("weak-params", stored);
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(true);
    });
  });

  /**
   * A corrupt or attacker-supplied credential must fail closed, never throw.
   * A 500 on the login route is both an availability bug and an oracle.
   */
  describe("malformed stored credentials fail closed", () => {
    const malformed = [
      "",
      "not-a-hash",
      "scrypt$",
      "scrypt$16384$8$1$onlyfourparts",
      "scrypt$0$8$1$c2FsdA$aGFzaA",
      "scrypt$abc$8$1$c2FsdA$aGFzaA",
      "scrypt$16384$8$1$$",
      "bcrypt$16384$8$1$c2FsdA$aGFzaA",
      "$".repeat(50),
    ];

    it.each(malformed)("rejects %j without throwing", async (stored) => {
      const result = await verifyPassword("any-password", stored);
      expect(result.valid).toBe(false);
    });

    it("rejects null and undefined credentials", async () => {
      expect((await verifyPassword("pw", undefined)).valid).toBe(false);
      expect((await verifyPassword("pw", null)).valid).toBe(false);
    });
  });

  describe("unusablePasswordHash", () => {
    /**
     * This replaced a hardcoded literal that was shared by every
     * auto-provisioned account. The point is that NOTHING authenticates.
     */
    it("cannot be satisfied by the placeholder it replaced", async () => {
      const hash = await unusablePasswordHash();

      for (const guess of ["temporary_sivan_pass_123", "", "password", hash]) {
        expect((await verifyPassword(guess, hash)).valid).toBe(false);
      }
    });

    it("is different every time", async () => {
      const [a, b] = await Promise.all([unusablePasswordHash(), unusablePasswordHash()]);
      expect(a).not.toBe(b);
    });

    it("is still a well-formed credential the verifier understands", async () => {
      const hash = await unusablePasswordHash();
      expect(hash.split("$")[0]).toBe("scrypt");
    });
  });

  describe("validateNewPassword", () => {
    it("accepts a reasonable password", () => {
      expect(validateNewPassword("a-good-password")).toBeNull();
    });

    it("rejects missing, short, and non-string passwords", () => {
      expect(validateNewPassword(undefined)).toBeTruthy();
      expect(validateNewPassword("")).toBeTruthy();
      expect(validateNewPassword(12345678 as unknown)).toBeTruthy();
      expect(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBeTruthy();
      expect(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    });

    /**
     * An unbounded password is unauthenticated work handed to a stranger:
     * scrypt would hash however many megabytes they cared to POST.
     */
    it("rejects an absurdly long password", () => {
      expect(validateNewPassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toBeTruthy();
      expect(verifyPassword("a".repeat(MAX_PASSWORD_LENGTH + 1), "x")).resolves.toMatchObject({ valid: false });
    });
  });
});
