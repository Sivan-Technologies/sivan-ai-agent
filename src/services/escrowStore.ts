import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";

export type EscrowCurrency = "NAIRA" | "USDC";
export type EscrowStatus =
  | "CREATED"
  | "PENDING_PROFILE"
  | "PENDING_PAYMENT"
  | "FUNDED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PENDING_RELEASE"
  | "RELEASED"
  | "DISPUTED"
  | "FAILED"
  | "CANCELLED";

export type SettlementPolicy = "manual_naira_release" | "autonomous_usdc_release";
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
  accountName?: string;
  verificationStatus: "pending" | "verified" | "failed";
  providerRecipientCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowRecord {
  escrowId: string;
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
  releaseRequestedAt?: string;
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

function detectProvider(databaseUrl: string, provider?: string): StoreProvider {
  if (provider === "postgres" || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
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
    return {
      payoutAccountId: row.payout_account_id,
      userId: row.user_id,
      bankName: row.bank_name,
      accountNumber: row.account_number,
      accountName: row.account_name || undefined,
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
      releaseRequestedAt: row.release_requested_at || undefined,
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
        account_name TEXT,
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
        release_requested_at TEXT,
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

      CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);
      CREATE INDEX IF NOT EXISTS idx_escrows_payment_reference ON escrows(payment_reference);
      CREATE INDEX IF NOT EXISTS idx_transactions_escrow_id ON transactions(escrow_id);
      CREATE INDEX IF NOT EXISTS idx_escrow_events_escrow_id ON escrow_events(escrow_id);
    `;
  }

  private initializeSchemaSync() {
    this.sqlite!.exec(this.schemaSql("REAL"));
  }

  public async initializeSchema(): Promise<void> {
    if (this.initialized) return;
    if (this.provider === "sqlite") {
      this.initializeSchemaSync();
    } else {
      await this.pool!.query(this.schemaSql("DOUBLE PRECISION"));
    }
    this.initialized = true;
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
    accountName?: string;
    verificationStatus?: "pending" | "verified" | "failed";
    providerRecipientCode?: string;
  }): Promise<PayoutAccountRecord> {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const existing = await this.getPayoutAccount(input.userId);
    const payoutAccountId = existing?.payoutAccountId || id("payout");
    const verificationStatus = input.verificationStatus || existing?.verificationStatus || "pending";

    if (existing) {
      if (this.provider === "sqlite") {
        this.sqlite!.prepare(`
          UPDATE payout_accounts
          SET bank_name = @bankName, account_number = @accountNumber, account_name = @accountName,
              verification_status = @verificationStatus, provider_recipient_code = @providerRecipientCode, updated_at = @now
          WHERE payout_account_id = @payoutAccountId
        `).run({ ...input, accountName: input.accountName || null, providerRecipientCode: input.providerRecipientCode || null, verificationStatus, now, payoutAccountId });
      } else {
        await this.pool!.query(
          `UPDATE payout_accounts SET bank_name = $1, account_number = $2, account_name = $3, verification_status = $4,
           provider_recipient_code = $5, updated_at = $6 WHERE payout_account_id = $7`,
          [input.bankName, input.accountNumber, input.accountName || null, verificationStatus, input.providerRecipientCode || null, now, payoutAccountId]
        );
      }
    } else if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO payout_accounts (payout_account_id, user_id, bank_name, account_number, account_name, verification_status, provider_recipient_code, created_at, updated_at)
        VALUES (@payoutAccountId, @userId, @bankName, @accountNumber, @accountName, @verificationStatus, @providerRecipientCode, @now, @now)
      `).run({ ...input, payoutAccountId, accountName: input.accountName || null, providerRecipientCode: input.providerRecipientCode || null, verificationStatus, now });
    } else {
      await this.pool!.query(
        `INSERT INTO payout_accounts (payout_account_id, user_id, bank_name, account_number, account_name, verification_status, provider_recipient_code, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [payoutAccountId, input.userId, input.bankName, input.accountNumber, input.accountName || null, verificationStatus, input.providerRecipientCode || null, now, now]
      );
    }

    return (await this.getPayoutAccount(input.userId))!;
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
    const status: EscrowStatus = input.sellerUserId ? "PENDING_PAYMENT" : "PENDING_PROFILE";
    const settlementPolicy: SettlementPolicy = input.currency === "NAIRA" ? "manual_naira_release" : "autonomous_usdc_release";

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO escrows (
          escrow_id, buyer_user_id, seller_user_id, seller_whatsapp, amount, currency,
          purpose, status, settlement_policy, created_by_channel, created_at, updated_at
        ) VALUES (
          @escrowId, @buyerUserId, @sellerUserId, @sellerWhatsapp, @amount, @currency,
          @purpose, @status, @settlementPolicy, @createdByChannel, @now, @now
        )
      `).run({ ...input, escrowId, status, settlementPolicy, sellerUserId: input.sellerUserId || null, sellerWhatsapp: input.sellerWhatsapp || null, now });
    } else {
      await this.pool!.query(
        `INSERT INTO escrows (
          escrow_id, buyer_user_id, seller_user_id, seller_whatsapp, amount, currency,
          purpose, status, settlement_policy, created_by_channel, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [escrowId, input.buyerUserId, input.sellerUserId || null, input.sellerWhatsapp || null, input.amount, input.currency, input.purpose, status, settlementPolicy, input.createdByChannel, now, now]
      );
    }

    await this.addEvent({ escrowId, actor: input.buyerUserId, actorRole: "buyer", channel: input.createdByChannel, nextStatus: status, eventType: "escrow_created", reason: input.purpose });
    return (await this.getEscrowById(escrowId))!;
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

  public async markFundedByPaymentReference(paymentReference: string, metadata?: any): Promise<EscrowRecord | null> {
    await this.initializeSchema();
    const escrow = await this.findEscrowByPaymentReference(paymentReference);
    if (!escrow) return null;
    if (["FUNDED", "IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status)) return escrow;

    await this.transitionEscrow(escrow.escrowId, "IN_PROGRESS", {
      actor: "paystack",
      actorRole: "payment_provider",
      channel: "webhook",
      eventType: "payment_verified",
      reason: paymentReference,
      metadata,
    });
    await this.updateTransactionStatus(paymentReference, "success", metadata);
    return this.getEscrowById(escrow.escrowId);
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
    if (!["IN_PROGRESS", "FUNDED", "COMPLETED"].includes(escrow.status)) {
      throw new Error(`Escrow cannot be released from ${escrow.status}`);
    }

    if (escrow.currency === "USDC") {
      await this.transitionEscrow(escrowId, "RELEASED", {
        actor,
        actorRole: "buyer",
        channel,
        eventType: "autonomous_usdc_release",
        reason: "Buyer confirmed release; USDC policy allows autonomous release",
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

    return (await this.getEscrowById(escrowId))!;
  }

  public async approveManualRelease(escrowId: string, adminUser: string): Promise<EscrowRecord> {
    const escrow = await this.getEscrowById(escrowId);
    if (!escrow) throw new Error("Escrow not found");
    if (escrow.currency === "NAIRA" && escrow.status !== "PENDING_RELEASE") {
      throw new Error("Naira escrow must be pending release before admin approval");
    }
    await this.transitionEscrow(escrowId, "RELEASED", {
      actor: adminUser,
      actorRole: "admin",
      channel: "admin",
      eventType: "manual_release_approved",
      reason: escrow.currency === "NAIRA" ? "Manual payout approved for MVP" : "Admin release approved",
    });
    await this.addTransaction({
      escrowId,
      provider: escrow.currency === "NAIRA" ? "paystack" : "x402",
      transactionType: "release",
      status: escrow.currency === "NAIRA" ? "manual_approved" : "released",
      amount: escrow.amount,
      currency: escrow.currency,
      reference: escrow.paymentReference,
    });
    return (await this.getEscrowById(escrowId))!;
  }

  public async markDisputed(escrowId: string, actor: string, channel: string, reason?: string): Promise<EscrowRecord> {
    await this.transitionEscrow(escrowId, "DISPUTED", {
      actor,
      actorRole: "participant",
      channel,
      eventType: "dispute_opened",
      reason: reason || "Dispute opened",
    });
    return (await this.getEscrowById(escrowId))!;
  }

  private async transitionEscrow(escrowId: string, nextStatus: EscrowStatus, event: Omit<Parameters<EscrowStore["addEvent"]>[0], "escrowId" | "previousStatus" | "nextStatus"> & { metadata?: any }): Promise<void> {
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
