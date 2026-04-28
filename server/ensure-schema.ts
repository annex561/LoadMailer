/**
 * Ensures the database schema has all required columns.
 * Uses pool.query() directly — works with both Neon and Railway Postgres.
 */
import { log } from './vite';

export async function ensureSchema(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    log('⚠️ No DATABASE_URL — skipping schema migration');
    return;
  }

  const columns: [string, string][] = [
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
    ['pay_type', "TEXT DEFAULT 'percent'"],
    ['pay_rate', 'REAL DEFAULT 80'],
    ['weekly_fuel_cost', 'REAL DEFAULT 0'],
    ['weekly_insurance_cost', 'REAL DEFAULT 0'],
    ['vehicle_type', "TEXT DEFAULT 'pickup_gooseneck'"],
    ['trailer_length', 'INTEGER'],
    ['max_deadhead_miles', 'INTEGER DEFAULT 150'],
    ['preferred_destinations', "TEXT[] DEFAULT ARRAY[]::TEXT[]"],
    ['home_base', 'TEXT'],
    ['emergency_contact', 'TEXT'],
    ['address', 'TEXT'],
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
    // Universal Ratecon Intake — pay rule + deduction toggles (PR #1)
    ['pay_rate_deadhead', 'REAL DEFAULT 0'],
    ['deduct_factoring_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_factoring_pct', 'REAL DEFAULT 3.0'],
    ['deduct_dispatch_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_dispatch_pct', 'REAL DEFAULT 5.0'],
    ['deduct_fuel_advance_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_fuel_advance_amount', 'REAL DEFAULT 0'],
    ['deduct_trailer_rent_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_trailer_rent_weekly', 'REAL DEFAULT 0'],
    ['deduct_insurance_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_insurance_weekly', 'REAL DEFAULT 0'],
    ['deduct_eld_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_eld_monthly', 'REAL DEFAULT 0'],
    ['deduct_occ_acc_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['deduct_occ_acc_weekly', 'REAL DEFAULT 0'],
  ];

  // Universal Ratecon Intake — loads.confirmation_* columns (PR #1)
  const loadsColumns: [string, string][] = [
    ['confirmation_token', 'VARCHAR(32)'],
    ['confirmation_status', "TEXT DEFAULT 'pending'"],
    ['confirmation_responded_at', 'TIMESTAMP'],
    // BOL/POD upload tracking (Phase 2)
    ['bol_path', 'TEXT'],
    ['bol_uploaded_at', 'TIMESTAMP'],
    ['pod_uploaded_at', 'TIMESTAMP'],
  ];

  try {
    const { pool } = await import('./db');
    if (!pool) { log('⚠️ No pool — skipping schema migration'); return; }

    log('🔧 Ensuring DB schema...');
    let ok = 0;

    for (const [col, def] of columns) {
      try {
        await pool.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ${col} ${def}`);
        ok++;
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          log(`⚠️ schema ${col}: ${e.message}`);
        }
      }
    }

    try { await pool.query(`ALTER TABLE drivers ADD CONSTRAINT drivers_phone_number_unique UNIQUE (phone_number)`); } catch (_) {}
    try { await pool.query(`ALTER TABLE drivers ADD CONSTRAINT drivers_tracking_token_unique UNIQUE (tracking_token)`); } catch (_) {}

    // Loads confirmation columns
    let loadsOk = 0;
    for (const [col, def] of loadsColumns) {
      try {
        await pool.query(`ALTER TABLE loads ADD COLUMN IF NOT EXISTS ${col} ${def}`);
        loadsOk++;
      } catch (e: any) {
        if (!e.message?.includes('already exists')) {
          log(`⚠️ loads.${col}: ${e.message}`);
        }
      }
    }
    try { await pool.query(`ALTER TABLE loads ADD CONSTRAINT loads_confirmation_token_unique UNIQUE (confirmation_token)`); } catch (_) {}

    // ratecon_intake table (Universal Ratecon Intake PR #1)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ratecon_intake (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
          company_id VARCHAR,
          source_type TEXT NOT NULL,
          source_email_message_id TEXT,
          source_filename TEXT,
          source_uploaded_by VARCHAR,
          pdf_path TEXT,
          raw_email_text TEXT,
          parsed_json JSONB,
          parsed_at TIMESTAMP,
          parser_model TEXT,
          parse_error TEXT,
          validators_passed_at TIMESTAMP,
          validator_failures JSONB,
          status TEXT NOT NULL DEFAULT 'pending',
          review_reason TEXT,
          reviewed_by VARCHAR,
          reviewed_at TIMESTAMP,
          load_id VARCHAR,
          matched_driver_id VARCHAR,
          matched_driver_confidence REAL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratecon_intake_status ON ratecon_intake(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratecon_intake_company ON ratecon_intake(company_id)`);
    } catch (e: any) {
      log(`⚠️ ratecon_intake table: ${e.message}`);
    }

    log(`✅ Schema migration done (drivers ${ok}/${columns.length} cols, loads ${loadsOk}/${loadsColumns.length} cols, ratecon_intake created)`);
  } catch (err: any) {
    log(`⚠️ ensureSchema error: ${err.message}`);
  }
}
