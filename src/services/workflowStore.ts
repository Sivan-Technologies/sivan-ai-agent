import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

export interface WorkflowTaskRecord {
  taskId: string;
  taskType: string;
  userPaymentPreference: string;
  userEmail: string;
  amount: number;
  instructions: string;
  agentKey?: string;
  tools?: string;
  executionResults?: string;
  paymentMethod: string;
  paymentReference?: string;
  paymentId?: string;
  paymentStatus: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEventRecord {
  eventId: string;
  paymentReference: string;
  eventType: string;
  payload: string;
  receivedAt: string;
}

export type NairaExecutionClaim =
  | { claimed: true; task: WorkflowTaskRecord }
  | { claimed: false; task: WorkflowTaskRecord | null; reason: string };

type StoreProvider = "sqlite" | "postgres";

function detectProvider(databaseUrl: string, provider?: string): StoreProvider {
  if (provider === "postgres" || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

export class WorkflowStore {
  private provider: StoreProvider;
  private sqlite?: Database.Database;
  private pool?: Pool;
  private initialized = false;

  constructor(private databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for workflow persistence");
    }

    this.provider = detectProvider(databaseUrl, provider);
    if (this.provider === "sqlite") {
      const folder = path.dirname(databaseUrl);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
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

  private mapTaskRow(row: any): WorkflowTaskRecord | null {
    if (!row) return null;
    return {
      taskId: row.task_id,
      taskType: row.task_type,
      userPaymentPreference: row.user_payment_preference,
      userEmail: row.user_email,
      amount: Number(row.amount),
      instructions: row.instructions,
      agentKey: row.agent_key || undefined,
      tools: row.tools || undefined,
      executionResults: row.execution_results || undefined,
      paymentMethod: row.payment_method,
      paymentReference: row.payment_reference || undefined,
      paymentId: row.payment_id || undefined,
      paymentStatus: row.payment_status,
      note: row.note || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapWebhookRow(row: any): WebhookEventRecord {
    return {
      eventId: row.event_id,
      paymentReference: row.payment_reference,
      eventType: row.event_type,
      payload: row.payload,
      receivedAt: row.received_at,
    };
  }

  private initializeSchemaSync() {
    this.sqlite!.exec(`
      CREATE TABLE IF NOT EXISTS workflow_tasks (
        task_id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        user_payment_preference TEXT NOT NULL,
        user_email TEXT NOT NULL,
        amount REAL NOT NULL,
        instructions TEXT,
        agent_key TEXT,
        tools TEXT,
        execution_results TEXT,
        payment_reference TEXT,
        payment_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        payment_reference TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }

  private async initializeSchema() {
    if (this.initialized) return;
    if (this.provider === "sqlite") {
      this.initializeSchemaSync();
      this.initialized = true;
      return;
    }

    await this.pool!.query(`
      CREATE TABLE IF NOT EXISTS workflow_tasks (
        task_id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        user_payment_preference TEXT NOT NULL,
        user_email TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        instructions TEXT,
        agent_key TEXT,
        tools TEXT,
        execution_results TEXT,
        payment_reference TEXT,
        payment_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        payment_reference TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_tasks_payment_reference ON workflow_tasks(payment_reference);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);
    `);
    this.initialized = true;
  }

  public async createTask(record: Omit<WorkflowTaskRecord, "createdAt" | "updatedAt">): Promise<string> {
    await this.initializeSchema();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const params = {
      ...record,
      agentKey: record.agentKey || null,
      paymentReference: record.paymentReference || null,
      paymentId: record.paymentId || null,
      note: record.note || null,
      createdAt,
      updatedAt,
    };

    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO workflow_tasks (
          task_id, task_type, payment_method, payment_status,
          user_payment_preference, user_email, amount, instructions,
          agent_key, payment_reference, payment_id, note, created_at, updated_at
        ) VALUES (@taskId, @taskType, @paymentMethod, @paymentStatus,
          @userPaymentPreference, @userEmail, @amount, @instructions,
          @agentKey, @paymentReference, @paymentId, @note, @createdAt, @updatedAt)
      `).run(params);
    } else {
      await this.pool!.query(
        `INSERT INTO workflow_tasks (
          task_id, task_type, payment_method, payment_status,
          user_payment_preference, user_email, amount, instructions,
          agent_key, payment_reference, payment_id, note, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          record.taskId,
          record.taskType,
          record.paymentMethod,
          record.paymentStatus,
          record.userPaymentPreference,
          record.userEmail,
          record.amount,
          record.instructions,
          params.agentKey,
          params.paymentReference,
          params.paymentId,
          params.note,
          createdAt,
          updatedAt,
        ]
      );
    }

    return record.taskId;
  }

  public async updateTaskAgent(taskId: string, agentKey: string): Promise<void> {
    await this.initializeSchema();
    const updatedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`UPDATE workflow_tasks SET agent_key = @agentKey, updated_at = @updatedAt WHERE task_id = @taskId`)
        .run({ taskId, agentKey, updatedAt });
    } else {
      await this.pool!.query(`UPDATE workflow_tasks SET agent_key = $1, updated_at = $2 WHERE task_id = $3`, [agentKey, updatedAt, taskId]);
    }
  }

  public async updateTaskPayment(taskId: string, paymentReference: string, paymentId: string | null, paymentStatus: string): Promise<void> {
    await this.initializeSchema();
    const updatedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE workflow_tasks
        SET payment_reference = @paymentReference,
            payment_id = @paymentId,
            payment_status = @paymentStatus,
            updated_at = @updatedAt
        WHERE task_id = @taskId
      `).run({ taskId, paymentReference, paymentId, paymentStatus, updatedAt });
    } else {
      await this.pool!.query(
        `UPDATE workflow_tasks SET payment_reference = $1, payment_id = $2, payment_status = $3, updated_at = $4 WHERE task_id = $5`,
        [paymentReference, paymentId, paymentStatus, updatedAt, taskId]
      );
    }
  }

  public async updateTaskExecution(taskId: string, tools: string[], executionResults: string[]): Promise<void> {
    await this.initializeSchema();
    const updatedAt = new Date().toISOString();
    const toolsJson = JSON.stringify(tools);
    const resultsJson = JSON.stringify(executionResults);
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE workflow_tasks
        SET tools = @tools, execution_results = @executionResults, updated_at = @updatedAt
        WHERE task_id = @taskId
      `).run({ taskId, tools: toolsJson, executionResults: resultsJson, updatedAt });
    } else {
      await this.pool!.query(
        `UPDATE workflow_tasks SET tools = $1, execution_results = $2, updated_at = $3 WHERE task_id = $4`,
        [toolsJson, resultsJson, updatedAt, taskId]
      );
    }
  }

  public async updateTaskStatus(taskId: string, paymentStatus: string, note?: string): Promise<void> {
    await this.initializeSchema();
    const updatedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        UPDATE workflow_tasks
        SET payment_status = @paymentStatus, note = COALESCE(@note, note), updated_at = @updatedAt
        WHERE task_id = @taskId
      `).run({ taskId, paymentStatus, note: note || null, updatedAt });
    } else {
      await this.pool!.query(
        `UPDATE workflow_tasks SET payment_status = $1, note = COALESCE($2, note), updated_at = $3 WHERE task_id = $4`,
        [paymentStatus, note || null, updatedAt, taskId]
      );
    }
  }

  public async claimNairaExecution(taskId: string): Promise<NairaExecutionClaim> {
    await this.initializeSchema();
    const task = await this.getTaskById(taskId);
    if (!task) return { claimed: false, task: null, reason: "not_found" };
    if (task.paymentMethod !== "NAIRA") return { claimed: false, task, reason: "not_naira" };
    if (task.paymentStatus !== "payment_confirmed") return { claimed: false, task, reason: `status_${task.paymentStatus}` };

    const updatedAt = new Date().toISOString();
    let changes = 0;
    if (this.provider === "sqlite") {
      const result = this.sqlite!.prepare(`
        UPDATE workflow_tasks
        SET payment_status = 'executing',
            note = 'Payment confirmed. Running agent workflow.',
            updated_at = @updatedAt
        WHERE task_id = @taskId AND payment_method = 'NAIRA' AND payment_status = 'payment_confirmed'
      `).run({ taskId, updatedAt });
      changes = result.changes;
    } else {
      const result = await this.pool!.query(
        `UPDATE workflow_tasks
         SET payment_status = 'executing',
             note = 'Payment confirmed. Running agent workflow.',
             updated_at = $1
         WHERE task_id = $2 AND payment_method = 'NAIRA' AND payment_status = 'payment_confirmed'`,
        [updatedAt, taskId]
      );
      changes = result.rowCount || 0;
    }

    if (changes === 0) {
      return { claimed: false, task: await this.getTaskById(taskId), reason: "claim_lost" };
    }

    const claimedTask = await this.getTaskById(taskId);
    if (!claimedTask) return { claimed: false, task: null, reason: "not_found_after_claim" };
    return { claimed: true, task: claimedTask };
  }

  public async findTaskByPaymentReference(paymentReference: string): Promise<WorkflowTaskRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapTaskRow(this.sqlite!.prepare(`SELECT * FROM workflow_tasks WHERE payment_reference = @paymentReference`).get({ paymentReference }));
    }
    const result = await this.pool!.query(`SELECT * FROM workflow_tasks WHERE payment_reference = $1`, [paymentReference]);
    return this.mapTaskRow(result.rows[0]);
  }

  public async addWebhookEvent(eventId: string, paymentReference: string, eventType: string, payload: string): Promise<void> {
    await this.initializeSchema();
    const receivedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT OR IGNORE INTO webhook_events (event_id, payment_reference, event_type, payload, received_at)
        VALUES (@eventId, @paymentReference, @eventType, @payload, @receivedAt)
      `).run({ eventId, paymentReference, eventType, payload, receivedAt });
    } else {
      await this.pool!.query(
        `INSERT INTO webhook_events (event_id, payment_reference, event_type, payload, received_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, paymentReference, eventType, payload, receivedAt]
      );
    }
  }

  public async getAllTasks(): Promise<WorkflowTaskRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM workflow_tasks ORDER BY created_at DESC`).all()
        .map((row) => this.mapTaskRow(row))
        .filter(Boolean) as WorkflowTaskRecord[];
    }
    const result = await this.pool!.query(`SELECT * FROM workflow_tasks ORDER BY created_at DESC`);
    return result.rows.map((row) => this.mapTaskRow(row)).filter(Boolean) as WorkflowTaskRecord[];
  }

  public async getTaskById(taskId: string): Promise<WorkflowTaskRecord | null> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapTaskRow(this.sqlite!.prepare(`SELECT * FROM workflow_tasks WHERE task_id = @taskId`).get({ taskId }));
    }
    const result = await this.pool!.query(`SELECT * FROM workflow_tasks WHERE task_id = $1`, [taskId]);
    return this.mapTaskRow(result.rows[0]);
  }

  public async getWebhookEvents(limit: number = 50): Promise<WebhookEventRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.sqlite!.prepare(`SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT @limit`).all({ limit })
        .map((row) => this.mapWebhookRow(row));
    }
    const result = await this.pool!.query(`SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapWebhookRow(row));
  }

  public async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
