import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { warn } from "../lib/logger";
import { getRequestIp, isIpAllowed } from "./ipAllowlist";

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

export function requireCoreApiAuth(req: Request, res: Response, next: NextFunction) {
  const expectedSecret = process.env.CORE_API_SECRET;
  const coreIpAllowlist = process.env.CORE_API_IP_ALLOWLIST || process.env.CORE_API_ALLOWED_IPS || "";
  const requestIp = getRequestIp(req);

  if (!isIpAllowed(requestIp, coreIpAllowlist)) {
    warn("Core API request blocked by IP allowlist", { requestIp });
    return res.status(403).json({ error: "Core API access is not allowed from this network" });
  }

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
