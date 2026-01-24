import express from "express";
import type Database from "better-sqlite3";
import db, { logActivity } from "./ga-db";

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
      invoice_sent_at, invoice_created_at,
      invoice_paid_at as paid_at,
      item_status, item_owner, next_action_at, next_action_type, notes,
      last_touch_at, promise_to_pay_at, escalated_at, escalation_level, escalation_reason
    FROM ga_loads
    WHERE invoice_status IN ('sent')
      AND (invoice_paid_at IS NULL OR invoice_paid_at = '')
    ORDER BY COALESCE(next_action_at, invoice_sent_at) ASC
  `).all();

  res.json({ ok: true, count: rows.length, items: rows });
});

/**
 * POST /api/ga/items/:id/actions/touch
 * Body: { actor?: string, channel?: "call"|"email"|"text", note?: string }
 */
router.post("/:id/actions/touch", (req, res) => {
  const dbi = db as Database.Database;
  const id = req.params.id;
  const actor = String(req.body?.actor || "dispatcher");
  const channel = String(req.body?.channel || "call");
  const note = String(req.body?.note || "");

  const now = isoNow();

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      last_touch_at = ?,
      item_status = COALESCE(item_status, 'in_progress'),
      next_action_type = COALESCE(next_action_type, ?),
      notes = COALESCE(notes, '')
    WHERE id = ?
  `).run(now, channel, id);

  try { logActivity(id, "ITEM_TOUCH", actor, { channel, note, at: now }); } catch {}

  res.json({ ok: true, id, updated: r.changes, last_touch_at: now });
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

  if (!promise) return res.status(400).json({ ok: false, error: "promise_to_pay_at required (ISO string)" });

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      promise_to_pay_at = ?,
      item_status = 'promised',
      next_action_at = ?,
      next_action_type = COALESCE(next_action_type, 'call')
    WHERE id = ?
  `).run(promise, promise, id);

  try { logActivity(id, "ITEM_PROMISE", actor, { promise_to_pay_at: promise, note }); } catch {}

  res.json({ ok: true, id, updated: r.changes, promise_to_pay_at: promise });
});

/**
 * POST /api/ga/items/:id/actions/escalate
 * Body: { actor?: string, level: "L1"|"L2"|"L3", reason: string, note?: string }
 */
router.post("/:id/actions/escalate", (req, res) => {
  const dbi = db as Database.Database;
  const id = req.params.id;
  const actor = String(req.body?.actor || "manager");
  const level = String(req.body?.level || "L1");
  const reason = String(req.body?.reason || "").trim();
  const note = String(req.body?.note || "");

  if (!reason) return res.status(400).json({ ok: false, error: "reason required" });

  const now = isoNow();

  const r = dbi.prepare(`
    UPDATE ga_loads
    SET
      escalated_at = ?,
      escalation_level = ?,
      escalation_reason = ?,
      item_status = 'escalated',
      item_owner = 'accounting'
    WHERE id = ?
  `).run(now, level, reason, id);

  try { logActivity(id, "ITEM_ESCALATE", actor, { level, reason, note, at: now }); } catch {}

  res.json({
    ok: true,
    id,
    updated: r.changes,
    escalated_at: now,
    escalation_level: level,
    escalation_reason: reason,
  });
});

export { router as gaItemsRouter };
