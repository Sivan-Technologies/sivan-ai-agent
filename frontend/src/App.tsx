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
  sellerName?: string | null;
  expectedAmount: number;
  receivedAmount: number | null;
  currency: "NAIRA" | "USDC";
  grossAmount?: number;
  platformFeeAmount?: number;
  sellerNetAmount?: number;
  amountSource?: "escrow_record";
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
  payoutBankName?: string | null;
  payoutBankCode?: string | null;
  payoutAccountNumber?: string | null;
  resolvedAccountName?: string | null;
  nameMatchScore?: number | null;
  nameMatchLevel?: string | null;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
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
  stuckEscrows?: {
    status: string;
    thresholdMinutes: number;
    count: number;
    samples: Array<{ escrowId: string; status: string; currency: string; updatedAt: string; ageMinutes: number; paymentReference?: string | null }>;
  };
};

type WhatsAppProviderStatus = {
  activeProvider: "twilio" | "meta" | "unknown";
  configured?: boolean;
  warning?: string;
  providers: {
    twilio?: { configured: boolean };
    meta?: { configured: boolean; graphApiVersion?: string };
  };
};

type DisasterRecoveryStatus = {
  status: string;
  checkedAt: string;
  backup: {
    provider: string;
    configured: boolean;
    retentionDays: number;
    policyUrlConfigured: boolean;
    restoreRunbookConfigured: boolean;
  };
  restore: {
    lastTestAt?: string | null;
    lastStatus: string;
    maxAgeDays: number;
    fresh: boolean;
  };
  rollback: {
    configured: boolean;
    releaseUrlConfigured: boolean;
    renderServiceConfigured: boolean;
    vercelProjectConfigured: boolean;
  };
  outage: {
    configured: boolean;
    statusPageConfigured: boolean;
    contactsConfigured: boolean;
  };
  runbook: string;
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

type QueueJob = {
  jobId: string;
  jobType: string;
  status: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
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

type AbuseAnalytics = {
  totals: {
    signals: number;
    criticalSignals: number;
    highSignals: number;
    monitoredEscrows: number;
    activeActions: number;
    suggestedActions?: number;
  };
  severityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  actions: Array<{ actionId: string; subjectType: string; subjectId: string; action: string; reason: string; createdBy: string; expiresAt?: string; createdAt: string }>;
  reputationWatchlist: Array<{ subjectType: string; subjectId: string; signals: number; maxRiskScore: number; lastSeenAt: string; reasons: string[] }>;
  fingerprintWatchlist: Array<{ fingerprint: string; signals: number; maxRiskScore: number; lastSeenAt: string; subjects: string[]; sources: string[] }>;
  velocityWatchlist: Array<{ buyerUserId: string; escrows: number; active: number; disputed: number; reviewRequired: number; latestAt: string }>;
  suggestedActions?: Array<{ subjectType: string; subjectId: string; suggestedAction: string; confidence: number; reason: string; evidence: string[] }>;
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
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
};

type SupportNote = {
  noteId: string;
  caseId: string;
  author: string;
  body: string;
  actionType?: string;
  createdAt: string;
};

type EscrowTimeline = {
  escrowId: string;
  events: Array<{ eventId: string; eventType: string; actor: string; actorRole: string; channel: string; previousStatus?: string; nextStatus?: string; reason?: string; metadata?: string; createdAt: string }>;
  transactions: Array<{ transactionId: string; provider: string; transactionType: string; status: string; reference?: string; amount: number; currency: string; createdAt: string; updatedAt: string }>;
  supportCases: SupportCase[];
};

type DisputeRow = {
  escrow: EscrowRecord;
  openedAt: string;
  evidenceCount: number;
  latestEventAt: string;
  supportCases: SupportCase[];
  transactions: Array<{ transactionId: string; provider: string; transactionType: string; status: string; reference?: string; amount: number; currency: string; createdAt: string; updatedAt: string }>;
  events: EscrowTimeline["events"];
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

type Tab = "escrows" | "disputes" | "support" | "payout" | "risk" | "audit" | "ops" | "tasks" | "webhooks" | "fees" | "auth";
type EscrowFilter = "all" | "review" | "pendingRelease" | "released" | "missingPayout" | "amountMismatch";

const apiBase = (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000";
const storedAdminKey = "sivan.adminToken";
const adminAuthBase = (import.meta as any).env.VITE_ADMIN_AUTH_BASE_URL || "http://localhost:3600";

const money = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function calculateSellerNet(amount: number, currency: "NAIRA" | "USDC", settings?: FeeSettings | null) {
  if (!settings) return { platformFeeAmount: 0, sellerNetAmount: amount };
  const percentFee = currency === "NAIRA"
    ? Math.round((amount * settings.nairaFeePercent) / 100)
    : Number((amount * (settings.usdcFeePercent / 100)).toFixed(6));
  const fixedFee = currency === "NAIRA" ? settings.nairaFeeFixed : settings.usdcFeeFixed;
  const platformFeeAmount = Math.min(amount, Math.max(0, Number((percentFee + fixedFee).toFixed(6))));
  return {
    platformFeeAmount,
    sellerNetAmount: Math.max(0, Number((amount - platformFeeAmount).toFixed(6))),
  };
}

function compactId(value?: string, length = 10) {
  if (!value) return "unassigned";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function statusTone(status: string) {
  if (/^high$/i.test(status)) return "critical";
  if (/^medium$/i.test(status)) return "watch";
  if (/^low$/i.test(status)) return "good";
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
  const [disasterRecoveryStatus, setDisasterRecoveryStatus] = useState<DisasterRecoveryStatus | null>(null);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [settlementProof, setSettlementProof] = useState<SettlementProof | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [abuseSignals, setAbuseSignals] = useState<AbuseSignal[]>([]);
  const [abuseAnalytics, setAbuseAnalytics] = useState<AbuseAnalytics | null>(null);
  const [supportCases, setSupportCases] = useState<SupportCase[]>([]);
  const [selectedSupportCase, setSelectedSupportCase] = useState<SupportCase | null>(null);
  const [supportNotes, setSupportNotes] = useState<SupportNote[]>([]);
  const [supportSearch, setSupportSearch] = useState("");
  const [supportNoteDraft, setSupportNoteDraft] = useState("");
  const [timeline, setTimeline] = useState<EscrowTimeline | null>(null);
  const [timelineEscrowId, setTimelineEscrowId] = useState("");
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [selectedDispute, setSelectedDispute] = useState<DisputeRow | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState({ evidenceType: "other", source: "admin", summary: "", uri: "" });
  const [resolutionDraft, setResolutionDraft] = useState({ outcome: "release_to_seller", reason: "", reference: "" });
  const [actionBusy, setActionBusy] = useState(false);
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
  const [whatsappProviderStatus, setWhatsappProviderStatus] = useState<WhatsAppProviderStatus | null>(null);

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
    setDisasterRecoveryStatus(null);
    setOperationalEvents([]);
    setSettlementProof(null);
    setQueueStatus(null);
    setQueueJobs([]);
    setAbuseSignals([]);
    setAbuseAnalytics(null);
    setSupportCases([]);
    setSelectedSupportCase(null);
    setSupportNotes([]);
    setTimeline(null);
    setDisputes([]);
    setSelectedDispute(null);
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

  const loadDisputes = async () => {
    if (!adminKey) return;
    const response = await fetch(`${apiBase}/admin/disputes?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load disputes"));
    const rows = (await response.json()) || [];
    setDisputes(rows);
    if (selectedDispute) {
      setSelectedDispute(rows.find((row: DisputeRow) => row.escrow.escrowId === selectedDispute.escrow.escrowId) || null);
    }
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
    const [statusResponse, drResponse, eventsResponse, settlementResponse, queueResponse, queueJobsResponse, abuseResponse, abuseAnalyticsResponse, supportResponse, whatsappProviderResponse] = await Promise.all([
      fetch(`${apiBase}/admin/ops/status`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/dr/status`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/ops/events?limit=50`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/settlement/verification`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/queue/status`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/queue/jobs?limit=50`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/abuse/signals?limit=100`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/abuse/analytics?limit=500`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/support/cases?limit=100`, { headers: authHeaders() }),
      fetch(`${apiBase}/admin/whatsapp-provider`, { headers: authHeaders() }),
    ]);
    if (!statusResponse.ok) throw new Error(await parseError(statusResponse, "Failed to load operations status"));
    if (!drResponse.ok) throw new Error(await parseError(drResponse, "Failed to load disaster recovery status"));
    if (!eventsResponse.ok) throw new Error(await parseError(eventsResponse, "Failed to load operations events"));
    if (!queueResponse.ok) throw new Error(await parseError(queueResponse, "Failed to load queue status"));
    setOperationsStatus(await statusResponse.json());
    setDisasterRecoveryStatus(await drResponse.json());
    setOperationalEvents((await eventsResponse.json()) || []);
    setSettlementProof(settlementResponse.ok ? await settlementResponse.json() : null);
    setQueueStatus(await queueResponse.json());
    setQueueJobs(queueJobsResponse.ok ? await queueJobsResponse.json() : []);
    setAbuseSignals(abuseResponse.ok ? await abuseResponse.json() : []);
    setAbuseAnalytics(abuseAnalyticsResponse.ok ? await abuseAnalyticsResponse.json() : null);
    setSupportCases(supportResponse.ok ? await supportResponse.json() : []);
    setWhatsappProviderStatus(whatsappProviderResponse.ok ? await whatsappProviderResponse.json() : null);
  };

  const switchWhatsAppProvider = async (provider: "twilio" | "meta") => {
    setActionBusy(true);
    try {
      const response = await fetch(`${apiBase}/admin/whatsapp-provider`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) throw new Error(await parseError(response, "Failed to switch WhatsApp provider"));
      setWhatsappProviderStatus(await response.json());
      await loadOperations();
    } finally {
      setActionBusy(false);
    }
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
      await Promise.all([loadEscrows(), loadReconciliation(), loadDisputes(), loadTasks(), loadWebhooks(), loadFeeSettings(), loadAuditHistory(), loadOperations()]);
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

  const approveEscrowRelease = async (escrowId: string, payoutAmount?: number, currency?: string) => {
    const amountLabel = payoutAmount !== undefined && currency
      ? ` Seller net payout is ${money.format(payoutAmount)} ${currency}.`
      : "";
    const manualPayoutReference = window.prompt(`Enter payout reference from Paystack/bank transfer.${amountLabel}\nDo not enter a payout amount here.`);
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

  const enqueuePayoutReview = async (escrowId: string, reason = "operator_payout_safety_review") => {
    const response = await fetch(`${apiBase}/admin/escrows/${escrowId}/payout-review`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to enqueue payout review"));
    await loadOperations();
  };

  const runQueueWorker = async () => {
    const response = await fetch(`${apiBase}/admin/queue/run`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ limit: 10 }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to run queue worker"));
    await loadOperations();
  };

  const retryQueueJob = async (jobId: string) => {
    const response = await fetch(`${apiBase}/admin/queue/jobs/${jobId}/retry`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ resetAttempts: false }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to retry queue job"));
    await loadOperations();
  };

  const loadSupportNotes = async (caseId: string) => {
    const response = await fetch(`${apiBase}/admin/support/cases/${caseId}/notes`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load support notes"));
    setSupportNotes((await response.json()) || []);
  };

  const selectSupportCase = async (supportCase: SupportCase) => {
    setSelectedSupportCase(supportCase);
    setSupportNoteDraft("");
    await loadSupportNotes(supportCase.caseId);
  };

  const updateSupportCase = async (caseId: string, updates: Record<string, string>) => {
    const response = await fetch(`${apiBase}/admin/support/cases/${caseId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to update support case"));
    const updated = await response.json();
    setSelectedSupportCase(updated);
    await Promise.all([loadOperations(), loadSupportNotes(caseId)]);
  };

  const addSupportNote = async () => {
    if (!selectedSupportCase || !supportNoteDraft.trim()) return;
    const response = await fetch(`${apiBase}/admin/support/cases/${selectedSupportCase.caseId}/notes`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ body: supportNoteDraft.trim(), actionType: "operator_note" }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to add support note"));
    setSupportNoteDraft("");
    await loadSupportNotes(selectedSupportCase.caseId);
  };

  const loadEscrowTimeline = async (escrowId: string) => {
    const id = escrowId.trim();
    if (!id) return;
    const response = await fetch(`${apiBase}/admin/escrows/${id}/events?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load escrow timeline"));
    setTimeline(await response.json());
    setTimelineEscrowId(id);
    setActiveTab("audit");
  };

  const recordDisputeEvidence = async () => {
    if (!selectedDispute || !evidenceDraft.summary.trim()) return;
    const response = await fetch(`${apiBase}/admin/escrows/${selectedDispute.escrow.escrowId}/dispute/evidence`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        evidenceType: evidenceDraft.evidenceType,
        source: evidenceDraft.source,
        summary: evidenceDraft.summary.trim(),
        uri: evidenceDraft.uri.trim() || undefined,
      }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to record dispute evidence"));
    setEvidenceDraft({ evidenceType: "other", source: "admin", summary: "", uri: "" });
    await Promise.all([loadDisputes(), loadOperations()]);
  };

  const resolveDispute = async () => {
    if (!selectedDispute || !resolutionDraft.reason.trim()) return;
    const response = await fetch(`${apiBase}/admin/escrows/${selectedDispute.escrow.escrowId}/dispute/resolve`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        outcome: resolutionDraft.outcome,
        reason: resolutionDraft.reason.trim(),
        reference: resolutionDraft.reference.trim() || undefined,
      }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to resolve dispute"));
    setResolutionDraft({ outcome: "release_to_seller", reason: "", reference: "" });
    setSelectedDispute(null);
    await Promise.all([loadDisputes(), loadEscrows(), loadReconciliation(), loadOperations()]);
  };

  const recordAbuseAction = async (subjectType: string, subjectId: string, action: string) => {
    const reason = window.prompt(`Reason for ${action} on ${subjectId}:`);
    if (!reason) return;
    const response = await fetch(`${apiBase}/admin/abuse/actions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ subjectType, subjectId, action, reason }),
    });
    if (!response.ok) throw new Error(await parseError(response, "Failed to record abuse action"));
    await loadOperations();
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

  const filteredSupportCases = useMemo(() => {
    const query = supportSearch.trim().toLowerCase();
    if (!query) return supportCases;
    return supportCases.filter((supportCase) =>
      [
        supportCase.caseId,
        supportCase.subject,
        supportCase.status,
        supportCase.priority,
        supportCase.relatedEscrowId,
        supportCase.relatedUser,
        supportCase.assignedTo,
        supportCase.source,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
    );
  }, [supportCases, supportSearch]);

  const payoutSafetyRows = useMemo(() => {
    return reconciliationRows.filter((row) =>
      row.status === "PENDING_RELEASE" ||
      row.status === "REVIEW_REQUIRED" ||
      (row.status === "RELEASED" && !row.payoutReference) ||
      row.flags.includes("payment_amount_mismatch") ||
      row.flags.includes("missing_payout_reference")
    );
  }, [reconciliationRows]);

  const selectedPayoutQuote = selectedEscrow
    ? reconciliationByEscrow.get(selectedEscrow.escrowId) || {
      grossAmount: selectedEscrow.amount,
      platformFeeAmount: calculateSellerNet(selectedEscrow.amount, selectedEscrow.currency, feeSettings).platformFeeAmount,
      sellerNetAmount: calculateSellerNet(selectedEscrow.amount, selectedEscrow.currency, feeSettings).sellerNetAmount,
      amountSource: "escrow_record" as const,
      currency: selectedEscrow.currency,
    }
    : null;

  const deadOrFailedJobs = useMemo(() => queueJobs.filter((job) => job.status === "failed" || job.status === "dead"), [queueJobs]);

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
        {(["escrows", "disputes", "support", "payout", "risk", "audit", "ops", "tasks", "webhooks", "fees", "auth"] as Tab[]).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab === "escrows"
              ? "Escrows"
              : tab === "disputes"
              ? "Disputes"
              : tab === "support"
              ? "Support"
              : tab === "payout"
              ? "Payout Safety"
              : tab === "risk"
              ? "Risk"
              : tab === "audit"
              ? "Audit"
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
                <div className="detail-row"><span>Platform fee</span><strong>{money.format(selectedPayoutQuote?.platformFeeAmount ?? 0)} {selectedEscrow.currency}</strong></div>
                <div className="detail-row"><span>Seller net payout</span><strong>{money.format(selectedPayoutQuote?.sellerNetAmount ?? selectedEscrow.amount)} {selectedEscrow.currency}</strong></div>
                <div className="detail-row"><span>Amount source</span><strong>{selectedPayoutQuote?.amountSource || "escrow_record"}</strong></div>
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
                  className="button secondary full"
                  onClick={async () => {
                    try {
                      await loadEscrowTimeline(selectedEscrow.escrowId);
                    } catch (err: any) {
                      setError(err.message || "Timeline load failed");
                    }
                  }}
                >
                  Open event timeline
                </button>
                <button
                  className="button secondary full"
                  disabled={["RELEASED", "CANCELLED", "FAILED"].includes(selectedEscrow.status)}
                  onClick={async () => {
                    try {
                      await enqueuePayoutReview(selectedEscrow.escrowId, "operator_requested_from_escrow_detail");
                    } catch (err: any) {
                      setError(err.message || "Payout review failed");
                    }
                  }}
                >
                  Queue payout safety review
                </button>
                <button
                  className="button primary full"
                  disabled={selectedEscrow.status !== "PENDING_RELEASE"}
                  onClick={async () => {
                    try {
                      await approveEscrowRelease(
                        selectedEscrow.escrowId,
                        selectedPayoutQuote?.sellerNetAmount ?? selectedEscrow.amount,
                        selectedEscrow.currency
                      );
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

      {activeTab === "disputes" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Dispute Desk</h2>
              <span>{disputes.length} open</span>
            </div>
            <div className="event-grid">
              {disputes.map((row) => (
                <button
                  key={row.escrow.escrowId}
                  className={`event-row selectable-row ops-event error ${selectedDispute?.escrow.escrowId === row.escrow.escrowId ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedDispute(row);
                    setSelectedEscrow(row.escrow);
                    setTimelineEscrowId(row.escrow.escrowId);
                  }}
                >
                  <div>
                    <strong>{row.escrow.escrowId} · {money.format(row.escrow.amount)} {row.escrow.currency}</strong>
                    <span>{row.escrow.purpose}</span>
                    <span>{row.evidenceCount} evidence records · {row.supportCases.length} support cases</span>
                  </div>
                  <time>{formatTime(row.openedAt)}</time>
                </button>
              ))}
              {disputes.length === 0 && <p className="muted">No open disputes</p>}
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Manual Resolution</h2>
              <span>{selectedDispute ? selectedDispute.escrow.escrowId : "none"}</span>
            </div>
            {selectedDispute ? (
              <div className="detail-stack">
                <div className="detail-row"><span>Status</span><strong>{selectedDispute.escrow.status}</strong></div>
                <div className="detail-row"><span>Payment reference</span><strong>{selectedDispute.escrow.paymentReference || "none"}</strong></div>
                <div className="detail-row"><span>Received</span><strong>{selectedDispute.escrow.receivedAmount === undefined ? "not verified" : `${money.format(selectedDispute.escrow.receivedAmount)} ${selectedDispute.escrow.currency}`}</strong></div>
                <div className="detail-row"><span>Latest event</span><strong>{formatTime(selectedDispute.latestEventAt)}</strong></div>

                <div className="section-head ops-subhead">
                  <h2>Evidence Capture</h2>
                  <span>{selectedDispute.evidenceCount} records</span>
                </div>
                <div className="control-grid">
                  <label className="field">
                    <span>Type</span>
                    <select value={evidenceDraft.evidenceType} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, evidenceType: event.target.value })}>
                      <option value="message">Message</option>
                      <option value="payment_proof">Payment proof</option>
                      <option value="delivery_proof">Delivery proof</option>
                      <option value="identity">Identity</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Source</span>
                    <select value={evidenceDraft.source} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, source: event.target.value })}>
                      <option value="buyer">Buyer</option>
                      <option value="seller">Seller</option>
                      <option value="admin">Admin</option>
                      <option value="support">Support</option>
                      <option value="payment_provider">Payment provider</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Evidence summary</span>
                  <textarea rows={4} value={evidenceDraft.summary} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, summary: event.target.value })} />
                </label>
                <label className="field">
                  <span>Evidence URL</span>
                  <input type="url" value={evidenceDraft.uri} onChange={(event) => setEvidenceDraft({ ...evidenceDraft, uri: event.target.value })} placeholder="https://..." autoComplete="url" />
                </label>
                <button
                  className="button secondary full"
                  disabled={!evidenceDraft.summary.trim() || actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    try {
                      await recordDisputeEvidence();
                    } catch (err: any) {
                      setError(err.message || "Evidence capture failed");
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  Record evidence
                </button>

                <div className="section-head ops-subhead">
                  <h2>Resolution Outcome</h2>
                  <span>manual</span>
                </div>
                <label className="field">
                  <span>Outcome</span>
                  <select value={resolutionDraft.outcome} onChange={(event) => setResolutionDraft({ ...resolutionDraft, outcome: event.target.value })}>
                    <option value="release_to_seller">Release to seller</option>
                    <option value="refund_buyer">Refund buyer</option>
                    <option value="cancel_no_funds">Cancel, no funds received</option>
                    <option value="no_action_close">Close with no action</option>
                  </select>
                </label>
                <label className="field">
                  <span>Reference</span>
                  <input value={resolutionDraft.reference} onChange={(event) => setResolutionDraft({ ...resolutionDraft, reference: event.target.value })} placeholder="Payout/refund/reference ID" autoComplete="off" />
                </label>
                <label className="field">
                  <span>Resolution reason</span>
                  <textarea rows={4} value={resolutionDraft.reason} onChange={(event) => setResolutionDraft({ ...resolutionDraft, reason: event.target.value })} />
                </label>
                <button
                  className="button primary full"
                  disabled={!resolutionDraft.reason.trim() || actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    try {
                      await resolveDispute();
                    } catch (err: any) {
                      setError(err.message || "Dispute resolution failed");
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  Record manual resolution
                </button>
                <button className="button secondary full" onClick={() => loadEscrowTimeline(selectedDispute.escrow.escrowId)}>
                  Open full timeline
                </button>
              </div>
            ) : (
              <p className="muted">Select a dispute to capture evidence or record the manual outcome.</p>
            )}
          </aside>
        </section>
      )}

      {activeTab === "support" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Support Inbox</h2>
              <span>{filteredSupportCases.length} of {supportCases.length} cases</span>
            </div>
            <label className="field compact-field">
              <span>Search cases</span>
              <input
                type="search"
                value={supportSearch}
                onChange={(event) => setSupportSearch(event.target.value)}
                placeholder="Escrow ID, user, assignee, status"
                autoComplete="off"
              />
            </label>
            <div className="event-grid">
              {filteredSupportCases.map((supportCase) => (
                <button
                  key={supportCase.caseId}
                  className={`event-row selectable-row ops-event ${supportCase.priority === "urgent" || supportCase.priority === "high" ? "error" : "warning"} ${selectedSupportCase?.caseId === supportCase.caseId ? "selected" : ""}`}
                  onClick={async () => {
                    try {
                      await selectSupportCase(supportCase);
                    } catch (err: any) {
                      setError(err.message || "Support case load failed");
                    }
                  }}
                >
                  <div>
                    <strong>{supportCase.subject}</strong>
                    <span>{supportCase.status} · {supportCase.priority} · assigned {supportCase.assignedTo || "unassigned"}</span>
                    <span>{supportCase.relatedEscrowId || supportCase.relatedUser || supportCase.source}</span>
                  </div>
                  <time>{formatTime(supportCase.updatedAt)}</time>
                </button>
              ))}
              {filteredSupportCases.length === 0 && <p className="muted">No support cases match this search</p>}
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Case Workflow</h2>
              <span>{selectedSupportCase ? compactId(selectedSupportCase.caseId, 14) : "none"}</span>
            </div>
            {selectedSupportCase ? (
              <div className="detail-stack">
                <div className="detail-row"><span>Status</span><strong>{selectedSupportCase.status}</strong></div>
                <div className="detail-row"><span>Priority</span><strong>{selectedSupportCase.priority}</strong></div>
                <div className="detail-row"><span>Assigned</span><strong>{selectedSupportCase.assignedTo || "unassigned"}</strong></div>
                <div className="detail-row"><span>Linked escrow</span><strong>{selectedSupportCase.relatedEscrowId || "none"}</strong></div>
                <div className="control-grid">
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={selectedSupportCase.status}
                      onChange={async (event) => {
                        try {
                          await updateSupportCase(selectedSupportCase.caseId, { status: event.target.value });
                        } catch (err: any) {
                          setError(err.message || "Status update failed");
                        }
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="pending">Pending</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select
                      value={selectedSupportCase.priority}
                      onChange={async (event) => {
                        try {
                          await updateSupportCase(selectedSupportCase.caseId, { priority: event.target.value });
                        } catch (err: any) {
                          setError(err.message || "Priority update failed");
                        }
                      }}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Assign operator</span>
                  <input
                    type="text"
                    defaultValue={selectedSupportCase.assignedTo || ""}
                    placeholder="operator name"
                    autoComplete="name"
                    onBlur={async (event) => {
                      const assignedTo = event.target.value.trim();
                      if (assignedTo !== (selectedSupportCase.assignedTo || "")) {
                        try {
                          await updateSupportCase(selectedSupportCase.caseId, { assignedTo });
                        } catch (err: any) {
                          setError(err.message || "Assignment failed");
                        }
                      }
                    }}
                  />
                </label>
                {selectedSupportCase.relatedEscrowId && (
                  <button className="button secondary full" onClick={() => loadEscrowTimeline(selectedSupportCase.relatedEscrowId!)}>
                    Open linked escrow timeline
                  </button>
                )}
                <label className="field">
                  <span>Internal note</span>
                  <textarea value={supportNoteDraft} onChange={(event) => setSupportNoteDraft(event.target.value)} rows={4} />
                </label>
                <button
                  className="button primary full"
                  disabled={!supportNoteDraft.trim()}
                  onClick={async () => {
                    try {
                      await addSupportNote();
                    } catch (err: any) {
                      setError(err.message || "Note failed");
                    }
                  }}
                >
                  Add internal note
                </button>
                <div className="section-head ops-subhead">
                  <h2>Notes</h2>
                  <span>{supportNotes.length}</span>
                </div>
                <div className="event-grid">
                  {supportNotes.map((note) => (
                    <div key={note.noteId} className="event-row">
                      <div>
                        <strong>{note.actionType || "note"} · {note.author}</strong>
                        <span>{note.body}</span>
                      </div>
                      <time>{formatTime(note.createdAt)}</time>
                    </div>
                  ))}
                  {supportNotes.length === 0 && <p className="muted">No notes recorded</p>}
                </div>
              </div>
            ) : (
              <p className="muted">Select a support case.</p>
            )}
          </aside>
        </section>
      )}

      {activeTab === "payout" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Payout Safety Queue</h2>
              <span>{payoutSafetyRows.length} records</span>
            </div>
            <div className="metrics-grid ops-metrics">
              <div className="metric-card watch"><span>Awaiting payout</span><strong>{reconciliationSummary.releasesAwaitingPayout}</strong></div>
              <div className="metric-card critical"><span>Missing refs</span><strong>{reconciliationSummary.releasedMissingPayoutReference}</strong></div>
              <div className="metric-card critical"><span>Amount mismatch</span><strong>{reconciliationSummary.paystackAmountMismatches}</strong></div>
              <div className="metric-card watch"><span>Review jobs</span><strong>{queueJobs.filter((job) => job.jobType === "payout_review" && !["succeeded", "dead"].includes(job.status)).length}</strong></div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Escrow</th>
                    <th>Status</th>
                    <th>Seller</th>
                    <th>Payout account</th>
                    <th>Gross</th>
                    <th>Fee</th>
                    <th>Seller net</th>
                    <th>Risk</th>
                    <th>Payout ref</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutSafetyRows.map((row) => (
                    <tr key={row.escrowId}>
                      <td><strong>{row.escrowId}</strong><small>{row.purpose}</small></td>
                      <td><span className={`status ${statusTone(row.status)}`}>{row.status}</span></td>
                      <td><strong>{row.sellerName || row.seller}</strong><small>{row.seller}</small></td>
                      <td>
                        <strong>{row.payoutBankName || "not set"} {row.payoutAccountNumber || ""}</strong>
                        <small>{row.resolvedAccountName || "name not resolved"}{row.nameMatchLevel ? ` · ${row.nameMatchLevel}` : ""}</small>
                      </td>
                      <td>{money.format(row.grossAmount ?? row.expectedAmount)} {row.currency}</td>
                      <td>{money.format(row.platformFeeAmount ?? 0)} {row.currency}</td>
                      <td><strong>{money.format(row.sellerNetAmount ?? row.expectedAmount)} {row.currency}</strong></td>
                      <td><span className={`status ${statusTone(row.riskLevel || "LOW")}`}>{row.riskLevel || "LOW"}</span></td>
                      <td>{row.payoutReference || "missing"}</td>
                      <td>
                        <button
                          className="button small"
                          disabled={actionBusy}
                          onClick={async () => {
                            setActionBusy(true);
                            try {
                              if (row.status === "PENDING_RELEASE") {
                                await approveEscrowRelease(row.escrowId, row.sellerNetAmount ?? row.expectedAmount, row.currency);
                              } else {
                                await enqueuePayoutReview(row.escrowId, "operator_requested_from_payout_safety");
                              }
                            } catch (err: any) {
                              setError(err.message || "Payout action failed");
                            } finally {
                              setActionBusy(false);
                            }
                          }}
                        >
                          {row.status === "PENDING_RELEASE" ? "Approve payout" : "Review"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {payoutSafetyRows.length === 0 && <tr><td colSpan={10} className="empty-cell">No payout exceptions</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Recovery Jobs</h2>
              <span>{deadOrFailedJobs.length} failed/dead</span>
            </div>
            <button
              className="button primary full"
              onClick={async () => {
                try {
                  await runQueueWorker();
                } catch (err: any) {
                  setError(err.message || "Queue run failed");
                }
              }}
            >
              Run retry worker
            </button>
            <div className="event-grid ops-subhead">
              {deadOrFailedJobs.map((job) => (
                <div key={job.jobId} className={`event-row ops-event ${job.status === "dead" ? "error" : "warning"}`}>
                  <div>
                    <strong>{job.jobType} · {job.status}</strong>
                    <span>{job.lastError || job.payload}</span>
                    <span>{job.attempts}/{job.maxAttempts} attempts · next {formatTime(job.runAfter)}</span>
                  </div>
                  <button className="button small" onClick={() => retryQueueJob(job.jobId)}>Retry</button>
                </div>
              ))}
              {deadOrFailedJobs.length === 0 && <p className="muted">No failed queue jobs</p>}
            </div>
          </aside>
        </section>
      )}

      {activeTab === "risk" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Abuse Analytics</h2>
              <span>{abuseAnalytics?.totals.signals ?? 0} signals</span>
            </div>
            <div className="metrics-grid ops-metrics">
              <div className="metric-card critical"><span>Critical</span><strong>{abuseAnalytics?.totals.criticalSignals ?? 0}</strong></div>
              <div className="metric-card watch"><span>High risk</span><strong>{abuseAnalytics?.totals.highSignals ?? 0}</strong></div>
              <div className="metric-card"><span>Monitored escrows</span><strong>{abuseAnalytics?.totals.monitoredEscrows ?? 0}</strong></div>
              <div className="metric-card watch"><span>Active actions</span><strong>{abuseAnalytics?.totals.activeActions ?? 0}</strong></div>
              <div className="metric-card watch"><span>Suggestions</span><strong>{abuseAnalytics?.totals.suggestedActions ?? 0}</strong></div>
            </div>
            <div className="section-head ops-subhead">
              <h2>Suggested Actions</h2>
              <span>{abuseAnalytics?.suggestedActions?.length ?? 0}</span>
            </div>
            <div className="event-grid">
              {abuseAnalytics?.suggestedActions?.map((item) => (
                <div key={`${item.subjectType}:${item.subjectId}:${item.suggestedAction}`} className={`event-row ops-event ${item.suggestedAction === "block" ? "error" : "warning"}`}>
                  <div>
                    <strong>{item.suggestedAction} · {compactId(item.subjectId, 34)}</strong>
                    <span>{item.confidence}% confidence · {item.reason}</span>
                  </div>
                  <button className="button small" onClick={() => recordAbuseAction(item.subjectType, item.subjectId, item.suggestedAction)}>Apply</button>
                </div>
              ))}
              {!abuseAnalytics?.suggestedActions?.length && <p className="muted">No reputation action suggestions</p>}
            </div>
            <div className="section-head ops-subhead">
              <h2>Reputation Watchlist</h2>
              <span>{abuseAnalytics?.reputationWatchlist.length ?? 0}</span>
            </div>
            <div className="event-grid">
              {abuseAnalytics?.reputationWatchlist.map((item) => (
                <div key={`${item.subjectType}:${item.subjectId}`} className={`event-row ops-event ${item.maxRiskScore >= 90 ? "error" : "warning"}`}>
                  <div>
                    <strong>{item.subjectId} · score {item.maxRiskScore}</strong>
                    <span>{item.signals} signals · {item.reasons.slice(0, 2).join("; ")}</span>
                  </div>
                  <button className="button small" onClick={() => recordAbuseAction("user", item.subjectId, "watch")}>Watch</button>
                  <button className="button small" onClick={() => recordAbuseAction("user", item.subjectId, "block")}>Block</button>
                  <time>{formatTime(item.lastSeenAt)}</time>
                </div>
              ))}
              {!abuseAnalytics?.reputationWatchlist.length && <p className="muted">No reputation watch records</p>}
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Velocity Dashboard</h2>
              <span>{abuseAnalytics?.velocityWatchlist.length ?? 0} users</span>
            </div>
            <div className="event-grid">
              {abuseAnalytics?.velocityWatchlist.map((item) => (
                <div key={item.buyerUserId} className="event-row ops-event warning">
                  <div>
                    <strong>{compactId(item.buyerUserId, 18)}</strong>
                    <span>{item.escrows} escrows · {item.active} active · {item.disputed} disputed · {item.reviewRequired} review</span>
                  </div>
                  <time>{formatTime(item.latestAt)}</time>
                </div>
              ))}
              {!abuseAnalytics?.velocityWatchlist.length && <p className="muted">No velocity outliers</p>}
            </div>
            <div className="section-head ops-subhead">
              <h2>Cross-Device Graph</h2>
              <span>{abuseAnalytics?.fingerprintWatchlist.length ?? 0}</span>
            </div>
            <div className="event-grid">
              {abuseAnalytics?.fingerprintWatchlist.map((item) => (
                <div key={item.fingerprint} className={`event-row ops-event ${item.maxRiskScore >= 90 ? "error" : "warning"}`}>
                  <div>
                    <strong>{compactId(item.fingerprint, 34)}</strong>
                    <span>{item.signals} signals · score {item.maxRiskScore} · {item.subjects.length} subjects</span>
                  </div>
                  <time>{formatTime(item.lastSeenAt)}</time>
                </div>
              ))}
              {!abuseAnalytics?.fingerprintWatchlist.length && <p className="muted">No repeated device/account fingerprints</p>}
            </div>
            <div className="section-head ops-subhead">
              <h2>Recent Signals</h2>
              <span>{abuseAnalytics?.actions.length ?? 0} actions</span>
            </div>
            <div className="event-grid">
              {abuseAnalytics?.actions.slice(0, 8).map((action) => (
                <div key={action.actionId} className={`event-row ops-event ${action.action === "block" ? "error" : "warning"}`}>
                  <div>
                    <strong>{action.action} · {action.subjectId}</strong>
                    <span>{action.reason} · by {action.createdBy}</span>
                  </div>
                  <time>{formatTime(action.createdAt)}</time>
                </div>
              ))}
              {!abuseAnalytics?.actions.length && <p className="muted">No persistent abuse actions</p>}
            </div>
          </aside>
        </section>
      )}

      {activeTab === "audit" && (
        <section className="content-grid">
          <div className="surface">
            <div className="section-head">
              <h2>Escrow Event Explorer</h2>
              <span>{timeline?.escrowId || "select escrow"}</span>
            </div>
            <label className="field compact-field">
              <span>Escrow ID</span>
              <input value={timelineEscrowId} onChange={(event) => setTimelineEscrowId(event.target.value)} placeholder="SIV-..." autoComplete="off" />
            </label>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await loadEscrowTimeline(timelineEscrowId || selectedEscrow?.escrowId || "");
                } catch (err: any) {
                  setError(err.message || "Timeline load failed");
                }
              }}
            >
              Load timeline
            </button>
            <div className="timeline-list">
              {timeline?.events.map((event) => (
                <div key={event.eventId} className="timeline-item">
                  <div className="timeline-dot" />
                  <div className="event-row">
                    <div>
                      <strong>{event.eventType}</strong>
                      <span>{event.previousStatus || "-"} → {event.nextStatus || "-"} · {event.actorRole} · {event.channel}</span>
                      <span>{event.reason || event.actor}</span>
                    </div>
                    <time>{formatTime(event.createdAt)}</time>
                  </div>
                </div>
              ))}
              {timeline && timeline.events.length === 0 && <p className="muted">No events recorded for this escrow</p>}
              {!timeline && <p className="muted">Load an escrow to inspect payment, release, dispute, and operator action history.</p>}
            </div>
          </div>

          <aside className="surface detail-surface">
            <div className="section-head">
              <h2>Linked Records</h2>
              <span>{timeline?.transactions.length || 0} payments</span>
            </div>
            <div className="event-grid">
              {timeline?.transactions.map((transaction) => (
                <div key={transaction.transactionId} className={`event-row ops-event ${statusTone(transaction.status) === "critical" ? "error" : "warning"}`}>
                  <div>
                    <strong>{transaction.transactionType} · {transaction.status}</strong>
                    <span>{transaction.provider} · {transaction.reference || "no reference"}</span>
                    <span>{money.format(transaction.amount)} {transaction.currency}</span>
                  </div>
                  <time>{formatTime(transaction.updatedAt || transaction.createdAt)}</time>
                </div>
              ))}
              {timeline?.supportCases.map((supportCase) => (
                <div key={supportCase.caseId} className="event-row ops-event warning">
                  <div>
                    <strong>{supportCase.subject}</strong>
                    <span>{supportCase.status} · {supportCase.priority} · assigned {supportCase.assignedTo || "unassigned"}</span>
                  </div>
                  <time>{formatTime(supportCase.updatedAt)}</time>
                </div>
              ))}
              {timeline && timeline.transactions.length === 0 && timeline.supportCases.length === 0 && <p className="muted">No linked transactions or support cases</p>}
            </div>
          </aside>
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
              <div className={`metric-card ${disasterRecoveryStatus?.status === "ok" ? "good" : "watch"}`}>
                <span>Backup / DR</span>
                <strong>{disasterRecoveryStatus?.status || "unknown"}</strong>
              </div>
            </div>
            <div className="detail-stack">
              <div className="detail-row"><span>Provider</span><strong>{operationsStatus?.database.provider || "unknown"}</strong></div>
              <div className="detail-row"><span>DB latency</span><strong>{operationsStatus?.database.latencyMs ?? "-"} ms</strong></div>
              <div className="detail-row"><span>Settings version</span><strong>{operationsStatus?.database.settingsVersion || "-"}</strong></div>
              <div className="detail-row"><span>Recent warnings</span><strong>{operationsStatus?.operations.recentWarnings ?? 0}</strong></div>
            </div>
            <div className="section-head ops-subhead">
              <h2>WhatsApp Provider</h2>
              <span>{whatsappProviderStatus?.activeProvider || "unknown"}</span>
            </div>
            <div className="detail-stack">
              <div className="detail-row"><span>Active outbound</span><strong>{whatsappProviderStatus?.activeProvider || "unknown"}</strong></div>
              <div className="detail-row"><span>Twilio</span><strong>{whatsappProviderStatus?.providers?.twilio?.configured ? "Configured" : "Not configured"}</strong></div>
              <div className="detail-row"><span>Meta Cloud API</span><strong>{whatsappProviderStatus?.providers?.meta?.configured ? "Configured" : "Not configured"}</strong></div>
              <div className="detail-row"><span>Meta Graph</span><strong>{whatsappProviderStatus?.providers?.meta?.graphApiVersion || "not set"}</strong></div>
              {whatsappProviderStatus?.warning ? <div className="detail-note critical-note">{whatsappProviderStatus.warning}</div> : null}
              <div className="toolbar-row">
                <button
                  className="button secondary"
                  disabled={actionBusy || !whatsappProviderStatus?.providers?.twilio?.configured || whatsappProviderStatus?.activeProvider === "twilio"}
                  onClick={async () => {
                    try {
                      await switchWhatsAppProvider("twilio");
                    } catch (err: any) {
                      setError(err.message || "WhatsApp provider switch failed");
                    }
                  }}
                >
                  Use Twilio
                </button>
                <button
                  className="button secondary"
                  disabled={actionBusy || !whatsappProviderStatus?.providers?.meta?.configured || whatsappProviderStatus?.activeProvider === "meta"}
                  onClick={async () => {
                    try {
                      await switchWhatsAppProvider("meta");
                    } catch (err: any) {
                      setError(err.message || "WhatsApp provider switch failed");
                    }
                  }}
                >
                  Use Meta
                </button>
              </div>
              <div className="detail-note">Runtime switching changes the current bot process. Update Render env `WHATSAPP_PROVIDER` for the permanent deploy default.</div>
            </div>
            <div className="section-head ops-subhead">
              <h2>Backup and Recovery</h2>
              <span>{disasterRecoveryStatus?.backup.provider || "not configured"}</span>
            </div>
            <div className="detail-stack">
              <div className="detail-row"><span>Database backups</span><strong>{disasterRecoveryStatus?.backup.configured ? "Configured" : "Needs setup"}</strong></div>
              <div className="detail-row"><span>Retention</span><strong>{disasterRecoveryStatus?.backup.retentionDays ?? 0} days</strong></div>
              <div className="detail-row"><span>Restore drill</span><strong>{disasterRecoveryStatus?.restore.fresh ? "Fresh" : disasterRecoveryStatus?.restore.lastStatus || "not recorded"}</strong></div>
              <div className="detail-row"><span>Last restore test</span><strong>{formatTime(disasterRecoveryStatus?.restore.lastTestAt || undefined)}</strong></div>
              <div className="detail-row"><span>Rollback plan</span><strong>{disasterRecoveryStatus?.rollback.configured ? "Configured" : "Needs setup"}</strong></div>
              <div className="detail-row"><span>Outage procedure</span><strong>{disasterRecoveryStatus?.outage.configured ? "Configured" : "Needs contacts"}</strong></div>
              {disasterRecoveryStatus?.status !== "ok" ? <div className="detail-note critical-note">Run `npm run dr:check` after deploys and record restore-test proof in release notes.</div> : null}
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
