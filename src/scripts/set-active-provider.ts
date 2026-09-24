import { settingsStore } from "../context";

async function main() {
  const current = await settingsStore.getSettings();
  console.log("Current platform settings:", {
    activePaymentProvider: current.activePaymentProvider,
    version: current.version,
    platformMode: current.platformMode,
  });

  const targetProvider = (process.argv[2] || "paystack").trim().toLowerCase();

  if (current.activePaymentProvider === targetProvider) {
    console.log(`${targetProvider} is already the active payment provider!`);
    return;
  }

  const updated = await settingsStore.updateSettings({
    nairaFeePercent: current.nairaFeePercent,
    nairaFeeFixed: current.nairaFeeFixed,
    usdcFeePercent: current.usdcFeePercent,
    usdcFeeFixed: current.usdcFeeFixed,
    activePaymentProvider: targetProvider,
    expectedVersion: current.version,
    updatedBy: "system_cli",
  });

  console.log("Updated active payment provider successfully:", {
    activePaymentProvider: updated.activePaymentProvider,
    version: updated.version,
  });
}

main().catch((err) => {
  console.error("Failed to update active payment provider:", err);
  process.exit(1);
});
