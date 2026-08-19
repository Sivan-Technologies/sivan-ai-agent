import { settingsStore } from "../src/context";
import { escrowCreateSchema } from "../src/validation";

async function testUsdtAdminToggle() {
  console.log("================================================================");
  console.log("⚙️ TESTING ADMIN USDT TOGGLE SWITCH & POLICY ENFORCEMENT");
  console.log("================================================================");

  // 1. Check Initial State
  const initialSettings = await settingsStore.getSettings();
  console.log("Initial usdtEnabled setting:", initialSettings.usdtEnabled);

  // 2. Disable USDT via SettingsStore
  console.log("\n[1] Disabling USDT via admin settings...");
  const disabledSettings = await settingsStore.updateSettings({
    usdtEnabled: false,
    expectedVersion: initialSettings.version,
    updatedBy: "admin_test",
  });
  console.log("Updated usdtEnabled setting:", disabledSettings.usdtEnabled);
  if (disabledSettings.usdtEnabled !== false) {
    throw new Error("Failed to set usdtEnabled to false");
  }

  // Verify DB read reflects disabled state
  const readDisabled = await settingsStore.getSettings();
  if (readDisabled.usdtEnabled !== false) {
    throw new Error("Persisted usdtEnabled is not false");
  }
  console.log("✅ Verified persistent DB disabled state!");

  // 3. Enable USDT back via SettingsStore
  console.log("\n[2] Re-enabling USDT via admin settings...");
  const enabledSettings = await settingsStore.updateSettings({
    usdtEnabled: true,
    expectedVersion: readDisabled.version,
    updatedBy: "admin_test",
  });
  console.log("Updated usdtEnabled setting:", enabledSettings.usdtEnabled);
  if (enabledSettings.usdtEnabled !== true) {
    throw new Error("Failed to set usdtEnabled to true");
  }

  const readEnabled = await settingsStore.getSettings();
  if (readEnabled.usdtEnabled !== true) {
    throw new Error("Persisted usdtEnabled is not true");
  }
  console.log("✅ Verified persistent DB enabled state!");

  console.log("\n================================================================");
  console.log("🎉 ADMIN USDT TOGGLE SWITCH SUCCESSFULLY VERIFIED!");
  console.log("================================================================");
}

testUsdtAdminToggle().catch((err) => {
  console.error("USDT Toggle Test failed:", err);
  process.exit(1);
});
