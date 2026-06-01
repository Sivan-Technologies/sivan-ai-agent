import dotenv from "dotenv";

dotenv.config();

type SmokeResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number;
  detail?: string;
};

const configuredBaseUrl = process.env.SMOKE_BASE_URL || process.env.PUBLIC_BASE_URL;
if (process.env.GITHUB_ACTIONS === "true" && !configuredBaseUrl) {
  console.error("SMOKE_BASE_URL is required in GitHub Actions. Set SIVAN_SMOKE_BASE_URL or the workflow fallback URL.");
  process.exit(1);
}

const baseUrl = (configuredBaseUrl || "http://localhost:4000").replace(/\/$/, "");
const adminKey = process.env.SMOKE_ADMIN_API_KEY || process.env.ADMIN_API_KEY || "";
const requireSettlementProof = ["1", "true", "yes"].includes((process.env.SMOKE_REQUIRE_SETTLEMENT_PROOF || "").toLowerCase());

async function check(name: string, path: string, headers: Record<string, string> = {}): Promise<SmokeResult> {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let detail = text.slice(0, 300);
    try {
      const json = JSON.parse(text);
      detail = JSON.stringify(json);
    } catch {
      // Keep text detail when the endpoint is not JSON.
    }

    return { name, url, ok: response.ok, status: response.status, detail };
  } catch (err: any) {
    return { name, url, ok: false, status: 0, detail: err.message || String(err) };
  }
}

async function main() {
  const headers: Record<string, string> = adminKey ? { "x-admin-key": adminKey } : {};
  const checks = [
    check("public health", "/api/health"),
    check("readiness", "/health/readiness"),
    ...(adminKey
      ? [
          check("admin db status", "/admin/db-status", headers),
          check("disaster recovery status", "/admin/dr/status", headers),
          check("operations status", "/admin/ops/status", headers),
          check("queue status", "/admin/queue/status", headers),
          check("recent queue jobs", "/admin/queue/jobs?limit=10", headers),
          check("recent webhooks", "/admin/webhooks?limit=10", headers),
          check("reconciliation summary", "/admin/reconciliation?limit=25", headers),
          check("support cases", "/admin/support/cases?limit=10", headers),
          check("abuse signals", "/admin/abuse/signals?limit=10", headers),
          check("abuse analytics", "/admin/abuse/analytics?limit=50", headers),
          check("abuse actions", "/admin/abuse/actions?limit=10", headers),
          check("disputes", "/admin/disputes?limit=10", headers),
          check("recent operational events", "/admin/ops/events?limit=10", headers),
          ...(requireSettlementProof ? [check("latest settlement verification", "/admin/settlement/verification", headers)] : []),
        ]
      : []),
  ];

  const results = await Promise.all(checks);
  for (const result of results) {
    const marker = result.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${result.name} ${result.status} ${result.url}`);
    if (!result.ok && result.detail) {
      console.log(result.detail);
    }
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Smoke check failed", err.message || err);
  process.exit(1);
});
