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

export interface EscrowStoreDriver {
  initializeSchema(): Promise<void>;
  runTransaction<T>(fn: () => Promise<T>): Promise<T>;
  upsertUserByWhatsapp(whatsappNumber: string, role?: string): Promise<UserRecord>;
  findUserByWhatsapp(whatsappNumber: string): Promise<UserRecord | null>;
  findUserByTelegramId(telegramUserId: string): Promise<UserRecord | null>;
  linkTelegramAccount(token: string, telegramUserId: string, telegramUsername?: string): Promise<UserRecord | null>;
  unlinkTelegram(userId: string): Promise<UserRecord | null>;
  updateUserProfile(userId: string, firstName?: string, lastName?: string, email?: string, passwordHash?: string): Promise<UserRecord | null>;
  getUserById(userId: string): Promise<UserRecord | null>;
  upsertPayoutAccount(input: {
    userId: string;
    bankName: string;
    accountNumber: string;
    bankCode?: string;
    accountName?: string;
    resolvedAccountName?: string;
    nameMatchScore?: number;
    nameMatchLevel?: NameMatchLevel;
    accountVerifiedAt?: string;
    accountVerificationProvider?: string;
    providerRecipientCode?: string;
  }): Promise<PayoutAccountRecord>;
  updatePayoutAccountRecipientCode(payoutAccountId: string, recipientCode: string): Promise<void>;
  countUsersWithPayoutAccountNumber(accountNumber: string, excludeUserId?: string): Promise<number>;
  getPayoutAccount(userId: string): Promise<PayoutAccountRecord | null>;
  getPayoutAccountForTransfer(userId: string): Promise<PayoutAccountTransferRecord | null>;
  createEscrow(input: {
    clientRequestId?: string;
    buyerUserId: string;
    sellerUserId?: string;
    sellerWhatsapp?: string;
    amount: number;
    currency: EscrowCurrency;
    purpose: string;
    createdByChannel: string;
    feePayer?: "buyer" | "seller" | "split";
    network?: string;
  }): Promise<EscrowRecord>;
  findEscrowByClientRequestId(clientRequestId: string): Promise<EscrowRecord | null>;
  createOrGetLimitReview(input: {
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
  }): Promise<EscrowLimitReviewRecord>;
  getLimitReviewByClientRequestId(clientRequestId: string): Promise<EscrowLimitReviewRecord | null>;
  getLimitReviewById(reviewId: string): Promise<EscrowLimitReviewRecord | null>;
  listLimitReviews(limit?: number): Promise<EscrowLimitReviewRecord[]>;
  claimLimitReview(reviewId: string): Promise<EscrowLimitReviewRecord | null>;
  decideLimitReview(reviewId: string, input: {
    status: "approved" | "rejected" | "pending";
    decidedBy?: string;
    decisionNotes?: string;
    approvedEscrowId?: string;
  }): Promise<EscrowLimitReviewRecord | null>;
  attachPayment(input: {
    escrowId: string;
    paymentReference: string;
    paymentAuthorizationUrl?: string;
    paymentProvider: string;
    paymentMetadata?: any;
    status?: EscrowStatus;
    fundingExpiresAt?: string;
    activePaymentExpiresAt?: string;
    regenerate?: boolean;
  }): Promise<void>;
  acceptEscrow(escrowId: string, sellerWhatsapp: string): Promise<EscrowRecord>;
  markFundedByPaymentReference(paymentReference: string, metadata?: any): Promise<EscrowRecord | null>;
  expirePendingPaymentIfDue(escrowId: string, now?: Date): Promise<EscrowRecord | null>;
  markPaymentReminderSent(escrowId: string, when?: string): Promise<EscrowRecord | null>;
  markPaymentReviewRequired(escrowId: string, input: {
    receivedAmount?: number;
    providerPaymentStatus?: string;
    flags: string[];
    reason: string;
    reference?: string;
    metadata?: any;
  }): Promise<EscrowRecord>;
  findEscrowByPaymentReference(paymentReference: string): Promise<EscrowRecord | null>;
  getTransactionByReference(reference: string): Promise<EscrowTransactionRecord | null>;
  getTransactionByProviderReference(provider: string, reference: string): Promise<EscrowTransactionRecord | null>;
  requestRelease(escrowId: string, actor: string, channel: string, opts?: { nairaHighValueAmount?: number; usdcHighValueAmount?: number }): Promise<EscrowRecord>;
  transitionEscrow(
    escrowId: string,
    nextStatus: EscrowStatus,
    event: Omit<Parameters<EscrowStoreDriver["addEvent"]>[0], "escrowId" | "previousStatus" | "nextStatus" | "metadata"> & { metadata?: any }
  ): Promise<void>;
  completeEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord>;
  markDelivered(escrowId: string, actor: string, channel: string, summary: string, metadata: string): Promise<EscrowRecord>;
  cancelUnfundedEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord>;
  approveManualRelease(escrowId: string, adminUser: string, options: ManualReleaseOptions): Promise<EscrowRecord>;
  markDisputed(escrowId: string, actor: string, channel: string, reason?: string): Promise<EscrowRecord>;
  resolveDispute(
    escrowId: string,
    adminUser: string,
    options: { outcome: "release_to_seller" | "refund_buyer" | "cancel_no_funds" | "no_action_close"; reason: string; reference?: string }
  ): Promise<EscrowRecord>;
  addTransaction(input: Omit<EscrowTransactionRecord, "transactionId" | "createdAt" | "updatedAt">): Promise<string>;
  updateTransactionStatus(reference: string, status: string, rawPayload?: any, processorFee?: number): Promise<void>;
  addEvent(input: Omit<EscrowEventRecord, "eventId" | "createdAt" | "metadata" | "hash" | "previousHash"> & { metadata?: any }): Promise<string>;
  listEscrows(limit?: number): Promise<EscrowRecord[]>;
  listEscrowsByStatus(status: EscrowStatus, limit?: number): Promise<EscrowRecord[]>;
  listEscrowsForUserId(userId: string, limit?: number): Promise<EscrowRecord[]>;
  listEscrowsForWhatsapp(whatsappNumber: string, limit?: number): Promise<EscrowRecord[]>;
  getNairaExposureForBuyer(buyerUserId: string): Promise<{
    successfulEscrows: number;
    buyerActiveExposure: number;
    platformActiveExposure: number;
  }>;
  getEscrowById(escrowId: string): Promise<EscrowRecord | null>;
  listTransactions(escrowId: string): Promise<EscrowTransactionRecord[]>;
  listTransactionsForEscrows(escrowIds: string[]): Promise<EscrowTransactionRecord[]>;
  listFundingTransactionsForReconciliation(input: {
    windowStart: string;
    windowEnd: string;
    providers?: string[];
  }): Promise<EscrowTransactionRecord[]>;
  addLedgerEntry(input: {
    escrowId: string;
    transactionId?: string;
    entryType: LedgerEntryRecord["entryType"];
    debitAccount: string;
    creditAccount: string;
    amount: number;
    currency: EscrowCurrency;
    providerReference?: string;
  }): Promise<LedgerEntryRecord>;
  listLedgerEntries(escrowId: string): Promise<LedgerEntryRecord[]>;
  listRevenueLedgerEntries(): Promise<LedgerEntryRecord[]>;
  listRevenueTransactions(): Promise<EscrowTransactionRecord[]>;
  listEvents(escrowId: string, limit?: number): Promise<EscrowEventRecord[]>;
  listSettlementReceivedEvents(): Promise<EscrowEventRecord[]>;
  isMediaUrlLinked(url: string): Promise<boolean>;
  saveAiDisputeRecommendation(escrowId: string, recommendationJson: string): Promise<void>;
  verifyEscrowAuditTrail(escrowId: string): Promise<{ verified: boolean; invalidEventId?: string; error?: string }>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  createUserWithEmail(email: string, passwordHash: string, firstName?: string, lastName?: string): Promise<UserRecord>;
  generatePairingToken(userId: string): Promise<string>;
  usePairingToken(token: string, whatsappNumber: string): Promise<UserRecord | null>;
  unlinkWhatsApp(userId: string): Promise<UserRecord | null>;
  listTransactionReferences(resourceType?: string, resourceId?: string): Promise<TransactionReferenceRecord[]>;
  upsertTransactionReference(record: TransactionReferenceRecord): Promise<TransactionReferenceRecord>;
  close(): Promise<void>;
}

