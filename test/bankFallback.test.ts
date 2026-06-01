import { describe, expect, it } from "vitest";
import { filterBanks, NIGERIA_BANK_FALLBACKS } from "../src/services/bankFallback";

describe("bankFallback", () => {
  it("contains common Nigerian banks for offline bank search fallback", () => {
    const names = NIGERIA_BANK_FALLBACKS.map((bank) => bank.name);
    expect(names).toContain("Guaranty Trust Bank");
    expect(names).toContain("Kuda Bank");
    expect(names).toContain("Opay");
  });

  it("filters by name, code, or slug", () => {
    expect(filterBanks(NIGERIA_BANK_FALLBACKS, "guaranty").map((bank) => bank.code)).toContain("058");
    expect(filterBanks(NIGERIA_BANK_FALLBACKS, "50211")[0].name).toBe("Kuda Bank");
  });
});
