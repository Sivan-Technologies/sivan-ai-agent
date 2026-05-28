import { Request, Response, NextFunction } from "express";
import { error, warn } from "../lib/logger";
import jwt from "jsonwebtoken";

/**
 * Middleware to verify admin API key from header or env.
 * Sets req.adminUser on success.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  const adminJwtSecret = process.env.ADMIN_JWT_SECRET || process.env.SESSION_TOKEN_SECRET || "";

  // 1) If Authorization: Bearer <jwt> provided, validate JWT first
  const authHeader = (req.headers["authorization"] || "") as string;
  if (authHeader.startsWith("Bearer ")) {
    if (!adminJwtSecret) {
      return res.status(501).json({ error: "JWT auth not configured on this server" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const payload = jwt.verify(token, adminJwtSecret) as any;
      (req as any).adminUser = payload.adminIdentifier || payload.sub || "admin";
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
    }
  }

  // 2) Fallback to legacy static admin key if configured
  if (!adminApiKey) {
    if (process.env.NODE_ENV === "production") {
      error("ADMIN_API_KEY not configured in production");
      return res.status(503).json({ error: "Admin authentication is not configured" });
    }

    warn("ADMIN_API_KEY not configured; skipping auth in non-production mode");
    (req as any).adminUser = "anonymous";
    return next();
  }

  const providedKey = req.headers["x-admin-key"] as string;
  if (!providedKey || providedKey !== adminApiKey) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing admin key" });
  }

  (req as any).adminUser = req.headers["x-admin-user"] || "unknown";
  next();
}

/**
 * Middleware to log admin actions.
 */
export function logAdminAction(actionName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const adminUser = (req as any).adminUser || "unknown";
    const ip = req.ip || "unknown";
    console.log(`[ADMIN_ACTION] ${actionName} by ${adminUser} from ${ip}`);
    next();
  };
}
