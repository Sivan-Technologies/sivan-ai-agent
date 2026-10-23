/**
 * One-off schema bootstrap for a fresh Postgres database.
 *
 * The agent has no migration runner: each store creates its own tables lazily
 * the first time it is used. On an empty database that means the schema only
 * appears once every code path has been exercised at least once, which is not
 * something you want to discover in production.
 *
 * This script instantiates every store that owns tables and calls its schema
 * initialiser directly, so a new database ends up with the full set in one go.
 * It is idempotent - every statement in those initialisers is
 * CREATE TABLE/INDEX IF NOT EXISTS.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... DATABASE_PROVIDER=postgres \
 *     npx tsx scripts/bootstrap-schema.ts
 *
 * Not wired into the deploy. Run it by hand against a new database.
 */
import { PostgresDriver } from "../src/services/store/postgres-driver.js";
import { ProductionOpsStore } from "../src/services/productionOpsStore.js";
import { ReconciliationStore } from "../src/services/reconciliationStore.js";
import { WorkflowStore } from "../src/services/workflowStore.js";
import { SettingsStore } from "../src/services/settingsStore.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (!/^postgres(ql)?:\/\//.test(url)) throw new Error("DATABASE_URL must be a Postgres URL");

async function step(name: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("ok");
  } catch (error) {
    console.log("FAILED");
    throw error;
  }
}

async function main() {
  console.log(`Bootstrapping schema on ${url!.replace(/:[^:@/]+@/, ":***@")}`);

  const driver = new PostgresDriver(url!);
  await step("core agreement schema (escrows, users, ledger, transactions, ...)", () =>
    driver.initializeSchema(),
  );

  const ops = new ProductionOpsStore(url!, "postgres");
  await step("production ops (queue_jobs, support_cases, abuse_*, ...)", () =>
    ops.initializeSchema(),
  );

  const recon = new ReconciliationStore(url!, "postgres");
  await step("reconciliation (runs, findings, provider snapshots)", () =>
    recon.initializeSchema(),
  );

  const settings = new SettingsStore(url!, "postgres");
  await step("settings (platform_settings, audit_history, ...)", () =>
    settings.initializeSchema(),
  );

  // WorkflowStore keeps its initialiser private and runs it from every public
  // method. Calling it directly is the honest version of calling a no-op write.
  const workflow = new WorkflowStore(url!, "postgres");
  await step("workflow (workflow_tasks, webhook_events, unified webhook logs)", () =>
    (workflow as unknown as { initializeSchema(): Promise<void> }).initializeSchema(),
  );

  console.log("Schema bootstrap complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
