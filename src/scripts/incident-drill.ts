import dotenv from "dotenv";

dotenv.config();

type DrillResult = {
  name: string;
  ok: boolean;
  status: number;
  detail?: string;
};

const baseUrl = (process.env.DRILL_BASE_URL || process.env.SMOKE_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const adminKey = process.env.DRILL_ADMIN_API_KEY || process.env.SMOKE_ADMIN_API_KEY || process.env.ADMIN_API_KEY || "";
const mode = (process.env.DRILL_MODE || process.argv[2] || "all").toLowerCase();
const execute = ["1", "true", "yes"].includes((process.env.DRILL_EXECUTE || "").toLowerCase());

function headers() {
  return {
    "Content-Type": "application/json",
    ...(adminKey ? { "x-admin-key": adminKey } : {}),
  };
}

async function request(name: string, path: string, init: RequestInit = {}): Promise<DrillResult> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  return {
    name,
    ok: response.ok,
    status: response.status,
    detail: text.slice(0, 500),
  };
}

async function queueReplayDrill(): Promise<DrillResult[]> {
  const results = [
    await request("queue status", "/admin/queue/status"),
    await request("queue jobs", "/admin/queue/jobs?limit=10"),
  ];
  if (execute) {
    results.push(await request("run retry worker", "/admin/queue/run", {
      method: "POST",
      body: JSON.stringify({ limit: 5 }),
    }));
  }
  return results;
}

async function webhookRecoveryDrill(): Promise<DrillResult[]> {
  const paymentReference = process.env.DRILL_PAYMENT_REFERENCE || "";
  const results = [await request("webhook ledger", "/admin/webhooks?limit=10")];
  if (execute && paymentReference) {
    results.push(await request("enqueue webhook recovery", "/admin/queue/jobs", {
      method: "POST",
      body: JSON.stringify({
        jobType: "webhook_recovery",
        payload: { paymentReference, reason: "deploy_time_incident_drill" },
        maxAttempts: 3,
      }),
    }));
  } else if (execute) {
    results.push({ name: "enqueue webhook recovery", ok: false, status: 0, detail: "DRILL_PAYMENT_REFERENCE is required when DRILL_EXECUTE=true" });
  }
  return results;
}

async function payoutFailureDrill(): Promise<DrillResult[]> {
  const escrowId = process.env.DRILL_ESCROW_ID || "";
  const results = [await request("reconciliation", "/admin/reconciliation?limit=25")];
  if (execute && escrowId) {
    results.push(await request("enqueue payout review", `/admin/escrows/${encodeURIComponent(escrowId)}/payout-review`, {
      method: "POST",
      body: JSON.stringify({ reason: "deploy_time_payout_failure_drill" }),
    }));
  } else if (execute) {
    results.push({ name: "enqueue payout review", ok: false, status: 0, detail: "DRILL_ESCROW_ID is required when DRILL_EXECUTE=true" });
  }
  return results;
}

async function main() {
  if (!adminKey) {
    throw new Error("DRILL_ADMIN_API_KEY, SMOKE_ADMIN_API_KEY, or ADMIN_API_KEY is required");
  }

  const groups: DrillResult[][] = [];
  if (mode === "all" || mode === "queue") groups.push(await queueReplayDrill());
  if (mode === "all" || mode === "webhook") groups.push(await webhookRecoveryDrill());
  if (mode === "all" || mode === "payout") groups.push(await payoutFailureDrill());

  const results = groups.flat();
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} ${result.status}`);
    if (!result.ok && result.detail) console.log(result.detail);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Incident drill failed", err.message || err);
  process.exit(1);
});
