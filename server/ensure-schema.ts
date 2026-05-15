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
    // A2P 10DLC compliance — consent + opt-out audit trail (PR #39).
    // Without these, every SELECT * FROM drivers fails post-deploy because
    // the Drizzle schema declares them but the columns don't yet exist.
    ['sms_consent_at', 'TIMESTAMP'],
    ['sms_consent_source', 'TEXT'],
    ['sms_consent_ip', 'TEXT'],
    ['sms_opted_out_at', 'TIMESTAMP'],
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
    // Daily HOS check
    ['is_on_duty', 'BOOLEAN NOT NULL DEFAULT true'],
    ['last_hos_check_at', 'TIMESTAMP'],
  ];

  // Universal Ratecon Intake — loads.confirmation_* columns (PR #1)
  const loadsColumns: [string, string][] = [
    // Core load fields. Many were added to the Drizzle schema over time without
    // being registered here, causing INSERT INTO loads to fail in prod with
    // "column does not exist" — the same class of bug PR #41 fixed for drivers.
    // All columns use IF NOT EXISTS so this is idempotent + safe to expand.
    ['company_id', 'VARCHAR'],
    ['description', 'TEXT'],
    ['priority', "TEXT DEFAULT 'standard'"],
    ['pickup_address', 'TEXT'],
    ['pickup_date', 'TIMESTAMP'],
    ['pickup_time', 'TEXT'],
    ['delivery_address', 'TEXT'],
    ['delivery_date', 'TIMESTAMP'],
    ['delivery_time', 'TEXT'],
    ['special_instructions', 'TEXT'],
    ['load_type', "TEXT DEFAULT 'full'"],
    ['length', 'INTEGER'],
    ['equipment_type', "TEXT DEFAULT 'dry_van'"],
    ['temperature_required', 'BOOLEAN NOT NULL DEFAULT false'],
    ['min_temperature', 'INTEGER'],
    ['max_temperature', 'INTEGER'],
    ['temperature_unit', "TEXT DEFAULT 'F'"],
    ['expires_at', 'TIMESTAMP'],
    ['is_expired', 'BOOLEAN NOT NULL DEFAULT false'],
    ['rate', 'REAL'],
    ['miles', 'INTEGER'],
    ['weight', 'INTEGER'],
    ['company', 'TEXT'],
    ['contact_phone', 'TEXT'],
    ['broker_name', 'TEXT'],
    ['broker_phone', 'TEXT'],
    ['broker_email', 'TEXT'],
    ['dispatcher_name', 'TEXT'],
    ['assigned_driver_name', 'TEXT'],
    ['source_board', "TEXT DEFAULT 'manual'"],
    ['gps_tracking_sms_last_sent_at', 'TIMESTAMP'],
    ['truck_id', 'VARCHAR'],
    ['origin_city', 'TEXT'],
    ['origin_state', 'TEXT'],
    ['dest_city', 'TEXT'],
    ['dest_state', 'TEXT'],
    ['offered_rate', 'REAL'],
    ['rpm', 'REAL'],
    ['score', 'INTEGER'],
    ['offered_at', 'TIMESTAMP'],
    ['booked_at', 'TIMESTAMP'],
    ['delivered_at', 'TIMESTAMP'],
    ['ratecon_path', 'TEXT'],
    ['confirmation_token', 'VARCHAR(32)'],
    ['confirmation_status', "TEXT DEFAULT 'pending'"],
    ['confirmation_responded_at', 'TIMESTAMP'],
    ['bol_path', 'TEXT'],
    ['bol_uploaded_at', 'TIMESTAMP'],
    ['pod_path', 'TEXT'],
    ['pod_uploaded_at', 'TIMESTAMP'],
    ['override_reason', 'TEXT'],
    ['sop_progress', "JSONB DEFAULT '{}'::jsonb"],
    ['fuel_cost', 'REAL'],
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

    // Users — Google OAuth column (only adds google_id; other columns assumed present)
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR`);
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_google_id_unique UNIQUE (google_id)`);
    } catch (_) {}

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

    // factoring_submissions — one row per packet sent to a factor (currently
    // only Love's Financial). Unique on load_id so the same load can never
    // be double-submitted. See docs/factoring/loves-financial.md.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS factoring_submissions (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
          load_id VARCHAR NOT NULL UNIQUE,
          factor TEXT NOT NULL DEFAULT 'loves',
          status TEXT NOT NULL DEFAULT 'queued',
          packet_pdf_path TEXT,
          submitted_at TIMESTAMP,
          submitted_by VARCHAR,
          funded_at TIMESTAMP,
          amount_invoiced REAL,
          amount_advanced REAL,
          fee_charged REAL,
          loves_invoice_id TEXT,
          loves_schedule_id TEXT,
          email_message_id TEXT,
          error_message TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_factoring_status ON factoring_submissions(status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_factoring_load ON factoring_submissions(load_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_factoring_submitted_at ON factoring_submissions(submitted_at)`);
    } catch (e: any) {
      log(`⚠️ factoring_submissions table: ${e.message}`);
    }

    // Add new columns to loads for BOL verification + factoring lifecycle.
    // ALTER TABLE ADD COLUMN IF NOT EXISTS is supported on PG 9.6+.
    try {
      const newLoadCols: Array<[string, string]> = [
        ["bol_verified_at", "TIMESTAMP"],
        ["bol_verify_attempts", "INTEGER DEFAULT 0"],
        ["good_to_go_sent_at", "TIMESTAMP"],
        ["factoring_status", "TEXT DEFAULT 'not_ready'"],
        ["factoring_submitted_at", "TIMESTAMP"],
        ["factoring_funded_at", "TIMESTAMP"],
        ["factoring_loves_invoice_id", "TEXT"],
        ["factoring_schedule_id", "TEXT"],
        ["factoring_amount_advanced", "REAL"],
      ];
      for (const [col, type] of newLoadCols) {
        await pool.query(`ALTER TABLE loads ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      }
    } catch (e: any) {
      log(`⚠️ loads factoring columns: ${e.message}`);
    }

    // ratecon_corrections — every dispatcher correction becomes a learning
    // signal for future parses. The parser pulls the most recent N rows as
    // few-shot examples in its GPT-4o prompt.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ratecon_corrections (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
          intake_id VARCHAR NOT NULL,
          broker_name TEXT,
          raw_text TEXT,
          original_parse JSONB,
          corrected_parse JSONB,
          fields_changed TEXT[],
          corrected_by VARCHAR,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratecon_corrections_broker ON ratecon_corrections(broker_name)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ratecon_corrections_created ON ratecon_corrections(created_at DESC)`);
    } catch (e: any) {
      log(`⚠️ ratecon_corrections table: ${e.message}`);
    }

    // hos_check_log — per-driver-per-day dedup for the HOS check cron.
    // Unique constraint on (driver_id, send_date) makes the cron idempotent:
    // a duplicate tick on the same day is a no-op via ON CONFLICT DO NOTHING.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS hos_check_log (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
          driver_id VARCHAR NOT NULL,
          send_date TEXT NOT NULL,
          sent_at TIMESTAMP DEFAULT NOW(),
          UNIQUE (driver_id, send_date)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_hos_check_log_driver ON hos_check_log(driver_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_hos_check_log_date ON hos_check_log(send_date)`);
    } catch (e: any) {
      log(`⚠️ hos_check_log table: ${e.message}`);
    }

    // pending_uploads — context-based MMS BOL upload routing (PR #94).
    // Written when sendUploadLink fires with MMS_UPLOAD_ENABLED=true, read
    // by processMMSReply when an inbound MMS arrives. The migration SQL at
    // migrations/0003_mms_pending_uploads.sql is the source of truth; this
    // block mirrors it because the project relies on runtime ensureSchema
    // rather than a separate drizzle-kit migrate step (see history of
    // schema-completeness.test.ts). Without this block, the table never
    // exists in production, the dedup lookup in processMMSReply throws a
    // DrizzleQueryError, and every inbound MMS falls through to the
    // legacy BOL verifier instead of the new path.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pending_uploads (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          driver_phone TEXT NOT NULL,
          load_id VARCHAR NOT NULL REFERENCES loads(id),
          stage TEXT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          fulfilled_at TIMESTAMP,
          fulfilled_message_sid TEXT UNIQUE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_uploads_phone_unfulfilled ON pending_uploads (driver_phone, created_at DESC) WHERE fulfilled_at IS NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pending_uploads_load_recent ON pending_uploads (load_id, created_at DESC)`);
    } catch (e: any) {
      log(`⚠️ pending_uploads table: ${e.message}`);
    }

    log(`✅ Schema migration done (drivers ${ok}/${columns.length} cols, loads ${loadsOk}/${loadsColumns.length} cols, ratecon_intake + ratecon_corrections + hos_check_log + pending_uploads created)`);
  } catch (err: any) {
    log(`⚠️ ensureSchema error: ${err.message}`);
  }
}
