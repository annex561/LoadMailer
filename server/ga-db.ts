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

// Schema (idempotent)
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

export default db;
