import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";

export type EscrowCurrency = "NAIRA" | "USDC";
export type EscrowStatus =
  | "CREATED"
  | "PENDING_PROFILE"
  | "PENDING_ACCEPTANCE"
  | "PENDING_PAYMENT"
  | "FUNDED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PENDING_RELEASE"
  | "RELEASED"
  | "DISPUTED"
  | "REVIEW_REQUIRED"
  | "FAILED"
  | "CANCELLED";

export type SettlementPolicy = "manual_naira_release" | "autonomous_usdc_release";
export type NameMatchLevel = "strong" | "medium" | "weak" | "failed";
type StoreProvider = "sqlite" | "postgres";

export interface UserRecord {
  userId: string;
  whatsappNumber: string;
  firstName?: string;
  lastName?: string;
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

export interface EscrowRecord {
  escrowId: string;
  clientRequestId?: string;
  buyerUserId: string;
  sellerUserId?: string;
  sellerWhatsapp?: string;
  amount: number;
  currency: EscrowCurrency;
  purpose: string;
  status: EscrowStatus;
  settlementPolicy: SettlementPolicy;
  paymentReference?: string;
  paymentAuthorizationUrl?: string;
  paymentProvider?: string;
  receivedAmount?: number;
  providerPaymentStatus?: string;
  paymentCheckedAt?: string;
  reconciliationFlags?: string[];
  releaseRequestedAt?: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
  releasedBy?: string;
  releasedAt?: string;
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
  createdAt: string;
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
}

function detectProvider(databaseUrl: string, provider?: string): StoreProvider {
  if (provider === "postgres" || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function payoutEncryptionKey() {
  const configured = process.env.PAYOUT_ENCRYPTION_KEY || "";
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PAYOUT_ENCRYPTION_KEY is required in production");
  }
  return crypto.createHash("sha256").update(configured || "sivan-local-dev-payout-key").digest();
}

function payoutAccountToken(accountNumber: string) {
  const secret = process.env.PAYOUT_TOKEN_SECRET || process.env.PAYOUT_ENCRYPTION_KEY || process.env.CORE_API_SECRET || "sivan-local-dev-payout-token";
  return `acct:${crypto.createHmac("sha256", secret).update(accountNumber).digest("hex").slice(0, 40)}`;
}

function highValueReviewAmount(currency: EscrowCurrency) {
  return currency === "NAIRA"
    ? Number(process.env.NAIRA_HIGH_VALUE_REVIEW_AMOUNT || "500000")
    : Number(process.env.USDC_HIGH_VALUE_REVIEW_AMOUNT || "2500");
}

function payoutNameMatchAcceptable(payout: PayoutAccountRecord) {
  return payout.nameMatchLevel === "strong" || payout.nameMatchLevel === "medium";
}

function encryptAccountNumber(accountNumber: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", payoutEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(accountNumber, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptAccountNumber(value?: string | null) {
  if (!value?.startsWith("enc:v1:")) return null;
  const [, , iv, tag, encrypted] = value.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", payoutEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function maskAccountNumber(accountNumber?: string | null, last4?: string | null) {
  const suffix = last4 || accountNumber?.replace(/\D/g, "").slice(-4) || "";
  return suffix ? `****${suffix}` : "****";
}

export class EscrowStore {
  private provider: StoreProvider;
  private sqlite?: Database.Database;
  private pool?: Pool;
  private initialized = false;

  constructor(private databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for escrow persistence");
    this.provider = detectProvider(databaseUrl, provider);

    if (this.provider === "sqlite") {
      const folder = path.dirname(databaseUrl);
      if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
      this.sqlite = new Database(databaseUrl);
      this.initializeSchemaSync();
      this.initialized = true;
    } else {
      this.pool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000"),
        query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || "8000"),
        ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
      });
    }
  }

  private mapUser(row: any): UserRecord | null {
    if (!row) return null;
    return {
      userId: row.user_id,
      whatsappNumber: row.whatsapp_number,
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      roleHistory: JSON.parse(row.role_history || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPayout(row: any): PayoutAccountRecord | null {
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

  private mapEscrow(row: any): EscrowRecord | null {
    if (!row) return null;
    return {
      escrowId: row.escrow_id,
      clientRequestId: row.client_request_id || undefined,
      buyerUserId: row.buyer_user_id,
      sellerUserId: row.seller_user_id || undefined,
      sellerWhatsapp: row.seller_whatsapp || undefined,
      amount: Number(row.amount),
      currency: row.currency,
      purpose: row.purpose,
      status: row.status,
      settlementPolicy: row.settlement_policy,
      paymentReference: row.payment_reference || undefined,
      paymentAuthorizationUrl: row.payment_authorization_url || undefined,
      paymentProvider: row.payment_provider || undefined,
      receivedAmount: row.received_amount === null || row.received_amount === undefined ? undefined : Number(row.received_amount),
      providerPaymentStatus: row.provider_payment_status || undefined,
      paymentCheckedAt: row.payment_checked_at || undefined,
      reconciliationFlags: row.reconciliation_flags ? JSON.parse(row.reconciliation_flags) : undefined,
      releaseRequestedAt: row.release_requested_at || undefined,
      manualPayoutReference: row.manual_payout_reference || undefined,
      payoutNotes: row.payout_notes || undefined,
      releasedBy: row.released_by || undefined,
      releasedAt: row.released_at || undefined,
      createdByChannel: row.created_by_channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTransaction(row: any): EscrowTransactionRecord {
    return {
      transactionId: row.transaction_id,
      escrowId: row.escrow_id,
      provider: row.provider,
      transactionType: row.transaction_type,
      status: row.status,
      reference: row.reference || undefined,
      amount: Number(row.amount),
      currency: row.currency,
      rawPayload: row.raw_payload || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapLedgerEntry(row: any): LedgerEntryRecord {
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

  private mapEvent(row: any): EscrowEventRecord {
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
      createdAt: row.created_at,
    };
  }

  private mapLimitReview(row: any): EscrowLimitReviewRecord | null {
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

  private schemaSql(numberType: string) {
    return `
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        whatsapp_number TEXT NOT NULL UNIQUE,
        first_name TEXT,
        last_name TEXT,
        role_history TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payout_accounts (
        payout_account_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_number TEXT NOT NULL,
        account_number_encrypted TEXT,
        account_number_last4 TEXT,
        bank_code TEXT,
        account_name TEXT,
        resolved_account_name TEXT,
        name_match_score INTEGER,
        name_match_level TEXT,
        account_verified_at TEXT,
        account_verification_provider TEXT,
        shared_account_count INTEGER NOT NULL DEFAULT 1,
        shared_account_flag INTEGER NOT NULL DEFAULT 0,
        verification_status TEXT NOT NULL DEFAULT 'pending',
        provider_recipient_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, account_number)
      );

      CREATE TABLE IF NOT EXISTS escrows (
        escrow_id TEXT PRIMARY KEY,
        buyer_user_id TEXT NOT NULL,
        seller_user_id TEXT,
        seller_whatsapp TEXT,
        amount ${numberType} NOT NULL,
        currency TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        settlement_policy TEXT NOT NULL,
        payment_reference TEXT UNIQUE,
        payment_authorization_url TEXT,
        payment_provider TEXT,
        received_amount ${numberType},
        provider_payment_status TEXT,
        payment_checked_at TEXT,
        reconciliation_flags TEXT,
        release_requested_at TEXT,
        manual_payout_reference TEXT,
        payout_notes TEXT,
        released_by TEXT,
        released_at TEXT,
        client_request_id TEXT,
        created_by_channel TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        escrow_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        transaction_type TEXT NOT NULL,
        status TEXT NOT NULL,
        reference TEXT,
        amount ${numberType} NOT NULL,
        currency TEXT NOT NULL,
        raw_payload TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS escrow_events (
        event_id TEXT PRIMARY KEY,
        escrow_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        channel TEXT NOT NULL,
        previous_status TEXT,
        next_status TEXT,
        event_type TEXT NOT NULL,
        reason TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ledger_entries (
        ledger_entry_id TEXT PRIMARY KEY,
        escrow_id TEXT NOT NULL,
        transaction_id TEXT,
        entry_type TEXT NOT NULL,
        debit_account TEXT NOT NULL,
        credit_account TEXT NOT NULL,
        amount ${numberType} NOT NULL,
        currency TEXT NOT NULL,
        provider_reference TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS escrow_limit_reviews (
        review_id TEXT PRIMARY KEY,
        client_request_id TEXT,
        buyer_user_id TEXT NOT NULL,
        buyer_whatsapp TEXT NOT NULL,
        seller_whatsapp TEXT,
        amount ${numberType} NOT NULL,
        currency TEXT NOT NULL,
        purpose TEXT NOT NULL,
        created_by_channel TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decision_notes TEXT,
        decided_by TEXT,
        decided_at TEXT,
        approved_escrow_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);
      CREATE INDEX IF NOT EXISTS idx_escrows_payment_reference ON escrows(payment_reference);
      CREATE INDEX IF NOT EXISTS idx_transactions_escrow_id ON transactions(escrow_id);
      CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow_id ON escrow_events(escrow_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_entries_escrow_id ON ledger_entries(escrow_id);
      CREATE INDEX IF NOT EXISTS idx_limit_reviews_status ON escrow_limit_reviews(status, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_limit_reviews_client_request_id ON escrow_limit_reviews(client_request_id);
    `;
  }

  private initializeSchemaSync() {
    this.sqlite!.exec(this.schemaSql("REAL"));
    this.ensureSqliteColumn("payout_accounts", "bank_code", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "account_number_encrypted", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "account_number_last4", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "resolved_account_name", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "name_match_score", "INTEGER");
    this.ensureSqliteColumn("payout_accounts", "name_match_level", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "account_verified_at", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "account_verification_provider", "TEXT");
    this.ensureSqliteColumn("payout_accounts", "shared_account_count", "INTEGER NOT NULL DEFAULT 1");
    this.ensureSqliteColumn("payout_accounts", "shared_account_flag", "INTEGER NOT NULL DEFAULT 0");
    this.migrateSqlitePayoutAccountNumbers();
    this.ensureSqliteColumn("escrows", "manual_payout_reference", "TEXT");
    this.ensureSqliteColumn("escrows", "payout_notes", "TEXT");
    this.ensureSqliteColumn("escrows", "released_by", "TEXT");
    this.ensureSqliteColumn("escrows", "released_at", "TEXT");
    this.ensureSqliteColumn("escrows", "client_request_id", "TEXT");
    this.sqlite!.exec("CREATE INDEX IF NOT EXISTS idx_escrows_client_request_id ON escrows(client_request_id)");
    this.ensureSqliteColumn("escrows", "received_amount", "REAL");
    this.ensureSqliteColumn("escrows", "provider_payment_status", "TEXT");
    this.ensureSqliteColumn("escrows", "payment_checked_at", "TEXT");
    this.ensureSqliteColumn("escrows", "reconciliation_flags", "TEXT");
  }

  private ensureSqliteColumn(table: string, column: string, definition: string) {
    const columns = this.sqlite!.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.some((entry) => entry.name === column)) {
      this.sqlite!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  public async initializeSchema(): Promise<void> {
    if (this.initialized) return;
    if (this.provider === "sqlite") {
      this.initializeSchemaSync();
    } else {
      await this.pool!.query(this.schemaSql("DOUBLE PRECISION"));
      await this.ensurePostgresColumn("payout_accounts", "bank_code", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "account_number_encrypted", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "account_number_last4", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "resolved_account_name", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "name_match_score", "INTEGER");
      await this.ensurePostgresColumn("payout_accounts", "name_match_level", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "account_verified_at", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "account_verification_provider", "TEXT");
      await this.ensurePostgresColumn("payout_accounts", "shared_account_count", "INTEGER NOT NULL DEFAULT 1");
      await this.ensurePostgresColumn("payout_accounts", "shared_account_flag", "INTEGER NOT NULL DEFAULT 0");
      await this.migratePostgresPayoutAccountNumbers();
      await this.ensurePostgresColumn("escrows", "manual_payout_reference", "TEXT");
      await this.ensurePostgresColumn("escrows", "payout_notes", "TEXT");
      await this.ensurePostgresColumn("escrows", "released_by", "TEXT");
      await this.ensurePostgresColumn("escrows", "released_at", "TEXT");
      await this.ensurePostgresColumn("escrows", "client_request_id", "TEXT");
      await this.pool!.query("CREATE INDEX IF NOT EXISTS idx_escrows_client_request_id ON escrows(client_request_id)");
      await this.ensurePostgresColumn("escrows", "received_amount", "DOUBLE PRECISION");
      await this.ensurePostgresColumn("escrows", "provider_payment_status", "TEXT");
      await this.ensurePostgresColumn("escrows", "payment_checked_at", "TEXT");
      await this.ensurePostgresColumn("escrows", "reconciliation_flags", "TEXT");
    }
    this.initialized = true;
  }

  private async ensurePostgresColumn(table: string, column: string, definition: string) {
    await this.pool!.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }

  private migrateSqlitePayoutAccountNumbers() {
    const rows = this.sqlite!.prepare(`
      SELECT payout_account_id, account_number
      FROM payout_accounts
      WHERE (account_number_encrypted IS NULL OR account_number_encrypted = '')
        AND account_number NOT LIKE 'acct:%'
    `).all() as Array<{ payout_account_id: string; account_number: string }>;
    const update = this.sqlite!.prepare(`
      UPDATE payout_accounts
      SET account_number = @token,
          account_number_encrypted = @encrypted,
          account_number_last4 = @last4
      WHERE payout_account_id = @payoutAccountId
    `);
    for (const row of rows) {
      update.run({
        payoutAccountId: row.payout_account_id,
        token: payoutAccountToken(row.account_number),
        encrypted: encryptAccountNumber(row.account_number),
        last4: row.account_number.slice(-4),
      });
    }
  }

  private async migratePostgresPayoutAccountNumbers() {
    const result = await this.pool!.query(`
      SELECT payout_account_id, account_number
      FROM payout_accounts
      WHERE (account_number_encrypted IS NULL OR account_number_encrypted = '')
        AND account_number NOT LIKE 'acct:%'
    `);
    for (const row of result.rows) {
      await this.pool!.query(
        `UPDATE payout_accounts
         SET account_number = $1, account_number_encrypted = $2, account_number_last4 = $3
         WHERE payout_account_id = $4`,
        [
          payoutAccountToken(row.account_number),
          encryptAccountNumber(row.account_number),
          String(row.account_number).slice(-4),
          row.payout_account_id,
        ]
      );
    }
  }

  public async upsertUserByWhatsapp(whatsappNumber: string, role?: string): Promise<UserRecord> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const existing = await this.findUserByWhatsapp(whatsappNumber);
    const roles = Array.from(new Set([...(existing?.roleHistory || []), ...(role ? [role] : [])]));

    if (existing) {
      if (this.provider === "sqlite") {
        this.sqlite!.prepare(`UPDATE users SET role_history = @roles, updated_at = @now WHERE user_id = @userId`)
          .run({ roles: JSON.stringify(roles), now, userId: existing.userId });
      } else {
        await this.pool!.query(`UPDATE users SET role_history = $1, updated_at = $2 WHERE user_id = $3`, [JSON.stringify(roles), now, existing.userId]);
      }
      return { ...existing, roleHistory: roles, updatedAt: now };
    }

    const userId = id("user");
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO users (user_id, whatsapp_number, role_history, created_at, updated_at)
        VALUES (@userId, @whatsappNumber, @roles, @now, @now)
      `).run({ userId, whatsappNumber, roles: JSON.stringify(roles), now });
    } else {
      await this.pool!.query(
        `INSERT INTO users (user_id, whatsapp_number, role_history, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)`,
        [userId, whatsappNumber, JSON.stringify(roles), now, now]
      );
    }
    return (await this.findUserByWhatsapp(whatsappNumber))!;
  }

  public async findUserByWhatsapp(whatsappNumber: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapUser(this.sqlite!.prepare(`SELECT * FROM users WHERE whatsapp_number = @whatsappNumber`).get({ whatsappNumber }));
    }
    const result = await this.pool!.query(`SELECT * FROM users WHERE whatsapp_number = $1`, [whatsappNumber]);
    return this.mapUser(result.rows[0]);
  }

  public async updateUserProfile(userId: string, firstName: string, lastName: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE users SET first_name = @firstName, last_name = @lastName, updated_at = @now WHERE user_id = @userId`)
        .run({ userId, firstName, lastName, now });
    } else {
      await this.pool!.query(`UPDATE users SET first_name = $1, last_name = $2, updated_at = $3 WHERE user_id = $4`, [firstName, lastName, now, userId]);
    }
    return this.getUserById(userId);
  }

  public async getUserById(userId: string): Promise<UserRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapUser(this.sqlite!.prepare(`SELECT * FROM users WHERE user_id = @userId`).get({ userId }));
    }
    const result = await this.pool!.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
    return this.mapUser(result.rows[0]);
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
      if (this.provider === "sqlite") {
        this.sqlite!.prepare(`
          UPDATE payout_accounts
          SET bank_name = @bankName, account_number = @accountNumberToken, account_number_encrypted = @accountNumberEncrypted,
              account_number_last4 = @accountNumberLast4, bank_code = @bankCode, account_name = @accountName,
              resolved_account_name = @resolvedAccountName, name_match_score = @nameMatchScore, name_match_level = @nameMatchLevel,
              account_verified_at = @accountVerifiedAt, account_verification_provider = @accountVerificationProvider,
              shared_account_count = @sharedAccountCount, shared_account_flag = @sharedAccountFlag,
              verification_status = @verificationStatus, provider_recipient_code = @providerRecipientCode, updated_at = @now
          WHERE payout_account_id = @payoutAccountId
        `).run({
          ...input,
          accountNumberToken,
          accountNumberEncrypted,
          accountNumberLast4,
          bankCode: input.bankCode || null,
          accountName: input.accountName || null,
          resolvedAccountName: input.resolvedAccountName || input.accountName || null,
          nameMatchScore: input.nameMatchScore ?? null,
          nameMatchLevel: input.nameMatchLevel || null,
          accountVerifiedAt: input.accountVerifiedAt || null,
          accountVerificationProvider: input.accountVerificationProvider || null,
          sharedAccountCount,
          sharedAccountFlag,
          providerRecipientCode: input.providerRecipientCode || null,
          verificationStatus,
          now,
          payoutAccountId,
        });
      } else {
        await this.pool!.query(
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
      }
    } else if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO payout_accounts (
          payout_account_id, user_id, bank_name, account_number, account_number_encrypted, account_number_last4,
          bank_code, account_name, resolved_account_name, name_match_score, name_match_level, account_verified_at,
          account_verification_provider, shared_account_count, shared_account_flag, verification_status,
          provider_recipient_code, created_at, updated_at
        )
        VALUES (
          @payoutAccountId, @userId, @bankName, @accountNumberToken, @accountNumberEncrypted, @accountNumberLast4,
          @bankCode, @accountName, @resolvedAccountName, @nameMatchScore, @nameMatchLevel, @accountVerifiedAt,
          @accountVerificationProvider, @sharedAccountCount, @sharedAccountFlag, @verificationStatus,
          @providerRecipientCode, @now, @now
        )
      `).run({
        ...input,
        payoutAccountId,
        accountNumberToken,
        accountNumberEncrypted,
        accountNumberLast4,
        bankCode: input.bankCode || null,
        accountName: input.accountName || null,
        resolvedAccountName: input.resolvedAccountName || input.accountName || null,
        nameMatchScore: input.nameMatchScore ?? null,
        nameMatchLevel: input.nameMatchLevel || null,
        accountVerifiedAt: input.accountVerifiedAt || null,
        accountVerificationProvider: input.accountVerificationProvider || null,
        sharedAccountCount,
        sharedAccountFlag,
        providerRecipientCode: input.providerRecipientCode || null,
        verificationStatus,
        now,
      });
    } else {
      await this.pool!.query(
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

  public async countUsersWithPayoutAccountNumber(accountNumber: string, excludeUserId?: string): Promise<number> {
    await this.initializeSchema();
    const accountNumberToken = payoutAccountToken(accountNumber);
    if (this.provider === "sqlite") {
      const row = this.sqlite!.prepare(`
        SELECT COUNT(DISTINCT user_id) AS count
        FROM payout_accounts
        WHERE account_number = @accountNumberToken
          AND (@excludeUserId IS NULL OR user_id != @excludeUserId)
      `).get({ accountNumberToken, excludeUserId: excludeUserId || null }) as any;
      return Number(row?.count || 0);
    }
    const result = await this.pool!.query(
      `SELECT COUNT(DISTINCT user_id) AS count FROM payout_accounts WHERE account_number = $1 AND ($2::text IS NULL OR user_id != $2)`,
      [accountNumberToken, excludeUserId || null]
    );
    return Number(result.rows[0]?.count || 0);
  }

  public async getPayoutAccount(userId: string): Promise<PayoutAccountRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapPayout(this.sqlite!.prepare(`SELECT * FROM payout_accounts WHERE user_id = @userId ORDER BY updated_at DESC LIMIT 1`).get({ userId }));
    }
    const result = await this.pool!.query(`SELECT * FROM payout_accounts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [userId]);
    return this.mapPayout(result.rows[0]);
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
  }): Promise<EscrowRecord> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const escrowId = `SIV-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const status: EscrowStatus = input.sellerUserId ? "PENDING_ACCEPTANCE" : "PENDING_PROFILE";
    const settlementPolicy: SettlementPolicy = input.currency === "NAIRA" ? "manual_naira_release" : "autonomous_usdc_release";

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO escrows (
          escrow_id, buyer_user_id, seller_user_id, seller_whatsapp, amount, currency,
          purpose, status, settlement_policy, client_request_id, created_by_channel, created_at, updated_at
        ) VALUES (
          @escrowId, @buyerUserId, @sellerUserId, @sellerWhatsapp, @amount, @currency,
          @purpose, @status, @settlementPolicy, @clientRequestId, @createdByChannel, @now, @now
        )
      `).run({
        ...input,
        escrowId,
        status,
        settlementPolicy,
        clientRequestId: input.clientRequestId || null,
        sellerUserId: input.sellerUserId || null,
        sellerWhatsapp: input.sellerWhatsapp || null,
        now,
      });
    } else {
      await this.pool!.query(
        `INSERT INTO escrows (
          escrow_id, buyer_user_id, seller_user_id, seller_whatsapp, amount, currency,
          purpose, status, settlement_policy, client_request_id, created_by_channel, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
          input.createdByChannel,
          now,
          now,
        ]
      );
    }

    await this.addEvent({ escrowId, actor: input.buyerUserId, actorRole: "buyer", channel: input.createdByChannel, nextStatus: status, eventType: "escrow_created", reason: input.purpose });
    return (await this.getEscrowById(escrowId))!;
  }

  public async findEscrowByClientRequestId(clientRequestId: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapEscrow(this.sqlite!.prepare(`
        SELECT * FROM escrows
        WHERE client_request_id = @clientRequestId
        ORDER BY created_at DESC
        LIMIT 1
      `).get({ clientRequestId }));
    }
    const result = await this.pool!.query(
      `SELECT * FROM escrows WHERE client_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [clientRequestId]
    );
    return this.mapEscrow(result.rows[0]);
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
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT OR IGNORE INTO escrow_limit_reviews (
          review_id, client_request_id, buyer_user_id, buyer_whatsapp, seller_whatsapp,
          amount, currency, purpose, created_by_channel, reason_code, policy_json,
          status, created_at, updated_at
        ) VALUES (
          @reviewId, @clientRequestId, @buyerUserId, @buyerWhatsapp, @sellerWhatsapp,
          @amount, @currency, @purpose, @createdByChannel, @reasonCode, @policyJson,
          'pending', @now, @now
        )
      `).run({
        ...input,
        reviewId,
        clientRequestId: input.clientRequestId || null,
        sellerWhatsapp: input.sellerWhatsapp || null,
        policyJson: JSON.stringify(input.policy),
        now,
      });
    } else {
      await this.pool!.query(
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
    }
    if (input.clientRequestId) {
      return (await this.getLimitReviewByClientRequestId(input.clientRequestId))!;
    }
    return (await this.getLimitReviewById(reviewId))!;
  }

  public async getLimitReviewByClientRequestId(clientRequestId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapLimitReview(this.sqlite!.prepare(`SELECT * FROM escrow_limit_reviews WHERE client_request_id = ? LIMIT 1`).get(clientRequestId));
    }
    const result = await this.pool!.query(`SELECT * FROM escrow_limit_reviews WHERE client_request_id = $1 LIMIT 1`, [clientRequestId]);
    return this.mapLimitReview(result.rows[0]);
  }

  public async getLimitReviewById(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapLimitReview(this.sqlite!.prepare(`SELECT * FROM escrow_limit_reviews WHERE review_id = ? LIMIT 1`).get(reviewId));
    }
    const result = await this.pool!.query(`SELECT * FROM escrow_limit_reviews WHERE review_id = $1 LIMIT 1`, [reviewId]);
    return this.mapLimitReview(result.rows[0]);
  }

  public async listLimitReviews(limit = 100): Promise<EscrowLimitReviewRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return (this.sqlite!.prepare(`SELECT * FROM escrow_limit_reviews ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`).all(limit) as any[])
        .map((row) => this.mapLimitReview(row)!);
    }
    const result = await this.pool!.query(
      `SELECT * FROM escrow_limit_reviews ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => this.mapLimitReview(row)!);
  }

  public async claimLimitReview(reviewId: string): Promise<EscrowLimitReviewRecord | null> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    if (this.provider === "sqlite") {
      const result = this.sqlite!.prepare(`UPDATE escrow_limit_reviews SET status = 'processing', updated_at = ? WHERE review_id = ? AND status = 'pending'`).run(now, reviewId);
      return result.changes ? this.getLimitReviewById(reviewId) : null;
    }
    const result = await this.pool!.query(
      `UPDATE escrow_limit_reviews SET status = 'processing', updated_at = $1 WHERE review_id = $2 AND status = 'pending' RETURNING *`,
      [now, reviewId]
    );
    return this.mapLimitReview(result.rows[0]);
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
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE escrow_limit_reviews
        SET status = @status, decision_notes = @decisionNotes, decided_by = @decidedBy,
            decided_at = @decidedAt, approved_escrow_id = @approvedEscrowId, updated_at = @now
        WHERE review_id = @reviewId
      `).run({
        reviewId,
        status: input.status,
        decisionNotes: input.decisionNotes || null,
        decidedBy: input.decidedBy || null,
        decidedAt,
        approvedEscrowId: input.approvedEscrowId || null,
        now,
      });
    } else {
      await this.pool!.query(
        `UPDATE escrow_limit_reviews
         SET status = $1, decision_notes = $2, decided_by = $3, decided_at = $4, approved_escrow_id = $5, updated_at = $6
         WHERE review_id = $7`,
        [input.status, input.decisionNotes || null, input.decidedBy || null, decidedAt, input.approvedEscrowId || null, now, reviewId]
      );
    }
    return this.getLimitReviewById(reviewId);
  }

  public async attachPayment(input: {
    escrowId: string;
    paymentReference: string;
    paymentAuthorizationUrl?: string;
    paymentProvider: string;
    status?: EscrowStatus;
  }): Promise<void> {
    await this.initializeSchema();
    const current = await this.getEscrowById(input.escrowId);
    if (!current) throw new Error("Escrow not found");
    const nextStatus = input.status || current.status;
    const now = new Date().toISOString();

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE escrows
        SET payment_reference = @paymentReference, payment_authorization_url = @paymentAuthorizationUrl,
            payment_provider = @paymentProvider, status = @nextStatus, updated_at = @now
        WHERE escrow_id = @escrowId
      `).run({ ...input, paymentAuthorizationUrl: input.paymentAuthorizationUrl || null, nextStatus, now });
    } else {
      await this.pool!.query(
        `UPDATE escrows SET payment_reference = $1, payment_authorization_url = $2, payment_provider = $3, status = $4, updated_at = $5 WHERE escrow_id = $6`,
        [input.paymentReference, input.paymentAuthorizationUrl || null, input.paymentProvider, nextStatus, now, input.escrowId]
      );
    }

    await this.addTransaction({
      escrowId: input.escrowId,
      provider: input.paymentProvider,
      transactionType: "funding",
      status: "pending",
      reference: input.paymentReference,
      amount: current.amount,
      currency: current.currency,
    });
    await this.addEvent({
      escrowId: input.escrowId,
      actor: "system",
      actorRole: "system",
      channel: "api",
      previousStatus: current.status,
      nextStatus,
      eventType: "payment_initialized",
      reason: input.paymentReference,
    });
  }

  public async acceptEscrow(escrowId: string, sellerWhatsapp: string): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    if (escrow.sellerWhatsapp && escrow.sellerWhatsapp !== sellerWhatsapp) {
      throw new Error("Only the invited seller can accept this escrow");
    }
    if (!["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status)) {
      return escrow;
    }

    await this.transitionEscrow(escrowId, "PENDING_PAYMENT", {
      actor: sellerWhatsapp,
      actorRole: "seller",
      channel: "whatsapp_dm",
      eventType: "seller_accepted",
      reason: "Seller accepted escrow invitation",
    });
    return (await this.getEscrowById(escrowId))!;
  }

  public async markFundedByPaymentReference(paymentReference: string, metadata?: any): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    const escrow = await this.findEscrowByPaymentReference(paymentReference);
    if (!escrow) return null;
    if (["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) return escrow;

    await this.recordPaymentReconciliation(escrow.escrowId, {
      receivedAmount: metadata?.amount,
      providerPaymentStatus: metadata?.status || "success",
      reconciliationFlags: [],
    });
    await this.transitionEscrow(escrow.escrowId, "IN_PROGRESS", {
      actor: "paystack",
      actorRole: "payment_provider",
      channel: "webhook",
      eventType: "payment_verified",
      reason: paymentReference,
      metadata,
    });
    await this.updateTransactionStatus(paymentReference, "success", metadata);
    await this.addLedgerEntry({
      escrowId: escrow.escrowId,
      entryType: "funding",
      debitAccount: escrow.currency === "NAIRA" ? "buyer_payment_paystack" : "buyer_payment_x402",
      creditAccount: "escrow_liability",
      amount: metadata?.amount || escrow.amount,
      currency: escrow.currency,
      providerReference: paymentReference,
    });
    return this.getEscrowById(escrow.escrowId);
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
      actor: "paystack",
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
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE escrows
        SET received_amount = COALESCE(@receivedAmount, received_amount),
            provider_payment_status = COALESCE(@providerPaymentStatus, provider_payment_status),
            payment_checked_at = @checkedAt,
            reconciliation_flags = @flags,
            updated_at = @checkedAt
        WHERE escrow_id = @escrowId
      `).run({ escrowId, receivedAmount, providerPaymentStatus, checkedAt, flags });
    } else {
      await this.pool!.query(
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
  }

  public async findEscrowByPaymentReference(paymentReference: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapEscrow(this.sqlite!.prepare(`SELECT * FROM escrows WHERE payment_reference = @paymentReference`).get({ paymentReference }));
    }
    const result = await this.pool!.query(`SELECT * FROM escrows WHERE payment_reference = $1`, [paymentReference]);
    return this.mapEscrow(result.rows[0]);
  }

  public async requestRelease(escrowId: string, actor: string, channel: string): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    await this.assertBuyerActor(escrow, actor);
    if (escrow.status !== "COMPLETED") {
      throw new Error(`Escrow cannot be released from ${escrow.status}`);
    }

    if (escrow.currency === "USDC") {
      if (escrow.amount >= highValueReviewAmount(escrow.currency)) {
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
      if (escrow.amount >= highValueReviewAmount(escrow.currency)) {
        await this.transitionEscrow(escrowId, "REVIEW_REQUIRED", {
          actor,
          actorRole: "buyer",
          channel,
          eventType: "high_value_release_review_required",
          reason: `Amount meets high-value review threshold for ${escrow.currency}`,
          metadata: { threshold: highValueReviewAmount(escrow.currency), amount: escrow.amount },
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
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    await this.assertBuyerActor(escrow, actor);
    if (!["IN_PROGRESS", "FUNDED"].includes(escrow.status)) {
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
  }

  public async approveManualRelease(escrowId: string, adminUser: string, options: ManualReleaseOptions): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    if (!options.manualPayoutReference?.trim()) throw new Error("Manual payout reference is required");
    const grossAmount = options.grossAmount ?? escrow.amount;
    const platformFeeAmount = Math.max(0, options.platformFeeAmount ?? 0);
    const sellerNetAmount = Math.max(0, options.sellerNetAmount ?? grossAmount - platformFeeAmount);
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
      reason: escrow.currency === "NAIRA" ? `Manual payout approved: ${options.manualPayoutReference}` : "Admin release approved",
      metadata: {
        manualPayoutReference: options.manualPayoutReference,
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
      provider: escrow.currency === "NAIRA" ? "paystack" : "x402",
      transactionType: "release",
      status: escrow.currency === "NAIRA" ? "manual_approved" : "released",
      amount: sellerNetAmount,
      currency: escrow.currency,
      reference: options.manualPayoutReference,
      rawPayload: JSON.stringify({
        paymentReference: escrow.paymentReference,
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
      creditAccount: escrow.currency === "NAIRA" ? "seller_payable_paystack" : "seller_payable_x402",
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
  }

  private async recordPayoutReconciliation(escrowId: string, releasedBy: string, manualPayoutReference: string, payoutNotes?: string): Promise<void> {
    await this.initializeSchema();
    const releasedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE escrows
        SET manual_payout_reference = @manualPayoutReference,
            payout_notes = @payoutNotes,
            released_by = @releasedBy,
            released_at = @releasedAt,
            updated_at = @releasedAt
        WHERE escrow_id = @escrowId
      `).run({ escrowId, manualPayoutReference, payoutNotes: payoutNotes || null, releasedBy, releasedAt });
    } else {
      await this.pool!.query(
        `UPDATE escrows SET manual_payout_reference = $1, payout_notes = $2, released_by = $3, released_at = $4, updated_at = $4 WHERE escrow_id = $5`,
        [manualPayoutReference, payoutNotes || null, releasedBy, releasedAt, escrowId]
      );
    }
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
        provider: escrow.currency === "NAIRA" ? "paystack" : "x402",
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
        creditAccount: escrow.currency === "NAIRA" ? "seller_payable_paystack" : "seller_payable_x402",
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
        creditAccount: escrow.currency === "NAIRA" ? "buyer_refund_paystack" : "buyer_refund_x402",
        amount: escrow.receivedAmount || escrow.amount,
        currency: escrow.currency,
        providerReference: options.reference,
      });
    }

    return (await this.getEscrowById(escrowId))!;
  }

  private async assertBuyerActor(escrow: EscrowRecord, actor: string): Promise<void> {
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

  private async transitionEscrow(
    escrowId: string,
    nextStatus: EscrowStatus,
    event: Omit<Parameters<EscrowStore["addEvent"]>[0], "escrowId" | "previousStatus" | "nextStatus" | "metadata"> & { metadata?: any }
  ): Promise<void> {
    await this.initializeSchema();
    const current = await this.getEscrowById(escrowId);
    if (!current) throw new Error("Escrow not found");
    const now = new Date().toISOString();
    const releaseRequestedAt = nextStatus === "PENDING_RELEASE" ? now : current.releaseRequestedAt || null;

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE escrows SET status = @nextStatus, release_requested_at = @releaseRequestedAt, updated_at = @now WHERE escrow_id = @escrowId`)
        .run({ escrowId, nextStatus, releaseRequestedAt, now });
    } else {
      await this.pool!.query(`UPDATE escrows SET status = $1, release_requested_at = $2, updated_at = $3 WHERE escrow_id = $4`, [nextStatus, releaseRequestedAt, now, escrowId]);
    }

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
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO transactions (transaction_id, escrow_id, provider, transaction_type, status, reference, amount, currency, raw_payload, created_at, updated_at)
        VALUES (@transactionId, @escrowId, @provider, @transactionType, @status, @reference, @amount, @currency, @rawPayload, @now, @now)
      `).run({ ...input, transactionId, reference: input.reference || null, rawPayload: input.rawPayload || null, now });
    } else {
      await this.pool!.query(
        `INSERT INTO transactions (transaction_id, escrow_id, provider, transaction_type, status, reference, amount, currency, raw_payload, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [transactionId, input.escrowId, input.provider, input.transactionType, input.status, input.reference || null, input.amount, input.currency, input.rawPayload || null, now, now]
      );
    }
    return transactionId;
  }

  public async updateTransactionStatus(reference: string, status: string, rawPayload?: any): Promise<void> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const payload = rawPayload ? JSON.stringify(rawPayload) : null;
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE transactions SET status = @status, raw_payload = COALESCE(@payload, raw_payload), updated_at = @now WHERE reference = @reference`)
        .run({ reference, status, payload, now });
    } else {
      await this.pool!.query(`UPDATE transactions SET status = $1, raw_payload = COALESCE($2, raw_payload), updated_at = $3 WHERE reference = $4`, [status, payload, now, reference]);
    }
  }

  public async addEvent(input: Omit<EscrowEventRecord, "eventId" | "createdAt">): Promise<string> {
    await this.initializeSchema();
    const eventId = id("event");
    const createdAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO escrow_events (event_id, escrow_id, actor, actor_role, channel, previous_status, next_status, event_type, reason, metadata, created_at)
        VALUES (@eventId, @escrowId, @actor, @actorRole, @channel, @previousStatus, @nextStatus, @eventType, @reason, @metadata, @createdAt)
      `).run({ ...input, eventId, previousStatus: input.previousStatus || null, nextStatus: input.nextStatus || null, reason: input.reason || null, metadata: input.metadata || null, createdAt });
    } else {
      await this.pool!.query(
        `INSERT INTO escrow_events (event_id, escrow_id, actor, actor_role, channel, previous_status, next_status, event_type, reason, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [eventId, input.escrowId, input.actor, input.actorRole, input.channel, input.previousStatus || null, input.nextStatus || null, input.eventType, input.reason || null, input.metadata || null, createdAt]
      );
    }
    return eventId;
  }

  public async listEscrows(limit = 100): Promise<EscrowRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM escrows ORDER BY created_at DESC LIMIT @limit`).all({ limit })
        .map((row) => this.mapEscrow(row)).filter(Boolean) as EscrowRecord[];
    }
    const result = await this.pool!.query(`SELECT * FROM escrows ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapEscrow(row)).filter(Boolean) as EscrowRecord[];
  }

  public async getNairaExposureForBuyer(buyerUserId: string) {
    await this.initializeSchema();
    const activeStatuses = ["CREATED", "PENDING_PROFILE", "PENDING_ACCEPTANCE", "PENDING_PAYMENT", "FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "REVIEW_REQUIRED", "DISPUTED"];
    if (this.provider === "sqlite") {
      const successful = this.sqlite!.prepare(`SELECT COUNT(*) AS count FROM escrows WHERE buyer_user_id = ? AND currency = 'NAIRA' AND status = 'RELEASED'`).get(buyerUserId) as any;
      const buyerActive = this.sqlite!.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE buyer_user_id = ? AND currency = 'NAIRA' AND status IN (${activeStatuses.map(() => "?").join(",")})`).get(buyerUserId, ...activeStatuses) as any;
      const platformActive = this.sqlite!.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE currency = 'NAIRA' AND status IN (${activeStatuses.map(() => "?").join(",")})`).get(...activeStatuses) as any;
      return { successfulEscrows: Number(successful.count), buyerActiveExposure: Number(buyerActive.total), platformActiveExposure: Number(platformActive.total) };
    }
    const [successful, buyerActive, platformActive] = await Promise.all([
      this.pool!.query(`SELECT COUNT(*) AS count FROM escrows WHERE buyer_user_id = $1 AND currency = 'NAIRA' AND status = 'RELEASED'`, [buyerUserId]),
      this.pool!.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE buyer_user_id = $1 AND currency = 'NAIRA' AND status = ANY($2::text[])`, [buyerUserId, activeStatuses]),
      this.pool!.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM escrows WHERE currency = 'NAIRA' AND status = ANY($1::text[])`, [activeStatuses]),
    ]);
    return {
      successfulEscrows: Number(successful.rows[0].count),
      buyerActiveExposure: Number(buyerActive.rows[0].total),
      platformActiveExposure: Number(platformActive.rows[0].total),
    };
  }

  public async getEscrowById(escrowId: string): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapEscrow(this.sqlite!.prepare(`SELECT * FROM escrows WHERE escrow_id = @escrowId`).get({ escrowId }));
    }
    const result = await this.pool!.query(`SELECT * FROM escrows WHERE escrow_id = $1`, [escrowId]);
    return this.mapEscrow(result.rows[0]);
  }

  public async listTransactions(escrowId: string): Promise<EscrowTransactionRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM transactions WHERE escrow_id = @escrowId ORDER BY created_at DESC`).all({ escrowId }).map((row) => this.mapTransaction(row));
    }
    const result = await this.pool!.query(`SELECT * FROM transactions WHERE escrow_id = $1 ORDER BY created_at DESC`, [escrowId]);
    return result.rows.map((row) => this.mapTransaction(row));
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
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO ledger_entries (
          ledger_entry_id, escrow_id, transaction_id, entry_type, debit_account, credit_account,
          amount, currency, provider_reference, created_at
        ) VALUES (
          @ledgerEntryId, @escrowId, @transactionId, @entryType, @debitAccount, @creditAccount,
          @amount, @currency, @providerReference, @createdAt
        )
      `).run({ ...input, ledgerEntryId, transactionId: input.transactionId || null, providerReference: input.providerReference || null, createdAt });
    } else {
      await this.pool!.query(
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
    }
    return (await this.listLedgerEntries(input.escrowId)).find((entry) => entry.ledgerEntryId === ledgerEntryId)!;
  }

  public async listLedgerEntries(escrowId: string): Promise<LedgerEntryRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM ledger_entries WHERE escrow_id = @escrowId ORDER BY created_at DESC`).all({ escrowId }).map((row) => this.mapLedgerEntry(row));
    }
    const result = await this.pool!.query(`SELECT * FROM ledger_entries WHERE escrow_id = $1 ORDER BY created_at DESC`, [escrowId]);
    return result.rows.map((row) => this.mapLedgerEntry(row));
  }

  public async listEvents(escrowId: string, limit = 100): Promise<EscrowEventRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM escrow_events WHERE escrow_id = @escrowId ORDER BY created_at DESC LIMIT @limit`).all({ escrowId, limit }).map((row) => this.mapEvent(row));
    }
    const result = await this.pool!.query(`SELECT * FROM escrow_events WHERE escrow_id = $1 ORDER BY created_at DESC LIMIT $2`, [escrowId, limit]);
    return result.rows.map((row) => this.mapEvent(row));
  }

  public async close(): Promise<void> {
    if (this.sqlite) this.sqlite.close();
    if (this.pool) await this.pool.end();
  }
}
