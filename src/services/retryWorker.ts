import { info, warn } from "../lib/logger";
import { captureOperationalError } from "./monitoring";
import { ProductionOpsStore, QueueJobRecord } from "./productionOpsStore";

export type RetryJobHandler = (payload: any, job: QueueJobRecord) => Promise<void>;

export interface RetryWorkerResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  idle: boolean;
}

export class RetryWorker {
  constructor(
    private opsStore: ProductionOpsStore,
    private handlers: Record<string, RetryJobHandler>,
    private options: { baseDelayMs?: number; maxDelayMs?: number; lockTimeoutSeconds?: number } = {}
  ) {}

  public async processOne(workerId = "admin-runner"): Promise<RetryWorkerResult> {
    const job = await this.opsStore.claimNextQueueJob(workerId, this.options.lockTimeoutSeconds || 300);
    if (!job) {
      return { processed: 0, succeeded: 0, failed: 0, dead: 0, idle: true };
    }

    try {
      const handler = this.handlers[job.jobType];
      if (!handler) {
        throw new Error(`No retry handler registered for job type ${job.jobType}`);
      }

      const payload = JSON.parse(job.payload);
      await handler(payload, job);
      await this.opsStore.markQueueJobSucceeded(job.jobId);
      info("Retry queue job succeeded", { jobId: job.jobId, jobType: job.jobType, attempts: job.attempts });
      return { processed: 1, succeeded: 1, failed: 0, dead: 0, idle: false };
    } catch (err: any) {
      const updated = await this.opsStore.markQueueJobFailed(job.jobId, {
        error: err.message || String(err),
        baseDelayMs: this.options.baseDelayMs,
        maxDelayMs: this.options.maxDelayMs,
      });
      const dead = updated?.status === "dead" ? 1 : 0;
      const failed = dead ? 0 : 1;
      warn("Retry queue job failed", { jobId: job.jobId, jobType: job.jobType, attempts: job.attempts, status: updated?.status, error: err.message || err });
      captureOperationalError("Retry queue job failed", err, { jobId: job.jobId, jobType: job.jobType, status: updated?.status });
      return { processed: 1, succeeded: 0, failed, dead, idle: false };
    }
  }

  public async processBatch(limit = 10, workerId = "admin-runner"): Promise<RetryWorkerResult> {
    const summary: RetryWorkerResult = { processed: 0, succeeded: 0, failed: 0, dead: 0, idle: true };
    for (let index = 0; index < limit; index += 1) {
      const result = await this.processOne(workerId);
      if (result.idle) break;
      summary.processed += result.processed;
      summary.succeeded += result.succeeded;
      summary.failed += result.failed;
      summary.dead += result.dead;
      summary.idle = false;
    }
    return summary;
  }
}
