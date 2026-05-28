type SmokeResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number;
  detail?: string;
};

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
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
          check("operations status", "/admin/ops/status", headers),
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
