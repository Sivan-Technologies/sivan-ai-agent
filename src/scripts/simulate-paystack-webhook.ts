import fetch from "node-fetch";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const PAYSTACK_URL = process.env.CORE_API_BASE_URL || "http://localhost:4000";
const WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || "";

async function sendWebhook(reference: string) {
  const event = {
    event: "charge.success",
    data: {
      reference,
    },
    id: `evt-${Date.now()}`,
  };

  const payload = JSON.stringify(event);
  const signature = crypto.createHmac("sha512", WEBHOOK_SECRET).update(payload).digest("hex");

  const res = await fetch(`${PAYSTACK_URL}/webhooks/paystack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
    body: payload,
  });

  const text = await res.text();
  console.log("webhook response", res.status, text);
}

const args = process.argv.slice(2);
const reference = args[0] || "test-ref-123";
sendWebhook(reference).catch((err) => {
  console.error("Failed to send webhook", err);
  process.exit(1);
});
