import { escrowStore } from "../context";
import { reconcileEscrowPayment, expectedFundingAmount, notifyEscrowFundedParticipants } from "../services/escrowService";

async function main() {
  const reference = process.argv[2]?.trim();
  if (!reference) {
    console.error("❌ Error: Please provide a payment reference.");
    console.log("Usage: npm run ts-node src/scripts/reconcile-sandbox.ts <payment-reference>");
    process.exit(1);
  }

  const escrow = await escrowStore.findEscrowByPaymentReference(reference);
  if (!escrow) {
    console.error(`❌ Error: No escrow found for reference: ${reference}`);
    process.exit(1);
  }

  const expectedAmount = await expectedFundingAmount(escrow);
  console.log(`⏳ Reconciling payment for escrow ${escrow.escrowId}...`);
  console.log(`   - Reference: ${reference}`);
  console.log(`   - Expected Amount: ${expectedAmount} NGN`);

  const transaction = {
    paymentReference: reference,
    transactionReference: "manual-reconcile-" + Date.now(),
    status: "success",
    amount: expectedAmount,
    currency: escrow.currency,
    provider: escrow.paymentProvider || "manual_reconcile",
    raw: { manualReconciled: true },
  };

  // Reconcile through the official payment Service handler
  const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "admin_recheck");
  console.log(`✅ Reconciliation finished. New escrow status: ${funded.status}`);

  if (funded.status === "IN_PROGRESS") {
    console.log("⏳ Sending WhatsApp notification to participants...");
    await notifyEscrowFundedParticipants(funded);
    console.log("✅ WhatsApp notifications sent successfully.");
  }
}

main().catch((err) => {
  console.error("❌ Execution failed:", err);
  process.exit(1);
});
