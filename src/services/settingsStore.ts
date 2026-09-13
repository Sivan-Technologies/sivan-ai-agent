import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { warn } from "../lib/logger";

export interface PlatformSettings {
  id?: string;
  nairaFeePercent: number;
  nairaFeeFixed: number;
  usdcFeePercent: number;
  usdcFeeFixed: number;
  minNairaAmount: number;
  maxNairaAmount: number;
  minUsdcAmount: number;
  maxUsdcAmount: number;
  nairaNewUserLimit: number;
  nairaTrustedUserLimit: number;
  nairaEstablishedUserLimit: number;
  nairaSpecialApprovalLimit: number;
  nairaBuyerActiveExposureLimit: number;
  nairaPlatformActiveExposureLimit: number;
  trustedUserSuccessfulEscrows: number;
  establishedUserSuccessfulEscrows: number;
  activePaymentProvider: string;
  backupPaymentProvider: string;
  emergencyPaymentProvider: string;
  paymentProviderFallbackEnabled: boolean;
  platformMode: "test" | "live" | "maintenance";
  maintenanceMessage: string;
  nairaPaymentMethod: "bank_transfer";
  nairaFeeModel: "simple" | "tiered";
  nairaFeeTiers: string;
  nairaFundingWindowHours: number;
  nairaHighValueFundingWindowHours: number;
  nairaHighValueFundingWindowAmount: number;
  nairaFundingReminderBeforeExpiryHours: number;
  payoutSharedAccountReviewCount: number;
  complianceNewSellerEscrowCount: number;
  complianceHighDisputeRatio: number;
  complianceHighDisputeMinEscrows: number;
  nairaHighValueReviewAmount: number;
  usdcHighValueReviewAmount: number;
  paymentLifecycleWorkerEnabled: boolean;
  paymentLifecycleWorkerIntervalMs: number;
  reconciliationWorkerEnabled: boolean;
  queueWorkerEnabled: boolean;
  stuckEscrowAlertMinutes: number;
  autoReleaseEnabled: boolean;
  deliveryInspectionWindowDays: number;
  outageStatusPageUrl: string;
  outageContacts: string;
  cryptoNetwork: "solana" | "avalanche" | "ethereum" | "arbitrum" | "base" | "celo" | "stellar" | "bsc";
  networkMode: "devnet" | "mainnet";
  usdtEnabled: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface AuditHistoryRecord {
  id: string;
  settingName: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  changedAt: string;
}

export interface FeeCalculation {
  subtotal: number;
  platformFeePercent: number;
  platformFeeFixed: number;
  totalPlatformFee: number;
  totalWithFee: number;
  recipientNet: number;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  id: "default",
  nairaFeePercent: 1.5,
  nairaFeeFixed: 100,
  usdcFeePercent: 1.0,
  usdcFeeFixed: 0.5,
  minNairaAmount: 2000,
  maxNairaAmount: 5000000,
  minUsdcAmount: 5,
  maxUsdcAmount: 50000,
  nairaNewUserLimit: 100000,
  nairaTrustedUserLimit: 250000,
  nairaEstablishedUserLimit: 500000,
  nairaSpecialApprovalLimit: 1000000,
  nairaBuyerActiveExposureLimit: 500000,
  nairaPlatformActiveExposureLimit: 10000000,
  trustedUserSuccessfulEscrows: 3,
  establishedUserSuccessfulEscrows: 10,
  activePaymentProvider: process.env.ACTIVE_PAYMENT_PROVIDER || "paystack",
  backupPaymentProvider: process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
  emergencyPaymentProvider: process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
  paymentProviderFallbackEnabled: true,
  platformMode: "live",
  maintenanceMessage: "Sivan is currently undergoing brief scheduled maintenance. Please try again shortly.",
  nairaPaymentMethod: "bank_transfer",
  nairaFeeModel: "simple",
  nairaFeeTiers: "[]",
  nairaFundingWindowHours: 24,
  nairaHighValueFundingWindowHours: 12,
  nairaHighValueFundingWindowAmount: 1000000,
  nairaFundingReminderBeforeExpiryHours: 2,
  payoutSharedAccountReviewCount: 3,
  complianceNewSellerEscrowCount: 3,
  complianceHighDisputeRatio: 0.25,
  complianceHighDisputeMinEscrows: 5,
  nairaHighValueReviewAmount: 1000000,
  usdcHighValueReviewAmount: 5000,
  paymentLifecycleWorkerEnabled: true,
  paymentLifecycleWorkerIntervalMs: 60000,
  reconciliationWorkerEnabled: true,
  queueWorkerEnabled: true,
  stuckEscrowAlertMinutes: 120,
  autoReleaseEnabled: true,
  deliveryInspectionWindowDays: 3,
  outageStatusPageUrl: "https://status.sivantech.online",
  outageContacts: "support@sivantech.online",
  cryptoNetwork: "solana",
  networkMode: (process.env.NETWORK_MODE as any) === "mainnet" ? "mainnet" : "devnet",
  usdtEnabled: true,
  version: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: "system_default",
};

type StoreProvider = "sqlite" | "postgres";

function detectProvider(databaseUrl: string, provider?: string): StoreProvider {
  if (provider === "postgres" || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return "postgres";
  }
  return "sqlite";
}

export class SettingsStore {
  private provider: StoreProvider;
  private sqlite?: Database.Database;
  private pool?: Pool;
  private initialized = false;
  private cachedSettings: PlatformSettings | null = null;
  private cacheExpiresAt = 0;

  constructor(private databaseUrl: string, provider = process.env.DATABASE_PROVIDER) {
    this.provider = detectProvider(databaseUrl, provider);
    if (this.provider === "sqlite") {
      const folder = path.dirname(databaseUrl);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
      this.sqlite = new Database(databaseUrl);
      this.initializeSchemaSync();
      this.initialized = true;
    } else {
      this.pool = new Pool({
        connectionString: databaseUrl,
        max: Number(process.env.POSTGRES_POOL_MAX || "5"),
        connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "15000"),
        query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || "20000"),
        ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
      });
    }
  }

  private mapSettingsRow(row: any): PlatformSettings {
    if (!row) throw new Error("Platform settings not found");
    return {
      id: row.id,
      nairaFeePercent: Number(row.naira_fee_percent),
      nairaFeeFixed: Number(row.naira_fee_fixed),
      usdcFeePercent: Number(row.usdc_fee_percent),
      usdcFeeFixed: Number(row.usdc_fee_fixed),
      minNairaAmount: Number(row.min_naira_amount ?? 5000),
      maxNairaAmount: Number(row.max_naira_amount ?? 5000000),
      minUsdcAmount: Number(row.min_usdc_amount ?? 5),
      maxUsdcAmount: Number(row.max_usdc_amount ?? 5000),
      nairaNewUserLimit: Number(row.naira_new_user_limit ?? 100000),
      nairaTrustedUserLimit: Number(row.naira_trusted_user_limit ?? 250000),
      nairaEstablishedUserLimit: Number(row.naira_established_user_limit ?? 500000),
      nairaSpecialApprovalLimit: Number(row.naira_special_approval_limit ?? 1000000),
      nairaBuyerActiveExposureLimit: Number(row.naira_buyer_active_exposure_limit ?? 500000),
      nairaPlatformActiveExposureLimit: Number(row.naira_platform_active_exposure_limit ?? 10000000),
      trustedUserSuccessfulEscrows: Number(row.trusted_user_successful_escrows ?? 3),
      establishedUserSuccessfulEscrows: Number(row.established_user_successful_escrows ?? 10),
      activePaymentProvider: row.active_payment_provider || process.env.ACTIVE_PAYMENT_PROVIDER || "paystack",
      backupPaymentProvider: row.backup_payment_provider || process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
      emergencyPaymentProvider: row.emergency_payment_provider || process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
      paymentProviderFallbackEnabled: Boolean(row.payment_provider_fallback_enabled ?? (process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED === "true" ? 1 : 0)),
      platformMode: ["test", "live", "maintenance"].includes(row.platform_mode) ? row.platform_mode : (process.env.PLATFORM_MODE as any) || "test",
      maintenanceMessage: row.maintenance_message || process.env.MAINTENANCE_MESSAGE || "Sivan is temporarily under maintenance. Please try again soon.",
      nairaPaymentMethod: "bank_transfer",
      nairaFeeModel: ["simple", "tiered"].includes(row.naira_fee_model) ? row.naira_fee_model : "simple",
      nairaFeeTiers: row.naira_fee_tiers || JSON.stringify([
        { max: 10000, fee: 500 },
        { max: 20000, fee: 900 },
        { max: 25000, fee: 1000 },
        { max: 50000, rate: 3.75 },
        { max: 100000, rate: 3.5 },
        { max: null, rate: 3.5 }
      ]),
      nairaFundingWindowHours: Number(row.naira_funding_window_hours ?? 24),
      nairaHighValueFundingWindowHours: Number(row.naira_high_value_funding_window_hours ?? 48),
      nairaHighValueFundingWindowAmount: Number(row.naira_high_value_funding_window_amount ?? 100000),
      nairaFundingReminderBeforeExpiryHours: Number(row.naira_funding_reminder_before_expiry_hours ?? 6),
      payoutSharedAccountReviewCount: Number(row.payout_shared_account_review_count ?? 2),
      complianceNewSellerEscrowCount: Number(row.compliance_new_seller_escrow_count ?? 1),
      complianceHighDisputeRatio: Number(row.compliance_high_dispute_ratio ?? 0.3),
      complianceHighDisputeMinEscrows: Number(row.compliance_high_dispute_min_escrows ?? 3),
      nairaHighValueReviewAmount: Number(row.naira_high_value_review_amount ?? 500000),
      usdcHighValueReviewAmount: Number(row.usdc_high_value_review_amount ?? 2500),
      paymentLifecycleWorkerEnabled: Boolean(row.payment_lifecycle_worker_enabled ?? 0),
      paymentLifecycleWorkerIntervalMs: Number(row.payment_lifecycle_worker_interval_ms ?? 300000),
      reconciliationWorkerEnabled: Boolean(row.reconciliation_worker_enabled ?? 0),
      queueWorkerEnabled: Boolean(row.queue_worker_enabled ?? 0),
      stuckEscrowAlertMinutes: Number(row.stuck_escrow_alert_minutes ?? 1440),
      autoReleaseEnabled: Boolean(row.auto_release_enabled ?? 1),
      deliveryInspectionWindowDays: Number(row.delivery_inspection_window_days ?? 3),
      outageStatusPageUrl: row.outage_status_page_url || "",
      outageContacts: row.outage_contacts || "Telegram @Sivan_Ai",
      cryptoNetwork: ["solana", "avalanche", "ethereum", "arbitrum", "base", "celo", "stellar", "bsc"].includes(row.crypto_network) ? row.crypto_network : (process.env.CRYPTO_NETWORK as any) || "solana",
      networkMode: ["devnet", "mainnet"].includes(row.network_mode) ? row.network_mode : (process.env.NETWORK_MODE as any) || "devnet",
      usdtEnabled: Boolean(row.usdt_enabled ?? 0),
      version: Number(row.version),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  private mapAuditRow(row: any): AuditHistoryRecord {
    return {
      id: row.id,
      settingName: row.setting_name,
      oldValue: row.old_value || "",
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
    };
  }

  private initializeSchemaSync() {
    this.sqlite!.exec(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        naira_fee_percent REAL NOT NULL DEFAULT 2.5,
        naira_fee_fixed REAL NOT NULL DEFAULT 50,
        usdc_fee_percent REAL NOT NULL DEFAULT 1.5,
        usdc_fee_fixed REAL NOT NULL DEFAULT 0.5,
        naira_fee_model TEXT NOT NULL DEFAULT 'simple',
        naira_fee_tiers TEXT NOT NULL DEFAULT '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_history (
        id TEXT PRIMARY KEY,
        setting_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_history_changed_at ON audit_history(changed_at DESC);
    `);
    this.ensureRiskColumnsSync();

    this.initializeDefaultSettingsSync();
  }

  private ensureRiskColumnsSync() {
    const columns = [
      "min_naira_amount REAL NOT NULL DEFAULT 5000",
      "max_naira_amount REAL NOT NULL DEFAULT 5000000",
      "min_usdc_amount REAL NOT NULL DEFAULT 5",
      "max_usdc_amount REAL NOT NULL DEFAULT 5000",
      "naira_new_user_limit REAL NOT NULL DEFAULT 100000",
      "naira_trusted_user_limit REAL NOT NULL DEFAULT 250000",
      "naira_established_user_limit REAL NOT NULL DEFAULT 500000",
      "naira_special_approval_limit REAL NOT NULL DEFAULT 1000000",
      "naira_buyer_active_exposure_limit REAL NOT NULL DEFAULT 500000",
      "naira_platform_active_exposure_limit REAL NOT NULL DEFAULT 10000000",
      "trusted_user_successful_escrows INTEGER NOT NULL DEFAULT 3",
      "established_user_successful_escrows INTEGER NOT NULL DEFAULT 10",
      "active_payment_provider TEXT NOT NULL DEFAULT 'paystack'",
      "backup_payment_provider TEXT NOT NULL DEFAULT 'palmpay'",
      "emergency_payment_provider TEXT NOT NULL DEFAULT 'flutterwave'",
      "payment_provider_fallback_enabled INTEGER NOT NULL DEFAULT 0",
      "platform_mode TEXT NOT NULL DEFAULT 'test'",
      "maintenance_message TEXT NOT NULL DEFAULT 'Sivan is temporarily under maintenance. Please try again soon.'",
      "naira_payment_method TEXT NOT NULL DEFAULT 'bank_transfer'",
      "naira_fee_model TEXT NOT NULL DEFAULT 'simple'",
      "naira_fee_tiers TEXT NOT NULL DEFAULT '[{\"max\":10000,\"fee\":500},{\"max\":20000,\"fee\":900},{\"max\":25000,\"fee\":1000},{\"max\":50000,\"rate\":3.75},{\"max\":100000,\"rate\":3.5},{\"max\":null,\"rate\":3.5}]'",
      "naira_funding_window_hours INTEGER NOT NULL DEFAULT 24",
      "naira_high_value_funding_window_hours INTEGER NOT NULL DEFAULT 48",
      "naira_high_value_funding_window_amount REAL NOT NULL DEFAULT 100000",
      "naira_funding_reminder_before_expiry_hours INTEGER NOT NULL DEFAULT 6",
      "payout_shared_account_review_count INTEGER NOT NULL DEFAULT 2",
      "compliance_new_seller_escrow_count INTEGER NOT NULL DEFAULT 1",
      "compliance_high_dispute_ratio REAL NOT NULL DEFAULT 0.3",
      "compliance_high_dispute_min_escrows INTEGER NOT NULL DEFAULT 3",
      "naira_high_value_review_amount REAL NOT NULL DEFAULT 500000",
      "usdc_high_value_review_amount REAL NOT NULL DEFAULT 2500",
      "payment_lifecycle_worker_enabled INTEGER NOT NULL DEFAULT 0",
      "payment_lifecycle_worker_interval_ms INTEGER NOT NULL DEFAULT 300000",
      "reconciliation_worker_enabled INTEGER NOT NULL DEFAULT 0",
      "queue_worker_enabled INTEGER NOT NULL DEFAULT 0",
      "stuck_escrow_alert_minutes INTEGER NOT NULL DEFAULT 1440",
      "auto_release_enabled INTEGER NOT NULL DEFAULT 1",
      "delivery_inspection_window_days INTEGER NOT NULL DEFAULT 3",
      "outage_status_page_url TEXT NOT NULL DEFAULT ''",
      "outage_contacts TEXT NOT NULL DEFAULT 'Telegram @Sivan_Ai'",
      "crypto_network TEXT NOT NULL DEFAULT 'solana'",
      "network_mode TEXT NOT NULL DEFAULT 'devnet'",
      "usdt_enabled INTEGER NOT NULL DEFAULT 0",
    ];
    for (const column of columns) {
      try {
        this.sqlite!.exec(`ALTER TABLE platform_settings ADD COLUMN ${column}`);
      } catch (err: any) {
        if (!String(err.message).includes("duplicate column name")) throw err;
      }
    }
  }

  private initializeDefaultSettingsSync() {
    const existing = this.sqlite!.prepare("SELECT id FROM platform_settings LIMIT 1").get();
    if (!existing) {
      const now = new Date().toISOString();
      this.sqlite!.prepare(`
        INSERT INTO platform_settings (
          id, naira_fee_percent, naira_fee_fixed, usdc_fee_percent, usdc_fee_fixed,
          active_payment_provider, backup_payment_provider, emergency_payment_provider,
          payment_provider_fallback_enabled, platform_mode, maintenance_message,
          naira_payment_method, naira_fee_model, naira_fee_tiers,
          naira_funding_window_hours, naira_high_value_funding_window_hours,
          naira_high_value_funding_window_amount, naira_funding_reminder_before_expiry_hours,
          payout_shared_account_review_count, compliance_new_seller_escrow_count,
          compliance_high_dispute_ratio, compliance_high_dispute_min_escrows,
          naira_high_value_review_amount, usdc_high_value_review_amount,
          payment_lifecycle_worker_enabled, payment_lifecycle_worker_interval_ms,
          reconciliation_worker_enabled, queue_worker_enabled, stuck_escrow_alert_minutes,
          auto_release_enabled, delivery_inspection_window_days,
          outage_status_page_url, outage_contacts,
          version, updated_at, updated_by
        )
        VALUES (
          'default', 2.5, 50, 1.5, 0.5,
          @activePaymentProvider, @backupPaymentProvider, @emergencyPaymentProvider,
          @paymentProviderFallbackEnabled, @platformMode, @maintenanceMessage,
          'bank_transfer', 'simple', '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]',
          @nairaFundingWindowHours, @nairaHighValueFundingWindowHours,
          @nairaHighValueFundingWindowAmount, @nairaFundingReminderBeforeExpiryHours,
          @payoutSharedAccountReviewCount, @complianceNewSellerEscrowCount,
          @complianceHighDisputeRatio, @complianceHighDisputeMinEscrows,
          @nairaHighValueReviewAmount, @usdcHighValueReviewAmount,
          @paymentLifecycleWorkerEnabled, @paymentLifecycleWorkerIntervalMs,
          @reconciliationWorkerEnabled, @queueWorkerEnabled, @stuckEscrowAlertMinutes,
          1, 3,
          @outageStatusPageUrl, @outageContacts,
          1, @now, 'system'
        )
      `).run({
        now,
        activePaymentProvider: process.env.ACTIVE_PAYMENT_PROVIDER || "paystack",
        backupPaymentProvider: process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
        emergencyPaymentProvider: process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
        paymentProviderFallbackEnabled: process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED === "true" ? 1 : 0,
        platformMode: process.env.PLATFORM_MODE || "test",
        maintenanceMessage: process.env.MAINTENANCE_MESSAGE || "Sivan is temporarily under maintenance. Please try again soon.",
        nairaFundingWindowHours: Number(process.env.NAIRA_FUNDING_WINDOW_HOURS || 24),
        nairaHighValueFundingWindowHours: Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_HOURS || 48),
        nairaHighValueFundingWindowAmount: Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_AMOUNT || 100000),
        nairaFundingReminderBeforeExpiryHours: Number(process.env.NAIRA_FUNDING_REMINDER_BEFORE_EXPIRY_HOURS || 6),
        payoutSharedAccountReviewCount: Number(process.env.PAYOUT_SHARED_ACCOUNT_REVIEW_COUNT || 2),
        complianceNewSellerEscrowCount: Number(process.env.COMPLIANCE_NEW_SELLER_ESCROW_COUNT || 1),
        complianceHighDisputeRatio: Number(process.env.COMPLIANCE_HIGH_DISPUTE_RATIO || 0.3),
        complianceHighDisputeMinEscrows: Number(process.env.COMPLIANCE_HIGH_DISPUTE_MIN_ESCROWS || 3),
        nairaHighValueReviewAmount: Number(process.env.NAIRA_HIGH_VALUE_REVIEW_AMOUNT || 500000),
        usdcHighValueReviewAmount: Number(process.env.USDC_HIGH_VALUE_REVIEW_AMOUNT || 2500),
        paymentLifecycleWorkerEnabled: process.env.PAYMENT_LIFECYCLE_WORKER_ENABLED === "true" ? 1 : 0,
        paymentLifecycleWorkerIntervalMs: Number(process.env.PAYMENT_LIFECYCLE_WORKER_INTERVAL_MS || 300000),
        reconciliationWorkerEnabled: process.env.RECONCILIATION_WORKER_ENABLED === "true" ? 1 : 0,
        queueWorkerEnabled: process.env.QUEUE_WORKER_ENABLED === "true" ? 1 : 0,
        stuckEscrowAlertMinutes: Number(process.env.STUCK_ESCROW_ALERT_MINUTES || 1440),
        outageStatusPageUrl: process.env.OUTAGE_STATUS_PAGE_URL || "",
        outageContacts: process.env.OUTAGE_CONTACTS || "Telegram @Sivan_Ai",
      });
    }
  }

  public async initializeSchema(): Promise<void> {
    if (this.initialized) return;
    if (this.provider === "sqlite") {
      this.initializeSchemaSync();
      this.initialized = true;
      return;
    }

    await this.pool!.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        naira_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 2.5,
        naira_fee_fixed DOUBLE PRECISION NOT NULL DEFAULT 50,
        usdc_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 1.5,
        usdc_fee_fixed DOUBLE PRECISION NOT NULL DEFAULT 0.5,
        naira_fee_model TEXT NOT NULL DEFAULT 'simple',
        naira_fee_tiers TEXT NOT NULL DEFAULT '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_history (
        id TEXT PRIMARY KEY,
        setting_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_history_changed_at ON audit_history(changed_at DESC);
    `);
    await this.pool!.query(`
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_new_user_limit DOUBLE PRECISION NOT NULL DEFAULT 100000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_trusted_user_limit DOUBLE PRECISION NOT NULL DEFAULT 250000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_established_user_limit DOUBLE PRECISION NOT NULL DEFAULT 500000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_special_approval_limit DOUBLE PRECISION NOT NULL DEFAULT 1000000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_buyer_active_exposure_limit DOUBLE PRECISION NOT NULL DEFAULT 500000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_platform_active_exposure_limit DOUBLE PRECISION NOT NULL DEFAULT 10000000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS trusted_user_successful_escrows INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS established_user_successful_escrows INTEGER NOT NULL DEFAULT 10;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS min_naira_amount DOUBLE PRECISION NOT NULL DEFAULT 5000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS max_naira_amount DOUBLE PRECISION NOT NULL DEFAULT 5000000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS min_usdc_amount DOUBLE PRECISION NOT NULL DEFAULT 5;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS max_usdc_amount DOUBLE PRECISION NOT NULL DEFAULT 5000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS active_payment_provider TEXT NOT NULL DEFAULT 'paystack';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS backup_payment_provider TEXT NOT NULL DEFAULT 'palmpay';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS emergency_payment_provider TEXT NOT NULL DEFAULT 'flutterwave';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS payment_provider_fallback_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS platform_mode TEXT NOT NULL DEFAULT 'test';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS maintenance_message TEXT NOT NULL DEFAULT 'Sivan is temporarily under maintenance. Please try again soon.';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_payment_method TEXT NOT NULL DEFAULT 'bank_transfer';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_fee_model TEXT NOT NULL DEFAULT 'simple';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_fee_tiers TEXT NOT NULL DEFAULT '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_funding_window_hours INTEGER NOT NULL DEFAULT 24;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_high_value_funding_window_hours INTEGER NOT NULL DEFAULT 48;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_high_value_funding_window_amount DOUBLE PRECISION NOT NULL DEFAULT 100000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_funding_reminder_before_expiry_hours INTEGER NOT NULL DEFAULT 6;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS payout_shared_account_review_count INTEGER NOT NULL DEFAULT 2;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS compliance_new_seller_escrow_count INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS compliance_high_dispute_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.3;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS compliance_high_dispute_min_escrows INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS naira_high_value_review_amount DOUBLE PRECISION NOT NULL DEFAULT 500000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS usdc_high_value_review_amount DOUBLE PRECISION NOT NULL DEFAULT 2500;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS payment_lifecycle_worker_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS payment_lifecycle_worker_interval_ms INTEGER NOT NULL DEFAULT 300000;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS reconciliation_worker_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS queue_worker_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS stuck_escrow_alert_minutes INTEGER NOT NULL DEFAULT 1440;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS auto_release_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS delivery_inspection_window_days INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS outage_status_page_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS outage_contacts TEXT NOT NULL DEFAULT 'Telegram @Sivan_Ai';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS crypto_network TEXT NOT NULL DEFAULT 'solana';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS network_mode TEXT NOT NULL DEFAULT 'devnet';
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS usdt_enabled INTEGER NOT NULL DEFAULT 0;
    `);

    const existing = await this.pool!.query("SELECT id FROM platform_settings LIMIT 1");
    if (existing.rowCount === 0) {
      await this.pool!.query(
        `INSERT INTO platform_settings (
          id, naira_fee_percent, naira_fee_fixed, usdc_fee_percent, usdc_fee_fixed,
          active_payment_provider, backup_payment_provider, emergency_payment_provider,
          payment_provider_fallback_enabled, platform_mode, maintenance_message,
          naira_payment_method, naira_fee_model, naira_fee_tiers,
          naira_funding_window_hours, naira_high_value_funding_window_hours,
          naira_high_value_funding_window_amount, naira_funding_reminder_before_expiry_hours,
          payout_shared_account_review_count, compliance_new_seller_escrow_count,
          compliance_high_dispute_ratio, compliance_high_dispute_min_escrows,
          naira_high_value_review_amount, usdc_high_value_review_amount,
          payment_lifecycle_worker_enabled, payment_lifecycle_worker_interval_ms,
          reconciliation_worker_enabled, queue_worker_enabled, stuck_escrow_alert_minutes,
          auto_release_enabled, delivery_inspection_window_days,
          outage_status_page_url, outage_contacts,
          version, updated_at, updated_by
        )
         VALUES ('default', 2.5, 50, 1.5, 0.5, $1, $2, $3, $4, $5, $6, 'bank_transfer', 'simple', '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 1, 3, $22, $23, 1, $24, 'system')`,
        [
          process.env.ACTIVE_PAYMENT_PROVIDER || "paystack",
          process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
          process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
          process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED === "true" ? 1 : 0,
          process.env.PLATFORM_MODE || "test",
          process.env.MAINTENANCE_MESSAGE || "Sivan is temporarily under maintenance. Please try again soon.",
          Number(process.env.NAIRA_FUNDING_WINDOW_HOURS || 24),
          Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_HOURS || 48),
          Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_AMOUNT || 100000),
          Number(process.env.NAIRA_FUNDING_REMINDER_BEFORE_EXPIRY_HOURS || 6),
          Number(process.env.PAYOUT_SHARED_ACCOUNT_REVIEW_COUNT || 2),
          Number(process.env.COMPLIANCE_NEW_SELLER_ESCROW_COUNT || 1),
          Number(process.env.COMPLIANCE_HIGH_DISPUTE_RATIO || 0.3),
          Number(process.env.COMPLIANCE_HIGH_DISPUTE_MIN_ESCROWS || 3),
          Number(process.env.NAIRA_HIGH_VALUE_REVIEW_AMOUNT || 500000),
          Number(process.env.USDC_HIGH_VALUE_REVIEW_AMOUNT || 2500),
          process.env.PAYMENT_LIFECYCLE_WORKER_ENABLED === "true" ? 1 : 0,
          Number(process.env.PAYMENT_LIFECYCLE_WORKER_INTERVAL_MS || 300000),
          process.env.RECONCILIATION_WORKER_ENABLED === "true" ? 1 : 0,
          process.env.QUEUE_WORKER_ENABLED === "true" ? 1 : 0,
          Number(process.env.STUCK_ESCROW_ALERT_MINUTES || 1440),
          process.env.OUTAGE_STATUS_PAGE_URL || "",
          process.env.OUTAGE_CONTACTS || "Telegram @Sivan_Ai",
          new Date().toISOString(),
        ]
      );
    }
    this.initialized = true;
  }

  public async getSettings(): Promise<PlatformSettings> {
    const now = Date.now();
    if (this.cachedSettings && this.cacheExpiresAt > now) {
      return this.cachedSettings;
    }

    try {
      await this.initializeSchema();
      if (this.provider === "sqlite") {
        const settings = this.mapSettingsRow(this.sqlite!.prepare(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`).get());
        this.cachedSettings = settings;
        this.cacheExpiresAt = now + 30_000;
        return settings;
      }
      const result = await this.pool!.query(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`);
      const settings = this.mapSettingsRow(result.rows[0]);
      this.cachedSettings = settings;
      this.cacheExpiresAt = now + 30_000;
      return settings;
    } catch (err: any) {
      if (this.cachedSettings) {
        warn(`SettingsStore query failed; returning in-memory cached settings: ${err?.message || err}`);
        return this.cachedSettings;
      }
      warn(`SettingsStore query failed and no cache available; returning default platform settings: ${err?.message || err}`);
      const fallback = { ...DEFAULT_PLATFORM_SETTINGS, updatedAt: new Date().toISOString() };
      this.cachedSettings = fallback;
      this.cacheExpiresAt = now + 15_000;
      return fallback;
    }
  }

  public async updateSettings(settings: {
    nairaFeePercent: number;
    nairaFeeFixed: number;
    usdcFeePercent: number;
    usdcFeeFixed: number;
    minNairaAmount?: number;
    maxNairaAmount?: number;
    minUsdcAmount?: number;
    maxUsdcAmount?: number;
    nairaNewUserLimit?: number;
    nairaTrustedUserLimit?: number;
    nairaEstablishedUserLimit?: number;
    nairaSpecialApprovalLimit?: number;
    nairaBuyerActiveExposureLimit?: number;
    nairaPlatformActiveExposureLimit?: number;
    trustedUserSuccessfulEscrows?: number;
    establishedUserSuccessfulEscrows?: number;
    activePaymentProvider?: string;
    backupPaymentProvider?: string;
    emergencyPaymentProvider?: string;
    paymentProviderFallbackEnabled?: boolean;
    platformMode?: "test" | "live" | "maintenance";
    maintenanceMessage?: string;
    nairaPaymentMethod?: "bank_transfer";
    nairaFeeModel?: "simple" | "tiered";
    nairaFeeTiers?: string;
    nairaFundingWindowHours?: number;
    nairaHighValueFundingWindowHours?: number;
    nairaHighValueFundingWindowAmount?: number;
    nairaFundingReminderBeforeExpiryHours?: number;
    payoutSharedAccountReviewCount?: number;
    complianceNewSellerEscrowCount?: number;
    complianceHighDisputeRatio?: number;
    complianceHighDisputeMinEscrows?: number;
    nairaHighValueReviewAmount?: number;
    usdcHighValueReviewAmount?: number;
    paymentLifecycleWorkerEnabled?: boolean;
    paymentLifecycleWorkerIntervalMs?: number;
    reconciliationWorkerEnabled?: boolean;
    queueWorkerEnabled?: boolean;
    stuckEscrowAlertMinutes?: number;
    autoReleaseEnabled?: boolean;
    deliveryInspectionWindowDays?: number;
    outageStatusPageUrl?: string;
    outageContacts?: string;
    cryptoNetwork?: "solana" | "avalanche" | "ethereum" | "arbitrum" | "base" | "celo" | "stellar" | "bsc";
    networkMode?: "devnet" | "mainnet";
    usdtEnabled?: boolean;
    expectedVersion: number;
    updatedBy: string;
  }): Promise<PlatformSettings> {
    const current = await this.getSettings();
    const resolved: PlatformSettings & { expectedVersion: number; updatedBy: string } = {
      ...current,
      ...settings,
      minNairaAmount: settings.minNairaAmount ?? current.minNairaAmount,
      maxNairaAmount: settings.maxNairaAmount ?? current.maxNairaAmount,
      minUsdcAmount: settings.minUsdcAmount ?? current.minUsdcAmount,
      maxUsdcAmount: settings.maxUsdcAmount ?? current.maxUsdcAmount,
      cryptoNetwork: settings.cryptoNetwork ?? current.cryptoNetwork,
      networkMode: settings.networkMode ?? current.networkMode,
      usdtEnabled: settings.usdtEnabled ?? current.usdtEnabled,
      nairaNewUserLimit: settings.nairaNewUserLimit ?? current.nairaNewUserLimit,
      nairaTrustedUserLimit: settings.nairaTrustedUserLimit ?? current.nairaTrustedUserLimit,
      nairaEstablishedUserLimit: settings.nairaEstablishedUserLimit ?? current.nairaEstablishedUserLimit,
      nairaSpecialApprovalLimit: settings.nairaSpecialApprovalLimit ?? current.nairaSpecialApprovalLimit,
      nairaBuyerActiveExposureLimit: settings.nairaBuyerActiveExposureLimit ?? current.nairaBuyerActiveExposureLimit,
      nairaPlatformActiveExposureLimit: settings.nairaPlatformActiveExposureLimit ?? current.nairaPlatformActiveExposureLimit,
      trustedUserSuccessfulEscrows: settings.trustedUserSuccessfulEscrows ?? current.trustedUserSuccessfulEscrows,
      establishedUserSuccessfulEscrows: settings.establishedUserSuccessfulEscrows ?? current.establishedUserSuccessfulEscrows,
      activePaymentProvider: settings.activePaymentProvider ?? current.activePaymentProvider,
      backupPaymentProvider: settings.backupPaymentProvider ?? current.backupPaymentProvider,
      emergencyPaymentProvider: settings.emergencyPaymentProvider ?? current.emergencyPaymentProvider,
      paymentProviderFallbackEnabled: settings.paymentProviderFallbackEnabled ?? current.paymentProviderFallbackEnabled,
      platformMode: settings.platformMode ?? current.platformMode,
      maintenanceMessage: settings.maintenanceMessage ?? current.maintenanceMessage,
      nairaPaymentMethod: "bank_transfer",
      nairaFeeModel: settings.nairaFeeModel ?? current.nairaFeeModel,
      nairaFeeTiers: settings.nairaFeeTiers ?? current.nairaFeeTiers,
      nairaFundingWindowHours: settings.nairaFundingWindowHours ?? current.nairaFundingWindowHours,
      nairaHighValueFundingWindowHours: settings.nairaHighValueFundingWindowHours ?? current.nairaHighValueFundingWindowHours,
      nairaHighValueFundingWindowAmount: settings.nairaHighValueFundingWindowAmount ?? current.nairaHighValueFundingWindowAmount,
      nairaFundingReminderBeforeExpiryHours: settings.nairaFundingReminderBeforeExpiryHours ?? current.nairaFundingReminderBeforeExpiryHours,
      payoutSharedAccountReviewCount: settings.payoutSharedAccountReviewCount ?? current.payoutSharedAccountReviewCount,
      complianceNewSellerEscrowCount: settings.complianceNewSellerEscrowCount ?? current.complianceNewSellerEscrowCount,
      complianceHighDisputeRatio: settings.complianceHighDisputeRatio ?? current.complianceHighDisputeRatio,
      complianceHighDisputeMinEscrows: settings.complianceHighDisputeMinEscrows ?? current.complianceHighDisputeMinEscrows,
      nairaHighValueReviewAmount: settings.nairaHighValueReviewAmount ?? current.nairaHighValueReviewAmount,
      usdcHighValueReviewAmount: settings.usdcHighValueReviewAmount ?? current.usdcHighValueReviewAmount,
      paymentLifecycleWorkerEnabled: settings.paymentLifecycleWorkerEnabled ?? current.paymentLifecycleWorkerEnabled,
      paymentLifecycleWorkerIntervalMs: settings.paymentLifecycleWorkerIntervalMs ?? current.paymentLifecycleWorkerIntervalMs,
      reconciliationWorkerEnabled: settings.reconciliationWorkerEnabled ?? current.reconciliationWorkerEnabled,
      queueWorkerEnabled: settings.queueWorkerEnabled ?? current.queueWorkerEnabled,
      stuckEscrowAlertMinutes: settings.stuckEscrowAlertMinutes ?? current.stuckEscrowAlertMinutes,
      autoReleaseEnabled: settings.autoReleaseEnabled ?? current.autoReleaseEnabled,
      deliveryInspectionWindowDays: settings.deliveryInspectionWindowDays ?? current.deliveryInspectionWindowDays,
      outageStatusPageUrl: settings.outageStatusPageUrl ?? current.outageStatusPageUrl,
      outageContacts: settings.outageContacts ?? current.outageContacts,
    };
    if (resolved.nairaFeeModel !== "simple" && resolved.nairaFeeModel !== "tiered") {
      throw new Error("Naira fee model must be simple or tiered");
    }
    try {
      const parsed = JSON.parse(resolved.nairaFeeTiers);
      if (!Array.isArray(parsed)) throw new Error();
      for (const t of parsed) {
        if (t.max !== null && (typeof t.max !== "number" || t.max <= 0)) throw new Error();
        if (t.fee !== undefined && (typeof t.fee !== "number" || t.fee < 0)) throw new Error();
        if (t.rate !== undefined && (typeof t.rate !== "number" || t.rate < 0 || t.rate > 50)) throw new Error();
        if (t.fee === undefined && t.rate === undefined) throw new Error();
      }
    } catch {
      throw new Error("Naira fee tiers must be a valid JSON array of tier configurations");
    }
    if (resolved.nairaFeePercent < 0 || resolved.nairaFeePercent > 50) throw new Error("Naira fee percent must be between 0 and 50");
    if (resolved.nairaFeeFixed < 0) throw new Error("Naira fixed fee must be non-negative");
    if (resolved.usdcFeePercent < 0 || resolved.usdcFeePercent > 50) throw new Error("USDC fee percent must be between 0 and 50");
    if (resolved.usdcFeeFixed < 0) throw new Error("USDC fixed fee must be non-negative");
    if (resolved.deliveryInspectionWindowDays < 1 || resolved.deliveryInspectionWindowDays > 30) {
      throw new Error("Delivery inspection window must be between 1 and 30 days");
    }
    if (!(resolved.nairaNewUserLimit <= resolved.nairaTrustedUserLimit
      && resolved.nairaTrustedUserLimit <= resolved.nairaEstablishedUserLimit
      && resolved.nairaEstablishedUserLimit <= resolved.nairaSpecialApprovalLimit)) {
      throw new Error("Naira escrow limits must increase from new to trusted to established to special approval");
    }
    if (resolved.nairaNewUserLimit <= 0 || resolved.nairaPlatformActiveExposureLimit <= 0) throw new Error("Naira limits must be positive");
    if (resolved.trustedUserSuccessfulEscrows < 1 || resolved.establishedUserSuccessfulEscrows <= resolved.trustedUserSuccessfulEscrows) {
      throw new Error("Established-user successful escrow threshold must be greater than trusted-user threshold");
    }
    if (!["test", "live", "maintenance"].includes(resolved.platformMode)) {
      throw new Error("Platform mode must be test, live, or maintenance");
    }
    if (resolved.maintenanceMessage.trim().length < 10 || resolved.maintenanceMessage.length > 500) {
      throw new Error("Maintenance message must be between 10 and 500 characters");
    }
    if (resolved.nairaPaymentMethod !== "bank_transfer") {
      throw new Error("Sivan only supports bank-transfer Naira payments");
    }
    if (!["solana", "avalanche", "ethereum", "arbitrum", "base", "celo", "stellar", "bsc"].includes(resolved.cryptoNetwork)) {
      throw new Error("Crypto network must be solana, avalanche, ethereum, arbitrum, base, celo, stellar, or bsc");
    }
    if (!["devnet", "mainnet"].includes(resolved.networkMode)) {
      throw new Error("Network mode must be devnet or mainnet");
    }
    for (const [label, provider] of [
      ["active payment provider", resolved.activePaymentProvider],
      ["backup payment provider", resolved.backupPaymentProvider],
      ["emergency payment provider", resolved.emergencyPaymentProvider],
    ] as const) {
      if (!["paystack", "monnify", "palmpay", "flutterwave", "nomba"].includes(provider)) {
        throw new Error(`Unsupported ${label}: ${provider}`);
      }
    }

    const expectedVersion = resolved.expectedVersion;
    if (current.version !== expectedVersion) {
      throw new Error(`Settings version mismatch; current version is ${current.version}, expected ${expectedVersion}. Please refresh and try again.`);
    }

    const newVersion = expectedVersion + 1;
    const now = new Date().toISOString();
    let changes = 0;

    if (this.provider === "sqlite") {
      const result = this.sqlite!.prepare(`
        UPDATE platform_settings
        SET naira_fee_percent = @nairaFeePercent,
            naira_fee_fixed = @nairaFeeFixed,
            usdc_fee_percent = @usdcFeePercent,
            usdc_fee_fixed = @usdcFeeFixed,
            min_naira_amount = @minNairaAmount,
            max_naira_amount = @maxNairaAmount,
            min_usdc_amount = @minUsdcAmount,
            max_usdc_amount = @maxUsdcAmount,
            naira_new_user_limit = @nairaNewUserLimit,
            naira_trusted_user_limit = @nairaTrustedUserLimit,
            naira_established_user_limit = @nairaEstablishedUserLimit,
            naira_special_approval_limit = @nairaSpecialApprovalLimit,
            naira_buyer_active_exposure_limit = @nairaBuyerActiveExposureLimit,
            naira_platform_active_exposure_limit = @nairaPlatformActiveExposureLimit,
            trusted_user_successful_escrows = @trustedUserSuccessfulEscrows,
            established_user_successful_escrows = @establishedUserSuccessfulEscrows,
            active_payment_provider = @activePaymentProvider,
            backup_payment_provider = @backupPaymentProvider,
            emergency_payment_provider = @emergencyPaymentProvider,
            payment_provider_fallback_enabled = @paymentProviderFallbackEnabled,
            platform_mode = @platformMode,
            maintenance_message = @maintenanceMessage,
            naira_payment_method = @nairaPaymentMethod,
            naira_fee_model = @nairaFeeModel,
            naira_fee_tiers = @nairaFeeTiers,
            naira_funding_window_hours = @nairaFundingWindowHours,
            naira_high_value_funding_window_hours = @nairaHighValueFundingWindowHours,
            naira_high_value_funding_window_amount = @nairaHighValueFundingWindowAmount,
            naira_funding_reminder_before_expiry_hours = @nairaFundingReminderBeforeExpiryHours,
            payout_shared_account_review_count = @payoutSharedAccountReviewCount,
            compliance_new_seller_escrow_count = @complianceNewSellerEscrowCount,
            compliance_high_dispute_ratio = @complianceHighDisputeRatio,
            compliance_high_dispute_min_escrows = @complianceHighDisputeMinEscrows,
            naira_high_value_review_amount = @nairaHighValueReviewAmount,
            usdc_high_value_review_amount = @usdcHighValueReviewAmount,
            payment_lifecycle_worker_enabled = @paymentLifecycleWorkerEnabled,
            payment_lifecycle_worker_interval_ms = @paymentLifecycleWorkerIntervalMs,
            reconciliation_worker_enabled = @reconciliationWorkerEnabled,
            queue_worker_enabled = @queueWorkerEnabled,
            stuck_escrow_alert_minutes = @stuckEscrowAlertMinutes,
            auto_release_enabled = @autoReleaseEnabled,
            delivery_inspection_window_days = @deliveryInspectionWindowDays,
            outage_status_page_url = @outageStatusPageUrl,
            outage_contacts = @outageContacts,
            crypto_network = @cryptoNetwork,
            network_mode = @networkMode,
            usdt_enabled = @usdtEnabled,
            version = @newVersion,
            updated_at = @now,
            updated_by = @updatedBy
        WHERE id = 'default' AND version = @expectedVersion
      `).run({
        ...resolved,
        paymentProviderFallbackEnabled: resolved.paymentProviderFallbackEnabled ? 1 : 0,
        paymentLifecycleWorkerEnabled: resolved.paymentLifecycleWorkerEnabled ? 1 : 0,
        reconciliationWorkerEnabled: resolved.reconciliationWorkerEnabled ? 1 : 0,
        queueWorkerEnabled: resolved.queueWorkerEnabled ? 1 : 0,
        autoReleaseEnabled: resolved.autoReleaseEnabled ? 1 : 0,
        usdtEnabled: resolved.usdtEnabled ? 1 : 0,
        newVersion,
        now,
      });
      changes = result.changes;
    } else {
      const result = await this.pool!.query(
        `UPDATE platform_settings
         SET naira_fee_percent = $1,
             naira_fee_fixed = $2,
             usdc_fee_percent = $3,
             usdc_fee_fixed = $4,
             min_naira_amount = $5,
             max_naira_amount = $6,
             min_usdc_amount = $7,
             max_usdc_amount = $8,
             naira_new_user_limit = $9,
             naira_trusted_user_limit = $10,
             naira_established_user_limit = $11,
             naira_special_approval_limit = $12,
             naira_buyer_active_exposure_limit = $13,
             naira_platform_active_exposure_limit = $14,
             trusted_user_successful_escrows = $15,
             established_user_successful_escrows = $16,
             active_payment_provider = $17,
             backup_payment_provider = $18,
             emergency_payment_provider = $19,
             payment_provider_fallback_enabled = $20,
             platform_mode = $21,
             maintenance_message = $22,
             naira_payment_method = $23,
             naira_fee_model = $24,
             naira_fee_tiers = $25,
             naira_funding_window_hours = $26,
             naira_high_value_funding_window_hours = $27,
             naira_high_value_funding_window_amount = $28,
             naira_funding_reminder_before_expiry_hours = $29,
             payout_shared_account_review_count = $30,
             compliance_new_seller_escrow_count = $31,
             compliance_high_dispute_ratio = $32,
             compliance_high_dispute_min_escrows = $33,
             naira_high_value_review_amount = $34,
             usdc_high_value_review_amount = $35,
             payment_lifecycle_worker_enabled = $36,
             payment_lifecycle_worker_interval_ms = $37,
             reconciliation_worker_enabled = $38,
             queue_worker_enabled = $39,
             stuck_escrow_alert_minutes = $40,
             auto_release_enabled = $41,
             delivery_inspection_window_days = $42,
             outage_status_page_url = $43,
             outage_contacts = $44,
             crypto_network = $45,
             network_mode = $46,
             usdt_enabled = $47,
             version = $48,
             updated_at = $49,
             updated_by = $50
         WHERE id = 'default' AND version = $51`,
        [
          resolved.nairaFeePercent,
          resolved.nairaFeeFixed,
          resolved.usdcFeePercent,
          resolved.usdcFeeFixed,
          resolved.minNairaAmount,
          resolved.maxNairaAmount,
          resolved.minUsdcAmount,
          resolved.maxUsdcAmount,
          resolved.nairaNewUserLimit,
          resolved.nairaTrustedUserLimit,
          resolved.nairaEstablishedUserLimit,
          resolved.nairaSpecialApprovalLimit,
          resolved.nairaBuyerActiveExposureLimit,
          resolved.nairaPlatformActiveExposureLimit,
          resolved.trustedUserSuccessfulEscrows,
          resolved.establishedUserSuccessfulEscrows,
          resolved.activePaymentProvider,
          resolved.backupPaymentProvider,
          resolved.emergencyPaymentProvider,
          resolved.paymentProviderFallbackEnabled ? 1 : 0,
          resolved.platformMode,
          resolved.maintenanceMessage,
          resolved.nairaPaymentMethod,
          resolved.nairaFeeModel,
          resolved.nairaFeeTiers,
          resolved.nairaFundingWindowHours,
          resolved.nairaHighValueFundingWindowHours,
          resolved.nairaHighValueFundingWindowAmount,
          resolved.nairaFundingReminderBeforeExpiryHours,
          resolved.payoutSharedAccountReviewCount,
          resolved.complianceNewSellerEscrowCount,
          resolved.complianceHighDisputeRatio,
          resolved.complianceHighDisputeMinEscrows,
          resolved.nairaHighValueReviewAmount,
          resolved.usdcHighValueReviewAmount,
          resolved.paymentLifecycleWorkerEnabled ? 1 : 0,
          resolved.paymentLifecycleWorkerIntervalMs,
          resolved.reconciliationWorkerEnabled ? 1 : 0,
          resolved.queueWorkerEnabled ? 1 : 0,
          resolved.stuckEscrowAlertMinutes,
          resolved.autoReleaseEnabled ? 1 : 0,
          resolved.deliveryInspectionWindowDays,
          resolved.outageStatusPageUrl,
          resolved.outageContacts,
          resolved.cryptoNetwork,
          resolved.networkMode,
          resolved.usdtEnabled ? 1 : 0,
          newVersion,
          now,
          resolved.updatedBy,
          expectedVersion,
        ]
      );
      changes = result.rowCount || 0;
    }

    if (changes === 0) {
      throw new Error("Settings version mismatch; another update may have occurred. Please refresh and try again.");
    }

    await this.addAuditEntry("platform_settings", JSON.stringify(current), JSON.stringify(resolved), resolved.updatedBy);
    this.cachedSettings = null;
    this.cacheExpiresAt = 0;
    return this.getSettings();
  }

  public async addAuditEntry(settingName: string, oldValue: string, newValue: string, changedBy: string): Promise<string> {
    await this.initializeSchema();
    const id = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const changedAt = new Date().toISOString();
    if (this.provider === "sqlite") {
      this.sqlite!.prepare(`
        INSERT INTO audit_history (id, setting_name, old_value, new_value, changed_by, changed_at)
        VALUES (@id, @settingName, @oldValue, @newValue, @changedBy, @changedAt)
      `).run({ id, settingName, oldValue, newValue, changedBy, changedAt });
    } else {
      await this.pool!.query(
        `INSERT INTO audit_history (id, setting_name, old_value, new_value, changed_by, changed_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, settingName, oldValue, newValue, changedBy, changedAt]
      );
    }
    return id;
  }

  public async getAuditHistory(limit: number = 50): Promise<AuditHistoryRecord[]> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return (this.sqlite!.prepare(`SELECT * FROM audit_history ORDER BY changed_at DESC LIMIT @limit`).all({ limit }) as any[])
        .map((row) => this.mapAuditRow(row));
    }
    const result = await this.pool!.query(`SELECT * FROM audit_history ORDER BY changed_at DESC LIMIT $1`, [limit]);
    return result.rows.map((row) => this.mapAuditRow(row));
  }

  public calculateNairaFee(amount: number, settings: PlatformSettings): FeeCalculation {
    if (settings.nairaFeeModel === "tiered") {
      try {
        const tiers = JSON.parse(settings.nairaFeeTiers);
        if (Array.isArray(tiers)) {
          const tier = tiers.find((t: any) => t.max === null || amount <= t.max);
          if (tier) {
            let totalFee = 0;
            let platformFeePercent = 0;
            let platformFeeFixed = 0;

            if (tier.fee !== undefined) {
              totalFee = tier.fee;
              platformFeeFixed = tier.fee;
              platformFeePercent = 0;
            } else if (tier.rate !== undefined) {
              totalFee = Math.round((amount * tier.rate) / 100);
              platformFeePercent = totalFee;
              platformFeeFixed = 0;
            }

            return {
              subtotal: amount,
              platformFeePercent,
              platformFeeFixed,
              totalPlatformFee: totalFee,
              totalWithFee: amount + totalFee,
              recipientNet: amount,
            };
          }
        }
      } catch (err) {
        // Fallback to simple calculation below
      }
    }

    const percentFee = Math.round((amount * settings.nairaFeePercent) / 100);
    const totalFee = percentFee + settings.nairaFeeFixed;
    return {
      subtotal: amount,
      platformFeePercent: percentFee,
      platformFeeFixed: settings.nairaFeeFixed,
      totalPlatformFee: totalFee,
      totalWithFee: amount + totalFee,
      recipientNet: amount,
    };
  }

  public calculateUSDCFee(amount: number, settings: PlatformSettings): FeeCalculation {
    const percentFee = parseFloat((amount * (settings.usdcFeePercent / 100)).toFixed(6));
    const totalFee = parseFloat((percentFee + settings.usdcFeeFixed).toFixed(6));
    return {
      subtotal: amount,
      platformFeePercent: percentFee,
      platformFeeFixed: settings.usdcFeeFixed,
      totalPlatformFee: totalFee,
      totalWithFee: parseFloat((amount + totalFee).toFixed(6)),
      recipientNet: amount,
    };
  }

  public async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
