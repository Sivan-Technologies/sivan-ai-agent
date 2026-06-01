import { describe, expect, it } from "vitest";
import { scoreAccountName } from "../src/services/nameMatch";

describe("scoreAccountName", () => {
  it("strongly matches exact names", () => {
    const result = scoreAccountName("Jonathan Hart", "JONATHAN HART");
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.level).toBe("strong");
    expect(result.acceptable).toBe(true);
  });

  it("accepts middle-name account formats as medium or better", () => {
    const result = scoreAccountName("Jonathan Hart", "JONATHAN BENJAMIN HART");
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.acceptable).toBe(true);
  });

  it("routes weak and failed matches to review or rejection", () => {
    const weak = scoreAccountName("Jonathan Hart", "John Hart");
    const failed = scoreAccountName("Jonathan Hart", "Michael James");

    expect(weak.level).toBe("weak");
    expect(weak.acceptable).toBe(false);
    expect(failed.level).toBe("failed");
    expect(failed.acceptable).toBe(false);
  });
});
