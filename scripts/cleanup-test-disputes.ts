import { Pool } from "pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function cleanup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith("postgres")) {
    console.log("No PostgreSQL DATABASE_URL found in .env");
    return;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Connecting to PostgreSQL to clean up test dispute records...");

    // 1. Delete events for matching test escrows
    const resEvents = await pool.query(`
      DELETE FROM escrow_events 
      WHERE escrow_id IN (
        SELECT escrow_id FROM escrows 
        WHERE purpose ILIKE '%E2E AI dispute%' 
           OR purpose ILIKE '%Smart contract review%'
           OR escrow_id IN ('SIV-892550-6B39', 'SIV-803323-F630')
      )
    `);
    console.log(`Deleted ${resEvents.rowCount} associated escrow_events rows.`);

    // 2. Delete transactions for matching test escrows
    const resTxns = await pool.query(`
      DELETE FROM transactions 
      WHERE escrow_id IN (
        SELECT escrow_id FROM escrows 
        WHERE purpose ILIKE '%E2E AI dispute%' 
           OR purpose ILIKE '%Smart contract review%'
           OR escrow_id IN ('SIV-892550-6B39', 'SIV-803323-F630')
      )
    `);
    console.log(`Deleted ${resTxns.rowCount} associated transaction rows.`);

    // 3. Delete the escrows themselves
    const resEscrows = await pool.query(`
      DELETE FROM escrows 
      WHERE purpose ILIKE '%E2E AI dispute%' 
         OR purpose ILIKE '%Smart contract review%'
         OR escrow_id IN ('SIV-892550-6B39', 'SIV-803323-F630')
    `);
    console.log(`Deleted ${resEscrows.rowCount} test dispute escrow rows.`);

    console.log("✅ Cleanup complete!");
  } catch (err) {
    console.error("Cleanup error:", err);
  } finally {
    await pool.end();
  }
}

cleanup();
