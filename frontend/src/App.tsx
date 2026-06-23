import { useEffect, useMemo, useState } from "react";
import {
  TaskRecord,
  WebhookEvent,
  EscrowRecord,
  ReconciliationRow,
  ReconciliationSummary,
  RevenueAnalytics,
  FeeSettings,
  AuditRecord,
  OperationalEvent,
  OperationsStatus,
  WhatsAppProviderStatus,
  PaymentProviderStatus,
  DisasterRecoveryStatus,
  SettlementProof,
  ToastNotice,
  PayoutApprovalQuote,
  PayoutApprovalState,
  QueueStatus,
  QueueJob,
  AbuseSignal,
  AbuseAnalytics,
  SupportCase,
  SupportNote,
  EscrowLimitReview,
  EscrowTimeline,
  DisputeRow,
  AuthSessionRecord,
  AuthStats,
  AuthIdentity,
  AuthAuditEvent,
  Tab,
  EscrowFilter,
} from "./types";

import {
  money,
  calculateSellerNet,
  compactId,
  statusTone,
  formatTime,
} from "./utils";

import { Toast } from "./components/Toast";
import { EscrowsTab } from "./components/EscrowsTab";
import { LimitReviewsTab } from "./components/LimitReviewsTab";
import { DisputesTab } from "./components/DisputesTab";
import { SupportTab } from "./components/SupportTab";
import { PayoutTab } from "./components/PayoutTab";
import { RevenueTab } from "./components/RevenueTab";
import { RiskTab } from "./components/RiskTab";
import { AuditTab } from "./components/AuditTab";
import { OpsTab } from "./components/OpsTab";
import { TasksTab } from "./components/TasksTab";
import { WebhooksTab } from "./components/WebhooksTab";
import { FeesTab } from "./components/FeesTab";
import { AuthTab } from "./components/AuthTab";

const apiBase = (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000";
const storedAdminKey = "sivan.adminToken";
const storedAdminUsername = "sivan.adminUsername";
const adminAuthBase = (import.meta as any).env.VITE_ADMIN_AUTH_BASE_URL || "http://localhost:3600";

function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(storedAdminKey) || "");
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminUsernameInput, setAdminUsernameInput] = useState(() => sessionStorage.getItem(storedAdminUsername) || "");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [escrows, setEscrows] = useState<EscrowRecord[]>([]);
  const [reconciliationRows, setReconciliationRows] = useState<ReconciliationRow[]>([]);
  const [reconciliationSummary, setReconciliationSummary] = useState<ReconciliationSummary>({
    paymentsNeedingReview: 0,
    releasesAwaitingPayout: 0,
    releasedMissingPayoutReference: 0,
    paystackAmountMismatches: 0,
  });
  const [revenueAnalytics, setRevenueAnalytics] = useState<RevenueAnalytics | null>(null);
  const [revenuePeriod, setRevenuePeriod] = useState<"day" | "week" | "month" | "all">("month");
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [auditHistory, setAuditHistory] = useState<AuditRecord[]>([]);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatus | null>(null);
  const [paymentProviderStatus, setPaymentProviderStatus] = useState<PaymentProviderStatus | null>(null);
  const [paymentProviderForm, setPaymentProviderForm] = useState({
    activePaymentProvider: "paystack",
    backupPaymentProvider: "monnify",
    emergencyPaymentProvider: "flutterwave",
    paymentProviderFallbackEnabled: false,
  });
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
  const [limitReviews, setLimitReviews] = useState<EscrowLimitReview[]>([]);
  const [selectedLimitReview, setSelectedLimitReview] = useState<EscrowLimitReview | null>(null);
  const [limitReviewNotes, setLimitReviewNotes] = useState("");
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
    nairaNewUserLimit: 100000,
    nairaTrustedUserLimit: 250000,
    nairaEstablishedUserLimit: 500000,
    nairaSpecialApprovalLimit: 1000000,
    nairaBuyerActiveExposureLimit: 500000,
    nairaPlatformActiveExposureLimit: 10000000,
    trustedUserSuccessfulEscrows: 3,
    establishedUserSuccessfulEscrows: 10,
    platformMode: "test" as "test" | "live" | "maintenance",
    maintenanceMessage: "Sivan is temporarily under maintenance. Please try again soon.",
    nairaPaymentMethod: "bank_transfer" as const,
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
  const [payoutApproval, setPayoutApproval] = useState<PayoutApprovalState | null>(null);
  const [savingFees, setSavingFees] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [authSessions, setAuthSessions] = useState<AuthSessionRecord[]>([]);
  const [authStats, setAuthStats] = useState<AuthStats | null>(null);
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);
  const [authAuditEvents, setAuthAuditEvents] = useState<AuthAuditEvent[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [whatsappProviderStatus, setWhatsappProviderStatus] = useState<WhatsAppProviderStatus | null>(null);
  const [toast, setToast] = useState<ToastNotice | null>(null);

  const authHeaders = () => {
    const headers: any = { "Content-Type": "application/json" };
    if (adminKey) {
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

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isTransientFetchError = (err: unknown) => {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err || "").toLowerCase();
    return message.includes("failed to fetch")
      || message.includes("networkerror")
      || message.includes("connection")
      || message.includes("load failed");
  };

  const adminFetch = async (url: string, init?: RequestInit, attempts = 3): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetch(url, init);
      } catch (err) {
        lastError = err;
        if (attempt >= attempts || !isTransientFetchError(err)) break;
        await sleep(350 * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Network request failed");
  };

  const runLoadStep = async (label: string, loader: () => Promise<void>) => {
    try {
      await loader();
    } catch (err: any) {
      throw new Error(`${label}: ${err.message || "load failed"}`);
    }
  };

  const clearAdminKey = () => {
    sessionStorage.removeItem(storedAdminKey);
    setAdminKey("");
    setTasks([]);
    setEscrows([]);
    setWebhooks([]);
    setFeeSettings(null);
    setRevenueAnalytics(null);
    setAuditHistory([]);
    setAuthSessions([]);
    setAuthStats(null);
    setAuthIdentity(null);
    setAuthAuditEvents([]);
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
    const adminUsername = adminUsernameInput.trim();
    if (!adminUsername) {
      setError("Admin username is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${adminAuthBase}/auth/request-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-request-secret": (import.meta as any).env.VITE_ADMIN_REQUEST_SECRET || "",
        },
        body: JSON.stringify({ adminUsername }),
      });
      if (!resp.ok) throw new Error(await parseError(resp, "Failed to request session"));
      sessionStorage.setItem(storedAdminUsername, adminUsername);
      setToast({
        tone: "success",
        title: "Login code sent",
        message: "Check Telegram, then enter the one-time code below.",
      });
    } catch (err: any) {
      setError(err.message || "Failed to request token");
    } finally {
      setLoading(false);
    }
  };

  const verifyTelegramToken = async () => {
    const adminUsername = adminUsernameInput.trim();
    const token = adminKeyInput.trim();
    if (!adminUsername) {
      setError("Admin username is required.");
      return;
    }
    if (!token) {
      setError("Telegram token is required.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${adminAuthBase}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminUsername, token }),
      });
      if (!resp.ok) throw new Error(await parseError(resp, "Invalid token"));
      const body = await resp.json();
      sessionStorage.setItem(storedAdminKey, body.accessToken);
      sessionStorage.setItem(storedAdminUsername, adminUsername);
      setAdminKey(body.accessToken);
      setAdminKeyInput("");
      setError(null);
    } catch (err: any) {
      setError(err.message || "Token verification failed");
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

      const identityResponse = await fetch(`${adminAuthBase}/auth/me`, {
        headers: authHeaders(),
      });
      if (identityResponse.ok) {
        setAuthIdentity(await identityResponse.json());
      } else {
        setAuthIdentity(null);
      }

      const auditResponse = await fetch(`${adminAuthBase}/admin/auth-audit?limit=25`, {
        headers: authHeaders(),
      });
      if (auditResponse.ok) {
        const payload = await auditResponse.json();
        setAuthAuditEvents(payload.events || []);
      } else {
        setAuthAuditEvents([]);
      }
    } catch (err: any) {
      setAuthError(err.message || "Unable to load auth activity");
      setAuthSessions([]);
      setAuthStats(null);
      setAuthIdentity(null);
      setAuthAuditEvents([]);
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
    const response = await adminFetch(`${apiBase}/admin/tasks`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load tasks"));
    setTasks((await response.json()) || []);
  };

  const loadEscrows = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/escrows?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load escrows"));
    setEscrows((await response.json()) || []);
  };

  const loadReconciliation = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/reconciliation?limit=250`, { headers: authHeaders() });
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

  const loadRevenue = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/revenue`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load revenue analytics"));
    setRevenueAnalytics(await response.json());
  };

  const loadWebhooks = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/webhooks?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load webhooks"));
    setWebhooks((await response.json()) || []);
  };

  const loadDisputes = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/disputes?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load disputes"));
    const rows = (await response.json()) || [];
    setDisputes(rows);
    if (selectedDispute) {
      setSelectedDispute(rows.find((row: DisputeRow) => row.escrow.escrowId === selectedDispute.escrow.escrowId) || null);
    }
  };

  const loadFeeSettings = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/settings`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load fee settings"));
    const data = await response.json();
    setFeeSettings(data);
    setFeeFormData({
      nairaFeePercent: data.nairaFeePercent,
      nairaFeeFixed: data.nairaFeeFixed,
      usdcFeePercent: data.usdcFeePercent,
      usdcFeeFixed: data.usdcFeeFixed,
      nairaNewUserLimit: data.nairaNewUserLimit,
      nairaTrustedUserLimit: data.nairaTrustedUserLimit,
      nairaEstablishedUserLimit: data.nairaEstablishedUserLimit,
      nairaSpecialApprovalLimit: data.nairaSpecialApprovalLimit,
      nairaBuyerActiveExposureLimit: data.nairaBuyerActiveExposureLimit,
      nairaPlatformActiveExposureLimit: data.nairaPlatformActiveExposureLimit,
      trustedUserSuccessfulEscrows: data.trustedUserSuccessfulEscrows,
      establishedUserSuccessfulEscrows: data.establishedUserSuccessfulEscrows,
      platformMode: data.platformMode || "test",
      maintenanceMessage: data.maintenanceMessage || "Sivan is temporarily under maintenance. Please try again soon.",
      nairaPaymentMethod: "bank_transfer",
    });
  };

  const loadPaymentProviders = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/payment-providers`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load payment provider settings"));
    const data = await response.json();
    setPaymentProviderStatus(data);
    setPaymentProviderForm({
      activePaymentProvider: data.activePaymentProvider,
      backupPaymentProvider: data.backupPaymentProvider,
      emergencyPaymentProvider: data.emergencyPaymentProvider,
      paymentProviderFallbackEnabled: Boolean(data.paymentProviderFallbackEnabled),
    });
  };

  const loadLimitReviews = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/escrow-limit-reviews?limit=100`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load escrow limit reviews"));
    const rows = (await response.json()) || [];
    setLimitReviews(rows);
    if (selectedLimitReview) {
      setSelectedLimitReview(rows.find((row: EscrowLimitReview) => row.reviewId === selectedLimitReview.reviewId) || null);
    }
  };

  const loadAuditHistory = async () => {
    if (!adminKey) return;
    const response = await adminFetch(`${apiBase}/admin/audit-history?limit=20`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await parseError(response, "Failed to load audit history"));
    setAuditHistory((await response.json()) || []);
  };

  const loadOperations = async () => {
    if (!adminKey) return;
    const headers = authHeaders();
    const statusResponse = await adminFetch(`${apiBase}/admin/ops/status`, { headers });
    const drResponse = await adminFetch(`${apiBase}/admin/dr/status`, { headers });
    const eventsResponse = await adminFetch(`${apiBase}/admin/ops/events?limit=50`, { headers });
    const settlementResponse = await adminFetch(`${apiBase}/admin/settlement/verification`, { headers });
    const queueResponse = await adminFetch(`${apiBase}/admin/queue/status`, { headers });
    const queueJobsResponse = await adminFetch(`${apiBase}/admin/queue/jobs?limit=50`, { headers });
    const abuseResponse = await adminFetch(`${apiBase}/admin/abuse/signals?limit=100`, { headers });
    const abuseAnalyticsResponse = await adminFetch(`${apiBase}/admin/abuse/analytics?limit=250`, { headers });
    const supportResponse = await adminFetch(`${apiBase}/admin/support/cases?limit=100`, { headers });
    const whatsappProviderResponse = await adminFetch(`${apiBase}/admin/whatsapp-provider`, { headers });
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
      await runLoadStep("Platform controls", loadFeeSettings);
      await runLoadStep("Payment providers", loadPaymentProviders);
      await runLoadStep("Escrows", loadEscrows);
      await runLoadStep("Limit reviews", loadLimitReviews);
      await runLoadStep("Reconciliation", loadReconciliation);
      await runLoadStep("Revenue", loadRevenue);
      await runLoadStep("Disputes", loadDisputes);
      await runLoadStep("Tasks", loadTasks);
      await runLoadStep("Webhooks", loadWebhooks);
      await runLoadStep("Audit history", loadAuditHistory);
      await runLoadStep("Operations", loadOperations);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || "Refresh failed");
    } finally {
      setLoading(false);
    }
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
      if (!(feeFormData.nairaNewUserLimit <= feeFormData.nairaTrustedUserLimit
        && feeFormData.nairaTrustedUserLimit <= feeFormData.nairaEstablishedUserLimit
        && feeFormData.nairaEstablishedUserLimit <= feeFormData.nairaSpecialApprovalLimit)) {
        throw new Error("Naira limits must increase from new user through special approval.");
      }
      if (feeFormData.nairaBuyerActiveExposureLimit <= 0 || feeFormData.nairaPlatformActiveExposureLimit <= 0) {
        throw new Error("Active exposure limits must be greater than zero.");
      }
      if (feeFormData.trustedUserSuccessfulEscrows < 1
        || feeFormData.establishedUserSuccessfulEscrows <= feeFormData.trustedUserSuccessfulEscrows) {
        throw new Error("Established-user threshold must be greater than trusted-user threshold.");
      }
      if (feeFormData.maintenanceMessage.trim().length < 10) {
        throw new Error("Maintenance message must explain what users should expect.");
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
      setFeeSuccess("Platform controls updated.");
      setShowConfirmModal(false);
      await loadAuditHistory();
      setTimeout(() => setFeeSuccess(null), 3000);
    } catch (err: any) {
      setFeeError(err.message || "Failed to save fees");
    } finally {
      setSavingFees(false);
    }
  };

  const handleSavePaymentProviders = async () => {
    setSavingFees(true);
    setFeeError(null);
    setFeeSuccess(null);
    try {
      const response = await fetch(`${apiBase}/admin/payment-providers`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...paymentProviderForm,
          expectedVersion: paymentProviderStatus?.version || feeSettings?.version || 1,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response, "Failed to save payment providers"));
      const updated = await response.json();
      setPaymentProviderStatus(updated);
      setPaymentProviderForm({
        activePaymentProvider: updated.activePaymentProvider,
        backupPaymentProvider: updated.backupPaymentProvider,
        emergencyPaymentProvider: updated.emergencyPaymentProvider,
        paymentProviderFallbackEnabled: Boolean(updated.paymentProviderFallbackEnabled),
      });
      setFeeSuccess("Payment provider controls updated.");
      await Promise.all([loadFeeSettings(), loadAuditHistory()]);
      setTimeout(() => setFeeSuccess(null), 3000);
    } catch (err: any) {
      setFeeError(err.message || "Failed to save payment providers");
    } finally {
      setSavingFees(false);
    }
  };

  const openPayoutApproval = (escrow: EscrowRecord, quote: PayoutApprovalQuote) => {
    setPayoutApproval({
      escrow,
      quote,
      manualPayoutReference: "",
      payoutNotes: "",
      submitting: false,
    });
  };

  const submitPayoutApproval = async () => {
    if (!payoutApproval) return;
    const manualPayoutReference = payoutApproval.manualPayoutReference.trim();
    if (manualPayoutReference.length < 4) {
      setPayoutApproval((current) => current ? {
        ...current,
        error: "Enter the payout or bank transfer reference before approving release.",
      } : current);
      return;
    }

    setPayoutApproval((current) => current ? { ...current, error: undefined, submitting: true } : current);
    try {
      const response = await fetch(`${apiBase}/admin/escrows/${payoutApproval.escrow.escrowId}/approve-release`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          manualPayoutReference,
          payoutNotes: payoutApproval.payoutNotes.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(await parseError(response, "Failed to approve release"));
      await loadEscrows();
      await loadReconciliation();
      setToast({
        tone: "success",
        title: "Payout release recorded",
        message: `${payoutApproval.escrow.escrowId} was released with payout reference ${manualPayoutReference}.`,
      });
      setPayoutApproval(null);
    } catch (err: any) {
      setPayoutApproval((current) => current ? {
        ...current,
        error: err.message || "Failed to approve release",
        submitting: false,
      } : current);
    }
  };

  const decideLimitReview = async (decision: "approve" | "reject") => {
    if (!selectedLimitReview || !limitReviewNotes.trim()) return;
    setActionBusy(true);
    try {
      const response = await fetch(`${apiBase}/admin/escrow-limit-reviews/${selectedLimitReview.reviewId}/${decision}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ notes: limitReviewNotes.trim() }),
      });
      if (!response.ok) throw new Error(await parseError(response, `Failed to ${decision} escrow limit review`));
      setLimitReviewNotes("");
      await Promise.all([loadLimitReviews(), loadEscrows(), loadReconciliation()]);
    } finally {
      setActionBusy(false);
    }
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

  const selectedPayoutQuote = useMemo(() => {
    if (!selectedEscrow) return null;
    const row = reconciliationByEscrow.get(selectedEscrow.escrowId);
    if (row) {
      return {
        grossAmount: row.grossAmount ?? row.expectedAmount,
        platformFeeAmount: row.platformFeeAmount ?? 0,
        sellerNetAmount: row.sellerNetAmount ?? row.expectedAmount,
        amountSource: row.amountSource ?? "reconciliation_row",
        currency: row.currency,
      };
    }
    const derived = calculateSellerNet(selectedEscrow.amount, selectedEscrow.currency, feeSettings);
    return {
      grossAmount: selectedEscrow.amount,
      platformFeeAmount: derived.platformFeeAmount,
      sellerNetAmount: derived.sellerNetAmount,
      amountSource: "escrow_record" as const,
      currency: selectedEscrow.currency,
    };
  }, [selectedEscrow, reconciliationByEscrow, feeSettings]);

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

  useEffect(() => {
    if (!toast) return;
    const dismiss = () => setToast(null);
    const timeout = window.setTimeout(dismiss, 6000);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toast]);

  if (!adminKey) {
    return (
      <main className="auth-screen">
        {toast && <Toast notice={toast} onDismiss={() => setToast(null)} />}
        <section className="auth-card">
          <div className="brand-mark">SE</div>
          <h1>Sivan Escrow Admin</h1>
          <p className="muted">Secure operations console</p>
          {error && <div className="error-banner">{error}</div>}
          <label className="field">
            <span>Admin username</span>
            <input
              type="text"
              value={adminUsernameInput}
              onChange={(event) => setAdminUsernameInput(event.target.value)}
              autoComplete="username"
              placeholder="solia admin"
            />
          </label>
          <div style={{ marginBottom: 12 }}>
            <button
              className="button primary full"
              onClick={requestTelegramToken}
              disabled={loading}
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
                  await verifyTelegramToken();
                }
              }}
              autoComplete="off"
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button primary full" onClick={verifyTelegramToken} disabled={loading}>Verify</button>
            <button className="button" onClick={() => { setAdminKeyInput(''); setError(null); }}>Clear</button>
          </div>
          <div className="endpoint-chip">{apiBase}</div>
        </section>
      </main>
    );
  }

  const navGroups = [
    {
      label: "Core Ledger",
      items: [
        { id: "escrows", label: "Escrows" },
        { id: "limitReviews", label: "Limit Reviews" },
        { id: "disputes", label: "Disputes" },
        { id: "payout", label: "Payout Safety" },
      ] as const,
    },
    {
      label: "Analytics & Risk",
      items: [
        { id: "revenue", label: "Revenue" },
        { id: "risk", label: "Risk" },
        { id: "audit", label: "Audit" },
      ] as const,
    },
    {
      label: "Monitoring & Support",
      items: [
        { id: "ops", label: "Ops" },
        { id: "support", label: "Support" },
        { id: "tasks", label: "Tasks" },
        { id: "webhooks", label: "Webhooks" },
      ] as const,
    },
    {
      label: "Settings",
      items: [
        { id: "fees", label: "Controls" },
        { id: "auth", label: "Admin Auth" },
      ] as const,
    },
  ];

  return (
    <div className="admin-layout">
      {toast && <Toast notice={toast} onDismiss={() => setToast(null)} />}
      
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">SE</div>
          <div>
            <h2>Sivan Console</h2>
            <small>Escrow operations</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item ${activeTab === item.id ? "active" : ""}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  {getTabIcon(item.id)}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="button secondary full small" onClick={clearAdminKey}>
            Lock Session
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div>
            <span className="eyebrow">Sivan Escrow Agent</span>
            <h1>{
              activeTab === "escrows" ? "Escrows Ledger" :
              activeTab === "limitReviews" ? "Limit Reviews" :
              activeTab === "disputes" ? "Dispute Resolution" :
              activeTab === "support" ? "Support Operations" :
              activeTab === "payout" ? "Payout Safety Queue" :
              activeTab === "revenue" ? "Revenue & Analytics" :
              activeTab === "risk" ? "Risk Analysis" :
              activeTab === "audit" ? "Audit History" :
              activeTab === "ops" ? "System Operations" :
              activeTab === "tasks" ? "Background Tasks" :
              activeTab === "webhooks" ? "Webhook Monitoring" :
              activeTab === "fees" ? "Platform Controls" :
              "Admin Access"
            }</h1>
          </div>
          <div className="top-bar-actions">
            <span className="health-pill">Backend connected</span>
            <button className="button secondary small" onClick={clearAdminKey}>Lock</button>
          </div>
        </header>

        <section className="command-strip" style={{ marginBottom: 24 }}>
          <div className="strip-item">
            <span>API Endpoint</span>
            <strong>{apiBase.replace(/^https?:\/\//, "")}</strong>
          </div>
          <div className="strip-item">
            <span>Refresh Frequency</span>
            <strong>{autoRefresh ? "5s Auto" : "Manual"}</strong>
          </div>
          <div className="strip-item">
            <span>Last Synced</span>
            <strong>{lastUpdated || "Pending"}</strong>
          </div>
          <div className="strip-actions">
            <button className="button primary small" onClick={refreshAll} disabled={loading}>
              {loading ? "Syncing..." : "Sync Now"}
            </button>
            <label className="toggle">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              <span>Auto-sync</span>
            </label>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        <section className="metrics-grid">
          <div className="metric-card">
            <span>Active Escrows</span>
            <strong>{metrics.active}</strong>
          </div>
          <div className="metric-card watch">
            <span>Pending Escrows</span>
            <strong>{metrics.pending}</strong>
          </div>
          <div className="metric-card good">
            <span>Resolved/Settled</span>
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

        {activeTab === "escrows" && (
          <EscrowsTab
            filteredEscrows={filteredEscrows}
            escrows={escrows}
            escrowFilter={escrowFilter}
            setEscrowFilter={setEscrowFilter}
            downloadReconciliationCsv={downloadReconciliationCsv}
            setError={setError}
            selectedEscrow={selectedEscrow}
            setSelectedEscrow={setSelectedEscrow}
            selectedPayoutQuote={selectedPayoutQuote}
            recheckEscrowPayment={recheckEscrowPayment}
            loadEscrowTimeline={loadEscrowTimeline}
            enqueuePayoutReview={enqueuePayoutReview}
            openPayoutApproval={openPayoutApproval}
            disputeEscrow={disputeEscrow}
          />
        )}

        {activeTab === "tasks" && (
          <TasksTab
            tasks={tasks}
            selectedTask={selectedTask}
            setSelectedTask={setSelectedTask}
          />
        )}

        {activeTab === "webhooks" && (
          <WebhooksTab webhooks={webhooks} />
        )}

        {activeTab === "limitReviews" && (
          <LimitReviewsTab
            limitReviews={limitReviews}
            selectedLimitReview={selectedLimitReview}
            setSelectedLimitReview={setSelectedLimitReview}
            limitReviewNotes={limitReviewNotes}
            setLimitReviewNotes={setLimitReviewNotes}
            actionBusy={actionBusy}
            decideLimitReview={decideLimitReview}
          />
        )}

        {activeTab === "disputes" && (
          <DisputesTab
            disputes={disputes}
            selectedDispute={selectedDispute}
            setSelectedDispute={setSelectedDispute}
            setSelectedEscrow={setSelectedEscrow}
            setTimelineEscrowId={setTimelineEscrowId}
            evidenceDraft={evidenceDraft}
            setEvidenceDraft={setEvidenceDraft}
            resolutionDraft={resolutionDraft}
            setResolutionDraft={setResolutionDraft}
            actionBusy={actionBusy}
            setActionBusy={setActionBusy}
            recordDisputeEvidence={recordDisputeEvidence}
            resolveDispute={resolveDispute}
            loadEscrowTimeline={loadEscrowTimeline}
            setError={setError}
          />
        )}

        {activeTab === "support" && (
          <SupportTab
            filteredSupportCases={filteredSupportCases}
            supportCases={supportCases}
            supportSearch={supportSearch}
            setSupportSearch={setSupportSearch}
            selectedSupportCase={selectedSupportCase}
            selectSupportCase={selectSupportCase}
            supportNotes={supportNotes}
            supportNoteDraft={supportNoteDraft}
            setSupportNoteDraft={setSupportNoteDraft}
            updateSupportCase={updateSupportCase}
            addSupportNote={addSupportNote}
            loadEscrowTimeline={loadEscrowTimeline}
            setError={setError}
          />
        )}

        {activeTab === "payout" && (
          <PayoutTab
            payoutSafetyRows={payoutSafetyRows}
            reconciliationSummary={reconciliationSummary}
            queueJobs={queueJobs}
            escrows={escrows}
            actionBusy={actionBusy}
            setActionBusy={setActionBusy}
            enqueuePayoutReview={enqueuePayoutReview}
            openPayoutApproval={openPayoutApproval}
            runQueueWorker={runQueueWorker}
            retryQueueJob={retryQueueJob}
            setError={setError}
          />
        )}

        {activeTab === "risk" && (
          <RiskTab
            abuseAnalytics={abuseAnalytics}
            recordAbuseAction={recordAbuseAction}
          />
        )}

        {activeTab === "audit" && (
          <AuditTab
            timeline={timeline}
            timelineEscrowId={timelineEscrowId}
            setTimelineEscrowId={setTimelineEscrowId}
            selectedEscrow={selectedEscrow}
            loadEscrowTimeline={loadEscrowTimeline}
            setError={setError}
          />
        )}

        {activeTab === "ops" && (
          <OpsTab
            operationsStatus={operationsStatus}
            queueStatus={queueStatus}
            abuseSignals={abuseSignals}
            supportCases={supportCases}
            disasterRecoveryStatus={disasterRecoveryStatus}
            whatsappProviderStatus={whatsappProviderStatus}
            actionBusy={actionBusy}
            switchWhatsAppProvider={switchWhatsAppProvider}
            settlementProof={settlementProof}
            runSettlementVerification={runSettlementVerification}
            operationalEvents={operationalEvents}
            setError={setError}
          />
        )}

        {activeTab === "revenue" && (
          <RevenueTab
            revenueAnalytics={revenueAnalytics}
            revenuePeriod={revenuePeriod}
            setRevenuePeriod={setRevenuePeriod}
          />
        )}

        {activeTab === "fees" && (
          <FeesTab
            feeSettings={feeSettings}
            feeError={feeError}
            feeSuccess={feeSuccess}
            feeFormData={feeFormData}
            setFeeFormData={setFeeFormData}
            savingFees={savingFees}
            setShowConfirmModal={setShowConfirmModal}
            paymentProviderStatus={paymentProviderStatus}
            paymentProviderForm={paymentProviderForm}
            setPaymentProviderForm={setPaymentProviderForm}
            handleSavePaymentProviders={handleSavePaymentProviders}
            auditHistory={auditHistory}
          />
        )}

        {activeTab === "auth" && (
          <AuthTab
            adminKey={adminKey}
            isJwtToken={isJwtToken}
            decodeJwtPayload={decodeJwtPayload}
            authIdentity={authIdentity}
            requestTelegramToken={requestTelegramToken}
            clearAdminKey={clearAdminKey}
            authError={authError}
            authLoading={authLoading}
            loadAuthServiceInfo={loadAuthServiceInfo}
            authStats={authStats}
            authAuditEvents={authAuditEvents}
            authSessions={authSessions}
            revokeAuthSession={revokeAuthSession}
            adminAuthBase={adminAuthBase}
          />
        )}

        {showConfirmModal && (
          <div className="modal-overlay">
            <div className="modal">
              <h2>Confirm Platform Update</h2>
              <p className="muted">Platform controls take effect immediately for new customer actions.</p>
              <div className="modal-summary">
                <div><span>Naira</span><strong>{feeFormData.nairaFeePercent}% + {feeFormData.nairaFeeFixed} NGN</strong></div>
                <div><span>USDC</span><strong>{feeFormData.usdcFeePercent}% + {feeFormData.usdcFeeFixed} USDC</strong></div>
                <div><span>Mode</span><strong>{feeFormData.platformMode}</strong></div>
                <div><span>Naira method</span><strong>{feeFormData.nairaPaymentMethod}</strong></div>
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

        {payoutApproval && (
          <div
            className="modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !payoutApproval.submitting) {
                setPayoutApproval(null);
              }
            }}
          >
            <div
              className="modal payout-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="payout-approval-title"
            >
              <div className="payout-modal-head">
                <div>
                  <span className="eyebrow">Manual Payout Approval</span>
                  <h2 id="payout-approval-title">Record seller payout</h2>
                  <p className="muted">Confirm the bank transfer reference after paying the seller. The payout amount is locked to the escrow record.</p>
                </div>
                <span className={`status ${statusTone(payoutApproval.escrow.status)}`}>{payoutApproval.escrow.status}</span>
              </div>

              <div className="payout-amount-band" aria-label="Seller net payout">
                <span>Seller net payout</span>
                <strong>{money.format(payoutApproval.quote.sellerNetAmount)} {payoutApproval.quote.currency}</strong>
                <small>Amount source: {payoutApproval.quote.amountSource || "escrow_record"}</small>
              </div>

              <div className="modal-summary payout-summary">
                <div><span>Escrow</span><strong>{payoutApproval.escrow.escrowId}</strong></div>
                <div><span>Escrow amount</span><strong>{money.format(payoutApproval.quote.grossAmount ?? payoutApproval.escrow.amount)} {payoutApproval.quote.currency}</strong></div>
                <div><span>Sivan fee paid by buyer</span><strong>{money.format(payoutApproval.quote.platformFeeAmount ?? 0)} {payoutApproval.quote.currency}</strong></div>
                <div><span>Buyer total funded</span><strong>{money.format(((payoutApproval.quote.grossAmount ?? payoutApproval.escrow.amount) + (payoutApproval.quote.platformFeeAmount ?? 0)))} {payoutApproval.quote.currency}</strong></div>
                <div><span>Seller</span><strong>{payoutApproval.escrow.sellerWhatsapp || payoutApproval.escrow.sellerUserId || "pending"}</strong></div>
              </div>

              <div className="payout-safety-note">
                <strong>Safety check</strong>
                <span>Enter only the Paystack, bank transfer, or provider payout reference. Do not enter or edit a payout amount.</span>
              </div>

              <label className="field">
                <span>Payout reference</span>
                <input
                  type="text"
                  value={payoutApproval.manualPayoutReference}
                  onChange={(event) => setPayoutApproval((current) => current ? {
                    ...current,
                    manualPayoutReference: event.target.value,
                    error: undefined,
                  } : current)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitPayoutApproval();
                    }
                    if (event.key === "Escape" && !payoutApproval.submitting) {
                      setPayoutApproval(null);
                    }
                  }}
                  autoComplete="off"
                  autoFocus
                  placeholder="e.g. TRF-20260611-001"
                />
              </label>

              <label className="field">
                <span>Notes optional</span>
                <textarea
                  rows={3}
                  value={payoutApproval.payoutNotes}
                  onChange={(event) => setPayoutApproval((current) => current ? {
                    ...current,
                    payoutNotes: event.target.value,
                  } : current)}
                  placeholder="Add operator context, if needed"
                />
              </label>

              {payoutApproval.error && <div className="modal-error" role="alert">{payoutApproval.error}</div>}

              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setPayoutApproval(null)} disabled={payoutApproval.submitting}>Cancel</button>
                <button className="button primary" type="button" onClick={submitPayoutApproval} disabled={payoutApproval.submitting}>
                  {payoutApproval.submitting ? "Recording" : "Record payout"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function getTabIcon(tab: Tab) {
  switch (tab) {
    case "escrows":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M16 10.5a2.5 2.5 0 0 0 0 5h5v-5z" />
          <path d="M12 8v8" />
        </svg>
      );
    case "limitReviews":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10h12" />
          <path d="M4 14h9" />
          <circle cx="19" cy="10" r="3" />
          <circle cx="16" cy="18" r="3" />
        </svg>
      );
    case "disputes":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "payout":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 11 2 2 4-4" />
        </svg>
      );
    case "revenue":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case "risk":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "audit":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "ops":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "support":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "tasks":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "webhooks":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      );
    case "fees":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "auth":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
  }
}

export default App;
