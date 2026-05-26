import Database from "better-sqlite3";

export interface PlatformSettings {
  id?: string;
  nairaFeePercent: number;
  nairaFeeFixed: number;
  usdcFeePercent: number;
  usdcFeeFixed: number;
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

export class SettingsStore {
  constructor(private db: Database.Database) {}

  public initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        id TEXT PRIMARY KEY,
        naira_fee_percent REAL NOT NULL DEFAULT 2.5,
        naira_fee_fixed REAL NOT NULL DEFAULT 50,
        usdc_fee_percent REAL NOT NULL DEFAULT 1.5,
        usdc_fee_fixed REAL NOT NULL DEFAULT 0.5,
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

    this.initializeDefaultSettings();
  }

  private initializeDefaultSettings() {
    const existing = this.db.prepare("SELECT id FROM platform_settings LIMIT 1").get();
    if (!existing) {
      const id = "default";
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO platform_settings (id, naira_fee_percent, naira_fee_fixed, usdc_fee_percent, usdc_fee_fixed, version, updated_at, updated_by)
        VALUES (@id, 2.5, 50, 1.5, 0.5, 1, @now, 'system')
      `);
      stmt.run({ id, now });
    }
  }

  public getSettings(): PlatformSettings {
    const stmt = this.db.prepare(`SELECT * FROM platform_settings WHERE id = 'default' LIMIT 1`);
    const row: any = stmt.get();
    if (!row) {
      throw new Error("Platform settings not found");
    }
    return {
      id: row.id,
      nairaFeePercent: row.naira_fee_percent,
      nairaFeeFixed: row.naira_fee_fixed,
      usdcFeePercent: row.usdc_fee_percent,
      usdcFeeFixed: row.usdc_fee_fixed,
      version: row.version,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  public updateSettings(settings: {
    nairaFeePercent: number;
    nairaFeeFixed: number;
    usdcFeePercent: number;
    usdcFeeFixed: number;
    expectedVersion: number;
    updatedBy: string;
  }): PlatformSettings {
    // Validation
    if (settings.nairaFeePercent < 0 || settings.nairaFeePercent > 50) {
      throw new Error("Naira fee percent must be between 0 and 50");
    }
    if (settings.nairaFeeFixed < 0) {
      throw new Error("Naira fixed fee must be non-negative");
    }
    if (settings.usdcFeePercent < 0 || settings.usdcFeePercent > 50) {
      throw new Error("USDC fee percent must be between 0 and 50");
    }
    if (settings.usdcFeeFixed < 0) {
      throw new Error("USDC fixed fee must be non-negative");
    }

    const current = this.getSettings();
    const expectedVersion = settings.expectedVersion;

    if (current.version !== expectedVersion) {
      throw new Error(
        `Settings version mismatch; current version is ${current.version}, expected ${expectedVersion}. Please refresh and try again.`
      );
    }

    const newVersion = expectedVersion + 1;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE platform_settings
      SET naira_fee_percent = @nairaFeePercent,
          naira_fee_fixed = @nairaFeeFixed,
          usdc_fee_percent = @usdcFeePercent,
          usdc_fee_fixed = @usdcFeeFixed,
          version = @newVersion,
          updated_at = @now,
          updated_by = @updatedBy
      WHERE id = 'default' AND version = @expectedVersion
    `);

    const result = stmt.run({
      nairaFeePercent: settings.nairaFeePercent,
      nairaFeeFixed: settings.nairaFeeFixed,
      usdcFeePercent: settings.usdcFeePercent,
      usdcFeeFixed: settings.usdcFeeFixed,
      newVersion,
      now,
      updatedBy: settings.updatedBy,
      expectedVersion,
    });

    if (result.changes === 0) {
      throw new Error("Settings version mismatch; another update may have occurred. Please refresh and try again.");
    }

    this.addAuditEntry("platform_settings", JSON.stringify(current), JSON.stringify(settings), settings.updatedBy);
    return this.getSettings();
  }

  public addAuditEntry(settingName: string, oldValue: string, newValue: string, changedBy: string) {
    const id = `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const changedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO audit_history (id, setting_name, old_value, new_value, changed_by, changed_at)
      VALUES (@id, @settingName, @oldValue, @newValue, @changedBy, @changedAt)
    `);
    stmt.run({ id, settingName, oldValue, newValue, changedBy, changedAt });
    return id;
  }

  public getAuditHistory(limit: number = 50): AuditHistoryRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM audit_history ORDER BY changed_at DESC LIMIT @limit`);
    const rows = stmt.all({ limit }) as any[];
    return rows.map((row) => ({
      id: row.id,
      settingName: row.setting_name,
      oldValue: row.old_value || "",
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedAt: row.changed_at,
    }));
  }

  public calculateNairaFee(amount: number, settings: PlatformSettings): FeeCalculation {
    const percentFee = Math.round((amount * settings.nairaFeePercent) / 100);
    const totalFee = percentFee + settings.nairaFeeFixed;
    return {
      subtotal: amount,
      platformFeePercent: percentFee,
      platformFeeFixed: settings.nairaFeeFixed,
      totalPlatformFee: totalFee,
      totalWithFee: amount + totalFee,
      recipientNet: amount - totalFee,
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
      recipientNet: parseFloat((amount - totalFee).toFixed(6)),
    };
  }
}
