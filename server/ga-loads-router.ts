// server/ga-loads-router.ts - GA Loads API Router
import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "./ga-db";
import { scoreLoad } from "./ga-scoring";

const router: Router = express.Router();

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeRPM(rate_total: any, miles: any): number | null {
  const r = toNum(rate_total);
  const m = toNum(miles);
  if (!r || !m || m <= 0) return null;
  return Math.round((r / m) * 100) / 100;
}

function normalizeLoad(input: any): any {
  const load: any = {};

  load.id = input.id || crypto.randomUUID();
  load.source = input.source || "manual";

  load.origin_city = input.origin_city || null;
  load.origin_state = input.origin_state || null;
  load.origin_zip = input.origin_zip || null;

  load.dest_city = input.dest_city || null;
  load.dest_state = input.dest_state || null;
  load.dest_zip = input.dest_zip || null;

  load.pickup_dt = input.pickup_dt ? String(input.pickup_dt) : null;
  load.delivery_dt = input.delivery_dt ? String(input.delivery_dt) : null;

  load.miles = toNum(input.miles);
  load.deadhead_miles = toNum(input.deadhead_miles) ?? 0;

  load.rate_total = toNum(input.rate_total);
  load.rpm = toNum(input.rpm);
  if (!load.rpm) {
    const rpm = computeRPM(load.rate_total, load.miles);
    if (rpm) load.rpm = rpm;
  }

  load.equipment = input.equipment || null;
  load.weight_lbs = toNum(input.weight_lbs);
  load.length_ft = toNum(input.length_ft);

  load.broker_name = input.broker_name || null;
  load.broker_email = input.broker_email || null;
  load.broker_phone = input.broker_phone || null;

  load.status = input.status || "new";
  load.score = 0;
  load.notes = input.notes || null;
  load.raw_json = null;

  return load;
}

function upsertBroker({ broker_name, broker_email, broker_phone }: any) {
  const email = (broker_email || "").trim().toLowerCase();
  if (!email) return;

  const stmt = db.prepare(`
    INSERT INTO ga_brokers (name, email, phone)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name=excluded.name,
      phone=excluded.phone
  `);
  stmt.run(broker_name || null, email, broker_phone || null);
}

const insertLoadStmt = db.prepare(`
  INSERT INTO ga_loads (
    id, source,
    origin_city, origin_state, origin_zip,
    dest_city, dest_state, dest_zip,
    pickup_dt, delivery_dt,
    miles, deadhead_miles,
    rate_total, rpm,
    equipment, weight_lbs, length_ft,
    broker_name, broker_email, broker_phone,
    status, score, notes, raw_json
  ) VALUES (
    @id, @source,
    @origin_city, @origin_state, @origin_zip,
    @dest_city, @dest_state, @dest_zip,
    @pickup_dt, @delivery_dt,
    @miles, @deadhead_miles,
    @rate_total, @rpm,
    @equipment, @weight_lbs, @length_ft,
    @broker_name, @broker_email, @broker_phone,
    @status, @score, @notes, @raw_json
  )
  ON CONFLICT(id) DO UPDATE SET
    source=excluded.source,
    origin_city=excluded.origin_city,
    origin_state=excluded.origin_state,
    origin_zip=excluded.origin_zip,
    dest_city=excluded.dest_city,
    dest_state=excluded.dest_state,
    dest_zip=excluded.dest_zip,
    pickup_dt=excluded.pickup_dt,
    delivery_dt=excluded.delivery_dt,
    miles=excluded.miles,
    deadhead_miles=excluded.deadhead_miles,
    rate_total=excluded.rate_total,
    rpm=excluded.rpm,
    equipment=excluded.equipment,
    weight_lbs=excluded.weight_lbs,
    length_ft=excluded.length_ft,
    broker_name=excluded.broker_name,
    broker_email=excluded.broker_email,
    broker_phone=excluded.broker_phone,
    status=excluded.status,
    score=excluded.score,
    notes=excluded.notes,
    raw_json=excluded.raw_json
`);

router.post("/loads/ingest", (req: Request, res: Response) => {
  try {
    const payload = req.body || {};
    const list = Array.isArray(payload.loads) ? payload.loads : [payload];

    const inserted: any[] = [];

    const tx = db.transaction(() => {
      for (const item of list) {
        const load = normalizeLoad(item);

        const score = scoreLoad(load, {
          minRPM: payload.minRPM ?? 1.8,
          idealRPM: payload.idealRPM ?? 2.3,
          maxRPM: payload.maxRPM ?? 3.25,
        });
        load.score = score;

        upsertBroker(load);

        load.raw_json = JSON.stringify(item);

        insertLoadStmt.run(load);
        inserted.push({ id: load.id, score: load.score, rpm: load.rpm, status: load.status });
      }
    });

    tx();
    res.json({ ok: true, inserted_count: inserted.length, inserted });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/loads", (req: Request, res: Response) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const minScore = req.query.minScore ? Number(req.query.minScore) : null;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 100;

    let sql = `SELECT * FROM ga_loads WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (Number.isFinite(minScore)) {
      sql += ` AND score >= ?`;
      params.push(minScore);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, loads: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/loads/shortlist", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 10;
    const rows = db
      .prepare(`SELECT * FROM ga_loads WHERE status='new' ORDER BY score DESC, created_at DESC LIMIT ?`)
      .all(limit);
    res.json({ ok: true, loads: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/loads/:id/quote", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    db.prepare(`UPDATE ga_loads SET status='quoted' WHERE id=?`).run(id);

    const subject = `Quote Request: ${row.origin_city || ""}, ${row.origin_state || ""} → ${row.dest_city || ""}, ${row.dest_state || ""}`;
    const body = [
      `Hi ${row.broker_name || "there"},`,
      ``,
      `We can cover the load:`,
      `• Route: ${row.origin_city || ""}, ${row.origin_state || ""} → ${row.dest_city || ""}, ${row.dest_state || ""}`,
      `• Pickup: ${row.pickup_dt || "TBD"}`,
      `• Miles: ${row.miles ?? "TBD"}`,
      `• Equipment: ${row.equipment || "Box Truck"}`,
      ``,
      `Our rate: $${row.rate_total ?? "____"} all-in.`,
      ``,
      `Please send the rate confirmation and broker packet requirements.`,
      ``,
      `Thanks,`,
      `Dispatch`,
    ].join("\n");

    res.json({ ok: true, id, status: "quoted", email: { to: row.broker_email, subject, body } });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/loads/:id/book", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    db.prepare(`UPDATE ga_loads SET status='booked' WHERE id=?`).run(id);
    res.json({ ok: true, id, status: "booked" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/loads/:id/dismiss", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    db.prepare(`UPDATE ga_loads SET status='dismissed' WHERE id=?`).run(id);
    res.json({ ok: true, id, status: "dismissed" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
