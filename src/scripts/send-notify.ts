import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const NOTIFICATION_URL = process.env.NOTIFICATION_URL || "http://localhost:3000";
const NOTIFICATION_SECRET = process.env.NOTIFICATION_SECRET || "";

async function sendNotify(to: string, message: string) {
  const res = await fetch(`${NOTIFICATION_URL}/api/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(NOTIFICATION_SECRET ? { "x-notify-secret": NOTIFICATION_SECRET } : {}),
    },
    body: JSON.stringify({ to, message }),
  });

  const text = await res.text();
  console.log("notify response", res.status, text);
}

const args = process.argv.slice(2);
const to = args[0] || "whatsapp:+000000000";
const message = args.slice(1).join(" ") || "Test notification from sivan-escrow-agent";

sendNotify(to, message).catch((err) => {
  console.error("Failed to send notify", err);
  process.exit(1);
});
