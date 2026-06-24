export type TaskRecord = {
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

export type WebhookEvent = {
  eventId: string;
  paymentReference: string;
  eventType: string;
  receivedAt: string;
};

export type EscrowRecord = {
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
  fundingExpiresAt?: string;
  activePaymentExpiresAt?: string;
  paymentRegenerationCount?: number;
  lastPaymentReminderAt?: string;
  expiredPaymentReferences?: string[];
  receivedAmount?: number;
  providerPaymentStatus?: string;
  paymentCheckedAt?: string;
  reconciliationFlags?: string[];
  releaseRequestedAt?: string;
  deliveredAt?: string;
  inspectionExpiresAt?: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
  releasedBy?: string;
  releasedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ReconciliationRow = {
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
  complianceRiskScore?: number | null;
  complianceRiskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  complianceRiskReasons?: string[];
  reconciliationRiskLevel?: "LOW" | "MEDIUM" | "HIGH";
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  paymentCheckedAt?: string | null;
};

export type ReconciliationSummary = {
  paymentsNeedingReview: number;
  releasesAwaitingPayout: number;
  releasedMissingPayoutReference: number;
  paystackAmountMismatches: number;
};

export type RevenueCurrencySnapshot = {
  currency: "NAIRA" | "USDC";
  processedVolume: number;
  processedCount: number;
  platformFees: number;
  platformFeeCount: number;
  processorFees: number;
  processorFeeKnownCount: number;
  processorTransactionCount: number;
  processorFeeCoveragePercent: number;
  netRevenueAfterProcessorFees: number;
};

export type RevenueAnalytics = {
  generatedAt: string;
  accountingBasis: {
    processedVolume: string;
    platformFees: string;
    processorFees: string;
    testActivity: string;
  };
  excludedTestActivity: {
    transactionCount: number;
    processedVolumeByCurrency: Array<{ currency: "NAIRA" | "USDC"; amount: number }>;
  };
  periods: Array<{
    key: "day" | "week" | "month" | "all";
    label: string;
    currencies: RevenueCurrencySnapshot[];
  }>;
  processorBreakdown: Array<{
    provider: string;
    currency: "NAIRA" | "USDC";
    processedVolume: number;
    transactionCount: number;
    processorFees: number;
    processorFeeKnownCount: number;
  }>;
  settlementSummary?: Array<{
    provider: string;
    settlementCount: number;
    settlementAmount: number;
    providerFees: number;
    latestSettlementAt: string;
  }>;
};

export type FeeSettings = {
  nairaFeePercent: number;
  nairaFeeFixed: number;
  usdcFeePercent: number;
  usdcFeeFixed: number;
  nairaNewUserLimit: number;
  nairaTrustedUserLimit: number;
  nairaEstablishedUserLimit: number;
  nairaSpecialApprovalLimit: number;
  nairaBuyerActiveExposureLimit: number;
  nairaPlatformActiveExposureLimit: number;
  trustedUserSuccessfulEscrows: number;
  establishedUserSuccessfulEscrows: number;
  platformMode: "test" | "live" | "maintenance";
  maintenanceMessage: string;
  nairaPaymentMethod: "bank_transfer";
  version: number;
  updatedAt: string;
  updatedBy: string;
};

export type AuditRecord = {
  id: string;
  settingName: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  changedAt: string;
};

export type OperationalEvent = {
  id: string;
  level: "warning" | "error";
  message: string;
  context: Record<string, unknown>;
  error?: string;
  createdAt: string;
};

export type OperationsStatus = {
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

export type WhatsAppProviderStatus = {
  activeProvider: "twilio" | "meta" | "unknown";
  configured?: boolean;
  warning?: string;
  providers: {
    twilio?: { configured: boolean };
    meta?: { configured: boolean; graphApiVersion?: string };
  };
};

export type PaymentProviderStatus = {
  activePaymentProvider: string;
  backupPaymentProvider: string;
  emergencyPaymentProvider: string;
  paymentProviderFallbackEnabled: boolean;
  platformMode: "test" | "live" | "maintenance";
  maintenanceMessage: string;
  nairaPaymentMethod: "bank_transfer";
  version: number;
  fallbackPolicy?: string;
  providers: Array<{
    provider: string;
    label: string;
    implemented: boolean;
    configured: boolean;
    methods: string[];
  }>;
};

export type DisasterRecoveryStatus = {
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

export type SettlementProof = {
  status: string;
  checkedAt?: string;
  sap?: { status?: string; toolsDiscovered?: number; latencyMs?: number; error?: string };
  x402?: { status?: string; mode?: string; paymentStatus?: string; transactionHash?: string; error?: string };
  warnings?: string[];
  proofFile?: string;
};

export type ToastNotice = {
  tone: "success" | "error";
  title: string;
  message: string;
};

export type PayoutApprovalQuote = {
  grossAmount?: number;
  platformFeeAmount?: number;
  sellerNetAmount: number;
  amountSource?: "escrow_record" | string;
  currency: "NAIRA" | "USDC";
};

export type PayoutApprovalState = {
  escrow: EscrowRecord;
  quote: PayoutApprovalQuote;
  manualPayoutReference: string;
  payoutNotes: string;
  error?: string;
  submitting: boolean;
};

export type QueueStatus = {
  status: string;
  queued: number;
  running: number;
  failed: number;
  dead: number;
  succeeded: number;
};

export type QueueJob = {
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

export type AbuseSignal = {
  signalId: string;
  subjectType: string;
  subjectId: string;
  category: string;
  severity: string;
  riskScore: number;
  reason: string;
  createdAt: string;
};

export type AbuseAnalytics = {
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

export type SupportCase = {
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

export type SupportNote = {
  noteId: string;
  caseId: string;
  author: string;
  body: string;
  actionType?: string;
  createdAt: string;
};

export type EscrowLimitReview = {
  reviewId: string;
  clientRequestId?: string;
  buyerUserId: string;
  buyerWhatsapp: string;
  sellerWhatsapp?: string;
  amount: number;
  currency: "NAIRA" | "USDC";
  purpose: string;
  reasonCode: string;
  policy: {
    tier?: string;
    successfulEscrows?: number;
    tierLimit?: number;
    buyerActiveExposure?: number;
    platformActiveExposure?: number;
    buyerActiveExposureLimit?: number;
    platformActiveExposureLimit?: number;
  };
  status: "pending" | "processing" | "approved" | "rejected";
  decisionNotes?: string;
  decidedBy?: string;
  decidedAt?: string;
  approvedEscrowId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EscrowTimeline = {
  escrowId: string;
  events: Array<{ eventId: string; eventType: string; actor: string; actorRole: string; channel: string; previousStatus?: string; nextStatus?: string; reason?: string; metadata?: string; createdAt: string }>;
  transactions: Array<{ transactionId: string; provider: string; transactionType: string; status: string; reference?: string; amount: number; currency: string; createdAt: string; updatedAt: string }>;
  supportCases: SupportCase[];
};

export type DisputeRow = {
  escrow: EscrowRecord;
  openedAt: string;
  evidenceCount: number;
  latestEventAt: string;
  supportCases: SupportCase[];
  transactions: Array<{ transactionId: string; provider: string; transactionType: string; status: string; reference?: string; amount: number; currency: string; createdAt: string; updatedAt: string }>;
  events: EscrowTimeline["events"];
};

export type AuthSessionRecord = {
  sessionId: string;
  adminIdentifier: string;
  createdAt: string;
  expiresAt?: string;
  ip?: string;
  status?: string;
};

export type AuthStats = {
  period?: string;
  total_requests?: number;
  successful_verifications?: number;
  failed_verifications?: number;
  telegram_errors?: number;
  unique_admins?: number;
  unique_ips?: number;
  timestamp?: string;
};

export type AuthIdentity = {
  adminUsername?: string;
  adminIdentifier?: string;
  expiresAt?: string;
  issuedAt?: string;
};

export type AuthAuditEvent = {
  eventId: string;
  eventType: string;
  adminUsername?: string;
  status: string;
  reason?: string;
  ip?: string;
  createdAt: string;
};

export type Tab = "escrows" | "limitReviews" | "disputes" | "support" | "payout" | "revenue" | "risk" | "audit" | "ops" | "tasks" | "webhooks" | "fees" | "auth";
export type EscrowFilter = "all" | "review" | "pendingRelease" | "released" | "missingPayout" | "amountMismatch";
