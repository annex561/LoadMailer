import type Database from "better-sqlite3";

/**
 * Idempotent: adds "items/collections" fields to ga_loads, if missing.
 * This avoids schema breakage when Replit redeploys.
 */
export function runGaItemsMigrations(db: Database.Database) {
  function hasColumn(table: string, col: string): boolean {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === col);
  }

  const adds: Array<{ col: string; sql: string }> = [
    { col: "item_status", sql: `ALTER TABLE ga_loads ADD COLUMN item_status TEXT` }, // open|in_progress|promised|escalated|closed
    { col: "item_owner", sql: `ALTER TABLE ga_loads ADD COLUMN item_owner TEXT` },   // dispatcher|manager|accounting
    { col: "next_action_at", sql: `ALTER TABLE ga_loads ADD COLUMN next_action_at TEXT` },
    { col: "next_action_type", sql: `ALTER TABLE ga_loads ADD COLUMN next_action_type TEXT` }, // call|email|text
    { col: "notes", sql: `ALTER TABLE ga_loads ADD COLUMN notes TEXT` },

    // Existing collections fields (safe if already added)
    { col: "last_touch_at", sql: `ALTER TABLE ga_loads ADD COLUMN last_touch_at TEXT` },
    { col: "promise_to_pay_at", sql: `ALTER TABLE ga_loads ADD COLUMN promise_to_pay_at TEXT` },
    { col: "escalated_at", sql: `ALTER TABLE ga_loads ADD COLUMN escalated_at TEXT` },
    { col: "escalation_level", sql: `ALTER TABLE ga_loads ADD COLUMN escalation_level TEXT` },
    { col: "escalation_reason", sql: `ALTER TABLE ga_loads ADD COLUMN escalation_reason TEXT` },
    { col: "payment_received_at", sql: `ALTER TABLE ga_loads ADD COLUMN payment_received_at TEXT` },
  ];

  for (const a of adds) {
    if (!hasColumn("ga_loads", a.col)) {
      db.exec(a.sql);
    }
  }

  // Helpful indices
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ga_items_status ON ga_loads(item_status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ga_items_next_action ON ga_loads(next_action_at);`);
}
