import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";

type StoreProvider = "sqlite" | "postgres";

export type ReconciliationRunStatus = "running" | "completed" | "failed";
export type ReconciliationFindingSeverity = "low" | "medium" | "high" | "critical";
export type ReconciliationFindingType =
  | "missing_in_sivan"
  | "missing_at_provider"
  | "amount_drift"
  | "currency_drift"
  | "status_drift"
  | "provider_pull_unsupported"
  | "provider_pull_failed"
  | "provider_verification_failed";

export interface ReconciliationRunRecord {
  runId: string;
  status: ReconciliationRunStatus;
  windowStart: string;
  windowEnd: string;
  providers: string[];
  summary?: any;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ProviderTransactionSnapshotRecord {
  snapshotId: string;
  runId: string;
  provider: string;
  paymentReference: string;
  transactionReference?: string;
  status: string;
  amount: number;
  currency: string;
  paidAt?: string;
  rawPayload?: string;
  createdAt: string;
}

export interface ReconciliationFindingRecord {
  findingId: string;
  runId: string;
  provider: string;
  severity: ReconciliationFindingSeverity;
  findingType: ReconciliationFindingType;
  paymentReference?: string;
  escrowId?: string;
  message: string;
  expected?: any;
  actual?: any;
  status: "open" | "resolved";
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

function safeJson(value: any) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

export class ReconciliationStore {
  private provider: StoreProvider;
  private sqlite?: Database.Database;
  private pool?: Pool;
  private initialized = false;

  constructor(private databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for reconciliation persistence");
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

  private schemaSql() {
    return `
      CREATE TABLE IF NOT EXISTS reconciliation_runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        providers TEXT NOT NULL,
        summary TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS provider_transaction_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        payment_reference TEXT NOT NULL,
        transaction_reference TEXT,
        status TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        currency TEXT NOT NULL,
        paid_at TEXT,
        raw_payload TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reconciliation_findings (
        finding_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        severity TEXT NOT NULL,
        finding_type TEXT NOT NULL,
        payment_reference TEXT,
        escrow_id TEXT,
        message TEXT NOT NULL,
        expected TEXT,
        actual TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started_at ON reconciliation_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_snapshots_run_provider ON provider_transaction_snapshots(run_id, provider);
      CREATE INDEX IF NOT EXISTS idx_provider_snapshots_reference ON provider_transaction_snapshots(provider, payment_reference);
      CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_run ON reconciliation_findings(run_id, severity);
      CREATE INDEX IF NOT EXISTS idx_reconciliation_findings_status ON reconciliation_findings(status, created_at DESC);
    `;
  }

  private initializeSchemaSync() {
    this.sqlite!.exec(this.schemaSql());
  }

  public async initializeSchema() {
    if (this.initialized) return;
    if (this.provider === "sqlite") {
      this.initializeSchemaSync();
    } else {
      await this.pool!.query(this.schemaSql());
    }
    this.initialized = true;
  }

  private mapRun(row: any): ReconciliationRunRecord {
    return {
      runId: row.run_id,
      status: row.status,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      providers: row.providers ? JSON.parse(row.providers) : [],
      summary: row.summary ? JSON.parse(row.summary) : undefined,
      error: row.error || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
    };
  }

  private mapSnapshot(row: any): ProviderTransactionSnapshotRecord {
    return {
      snapshotId: row.snapshot_id,
      runId: row.run_id,
      provider: row.provider,
      paymentReference: row.payment_reference,
      transactionReference: row.transaction_reference || undefined,
      status: row.status,
      amount: Number(row.amount),
      currency: row.currency,
      paidAt: row.paid_at || undefined,
      rawPayload: row.raw_payload || undefined,
      createdAt: row.created_at,
    };
  }

  private mapFinding(row: any): ReconciliationFindingRecord {
    return {
      findingId: row.finding_id,
      runId: row.run_id,
      provider: row.provider,
      severity: row.severity,
      findingType: row.finding_type,
      paymentReference: row.payment_reference || undefined,
      escrowId: row.escrow_id || undefined,
      message: row.message,
      expected: row.expected ? JSON.parse(row.expected) : undefined,
      actual: row.actual ? JSON.parse(row.actual) : undefined,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  public async startRun(input: { windowStart: string; windowEnd: string; providers: string[] }) {
    await this.initializeSchema();
    const runId = id("recon");
    const startedAt = new Date().toISOString();
    const providers = JSON.stringify(input.providers);
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO reconciliation_runs (run_id, status, window_start, window_end, providers, started_at)
        VALUES (@runId, 'running', @windowStart, @windowEnd, @providers, @startedAt)
      `).run({ runId, ...input, providers, startedAt });
    } else {
      await this.pool!.query(
        `INSERT INTO reconciliation_runs (run_id, status, window_start, window_end, providers, started_at)
         VALUES ($1, 'running', $2, $3, $4, $5)`,
        [runId, input.windowStart, input.windowEnd, providers, startedAt]
      );
    }
    return this.getRun(runId) as Promise<ReconciliationRunRecord>;
  }

  public async completeRun(runId: string, summary: any) {
    await this.initializeSchema();
    const completedAt = new Date().toISOString();
    const payload = safeJson(summary);
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE reconciliation_runs SET status = 'completed', summary = @summary, completed_at = @completedAt WHERE run_id = @runId`)
        .run({ runId, summary: payload, completedAt });
    } else {
      await this.pool!.query(`UPDATE reconciliation_runs SET status = 'completed', summary = $1, completed_at = $2 WHERE run_id = $3`, [payload, completedAt, runId]);
    }
    return this.getRun(runId) as Promise<ReconciliationRunRecord>;
  }

  public async failRun(runId: string, error: string, summary?: any) {
    await this.initializeSchema();
    const completedAt = new Date().toISOString();
    const payload = safeJson(summary);
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE reconciliation_runs SET status = 'failed', error = @error, summary = @summary, completed_at = @completedAt WHERE run_id = @runId`)
        .run({ runId, error, summary: payload, completedAt });
    } else {
      await this.pool!.query(`UPDATE reconciliation_runs SET status = 'failed', error = $1, summary = $2, completed_at = $3 WHERE run_id = $4`, [error, payload, completedAt, runId]);
    }
    return this.getRun(runId) as Promise<ReconciliationRunRecord>;
  }

  public async addSnapshot(input: Omit<ProviderTransactionSnapshotRecord, "snapshotId" | "createdAt">) {
    await this.initializeSchema();
    const snapshotId = id("snap");
    const createdAt = new Date().toISOString();
    const rawPayload = safeJson(input.rawPayload);
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO provider_transaction_snapshots (
          snapshot_id, run_id, provider, payment_reference, transaction_reference, status, amount, currency, paid_at, raw_payload, created_at
        ) VALUES (
          @snapshotId, @runId, @provider, @paymentReference, @transactionReference, @status, @amount, @currency, @paidAt, @rawPayload, @createdAt
        )
      `).run({ ...input, snapshotId, transactionReference: input.transactionReference || null, paidAt: input.paidAt || null, rawPayload, createdAt });
    } else {
      await this.pool!.query(
        `INSERT INTO provider_transaction_snapshots (
          snapshot_id, run_id, provider, payment_reference, transaction_reference, status, amount, currency, paid_at, raw_payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [snapshotId, input.runId, input.provider, input.paymentReference, input.transactionReference || null, input.status, input.amount, input.currency, input.paidAt || null, rawPayload, createdAt]
      );
    }
    return snapshotId;
  }

  public async addFinding(input: Omit<ReconciliationFindingRecord, "findingId" | "createdAt" | "status"> & { status?: "open" | "resolved" }) {
    await this.initializeSchema();
    const findingId = id("finding");
    const createdAt = new Date().toISOString();
    const expected = safeJson(input.expected);
    const actual = safeJson(input.actual);
    const status = input.status || "open";
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO reconciliation_findings (
          finding_id, run_id, provider, severity, finding_type, payment_reference, escrow_id, message, expected, actual, status, created_at
        ) VALUES (
          @findingId, @runId, @provider, @severity, @findingType, @paymentReference, @escrowId, @message, @expected, @actual, @status, @createdAt
        )
      `).run({ ...input, findingId, paymentReference: input.paymentReference || null, escrowId: input.escrowId || null, expected, actual, status, createdAt });
    } else {
      await this.pool!.query(
        `INSERT INTO reconciliation_findings (
          finding_id, run_id, provider, severity, finding_type, payment_reference, escrow_id, message, expected, actual, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [findingId, input.runId, input.provider, input.severity, input.findingType, input.paymentReference || null, input.escrowId || null, input.message, expected, actual, status, createdAt]
      );
    }
    return findingId;
  }

  public async getRun(runId: string): Promise<ReconciliationRunRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      const row = this.sqlite!.prepare(`SELECT * FROM reconciliation_runs WHERE run_id = @runId`).get({ runId });
      return row ? this.mapRun(row) : null;
    }
    const result = await this.pool!.query(`SELECT * FROM reconciliation_runs WHERE run_id = $1`, [runId]);
    return result.rows[0] ? this.mapRun(result.rows[0]) : null;
  }

  public async listRuns(limit = 50): Promise<ReconciliationRunRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT @limit`).all({ limit }).map((row) => this.mapRun(row));
    }
    const result = await this.pool!.query(`SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapRun(row));
  }

  public async listSnapshots(runId: string): Promise<ProviderTransactionSnapshotRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM provider_transaction_snapshots WHERE run_id = @runId ORDER BY provider, payment_reference`).all({ runId }).map((row) => this.mapSnapshot(row));
    }
    const result = await this.pool!.query(`SELECT * FROM provider_transaction_snapshots WHERE run_id = $1 ORDER BY provider, payment_reference`, [runId]);
    return result.rows.map((row) => this.mapSnapshot(row));
  }

  public async listFindings(runId: string): Promise<ReconciliationFindingRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM reconciliation_findings WHERE run_id = @runId ORDER BY created_at DESC`).all({ runId }).map((row) => this.mapFinding(row));
    }
    const result = await this.pool!.query(`SELECT * FROM reconciliation_findings WHERE run_id = $1 ORDER BY created_at DESC`, [runId]);
    return result.rows.map((row) => this.mapFinding(row));
  }
}
