import { escrowStore } from "../context";

async function main() {
  const escrowId = "SIV-994938-9259";
  const escrow = await escrowStore.getEscrowById(escrowId);
  if (!escrow) {
    console.error(`❌ Escrow ${escrowId} not found in database.`);
    process.exit(1);
  }

  console.log("📂 Escrow Details:");
  console.log(JSON.stringify(escrow, null, 2));

  const transactions = await escrowStore.listTransactions(escrowId);
  console.log("\n📂 Transaction Details:");
  console.log(JSON.stringify(transactions, null, 2));
}

main().catch((err) => {
  console.error("❌ Execution failed:", err);
  process.exit(1);
});
