/**
 * Ensures the database schema has all required columns.
 * Uses ADD COLUMN IF NOT EXISTS — safe to run every startup.
 * Uses neon() HTTP client directly to avoid WebSocket pool issues.
 */
import { log } from './vite';

export async function ensureSchema(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    log('⚠️ No DATABASE_URL — skipping schema migration');
    return;
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    log('🔧 Ensuring DB schema via HTTP...');

    const columns = [
      ['company_id', 'VARCHAR'],
      ['equipment_type', "TEXT NOT NULL DEFAULT 'dry_van'"],
      ['load_type', "TEXT DEFAULT 'full_partial'"],
      ['max_length', 'INTEGER DEFAULT 53'],
      ['max_weight', 'INTEGER DEFAULT 26000'],
      ['phone_number', 'TEXT'],
      ['city', 'TEXT'],
      ['enable_sms_notifications', 'BOOLEAN NOT NULL DEFAULT false'],
      ['current_mood', "TEXT DEFAULT '😐'"],
      ['mood_updated_at', 'TIMESTAMP'],
      ['mood_note', 'TEXT'],
      ['total_loads', 'INTEGER DEFAULT 0'],
      ['completed_loads', 'INTEGER DEFAULT 0'],
      ['average_rating', 'REAL DEFAULT 0.0'],
      ['total_ratings', 'INTEGER DEFAULT 0'],
      ['total_miles', 'INTEGER DEFAULT 0'],
      ['total_revenue', 'REAL DEFAULT 0.0'],
      ['on_time_deliveries', 'INTEGER DEFAULT 0'],
      ['late_deliveries', 'INTEGER DEFAULT 0'],
      ['cancelled_loads', 'INTEGER DEFAULT 0'],
      ['last_load_date', 'TIMESTAMP'],
      ['best_streak', 'INTEGER DEFAULT 0'],
      ['current_streak', 'INTEGER DEFAULT 0'],
      ['average_delivery_time', 'REAL DEFAULT 0.0'],
      ['fuel_efficiency', 'REAL DEFAULT 0.0'],
      ['maintenance_score', 'REAL DEFAULT 100.0'],
      ['safety_score', 'REAL DEFAULT 100.0'],
      ['tracking_token', 'VARCHAR(64)'],
      ['license_state', 'TEXT'],
      ['license_expiry', 'TEXT'],
      ['state', 'TEXT'],
      ['zip_code', 'TEXT'],
      ['vehicle_year', 'TEXT'],
      ['vehicle_make', 'TEXT'],
      ['vehicle_model', 'TEXT'],
      ['telegram_id', 'TEXT'],
      ['telegram_username', 'TEXT'],
      ['enable_telegram_notifications', 'BOOLEAN NOT NULL DEFAULT false'],
    ];

    let added = 0;
    for (const [col, def] of columns) {
      try {
        // neon() doesn't support parameterized DDL so we use string concat (safe — no user input)
        await sql([`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ${col} ${def}`] as any);
        added++;
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          log(`⚠️ schema col ${col}: ${e.message}`);
        }
      }
    }

    // Constraints
    try { await sql([`ALTER TABLE drivers ADD CONSTRAINT drivers_phone_number_unique UNIQUE (phone_number)`] as any); } catch (_) {}
    try { await sql([`ALTER TABLE drivers ADD CONSTRAINT drivers_tracking_token_unique UNIQUE (tracking_token)`] as any); } catch (_) {}

    log(`✅ DB schema check done (processed ${columns.length} columns)`);
  } catch (err: any) {
    log(`⚠️ ensureSchema error: ${err.message}`);
  }
}
