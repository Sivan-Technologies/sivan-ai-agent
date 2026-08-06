import crypto from "crypto";
import { promisify } from "util";

/**
 * Password hashing for escrow user accounts.
 *
 * Replaces the previous `sha256(password + globalPepper)` scheme, which had
 * three defects: SHA-256 is a fast hash (GPU-crackable at billions of guesses
 * per second), the "salt" was a single global pepper rather than a per-user
 * salt (so identical passwords produced identical digests and the whole table
 * fell to one rainbow table), and it silently defaulted to the literal
 * "sivan_salt" when JWT_SECRET was unset.
 *
 * scrypt is used rather than bcrypt/argon2 deliberately: it is memory-hard,
 * it is in the Node standard library, and it needs no native compilation.
 * This repo already ships a native module (better-sqlite3) that breaks across
 * Node versions; adding another native dependency to the login path would
 * trade one class of risk for another. The same parameters are already used
 * by sivan-payment's two-factor recovery hashing, so the platform is
 * consistent.
 *
 * Stored format (self-describing, so parameters can be raised later without
 * invalidating existing hashes):
 *
 *   scrypt$<N>$<r>$<p>$<salt-base64url>$<hash-base64url>
 */

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/** Current cost parameters. Raise N as hardware improves; old hashes still verify. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * scrypt needs 128 * N * r bytes (16 MiB at these parameters). Node's default
 * maxmem is 32 MiB, which is already enough, but set it explicitly so raising
 * N later fails loudly here instead of at runtime on the login path.
 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const PREFIX = "scrypt";

/**
 * Upper bound on accepted password length. scrypt cost is dominated by N/r
 * rather than input length, but an unbounded input is still free work handed
 * to an unauthenticated caller. 1024 is far above any legitimate passphrase.
 */
export const MAX_PASSWORD_LENGTH = 1024;

/** Minimum accepted password length for newly-created credentials. */
export const MIN_PASSWORD_LENGTH = 8;

function scryptOptions(): crypto.ScryptOptions {
  return { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM };
}

/**
 * A legacy hash is the old scheme's raw SHA-256 hex digest: exactly 64
 * lowercase hex characters with no algorithm prefix.
 */
function isLegacyHash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(stored);
}

/**
 * Recomputes the legacy digest so existing users can still log in once, at
 * which point the caller rehashes them with scrypt.
 *
 * Kept byte-identical to the original implementation - including the
 * "sivan_salt" fallback - because changing it would lock out every existing
 * account rather than migrating it.
 */
function legacyDigest(password: string): string {
  return crypto
    .createHash("sha256")
    .update(password + (process.env.JWT_SECRET || "sivan_salt"))
    .digest("hex");
}

function timingSafeStringEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws a RangeError on length mismatch, so compare lengths
  // first. Length is not the secret here; the digest content is.
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Hashes a password with a fresh random per-user salt.
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password is required");
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("Password exceeds the maximum supported length");
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, scryptOptions());

  return [
    PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export type PasswordVerification = {
  /** True when the supplied password matches the stored credential. */
  valid: boolean;
  /**
   * True when the stored credential used the legacy scheme or older cost
   * parameters. Callers should rehash and persist on a successful login.
   */
  needsRehash: boolean;
};

/**
 * Verifies a password against a stored credential in either the current
 * scrypt format or the legacy SHA-256 format.
 *
 * Never throws on malformed stored values - an unparseable credential is
 * simply a failed verification, so a corrupt row cannot turn a login attempt
 * into a 500.
 */
export async function verifyPassword(
  password: string,
  stored: string | undefined | null,
): Promise<PasswordVerification> {
  const failed: PasswordVerification = { valid: false, needsRehash: false };

  if (!stored || typeof password !== "string" || password.length === 0) return failed;
  if (password.length > MAX_PASSWORD_LENGTH) return failed;

  if (isLegacyHash(stored)) {
    const valid = timingSafeStringEquals(legacyDigest(password), stored);
    return { valid, needsRehash: valid };
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return failed;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return failed;
  if (N <= 0 || r <= 0 || p <= 0) return failed;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(rawSalt, "base64url");
    expected = Buffer.from(rawHash, "base64url");
  } catch {
    return failed;
  }
  if (salt.length === 0 || expected.length === 0) return failed;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    // Stored parameters outside what this process will allocate. Treat as a
    // failed verification rather than surfacing a 500 to the caller.
    return failed;
  }

  const valid = derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  if (!valid) return failed;

  const stale = N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P || expected.length !== KEY_LENGTH;
  return { valid: true, needsRehash: stale };
}

/**
 * Produces a credential that no password can ever satisfy.
 *
 * Used when an account is created or linked without the user choosing a
 * password. The input is 32 random bytes that are discarded immediately, so
 * the resulting account is not password-authenticable by anyone - including
 * whoever provisioned it - rather than sharing a known placeholder value.
 */
export async function unusablePasswordHash(): Promise<string> {
  return hashPassword(crypto.randomBytes(32).toString("base64url"));
}

/**
 * Validates a candidate password for a newly-created credential.
 * Returns null when acceptable, or a caller-safe message when not.
 */
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}
