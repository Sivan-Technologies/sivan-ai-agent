import { settingsStore } from "../src/context";

async function disableUsdtNow() {
  console.log("Setting usdtEnabled = false in database...");
  const current = await settingsStore.getSettings();
  const updated = await settingsStore.updateSettings({
    usdtEnabled: false,
    expectedVersion: current.version,
    updatedBy: "admin_hub_control",
  });
  console.log("✅ Successfully disabled USDT. Current state:", updated.usdtEnabled);
}

disableUsdtNow().catch((err) => {
  console.error("Failed to disable USDT:", err);
  process.exit(1);
});
