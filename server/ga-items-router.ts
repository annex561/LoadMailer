import express from "express";
import type Database from "better-sqlite3";
import db, { logActivity } from "./ga-db";
import {
  computeNextActionAfterTouch,
  computeNextActionAfterPromise,
  computeNextActionAfterEscalate,
  type TouchKind,
} from "./ga-next-action";

const router = express.Router();

function isoNow() {
  return new Date().toISOString();
}

/**
 * GET /api/ga/items
 * Returns invoice-sent & unpaid loads as "items" with action fields.
 */
router.get("/", (req, res) => {
  const dbi = db as Database.Database;

  const rows = dbi.prepare(`
    SELECT
      id,
      origin_city, origin_state, dest_city, dest_state,
      miles, rpm, score,
      broker_name, broker_email, broker_phone,
      invoice_number as invoice_id, invoice_status, invoice_amount as invoice_total,
      invoice_sent_at,
      invoice_paid_at as paid_at,
      item_status, item_owner, next_action_at, next_action_type, notes,
      last_touch_at, promise_to_pay_at, escalated_at, escalation_level, escalation_reason,
      collection_stage
    FROM ga_loads
    WHERE invoice_status IN ('sent')
      AND (invoice_paid_at IS NULL OR invoice_paid_at = '')
    ORDER BY COALESCE(next_action_at, invoice_sent_at) ASC
    LIMIT 500
  `).all();

  res.json({ ok: true, count: rows.length, items: rows });
});

/**
 * GET /api/ga/items/aging
 * Returns aging buckets based on invoice_sent_at
 */
router.get("/aging", (req, res) => {
  const dbi = db as Database.Database;

  const rows = dbi.prepare(`
    WITH base AS (
      SELECT
        id,
        COALESCE(invoice_sent_at, booked_at) AS sent_at,
        COALESCE(invoice_amount, booked_rate, 0) AS amount
      FROM ga_loads
      WHERE invoice_status IN ('sent')
        AND (invoice_paid_at IS NULL OR invoice_paid_at = '')
        AND COALESCE(invoice_sent_at, booked_at) IS NOT NULL
    ),
    aged AS (
      SELECT
        id,
        amount,
        CAST((julianday('now') - julianday(sent_at)) AS INTEGER) AS days_old
      FROM base
    )
    SELECT
      CASE
        WHEN days_old BETWEEN 0 AND 7 THEN '0-7'
        WHEN days_old BETWEEN 8 AND 14 THEN '8-14'
        WHEN days_old BETWEEN 15 AND 30 THEN '15-30'
        WHEN days_old BETWEEN 31 AND 60 THEN '31-60'
        WHEN days_old BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
      END AS bucket,
      COUNT(*) AS count,
      SUM(amount) AS total
    FROM aged
    GROUP BY bucket
  `).all() as Array<{ bucket: string; count: number; total: number }>;

  const order = ["0-7", "8-14", "15-30", "31-60", "61-90", "90+"];

  const normalized = order.map((b) => {
    const hit = rows.find((r) => r.bucket === b);
    return { label: b, count: hit?.count ?? 0, total: Number(hit?.total ?? 0) };
  });

  const total_unpaid = normalized.reduce((acc, x) => acc + x.total, 0);
  const total_count = normalized.reduce((acc, x) => acc + x.count, 0);

  res.json({
    ok: true,
    as_of: new Date().toISOString(),
    buckets: normalized,
    total_unpaid,
    total_count,
  });
});

/**
 * POST /api/ga/items/:id/actions/touch
 * Body: { actor?: string, kind?: "SOFT"|"PAST_DUE"|"FINAL", channel?: "call"|"email"|"text", note?: string }
 */
router.post("/:id/actions/touch", (req, res) => {
  const dbi = db as Database.Database;
  const id = req.params.id;
  const actor = String(req.body?.actor || "dispatcher");
  const kind = String(req.body?.kind ?? "SOFT").toUpperCase() as TouchKind;
  const channel = String(req.body?.channel || "email").toUpperCase();
  const note = String(req.body?.note || "");

  const now = isoNow();
  const { nextActionAtISO, nextActionType } = computeNextActionAfterTouch(kind);

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      last_touch_at = ?,
      next_action_at = ?,
      next_action_type = ?,
      item_status = CASE WHEN item_status IS NULL OR item_status = 'open' THEN 'in_progress' ELSE item_status END,
      collection_stage = CASE
        WHEN ? = 'SOFT' THEN COALESCE(collection_stage, 'soft')
        WHEN ? = 'PAST_DUE' THEN 'firm'
        WHEN ? = 'FINAL' THEN 'final'
        ELSE collection_stage
      END
    WHERE id = ?
  `).run(now, nextActionAtISO, nextActionType, kind, kind, kind, id);

  try { logActivity(id, "ITEM_TOUCH", actor, { kind, channel, note, next_action_at: nextActionAtISO }); } catch {}

  res.json({ ok: true, id, kind, next_action_at: nextActionAtISO, next_action_type: nextActionType });
});

/**
 * POST /api/ga/items/:id/actions/promise
 * Body: { actor?: string, promise_to_pay_at: string (ISO), note?: string }
 */
router.post("/:id/actions/promise", (req, res) => {
  const dbi = db as Database.Database;
  const id = req.params.id;
  const actor = String(req.body?.actor || "dispatcher");
  const promise = String(req.body?.promise_to_pay_at || "").trim();
  const note = String(req.body?.note || "");

  if (!promise || Number.isNaN(Date.parse(promise))) {
    return res.status(400).json({ ok: false, error: "promise_to_pay_at must be a valid ISO date/time" });
  }

  const { nextActionAtISO, nextActionType } = computeNextActionAfterPromise(promise);

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      promise_to_pay_at = ?,
      item_status = 'promised',
      next_action_at = ?,
      next_action_type = ?
    WHERE id = ?
  `).run(new Date(promise).toISOString(), nextActionAtISO, nextActionType, id);

  try { logActivity(id, "ITEM_PROMISE", actor, { promise_to_pay_at: promise, note, next_action_at: nextActionAtISO }); } catch {}

  res.json({ ok: true, id, promise_to_pay_at: promise, next_action_at: nextActionAtISO, next_action_type: nextActionType });
});

/**
 * POST /api/ga/items/:id/actions/escalate
 * Body: { actor?: string, level: "L1"|"L2"|"L3", reason?: string, note?: string }
 */
router.post("/:id/actions/escalate", (req, res) => {
  const dbi = db as Database.Database;
  const id = req.params.id;
  const actor = String(req.body?.actor || "manager");
  const level = String(req.body?.level || "L1").toUpperCase();
  const reason = String(req.body?.reason || "Past due - escalated");
  const note = String(req.body?.note || "");

  if (!["L1", "L2", "L3"].includes(level)) {
    return res.status(400).json({ ok: false, error: "level must be one of L1, L2, L3" });
  }

  const now = isoNow();
  const { nextActionAtISO, nextActionType } = computeNextActionAfterEscalate();

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      escalated_at = ?,
      escalation_level = ?,
      escalation_reason = ?,
      item_status = 'escalated',
      item_owner = 'accounting',
      collection_stage = 'escalated',
      next_action_at = ?,
      next_action_type = ?
    WHERE id = ?
  `).run(now, level, reason, nextActionAtISO, nextActionType, id);

  try { logActivity(id, "ITEM_ESCALATE", actor, { level, reason, note, next_action_at: nextActionAtISO }); } catch {}

  res.json({
    ok: true,
    id,
    level,
    next_action_at: nextActionAtISO,
    next_action_type: nextActionType,
  });
});

export { router as gaItemsRouter };
