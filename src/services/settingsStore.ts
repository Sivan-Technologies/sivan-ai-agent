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

    this.initializeDefaultSettingsSync();
  }

  private initializeDefaultSettingsSync() {
    const existing = this.sqlite!.prepare("SELECT id FROM platform_settings LIMIT 1").get();
    if (!existing) {
      const now = new Date().toISOString();
      this.sqlite!.prepare(`
        INSERT INTO platform_settings (id, naira_fee_percent, naira_fee_fixed, usdc_fee_percent, usdc_fee_fixed, version, updated_at, updated_by)
        VALUES ('default', 2.5, 50, 1.5, 0.5, 1, @now, 'system')
      `).run({ now });
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

    const existing = await this.pool!.query("SELECT id FROM platform_settings LIMIT 1");
    if (existing.rowCount === 0) {
      await this.pool!.query(
        `INSERT INTO platform_settings (id, naira_fee_percent, naira_fee_fixed, usdc_fee_percent, usdc_fee_fixed, version, updated_at, updated_by)
         VALUES ('default', 2.5, 50, 1.5, 0.5, 1, $1, 'system')`,
        [new Date().toISOString()]
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
    expectedVersion: number;
    updatedBy: string;
  }): Promise<PlatformSettings> {
    if (settings.nairaFeePercent < 0 || settings.nairaFeePercent > 50) throw new Error("Naira fee percent must be between 0 and 50");
    if (settings.nairaFeeFixed < 0) throw new Error("Naira fixed fee must be non-negative");
    if (settings.usdcFeePercent < 0 || settings.usdcFeePercent > 50) throw new Error("USDC fee percent must be between 0 and 50");
    if (settings.usdcFeeFixed < 0) throw new Error("USDC fixed fee must be non-negative");

    const current = await this.getSettings();
    const expectedVersion = settings.expectedVersion;
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
            version = @newVersion,
            updated_at = @now,
            updated_by = @updatedBy
        WHERE id = 'default' AND version = @expectedVersion
      `).run({ ...settings, newVersion, now });
      changes = result.changes;
    } else {
      const result = await this.pool!.query(
        `UPDATE platform_settings
         SET naira_fee_percent = $1,
             naira_fee_fixed = $2,
             usdc_fee_percent = $3,
             usdc_fee_fixed = $4,
             version = $5,
             updated_at = $6,
             updated_by = $7
         WHERE id = 'default' AND version = $8`,
        [
          settings.nairaFeePercent,
          settings.nairaFeeFixed,
          settings.usdcFeePercent,
          settings.usdcFeeFixed,
          newVersion,
          now,
          settings.updatedBy,
          expectedVersion,
        ]
      );
      changes = result.rowCount || 0;
    }

    if (changes === 0) {
      throw new Error("Settings version mismatch; another update may have occurred. Please refresh and try again.");
    }

    await this.addAuditEntry("platform_settings", JSON.stringify(current), JSON.stringify(settings), settings.updatedBy);
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

  public async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
    }
    if (this.pool) {
      await this.pool.end();
    }
  }
}
