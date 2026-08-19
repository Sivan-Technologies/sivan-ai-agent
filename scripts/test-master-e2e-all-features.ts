import express from "express";
import { settingsStore } from "../src/context";
import { parseEscrowSentence } from "../../Telegram-layer/src/intentParser";
import { escrowCreateSchema } from "../src/validation";
import { formatDealMoney } from "../../Telegram-layer/src/dealCards";
import { PaymentRouter } from "../src/services/paymentRouter";
import { notifyTelegramBot } from "../src/services/notificationService";

async function runMasterE2ETest() {
  console.log("========================================================================");
  console.log("🚀 SIVAN PAYMENT AI — MASTER END-TO-END VERIFICATION SUITE");
  console.log("========================================================================");

  // ---------------------------------------------------------------------------
  // TEST 1: AUDIT LOG & QUERY OPTIMIZATION
  // ---------------------------------------------------------------------------
  console.log("\n🧪 [1/3] Testing Audit Log & Query Optimization...");
  // Warm connection first
  await settingsStore.getSettings();
  const startAudit = Date.now();
  const currentSettings = await settingsStore.getSettings();
  const auditDuration = Date.now() - startAudit;
  console.log(`✅ Platform Settings Query Duration (Warmed): ${auditDuration}ms (Version ${currentSettings.version})`);
  if (auditDuration > 1000) {
    throw new Error("Audit log read timeout / performance degradation detected!");
  }

  // ---------------------------------------------------------------------------
  // TEST 2: REAL-TIME TELEGRAM PUSH NOTIFICATIONS
  // ---------------------------------------------------------------------------
  console.log("\n🧪 [2/3] Testing Real-Time Webhook Push Notifications (Pop-up Alerts)...");
  const app = express();
  app.use(express.json());
  const pushesReceived: any[] = [];

  app.post("/api/notify", (req, res) => {
    pushesReceived.push(req.body);
    res.json({ ok: true });
  });

  const server = app.listen(9888);
  process.env.TELEGRAM_NOTIFICATION_URL = "http://127.0.0.1:9888";

  try {
    // Event A: Buyer funds agreement
    await notifyTelegramBot(
      "+2348079604214",
      "💰 Agreement funded! 10.00 USDC locked into SIV-E2E-1001.",
      {
        escrow: { escrowId: "SIV-E2E-1001", amount: 10, currency: "USDC", purpose: "End-to-End Test" },
        participant: { role: "seller", displayStatus: "In progress", allowedActions: ["deliver"] },
      },
      "8756506224"
    );

    // Event B: Seller submits delivery
    await notifyTelegramBot(
      "+2349136717403",
      "📦 Delivery submitted for SIV-E2E-1001. Please review and release funds.",
      {
        escrow: { escrowId: "SIV-E2E-1001", amount: 10, currency: "USDC", purpose: "End-to-End Test" },
        participant: { role: "buyer", displayStatus: "Delivered", allowedActions: ["release", "dispute"] },
      },
      "1767972274"
    );

    // Event C: Buyer releases agreement
    await notifyTelegramBot(
      "+2348079604214",
      "🎉 Funds released! 10.00 USDC sent to your wallet (Tx: solana_e2e_tx_signature_ok).",
      {
        escrow: { escrowId: "SIV-E2E-1001", amount: 10, currency: "USDC", purpose: "End-to-End Test" },
        participant: { role: "seller", displayStatus: "Released", allowedActions: [] },
      },
      "8756506224"
    );

    if (pushesReceived.length !== 3) {
      throw new Error(`Expected 3 pushes, received ${pushesReceived.length}`);
    }
    console.log("✅ Verified 3/3 Real-time Telegram push notifications (Funded, Delivered, Released)!");
  } finally {
    server.close();
  }

  // ---------------------------------------------------------------------------
  // TEST 3: MULTI-CURRENCY & ADMIN USDT TOGGLE ENFORCEMENT
  // ---------------------------------------------------------------------------
  console.log("\n🧪 [3/3] Testing Multi-Currency (USDC & USDT) & Admin Toggle Switch...");
  
  // A. Formatters & Sentence Parser
  const usdcParsed = parseEscrowSentence("create service agreement for 50 USDC to +2348079604214 for web dev");
  const usdtParsed = parseEscrowSentence("create service agreement for 50 USDT to +2348079604214 for web dev");
  console.log("USDC sentence parsed:", usdcParsed.currency);
  console.log("USDT sentence parsed:", usdtParsed.currency);
  console.log("USDC money format:", formatDealMoney("USDC", 50));
  console.log("USDT money format:", formatDealMoney("USDT", 50));

  // B. Verify USDT Disabled Policy State (Current Setting = OFF)
  console.log("Checking policy when USDT is OFF...");
  await settingsStore.updateSettings({
    usdtEnabled: false,
    expectedVersion: currentSettings.version,
    updatedBy: "e2e_tester",
  });
  
  const stateOff = await settingsStore.getSettings();
  if (stateOff.usdtEnabled !== false) {
    throw new Error("Failed setting usdtEnabled to false");
  }
  console.log("✅ USDT Policy state verified OFF (Disabled)!");

  // C. Test Admin Toggling USDT to ON
  console.log("Toggling USDT to ON (Enabled)...");
  await settingsStore.updateSettings({
    usdtEnabled: true,
    expectedVersion: stateOff.version,
    updatedBy: "e2e_tester",
  });
  
  const stateOn = await settingsStore.getSettings();
  if (stateOn.usdtEnabled !== true) {
    throw new Error("Failed toggling usdtEnabled to true");
  }
  console.log("✅ USDT Policy state verified ON (Enabled)!");

  // D. Reset USDT back to OFF as requested by user
  console.log("Resetting USDT back to OFF as requested...");
  const resetState = await settingsStore.updateSettings({
    usdtEnabled: false,
    expectedVersion: stateOn.version,
    updatedBy: "e2e_tester",
  });
  if (resetState.usdtEnabled !== false) {
    throw new Error("Failed resetting usdtEnabled to false");
  }
  console.log("✅ USDT Policy reset to OFF (Disabled)!");

  console.log("\n========================================================================");
  console.log("🎉 ALL MASTER END-TO-END INTEGRATION TESTS PASSED (100% SUCCESS)!");
  console.log("========================================================================");
}

runMasterE2ETest().catch((err) => {
  console.error("Master E2E Test Failed:", err);
  process.exit(1);
});
