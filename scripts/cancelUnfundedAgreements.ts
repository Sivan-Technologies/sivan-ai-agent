import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * cancelUnfundedAgreements.ts
 *
 * Gracefully transitions all unfunded service agreements in CREATED,
 * PENDING_PROFILE, PENDING_ACCEPTANCE, and PENDING_PAYMENT to CANCELLED.
 *
 * Preserves relational integrity, transaction records, and audit events.
 */

async function main() {
  const dbUrl =
    process.env.TARGET_DATABASE_URL ||
    process.env.LIVE_DATABASE_URL ||
    process.env.POSTGRES_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "";

  console.log("=== SIVAN SERVICE AGREEMENT CLEANUP SCRIPT ===");
  const isPostgres = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");

  const unfundedStatuses = [
    "CREATED",
    "PENDING_PROFILE",
    "PENDING_ACCEPTANCE",
    "PENDING_PAYMENT",
  ];

  const now = new Date().toISOString();

  if (isPostgres) {
    console.log(`Connecting to Postgres DB: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes("sslmode=require") || dbUrl.includes("sslmode=verify-full") ? { rejectUnauthorized: false } : undefined,
    });

    try {
      // 1. Fetch matching unfunded escrows
      const query = `
        SELECT escrow_id, amount, currency, status, purpose, buyer_user_id, seller_user_id, created_at
        FROM escrows
        WHERE status = ANY($1::text[])
        ORDER BY created_at DESC
      `;
      const res = await pool.query(query, [unfundedStatuses]);
      console.log(`Found ${res.rows.length} unfunded service agreement(s) eligible for cancellation.`);

      if (res.rows.length === 0) {
        console.log("No unfunded agreements to cancel. Database is already clean!");
        return;
      }

      for (const row of res.rows) {
        console.log(`- Cancelling ${row.escrow_id}: ${row.amount} ${row.currency} (${row.status}) - "${row.purpose}"`);
        
        // Update status to CANCELLED
        await pool.query(
          `UPDATE escrows SET status = 'CANCELLED', updated_at = $1 WHERE escrow_id = $2`,
          [now, row.escrow_id]
        );

        // Record audit event
        await pool.query(
          `INSERT INTO events (event_id, escrow_id, event_type, actor, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            `evt_clean_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            row.escrow_id,
            "admin_cancelled_unfunded_cleanup",
            "system_admin_cleanup",
            JSON.stringify({ previousStatus: row.status, reason: "Graceful cleanup of unfunded agreement" }),
            now,
          ]
        );
      }

      console.log(`\n✅ Successfully cancelled ${res.rows.length} unfunded agreement(s).`);
    } catch (err: any) {
      console.error("Postgres cleanup failed:", err.message);
    } finally {
      await pool.end();
    }
  } else {
    const sqlitePath = dbUrl || path.resolve(__dirname, "../data/sivan-escrow-agent.db");
    console.log(`Connecting to SQLite DB at ${sqlitePath}`);
    if (!fs.existsSync(sqlitePath)) {
      console.log(`SQLite database not found at ${sqlitePath}. Nothing to clean.`);
      return;
    }

    const db = new Database(sqlitePath);
    try {
      const placeholders = unfundedStatuses.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT escrow_id, amount, currency, status, purpose FROM escrows WHERE status IN (${placeholders})`)
        .all(...unfundedStatuses) as any[];

      console.log(`Found ${rows.length} unfunded service agreement(s) eligible for cancellation.`);

      if (rows.length === 0) {
        console.log("No unfunded agreements to cancel. Database is already clean!");
        return;
      }

      const updateStmt = db.prepare(`UPDATE escrows SET status = 'CANCELLED', updated_at = ? WHERE escrow_id = ?`);
      const eventStmt = db.prepare(
        `INSERT INTO events (event_id, escrow_id, event_type, actor, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const row of rows) {
        console.log(`- Cancelling ${row.escrow_id}: ${row.amount} ${row.currency} (${row.status}) - "${row.purpose}"`);
        updateStmt.run(now, row.escrow_id);
        eventStmt.run(
          `evt_clean_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          row.escrow_id,
          "admin_cancelled_unfunded_cleanup",
          "system_admin_cleanup",
          JSON.stringify({ previousStatus: row.status, reason: "Graceful cleanup of unfunded agreement" }),
          now
        );
      }

      console.log(`\n✅ Successfully cancelled ${rows.length} unfunded agreement(s).`);
    } catch (err: any) {
      console.error("SQLite cleanup failed:", err.message);
    } finally {
      db.close();
    }
  }
}

main().catch(console.error);
