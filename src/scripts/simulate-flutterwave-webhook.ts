import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4000";
const WEBHOOK_SECRET = process.env.FLUTTERWAVE_WEBHOOK_SECRET || "test-flw-secret";

async function sendWebhook(reference: string, amount: number) {
  const event = {
    event: "charge.completed",
    data: {
      tx_ref: reference,
      id: `flw-tx-${Date.now()}`,
      status: "successful",
      amount: amount,
      currency: "NGN",
    },
    id: Date.now(),
  };

  const payload = JSON.stringify(event);

  console.log(`Sending simulated Flutterwave webhook to ${BASE_URL}/webhooks/flutterwave`);
  console.log(`Reference: ${reference}`);
  console.log(`Amount: ${amount} NGN`);
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
const amountStr = args[1];

if (!reference) {
  console.error("Error: Please provide a payment reference.");
  console.error("Usage: ts-node src/scripts/simulate-flutterwave-webhook.ts <payment-reference> [amount]");
  process.exit(1);
}

const amount = amountStr ? parseFloat(amountStr) : 100;
if (isNaN(amount)) {
  console.error("Error: Amount must be a valid number.");
  process.exit(1);
}

sendWebhook(reference, amount).catch((err) => {
  console.error("Failed to send webhook", err);
  process.exit(1);
});
