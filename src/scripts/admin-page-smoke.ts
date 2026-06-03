import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();
dotenv.config({ path: "frontend/.env" });

type CheckResult = {
  name: string;
  method: string;
  url: string;
  ok: boolean;
  status: number;
  detail?: string;
};

const backendBaseUrl = (
  process.env.ADMIN_PAGE_SMOKE_BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");

const adminAuthBaseUrl = (
  process.env.ADMIN_PAGE_AUTH_BASE_URL ||
  process.env.VITE_ADMIN_AUTH_BASE_URL ||
  ""
).replace(/\/$/, "");

const adminKey = process.env.ADMIN_PAGE_SMOKE_ADMIN_API_KEY || process.env.SMOKE_ADMIN_API_KEY || process.env.ADMIN_API_KEY || "";
const authJwt = process.env.ADMIN_PAGE_AUTH_JWT || buildAuthJwt();

function backendHeaders(): Record<string, string> {
  if (!adminKey) return {};
  return {
    "x-admin-key": adminKey,
    "x-admin-user": "admin-page-smoke",
  };
}

function authHeaders(): Record<string, string> {
  return authJwt ? { Authorization: `Bearer ${authJwt}` } : {};
}

async function request(
  name: string,
  baseUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown; expectedStatuses?: number[] } = {}
): Promise<CheckResult> {
  const method = options.method || "GET";
  const url = `${baseUrl}${path}`;
  const expectedStatuses = options.expectedStatuses || [200];
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    return {
      name,
      method,
      url,
      ok: expectedStatuses.includes(response.status),
      status: response.status,
      detail: text.slice(0, 800),
    };
  } catch (err: any) {
    return {
      name,
      method,
      url,
      ok: false,
      status: 0,
      detail: err.message || String(err),
    };
  }
}

async function jsonRequest<T>(
  name: string,
  baseUrl: string,
  path: string,
  headers: Record<string, string>
): Promise<{ result: CheckResult; json: T | null }> {
  const result = await request(name, baseUrl, path, { headers });
  if (!result.ok || !result.detail) return { result, json: null };
  try {
    return { result, json: JSON.parse(result.detail) as T };
  } catch {
    return { result: { ...result, ok: false, detail: "Response was not valid JSON" }, json: null };
  }
}

async function main() {
  if (!adminKey) {
    throw new Error("ADMIN_PAGE_SMOKE_ADMIN_API_KEY, SMOKE_ADMIN_API_KEY, or ADMIN_API_KEY is required for admin page smoke checks.");
  }

  const headers = backendHeaders();
  const checks: CheckResult[] = [];

  checks.push(await request("backend public health", backendBaseUrl, "/api/health"));
  checks.push(await request("backend readiness", backendBaseUrl, "/health/readiness"));

  const adminListChecks = await Promise.all([
    request("tasks tab", backendBaseUrl, "/admin/tasks", { headers }),
    request("escrows tab", backendBaseUrl, "/admin/escrows?limit=100", { headers }),
    request("reconciliation tab", backendBaseUrl, "/admin/reconciliation?limit=250", { headers }),
    request("reconciliation csv export", backendBaseUrl, "/admin/reconciliation.csv?limit=250", { headers }),
    request("webhooks tab", backendBaseUrl, "/admin/webhooks?limit=100", { headers }),
    request("disputes tab", backendBaseUrl, "/admin/disputes?limit=100", { headers }),
    request("settings tab", backendBaseUrl, "/admin/settings", { headers }),
    request("audit tab", backendBaseUrl, "/admin/audit-history?limit=20", { headers }),
    request("db status card", backendBaseUrl, "/admin/db-status", { headers }),
    request("ops status card", backendBaseUrl, "/admin/ops/status", { headers }),
    request("dr status card", backendBaseUrl, "/admin/dr/status", { headers }),
    request("ops events table", backendBaseUrl, "/admin/ops/events?limit=50", { headers }),
    request("settlement verification card", backendBaseUrl, "/admin/settlement/verification", { headers, expectedStatuses: [200, 404] }),
    request("queue status card", backendBaseUrl, "/admin/queue/status", { headers }),
    request("queue jobs table", backendBaseUrl, "/admin/queue/jobs?limit=50", { headers }),
    request("abuse signals table", backendBaseUrl, "/admin/abuse/signals?limit=100", { headers }),
    request("abuse analytics", backendBaseUrl, "/admin/abuse/analytics?limit=250", { headers }),
    request("abuse actions table", backendBaseUrl, "/admin/abuse/actions?limit=10", { headers }),
    request("support cases tab", backendBaseUrl, "/admin/support/cases?limit=100", { headers }),
    request("whatsapp provider status", backendBaseUrl, "/admin/whatsapp-provider", { headers }),
  ]);
  checks.push(...adminListChecks);

  const escrowsResponse = await jsonRequest<{ escrows?: Array<{ escrowId: string }> }>("escrows detail source", backendBaseUrl, "/admin/escrows?limit=1", headers);
  checks.push(escrowsResponse.result);
  const escrowId = escrowsResponse.json?.escrows?.[0]?.escrowId;
  if (escrowId) {
    checks.push(await request("escrow detail drawer", backendBaseUrl, `/admin/escrows/${encodeURIComponent(escrowId)}`, { headers }));
    checks.push(await request("escrow timeline drawer", backendBaseUrl, `/admin/escrows/${encodeURIComponent(escrowId)}/events?limit=100`, { headers }));
  }

  const supportResponse = await jsonRequest<{ cases?: Array<{ caseId: string }> }>("support notes source", backendBaseUrl, "/admin/support/cases?limit=1", headers);
  checks.push(supportResponse.result);
  const caseId = supportResponse.json?.cases?.[0]?.caseId;
  if (caseId) {
    checks.push(await request("support notes drawer", backendBaseUrl, `/admin/support/cases/${encodeURIComponent(caseId)}/notes`, { headers }));
  }

  const queueResponse = await jsonRequest<{ jobs?: Array<{ jobId: string }> }>("queue job detail source", backendBaseUrl, "/admin/queue/jobs?limit=1", headers);
  checks.push(queueResponse.result);
  const jobId = queueResponse.json?.jobs?.[0]?.jobId;
  if (jobId) {
    checks.push(await request("queue job detail", backendBaseUrl, `/admin/queue/jobs/${encodeURIComponent(jobId)}`, { headers }));
  }

  if (adminAuthBaseUrl) {
    checks.push(await request("telegram auth health", adminAuthBaseUrl, "/api/health"));
    if (authJwt) {
      checks.push(await request("telegram auth whoami", adminAuthBaseUrl, "/auth/me", { headers: authHeaders() }));
      checks.push(await request("telegram auth stats", adminAuthBaseUrl, "/admin/stats", { headers: authHeaders() }));
      checks.push(await request("telegram auth sessions", adminAuthBaseUrl, "/admin/sessions", { headers: authHeaders() }));
      checks.push(await request("telegram auth audit", adminAuthBaseUrl, "/admin/auth-audit?limit=25", { headers: authHeaders() }));
    } else {
      checks.push({
        name: "telegram auth protected routes",
        method: "GET",
        url: adminAuthBaseUrl,
        ok: true,
        status: 0,
        detail: "Skipped because ADMIN_PAGE_AUTH_JWT or ADMIN_PAGE_AUTH_JWT_SECRET/ADMIN_JWT_SECRET is not configured.",
      });
    }
  }

  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${check.name} ${check.status} ${check.method} ${check.url}`);
    if (!check.ok && check.detail) {
      console.log(check.detail);
    }
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function buildAuthJwt() {
  const secret = process.env.ADMIN_PAGE_AUTH_JWT_SECRET || process.env.ADMIN_JWT_SECRET || process.env.SESSION_TOKEN_SECRET || "";
  if (!secret) return "";
  return jwt.sign(
    {
      adminIdentifier: "admin-page-smoke",
      adminUsername: "admin-page-smoke",
    },
    secret,
    { expiresIn: "5m" }
  );
}

main().catch((err) => {
  console.error("Admin page smoke failed", err.message || err);
  process.exit(1);
});
