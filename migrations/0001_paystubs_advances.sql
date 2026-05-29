-- Phase 1 paystub system: driver_advances + paystubs.
-- Idempotent + additive only. Safe to run against production.

CREATE TABLE IF NOT EXISTS driver_advances (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        varchar REFERENCES companies(id) ON DELETE RESTRICT,
  driver_id         varchar NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  amount            real NOT NULL,
  reason            text,
  weekly_repayment  real DEFAULT 0,
  balance_remaining real NOT NULL,
  status            text NOT NULL DEFAULT 'active',
  issued_at         timestamp DEFAULT now(),
  created_at        timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_advances_driver_id ON driver_advances (driver_id);

CREATE TABLE IF NOT EXISTS paystubs (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        varchar REFERENCES companies(id) ON DELETE RESTRICT,
  driver_id         varchar NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  week_start        text NOT NULL,
  week_end          text NOT NULL,
  load_count        integer NOT NULL DEFAULT 0,
  gross_pay         real NOT NULL DEFAULT 0,
  total_deductions  real NOT NULL DEFAULT 0,
  fuel_cost         real NOT NULL DEFAULT 0,
  advance_deduction real NOT NULL DEFAULT 0,
  net_pay           real NOT NULL DEFAULT 0,
  breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_path          text,
  pdf_url           text,
  status            text NOT NULL DEFAULT 'draft',
  finalized_at      timestamp,
  sent_at           timestamp,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paystubs_driver_id ON paystubs (driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS paystubs_driver_week_unique ON paystubs (driver_id, week_start);
