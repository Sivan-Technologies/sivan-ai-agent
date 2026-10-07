/**
 * Record and enum types for the escrow store.
 *
 * Extracted verbatim from escrowStore.ts per FUTURE_BUILD_GOD_SERVICE_SPLIT.md
 * Part 3 §3.1. Pure move: no logic changes.
 */

export type EscrowCurrency = "NAIRA" | "USDC" | "USDT";
export type EscrowStatus =
  | "CREATED"
  | "PENDING_PROFILE"
  | "PENDING_ACCEPTANCE"
  | "PENDING_PAYMENT"
  | "FUNDED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "COMPLETED"
  | "PENDING_RELEASE"
  | "RELEASED"
  | "DISPUTED"
  | "REVIEW_REQUIRED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export type SettlementPolicy = "manual_naira_release" | "autonomous_usdc_release";
export type NameMatchLevel = "strong" | "medium" | "weak" | "failed";
export type StoreProvider = "sqlite" | "postgres";

export interface UserRecord {
  userId: string;
  whatsappNumber: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  passwordHash?: string;
  /** Telegram numeric id, once linked. A handle on this account, not an identity. */
  telegramUserId?: string;
  /** Display only - Telegram usernames are reassignable. Never match on this. */
  telegramUsername?: string;
  telegramVerifiedAt?: string;
  roleHistory: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PayoutAccountRecord {
  payoutAccountId: string;
  userId: string;
  bankName: string;
  accountNumber: string;
  accountNumberLast4?: string;
  bankCode?: string;
  accountName?: string;
  resolvedAccountName?: string;
  nameMatchScore?: number;
  nameMatchLevel?: NameMatchLevel;
  accountVerifiedAt?: string;
  accountVerificationProvider?: string;
  sharedAccountCount?: number;
  sharedAccountFlag?: boolean;
  verificationStatus: "pending" | "verified" | "failed";
  providerRecipientCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type PayoutAccountTransferRecord = PayoutAccountRecord & {
  accountNumberRaw: string;
};

export interface EscrowRecord {
  escrowId: string;
  clientRequestId?: string;
  buyerUserId: string;
  sellerUserId?: string;
  buyerWhatsapp?: string;
  sellerWhatsapp?: string;
  amount: number;
  currency: EscrowCurrency;
  purpose: string;
  status: EscrowStatus;
  settlementPolicy: SettlementPolicy;
  paymentReference?: string;
  paymentAuthorizationUrl?: string;
  paymentProvider?: string;
  fundingExpiresAt?: string;
  activePaymentExpiresAt?: string;
  paymentRegenerationCount?: number;
  lastPaymentReminderAt?: string;
  receivedAmount?: number;
  providerPaymentStatus?: string;
  paymentCheckedAt?: string;
  reconciliationFlags?: string[];
  releaseRequestedAt?: string;
  deliveredAt?: string;
  inspectionExpiresAt?: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
  txHash?: string;
  releasedBy?: string;
  releasedAt?: string;
  feePayer: "buyer" | "seller" | "split";
  network?: string;
  aiDisputeRecommendation?: string;
  createdByChannel: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowTransactionRecord {
  transactionId: string;
  escrowId: string;
  provider: string;
  transactionType: "funding" | "release" | "refund";
  status: string;
  reference?: string;
  amount: number;
  currency: EscrowCurrency;
  processorFee?: number;
  rawPayload?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowEventRecord {
  eventId: string;
  escrowId: string;
  actor: string;
  actorRole: string;
  channel: string;
  previousStatus?: EscrowStatus;
  nextStatus?: EscrowStatus;
  eventType: string;
  reason?: string;
  metadata?: string;
  hash?: string;
  previousHash?: string;
  createdAt: string;
}


export interface TransactionReferenceRecord {
  referenceId: string;
  sivanTransactionId: string;
  resourceType: string;
  resourceId: string;
  provider: string;
  referenceType: string;
  referenceValue: string;
  direction: 'inbound' | 'outbound' | 'internal' | 'provider' | 'settlement' | 'refund';
  status?: string;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntryRecord {
  ledgerEntryId: string;
  escrowId: string;
  transactionId?: string;
  entryType: "funding" | "release" | "refund" | "fee";
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: EscrowCurrency;
  providerReference?: string;
  createdAt: string;
}

export type EscrowLimitReviewStatus = "pending" | "processing" | "approved" | "rejected";

export interface EscrowLimitReviewRecord {
  reviewId: string;
  clientRequestId?: string;
  buyerUserId: string;
  buyerWhatsapp: string;
  sellerWhatsapp?: string;
  amount: number;
  currency: EscrowCurrency;
  purpose: string;
  createdByChannel: string;
  reasonCode: string;
  policy: Record<string, unknown>;
  status: EscrowLimitReviewStatus;
  decisionNotes?: string;
  decidedBy?: string;
  decidedAt?: string;
  approvedEscrowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualReleaseOptions {
  manualPayoutReference: string;
  payoutNotes?: string;
  grossAmount?: number;
  platformFeeAmount?: number;
  sellerNetAmount?: number;
  payoutProvider?: string;
}
