import dotenv from "dotenv";

dotenv.config();

type CheckResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number;
  detail?: string;
};

const baseUrl = (process.env.DR_BASE_URL || process.env.SMOKE_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const adminKey = process.env.DR_ADMIN_API_KEY || process.env.SMOKE_ADMIN_API_KEY || process.env.ADMIN_API_KEY || "";
const requireFreshRestore = ["1", "true", "yes"].includes((process.env.DR_REQUIRE_FRESH_RESTORE || "true").toLowerCase());

async function check(name: string, path: string, headers: Record<string, string> = {}): Promise<CheckResult> {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      detail: text.slice(0, 1000),
    };
  } catch (err: any) {
    return { name, url, ok: false, status: 0, detail: err.message || String(err) };
  }
}

function parseDrStatus(result: CheckResult): CheckResult {
  if (!result.ok || !result.detail) return result;
  try {
    const status = JSON.parse(result.detail);
    const backupOk = Boolean(status.backup?.configured);
    const rollbackOk = Boolean(status.rollback?.configured);
    const outageOk = Boolean(status.outage?.configured);
    const restoreOk = requireFreshRestore ? Boolean(status.restore?.fresh) : Boolean(status.restore?.lastStatus);
    const ok = backupOk && rollbackOk && outageOk && restoreOk;
    return {
      ...result,
      ok,
      detail: JSON.stringify({
        status: status.status,
        backupConfigured: backupOk,
        rollbackConfigured: rollbackOk,
        outageConfigured: outageOk,
        restoreFresh: Boolean(status.restore?.fresh),
        lastRestoreTestAt: status.restore?.lastTestAt || null,
        runbook: status.runbook,
      }),
    };
  } catch {
    return { ...result, ok: false, detail: "DR status did not return valid JSON" };
  }
}

async function main() {
  if (!adminKey) {
    throw new Error("DR_ADMIN_API_KEY, SMOKE_ADMIN_API_KEY, or ADMIN_API_KEY is required");
  }

  const headers = { "x-admin-key": adminKey };
  const publicResults = await Promise.all([
    check("public health", "/api/health"),
    check("readiness", "/health/readiness"),
  ]);
  const adminResults = await Promise.all([
    check("database status", "/admin/db-status", headers),
    check("operations status", "/admin/ops/status", headers),
    check("disaster recovery status", "/admin/dr/status", headers),
  ]);
  const results = [...publicResults, ...adminResults];
  const normalized = results.map((result) => result.name === "disaster recovery status" ? parseDrStatus(result) : result);

  for (const result of normalized) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} ${result.status} ${result.url}`);
    if (!result.ok && result.detail) console.log(result.detail);
  }

  if (normalized.some((result) => !result.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Disaster recovery check failed", err.message || err);
  process.exit(1);
});
