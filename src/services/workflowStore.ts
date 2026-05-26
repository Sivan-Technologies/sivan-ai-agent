import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

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

export class WorkflowStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (!dbPath) {
      throw new Error("DATABASE_URL is required for workflow persistence");
    }

    const folder = path.dirname(dbPath);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private mapTaskRow(row: any): WorkflowTaskRecord | null {
    if (!row) {
      return null;
    }

    return {
      taskId: row.task_id,
      taskType: row.task_type,
      userPaymentPreference: row.user_payment_preference,
      userEmail: row.user_email,
      amount: row.amount,
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

  private initializeSchema() {
    this.db.exec(`
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

  public createTask(record: Omit<WorkflowTaskRecord, "createdAt" | "updatedAt">): string {
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const stmt = this.db.prepare(`
      INSERT INTO workflow_tasks (
        task_id, task_type, payment_method, payment_status,
        user_payment_preference, user_email, amount, instructions,
        agent_key, payment_reference, payment_id, note, created_at, updated_at
      ) VALUES (@taskId, @taskType, @paymentMethod, @paymentStatus,
        @userPaymentPreference, @userEmail, @amount, @instructions,
        @agentKey, @paymentReference, @paymentId, @note, @createdAt, @updatedAt)
    `);

    stmt.run({
      ...record,
      agentKey: record.agentKey || null,
      paymentReference: record.paymentReference || null,
      paymentId: record.paymentId || null,
      note: record.note || null,
      createdAt,
      updatedAt,
    });

    return record.taskId;
  }

  public updateTaskAgent(taskId: string, agentKey: string) {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_tasks
      SET agent_key = @agentKey,
          updated_at = @updatedAt
      WHERE task_id = @taskId
    `);
    stmt.run({ taskId, agentKey, updatedAt });
  }

  public updateTaskPayment(taskId: string, paymentReference: string, paymentId: string | null, paymentStatus: string) {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_tasks
      SET payment_reference = @paymentReference,
          payment_id = @paymentId,
          payment_status = @paymentStatus,
          updated_at = @updatedAt
      WHERE task_id = @taskId
    `);
    stmt.run({ taskId, paymentReference, paymentId, paymentStatus, updatedAt });
  }

  public updateTaskExecution(taskId: string, tools: string[], executionResults: string[]) {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_tasks
      SET tools = @tools,
          execution_results = @executionResults,
          updated_at = @updatedAt
      WHERE task_id = @taskId
    `);
    stmt.run({ taskId, tools: JSON.stringify(tools), executionResults: JSON.stringify(executionResults), updatedAt });
  }

  public updateTaskStatus(taskId: string, paymentStatus: string, note?: string) {
    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_tasks
      SET payment_status = @paymentStatus,
          note = COALESCE(@note, note),
          updated_at = @updatedAt
      WHERE task_id = @taskId
    `);
    stmt.run({ taskId, paymentStatus, note, updatedAt });
  }

  public claimNairaExecution(taskId: string): NairaExecutionClaim {
    const task = this.getTaskById(taskId);
    if (!task) {
      return { claimed: false, task: null, reason: "not_found" };
    }

    if (task.paymentMethod !== "NAIRA") {
      return { claimed: false, task, reason: "not_naira" };
    }

    if (task.paymentStatus !== "payment_confirmed") {
      return { claimed: false, task, reason: `status_${task.paymentStatus}` };
    }

    const updatedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE workflow_tasks
      SET payment_status = 'executing',
          note = 'Payment confirmed. Running agent workflow.',
          updated_at = @updatedAt
      WHERE task_id = @taskId
        AND payment_method = 'NAIRA'
        AND payment_status = 'payment_confirmed'
    `);
    const result = stmt.run({ taskId, updatedAt });
    if (result.changes === 0) {
      return { claimed: false, task: this.getTaskById(taskId), reason: "claim_lost" };
    }

    const claimedTask = this.getTaskById(taskId);
    if (!claimedTask) {
      return { claimed: false, task: null, reason: "not_found_after_claim" };
    }

    return { claimed: true, task: claimedTask };
  }

  public findTaskByPaymentReference(paymentReference: string): WorkflowTaskRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workflow_tasks WHERE payment_reference = @paymentReference
    `);
    const row = stmt.get({ paymentReference });
    return this.mapTaskRow(row);
  }

  public addWebhookEvent(eventId: string, paymentReference: string, eventType: string, payload: string) {
    const receivedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_events (event_id, payment_reference, event_type, payload, received_at)
      VALUES (@eventId, @paymentReference, @eventType, @payload, @receivedAt)
    `);
    stmt.run({ eventId, paymentReference, eventType, payload, receivedAt });
  }

  public getAllTasks(): WorkflowTaskRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM workflow_tasks ORDER BY created_at DESC`);
    return stmt.all().map((row) => this.mapTaskRow(row)).filter(Boolean) as WorkflowTaskRecord[];
  }

  public getTaskById(taskId: string): WorkflowTaskRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM workflow_tasks WHERE task_id = @taskId`);
    const row = stmt.get({ taskId });
    return this.mapTaskRow(row);
  }

  public getWebhookEvents(limit: number = 50): WebhookEventRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT @limit`);
    return stmt.all({ limit }).map((row) => this.mapWebhookRow(row));
  }
}
