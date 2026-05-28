import { useEffect, useMemo, useState } from "react";

type TaskRecord = {
  taskId: string;
  taskType: string;
  userPaymentPreference: string;
  userEmail: string;
  amount: number;
  instructions?: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentReference?: string;
  paymentId?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

type WebhookEvent = {
  eventId: string;
  paymentReference: string;
  eventType: string;
  receivedAt: string;
};

type EscrowRecord = {
  escrowId: string;
  buyerUserId: string;
  sellerUserId?: string;
  sellerWhatsapp?: string;
  amount: number;
  currency: "NAIRA" | "USDC";
  purpose: string;
  status: string;
  settlementPolicy: string;
  paymentReference?: string;
  paymentAuthorizationUrl?: string;
  paymentProvider?: string;
  receivedAmount?: number;
  providerPaymentStatus?: string;
  paymentCheckedAt?: string;
  reconciliationFlags?: string[];
  releaseRequestedAt?: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ReconciliationRow = {
  escrowId: string;
  buyer: string;
  seller: string;
  expectedAmount: number;
  receivedAmount: number | null;
  currency: "NAIRA" | "USDC";
  paystackReference?: string | null;
  paymentProvider?: string | null;
  paymentStatus: string;
  payoutReference?: string | null;
  payoutApprover?: string | null;
  releaseTimestamp?: string | null;
  status: string;
  flags: string[];
  purpose: string;
  payoutVerified: boolean;
  paymentCheckedAt?: string | null;
};

type ReconciliationSummary = {
  paymentsNeedingReview: number;
  releasesAwaitingPayout: number;
  releasedMissingPayoutReference: number;
  paystackAmountMismatches: number;
};

type FeeSettings = {
  nairaFeePercent: number;
  nairaFeeFixed: number;
  usdcFeePercent: number;
  usdcFeeFixed: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
};

type AuditRecord = {
  id: string;
  settingName: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  changedAt: string;
};

type OperationalEvent = {
  id: string;
  level: "warning" | "error";
  message: string;
  context: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

type OperationsStatus = {
  status: string;
  database: {
    status: string;
    provider: string;
    configured: boolean;
    settingsVersion?: number;
    latencyMs?: number;
  };
  operations: {
    status: string;
    alertsConfigured: boolean;
    sentryConfigured: boolean;
    recentWarnings: number;
    recentErrors: number;
    recent: OperationalEvent[];
  };
};

type SettlementProof = {
  status: string;
  checkedAt?: string;
  sap?: { status?: string; toolsDiscovered?: number; latencyMs?: number; error?: string };
  x402?: { status?: string; mode?: string; paymentStatus?: string; transactionHash?: string; error?: string };
  warnings?: string[];
  proofFile?: string;
};

type QueueStatus = {
  status: string;
  queued: number;
  running: number;
  failed: number;
  dead: number;
  succeeded: number;
};

type AbuseSignal = {
  signalId: string;
  subjectType: string;
  subjectId: string;
  category: string;
  severity: string;
  riskScore: number;
  reason: string;
  createdAt: string;
};

type SupportCase = {
  caseId: string;
  status: string;
  priority: string;
  subject: string;
  relatedEscrowId?: string;
  relatedUser?: string;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type AuthSessionRecord = {
  sessionId: string;
  adminIdentifier: string;
  createdAt: string;
  expiresAt?: string;
  ip?: string;
  status?: string;
};

type AuthStats = {
  period?: string;
  total_requests?: number;
  successful_verifications?: number;
  failed_verifications?: number;
  telegram_errors?: number;
  unique_admins?: number;
  unique_ips?: number;
  timestamp?: string;
};

type Tab = "escrows" | "tasks" | "webhooks" | "fees" | "ops" | "auth";
type EscrowFilter = "all" | "review" | "pendingRelease" | "released" | "missingPayout" | "amountMismatch";

const apiBase = (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000";
const storedAdminKey = "sivan.adminToken";
const adminAuthBase = (import.meta as any).env.VITE_ADMIN_AUTH_BASE_URL || "http://localhost:3600";

const money = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function compactId(value?: string, length = 10) {
  if (!value) return "unassigned";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function statusTone(status: string) {
  if (/failed|error|invalid|release_failed|review_required|mismatch/i.test(status)) return "critical";
  if (/settled|completed|confirmed|success/i.test(status)) return "good";
  if (/pending|created|received|executing|waiting/i.test(status)) return "watch";
  return "neutral";
}

function formatTime(value?: string) {
  if (!value) return "not recorded";
  return new Date(value).toLocaleString();
}

function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(storedAdminKey) || "");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [escrows, setEscrows] = useState<EscrowRecord[]>([]);
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationRow[]>([]);
  const [reconciliationSummary, setReconciliationSummary] = useState<ReconciliationSummary>({
    paymentsNeedingReview: 0,
    releasesAwaitingPayout: 0,
    releasedMissingPayoutReference: 0,
    paystackAmountMismatches: 0,
  });
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditRecord[]>([]);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatus | null>(null);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [settlementProof, setSettlementProof] = useState<SettlementProof | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [abuseSignals, setAbuseSignals] = useState<AbuseSignal[]>([]);
  const [supportCases, setSupportCases] = useState<SupportCase[]>([]);
  const [feeSettings, setFeeSettings] = useState<FeeSettings | null>(null);
  const [feeFormData, setFeeFormData] = useState({
    nairaFeePercent: 0,
    nairaFeeFixed: 0,
    usdcFeePercent: 0,
    usdcFeeFixed: 0,
  });

  const [activeTab, setActiveTab] = useState<Tab>("escrows");
  const [escrowFilter, setEscrowFilter] = useState<EscrowFilter>("all");
  const [selectedEscrow, setSelectedEscrow] = useState<EscrowRecord | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRecord | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeSuccess, setFeeSuccess] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [savingFees, setSavingFees] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [authSessions, setAuthSessions] = useState<AuthSessionRecord[]>([]);
  const [authStats, setAuthStats] = useState<AuthStats | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const authHeaders = () => {
    const headers: any = { "Content-Type": "application/json" };
    if (adminKey) {
      // if looks like a JWT, use Authorization Bearer, otherwise legacy x-admin-key
      if (adminKey.split(".").length === 3) {
        headers["Authorization"] = `Bearer ${adminKey}`;
      } else {
        headers["x-admin-key"] = adminKey;
      }
    }
    return headers;
  };

  const parseError = async (response: Response, fallback: string) => {
    try {
      const payload = await response.json();
      return payload.error || fallback;
    } catch {
      return fallback;
    }
  };

  const saveAdminKey = () => {
    const trimmed = adminKeyInput.trim();
    if (!trimmed) {
      setError("Admin key is required.");
      return;
    }
    sessionStorage.setItem(storedAdminKey, trimmed);
    setAdminKey(trimmed);
    setAdminKeyInput("");
    setError(null);
  };

  const clearAdminKey = () => {
    sessionStorage.removeItem(storedAdminKey);
    setAdminKey("");
    setTasks([]);
    setEscrows([]);
    setWebhooks([]);
    setFeeSettings(null);
    setAuditHistory([]);
    setAuthSessions([]);
    setAuthStats(null);
    setAuthError(null);
    setOperationsStatus(null);
    setOperationalEvents([]);
    setSettlementProof(null);
    setQueueStatus(null);
    setAbuseSignals([]);
    setSupportCases([]);
    setSelectedTask(null);
  };

  const isJwtToken = (value: string) => value.split(".").length === 3;

  const decodeJwtPayload = (token: string) => {
    try {
      const encoded = token.split(".")[1];
      const json = decodeURIComponent(
        atob(encoded)
          .split("")
          .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
          .join("")
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const requestTelegramToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${adminAuthBase}/auth/request-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-request-secret": (import.meta as any).env.VITE_ADMIN_REQUEST_SECRET || "",
        },
        body: JSON.stringify({ adminIdentifier: "frontend" }),
      });
      if (!resp.ok) throw new Error(await parseError(resp, "Failed to request session"));
      alert("Token requested. Check Telegram for the 6-digit code.");
    } catch (err: any) {
      setError(err.message || "Failed to request token");
    } finally {
      setLoading(false);
    }
  };

  const loadAuthServiceInfo = async () => {
    if (!adminKey || !isJwtToken(adminKey)) {
      setAuthSessions([]);
      setAuthStats(null);
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const statsResponse = await fetch(`${adminAuthBase}/admin/stats`, {
        headers: authHeaders(),
      });
      if (statsResponse.ok) {
        setAuthStats(await statsResponse.json());
      } else {
        setAuthStats(null);
      }

      const sessionsResponse = await fetch(`${adminAuthBase}/admin/sessions`, {
        headers: authHeaders(),
      });
      if (sessionsResponse.ok) {
        const payload = await sessionsResponse.json();
        setAuthSessions(payload.sessions || payload || []);
      } else {
        setAuthSessions([]);
      }
    } catch (err: any) {
      setAuthError(err.message || "Unable to load auth activity");
      setAuthSessions([]);
      setAuthStats(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const revokeAuthSession = async (sessionId: string) => {
    if (!sessionId) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await fetch(`${adminAuthBase}/admin/revoke-session`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) throw new Error(await parseError(response, "Failed to revoke session"));
      await loadAuthServiceInfo();
    } catch (err: any) {
      setAuthError(err.message || "Revoke session failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const loadTasks = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/tasks`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load tasks"));
    setTasks((await response.json()) || []);
  };

  const loadEscrows = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/escrows?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load escrows"));
    setEscrows((await response.json()) || []);
  };

  const loadReconciliation = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/reconciliation?limit=250`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load reconciliation"));
    const payload = await response.json();
    setReconciliationRows(payload.rows || []);
    setReconciliationSummary(payload.needsAttention || {
      paymentsNeedingReview: 0,
      releasesAwaitingPayout: 0,
      releasedMissingPayoutReference: 0,
      paystackAmountMismatches: 0,
    });
  };

  const loadWebhooks = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/webhooks?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load webhooks"));
    setWebhooks((await response.json()) || []);
  };

  const loadFeeSettings = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/settings`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load fee settings"));
    const data = await response.json();
    setFeeSettings(data);
    setFeeFormData({
      nairaFeePercent: data.nairaFeePercent,
      nairaFeeFixed: data.nairaFeeFixed,
      usdcFeePercent: data.usdcFeePercent,
      usdcFeeFixed: data.usdcFeeFixed,
    });
  };

  const loadAuditHistory = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/audit-history?limit=20`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load audit history"));
    setAuditHistory((await response.json()) || []);
  };

  const loadOperations = async () => {
    if (!adminKey) return;
    const [statusResponse, eventsResponse, settlementResponse, queueResponse, abuseResponse, supportResponse] = await Promise.all([
      fetch(`${apiBase}/admin/ops/status`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/ops/events?limit=50`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/settlement/verification`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/queue/status`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/abuse/signals?limit=25`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/support/cases?limit=25`, { headers: authHeaders() }),
    ]);
    if (!statusResponse.ok) throw new Error(await parseError(statusResponse, "Failed to load operations status"));
    if (!eventsResponse.ok) throw new Error(await parseError(eventsResponse, "Failed to load operations events"));
    if (!queueResponse.ok) throw new Error(await parseError(queueResponse, "Failed to load queue status"));
    setOperationsStatus(await statusResponse.json());
    setOperationalEvents((await eventsResponse.json()) || []);
    setSettlementProof(settlementResponse.ok ? await settlementResponse.json() : null);
    setQueueStatus(await queueResponse.json());
    setAbuseSignals(abuseResponse.ok ? await abuseResponse.json() : []);
    setSupportCases(supportResponse.ok ? await supportResponse.json() : []);
  };

  const runSettlementVerification = async () => {
    const response = await fetch(`${apiBase}/admin/settlement/verify`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(await parseError(response, "Settlement verification failed"));
    setSettlementProof(await response.json());
    await loadOperations();
  };

  const refreshAll = async () => {
    setLoading(true);
    setError(null);
    setFeeError(null);
    try {
      await Promise.all([loadEscrows(), loadReconciliation(), loadTasks(), loadWebhooks(), loadFeeSettings(), loadAuditHistory(), loadOperations()]);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  const calculateFee = (amount: number, feePercent: number, feeFixed: number) => {
    return Math.round(((amount * feePercent) / 100) * 100) / 100 + feeFixed;
  };

  const handleSaveFees = async () => {
    setSavingFees(true);
    setFeeError(null);
    setFeeSuccess(null);

    try {
      if (feeFormData.nairaFeePercent < 0 || feeFormData.nairaFeePercent > 50 || feeFormData.nairaFeeFixed < 0) {
        throw new Error("Naira fees must stay within approved bounds.");
      }
      if (feeFormData.usdcFeePercent < 0 || feeFormData.usdcFeePercent > 50 || feeFormData.usdcFeeFixed < 0) {
        throw new Error("USDC fees must stay within approved bounds.");
      }

      const response = await fetch(`${apiBase}/admin/settings`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...feeFormData,
          expectedVersion: feeSettings?.version || 1,
        }),
      });

      if (!response.ok) throw new Error(await parseError(response, "Failed to save fees"));

      const updated = await response.json();
      setFeeSettings(updated);
      setFeeSuccess("Fees updated.");
      setShowConfirmModal(false);
      await loadAuditHistory();
      setTimeout(() => setFeeSuccess(null), 3000);
    } catch (err: any) {
      setFeeError(err.message || "Failed to save fees");
    } finally {
      setSavingFees(false);
    }
  };

  const approveEscrowRelease = async (escrowId: string) => {
    const manualPayoutReference = window.prompt("Enter manual payout reference from Paystack/bank transfer:");
    if (!manualPayoutReference) return;
    const payoutNotes = window.prompt("Optional payout notes:") || undefined;
    const response = await fetch(`${apiBase}/admin/escrows/${escrowId}/approve-release`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ manualPayoutReference, payoutNotes }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to approve release"));
    await loadEscrows();
    await loadReconciliation();
  };

  const disputeEscrow = async (escrowId: string) => {
    const response = await fetch(`${apiBase}/admin/escrows/${escrowId}/dispute`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ reason: "Admin review required" }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to dispute escrow"));
    await loadEscrows();
    await loadReconciliation();
  };

  const recheckEscrowPayment = async (escrowId: string) => {
    const response = await fetch(`${apiBase}/admin/escrows/${escrowId}/recheck-payment`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to re-check payment"));
    const body = await response.json();
    await loadEscrows();
    await loadReconciliation();
    if (body?.escrow) setSelectedEscrow(body.escrow);
  };

  const downloadReconciliationCsv = async () => {
    const response = await fetch(`${apiBase}/admin/reconciliation.csv?limit=250`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to export reconciliation CSV"));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sivan-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const reconciliationByEscrow = useMemo(() => {
    return new Map(reconciliationRows.map((row) => [row.escrowId, row]));
  }, [reconciliationRows]);

  const filteredEscrows = useMemo(() => {
    return escrows.filter((escrow) => {
      const row = reconciliationByEscrow.get(escrow.escrowId);
      if (escrowFilter === "review") return escrow.status === "REVIEW_REQUIRED";
      if (escrowFilter === "pendingRelease") return escrow.status === "PENDING_RELEASE";
      if (escrowFilter === "released") return escrow.status === "RELEASED";
      if (escrowFilter === "missingPayout") return escrow.status === "RELEASED" && !escrow.manualPayoutReference;
      if (escrowFilter === "amountMismatch") return Boolean(row?.flags.includes("payment_amount_mismatch") || escrow.reconciliationFlags?.includes("payment_amount_mismatch"));
      return true;
    });
  }, [escrowFilter, escrows, reconciliationByEscrow]);

  const metrics = useMemo(() => {
    const active = escrows.filter((escrow) => !/released|failed|cancelled/i.test(escrow.status)).length;
    const pending = escrows.filter((escrow) => /pending|created/i.test(escrow.status)).length;
    const settled = escrows.filter((escrow) => /released/i.test(escrow.status)).length;
    const failed = escrows.filter((escrow) => /failed|disputed|review_required/i.test(escrow.status)).length;
    return { active, pending, settled, failed };
  }, [escrows]);

  useEffect(() => {
    if (!adminKey) return;
    refreshAll();
    if (autoRefresh) {
      const interval = setInterval(refreshAll, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, adminKey]);

  useEffect(() => {
    if (activeTab === "auth") {
      loadAuthServiceInfo();
    }
  }, [activeTab, adminKey]);

  if (!adminKey) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark">SE</div>
          <h1>Sivan Escrow Admin</h1>
          <p className="muted">Secure operations console</p>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ marginBottom: 12 }}>
            <button
              className="button primary full"
              onClick={requestTelegramToken}
            >Request token via Telegram</button>
          </div>

          <label className="field">
            <span>Enter Telegram token</span>
            <input
              type="text"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Enter") {
                  // verify token
                  setLoading(true);
                  try {
                    const resp = await fetch(`${adminAuthBase}/auth/verify`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token: adminKeyInput.trim() }),
                    });
                    if (!resp.ok) throw new Error("Invalid token");
                    const body = await resp.json();
                    sessionStorage.setItem(storedAdminKey, body.accessToken);
                    setAdminKey(body.accessToken);
                    setAdminKeyInput("");
                    setError(null);
                  } catch (err: any) {
                    setError(err.message || "Token verification failed");
                  } finally {
                    setLoading(false);
                  }
                }
              }}
              autoComplete="off"
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button primary full" onClick={async () => { saveAdminKey(); }}>Verify</button>
            <button className="button" onClick={() => { setAdminKeyInput(''); setError(null); }}>Clear</button>
          </div>
          <div className="endpoint-chip">{apiBase}</div>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Sivan Escrow Agent</div>
          <h1>Operations Console</h1>
        </div>
        <div className="topbar-actions">
          <span className="health-pill">Backend connected</span>
          <button className="button secondary" onClick={clearAdminKey}>Lock</button>
        </div>
      </header>

      <section className="command-strip">
        <div className="strip-item">
          <span>API</span>
          <strong>{apiBase.replace(/^https?:\/\//, "")}</strong>
        </div>
        <div className="strip-item">
          <span>Refresh</span>
          <strong>{autoRefresh ? "5 seconds" : "manual"}</strong>
        </div>
        <div className="strip-item">
          <span>Updated</span>
          <strong>{lastUpdated || "pending"}</strong>
        </div>
        <div className="strip-actions">
          <button className="button primary" onClick={refreshAll} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>Auto</span>
          </label>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="metrics-grid">
        <div className="metric-card">
          <span>Active</span>
          <strong>{metrics.active}</strong>
        </div>
        <div className="metric-card watch">
          <span>Pending</span>
          <strong>{metrics.pending}</strong>
        </div>
        <div className="metric-card good">
          <span>Resolved</span>
          <strong>{metrics.settled}</strong>
        </div>
        <div className="metric-card critical">
          <span>Exceptions</span>
          <strong>{metrics.failed}</strong>
        </div>
      </section>

      {activeTab === "escrows" && (
        <section className="attention-grid">
          <button className="attention-card critical" onClick={() => setEscrowFilter("review")}>
            <span>Payments needing review</span>
            <strong>{reconciliationSummary.paymentsNeedingReview}</strong>
          </button>
          <button className="attention-card watch" onClick={() => setEscrowFilter("pendingRelease")}>
            <span>Releases awaiting payout</span>
            <strong>{reconciliationSummary.releasesAwaitingPayout}</strong>
          </button>
          <button className="attention-card critical" onClick={() => setEscrowFilter("missingPayout")}>
            <span>Released missing payout ref</span>
            <strong>{reconciliationSummary.releasedMissingPayoutReference}</strong>
          </button>
          <button className="attention-card critical" onClick={() => setEscrowFilter("amountMismatch")}>
            <span>Paystack amount mismatch</span>
            <strong>{reconciliationSummary.paystackAmountMismatches}</strong>
          </button>
        </section>
      )}

      <nav className="tabs" aria-label="Admin sections">
        {(["escrows", "tasks", "webhooks", "fees", "ops", "auth"] as Tab[]).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab === "escrows"
              ? "Escrows"
              : tab === "tasks"
              ? "Tasks"
              : tab === "webhooks"
              ? "Webhooks"
              : tab === "fees"
              ? "Fees"
              : tab === "ops"
              ? "Ops"
              : "Admin Auth"}
          </button>
        ))}
      </nav>

      {activeTab === "escrows" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Escrow Ledger</h2>
              <span>{filteredEscrows.length} of {escrows.length} records</span>
            </div>
            <div className="filter-bar">
              {([
                ["all", "All"],
                ["review", "Review required"],
                ["pendingRelease", "Pending release"],
                ["released", "Released"],
                ["missingPayout", "Missing payout ref"],
                ["amountMismatch", "Amount mismatch"],
              ] as [EscrowFilter, string][]).map(([value, label]) => (
                <button key={value} className={escrowFilter === value ? "active" : ""} onClick={() => setEscrowFilter(value)}>
                  {label}
                </button>
              ))}
              <button
                className="export-button"
                onClick={async () => {
                  try {
                    await downloadReconciliationCsv();
                  } catch (err: any) {
                    setError(err.message || "CSV export failed");
                  }
                }}
              >
                Export CSV
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Escrow</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Received</th>
                    <th>Release</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEscrows.map((escrow) => (
                    <tr
                      key={escrow.escrowId}
                      className={selectedEscrow?.escrowId === escrow.escrowId ? "selected" : ""}
                      onClick={() => setSelectedEscrow(selectedEscrow?.escrowId === escrow.escrowId ? null : escrow)}
                    >
                      <td>
                        <strong>{escrow.escrowId}</strong>
                        <small>{escrow.purpose}</small>
                      </td>
                      <td>{money.format(escrow.amount)} {escrow.currency}</td>
                      <td><span className={`status ${statusTone(escrow.status)}`}>{escrow.status}</span></td>
                      <td>{escrow.receivedAmount === undefined ? "pending" : `${money.format(escrow.receivedAmount)} ${escrow.currency}`}</td>
                      <td>{escrow.settlementPolicy}</td>
                      <td>{compactId(escrow.paymentReference, 16)}</td>
                    </tr>
                  ))}
                  {filteredEscrows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-cell">No escrows match this filter</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Escrow Actions</h2>
              <span>{selectedEscrow ? compactId(selectedEscrow.escrowId, 12) : "none"}</span>
            </div>
            {selectedEscrow ? (
              <div className="detail-stack">
                <div className="detail-row"><span>Status</span><strong>{selectedEscrow.status}</strong></div>
                <div className="detail-row"><span>Currency</span><strong>{selectedEscrow.currency}</strong></div>
                <div className="detail-row"><span>Policy</span><strong>{selectedEscrow.settlementPolicy}</strong></div>
                <div className="detail-row"><span>Funding reference</span><strong>{selectedEscrow.paymentReference || "pending"}</strong></div>
                <div className="detail-row"><span>Payment status</span><strong>{selectedEscrow.providerPaymentStatus || selectedEscrow.status}</strong></div>
                <div className="detail-row"><span>Expected amount</span><strong>{money.format(selectedEscrow.amount)} {selectedEscrow.currency}</strong></div>
                <div className="detail-row"><span>Received amount</span><strong>{selectedEscrow.receivedAmount === undefined ? "not verified" : `${money.format(selectedEscrow.receivedAmount)} ${selectedEscrow.currency}`}</strong></div>
                <div className="detail-row"><span>Payment checked</span><strong>{formatTime(selectedEscrow.paymentCheckedAt)}</strong></div>
                <div className="detail-row"><span>Seller</span><strong>{selectedEscrow.sellerWhatsapp || selectedEscrow.sellerUserId || "pending"}</strong></div>
                <div className="detail-row"><span>Payout ref</span><strong>{selectedEscrow.manualPayoutReference || (selectedEscrow.status === "RELEASED" ? "MISSING REFERENCE" : "not released")}</strong></div>
                <div className="detail-row"><span>Payout notes</span><strong>{selectedEscrow.payoutNotes || "none"}</strong></div>
                <div className="detail-row"><span>Released by</span><strong>{selectedEscrow.releasedBy || "not released"}</strong></div>
                <div className="detail-row"><span>Released at</span><strong>{formatTime(selectedEscrow.releasedAt)}</strong></div>
                <div className="detail-row"><span>Dispute</span><strong>{selectedEscrow.status === "DISPUTED" ? "open" : "none"}</strong></div>
                {selectedEscrow.reconciliationFlags?.length ? (
                  <div className="detail-note critical-note">
                    {selectedEscrow.reconciliationFlags.join(", ")}
                  </div>
                ) : null}
                <div className="detail-note">{selectedEscrow.purpose}</div>
                <button
                  className="button secondary full"
                  disabled={!selectedEscrow.paymentReference || selectedEscrow.paymentProvider !== "paystack"}
                  onClick={async () => {
                    try {
                      await recheckEscrowPayment(selectedEscrow.escrowId);
                    } catch (err: any) {
                      setError(err.message || "Payment recheck failed");
                    }
                  }}
                >
                  Re-check Paystack payment
                </button>
                <button
                  className="button primary full"
                  disabled={selectedEscrow.status !== "PENDING_RELEASE"}
                  onClick={async () => {
                    try {
                      await approveEscrowRelease(selectedEscrow.escrowId);
                    } catch (err: any) {
                      setError(err.message || "Release approval failed");
                    }
                  }}
                >
                  Approve Naira release
                </button>
                <button
                  className="button secondary full"
                  disabled={["RELEASED", "CANCELLED"].includes(selectedEscrow.status)}
                  onClick={async () => {
                    try {
                      await disputeEscrow(selectedEscrow.escrowId);
                    } catch (err: any) {
                      setError(err.message || "Dispute failed");
                    }
                  }}
                >
                  Mark disputed
                </button>
              </div>
            ) : (
              <p className="muted">Select an escrow row.</p>
            )}
          </aside>
        </section>
      )}

      {activeTab === "tasks" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Workflow Queue</h2>
              <span>{tasks.length} records</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr
                      key={task.taskId}
                      className={selectedTask?.taskId === task.taskId ? "selected" : ""}
                      onClick={() => setSelectedTask(selectedTask?.taskId === task.taskId ? null : task)}
                    >
                      <td>
                        <strong>{task.taskType}</strong>
                        <small>{compactId(task.taskId, 14)}</small>
                      </td>
                      <td>{task.userEmail}</td>
                      <td>{money.format(task.amount)} {task.userPaymentPreference}</td>
                      <td><span className={`status ${statusTone(task.paymentStatus)}`}>{task.paymentStatus}</span></td>
                      <td>{compactId(task.paymentReference, 16)}</td>
                    </tr>
                  ))}
                  {tasks.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-cell">No workflow records</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Task Detail</h2>
              <span>{selectedTask ? compactId(selectedTask.taskId, 12) : "none"}</span>
            </div>
            {selectedTask ? (
              <div className="detail-stack">
                <div className="detail-row"><span>Status</span><strong>{selectedTask.paymentStatus}</strong></div>
                <div className="detail-row"><span>Payment</span><strong>{selectedTask.paymentMethod}</strong></div>
                <div className="detail-row"><span>Reference</span><strong>{selectedTask.paymentReference || "unassigned"}</strong></div>
                <div className="detail-row"><span>Updated</span><strong>{formatTime(selectedTask.updatedAt)}</strong></div>
                <div className="detail-note">{selectedTask.note || selectedTask.instructions || "No note recorded."}</div>
              </div>
            ) : (
              <p className="muted">Select a workflow row.</p>
            )}
          </aside>
        </section>
      )}

      {activeTab === "webhooks" && (
        <section className="surface">
          <div className="section-head">
            <h2>Webhook Ledger</h2>
            <span>{webhooks.length} events</span>
          </div>
          <div className="event-grid">
            {webhooks.map((event) => (
              <div key={event.eventId} className="event-row">
                <div>
                  <strong>{event.eventType}</strong>
                  <span>{compactId(event.paymentReference, 20)}</span>
                </div>
                <time>{formatTime(event.receivedAt)}</time>
              </div>
            ))}
            {webhooks.length === 0 && <p className="muted">No webhook events</p>}
          </div>
        </section>
      )}

      {activeTab === "ops" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Operations Status</h2>
              <span>{operationsStatus?.status || "unknown"}</span>
            </div>
            <div className="metrics-grid ops-metrics">
              <div className={`metric-card ${operationsStatus?.database.status === "ok" ? "good" : "critical"}`}>
                <span>Database</span>
                <strong>{operationsStatus?.database.status || "-"}</strong>
              </div>
              <div className={`metric-card ${operationsStatus?.operations.sentryConfigured ? "good" : "watch"}`}>
                <span>Sentry</span>
                <strong>{operationsStatus?.operations.sentryConfigured ? "On" : "Off"}</strong>
              </div>
              <div className={`metric-card ${operationsStatus?.operations.alertsConfigured ? "good" : "watch"}`}>
                <span>Alerts</span>
                <strong>{operationsStatus?.operations.alertsConfigured ? "On" : "Off"}</strong>
              </div>
              <div className={`metric-card ${operationsStatus?.operations.recentErrors ? "critical" : "good"}`}>
                <span>Recent errors</span>
                <strong>{operationsStatus?.operations.recentErrors ?? 0}</strong>
              </div>
              <div className={`metric-card ${queueStatus?.dead || queueStatus?.failed ? "critical" : "good"}`}>
                <span>Queue failures</span>
                <strong>{(queueStatus?.dead || 0) + (queueStatus?.failed || 0)}</strong>
              </div>
              <div className={`metric-card ${abuseSignals.length ? "watch" : "good"}`}>
                <span>Abuse signals</span>
                <strong>{abuseSignals.length}</strong>
              </div>
              <div className={`metric-card ${supportCases.filter((item) => item.status === "open").length ? "watch" : "good"}`}>
                <span>Open support</span>
                <strong>{supportCases.filter((item) => item.status === "open").length}</strong>
              </div>
            </div>
            <div className="detail-stack">
              <div className="detail-row"><span>Provider</span><strong>{operationsStatus?.database.provider || "unknown"}</strong></div>
              <div className="detail-row"><span>DB latency</span><strong>{operationsStatus?.database.latencyMs ?? "-"} ms</strong></div>
              <div className="detail-row"><span>Settings version</span><strong>{operationsStatus?.database.settingsVersion || "-"}</strong></div>
              <div className="detail-row"><span>Recent warnings</span><strong>{operationsStatus?.operations.recentWarnings ?? 0}</strong></div>
            </div>
            <div className="section-head ops-subhead">
              <h2>Settlement Verification</h2>
              <span>{settlementProof?.status || "not run"}</span>
            </div>
            <div className="detail-stack">
              <div className="detail-row"><span>SAP</span><strong>{settlementProof?.sap?.status || "unknown"}</strong></div>
              <div className="detail-row"><span>x402</span><strong>{settlementProof?.x402?.status || "unknown"}</strong></div>
              <div className="detail-row"><span>Last checked</span><strong>{formatTime(settlementProof?.checkedAt)}</strong></div>
              {settlementProof?.warnings?.length ? <div className="detail-note critical-note">{settlementProof.warnings.join("; ")}</div> : null}
            </div>
            <button
              className="button primary full ops-action"
              onClick={async () => {
                try {
                  await runSettlementVerification();
                } catch (err: any) {
                  setError(err.message || "Settlement verification failed");
                }
              }}
            >
              Run settlement verification
            </button>
            <div className="section-head ops-subhead">
              <h2>Abuse Signals</h2>
              <span>{abuseSignals.length} records</span>
            </div>
            <div className="event-grid">
              {abuseSignals.slice(0, 5).map((signal) => (
                <div key={signal.signalId} className={`event-row ops-event ${signal.riskScore >= 70 ? "error" : "warning"}`}>
                  <div>
                    <strong>{signal.category} · {signal.riskScore}</strong>
                    <span>{signal.reason}</span>
                  </div>
                  <time>{formatTime(signal.createdAt)}</time>
                </div>
              ))}
              {abuseSignals.length === 0 && <p className="muted">No abuse signals</p>}
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Support Queue</h2>
              <span>{supportCases.length} cases</span>
            </div>
            <div className="event-grid">
              {supportCases.map((supportCase) => (
                <div key={supportCase.caseId} className={`event-row ops-event ${supportCase.priority === "urgent" || supportCase.priority === "high" ? "error" : "warning"}`}>
                  <div>
                    <strong>{supportCase.subject}</strong>
                    <span>{supportCase.status} · {supportCase.priority} · {supportCase.relatedEscrowId || supportCase.source}</span>
                  </div>
                  <time>{formatTime(supportCase.updatedAt)}</time>
                </div>
              ))}
              {supportCases.length === 0 && <p className="muted">No support cases</p>}
            </div>

            <div className="section-head ops-subhead">
              <h2>Recent Events</h2>
              <span>{operationalEvents.length} records</span>
            </div>
            <div className="event-grid">
              {operationalEvents.map((event) => (
                <div key={event.id} className={`event-row ops-event ${event.level}`}>
                  <div>
                    <strong>{event.message}</strong>
                    <span>{event.error || JSON.stringify(event.context)}</span>
                  </div>
                  <time>{formatTime(event.createdAt)}</time>
                </div>
              ))}
              {operationalEvents.length === 0 && <p className="muted">No operational events</p>}
            </div>
          </aside>
        </section>
      )}

      {activeTab === "fees" && (
        <section className="fees-layout">
          <div className="surface">
            <div className="section-head">
              <h2>Fee Controls</h2>
              <span>v{feeSettings?.version || "-"}</span>
            </div>
            {feeError && <div className="error-banner">{feeError}</div>}
            {feeSuccess && <div className="success-banner">{feeSuccess}</div>}

            <div className="fee-grid">
              <div className="fee-column">
                <h3>Naira</h3>
                <label className="field">
                  <span>Percentage</span>
                  <input type="number" step="0.1" min="0" max="50" value={feeFormData.nairaFeePercent}
                    onChange={(event) => setFeeFormData({ ...feeFormData, nairaFeePercent: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>Fixed fee</span>
                  <input type="number" step="1" min="0" value={feeFormData.nairaFeeFixed}
                    onChange={(event) => setFeeFormData({ ...feeFormData, nairaFeeFixed: Number(event.target.value) })} />
                </label>
              </div>
              <div className="fee-column">
                <h3>USDC</h3>
                <label className="field">
                  <span>Percentage</span>
                  <input type="number" step="0.1" min="0" max="50" value={feeFormData.usdcFeePercent}
                    onChange={(event) => setFeeFormData({ ...feeFormData, usdcFeePercent: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>Fixed fee</span>
                  <input type="number" step="0.01" min="0" value={feeFormData.usdcFeeFixed}
                    onChange={(event) => setFeeFormData({ ...feeFormData, usdcFeeFixed: Number(event.target.value) })} />
                </label>
              </div>
            </div>
            <button className="button primary full" onClick={() => setShowConfirmModal(true)} disabled={savingFees}>
              Review changes
            </button>
          </div>

          <div className="surface">
            <div className="section-head">
              <h2>Fee Preview</h2>
              <span>sample</span>
            </div>
            <div className="preview-list">
              <div className="preview-row">
                <span>Naira on 50,000</span>
                <strong>{money.format(calculateFee(50000, feeFormData.nairaFeePercent, feeFormData.nairaFeeFixed))} NGN</strong>
              </div>
              <div className="preview-row">
                <span>USDC on 1,000</span>
                <strong>{money.format(calculateFee(1000, feeFormData.usdcFeePercent, feeFormData.usdcFeeFixed))} USDC</strong>
              </div>
              <div className="preview-row">
                <span>Last update</span>
                <strong>{formatTime(feeSettings?.updatedAt)}</strong>
              </div>
            </div>
          </div>

          <div className="surface audit-surface">
            <div className="section-head">
              <h2>Audit Trail</h2>
              <span>{auditHistory.length} entries</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Setting</th>
                    <th>Changed by</th>
                  </tr>
                </thead>
                <tbody>
                  {auditHistory.map((record) => (
                    <tr key={record.id}>
                      <td>{formatTime(record.changedAt)}</td>
                      <td>{record.settingName}</td>
                      <td>{record.changedBy}</td>
                    </tr>
                  ))}
                  {auditHistory.length === 0 && (
                    <tr><td colSpan={3} className="empty-cell">No audit records</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {activeTab === "auth" && (
        <section className="surface auth-surface">
          <div className="section-head">
            <h2>Admin Auth</h2>
            <span>Telegram session and activity</span>
          </div>
          <div className="auth-grid">
            <div className="surface auth-card">
              <h3>Authentication Status</h3>
              <div className="detail-row"><span>Backend auth base</span><strong>{adminAuthBase.replace(/^https?:\/\//, "")}</strong></div>
              <div className="detail-row"><span>Logged in</span><strong>{adminKey ? "Yes" : "No"}</strong></div>
              <div className="detail-row"><span>Auth method</span><strong>{adminKey ? (isJwtToken(adminKey) ? "Telegram JWT" : "Legacy static key") : "Not authenticated"}</strong></div>
              {adminKey && isJwtToken(adminKey) ? (
                (() => {
                  const payload = decodeJwtPayload(adminKey);
                  return payload ? (
                    <>
                      <div className="detail-row"><span>Admin</span><strong>{payload.adminIdentifier || payload.sub || "admin"}</strong></div>
                      <div className="detail-row"><span>Expires</span><strong>{payload.exp ? new Date(payload.exp * 1000).toLocaleString() : "unknown"}</strong></div>
                    </>
                  ) : null;
                })()
              ) : null}
              <div className="button-group">
                <button className="button primary full" onClick={requestTelegramToken} disabled={loading}>
                  Request Telegram token
                </button>
                <button className="button secondary full" onClick={clearAdminKey}>
                  Logout / Clear session
                </button>
              </div>
            </div>

            <div className="surface auth-card">
              <h3>Activity & metrics</h3>
              {authError && <div className="error-banner">{authError}</div>}
              {!adminKey ? (
                <p className="muted">Sign in with Telegram first to view activity.</p>
              ) : !isJwtToken(adminKey) ? (
                <p className="muted">Admin metrics require a Telegram JWT. Legacy admin key mode has limited visibility.</p>
              ) : authLoading ? (
                <p className="muted">Loading session activity…</p>
              ) : (
                <>
                  <button className="button secondary full" onClick={loadAuthServiceInfo} disabled={authLoading}>
                    Refresh auth activity
                  </button>
                  {authStats ? (
                    <div className="preview-list" style={{ marginTop: 16 }}>
                      <div className="preview-row"><span>Total requests</span><strong>{authStats.total_requests ?? "-"}</strong></div>
                      <div className="preview-row"><span>Successful verifications</span><strong>{authStats.successful_verifications ?? "-"}</strong></div>
                      <div className="preview-row"><span>Failed verifications</span><strong>{authStats.failed_verifications ?? "-"}</strong></div>
                      <div className="preview-row"><span>Telegram errors</span><strong>{authStats.telegram_errors ?? "-"}</strong></div>
                      <div className="preview-row"><span>Unique admins</span><strong>{authStats.unique_admins ?? "-"}</strong></div>
                      <div className="preview-row"><span>Unique IPs</span><strong>{authStats.unique_ips ?? "-"}</strong></div>
                    </div>
                  ) : (
                    <p className="muted">No auth metrics available yet.</p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="surface auth-card">
            <h3>Active Sessions</h3>
            {authSessions.length === 0 ? (
              <p className="muted">No active Telegram auth sessions to display.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Admin</th>
                      <th>Created</th>
                      <th>Expires</th>
                      <th>IP</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {authSessions.map((session) => (
                      <tr key={session.sessionId}>
                        <td>{session.adminIdentifier}</td>
                        <td>{formatTime(session.createdAt)}</td>
                        <td>{session.expiresAt ? formatTime(session.expiresAt) : "unknown"}</td>
                        <td>{session.ip || "-"}</td>
                        <td>
                          <button className="button small" onClick={() => revokeAuthSession(session.sessionId)} disabled={authLoading}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Confirm Fee Update</h2>
            <p className="muted">New transactions will use the updated fee table immediately.</p>
            <div className="modal-summary">
              <div><span>Naira</span><strong>{feeFormData.nairaFeePercent}% + {feeFormData.nairaFeeFixed} NGN</strong></div>
              <div><span>USDC</span><strong>{feeFormData.usdcFeePercent}% + {feeFormData.usdcFeeFixed} USDC</strong></div>
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setShowConfirmModal(false)} disabled={savingFees}>Cancel</button>
              <button className="button primary" onClick={handleSaveFees} disabled={savingFees}>
                {savingFees ? "Saving" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
