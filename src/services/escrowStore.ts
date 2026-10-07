/**
 * EscrowStore facade and factory.
 *
 * Extracted per FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 3 §3.1:
 * Delegates to SqliteDriver or PostgresDriver based on configuration/database URL.
 * Preserves the full EscrowStore class and method signatures for 100% backward compatibility
 * with all existing services, tests, and prototype spies.
 */

import type {
  EscrowCurrency,
  EscrowStatus,
  SettlementPolicy,
  NameMatchLevel,
  StoreProvider,
  UserRecord,
  PayoutAccountRecord,
  PayoutAccountTransferRecord,
  EscrowRecord,
  EscrowTransactionRecord,
  EscrowEventRecord,
  TransactionReferenceRecord,
  LedgerEntryRecord,
  EscrowLimitReviewRecord,
  ManualReleaseOptions,
  EscrowStoreDriver,
} from "./store/types.js";

import { resolveStoreTarget } from "./store/guards.js";
import { SqliteDriver } from "./store/sqlite-driver.js";
import { PostgresDriver } from "./store/postgres-driver.js";

// Re-exported so existing callers (`import { X } from './escrowStore'`) remain unchanged.
export * from "./store/types.js";
export { SqliteDriver, PostgresDriver };

export function createEscrowStore(databaseUrl: string, provider?: string): EscrowStoreDriver {
  const target = resolveStoreTarget(databaseUrl, provider);
  return target.provider === "sqlite"
    ? new SqliteDriver(target.databaseUrl)
    : new PostgresDriver(target.databaseUrl, target.schema);
}

export class EscrowStore implements EscrowStoreDriver {
  public provider: StoreProvider;
  private driver: EscrowStoreDriver;

  constructor(databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for escrow persistence");
    const target = resolveStoreTarget(databaseUrl, provider);
    this.provider = target.provider;
    this.driver = this.provider === "sqlite"
      ? new SqliteDriver(target.databaseUrl)
      : new PostgresDriver(target.databaseUrl, target.schema);
  }

  public get sqlite(): any {
    return (this.driver as any).sqlite;
  }

  public get pool(): any {
    return (this.driver as any).pool;
  }

  public async initializeSchema(): Promise<void> {
    return this.driver.initializeSchema();
  }

  public async runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.driver.runTransaction(fn);
  }

  public async upsertUserByWhatsapp(whatsappNumber: string, role?: string): Promise<UserRecord> {
    return this.driver.upsertUserByWhatsapp(whatsappNumber, role);
  }

  public async findUserByWhatsapp(whatsappNumber: string): Promise<UserRecord | null> {
    return this.driver.findUserByWhatsapp(whatsappNumber);
  }

  public async findUserByTelegramId(telegramUserId: string): Promise<UserRecord | null> {
    return this.driver.findUserByTelegramId(telegramUserId);
  }

  public async linkTelegramAccount(token: string, telegramUserId: string, telegramUsername?: string): Promise<UserRecord | null> {
    return this.driver.linkTelegramAccount(token, telegramUserId, telegramUsername);
  }

  public async unlinkTelegram(userId: string): Promise<UserRecord | null> {
    return this.driver.unlinkTelegram(userId);
  }

  public async updateUserProfile(userId: string, firstName?: string, lastName?: string, email?: string, passwordHash?: string): Promise<UserRecord | null> {
    return this.driver.updateUserProfile(userId, firstName, lastName, email, passwordHash);
  }

  public async getUserById(userId: string): Promise<UserRecord | null> {
    return this.driver.getUserById(userId);
  }

  public async upsertPayoutAccount(input: {
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
    sharedAccountCount?: number;
    sharedAccountFlag?: boolean;
    verificationStatus?: "pending" | "verified" | "failed";
    providerRecipientCode?: string;
  }): Promise<PayoutAccountRecord> {
    return this.driver.upsertPayoutAccount(input);
  }

  public async updatePayoutAccountRecipientCode(payoutAccountId: string, recipientCode: string): Promise<void> {
    return this.driver.updatePayoutAccountRecipientCode(payoutAccountId, recipientCode);
  }

  public async countUsersWithPayoutAccountNumber(accountNumber: string, excludeUserId?: string): Promise<number> {
    return this.driver.countUsersWithPayoutAccountNumber(accountNumber, excludeUserId);
  }

  public async getPayoutAccount(userId: string): Promise<PayoutAccountRecord | null> {
    return this.driver.getPayoutAccount(userId);
  }

  public async getPayoutAccountForTransfer(userId: string): Promise<PayoutAccountTransferRecord | null> {
    return this.driver.getPayoutAccountForTransfer(userId);
  }

  public async createEscrow(input: {
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
  }): Promise<EscrowRecord> {
    return this.driver.createEscrow(input);
  }

  public async findEscrowByClientRequestId(clientRequestId: string): Promise<EscrowRecord | null> {
    return this.driver.findEscrowByClientRequestId(clientRequestId);
  }

  public async createOrGetLimitReview(input: {
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
  }): Promise<EscrowLimitReviewRecord> {
    return this.driver.createOrGetLimitReview(input);
  }

  public async getLimitReviewByClientRequestId(clientRequestId: string): Promise<EscrowLimitReviewRecord | null> {
    return this.driver.getLimitReviewByClientRequestId(clientRequestId);
  }

  public async getLimitReviewById(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    return this.driver.getLimitReviewById(reviewId);
  }

  public async listLimitReviews(limit = 100): Promise<EscrowLimitReviewRecord[]> {
    return this.driver.listLimitReviews(limit);
  }

  public async claimLimitReview(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    return this.driver.claimLimitReview(reviewId);
  }

  public async decideLimitReview(reviewId: string, input: {
    status: "approved" | "rejected" | "pending";
    decidedBy?: string;
    decisionNotes?: string;
    approvedEscrowId?: string;
  }): Promise<EscrowLimitReviewRecord | null> {
    return this.driver.decideLimitReview(reviewId, input);
  }

  public async attachPayment(input: {
    escrowId: string;
    paymentReference: string;
    paymentAuthorizationUrl?: string;
    paymentProvider: string;
    paymentMetadata?: any;
    status?: EscrowStatus;
    fundingExpiresAt?: string;
    activePaymentExpiresAt?: string;
    regenerate?: boolean;
  }): Promise<void> {
    return this.driver.attachPayment(input);
  }

  public async acceptEscrow(escrowId: string, sellerWhatsapp: string): Promise<EscrowRecord> {
    return this.driver.acceptEscrow(escrowId, sellerWhatsapp);
  }

  public async markFundedByPaymentReference(paymentReference: string, metadata?: any): Promise<EscrowRecord | null> {
    return this.driver.markFundedByPaymentReference(paymentReference, metadata);
  }

  public async expirePendingPaymentIfDue(escrowId: string, now = new Date()): Promise<EscrowRecord | null> {
    return this.driver.expirePendingPaymentIfDue(escrowId, now);
  }

  public async markPaymentReminderSent(escrowId: string, when = new Date().toISOString()) {
    return this.driver.markPaymentReminderSent(escrowId, when);
  }

  public async markPaymentReviewRequired(
    escrowId: string,
    input: {
      receivedAmount?: number;
      providerPaymentStatus?: string;
      flags: string[];
      reason: string;
      reference?: string;
      metadata?: any;
    }
  ): Promise<EscrowRecord> {
    return this.driver.markPaymentReviewRequired(escrowId, input);
  }

  public async findEscrowByPaymentReference(paymentReference: string): Promise<EscrowRecord | null> {
    return this.driver.findEscrowByPaymentReference(paymentReference);
  }

  public async getTransactionByReference(reference: string): Promise<EscrowTransactionRecord | null> {
    return this.driver.getTransactionByReference(reference);
  }

  public async getTransactionByProviderReference(provider: string, reference: string): Promise<EscrowTransactionRecord | null> {
    return this.driver.getTransactionByProviderReference(provider, reference);
  }

  public async requestRelease(
    escrowId: string,
    actor: string,
    channel: string,
    opts: { nairaHighValueAmount?: number; usdcHighValueAmount?: number } = {},
  ): Promise<EscrowRecord> {
    return this.driver.requestRelease(escrowId, actor, channel, opts);
  }

  public async transitionEscrow(
    escrowId: string,
    nextStatus: EscrowStatus,
    event: Omit<Parameters<EscrowStore["addEvent"]>[0], "escrowId" | "previousStatus" | "nextStatus" | "metadata"> & { metadata?: any }
  ): Promise<void> {
    return this.driver.transitionEscrow(escrowId, nextStatus, event);
  }

  public async completeEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord> {
    return this.driver.completeEscrow(escrowId, actor, channel);
  }

  public async markDelivered(escrowId: string, actor: string, channel: string, summary: string, metadata: string): Promise<EscrowRecord> {
    return this.driver.markDelivered(escrowId, actor, channel, summary, metadata);
  }

  public async cancelUnfundedEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord> {
    return this.driver.cancelUnfundedEscrow(escrowId, actor, channel);
  }

  public async approveManualRelease(escrowId: string, adminUser: string, options: ManualReleaseOptions): Promise<EscrowRecord> {
    return this.driver.approveManualRelease(escrowId, adminUser, options);
  }

  public async markDisputed(escrowId: string, actor: string, channel: string, reason?: string): Promise<EscrowRecord> {
    return this.driver.markDisputed(escrowId, actor, channel, reason);
  }

  public async resolveDispute(
    escrowId: string,
    adminUser: string,
    options: { outcome: "release_to_seller" | "refund_buyer" | "cancel_no_funds" | "no_action_close"; reason: string; reference?: string }
  ): Promise<EscrowRecord> {
    return this.driver.resolveDispute(escrowId, adminUser, options);
  }

  public async addTransaction(input: Omit<EscrowTransactionRecord, "transactionId" | "createdAt" | "updatedAt">): Promise<string> {
    return this.driver.addTransaction(input);
  }

  public async updateTransactionStatus(reference: string, status: string, rawPayload?: any, processorFee?: number): Promise<void> {
    return this.driver.updateTransactionStatus(reference, status, rawPayload, processorFee);
  }

  public async addEvent(input: Omit<EscrowEventRecord, "eventId" | "createdAt" | "metadata" | "hash" | "previousHash"> & { metadata?: any }): Promise<string> {
    return this.driver.addEvent(input);
  }

  public async listEscrows(limit = 100): Promise<EscrowRecord[]> {
    return this.driver.listEscrows(limit);
  }

  public async listEscrowsByStatus(status: EscrowStatus, limit = 100): Promise<EscrowRecord[]> {
    return this.driver.listEscrowsByStatus(status, limit);
  }

  public async listEscrowsForUserId(userId: string, limit = 20): Promise<EscrowRecord[]> {
    return this.driver.listEscrowsForUserId(userId, limit);
  }

  public async listEscrowsForWhatsapp(whatsappNumber: string, limit = 20): Promise<EscrowRecord[]> {
    return this.driver.listEscrowsForWhatsapp(whatsappNumber, limit);
  }

  public async getNairaExposureForBuyer(buyerUserId: string) {
    return this.driver.getNairaExposureForBuyer(buyerUserId);
  }

  public async getEscrowById(escrowId: string): Promise<EscrowRecord | null> {
    return this.driver.getEscrowById(escrowId);
  }

  public async listTransactions(escrowId: string): Promise<EscrowTransactionRecord[]> {
    return this.driver.listTransactions(escrowId);
  }

  public async listTransactionsForEscrows(escrowIds: string[]): Promise<EscrowTransactionRecord[]> {
    return this.driver.listTransactionsForEscrows(escrowIds);
  }

  public async listFundingTransactionsForReconciliation(input: {
    windowStart: string;
    windowEnd: string;
    providers?: string[];
  }): Promise<EscrowTransactionRecord[]> {
    return this.driver.listFundingTransactionsForReconciliation(input);
  }

  public async addLedgerEntry(input: {
    escrowId: string;
    transactionId?: string;
    entryType: LedgerEntryRecord["entryType"];
    debitAccount: string;
    creditAccount: string;
    amount: number;
    currency: EscrowCurrency;
    providerReference?: string;
  }): Promise<LedgerEntryRecord> {
    return this.driver.addLedgerEntry(input);
  }

  public async listLedgerEntries(escrowId: string): Promise<LedgerEntryRecord[]> {
    return this.driver.listLedgerEntries(escrowId);
  }

  public async listRevenueLedgerEntries(): Promise<LedgerEntryRecord[]> {
    return this.driver.listRevenueLedgerEntries();
  }

  public async listRevenueTransactions(): Promise<EscrowTransactionRecord[]> {
    return this.driver.listRevenueTransactions();
  }

  public async listEvents(escrowId: string, limit = 100): Promise<EscrowEventRecord[]> {
    return this.driver.listEvents(escrowId, limit);
  }

  public async listSettlementReceivedEvents(): Promise<EscrowEventRecord[]> {
    return this.driver.listSettlementReceivedEvents();
  }

  public async isMediaUrlLinked(url: string): Promise<boolean> {
    return this.driver.isMediaUrlLinked(url);
  }

  public async saveAiDisputeRecommendation(escrowId: string, recommendationJson: string): Promise<void> {
    return this.driver.saveAiDisputeRecommendation(escrowId, recommendationJson);
  }

  public async verifyEscrowAuditTrail(escrowId: string): Promise<{ verified: boolean; invalidEventId?: string; error?: string }> {
    return this.driver.verifyEscrowAuditTrail(escrowId);
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.driver.findUserByEmail(email);
  }

  public async createUserWithEmail(email: string, passwordHash: string, firstName?: string, lastName?: string): Promise<UserRecord> {
    return this.driver.createUserWithEmail(email, passwordHash, firstName, lastName);
  }

  public async generatePairingToken(userId: string): Promise<string> {
    return this.driver.generatePairingToken(userId);
  }

  public async usePairingToken(token: string, whatsappNumber: string): Promise<UserRecord | null> {
    return this.driver.usePairingToken(token, whatsappNumber);
  }

  public async unlinkWhatsApp(userId: string): Promise<UserRecord | null> {
    return this.driver.unlinkWhatsApp(userId);
  }

  public async listTransactionReferences(resourceType?: string, resourceId?: string): Promise<TransactionReferenceRecord[]> {
    return this.driver.listTransactionReferences(resourceType, resourceId);
  }

  public async upsertTransactionReference(record: TransactionReferenceRecord): Promise<TransactionReferenceRecord> {
    return this.driver.upsertTransactionReference(record);
  }

  public async close(): Promise<void> {
    return this.driver.close();
  }
}
