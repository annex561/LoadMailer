/**
 * Ensures the database schema has all required columns.
 * Uses ADD COLUMN IF NOT EXISTS so it's safe to run on every startup.
 * Each column is added independently so one failure doesn't block others.
 */
import { pool } from './db';
import { log } from './vite';

async function addColumn(client: any, table: string, column: string, definition: string) {
  try {
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  } catch (e: any) {
    // Ignore "already exists" errors, log others
    if (!e.message?.includes('already exists') && !e.message?.includes('duplicate column')) {
      log(`⚠️  ${table}.${column}: ${e.message}`);
    }
  }
}

async function addConstraint(client: any, table: string, name: string, definition: string) {
  try {
    await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  } catch (_e) { /* ignore — constraint already exists */ }
}

export async function ensureSchema(): Promise<void> {
  if (!pool) {
    log('⚠️ No DATABASE_URL — skipping schema migration');
    return;
  }

  const client = await pool.connect();
  try {
    log('🔧 Running schema migration...');

    // ── Drivers table ──────────────────────────────────────────────────────
    await addColumn(client, 'drivers', 'company_id', 'VARCHAR');
    await addColumn(client, 'drivers', 'equipment_type', "TEXT NOT NULL DEFAULT 'dry_van'");
    await addColumn(client, 'drivers', 'load_type', "TEXT DEFAULT 'full_partial'");
    await addColumn(client, 'drivers', 'max_length', 'INTEGER DEFAULT 53');
    await addColumn(client, 'drivers', 'max_weight', 'INTEGER DEFAULT 26000');
    await addColumn(client, 'drivers', 'phone_number', 'TEXT');
    await addColumn(client, 'drivers', 'city', 'TEXT');
    await addColumn(client, 'drivers', 'enable_sms_notifications', 'BOOLEAN NOT NULL DEFAULT false');
    await addColumn(client, 'drivers', 'current_mood', "TEXT DEFAULT '😐'");
    await addColumn(client, 'drivers', 'mood_updated_at', 'TIMESTAMP');
    await addColumn(client, 'drivers', 'mood_note', 'TEXT');
    await addColumn(client, 'drivers', 'total_loads', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'completed_loads', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'average_rating', 'REAL DEFAULT 0.0');
    await addColumn(client, 'drivers', 'total_ratings', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'total_miles', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'total_revenue', 'REAL DEFAULT 0.0');
    await addColumn(client, 'drivers', 'on_time_deliveries', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'late_deliveries', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'cancelled_loads', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'last_load_date', 'TIMESTAMP');
    await addColumn(client, 'drivers', 'best_streak', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'current_streak', 'INTEGER DEFAULT 0');
    await addColumn(client, 'drivers', 'average_delivery_time', 'REAL DEFAULT 0.0');
    await addColumn(client, 'drivers', 'fuel_efficiency', 'REAL DEFAULT 0.0');
    await addColumn(client, 'drivers', 'maintenance_score', 'REAL DEFAULT 100.0');
    await addColumn(client, 'drivers', 'safety_score', 'REAL DEFAULT 100.0');
    await addColumn(client, 'drivers', 'tracking_token', 'VARCHAR(64)');
    await addColumn(client, 'drivers', 'license_state', 'TEXT');
    await addColumn(client, 'drivers', 'license_expiry', 'TEXT');
    await addColumn(client, 'drivers', 'state', 'TEXT');
    await addColumn(client, 'drivers', 'zip_code', 'TEXT');
    await addColumn(client, 'drivers', 'vehicle_year', 'TEXT');
    await addColumn(client, 'drivers', 'vehicle_make', 'TEXT');
    await addColumn(client, 'drivers', 'vehicle_model', 'TEXT');
    await addColumn(client, 'drivers', 'telegram_id', 'TEXT');
    await addColumn(client, 'drivers', 'telegram_username', 'TEXT');
    await addColumn(client, 'drivers', 'enable_telegram_notifications', 'BOOLEAN NOT NULL DEFAULT false');

    await addConstraint(client, 'drivers', 'drivers_phone_number_unique', 'UNIQUE (phone_number)');
    await addConstraint(client, 'drivers', 'drivers_tracking_token_unique', 'UNIQUE (tracking_token)');

    log('✅ Schema migration complete');
  } catch (err: any) {
    log(`⚠️ Schema migration error: ${err.message}`);
  } finally {
    client.release();
  }
}
