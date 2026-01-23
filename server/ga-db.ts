// server/ga-db.ts - SQLite database for GA Loads
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// Ensure data folder exists
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// SQLite file
const dbPath = path.join(dataDir, "traqiq.db");
const db = new Database(dbPath);

// Pragmas for stability/perf
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Base schema (idempotent)
db.exec(`
CREATE TABLE IF NOT EXISTS ga_brokers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS ga_loads (
  id TEXT PRIMARY KEY,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),

  origin_city TEXT,
  origin_state TEXT,
  origin_zip TEXT,

  dest_city TEXT,
  dest_state TEXT,
  dest_zip TEXT,

  pickup_dt TEXT,
  delivery_dt TEXT,

  miles REAL,
  deadhead_miles REAL,

  rate_total REAL,
  rpm REAL,

  equipment TEXT,
  weight_lbs REAL,
  length_ft REAL,

  broker_name TEXT,
  broker_email TEXT,
  broker_phone TEXT,

  status TEXT DEFAULT 'new',
  score INTEGER DEFAULT 0,

  notes TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ga_loads_created_at ON ga_loads(created_at);
CREATE INDEX IF NOT EXISTS idx_ga_loads_score ON ga_loads(score);
CREATE INDEX IF NOT EXISTS idx_ga_loads_status ON ga_loads(status);
`);

// Revenue layer migration - add new columns safely (idempotent)
function safeAddColumn(table: string, column: string, type: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e: any) {
    // Column already exists - ignore
    if (!e.message?.includes("duplicate column")) {
      console.warn(`Migration warning: ${e.message}`);
    }
  }
}

// Add revenue pipeline columns to ga_loads
safeAddColumn("ga_loads", "offered_at", "TEXT");
safeAddColumn("ga_loads", "booked_at", "TEXT");
safeAddColumn("ga_loads", "offered_rate", "REAL");
safeAddColumn("ga_loads", "booked_rate", "REAL");
safeAddColumn("ga_loads", "assigned_truck_id", "TEXT");
safeAddColumn("ga_loads", "assigned_driver_id", "TEXT");
safeAddColumn("ga_loads", "broker_contact_json", "TEXT");
safeAddColumn("ga_loads", "override_reason", "TEXT");
safeAddColumn("ga_loads", "ratecon_path", "TEXT");
safeAddColumn("ga_loads", "ratecon_generated_at", "TEXT");

// Activity log table (append-only audit trail)
db.exec(`
CREATE TABLE IF NOT EXISTS ga_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  load_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (load_id) REFERENCES ga_loads(id)
);

CREATE INDEX IF NOT EXISTS idx_ga_activity_load_id ON ga_activity_log(load_id);
CREATE INDEX IF NOT EXISTS idx_ga_activity_created_at ON ga_activity_log(created_at);
`);

// Helper to log activity
export function logActivity(loadId: string, action: string, actor?: string, details?: any) {
  const detailsJson = details ? JSON.stringify(details) : null;
  db.prepare(`
    INSERT INTO ga_activity_log (load_id, action, actor, details)
    VALUES (?, ?, ?, ?)
  `).run(loadId, action, actor || "system", detailsJson);
}

export default db;
