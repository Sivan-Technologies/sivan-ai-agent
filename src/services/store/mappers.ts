/**
 * Row mappers converting raw database rows into strongly-typed records.
 *
 * Extracted verbatim from escrowStore.ts per FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 3.
 * Shared between sqlite-driver.ts and postgres-driver.ts.
 */

import type {
  UserRecord,
  PayoutAccountRecord,
  EscrowRecord,
  EscrowTransactionRecord,
  TransactionReferenceRecord,
  LedgerEntryRecord,
  EscrowEventRecord,
  EscrowLimitReviewRecord,
} from "./types.js";
import { decryptAccountNumber, maskAccountNumber } from "./guards.js";

export function mapUser(row: any): UserRecord | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    whatsappNumber: row.whatsapp_number,
    firstName: row.first_name || undefined,
    lastName: row.last_name || undefined,
    email: row.email || undefined,
    passwordHash: row.password_hash || undefined,
    telegramUserId: row.telegram_user_id || undefined,
    telegramUsername: row.telegram_username || undefined,
    telegramVerifiedAt: row.telegram_verified_at || undefined,
    roleHistory: JSON.parse(row.role_history || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPayout(row: any): PayoutAccountRecord | null {
  if (!row) return null;
  const decrypted = decryptAccountNumber(row.account_number_encrypted);
  const last4 = row.account_number_last4 || decrypted?.slice(-4) || (String(row.account_number || "").startsWith("acct:") ? "" : String(row.account_number || "").slice(-4));
  return {
    payoutAccountId: row.payout_account_id,
    userId: row.user_id,
    bankName: row.bank_name,
    accountNumber: maskAccountNumber(decrypted, last4),
    accountNumberLast4: last4 || undefined,
    bankCode: row.bank_code || undefined,
    accountName: row.account_name || undefined,
    resolvedAccountName: row.resolved_account_name || undefined,
    nameMatchScore: row.name_match_score === null || row.name_match_score === undefined ? undefined : Number(row.name_match_score),
    nameMatchLevel: row.name_match_level || undefined,
    accountVerifiedAt: row.account_verified_at || undefined,
    accountVerificationProvider: row.account_verification_provider || undefined,
    sharedAccountCount: row.shared_account_count === null || row.shared_account_count === undefined ? undefined : Number(row.shared_account_count),
    sharedAccountFlag: Boolean(row.shared_account_flag),
    verificationStatus: row.verification_status,
    providerRecipientCode: row.provider_recipient_code || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEscrow(row: any): EscrowRecord | null {
  if (!row) return null;
  return {
    escrowId: row.escrow_id,
    clientRequestId: row.client_request_id || undefined,
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id || undefined,
    buyerWhatsapp: row.buyer_whatsapp || undefined,
    sellerWhatsapp: row.seller_whatsapp || undefined,
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    status: row.status,
    settlementPolicy: row.settlement_policy,
    paymentReference: row.payment_reference || undefined,
    paymentAuthorizationUrl: row.payment_authorization_url || undefined,
    paymentProvider: row.payment_provider || undefined,
    fundingExpiresAt: row.funding_expires_at || undefined,
    activePaymentExpiresAt: row.active_payment_expires_at || undefined,
    paymentRegenerationCount: row.payment_regeneration_count === null || row.payment_regeneration_count === undefined ? undefined : Number(row.payment_regeneration_count),
    lastPaymentReminderAt: row.last_payment_reminder_at || undefined,
    receivedAmount: row.received_amount === null || row.received_amount === undefined ? undefined : Number(row.received_amount),
    providerPaymentStatus: row.provider_payment_status || undefined,
    paymentCheckedAt: row.payment_checked_at || undefined,
    reconciliationFlags: row.reconciliation_flags ? JSON.parse(row.reconciliation_flags) : undefined,
    releaseRequestedAt: row.release_requested_at || undefined,
    deliveredAt: row.delivered_at || undefined,
    inspectionExpiresAt: row.inspection_expires_at || undefined,
    manualPayoutReference: row.manual_payout_reference || undefined,
    payoutNotes: row.payout_notes || undefined,
    releasedBy: row.released_by || undefined,
    releasedAt: row.released_at || undefined,
    feePayer: row.fee_payer || "buyer",
    network: row.network || undefined,
    aiDisputeRecommendation: row.ai_dispute_recommendation || undefined,
    createdByChannel: row.created_by_channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTransaction(row: any): EscrowTransactionRecord {
  return {
    transactionId: row.transaction_id,
    escrowId: row.escrow_id,
    provider: row.provider,
    transactionType: row.transaction_type,
    status: row.status,
    reference: row.reference || undefined,
    amount: Number(row.amount),
    currency: row.currency,
    processorFee: row.processor_fee === null || row.processor_fee === undefined ? undefined : Number(row.processor_fee),
    rawPayload: row.raw_payload || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTransactionReference(row: any): TransactionReferenceRecord {
  return {
    referenceId: row.id,
    sivanTransactionId: row.sivan_transaction_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    provider: row.provider,
    referenceType: row.reference_type,
    referenceValue: row.reference_value,
    direction: row.direction,
    status: row.status || undefined,
    metadata: row.metadata || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapLedgerEntry(row: any): LedgerEntryRecord {
  return {
    ledgerEntryId: row.ledger_entry_id,
    escrowId: row.escrow_id,
    transactionId: row.transaction_id || undefined,
    entryType: row.entry_type,
    debitAccount: row.debit_account,
    creditAccount: row.credit_account,
    amount: Number(row.amount),
    currency: row.currency,
    providerReference: row.provider_reference || undefined,
    createdAt: row.created_at,
  };
}

export function mapEvent(row: any): EscrowEventRecord {
  return {
    eventId: row.event_id,
    escrowId: row.escrow_id,
    actor: row.actor,
    actorRole: row.actor_role,
    channel: row.channel,
    previousStatus: row.previous_status || undefined,
    nextStatus: row.next_status || undefined,
    eventType: row.event_type,
    reason: row.reason || undefined,
    metadata: row.metadata || undefined,
    hash: row.hash || undefined,
    previousHash: row.previous_hash || undefined,
    createdAt: row.created_at,
  };
}

export function mapLimitReview(row: any): EscrowLimitReviewRecord | null {
  if (!row) return null;
  return {
    reviewId: row.review_id,
    clientRequestId: row.client_request_id || undefined,
    buyerUserId: row.buyer_user_id,
    buyerWhatsapp: row.buyer_whatsapp,
    sellerWhatsapp: row.seller_whatsapp || undefined,
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    createdByChannel: row.created_by_channel,
    reasonCode: row.reason_code,
    policy: JSON.parse(row.policy_json || "{}"),
    status: row.status,
    decisionNotes: row.decision_notes || undefined,
    decidedBy: row.decided_by || undefined,
    decidedAt: row.decided_at || undefined,
    approvedEscrowId: row.approved_escrow_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
