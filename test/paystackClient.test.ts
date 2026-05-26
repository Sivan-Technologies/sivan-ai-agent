import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { PaystackClient } from "../src/services/paystackClient";
import { config } from "../src/config";

describe("PaystackClient.verifyWebhookSignature", () => {
  it("validates a known signature", async () => {
    // set a temporary secret in config for the test
    (config.paystack as any).secretKey = "test-secret";
    const client = new PaystackClient();
    const payload = JSON.stringify({ event: "test", data: { reference: "ref-1" } });
    const signature = crypto.createHmac("sha512", "test-secret").update(payload).digest("hex");

    const ok = await client.verifyWebhookSignature(payload, signature);
    expect(ok).toBe(true);
  });
});
