import crypto from "crypto";
import { Pool } from "pg";
import { AsyncLocalStorage } from "async_hooks";
import type {
  EscrowCurrency,
  EscrowStatus,
  SettlementPolicy,
  NameMatchLevel,
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
} from "./types.js";
import {
  id,
  whatsappLookupVariants,
  whatsappIdentityMatches,
  payoutAccountToken,
  highValueThreshold,
  payoutNameMatchAcceptable,
  encryptAccountNumber,
  decryptAccountNumber,
  withSchemaLock,
} from "./guards.js";
import { initializePostgresSchema } from "./migrations.js";
import {
  mapUser,
  mapPayout,
  mapEscrow,
  mapTransaction,
  mapTransactionReference,
  mapLedgerEntry,
  mapEvent,
  mapLimitReview,
} from "./mappers.js";

export class PostgresDriver implements EscrowStoreDriver {
  private _pool: Pool;
  private initialized = false;
  private transactionStorage = new AsyncLocalStorage<any>();

  public get pool(): Pool | any {
    return this.transactionStorage.getStore() || this._pool;
  }

  constructor(private databaseUrl: string, private testSchema?: string) {
    if (!databaseUrl) throw new Error("databaseUrl is required for PostgresDriver");
    this._pool = new Pool({
      connectionString: databaseUrl,
      ...(this.testSchema ? { options: `-c search_path=${this.testSchema}` } : {}),
      max: Number(process.env.POSTGRES_POOL_MAX || "5"),
      connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "30000"),
      query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || "60000"),
      ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }

  public async initializeSchema(): Promise<void> {
    if (this.initialized) return;
    if (this.testSchema) {
      await withSchemaLock(this._pool, () => initializePostgresSchema(this.pool, this.testSchema));
    } else {
      await initializePostgresSchema(this.pool);
    }
    this.initialized = true;
  }

  public async runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.initializeSchema();
    const existingClient = this.transactionStorage.getStore();
    if (existingClient) {
      return await fn();
    }
    const client = await this._pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.transactionStorage.run(client, () => fn());
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async upsertUserByWhatsapp(whatsappNumber: string, role?: string): Promise<UserRecord> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const existing = await this.findUserByWhatsapp(whatsappNumber);
    const roles = Array.from(new Set([...(existing?.roleHistory || []), ...(role ? [role] : [])]));

    if (existing) {
      await this.pool.query(`UPDATE users SET role_history = $1, updated_at = $2 WHERE user_id = $3`, [JSON.stringify(roles), now, existing.userId]);
      return { ...existing, roleHistory: roles, updatedAt: now };
    }

    const userId = id("user");
    await this.pool.query(
      `INSERT INTO users (user_id, whatsapp_number, role_history, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)`,
      [userId, whatsappNumber, JSON.stringify(roles), now, now]
    );
    return (await this.findUserByWhatsapp(whatsappNumber))!;
  }

  public async findUserByWhatsapp(whatsappNumber: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const variants = whatsappLookupVariants(whatsappNumber);
    const result = await this.pool.query(
      `SELECT * FROM users WHERE whatsapp_number = ANY($1::text[]) ORDER BY updated_at DESC LIMIT 1`,
      [variants]
    );
    return mapUser(result.rows[0]);
  }

  public async findUserByTelegramId(telegramUserId: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const normalized = String(telegramUserId).trim();
    if (!normalized) return null;
    const result = await this.pool.query(`SELECT * FROM users WHERE telegram_user_id = $1 LIMIT 1`, [normalized]);
    return mapUser(result.rows[0]);
  }

  public async linkTelegramAccount(token: string, telegramUserId: string, telegramUsername?: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const tokenClean = token.toUpperCase().trim();
    const normalizedTelegramId = String(telegramUserId).trim();
    if (!normalizedTelegramId) throw new Error("telegramUserId is required to link a Telegram account");

    const res = await this.pool.query(`SELECT * FROM pairing_tokens WHERE token = $1`, [tokenClean]);
    const tokenRow: { user_id: string; expires_at: string } | null = res.rows.length > 0 ? (res.rows[0] as any) : null;
    if (!tokenRow) return null;

    if (new Date().toISOString() > tokenRow.expires_at) {
      await this.pool.query(`DELETE FROM pairing_tokens WHERE token = $1`, [tokenClean]);
      return null;
    }

    const userId = tokenRow.user_id;
    const existingLink = await this.findUserByTelegramId(normalizedTelegramId);
    if (existingLink && existingLink.userId !== userId) {
      throw new Error("This Telegram account is already linked to another Sivan account. Unlink it there first.");
    }

    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE users SET telegram_user_id = $1, telegram_username = $2, telegram_verified_at = $3, updated_at = $3 WHERE user_id = $4`,
      [normalizedTelegramId, telegramUsername || null, now, userId]
    );
    await this.pool.query(`DELETE FROM pairing_tokens WHERE token = $1`, [tokenClean]);
    return this.getUserById(userId);
  }

  public async unlinkTelegram(userId: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    await this.pool.query(`UPDATE users SET telegram_user_id = NULL, telegram_username = NULL, telegram_verified_at = NULL, updated_at = $1 WHERE user_id = $2`, [now, userId]);
    return this.getUserById(userId);
  }

  public async updateUserProfile(userId: string, firstName?: string, lastName?: string, email?: string, passwordHash?: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    await this.pool.query(`
      UPDATE users 
      SET first_name = COALESCE($1, first_name), 
          last_name = COALESCE($2, last_name), 
          email = COALESCE($3, email),
          password_hash = COALESCE($4, password_hash),
          updated_at = $5 
      WHERE user_id = $6
    `, [firstName || null, lastName || null, email || null, passwordHash || null, now, userId]);
    return this.getUserById(userId);
  }

  public async getUserById(userId: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    return mapUser(result.rows[0]);
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
    await this.initializeSchema();
    const now = new Date().toISOString();
    const existing = await this.getPayoutAccount(input.userId);
    const payoutAccountId = existing?.payoutAccountId || id("payout");
    const verificationStatus = input.verificationStatus || existing?.verificationStatus || "pending";
    const accountNumberToken = payoutAccountToken(input.accountNumber);
    const accountNumberEncrypted = encryptAccountNumber(input.accountNumber);
    const accountNumberLast4 = input.accountNumber.slice(-4);
    const sharedAccountCount = input.sharedAccountCount || 1;
    const sharedAccountFlag = input.sharedAccountFlag ? 1 : 0;

    if (existing) {
      await this.pool.query(
        `UPDATE payout_accounts SET bank_name = $1, account_number = $2, account_number_encrypted = $3, account_number_last4 = $4,
         bank_code = $5, account_name = $6, resolved_account_name = $7, name_match_score = $8, name_match_level = $9,
         account_verified_at = $10, account_verification_provider = $11, shared_account_count = $12, shared_account_flag = $13,
         verification_status = $14, provider_recipient_code = $15, updated_at = $16 WHERE payout_account_id = $17`,
        [
          input.bankName,
          accountNumberToken,
          accountNumberEncrypted,
          accountNumberLast4,
          input.bankCode || null,
          input.accountName || null,
          input.resolvedAccountName || input.accountName || null,
          input.nameMatchScore ?? null,
          input.nameMatchLevel || null,
          input.accountVerifiedAt || null,
          input.accountVerificationProvider || null,
          sharedAccountCount,
          sharedAccountFlag,
          verificationStatus,
          input.providerRecipientCode || null,
          now,
          payoutAccountId,
        ]
      );
    } else {
      await this.pool.query(
        `INSERT INTO payout_accounts (
          payout_account_id, user_id, bank_name, account_number, account_number_encrypted, account_number_last4,
          bank_code, account_name, resolved_account_name, name_match_score, name_match_level, account_verified_at,
          account_verification_provider, shared_account_count, shared_account_flag, verification_status,
          provider_recipient_code, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          payoutAccountId,
          input.userId,
          input.bankName,
          accountNumberToken,
          accountNumberEncrypted,
          accountNumberLast4,
          input.bankCode || null,
          input.accountName || null,
          input.resolvedAccountName || input.accountName || null,
          input.nameMatchScore ?? null,
          input.nameMatchLevel || null,
          input.accountVerifiedAt || null,
          input.accountVerificationProvider || null,
          sharedAccountCount,
          sharedAccountFlag,
          verificationStatus,
          input.providerRecipientCode || null,
          now,
          now,
        ]
      );
    }

    return (await this.getPayoutAccount(input.userId))!;
  }

  public async updatePayoutAccountRecipientCode(payoutAccountId: string, recipientCode: string): Promise<void> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    await this.pool.query(
      `UPDATE payout_accounts SET provider_recipient_code = $1, updated_at = $2 WHERE payout_account_id = $3`,
      [recipientCode, now, payoutAccountId]
    );
  }

  public async countUsersWithPayoutAccountNumber(accountNumber: string, excludeUserId?: string): Promise<number> {
    await this.initializeSchema();
    const accountNumberToken = payoutAccountToken(accountNumber);
    const result = await this.pool.query(
      `SELECT COUNT(DISTINCT user_id) AS count FROM payout_accounts WHERE account_number = $1 AND ($2::text IS NULL OR user_id != $2)`,
      [accountNumberToken, excludeUserId || null]
    );
    return Number(result.rows[0]?.count || 0);
  }

  public async getPayoutAccount(userId: string): Promise<PayoutAccountRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM payout_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId]);
    return mapPayout(result.rows[0]);
  }

  public async getPayoutAccountForTransfer(userId: string): Promise<PayoutAccountTransferRecord | null> {
    await this.initializeSchema();
    const res = await this.pool.query(`SELECT * FROM payout_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId]);
    const row = res.rows[0];
    const payout = mapPayout(row);
    if (!row || !payout) return null;
    const decrypted = decryptAccountNumber(row.account_number_encrypted);
    const legacyRaw = String(row.account_number || "").startsWith("acct:") ? "" : String(row.account_number || "");
    const accountNumberRaw = decrypted || legacyRaw;
    if (!accountNumberRaw) return null;
    return { ...payout, accountNumberRaw };
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
    await this.initializeSchema();
    const now = new Date().toISOString();
    const escrowId = `SIV-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const status: EscrowStatus = input.sellerUserId ? "PENDING_ACCEPTANCE" : "PENDING_PROFILE";
    const settlementPolicy: SettlementPolicy = input.currency === "NAIRA" ? "manual_naira_release" : "autonomous_usdc_release";
    const feePayer = input.feePayer || "buyer";
    const network = input.network || (input.currency === "NAIRA" ? "celo" : "solana");

    await this.pool.query(
      `INSERT INTO escrows (
        escrow_id, buyer_user_id, seller_user_id, seller_whatsapp, amount, currency,
        purpose, status, settlement_policy, client_request_id, fee_payer, network, created_by_channel, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        escrowId,
        input.buyerUserId,
        input.sellerUserId || null,
        input.sellerWhatsapp || null,
        input.amount,
        input.currency,
        input.purpose,
        status,
        settlementPolicy,
        input.clientRequestId || null,
        feePayer,
        network,
        input.createdByChannel,
        now,
        now,
      ]
    );

    await this.addEvent({ escrowId, actor: input.buyerUserId, actorRole: "buyer", channel: input.createdByChannel, nextStatus: status, eventType: "escrow_created", reason: input.purpose });
    return (await this.getEscrowById(escrowId))!;
  }

  public async findEscrowByClientRequestId(clientRequestId: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(
      `SELECT * FROM escrows WHERE client_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientRequestId]
    );
    return mapEscrow(result.rows[0]);
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
    await this.initializeSchema();
    if (input.clientRequestId) {
      const existing = await this.getLimitReviewByClientRequestId(input.clientRequestId);
      if (existing) return existing;
    }
    const reviewId = id("limit-review");
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO escrow_limit_reviews (
        review_id, client_request_id, buyer_user_id, buyer_whatsapp, seller_whatsapp,
        amount, currency, purpose, created_by_channel, reason_code, policy_json,
        status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$12)
      ON CONFLICT (client_request_id) DO NOTHING`,
      [
        reviewId, input.clientRequestId || null, input.buyerUserId, input.buyerWhatsapp,
        input.sellerWhatsapp || null, input.amount, input.currency, input.purpose,
        input.createdByChannel, input.reasonCode, JSON.stringify(input.policy), now,
      ]
    );

    if (input.clientRequestId) {
      return (await this.getLimitReviewByClientRequestId(input.clientRequestId))!;
    }
    return (await this.getLimitReviewById(reviewId))!;
  }

  public async getLimitReviewByClientRequestId(clientRequestId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrow_limit_reviews WHERE client_request_id = $1 LIMIT 1`, [clientRequestId]);
    return mapLimitReview(result.rows[0]);
  }

  public async getLimitReviewById(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrow_limit_reviews WHERE review_id = $1 LIMIT 1`, [reviewId]);
    return mapLimitReview(result.rows[0]);
  }

  public async listLimitReviews(limit = 100): Promise<EscrowLimitReviewRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(
      `SELECT * FROM escrow_limit_reviews ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map((row: any) => mapLimitReview(row)!);
  }

  public async claimLimitReview(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const result = await this.pool.query(
      `UPDATE escrow_limit_reviews SET status = 'processing', updated_at = $1 WHERE review_id = $2 AND status = 'pending' RETURNING *`,
      [now, reviewId]
    );
    return mapLimitReview(result.rows[0]);
  }

  public async decideLimitReview(reviewId: string, input: {
    status: "approved" | "rejected" | "pending";
    decidedBy?: string;
    decisionNotes?: string;
    approvedEscrowId?: string;
  }): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const decidedAt = input.status === "pending" ? null : now;
    await this.pool.query(
      `UPDATE escrow_limit_reviews
       SET status = $1, decision_notes = $2, decided_by = $3, decided_at = $4, approved_escrow_id = $5, updated_at = $6
       WHERE review_id = $7`,
      [input.status, input.decisionNotes || null, input.decidedBy || null, decidedAt, input.approvedEscrowId || null, now, reviewId]
    );
    return this.getLimitReviewById(reviewId);
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
    await this.initializeSchema();
    const current = await this.getEscrowById(input.escrowId);
    if (!current) throw new Error("Escrow not found");
    const nextStatus = input.status || current.status;
    const now = new Date().toISOString();
    if (current.paymentReference && current.paymentReference !== input.paymentReference) {
      await this.updateTransactionStatus(current.paymentReference, "expired", {
        reason: input.regenerate ? "payment_instruction_regenerated" : "payment_instruction_replaced",
        replacedBy: input.paymentReference,
      });
    }
    const activePaymentExpiresAt =
      input.activePaymentExpiresAt ||
      input.paymentMetadata?.expiresAt ||
      input.paymentMetadata?.expires_at ||
      input.paymentMetadata?.raw?.expiresAt ||
      input.paymentMetadata?.raw?.account_expiration_datetime ||
      input.paymentMetadata?.raw?.virtualAccount?.data?.account_expiration_datetime ||
      null;
    const fundingExpiresAt = input.fundingExpiresAt || current.fundingExpiresAt || null;
    const paymentRegenerationCount = Number(current.paymentRegenerationCount || 0) + (input.regenerate ? 1 : 0);

    await this.pool.query(
      `UPDATE escrows
       SET payment_reference = $1, payment_authorization_url = $2, payment_provider = $3,
           funding_expires_at = COALESCE($4, funding_expires_at),
           active_payment_expires_at = $5, payment_regeneration_count = $6,
           status = $7, updated_at = $8
       WHERE escrow_id = $9`,
      [
        input.paymentReference,
        input.paymentAuthorizationUrl || null,
        input.paymentProvider,
        fundingExpiresAt,
        activePaymentExpiresAt,
        paymentRegenerationCount,
        nextStatus,
        now,
        input.escrowId,
      ]
    );

    await this.addTransaction({
      escrowId: input.escrowId,
      provider: input.paymentProvider,
      transactionType: "funding",
      status: "pending",
      reference: input.paymentReference,
      amount: input.paymentMetadata?.totalPayable ?? input.paymentMetadata?.amount ?? current.amount,
      currency: current.currency,
      rawPayload: input.paymentMetadata ? JSON.stringify(input.paymentMetadata) : undefined,
    });
    await this.addEvent({
      escrowId: input.escrowId,
      actor: "system",
      actorRole: "system",
      channel: "api",
      previousStatus: current.status,
      nextStatus,
      eventType: input.regenerate ? "payment_instruction_regenerated" : "payment_initialized",
      reason: input.paymentReference,
      metadata: {
        ...(input.paymentMetadata || {}),
        fundingExpiresAt,
        activePaymentExpiresAt,
        paymentRegenerationCount,
      },
    });
  }

  public async acceptEscrow(escrowId: string, sellerWhatsapp: string): Promise<EscrowRecord> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) throw new Error("Escrow not found");
      if (escrow.sellerWhatsapp && !whatsappIdentityMatches(escrow.sellerWhatsapp, sellerWhatsapp)) {
        throw new Error("Only the invited seller can accept this escrow");
      }
      if (!["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status)) {
        return escrow;
      }

      const sellerUser = await this.upsertUserByWhatsapp(sellerWhatsapp, "seller");
      if (!escrow.sellerUserId && sellerUser?.userId) {
        await this.pool.query(`UPDATE escrows SET seller_user_id = $1, seller_whatsapp = $2 WHERE escrow_id = $3`, [sellerUser.userId, sellerWhatsapp, escrowId]);
      }

      await this.transitionEscrow(escrowId, "PENDING_PAYMENT", {
        actor: sellerWhatsapp,
        actorRole: "seller",
        channel: "whatsapp_dm",
        eventType: "seller_accepted",
        reason: "Seller accepted escrow invitation",
      });
      return (await this.getEscrowById(escrowId))!;
    });
  }

  public async markFundedByPaymentReference(paymentReference: string, metadata?: any): Promise<EscrowRecord | null> {
    return this.runTransaction(async () => {
      const escrow = await this.findEscrowByPaymentReference(paymentReference);
      if (!escrow) return null;
      if (["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) return escrow;

      await this.recordPaymentReconciliation(escrow.escrowId, {
        receivedAmount: metadata?.amount,
        providerPaymentStatus: metadata?.status || "success",
        reconciliationFlags: [],
      });
      await this.transitionEscrow(escrow.escrowId, "IN_PROGRESS", {
        actor: metadata?.provider || escrow.paymentProvider || "payment_provider",
        actorRole: "payment_provider",
        channel: "webhook",
        eventType: "payment_verified",
        reason: paymentReference,
        metadata,
      });
      await this.updateTransactionStatus(paymentReference, "success", metadata, metadata?.processorFee);
      await this.addLedgerEntry({
        escrowId: escrow.escrowId,
        entryType: "funding",
        debitAccount: escrow.currency === "NAIRA"
          ? `buyer_payment_${metadata?.provider || escrow.paymentProvider || "provider"}`
          : "buyer_payment_x402",
        creditAccount: "escrow_liability",
        amount: metadata?.amount || escrow.amount,
        currency: escrow.currency,
        providerReference: paymentReference,
      });
      return this.getEscrowById(escrow.escrowId);
    });
  }

  public async expirePendingPaymentIfDue(escrowId: string, now = new Date()): Promise<EscrowRecord | null> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) return null;
      if (escrow.status !== "PENDING_PAYMENT") return escrow;

      const fundingExpiresAt = escrow.fundingExpiresAt ? new Date(escrow.fundingExpiresAt) : null;
      if (fundingExpiresAt && !Number.isNaN(fundingExpiresAt.getTime()) && fundingExpiresAt.getTime() <= now.getTime()) {
        if (escrow.paymentReference) {
          await this.updateTransactionStatus(escrow.paymentReference, "expired", {
            reason: "escrow_funding_window_expired",
            fundingExpiresAt: fundingExpiresAt.toISOString(),
          });
        }
        await this.transitionEscrow(escrowId, "EXPIRED", {
          actor: "system",
          actorRole: "system",
          channel: "api",
          eventType: "escrow_funding_expired",
          reason: escrow.paymentReference || escrowId,
          metadata: {
            paymentReference: escrow.paymentReference || null,
            paymentProvider: escrow.paymentProvider || null,
            fundingExpiresAt: fundingExpiresAt.toISOString(),
          },
        });
        return this.getEscrowById(escrowId);
      }

      if (!escrow.paymentReference) return escrow;

      const transactions = await this.listTransactions(escrowId);
      const funding = transactions.find((transaction) =>
        transaction.transactionType === "funding" &&
        transaction.reference === escrow.paymentReference &&
        transaction.status === "pending"
      );
      if (!funding?.rawPayload) return escrow;

      let metadata: any = {};
      try {
        metadata = JSON.parse(funding.rawPayload);
      } catch {
        metadata = {};
      }

      const expiresAtValue =
        escrow.activePaymentExpiresAt ||
        metadata.expiresAt ||
        metadata.expires_at ||
        metadata.raw?.expiresAt ||
        metadata.raw?.account_expiration_datetime ||
        metadata.raw?.virtualAccount?.data?.account_expiration_datetime;
      const expiresInSeconds = Number(metadata.expiresInSeconds || metadata.expires_in_seconds || 0);
      const expiresAt = expiresAtValue
        ? new Date(expiresAtValue)
        : expiresInSeconds > 0
        ? new Date(new Date(funding.createdAt).getTime() + expiresInSeconds * 1000)
        : null;

      if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > now.getTime()) {
        return escrow;
      }

      await this.updateTransactionStatus(escrow.paymentReference, "expired", {
        reason: "payment_instruction_expired",
        expiresAt: expiresAt.toISOString(),
      });

      const updatedAt = new Date().toISOString();
      await this.pool.query(
        `UPDATE escrows SET payment_reference = NULL, payment_authorization_url = NULL, active_payment_expires_at = NULL, updated_at = $1 WHERE escrow_id = $2`,
        [updatedAt, escrowId]
      );

      await this.addEvent({
        escrowId,
        actor: escrow.paymentProvider || "payment_provider",
        actorRole: "payment_provider",
        channel: "api",
        eventType: "payment_expired",
        previousStatus: "PENDING_PAYMENT",
        nextStatus: "PENDING_PAYMENT",
        reason: escrow.paymentReference,
        metadata: {
          paymentReference: escrow.paymentReference,
          paymentProvider: escrow.paymentProvider || null,
          expiresAt: expiresAt.toISOString(),
        },
      });
      return this.getEscrowById(escrowId);
    });
  }

  public async markPaymentReminderSent(escrowId: string, when = new Date().toISOString()) {
    await this.initializeSchema();
    await this.pool.query(
      `UPDATE escrows SET last_payment_reminder_at = $1, updated_at = $1 WHERE escrow_id = $2`,
      [when, escrowId]
    );

    await this.addEvent({
      escrowId,
      actor: "system",
      actorRole: "system",
      channel: "api",
      eventType: "payment_reminder_sent",
      previousStatus: "PENDING_PAYMENT",
      nextStatus: "PENDING_PAYMENT",
      metadata: { reminderSentAt: when },
    });
    return this.getEscrowById(escrowId);
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
    await this.initializeSchema();
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");

    await this.recordPaymentReconciliation(escrowId, {
      receivedAmount: input.receivedAmount,
      providerPaymentStatus: input.providerPaymentStatus,
      reconciliationFlags: input.flags,
    });
    await this.transitionEscrow(escrowId, "REVIEW_REQUIRED", {
      actor: input.metadata?.provider || escrow.paymentProvider || "payment_provider",
      actorRole: "payment_provider",
      channel: "reconciliation",
      eventType: "payment_review_required",
      reason: input.reason,
      metadata: {
        reference: input.reference || escrow.paymentReference || null,
        expectedAmount: escrow.amount,
        receivedAmount: input.receivedAmount ?? null,
        providerPaymentStatus: input.providerPaymentStatus || null,
        flags: input.flags,
        providerPayload: input.metadata || null,
      },
    });
    if (input.reference) {
      await this.updateTransactionStatus(input.reference, "review_required", {
        reason: input.reason,
        expectedAmount: escrow.amount,
        receivedAmount: input.receivedAmount ?? null,
        providerPaymentStatus: input.providerPaymentStatus || null,
        flags: input.flags,
        providerPayload: input.metadata || null,
      });
    }
    return (await this.getEscrowById(escrowId))!;
  }

  private async recordPaymentReconciliation(
    escrowId: string,
    input: { receivedAmount?: number; providerPaymentStatus?: string; reconciliationFlags?: string[] }
  ): Promise<void> {
    await this.initializeSchema();
    const checkedAt = new Date().toISOString();
    const flags = input.reconciliationFlags ? JSON.stringify(input.reconciliationFlags) : null;
    const receivedAmount = input.receivedAmount === undefined ? null : input.receivedAmount;
    const providerPaymentStatus = input.providerPaymentStatus || null;
    await this.pool.query(
      `UPDATE escrows
       SET received_amount = COALESCE($1, received_amount),
           provider_payment_status = COALESCE($2, provider_payment_status),
           payment_checked_at = $3,
           reconciliation_flags = $4,
           updated_at = $3
       WHERE escrow_id = $5`,
      [receivedAmount, providerPaymentStatus, checkedAt, flags, escrowId]
    );
  }

  public async findEscrowByPaymentReference(paymentReference: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(
      `SELECT e.*
       FROM escrows e
       WHERE e.payment_reference = $1
       UNION
       SELECT e.*
       FROM escrows e
       JOIN transactions t ON t.escrow_id = e.escrow_id
       WHERE t.reference = $1
       LIMIT 1`,
      [paymentReference]
    );
    return mapEscrow(result.rows[0]);
  }

  public async getTransactionByReference(reference: string): Promise<EscrowTransactionRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM transactions WHERE reference = $1 ORDER BY updated_at DESC LIMIT 1`, [reference]);
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  public async getTransactionByProviderReference(provider: string, reference: string): Promise<EscrowTransactionRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(
      `SELECT * FROM transactions WHERE provider = $1 AND reference = $2 ORDER BY updated_at DESC LIMIT 1`,
      [provider, reference]
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  public async requestRelease(
    escrowId: string,
    actor: string,
    channel: string,
    opts: { nairaHighValueAmount?: number; usdcHighValueAmount?: number } = {},
  ): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    await this.assertBuyerActor(escrow, actor);
    if (!["COMPLETED", "DELIVERED"].includes(escrow.status)) {
      throw new Error(`Escrow cannot be released from ${escrow.status}`);
    }

    const nairaThreshold = opts.nairaHighValueAmount ?? 500000;
    const usdcThresholdVal = opts.usdcHighValueAmount ?? 2500;
    const threshold = highValueThreshold(escrow.currency, nairaThreshold, usdcThresholdVal);

    if (escrow.currency === "USDC") {
      if (escrow.amount >= threshold) {
        throw new Error("High-value USDC release requires manual review before autonomous release");
      }
      await this.transitionEscrow(escrowId, "RELEASED", {
        actor,
        actorRole: "buyer",
        channel,
        eventType: "autonomous_usdc_release",
        reason: "Buyer confirmed release; USDC policy allows autonomous release",
      });
    } else {
      if (escrow.sellerUserId) {
        const payout = await this.getPayoutAccount(escrow.sellerUserId);
        if (!payout || payout.verificationStatus !== "verified") {
          throw new Error("Seller payout account must be verified before Naira release can be requested");
        }
        if (!payoutNameMatchAcceptable(payout)) {
          throw new Error("Seller payout account name match must be strong or medium before Naira release can be requested");
        }
        if (payout.sharedAccountFlag) {
          throw new Error("Shared payout account requires manual compliance review before Naira release can be requested");
        }
      }
      if (escrow.amount >= threshold) {
        await this.transitionEscrow(escrowId, "REVIEW_REQUIRED", {
          actor,
          actorRole: "buyer",
          channel,
          eventType: "high_value_release_review_required",
          reason: `Amount meets high-value review threshold for ${escrow.currency}`,
          metadata: { threshold, amount: escrow.amount },
        });
      } else {
        await this.transitionEscrow(escrowId, "PENDING_RELEASE", {
          actor,
          actorRole: "buyer",
          channel,
          eventType: "release_requested",
          reason: "Naira MVP requires manual admin payout approval",
        });
      }
    }

    return (await this.getEscrowById(escrowId))!;
  }

  public async completeEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) throw new Error("Escrow not found");
      await this.assertBuyerActor(escrow, actor);
      if (!["IN_PROGRESS", "FUNDED", "DELIVERED"].includes(escrow.status)) {
        throw new Error(`Escrow cannot be completed from ${escrow.status}`);
      }

      await this.transitionEscrow(escrowId, "COMPLETED", {
        actor,
        actorRole: "buyer",
        channel,
        eventType: "buyer_completed",
        reason: "Buyer confirmed work is complete",
      });
      return (await this.getEscrowById(escrowId))!;
    });
  }

  public async markDelivered(escrowId: string, actor: string, channel: string, summary: string, metadata: string): Promise<EscrowRecord> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) throw new Error("Escrow not found");
      if (!["FUNDED", "IN_PROGRESS", "DELIVERED"].includes(escrow.status)) {
        throw new Error(`Escrow cannot be marked delivered from status ${escrow.status}`);
      }
      const deliveredAt = new Date().toISOString();
      let inspectionDays = 3;
      const result = await this.pool.query("SELECT delivery_inspection_window_days FROM platform_settings LIMIT 1");
      if (result.rows.length > 0 && result.rows[0].delivery_inspection_window_days !== undefined) {
        inspectionDays = Number(result.rows[0].delivery_inspection_window_days);
      }
      const inspectionExpiresAt = new Date(Date.now() + inspectionDays * 24 * 60 * 60 * 1000).toISOString();

      await this.transitionEscrow(escrowId, "DELIVERED", {
        actor,
        actorRole: "seller",
        channel,
        eventType: "seller_delivery_proof_recorded",
        reason: summary,
        metadata,
      });

      await this.pool.query(
        `UPDATE escrows SET delivered_at = $1, inspection_expires_at = $2, updated_at = $1 WHERE escrow_id = $3`,
        [deliveredAt, inspectionExpiresAt, escrowId]
      );

      return (await this.getEscrowById(escrowId))!;
    });
  }

  public async cancelUnfundedEscrow(escrowId: string, actor: string, channel: string): Promise<EscrowRecord> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) throw new Error("Escrow not found");
      await this.assertBuyerActor(escrow, actor);
      if (escrow.status === "CANCELLED") return escrow;
      if (!["PENDING_PROFILE", "PENDING_ACCEPTANCE", "PENDING_PAYMENT"].includes(escrow.status)) {
        throw new Error(`Escrow cannot be cancelled from ${escrow.status}. Open a dispute or request a refund if funds were received.`);
      }
      if (escrow.receivedAmount || ["success", "sandbox_success"].includes(escrow.providerPaymentStatus || "")) {
        throw new Error("Funded escrow cannot be cancelled. Open a dispute or request a refund.");
      }

      await this.transitionEscrow(escrowId, "CANCELLED", {
        actor,
        actorRole: "buyer",
        channel,
        eventType: "buyer_cancelled_unfunded",
        reason: "Buyer cancelled escrow before funding",
      });
      if (escrow.paymentReference) {
        await this.updateTransactionStatus(escrow.paymentReference, "cancelled", {
          reason: "buyer_cancelled_unfunded",
        });
      }
      return (await this.getEscrowById(escrowId))!;
    });
  }

  public async approveManualRelease(escrowId: string, adminUser: string, options: ManualReleaseOptions): Promise<EscrowRecord> {
    return this.runTransaction(async () => {
      const escrow = await this.getEscrowById(escrowId);
      if (!escrow) throw new Error("Escrow not found");
      if (!options.manualPayoutReference?.trim()) throw new Error("Manual payout reference is required");
      const grossAmount = options.grossAmount ?? escrow.amount;
      const platformFeeAmount = Math.max(0, options.platformFeeAmount ?? 0);
      const sellerNetAmount = Math.max(0, options.sellerNetAmount ?? grossAmount);
      if (grossAmount !== escrow.amount) {
        throw new Error("Release gross amount must match the escrow amount");
      }
      if (sellerNetAmount > grossAmount) {
        throw new Error("Seller net payout cannot exceed escrow amount");
      }
      if (escrow.currency === "NAIRA" && escrow.status !== "PENDING_RELEASE") {
        throw new Error("Naira escrow must be pending release before admin approval");
      }
      if (escrow.currency === "NAIRA" && escrow.sellerUserId) {
        const payout = await this.getPayoutAccount(escrow.sellerUserId);
        if (!payout || payout.verificationStatus !== "verified") {
          throw new Error("Seller payout account must be verified before payout approval");
        }
        if (!payoutNameMatchAcceptable(payout)) {
          throw new Error("Seller payout account name match must be strong or medium before payout approval");
        }
        if (payout.sharedAccountFlag) {
          throw new Error("Shared payout account requires compliance review before payout approval");
        }
      }
      await this.transitionEscrow(escrowId, "RELEASED", {
        actor: adminUser,
        actorRole: "admin",
        channel: "admin",
        eventType: "manual_release_approved",
        reason: escrow.currency === "NAIRA" ? `Payout approved via ${options.payoutProvider || "manual_bank_transfer"}: ${options.manualPayoutReference}` : "Admin release approved",
        metadata: {
          manualPayoutReference: options.manualPayoutReference,
          payoutProvider: options.payoutProvider || (escrow.currency === "NAIRA" ? "manual_bank_transfer" : "x402"),
          payoutNotes: options.payoutNotes || null,
          grossAmount,
          platformFeeAmount,
          sellerNetAmount,
          amountSource: "escrow_record",
        },
      });
      await this.recordPayoutReconciliation(escrowId, adminUser, options.manualPayoutReference, options.payoutNotes);
      const transactionId = await this.addTransaction({
        escrowId,
        provider: options.payoutProvider || (escrow.currency === "NAIRA" ? "manual_bank_transfer" : "x402"),
        transactionType: "release",
        status: escrow.currency === "NAIRA" ? "payout_succeeded" : "released",
        amount: sellerNetAmount,
        currency: escrow.currency,
        reference: options.manualPayoutReference,
        rawPayload: JSON.stringify({
          paymentReference: escrow.paymentReference,
          payoutProvider: options.payoutProvider || (escrow.currency === "NAIRA" ? "manual_bank_transfer" : "x402"),
          payoutNotes: options.payoutNotes || null,
          grossAmount,
          platformFeeAmount,
          sellerNetAmount,
          amountSource: "escrow_record",
        }),
      });
      await this.addLedgerEntry({
        escrowId,
        transactionId,
        entryType: "release",
        debitAccount: "escrow_liability",
        creditAccount: escrow.currency === "NAIRA" ? `seller_payable_${options.payoutProvider || "manual_bank_transfer"}` : "seller_payable_x402",
        amount: sellerNetAmount,
        currency: escrow.currency,
        providerReference: options.manualPayoutReference,
      });
      if (platformFeeAmount > 0) {
        await this.addLedgerEntry({
          escrowId,
          transactionId,
          entryType: "fee",
          debitAccount: "escrow_liability",
          creditAccount: "platform_fee_revenue",
          amount: platformFeeAmount,
          currency: escrow.currency,
          providerReference: options.manualPayoutReference,
        });
      }
      return (await this.getEscrowById(escrowId))!;
    });
  }

  private async recordPayoutReconciliation(escrowId: string, releasedBy: string, manualPayoutReference: string, payoutNotes?: string): Promise<void> {
    await this.initializeSchema();
    const releasedAt = new Date().toISOString();
    await this.pool.query(
      `UPDATE escrows SET manual_payout_reference = $1, payout_notes = $2, released_by = $3, released_at = $4, updated_at = $4 WHERE escrow_id = $5`,
      [manualPayoutReference, payoutNotes || null, releasedBy, releasedAt, escrowId]
    );
  }

  public async markDisputed(escrowId: string, actor: string, channel: string, reason?: string): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    if (channel !== "admin") {
      await this.assertParticipantActor(escrow, actor);
    }
    await this.transitionEscrow(escrowId, "DISPUTED", {
      actor,
      actorRole: "participant",
      channel,
      eventType: "dispute_opened",
      reason: reason || "Dispute opened",
    });
    return (await this.getEscrowById(escrowId))!;
  }

  public async resolveDispute(
    escrowId: string,
    adminUser: string,
    options: { outcome: "release_to_seller" | "refund_buyer" | "cancel_no_funds" | "no_action_close"; reason: string; reference?: string }
  ): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    if (escrow.status !== "DISPUTED") {
      throw new Error(`Escrow dispute cannot be resolved from ${escrow.status}`);
    }
    if (options.outcome === "release_to_seller" && escrow.currency === "NAIRA" && !options.reference?.trim()) {
      throw new Error("A payout reference is required when resolving a Naira dispute to seller release");
    }

    const nextStatus: EscrowStatus =
      options.outcome === "release_to_seller"
        ? "RELEASED"
        : "CANCELLED";

    await this.transitionEscrow(escrowId, nextStatus, {
      actor: adminUser,
      actorRole: "admin",
      channel: "admin",
      eventType: "dispute_resolved",
      reason: options.reason,
      metadata: {
        outcome: options.outcome,
        reference: options.reference || null,
      },
    });

    if (options.outcome === "release_to_seller") {
      const reference = options.reference || `dispute-release-${escrowId}`;
      await this.recordPayoutReconciliation(escrowId, adminUser, reference, `Dispute resolution: ${options.reason}`);
      const transactionId = await this.addTransaction({
        escrowId,
        provider: escrow.paymentProvider || (escrow.currency === "NAIRA" ? "paystack" : "x402"),
        transactionType: "release",
        status: "manual_dispute_release",
        amount: escrow.amount,
        currency: escrow.currency,
        reference,
        rawPayload: JSON.stringify({ outcome: options.outcome, reason: options.reason }),
      });
      await this.addLedgerEntry({
        escrowId,
        transactionId,
        entryType: "release",
        debitAccount: "escrow_liability",
        creditAccount: escrow.currency === "NAIRA" ? "seller_payable_naira" : "seller_payable_x402",
        amount: escrow.amount,
        currency: escrow.currency,
        providerReference: reference,
      });
    }

    if (options.outcome === "refund_buyer") {
      const transactionId = await this.addTransaction({
        escrowId,
        provider: escrow.paymentProvider || (escrow.currency === "NAIRA" ? "paystack" : "x402"),
        transactionType: "refund",
        status: "manual_refund_recorded",
        amount: escrow.receivedAmount || escrow.amount,
        currency: escrow.currency,
        reference: options.reference,
        rawPayload: JSON.stringify({ outcome: options.outcome, reason: options.reason }),
      });
      await this.addLedgerEntry({
        escrowId,
        transactionId,
        entryType: "refund",
        debitAccount: "escrow_liability",
        creditAccount: escrow.currency === "NAIRA" ? "buyer_refund_naira" : "buyer_refund_x402",
        amount: escrow.receivedAmount || escrow.amount,
        currency: escrow.currency,
        providerReference: options.reference,
      });
    }

    return (await this.getEscrowById(escrowId))!;
  }

  private async assertBuyerActor(escrow: EscrowRecord, actor: string): Promise<void> {
    if (actor === "system-sweep") return;
    const buyer = await this.getUserById(escrow.buyerUserId);
    if (!buyer || buyer.whatsappNumber !== actor) {
      throw new Error("Only the buyer can perform this escrow action");
    }
  }

  private async assertParticipantActor(escrow: EscrowRecord, actor: string): Promise<void> {
    const [buyer, seller] = await Promise.all([
      this.getUserById(escrow.buyerUserId),
      escrow.sellerUserId ? this.getUserById(escrow.sellerUserId) : Promise.resolve(null),
    ]);
    const allowed = [buyer?.whatsappNumber, seller?.whatsappNumber, escrow.sellerWhatsapp].filter(Boolean);
    if (!allowed.includes(actor)) {
      throw new Error("Only escrow participants can perform this escrow action");
    }
  }

  public async transitionEscrow(
    escrowId: string,
    nextStatus: EscrowStatus,
    event: Omit<Parameters<PostgresDriver["addEvent"]>[0], "escrowId" | "previousStatus" | "nextStatus" | "metadata"> & { metadata?: any }
  ): Promise<void> {
    await this.initializeSchema();
    const current = await this.getEscrowById(escrowId);
    if (!current) throw new Error("Escrow not found");
    const now = new Date().toISOString();
    const releaseRequestedAt = nextStatus === "PENDING_RELEASE" ? now : current.releaseRequestedAt || null;
    const releasedAt = nextStatus === "RELEASED" ? (current.releasedAt || now) : current.releasedAt || null;
    const releasedBy = nextStatus === "RELEASED" ? (current.releasedBy || event.actor) : current.releasedBy || null;
    const manualPayoutReference = (nextStatus === "RELEASED" && !current.manualPayoutReference && current.currency === "USDC")
      ? (current.paymentReference || current.txHash || `x402-${escrowId}`)
      : current.manualPayoutReference || null;

    await this.pool.query(
      `UPDATE escrows SET status = $1, release_requested_at = $2, released_at = $3, released_by = $4, manual_payout_reference = $5, updated_at = $6 WHERE escrow_id = $7`,
      [nextStatus, releaseRequestedAt, releasedAt, releasedBy, manualPayoutReference, now, escrowId]
    );

    await this.addEvent({
      escrowId,
      actor: event.actor,
      actorRole: event.actorRole,
      channel: event.channel,
      previousStatus: current.status,
      nextStatus,
      eventType: event.eventType,
      reason: event.reason,
      metadata: event.metadata ? JSON.stringify(event.metadata) : undefined,
    });
  }

  public async addTransaction(input: Omit<EscrowTransactionRecord, "transactionId" | "createdAt" | "updatedAt">): Promise<string> {
    await this.initializeSchema();
    const transactionId = id("txn");
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO transactions (transaction_id, escrow_id, provider, transaction_type, status, reference, amount, currency, processor_fee, raw_payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [transactionId, input.escrowId, input.provider, input.transactionType, input.status, input.reference || null, input.amount, input.currency, input.processorFee ?? null, input.rawPayload || null, now, now]
    );
    return transactionId;
  }

  public async updateTransactionStatus(reference: string, status: string, rawPayload?: any, processorFee?: number): Promise<void> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const payload = rawPayload ? JSON.stringify(rawPayload) : null;
    await this.pool.query(
      `UPDATE transactions SET status = $1, processor_fee = COALESCE($2, processor_fee), raw_payload = COALESCE($3, raw_payload), updated_at = $4 WHERE reference = $5`,
      [status, processorFee ?? null, payload, now, reference]
    );
  }

  public async addEvent(input: Omit<EscrowEventRecord, "eventId" | "createdAt" | "metadata" | "hash" | "previousHash"> & { metadata?: any }): Promise<string> {
    await this.initializeSchema();
    const eventId = id("event");
    const createdAt = new Date().toISOString();
    const metadata = input.metadata
      ? typeof input.metadata === "string"
        ? input.metadata
        : JSON.stringify(input.metadata)
      : null;

    let previousHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const lastEventRes = await this.pool.query(`SELECT hash FROM escrow_events WHERE escrow_id = $1 ORDER BY created_at DESC LIMIT 1`, [input.escrowId]);
    if (lastEventRes.rows.length > 0 && lastEventRes.rows[0].hash) {
      previousHash = lastEventRes.rows[0].hash;
    }

    const hashPayload = [
      previousHash,
      input.escrowId,
      input.actor,
      input.actorRole,
      input.channel,
      input.previousStatus || "",
      input.nextStatus || "",
      input.eventType,
      input.reason || "",
      metadata || "",
      createdAt
    ].join("|");

    const hash = crypto.createHash("sha256").update(hashPayload).digest("hex");

    await this.pool.query(
      `INSERT INTO escrow_events (event_id, escrow_id, actor, actor_role, channel, previous_status, next_status, event_type, reason, metadata, hash, previous_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        eventId, 
        input.escrowId, 
        input.actor, 
        input.actorRole, 
        input.channel, 
        input.previousStatus || null, 
        input.nextStatus || null, 
        input.eventType, 
        input.reason || null, 
        metadata, 
        hash, 
        previousHash, 
        createdAt
      ]
    );
    return eventId;
  }

  public async listEscrows(limit = 100): Promise<EscrowRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrows ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row: any) => mapEscrow(row)).filter(Boolean) as EscrowRecord[];
  }

  public async listEscrowsByStatus(status: EscrowStatus, limit = 100): Promise<EscrowRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrows WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit]);
    return result.rows.map((row: any) => mapEscrow(row)).filter(Boolean) as EscrowRecord[];
  }

  public async listEscrowsForUserId(userId: string, limit = 20): Promise<EscrowRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`
      SELECT *
      FROM escrows
      WHERE buyer_user_id = $1 OR seller_user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2
    `, [userId, limit]);
    return result.rows.map((row: any) => mapEscrow(row)).filter(Boolean) as EscrowRecord[];
  }

  public async listEscrowsForWhatsapp(whatsappNumber: string, limit = 20): Promise<EscrowRecord[]> {
    await this.initializeSchema();
    const variants = whatsappLookupVariants(whatsappNumber);
    const result = await this.pool.query(`
      SELECT DISTINCT e.*
      FROM escrows e
      LEFT JOIN users buyer ON buyer.user_id = e.buyer_user_id
      LEFT JOIN users seller ON seller.user_id = e.seller_user_id
      WHERE buyer.whatsapp_number = ANY($1::text[])
         OR seller.whatsapp_number = ANY($1::text[])
         OR e.seller_whatsapp = ANY($1::text[])
      ORDER BY e.updated_at DESC
      LIMIT $2
    `, [variants, limit]);
    return result.rows.map((row: any) => mapEscrow(row)).filter(Boolean) as EscrowRecord[];
  }

  public async getNairaExposureForBuyer(buyerUserId: string) {
    await this.initializeSchema();
    const activeStatuses = ["CREATED", "PENDING_PROFILE", "PENDING_ACCEPTANCE", "PENDING_PAYMENT", "FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "REVIEW_REQUIRED", "DISPUTED"];
    const [successful, buyerActive, platformActive] = await Promise.all([
      this.pool.query(`SELECT COUNT(*) AS count FROM escrows WHERE buyer_user_id = $1 AND currency = 'NAIRA' AND status = 'RELEASED'`, [buyerUserId]),
      this.pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE buyer_user_id = $1 AND currency = 'NAIRA' AND status = ANY($2::text[])`, [buyerUserId, activeStatuses]),
      this.pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE currency = 'NAIRA' AND status = ANY($1::text[])`, [activeStatuses]),
    ]);
    return {
      successfulEscrows: Number(successful.rows[0].count),
      buyerActiveExposure: Number(buyerActive.rows[0].total),
      platformActiveExposure: Number(platformActive.rows[0].total),
    };
  }

  public async getEscrowById(escrowId: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrows WHERE escrow_id = $1`, [escrowId]);
    return mapEscrow(result.rows[0]);
  }

  public async listTransactions(escrowId: string): Promise<EscrowTransactionRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM transactions WHERE escrow_id = $1 ORDER BY created_at DESC`, [escrowId]);
    return result.rows.map((row: any) => mapTransaction(row));
  }

  public async listTransactionsForEscrows(escrowIds: string[]): Promise<EscrowTransactionRecord[]> {
    await this.initializeSchema();
    if (escrowIds.length === 0) return [];
    const placeholders = escrowIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await this.pool.query(`SELECT * FROM transactions WHERE escrow_id IN (${placeholders}) ORDER BY created_at DESC`, escrowIds);
    return result.rows.map((row: any) => mapTransaction(row));
  }

  public async listFundingTransactionsForReconciliation(input: {
    windowStart: string;
    windowEnd: string;
    providers?: string[];
  }): Promise<EscrowTransactionRecord[]> {
    await this.initializeSchema();
    const providers = input.providers || [];
    if (providers.length) {
      const result = await this.pool.query(
        `SELECT * FROM transactions
         WHERE transaction_type = 'funding'
           AND reference IS NOT NULL
           AND updated_at >= $1
           AND updated_at <= $2
           AND provider = ANY($3::text[])
         ORDER BY updated_at DESC`,
        [input.windowStart, input.windowEnd, providers]
      );
      return result.rows.map((row: any) => mapTransaction(row));
    }
    const result = await this.pool.query(
      `SELECT * FROM transactions
       WHERE transaction_type = 'funding'
         AND reference IS NOT NULL
         AND updated_at >= $1
         AND updated_at <= $2
       ORDER BY updated_at DESC`,
      [input.windowStart, input.windowEnd]
    );
    return result.rows.map((row: any) => mapTransaction(row));
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
    await this.initializeSchema();
    const ledgerEntryId = id("ledger");
    const createdAt = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO ledger_entries (
        ledger_entry_id, escrow_id, transaction_id, entry_type, debit_account, credit_account,
        amount, currency, provider_reference, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ledgerEntryId,
        input.escrowId,
        input.transactionId || null,
        input.entryType,
        input.debitAccount,
        input.creditAccount,
        input.amount,
        input.currency,
        input.providerReference || null,
        createdAt,
      ]
    );
    return (await this.listLedgerEntries(input.escrowId)).find((entry) => entry.ledgerEntryId === ledgerEntryId)!;
  }

  public async listLedgerEntries(escrowId: string): Promise<LedgerEntryRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM ledger_entries WHERE escrow_id = $1 ORDER BY created_at DESC`, [escrowId]);
    return result.rows.map((row: any) => mapLedgerEntry(row));
  }

  public async listRevenueLedgerEntries(): Promise<LedgerEntryRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM ledger_entries WHERE entry_type = ANY($1::text[]) ORDER BY created_at DESC`, [["funding", "fee"]]);
    return result.rows.map((row: any) => mapLedgerEntry(row));
  }

  public async listRevenueTransactions(): Promise<EscrowTransactionRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM transactions WHERE transaction_type = 'funding' AND status = ANY($1::text[]) ORDER BY updated_at DESC`, [["success", "sandbox_success"]]);
    return result.rows.map((row: any) => mapTransaction(row));
  }

  public async listEvents(escrowId: string, limit = 100): Promise<EscrowEventRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrow_events WHERE escrow_id = $1 ORDER BY created_at DESC LIMIT $2`, [escrowId, limit]);
    return result.rows.map((row: any) => mapEvent(row));
  }

  public async listSettlementReceivedEvents(): Promise<EscrowEventRecord[]> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrow_events WHERE event_type = 'settlement_received' ORDER BY created_at DESC`);
    return result.rows.map((row: any) => mapEvent(row));
  }

  public async isMediaUrlLinked(url: string): Promise<boolean> {
    await this.initializeSchema();
    const pattern = `%${url}%`;
    const result = await this.pool.query(`
      SELECT 1 FROM escrow_events
      WHERE event_type = 'seller_delivery_proof_recorded'
        AND metadata LIKE $1
      LIMIT 1
    `, [pattern]);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  public async saveAiDisputeRecommendation(escrowId: string, recommendationJson: string): Promise<void> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    await this.pool.query(`
      UPDATE escrows
      SET ai_dispute_recommendation = $1, updated_at = $2
      WHERE escrow_id = $3
    `, [recommendationJson, now, escrowId]);
  }

  public async verifyEscrowAuditTrail(escrowId: string): Promise<{ verified: boolean; invalidEventId?: string; error?: string }> {
    await this.initializeSchema();
    const result = await this.pool.query(`SELECT * FROM escrow_events WHERE escrow_id = $1 ORDER BY created_at ASC`, [escrowId]);
    const events: EscrowEventRecord[] = result.rows.map((row: any) => mapEvent(row));

    let expectedPreviousHash = "0000000000000000000000000000000000000000000000000000000000000000";

    for (const event of events) {
      if (event.previousHash !== expectedPreviousHash) {
        return {
          verified: false,
          invalidEventId: event.eventId,
          error: `Hash chain broken at event ${event.eventId}. Expected previous hash ${expectedPreviousHash}, got ${event.previousHash}.`
        };
      }

      const hashPayload = [
        event.previousHash,
        event.escrowId,
        event.actor,
        event.actorRole,
        event.channel,
        event.previousStatus || "",
        event.nextStatus || "",
        event.eventType,
        event.reason || "",
        event.metadata || "",
        event.createdAt
      ].join("|");

      const calculatedHash = crypto.createHash("sha256").update(hashPayload).digest("hex");

      if (event.hash !== calculatedHash) {
        return {
          verified: false,
          invalidEventId: event.eventId,
          error: `Hash mismatch at event ${event.eventId}. Calculated ${calculatedHash}, stored ${event.hash}.`
        };
      }

      expectedPreviousHash = event.hash ?? "";
    }

    return { verified: true };
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const normalized = email.toLowerCase().trim();
    const result = await this.pool.query(`SELECT * FROM users WHERE email = $1`, [normalized]);
    return result.rows.length > 0 ? mapUser(result.rows[0]) : null;
  }

  public async createUserWithEmail(email: string, passwordHash: string, firstName?: string, lastName?: string): Promise<UserRecord> {
    await this.initializeSchema();
    const userId = id("user");
    const whatsappPlaceholder = `web:${userId}`;
    const now = new Date().toISOString();
    const roles = JSON.stringify(["user"]);
    const normalized = email.toLowerCase().trim();

    await this.pool.query(
      `INSERT INTO users (user_id, whatsapp_number, email, password_hash, first_name, last_name, role_history, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, whatsappPlaceholder, normalized, passwordHash, firstName || null, lastName || null, roles, now, now]
    );

    const result = await this.pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    return mapUser(result.rows[0])!;
  }

  public async generatePairingToken(userId: string): Promise<string> {
    await this.initializeSchema();
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const nums = "0123456789";
    let codePart = "";
    for (let i = 0; i < 4; i++) codePart += chars.charAt(Math.floor(Math.random() * chars.length));
    let numPart = "";
    for (let i = 0; i < 2; i++) numPart += nums.charAt(Math.floor(Math.random() * nums.length));
    const token = `SVN-${codePart}-${numPart}`;

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await this.pool.query(
      `INSERT INTO pairing_tokens (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
      [token, userId, now, expiresAt]
    );
    return token;
  }

  public async usePairingToken(token: string, whatsappNumber: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const tokenClean = token.toUpperCase().trim();
    const res = await this.pool.query(`SELECT * FROM pairing_tokens WHERE token = $1`, [tokenClean]);
    const tokenRow: { user_id: string; expires_at: string } | null = res.rows.length > 0 ? (res.rows[0] as any) : null;

    if (!tokenRow) return null;

    if (new Date().toISOString() > tokenRow.expires_at) {
      await this.pool.query(`DELETE FROM pairing_tokens WHERE token = $1`, [tokenClean]);
      return null;
    }

    const userId = tokenRow.user_id;
    const now = new Date().toISOString();

    await this.pool.query(`UPDATE users SET whatsapp_number = $1, updated_at = $2 WHERE user_id = $3`, [whatsappNumber, now, userId]);
    await this.pool.query(`DELETE FROM pairing_tokens WHERE token = $1`, [tokenClean]);

    const result = await this.pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    return mapUser(result.rows[0]);
  }

  public async unlinkWhatsApp(userId: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const placeholder = `web:${userId}`;
    const now = new Date().toISOString();

    await this.pool.query(`UPDATE users SET whatsapp_number = $1, updated_at = $2 WHERE user_id = $3`, [placeholder, now, userId]);

    const result = await this.pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    return mapUser(result.rows[0]);
  }

  public async listTransactionReferences(resourceType?: string, resourceId?: string): Promise<TransactionReferenceRecord[]> {
    await this.initializeSchema();
    const result = resourceType && resourceId
      ? await this.pool.query(`SELECT * FROM transaction_references WHERE resource_type = $1 AND resource_id = $2 ORDER BY created_at ASC`, [resourceType, resourceId])
      : await this.pool.query(`SELECT * FROM transaction_references ORDER BY created_at ASC`);
    return result.rows.map((row: any) => mapTransactionReference(row));
  }

  public async upsertTransactionReference(record: TransactionReferenceRecord): Promise<TransactionReferenceRecord> {
    await this.initializeSchema();
    await this.pool.query(`
      INSERT INTO transaction_references (id, sivan_transaction_id, resource_type, resource_id, provider, reference_type, reference_value, direction, status, metadata, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(provider, reference_type, reference_value, resource_type, resource_id) DO UPDATE SET
        sivan_transaction_id=excluded.sivan_transaction_id,
        direction=excluded.direction,
        status=excluded.status,
        metadata=excluded.metadata,
        updated_at=excluded.updated_at
    `, [record.referenceId, record.sivanTransactionId, record.resourceType, record.resourceId, record.provider, record.referenceType, record.referenceValue, record.direction, record.status || null, record.metadata || null, record.createdAt, record.updatedAt]);
    return record;
  }

  public async close(): Promise<void> {
    await this._pool.end();
  }
}
