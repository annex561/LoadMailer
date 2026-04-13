/**
 * Ensures the database schema has all required columns.
 * Uses ADD COLUMN IF NOT EXISTS — safe to run every startup.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';
import { log } from './vite';

async function addCol(table: string, column: string, definition: string) {
  try {
    await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`));
  } catch (e: any) {
    if (!e.message?.includes('already exists')) {
      log(`⚠️  schema: ${table}.${column}: ${e.message}`);
    }
  }
}

async function addConstraint(name: string, statement: string) {
  try {
    await db.execute(sql.raw(statement));
  } catch (_e) { /* already exists */ }
}

export async function ensureSchema(): Promise<void> {
  if (!db) {
    log('⚠️ No DATABASE_URL — skipping schema migration');
    return;
  }

  try {
    log('🔧 Ensuring DB schema...');

    // ── Drivers ──────────────────────────────────────────────────
    await addCol('drivers', 'company_id', 'VARCHAR');
    await addCol('drivers', 'equipment_type', "TEXT NOT NULL DEFAULT 'dry_van'");
    await addCol('drivers', 'load_type', "TEXT DEFAULT 'full_partial'");
    await addCol('drivers', 'max_length', 'INTEGER DEFAULT 53');
    await addCol('drivers', 'max_weight', 'INTEGER DEFAULT 26000');
    await addCol('drivers', 'phone_number', 'TEXT');
    await addCol('drivers', 'city', 'TEXT');
    await addCol('drivers', 'enable_sms_notifications', 'BOOLEAN NOT NULL DEFAULT false');
    await addCol('drivers', 'current_mood', "TEXT DEFAULT '😐'");
    await addCol('drivers', 'mood_updated_at', 'TIMESTAMP');
    await addCol('drivers', 'mood_note', 'TEXT');
    await addCol('drivers', 'total_loads', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'completed_loads', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'average_rating', 'REAL DEFAULT 0.0');
    await addCol('drivers', 'total_ratings', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'total_miles', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'total_revenue', 'REAL DEFAULT 0.0');
    await addCol('drivers', 'on_time_deliveries', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'late_deliveries', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'cancelled_loads', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'last_load_date', 'TIMESTAMP');
    await addCol('drivers', 'best_streak', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'current_streak', 'INTEGER DEFAULT 0');
    await addCol('drivers', 'average_delivery_time', 'REAL DEFAULT 0.0');
    await addCol('drivers', 'fuel_efficiency', 'REAL DEFAULT 0.0');
    await addCol('drivers', 'maintenance_score', 'REAL DEFAULT 100.0');
    await addCol('drivers', 'safety_score', 'REAL DEFAULT 100.0');
    await addCol('drivers', 'tracking_token', 'VARCHAR(64)');
    await addCol('drivers', 'license_state', 'TEXT');
    await addCol('drivers', 'license_expiry', 'TEXT');
    await addCol('drivers', 'state', 'TEXT');
    await addCol('drivers', 'zip_code', 'TEXT');
    await addCol('drivers', 'vehicle_year', 'TEXT');
    await addCol('drivers', 'vehicle_make', 'TEXT');
    await addCol('drivers', 'vehicle_model', 'TEXT');
    await addCol('drivers', 'telegram_id', 'TEXT');
    await addCol('drivers', 'telegram_username', 'TEXT');
    await addCol('drivers', 'enable_telegram_notifications', 'BOOLEAN NOT NULL DEFAULT false');

    await addConstraint('drivers_phone_number_unique',
      'ALTER TABLE drivers ADD CONSTRAINT drivers_phone_number_unique UNIQUE (phone_number)');
    await addConstraint('drivers_tracking_token_unique',
      'ALTER TABLE drivers ADD CONSTRAINT drivers_tracking_token_unique UNIQUE (tracking_token)');

    log('✅ DB schema up to date');
  } catch (err: any) {
    log(`⚠️ ensureSchema error: ${err.message}`);
  }
}
