import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const WEBHOOK_SECRET = process.env.FLUTTERWAVE_WEBHOOK_SECRET || "test-flw-secret";

async function sendWebhook(reference: string) {
  const event = {
    event: "charge.completed",
    data: {
      tx_ref: reference,
      id: `flw-tx-${Date.now()}`,
      status: "successful",
      amount: 100,
      currency: "NGN",
    },
    id: Date.now(),
  };

  const payload = JSON.stringify(event);

  console.log(`Sending simulated Flutterwave webhook to ${BASE_URL}/webhooks/flutterwave`);
  console.log(`Reference: ${reference}`);
  console.log(`Hash: ${WEBHOOK_SECRET}`);

  const res = await fetch(`${BASE_URL}/webhooks/flutterwave`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "verif-hash": WEBHOOK_SECRET,
    },
    body: payload,
  });

  const text = await res.text();
  console.log("Response status:", res.status);
  console.log("Response body:", text);
}

const args = process.argv.slice(2);
const reference = args[0];
if (!reference) {
  console.error("Error: Please provide a payment reference.");
  console.error("Usage: ts-node src/scripts/simulate-flutterwave-webhook.ts <payment-reference>");
  process.exit(1);
}

sendWebhook(reference).catch((err) => {
  console.error("Failed to send webhook", err);
  process.exit(1);
});
