import { describe, expect, it } from "vitest";
import { __test__ } from "../src/instrument";

describe("Sentry redaction", () => {
  it("handles circular objects without overflowing the stack", () => {
    const circular: any = { accountNumber: "0123456789", nested: {} };
    circular.nested.parent = circular;
    circular.list = [circular];

    const redacted = __test__.redactForSentry(circular) as any;

    expect(redacted.accountNumber).toBe("[Filtered]");
    expect(redacted.nested.parent).toBe("[Circular]");
    expect(redacted.list[0]).toBe("[Circular]");
  });
});
