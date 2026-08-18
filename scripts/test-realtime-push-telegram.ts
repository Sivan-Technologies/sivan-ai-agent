import express from "express";
import { notifyTelegramBot } from "../src/services/notificationService";

async function testRealtimePush() {
  console.log("================================================================");
  console.log("📡 TESTING REAL-TIME TELEGRAM PUSH NOTIFICATION DISPATCH");
  console.log("================================================================");

  // Setup a mock local receiver representing Telegram Layer /api/notify
  const app = express();
  app.use(express.json());

  const receivedPushes: any[] = [];
  app.post("/api/notify", (req, res) => {
    console.log("📥 [Telegram Layer Received Push]:", JSON.stringify(req.body, null, 2));
    receivedPushes.push(req.body);
    res.json({ ok: true });
  });

  const server = app.listen(9876);
  process.env.TELEGRAM_NOTIFICATION_URL = "http://127.0.0.1:9876";

  try {
    // 1. Simulate Push when Buyer Funds Agreement
    console.log("\n[1] Testing Push on Agreement Funding...");
    await notifyTelegramBot(
      "+2348079604214",
      "💰 Agreement funded! 15.00 USDC has been locked into SIV-471082-91BE.",
      {
        escrow: { escrowId: "SIV-471082-91BE", amount: 15, currency: "USDC", purpose: "software update" },
        participant: { role: "seller", displayStatus: "In progress", allowedActions: ["deliver"] },
      },
      "8756506224"
    );

    // 2. Simulate Push when Seller Submits Delivery
    console.log("\n[2] Testing Push on Seller Delivery Submission...");
    await notifyTelegramBot(
      "+2349136717403",
      "📦 Delivery submitted for SIV-471082-91BE. Please review and release funds.",
      {
        escrow: { escrowId: "SIV-471082-91BE", amount: 15, currency: "USDC", purpose: "software update" },
        participant: { role: "buyer", displayStatus: "Delivered", allowedActions: ["release", "dispute"] },
      },
      "1767972274"
    );

    // 3. Simulate Push when Buyer Releases Funds
    console.log("\n[3] Testing Push on Settlement Release...");
    await notifyTelegramBot(
      "+2348079604214",
      "🎉 Funds released! 15.00 USDC has been transferred to your Solana wallet (Tx: rzy7g6peNtFJK7F9zqXDSNnToHXgSV6txkT5NB79SVyJGdxh9h7LHoSZgA18PavHoWDHSjVgSxNjdqs1VUdj4gP).",
      {
        escrow: { escrowId: "SIV-471082-91BE", amount: 15, currency: "USDC", purpose: "software update" },
        participant: { role: "seller", displayStatus: "Released", allowedActions: [] },
      },
      "8756506224"
    );

    if (receivedPushes.length !== 3) {
      throw new Error(`Expected 3 pushes, received ${receivedPushes.length}`);
    }

    console.log("\n================================================================");
    console.log("✅ REAL-TIME PUSH DISPATCH SUCCESSFULLY VERIFIED (3/3 EVENTS)!");
    console.log("================================================================");
  } finally {
    server.close();
  }
}

testRealtimePush().catch((err) => {
  console.error("Push test failed:", err);
  process.exit(1);
});
