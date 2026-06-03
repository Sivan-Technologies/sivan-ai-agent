import { Request } from "express";

function normalizeIp(ip: string) {
  return ip.trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
}

function ipv4ToInt(ip: string) {
  const parts = normalizeIp(ip).split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return nums.reduce((acc, part) => (acc << 8) + part, 0) >>> 0;
}

function matchesCidr(ip: string, cidr: string) {
  const [range, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function matchesEntry(ip: string, entry: string) {
  const normalizedEntry = normalizeIp(entry);
  if (!normalizedEntry) return false;
  if (normalizedEntry === "*") return true;
  if (normalizedEntry.includes("/")) return matchesCidr(ip, normalizedEntry);
  return normalizeIp(ip) === normalizedEntry;
}

export function getRequestIp(req: Request) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const firstForwarded = typeof forwardedFor === "string" ? forwardedFor.split(",")[0] : "";
  return normalizeIp(req.ip || firstForwarded || req.socket.remoteAddress || "");
}

export function isIpAllowed(ip: string, allowlist = "") {
  const entries = allowlist.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return true;
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;
  return entries.some((entry) => matchesEntry(normalizedIp, entry));
}

