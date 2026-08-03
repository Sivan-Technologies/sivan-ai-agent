import type { Algorithm } from "jsonwebtoken";

/**
 * Shared admin JWT claim contract.
 *
 * Admin session tokens are minted by the `telegram-admin-auth` service and
 * accepted by this service's admin endpoints. Because both services may be
 * configured with the same signing secret (SESSION_TOKEN_SECRET), a bare
 * signature check is not sufficient to prove a token was intended for this
 * audience. Every issuer and verifier must therefore agree on these values.
 *
 * Keep in sync with `telegram-admin-auth/src/adminJwtClaims.ts`.
 *
 * Changing any value here invalidates all in-flight admin tokens and requires a
 * coordinated deploy: roll out the issuer (telegram-admin-auth) first, then the
 * verifiers.
 */

/** `iss` claim — the service that mints admin session tokens. */
export const ADMIN_JWT_ISSUER = "sivan-telegram-admin-auth";

/** `aud` claim — the admin API surface those tokens are valid against. */
export const ADMIN_JWT_AUDIENCE = "sivan-admin-api";

/**
 * Pinned signing algorithm. Restricting verification to a fixed symmetric
 * algorithm prevents algorithm-confusion attacks, where a caller supplies a
 * token with a different `alg` header (for example `none`, or an asymmetric
 * algorithm that would cause a public key to be treated as an HMAC secret).
 */
export const ADMIN_JWT_ALGORITHM: Algorithm = "HS256";

/** Verifier-side allowlist. Kept as a single-element list on purpose. */
export const ADMIN_JWT_ALGORITHMS: Algorithm[] = [ADMIN_JWT_ALGORITHM];
