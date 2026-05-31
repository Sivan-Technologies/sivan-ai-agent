import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { warn } from "../lib/logger";

function allowInsecureLocalAuth() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_INSECURE_LOCAL_AUTH === "true";
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function requireCoreApiAuth(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.CORE_API_SECRET;

  if (!expectedSecret) {
    if (!allowInsecureLocalAuth()) {
      return res.status(503).json({ error: "CORE_API_SECRET is not configured" });
    }

    warn("CORE_API_SECRET not configured; allowing insecure local task ingress because ALLOW_INSECURE_LOCAL_AUTH=true");
    return next();
  }

  const providedSecret = req.headers["x-core-api-key"];
  if (typeof providedSecret !== "string" || !safeEquals(providedSecret, expectedSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
