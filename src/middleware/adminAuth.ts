import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { error, info, warn } from "../lib/logger";
import jwt from "jsonwebtoken";
import { getRequestIp, isIpAllowed } from "./ipAllowlist";
import { ADMIN_JWT_ALGORITHMS, ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER } from "../lib/adminJwtClaims";

// Requires an explicit `development` NODE_ENV rather than "anything that is not
// production", so an unset or misspelled NODE_ENV fails closed instead of
// silently enabling the local auth bypass.
function allowInsecureLocalAuth() {
  return process.env.NODE_ENV === "development" && process.env.ALLOW_INSECURE_LOCAL_AUTH === "true";
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Middleware to verify admin API key from header or env.
 * Sets req.adminUser on success.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  const adminJwtSecret = process.env.ADMIN_JWT_SECRET || process.env.SESSION_TOKEN_SECRET || "";
  const adminIpAllowlist = process.env.ADMIN_IP_ALLOWLIST || process.env.ADMIN_ALLOWED_IPS || "";
  const requestIp = getRequestIp(req);

  if (!isIpAllowed(requestIp, adminIpAllowlist)) {
    warn("Admin request blocked by IP allowlist", { requestIp });
    return res.status(403).json({ error: "Admin access is not allowed from this network" });
  }

  // 1) If Authorization: Bearer <jwt> provided, validate JWT first
  const authHeader = (req.headers["authorization"] || "") as string;
  if (authHeader.startsWith("Bearer ")) {
    if (!adminJwtSecret) {
      return res.status(501).json({ error: "JWT auth not configured on this server" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    try {
      // Pin the algorithm and require the issuer/audience minted by
      // telegram-admin-auth, so a token issued for another service that happens
      // to share this secret is not accepted here.
      const payload = jwt.verify(token, adminJwtSecret, {
        algorithms: ADMIN_JWT_ALGORITHMS,
        issuer: ADMIN_JWT_ISSUER,
        audience: ADMIN_JWT_AUDIENCE,
      }) as any;
      (req as any).adminUser = payload.adminIdentifier || payload.sub || "admin";
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
    }
  }

  // 2) Fallback to legacy static admin key if configured
  if (!adminApiKey) {
    if (!allowInsecureLocalAuth()) {
      error("ADMIN_API_KEY not configured");
      return res.status(503).json({ error: "Admin authentication is not configured" });
    }

    warn("ADMIN_API_KEY not configured; allowing insecure local admin auth because ALLOW_INSECURE_LOCAL_AUTH=true");
    (req as any).adminUser = "anonymous";
    return next();
  }

  const providedKey = req.headers["x-admin-key"];
  if (typeof providedKey !== "string" || !safeEquals(providedKey, adminApiKey)) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing admin key" });
  }

  // The static-key path proves possession of ADMIN_API_KEY but not the identity
  // of the caller. Deriving the audit identity from a client-supplied header
  // would let any key holder forge attribution, so record the credential used.
  (req as any).adminUser = "static-key";
  next();
}

/**
 * Middleware to log admin actions.
 */
export function logAdminAction(actionName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const adminUser = (req as any).adminUser || "unknown";
    const ip = getRequestIp(req) || "unknown";
    info(`[ADMIN_ACTION] ${actionName}`, { actionName, adminUser, ip });
    next();
  };
}
