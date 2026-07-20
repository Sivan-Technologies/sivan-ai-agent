import crypto from "crypto";
import { escrowStore } from "../context";
import { EscrowRecord, EscrowTransactionRecord, TransactionReferenceRecord } from "./escrowStore";

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function upsertTransactionReference(input: Omit<TransactionReferenceRecord, "referenceId" | "createdAt" | "updatedAt">) {
  if (!input.referenceValue) return null;
  const now = new Date().toISOString();
  const existing = (await escrowStore.listTransactionReferences()).find((item) => item.provider === input.provider && item.referenceType === input.referenceType && item.referenceValue === input.referenceValue && item.resourceType === input.resourceType && item.resourceId === input.resourceId);
  return escrowStore.upsertTransactionReference({
    referenceId: existing?.referenceId ?? id("txref"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...input,
  });
}

export async function getTransactionTrace(resourceType: string, resourceId: string) {
  return escrowStore.listTransactionReferences(resourceType, resourceId);
}

export async function searchTransactionReferences(query: string, limit = 50) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return (await escrowStore.listTransactionReferences())
    .filter((item) => [item.sivanTransactionId, item.resourceId, item.provider, item.referenceType, item.referenceValue, item.status].some((value) => String(value ?? "").toLowerCase().includes(q)))
    .slice(0, limit);
}

export async function syncEscrowTransactionReferences(escrow: EscrowRecord, transactions: EscrowTransactionRecord[] = []) {
  await upsertTransactionReference({ sivanTransactionId: escrow.escrowId, resourceType: "escrow", resourceId: escrow.escrowId, provider: "sivan", referenceType: "sivan_transaction_id", referenceValue: escrow.escrowId, direction: "internal", status: escrow.status });
  await upsertTransactionReference({ sivanTransactionId: escrow.escrowId, resourceType: "escrow", resourceId: escrow.escrowId, provider: escrow.paymentProvider || "provider", referenceType: "payment_reference", referenceValue: escrow.paymentReference || "", direction: "inbound", status: escrow.status });
  await upsertTransactionReference({ sivanTransactionId: escrow.escrowId, resourceType: "escrow", resourceId: escrow.escrowId, provider: "payout", referenceType: "manual_payout_reference", referenceValue: escrow.manualPayoutReference || "", direction: "outbound", status: escrow.status });

  for (const tx of transactions) {
    await upsertTransactionReference({ sivanTransactionId: escrow.escrowId, resourceType: "escrow_transaction", resourceId: tx.transactionId, provider: tx.provider, referenceType: `${tx.transactionType}_reference`, referenceValue: tx.reference || "", direction: tx.transactionType === "funding" ? "inbound" : tx.transactionType === "refund" ? "refund" : "outbound", status: tx.status, metadata: JSON.stringify({ escrowId: tx.escrowId, amount: tx.amount, currency: tx.currency }) });
  }
}
