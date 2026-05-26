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
  releaseRequestedAt?: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt?: string;
  updatedAt?: string;
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

type Tab = "escrows" | "tasks" | "webhooks" | "fees";

const apiBase = (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000";
const storedAdminKey = "sivan.adminToken";
const adminAuthBase = (import.meta as any).env.VITE_ADMIN_AUTH_BASE_URL || "http://localhost:3600";

const money = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function compactId(value?: string, length = 10) {
  if (!value) return "unassigned";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function statusTone(status: string) {
  if (/failed|error|invalid|release_failed/i.test(status)) return "critical";
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
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditRecord[]>([]);
  const [feeSettings, setFeeSettings] = useState<FeeSettings | null>(null);
  const [feeFormData, setFeeFormData] = useState({
    nairaFeePercent: 0,
    nairaFeeFixed: 0,
    usdcFeePercent: 0,
    usdcFeeFixed: 0,
  });

  const [activeTab, setActiveTab] = useState<Tab>("escrows");
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
    setSelectedTask(null);
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

  const refreshAll = async () => {
    setLoading(true);
    setError(null);
    setFeeError(null);
    try {
      await Promise.all([loadEscrows(), loadTasks(), loadWebhooks(), loadFeeSettings(), loadAuditHistory()]);
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
  };

  const disputeEscrow = async (escrowId: string) => {
    const response = await fetch(`${apiBase}/admin/escrows/${escrowId}/dispute`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ reason: "Admin review required" }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to dispute escrow"));
    await loadEscrows();
  };

  const metrics = useMemo(() => {
    const active = escrows.filter((escrow) => !/released|failed|cancelled/i.test(escrow.status)).length;
    const pending = escrows.filter((escrow) => /pending|created/i.test(escrow.status)).length;
    const settled = escrows.filter((escrow) => /released/i.test(escrow.status)).length;
    const failed = escrows.filter((escrow) => /failed|disputed/i.test(escrow.status)).length;
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
              onClick={async () => {
                setLoading(true);
                try {
                  const resp = await fetch(`${adminAuthBase}/auth/request-session`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-admin-request-secret": (import.meta as any).env.VITE_ADMIN_REQUEST_SECRET || "" },
                    body: JSON.stringify({ adminIdentifier: "frontend" }),
                  });
                  if (!resp.ok) throw new Error("Failed to request session");
                  alert("Token requested. Check Telegram for the 6-digit code.");
                } catch (err: any) {
                  setError(err.message || "Failed to request token");
                } finally {
                  setLoading(false);
                }
              }}
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

      <nav className="tabs" aria-label="Admin sections">
        {(["escrows", "tasks", "webhooks", "fees"] as Tab[]).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab === "escrows" ? "Escrows" : tab === "tasks" ? "Tasks" : tab === "webhooks" ? "Webhooks" : "Fees"}
          </button>
        ))}
      </nav>

      {activeTab === "escrows" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Escrow Ledger</h2>
              <span>{escrows.length} records</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Escrow</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Release</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {escrows.map((escrow) => (
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
                      <td>{escrow.settlementPolicy}</td>
                      <td>{compactId(escrow.paymentReference, 16)}</td>
                    </tr>
                  ))}
                  {escrows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty-cell">No escrows yet</td>
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
                <div className="detail-row"><span>Seller</span><strong>{selectedEscrow.sellerWhatsapp || selectedEscrow.sellerUserId || "pending"}</strong></div>
                <div className="detail-row"><span>Payout ref</span><strong>{selectedEscrow.manualPayoutReference || "not released"}</strong></div>
                <div className="detail-row"><span>Payout notes</span><strong>{selectedEscrow.payoutNotes || "none"}</strong></div>
                <div className="detail-row"><span>Released by</span><strong>{selectedEscrow.releasedBy || "not released"}</strong></div>
                <div className="detail-row"><span>Dispute</span><strong>{selectedEscrow.status === "DISPUTED" ? "open" : "none"}</strong></div>
                <div className="detail-note">{selectedEscrow.purpose}</div>
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
