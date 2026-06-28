import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";

type StoreProvider = "sqlite" | "postgres";

export type QueueJobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";
export type SupportCaseStatus = "open" | "pending" | "resolved" | "closed";
export type SupportCasePriority = "low" | "normal" | "high" | "urgent";

export interface QueueJobRecord {
  jobId: string;
  jobType: string;
  status: QueueJobStatus;
  payload: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueueJobFailureOptions {
  error: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface AbuseSignalRecord {
  signalId: string;
  subjectType: string;
  subjectId: string;
  category: string;
  severity: string;
  riskScore: number;
  reason: string;
  metadata?: string;
  createdAt: string;
}

export interface AbuseActionRecord {
  actionId: string;
  subjectType: string;
  subjectId: string;
  action: "watch" | "warn" | "limit" | "block" | "clear";
  reason: string;
  createdBy: string;
  expiresAt?: string;
  createdAt: string;
}

export interface SupportCaseRecord {
  caseId: string;
  status: SupportCaseStatus;
  priority: SupportCasePriority;
  subject: string;
  relatedEscrowId?: string;
  relatedUser?: string;
  source: string;
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportNoteRecord {
  noteId: string;
  caseId: string;
  author: string;
  body: string;
  actionType?: string;
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

export class ProductionOpsStore {
  private provider: StoreProvider;
  private sqlite?: Database.Database;
  private pool?: Pool;
  private initialized = false;

  constructor(private databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for production ops persistence");
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
        max: Number(process.env.POSTGRES_POOL_MAX || "3"),
        connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000"),
        query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || "8000"),
        ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
      });
    }
  }

  private schemaSql() {
    return `
      CREATE TABLE IF NOT EXISTS queue_jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        run_after TEXT NOT NULL,
        locked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS abuse_signals (
        signal_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        risk_score INTEGER NOT NULL,
        reason TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS abuse_actions (
        action_id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS support_cases (
        case_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        subject TEXT NOT NULL,
        related_escrow_id TEXT,
        related_user TEXT,
        source TEXT NOT NULL,
        created_by TEXT NOT NULL,
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS support_notes (
        note_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        action_type TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_run_after ON queue_jobs(status, run_after);
      CREATE INDEX IF NOT EXISTS idx_abuse_signals_created_at ON abuse_signals(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_abuse_actions_subject ON abuse_actions(subject_type, subject_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_support_cases_status ON support_cases(status);
      CREATE INDEX IF NOT EXISTS idx_support_notes_case_id ON support_notes(case_id);
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

  private mapJob(row: any): QueueJobRecord {
    return {
      jobId: row.job_id,
      jobType: row.job_type,
      status: row.status,
      payload: row.payload,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      runAfter: row.run_after,
      lockedAt: row.locked_at || undefined,
      lastError: row.last_error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSignal(row: any): AbuseSignalRecord {
    return {
      signalId: row.signal_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      category: row.category,
      severity: row.severity,
      riskScore: Number(row.risk_score),
      reason: row.reason,
      metadata: row.metadata || undefined,
      createdAt: row.created_at,
    };
  }

  private mapAction(row: any): AbuseActionRecord {
    return {
      actionId: row.action_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      action: row.action,
      reason: row.reason,
      createdBy: row.created_by,
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
    };
  }

  private mapCase(row: any): SupportCaseRecord {
    return {
      caseId: row.case_id,
      status: row.status,
      priority: row.priority,
      subject: row.subject,
      relatedEscrowId: row.related_escrow_id || undefined,
      relatedUser: row.related_user || undefined,
      source: row.source,
      createdBy: row.created_by,
      assignedTo: row.assigned_to || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNote(row: any): SupportNoteRecord {
    return {
      noteId: row.note_id,
      caseId: row.case_id,
      author: row.author,
      body: row.body,
      actionType: row.action_type || undefined,
      createdAt: row.created_at,
    };
  }

  public async enqueueJob(jobType: string, payload: any, options: { maxAttempts?: number; runAfter?: string } = {}) {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const job: QueueJobRecord = {
      jobId: id("job"),
      jobType,
      status: "queued",
      payload: JSON.stringify(payload),
      attempts: 0,
      maxAttempts: options.maxAttempts || 5,
      runAfter: options.runAfter || now,
      createdAt: now,
      updatedAt: now,
    };

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO queue_jobs (job_id, job_type, status, payload, attempts, max_attempts, run_after, created_at, updated_at)
        VALUES (@jobId, @jobType, @status, @payload, @attempts, @maxAttempts, @runAfter, @createdAt, @updatedAt)
      `).run(job);
    } else {
      await this.pool!.query(
        `INSERT INTO queue_jobs (job_id, job_type, status, payload, attempts, max_attempts, run_after, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [job.jobId, job.jobType, job.status, job.payload, job.attempts, job.maxAttempts, job.runAfter, job.createdAt, job.updatedAt]
      );
    }
    return job;
  }

  public async getQueueJob(jobId: string): Promise<QueueJobRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      const row = this.sqlite!.prepare(`SELECT * FROM queue_jobs WHERE job_id = @jobId`).get({ jobId });
      return row ? this.mapJob(row) : null;
    }
    const result = await this.pool!.query(`SELECT * FROM queue_jobs WHERE job_id = $1`, [jobId]);
    return result.rows[0] ? this.mapJob(result.rows[0]) : null;
  }

  public async claimNextQueueJob(workerId = "worker", lockTimeoutSeconds = 300): Promise<QueueJobRecord | null> {
    await this.initializeSchema();
    const now = new Date();
    const nowIso = now.toISOString();
    const staleBeforeIso = new Date(now.getTime() - lockTimeoutSeconds * 1000).toISOString();

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE queue_jobs
        SET status = 'failed',
            run_after = @nowIso,
            last_error = COALESCE(last_error, 'Recovered stale running job'),
            locked_at = NULL,
            updated_at = @nowIso
        WHERE status = 'running' AND locked_at < @staleBeforeIso
      `).run({ nowIso, staleBeforeIso });

      const row = this.sqlite!.prepare(`
        SELECT * FROM queue_jobs
        WHERE status IN ('queued', 'failed') AND run_after <= @nowIso
        ORDER BY run_after ASC, created_at ASC
        LIMIT 1
      `).get({ nowIso }) as any;
      if (!row) return null;

      this.sqlite!.prepare(`
        UPDATE queue_jobs
        SET status = 'running',
            attempts = attempts + 1,
            locked_at = @nowIso,
            last_error = NULL,
            updated_at = @nowIso
        WHERE job_id = @jobId
      `).run({ jobId: row.job_id, nowIso });

      return this.getQueueJob(row.job_id);
    }

    await this.pool!.query(
      `UPDATE queue_jobs
       SET status = 'failed',
           run_after = $1,
           last_error = COALESCE(last_error, 'Recovered stale running job'),
           locked_at = NULL,
           updated_at = $1
       WHERE status = 'running' AND locked_at < $2`,
      [nowIso, staleBeforeIso]
    );

    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT * FROM queue_jobs
         WHERE status IN ('queued', 'failed') AND run_after <= $1
         ORDER BY run_after ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [nowIso]
      );
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }

      const jobId = result.rows[0].job_id;
      const updated = await client.query(
        `UPDATE queue_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_at = $1,
             last_error = NULL,
             updated_at = $1
         WHERE job_id = $2
         RETURNING *`,
        [nowIso, jobId]
      );
      await client.query("COMMIT");
      return this.mapJob(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  public async markQueueJobSucceeded(jobId: string) {
    await this.initializeSchema();
    const now = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE queue_jobs
        SET status = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = @now
        WHERE job_id = @jobId
      `).run({ jobId, now });
    } else {
      await this.pool!.query(
        `UPDATE queue_jobs SET status = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = $1 WHERE job_id = $2`,
        [now, jobId]
      );
    }
    return this.getQueueJob(jobId);
  }

  public async markQueueJobFailed(jobId: string, options: QueueJobFailureOptions) {
    await this.initializeSchema();
    const job = await this.getQueueJob(jobId);
    if (!job) throw new Error("Queue job not found");

    const now = new Date();
    const baseDelayMs = options.baseDelayMs || 30_000;
    const maxDelayMs = options.maxDelayMs || 30 * 60_000;
    const delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, job.attempts - 1)));
    const nextStatus: QueueJobStatus = job.attempts >= job.maxAttempts ? "dead" : "failed";
    const runAfter = nextStatus === "dead" ? now.toISOString() : new Date(now.getTime() + delayMs).toISOString();
    const error = options.error.slice(0, 2000);

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE queue_jobs
        SET status = @nextStatus,
            run_after = @runAfter,
            locked_at = NULL,
            last_error = @error,
            updated_at = @updatedAt
        WHERE job_id = @jobId
      `).run({ jobId, nextStatus, runAfter, error, updatedAt: now.toISOString() });
    } else {
      await this.pool!.query(
        `UPDATE queue_jobs
         SET status = $1, run_after = $2, locked_at = NULL, last_error = $3, updated_at = $4
         WHERE job_id = $5`,
        [nextStatus, runAfter, error, now.toISOString(), jobId]
      );
    }
    return this.getQueueJob(jobId);
  }

  public async retryQueueJob(jobId: string, options: { resetAttempts?: boolean } = {}) {
    await this.initializeSchema();
    const now = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE queue_jobs
        SET status = 'queued',
            attempts = CASE WHEN @resetAttempts THEN 0 ELSE attempts END,
            run_after = @now,
            locked_at = NULL,
            last_error = NULL,
            updated_at = @now
        WHERE job_id = @jobId
      `).run({ jobId, now, resetAttempts: options.resetAttempts ? 1 : 0 });
    } else {
      await this.pool!.query(
        `UPDATE queue_jobs
         SET status = 'queued',
             attempts = CASE WHEN $1 THEN 0 ELSE attempts END,
             run_after = $2,
             locked_at = NULL,
             last_error = NULL,
             updated_at = $2
         WHERE job_id = $3`,
        [Boolean(options.resetAttempts), now, jobId]
      );
    }
    return this.getQueueJob(jobId);
  }

  public async listQueueJobs(limit = 100): Promise<QueueJobRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT @limit`).all({ limit }).map((row) => this.mapJob(row));
    }
    const result = await this.pool!.query(`SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapJob(row));
  }

  public async queueStatus() {
    const jobs = await this.listQueueJobs(500);
    return {
      queued: jobs.filter((job) => job.status === "queued").length,
      running: jobs.filter((job) => job.status === "running").length,
      failed: jobs.filter((job) => job.status === "failed").length,
      dead: jobs.filter((job) => job.status === "dead").length,
      succeeded: jobs.filter((job) => job.status === "succeeded").length,
    };
  }

  public async recordAbuseSignal(input: Omit<AbuseSignalRecord, "signalId" | "createdAt">) {
    await this.initializeSchema();
    const signal = { ...input, signalId: id("signal"), createdAt: new Date().toISOString() };
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO abuse_signals (signal_id, subject_type, subject_id, category, severity, risk_score, reason, metadata, created_at)
        VALUES (@signalId, @subjectType, @subjectId, @category, @severity, @riskScore, @reason, @metadata, @createdAt)
      `).run(signal);
    } else {
      await this.pool!.query(
        `INSERT INTO abuse_signals (signal_id, subject_type, subject_id, category, severity, risk_score, reason, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [signal.signalId, signal.subjectType, signal.subjectId, signal.category, signal.severity, signal.riskScore, signal.reason, signal.metadata || null, signal.createdAt]
      );
    }
    return signal;
  }

  public async listAbuseSignals(limit = 100): Promise<AbuseSignalRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM abuse_signals ORDER BY created_at DESC LIMIT @limit`).all({ limit }).map((row) => this.mapSignal(row));
    }
    const result = await this.pool!.query(`SELECT * FROM abuse_signals ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapSignal(row));
  }

  public async recordAbuseAction(input: Omit<AbuseActionRecord, "actionId" | "createdAt">): Promise<AbuseActionRecord> {
    await this.initializeSchema();
    const action: AbuseActionRecord = { ...input, actionId: id("abuse-action"), createdAt: new Date().toISOString() };
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO abuse_actions (action_id, subject_type, subject_id, action, reason, created_by, expires_at, created_at)
        VALUES (@actionId, @subjectType, @subjectId, @action, @reason, @createdBy, @expiresAt, @createdAt)
      `).run({ ...action, expiresAt: action.expiresAt || null });
    } else {
      await this.pool!.query(
        `INSERT INTO abuse_actions (action_id, subject_type, subject_id, action, reason, created_by, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [action.actionId, action.subjectType, action.subjectId, action.action, action.reason, action.createdBy, action.expiresAt || null, action.createdAt]
      );
    }
    return action;
  }

  public async listAbuseActions(limit = 100): Promise<AbuseActionRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM abuse_actions ORDER BY created_at DESC LIMIT @limit`).all({ limit }).map((row) => this.mapAction(row));
    }
    const result = await this.pool!.query(`SELECT * FROM abuse_actions ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapAction(row));
  }

  public async createSupportCase(input: {
    subject: string;
    priority?: SupportCasePriority;
    relatedEscrowId?: string;
    relatedUser?: string;
    source: string;
    createdBy: string;
    note?: string;
  }) {
    await this.initializeSchema();
    const now = new Date().toISOString();
    const supportCase: SupportCaseRecord = {
      caseId: id("case"),
      status: "open",
      priority: input.priority || "normal",
      subject: input.subject,
      relatedEscrowId: input.relatedEscrowId,
      relatedUser: input.relatedUser,
      source: input.source,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO support_cases (case_id, status, priority, subject, related_escrow_id, related_user, source, created_by, created_at, updated_at)
        VALUES (@caseId, @status, @priority, @subject, @relatedEscrowId, @relatedUser, @source, @createdBy, @createdAt, @updatedAt)
      `).run({ ...supportCase, relatedEscrowId: supportCase.relatedEscrowId || null, relatedUser: supportCase.relatedUser || null });
    } else {
      await this.pool!.query(
        `INSERT INTO support_cases (case_id, status, priority, subject, related_escrow_id, related_user, source, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [supportCase.caseId, supportCase.status, supportCase.priority, supportCase.subject, supportCase.relatedEscrowId || null, supportCase.relatedUser || null, supportCase.source, supportCase.createdBy, supportCase.createdAt, supportCase.updatedAt]
      );
    }

    if (input.note) {
      await this.addSupportNote(supportCase.caseId, input.createdBy, input.note, "case_created");
    }
    return supportCase;
  }

  public async addSupportNote(caseId: string, author: string, body: string, actionType?: string) {
    await this.initializeSchema();
    const note: SupportNoteRecord = { noteId: id("note"), caseId, author, body, actionType, createdAt: new Date().toISOString() };
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO support_notes (note_id, case_id, author, body, action_type, created_at)
        VALUES (@noteId, @caseId, @author, @body, @actionType, @createdAt)
      `).run({ ...note, actionType: note.actionType || null });
    } else {
      await this.pool!.query(
        `INSERT INTO support_notes (note_id, case_id, author, body, action_type, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [note.noteId, note.caseId, note.author, note.body, note.actionType || null, note.createdAt]
      );
    }
    return note;
  }

  public async listSupportCases(limit = 100): Promise<SupportCaseRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM support_cases ORDER BY updated_at DESC LIMIT @limit`).all({ limit }).map((row) => this.mapCase(row));
    }
    const result = await this.pool!.query(`SELECT * FROM support_cases ORDER BY updated_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapCase(row));
  }

  public async searchSupportCases(query: string, limit = 100): Promise<SupportCaseRecord[]> {
    await this.initializeSchema();
    const pattern = `%${query.toLowerCase()}%`;
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`
        SELECT * FROM support_cases
        WHERE lower(subject) LIKE @pattern
           OR lower(COALESCE(related_escrow_id, '')) LIKE @pattern
           OR lower(COALESCE(related_user, '')) LIKE @pattern
           OR lower(COALESCE(assigned_to, '')) LIKE @pattern
        ORDER BY updated_at DESC
        LIMIT @limit
      `).all({ pattern, limit }).map((row) => this.mapCase(row));
    }
    const result = await this.pool!.query(
      `SELECT * FROM support_cases
       WHERE lower(subject) LIKE $1
          OR lower(COALESCE(related_escrow_id, '')) LIKE $1
          OR lower(COALESCE(related_user, '')) LIKE $1
          OR lower(COALESCE(assigned_to, '')) LIKE $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [pattern, limit]
    );
    return result.rows.map((row) => this.mapCase(row));
  }

  public async updateSupportCase(
    caseId: string,
    updates: Partial<Pick<SupportCaseRecord, "status" | "priority" | "assignedTo">>
  ): Promise<SupportCaseRecord | null> {
    await this.initializeSchema();
    const currentRows = this.provider === "sqlite"
      ? this.sqlite!.prepare(`SELECT * FROM support_cases WHERE case_id = @caseId`).all({ caseId })
      : (await this.pool!.query(`SELECT * FROM support_cases WHERE case_id = $1`, [caseId])).rows;
    if (!currentRows[0]) return null;

    const current = this.mapCase(currentRows[0]);
    const next = {
      caseId,
      status: updates.status || current.status,
      priority: updates.priority || current.priority,
      assignedTo: updates.assignedTo === undefined ? current.assignedTo || null : updates.assignedTo || null,
      updatedAt: new Date().toISOString(),
    };

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE support_cases
        SET status = @status,
            priority = @priority,
            assigned_to = @assignedTo,
            updated_at = @updatedAt
        WHERE case_id = @caseId
      `).run(next);
    } else {
      await this.pool!.query(
        `UPDATE support_cases
         SET status = $1, priority = $2, assigned_to = $3, updated_at = $4
         WHERE case_id = $5`,
        [next.status, next.priority, next.assignedTo, next.updatedAt, next.caseId]
      );
    }

    const rows = this.provider === "sqlite"
      ? this.sqlite!.prepare(`SELECT * FROM support_cases WHERE case_id = @caseId`).all({ caseId })
      : (await this.pool!.query(`SELECT * FROM support_cases WHERE case_id = $1`, [caseId])).rows;
    return rows[0] ? this.mapCase(rows[0]) : null;
  }

  public async listSupportNotes(caseId: string): Promise<SupportNoteRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM support_notes WHERE case_id = @caseId ORDER BY created_at DESC`).all({ caseId }).map((row) => this.mapNote(row));
    }
    const result = await this.pool!.query(`SELECT * FROM support_notes WHERE case_id = $1 ORDER BY created_at DESC`, [caseId]);
    return result.rows.map((row) => this.mapNote(row));
  }
}
