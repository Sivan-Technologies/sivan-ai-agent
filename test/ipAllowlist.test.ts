import { describe, expect, it } from "vitest";
import { isIpAllowed } from "../src/middleware/ipAllowlist";

describe("IP allowlist matching", () => {
  it("allows requests when no allowlist is configured", () => {
    expect(isIpAllowed("203.0.113.10", "")).toBe(true);
  });

  it("matches exact IPv4 addresses", () => {
    expect(isIpAllowed("203.0.113.10", "203.0.113.10")).toBe(true);
    expect(isIpAllowed("203.0.113.11", "203.0.113.10")).toBe(false);
  });

  it("matches IPv4 CIDR ranges", () => {
    expect(isIpAllowed("198.51.100.42", "198.51.100.0/24")).toBe(true);
    expect(isIpAllowed("198.51.101.42", "198.51.100.0/24")).toBe(false);
  });

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(isIpAllowed("::ffff:203.0.113.10", "203.0.113.10")).toBe(true);
  });
});
