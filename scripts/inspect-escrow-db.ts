import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;

async function test() {
  const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_3fnl7mFqijWz@ep-empty-snow-aye297lt.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false }
  });

  console.log('=== ESCROWS in sivan-escrow-agent DB ===');
  const escrows = await pool.query("SELECT escrow_id, buyer_user_id, seller_user_id, buyer_whatsapp, seller_whatsapp, amount, currency, status, purpose, created_by_channel, created_at FROM escrows ORDER BY created_at DESC LIMIT 20");
  console.log('Escrows count:', escrows.rows.length);
  for (const e of escrows.rows) {
    console.log(e);
  }

  console.log('\n=== USERS in sivan-escrow-agent DB ===');
  const users = await pool.query("SELECT user_id, whatsapp_number, email, first_name, last_name, telegram_user_id, telegram_username FROM users ORDER BY created_at DESC LIMIT 20");
  console.log('Users count:', users.rows.length);
  for (const u of users.rows) {
    console.log(u);
  }

  await pool.end();
}

test().catch(console.error);
