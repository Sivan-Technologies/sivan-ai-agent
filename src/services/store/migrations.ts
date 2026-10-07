import type Database from "better-sqlite3";
import type { Pool } from "pg";
import { payoutAccountToken, encryptAccountNumber } from "./guards.js";

export function schemaSql(numberType: string): string {
  return `
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      whatsapp_number TEXT NOT NULL UNIQUE,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role_history TEXT NOT NULL DEFAULT '[]',
      telegram_user_id TEXT,
      telegram_username TEXT,
      telegram_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transaction_references (
      id TEXT PRIMARY KEY,
      sivan_transaction_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_value TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, reference_type, reference_value, resource_type, resource_id)
    );

    CREATE TABLE IF NOT EXISTS pairing_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
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
      funding_expires_at TEXT,
      active_payment_expires_at TEXT,
      payment_regeneration_count INTEGER NOT NULL DEFAULT 0,
      last_payment_reminder_at TEXT,
      received_amount ${numberType},
      provider_payment_status TEXT,
      payment_checked_at TEXT,
      reconciliation_flags TEXT,
      release_requested_at TEXT,
      delivered_at TEXT,
      inspection_expires_at TEXT,
      manual_payout_reference TEXT,
      payout_notes TEXT,
      released_by TEXT,
      released_at TEXT,
      client_request_id TEXT,
      fee_payer TEXT NOT NULL DEFAULT 'buyer',
      network TEXT,
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
      processor_fee ${numberType},
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
      hash TEXT,
      previous_hash TEXT,
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

function ensureSqliteColumn(sqlite: Database.Database, table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!columns.some((entry) => entry.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function renameSqliteColumnIfPresent(sqlite: Database.Database, table: string, from: string, to: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[];
  const hasOld = columns.some((entry) => entry.name === from);
  const hasNew = columns.some((entry) => entry.name === to);
  if (hasOld && !hasNew) {
    sqlite.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}

function migrateSqlitePayoutAccountNumbers(sqlite: Database.Database) {
  const rows = sqlite.prepare(`
    SELECT payout_account_id, account_number
    FROM payout_accounts
    WHERE (account_number_encrypted IS NULL OR account_number_encrypted = '')
      AND account_number NOT LIKE 'acct:%'
  `).all() as Array<{ payout_account_id: string; account_number: string }>;
  const update = sqlite.prepare(`
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

export function initializeSqliteSchema(sqlite: Database.Database): void {
  sqlite.exec(schemaSql("REAL"));
  renameSqliteColumnIfPresent(sqlite, "transaction_references", "reference_id", "id");
  ensureSqliteColumn(sqlite, "users", "email", "TEXT");

  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);");
  ensureSqliteColumn(sqlite, "users", "password_hash", "TEXT");
  ensureSqliteColumn(sqlite, "users", "telegram_user_id", "TEXT");
  ensureSqliteColumn(sqlite, "users", "telegram_username", "TEXT");
  ensureSqliteColumn(sqlite, "users", "telegram_verified_at", "TEXT");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;");
  ensureSqliteColumn(sqlite, "payout_accounts", "bank_code", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "account_number_encrypted", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "account_number_last4", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "resolved_account_name", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "name_match_score", "INTEGER");
  ensureSqliteColumn(sqlite, "payout_accounts", "name_match_level", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "account_verified_at", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "account_verification_provider", "TEXT");
  ensureSqliteColumn(sqlite, "payout_accounts", "shared_account_count", "INTEGER NOT NULL DEFAULT 1");
  ensureSqliteColumn(sqlite, "payout_accounts", "shared_account_flag", "INTEGER NOT NULL DEFAULT 0");
  migrateSqlitePayoutAccountNumbers(sqlite);
  ensureSqliteColumn(sqlite, "escrows", "manual_payout_reference", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "payout_notes", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "released_by", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "released_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "client_request_id", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "received_amount", "REAL");
  ensureSqliteColumn(sqlite, "escrows", "delivered_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "inspection_expires_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "funding_expires_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "active_payment_expires_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "payment_regeneration_count", "INTEGER NOT NULL DEFAULT 0");
  ensureSqliteColumn(sqlite, "escrows", "last_payment_reminder_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "provider_payment_status", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "payment_checked_at", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "reconciliation_flags", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "fee_payer", "TEXT NOT NULL DEFAULT 'buyer'");
  ensureSqliteColumn(sqlite, "escrows", "network", "TEXT");
  ensureSqliteColumn(sqlite, "escrows", "ai_dispute_recommendation", "TEXT");
  ensureSqliteColumn(sqlite, "escrow_events", "hash", "TEXT");
  ensureSqliteColumn(sqlite, "escrow_events", "previous_hash", "TEXT");
  ensureSqliteColumn(sqlite, "transactions", "processor_fee", "REAL");

  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_escrows_client_request_id ON escrows(client_request_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_escrows_inspection_expires ON escrows(inspection_expires_at) WHERE status = 'DELIVERED'");
}

async function ensurePostgresColumn(pool: Pool, table: string, column: string, definition: string) {
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
}

async function migratePostgresPayoutAccountNumbers(pool: Pool) {
  const result = await pool.query(`
    SELECT payout_account_id, account_number
    FROM payout_accounts
    WHERE (account_number_encrypted IS NULL OR account_number_encrypted = '')
      AND account_number NOT LIKE 'acct:%'
  `);
  for (const row of result.rows) {
    await pool.query(
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

export async function initializePostgresSchema(pool: Pool, schema?: string): Promise<void> {
  if (schema) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }
  await pool.query(schemaSql("DOUBLE PRECISION"));
  await ensurePostgresColumn(pool, "users", "email", "TEXT UNIQUE");
  await ensurePostgresColumn(pool, "users", "password_hash", "TEXT");
  await ensurePostgresColumn(pool, "users", "telegram_user_id", "TEXT");
  await ensurePostgresColumn(pool, "users", "telegram_username", "TEXT");
  await ensurePostgresColumn(pool, "users", "telegram_verified_at", "TEXT");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ON users(telegram_user_id) WHERE telegram_user_id IS NOT NULL");
  await ensurePostgresColumn(pool, "payout_accounts", "bank_code", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "account_number_encrypted", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "account_number_last4", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "resolved_account_name", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "name_match_score", "INTEGER");
  await ensurePostgresColumn(pool, "payout_accounts", "name_match_level", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "account_verified_at", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "account_verification_provider", "TEXT");
  await ensurePostgresColumn(pool, "payout_accounts", "shared_account_count", "INTEGER NOT NULL DEFAULT 1");
  await ensurePostgresColumn(pool, "payout_accounts", "shared_account_flag", "INTEGER NOT NULL DEFAULT 0");
  await migratePostgresPayoutAccountNumbers(pool);
  await ensurePostgresColumn(pool, "escrows", "buyer_whatsapp", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "seller_whatsapp", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "buyer_user_id", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "seller_user_id", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "manual_payout_reference", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "payout_notes", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "released_by", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "released_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "client_request_id", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "received_amount", "DOUBLE PRECISION");
  await ensurePostgresColumn(pool, "escrows", "delivered_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "inspection_expires_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "funding_expires_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "active_payment_expires_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "payment_regeneration_count", "INTEGER NOT NULL DEFAULT 0");
  await ensurePostgresColumn(pool, "escrows", "last_payment_reminder_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "provider_payment_status", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "payment_checked_at", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "reconciliation_flags", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "fee_payer", "TEXT NOT NULL DEFAULT 'buyer'");
  await ensurePostgresColumn(pool, "escrows", "network", "TEXT");
  await ensurePostgresColumn(pool, "escrows", "ai_dispute_recommendation", "TEXT");
  await ensurePostgresColumn(pool, "escrow_events", "hash", "TEXT");
  await ensurePostgresColumn(pool, "escrow_events", "previous_hash", "TEXT");
  await ensurePostgresColumn(pool, "transactions", "processor_fee", "DOUBLE PRECISION");

  await pool.query("CREATE INDEX IF NOT EXISTS idx_escrows_client_request_id ON escrows(client_request_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_escrows_inspection_expires ON escrows(inspection_expires_at) WHERE status = 'DELIVERED'");
}
