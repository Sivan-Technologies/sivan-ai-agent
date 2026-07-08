import { escrowStore } from "../context";
import { notifyEscrowFundedParticipants } from "../services/escrowService";

async function main() {
  const escrowId = process.argv[2]?.trim();
  if (!escrowId) {
    console.error("❌ Error: Please provide an Escrow ID as an argument.");
    console.log("Usage: npm run ts-node src/scripts/force-approve-payment.ts SIV-XXXXXX-XXXX");
    process.exit(1);
  }

  const escrow = await escrowStore.getEscrowById(escrowId);
  if (!escrow) {
    console.error(`❌ Error: Escrow not found with ID ${escrowId}`);
    process.exit(1);
  }

  if (["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) {
    console.log(`ℹ️ Escrow ${escrowId} is already in state: ${escrow.status}. No action needed.`);
    return;
  }

  const paymentReference = escrow.paymentReference;
  if (!paymentReference) {
    console.error(`❌ Error: Escrow ${escrowId} does not have an active payment reference.`);
    process.exit(1);
  }

  console.log(`⏳ Force approving payment for Escrow ${escrowId}...`);
  console.log(`   - Reference: ${paymentReference}`);
  console.log(`   - Expected Amount: ${escrow.amount} NGN`);

  // Call the official model method to transition the status correctly
  const updated = await escrowStore.markFundedByPaymentReference(paymentReference, {
    amount: escrow.amount,
    provider: escrow.paymentProvider || "manual_override",
    status: "success",
    source: "admin_force_approve",
  });

  if (!updated) {
    console.error("❌ Error: Failed to mark the escrow as funded.");
    process.exit(1);
  }

  console.log(`✅ Escrow ${escrowId} successfully marked as ${updated.status}!`);

  // Trigger participants notification so WhatsApp is alerted
  if (updated.status === "IN_PROGRESS") {
    console.log("⏳ Sending WhatsApp notification to participants...");
    await notifyEscrowFundedParticipants(updated);
    console.log("✅ WhatsApp notifications sent successfully.");
  }
}

main().catch((err) => {
  console.error("❌ Execution failed:", err);
  process.exit(1);
});
