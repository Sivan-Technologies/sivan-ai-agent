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

  public async listSupportNotes(caseId: string): Promise<SupportNoteRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM support_notes WHERE case_id = @caseId ORDER BY created_at DESC`).all({ caseId }).map((row) => this.mapNote(row));
    }
    const result = await this.pool!.query(`SELECT * FROM support_notes WHERE case_id = $1 ORDER BY created_at DESC`, [caseId]);
    return result.rows.map((row) => this.mapNote(row));
  }
}
