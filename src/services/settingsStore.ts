import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

export interface PlatformSettings {
  id?: string;
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
        connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || "5000"),
        query_timeout: Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || "8000"),
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
      nairaNewUserLimit: Number(row.naira_new_user_limit ?? 100000),
      nairaTrustedUserLimit: Number(row.naira_trusted_user_limit ?? 250000),
      nairaEstablishedUserLimit: Number(row.naira_established_user_limit ?? 500000),
      nairaSpecialApprovalLimit: Number(row.naira_special_approval_limit ?? 1000000),
      nairaBuyerActiveExposureLimit: Number(row.naira_buyer_active_exposure_limit ?? 500000),
      nairaPlatformActiveExposureLimit: Number(row.naira_platform_active_exposure_limit ?? 10000000),
      trustedUserSuccessfulEscrows: Number(row.trusted_user_successful_escrows ?? 3),
      establishedUserSuccessfulEscrows: Number(row.established_user_successful_escrows ?? 10),
      activePaymentProvider: row.active_payment_provider || process.env.ACTIVE_PAYMENT_PROVIDER || "flutterwave",
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
      "naira_new_user_limit REAL NOT NULL DEFAULT 100000",
      "naira_trusted_user_limit REAL NOT NULL DEFAULT 250000",
      "naira_established_user_limit REAL NOT NULL DEFAULT 500000",
      "naira_special_approval_limit REAL NOT NULL DEFAULT 1000000",
      "naira_buyer_active_exposure_limit REAL NOT NULL DEFAULT 500000",
      "naira_platform_active_exposure_limit REAL NOT NULL DEFAULT 10000000",
      "trusted_user_successful_escrows INTEGER NOT NULL DEFAULT 3",
      "established_user_successful_escrows INTEGER NOT NULL DEFAULT 10",
      "active_payment_provider TEXT NOT NULL DEFAULT 'flutterwave'",
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
          version, updated_at, updated_by
        )
        VALUES (
          'default', 2.5, 50, 1.5, 0.5,
          @activePaymentProvider, @backupPaymentProvider, @emergencyPaymentProvider,
          @paymentProviderFallbackEnabled, @platformMode, @maintenanceMessage,
          'bank_transfer', 'simple', '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]',
          @nairaFundingWindowHours, @nairaHighValueFundingWindowHours,
          @nairaHighValueFundingWindowAmount, @nairaFundingReminderBeforeExpiryHours,
          1, @now, 'system'
        )
      `).run({
        now,
        activePaymentProvider: process.env.ACTIVE_PAYMENT_PROVIDER || "flutterwave",
        backupPaymentProvider: process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
        emergencyPaymentProvider: process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
        paymentProviderFallbackEnabled: process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED === "true" ? 1 : 0,
        platformMode: process.env.PLATFORM_MODE || "test",
        maintenanceMessage: process.env.MAINTENANCE_MESSAGE || "Sivan is temporarily under maintenance. Please try again soon.",
        nairaFundingWindowHours: Number(process.env.NAIRA_FUNDING_WINDOW_HOURS || 24),
        nairaHighValueFundingWindowHours: Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_HOURS || 48),
        nairaHighValueFundingWindowAmount: Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_AMOUNT || 100000),
        nairaFundingReminderBeforeExpiryHours: Number(process.env.NAIRA_FUNDING_REMINDER_BEFORE_EXPIRY_HOURS || 6),
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
      ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS active_payment_provider TEXT NOT NULL DEFAULT 'flutterwave';
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
          version, updated_at, updated_by
        )
         VALUES ('default', 2.5, 50, 1.5, 0.5, $1, $2, $3, $4, $5, $6, 'bank_transfer', 'simple', '[{"max":10000,"fee":500},{"max":20000,"fee":900},{"max":25000,"fee":1000},{"max":50000,"rate":3.75},{"max":100000,"rate":3.5},{"max":null,"rate":3.5}]', $7, $8, $9, $10, 1, $11, 'system')`,
        [
          process.env.ACTIVE_PAYMENT_PROVIDER || "flutterwave",
          process.env.BACKUP_PAYMENT_PROVIDER || "palmpay",
          process.env.EMERGENCY_PAYMENT_PROVIDER || "flutterwave",
          process.env.PAYMENT_PROVIDER_FALLBACK_ENABLED === "true" ? 1 : 0,
          process.env.PLATFORM_MODE || "test",
          process.env.MAINTENANCE_MESSAGE || "Sivan is temporarily under maintenance. Please try again soon.",
          Number(process.env.NAIRA_FUNDING_WINDOW_HOURS || 24),
          Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_HOURS || 48),
          Number(process.env.NAIRA_HIGH_VALUE_FUNDING_WINDOW_AMOUNT || 100000),
          Number(process.env.NAIRA_FUNDING_REMINDER_BEFORE_EXPIRY_HOURS || 6),
          new Date().toISOString(),
        ]
      );
    }
    this.initialized = true;
  }

  public async getSettings(): Promise<PlatformSettings> {
    await this.initializeSchema();
    if (this.provider === "sqlite") {
      return this.mapSettingsRow(this.sqlite!.prepare(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`).get());
    }
    const result = await this.pool!.query(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`);
    return this.mapSettingsRow(result.rows[0]);
  }

  public async updateSettings(settings: {
    nairaFeePercent: number;
    nairaFeeFixed: number;
    usdcFeePercent: number;
    usdcFeeFixed: number;
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
    expectedVersion: number;
    updatedBy: string;
  }): Promise<PlatformSettings> {
    const current = await this.getSettings();
    const resolved: PlatformSettings & { expectedVersion: number; updatedBy: string } = {
      ...current,
      ...settings,
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
    for (const [label, provider] of [
      ["active payment provider", resolved.activePaymentProvider],
      ["backup payment provider", resolved.backupPaymentProvider],
      ["emergency payment provider", resolved.emergencyPaymentProvider],
    ] as const) {
      if (!["paystack", "monnify", "palmpay", "flutterwave"].includes(provider)) {
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
            version = @newVersion,
            updated_at = @now,
            updated_by = @updatedBy
        WHERE id = 'default' AND version = @expectedVersion
      `).run({ ...resolved, paymentProviderFallbackEnabled: resolved.paymentProviderFallbackEnabled ? 1 : 0, newVersion, now });
      changes = result.changes;
    } else {
      const result = await this.pool!.query(
        `UPDATE platform_settings
         SET naira_fee_percent = $1,
             naira_fee_fixed = $2,
             usdc_fee_percent = $3,
             usdc_fee_fixed = $4,
             naira_new_user_limit = $5,
             naira_trusted_user_limit = $6,
             naira_established_user_limit = $7,
             naira_special_approval_limit = $8,
             naira_buyer_active_exposure_limit = $9,
             naira_platform_active_exposure_limit = $10,
             trusted_user_successful_escrows = $11,
             established_user_successful_escrows = $12,
             active_payment_provider = $13,
             backup_payment_provider = $14,
             emergency_payment_provider = $15,
             payment_provider_fallback_enabled = $16,
             platform_mode = $17,
             maintenance_message = $18,
             naira_payment_method = $19,
             naira_fee_model = $20,
             naira_fee_tiers = $21,
             naira_funding_window_hours = $22,
             naira_high_value_funding_window_hours = $23,
             naira_high_value_funding_window_amount = $24,
             naira_funding_reminder_before_expiry_hours = $25,
             version = $26,
             updated_at = $27,
             updated_by = $28
         WHERE id = 'default' AND version = $29`,
        [
          resolved.nairaFeePercent,
          resolved.nairaFeeFixed,
          resolved.usdcFeePercent,
          resolved.usdcFeeFixed,
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
