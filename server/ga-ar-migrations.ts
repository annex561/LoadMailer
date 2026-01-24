import Database from "better-sqlite3";

type Db = Database.Database;

function columnExists(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some((r) => r.name === column);
}

function ensureColumn(db: Db, table: string, column: string, ddl: string) {
  if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function runGaArMigrations(db: Db, loadsTable: string) {
  ensureColumn(db, loadsTable, "invoice_status", "invoice_status TEXT");
  ensureColumn(db, loadsTable, "invoice_number", "invoice_number TEXT");
  ensureColumn(db, loadsTable, "invoice_amount", "invoice_amount REAL");
  ensureColumn(db, loadsTable, "invoice_sent_at", "invoice_sent_at TEXT");
  ensureColumn(db, loadsTable, "invoice_paid_at", "invoice_paid_at TEXT");
  ensureColumn(db, loadsTable, "payment_method", "payment_method TEXT");
  ensureColumn(db, loadsTable, "payment_ref", "payment_ref TEXT");
}
