import express from "express";

export function buildGaArRouter(opts: {
  gaDb: any;
  loadsTable: string;
  gaLog: (loadId: string, action: string, actor: string, details?: any) => void;
}) {
  const { gaDb, loadsTable, gaLog } = opts;
  const router = express.Router();

  const nowIso = () => new Date().toISOString();

  function getLoad(id: string) {
    return gaDb.prepare(`SELECT * FROM ${loadsTable} WHERE id=?`).get(id) as any;
  }

  router.post("/loads/:id/invoice/create", (req, res) => {
    const id = req.params.id;
    const load = getLoad(id);
    if (!load) return res.status(404).json({ ok: false, error: "Load not found" });
    if (load.status !== "booked") return res.status(400).json({ ok: false, error: "Load must be booked first" });

    const invoice_amount =
      typeof req.body?.invoice_amount === "number"
        ? req.body.invoice_amount
        : typeof load.booked_rate === "number"
          ? load.booked_rate
          : null;

    const invoice_number =
      String(req.body?.invoice_number ?? "").trim() || `INV-${id.slice(0, 8).toUpperCase()}`;

    gaDb.prepare(
      `UPDATE ${loadsTable}
       SET invoice_status=?,
           invoice_number=?,
           invoice_amount=?
       WHERE id=?`
    ).run("draft", invoice_number, invoice_amount, id);

    gaLog(id, "invoice_create", "system", { invoice_number, invoice_amount });

    return res.json({ ok: true, load: getLoad(id) });
  });

  router.post("/loads/:id/invoice/send", (req, res) => {
    const id = req.params.id;
    const load = getLoad(id);
    if (!load) return res.status(404).json({ ok: false, error: "Load not found" });
    if (!load.invoice_number) return res.status(400).json({ ok: false, error: "Create invoice first" });

    gaDb.prepare(
      `UPDATE ${loadsTable}
       SET invoice_status=?,
           invoice_sent_at=?
       WHERE id=?`
    ).run("sent", nowIso(), id);

    gaLog(id, "invoice_sent", "system", { invoice_number: load.invoice_number });

    return res.json({ ok: true, load: getLoad(id) });
  });

  router.post("/loads/:id/payment/record", (req, res) => {
    const id = req.params.id;
    const load = getLoad(id);
    if (!load) return res.status(404).json({ ok: false, error: "Load not found" });

    const method = String(req.body?.payment_method ?? "").trim() || "unknown";
    const ref = String(req.body?.payment_ref ?? "").trim() || null;

    gaDb.prepare(
      `UPDATE ${loadsTable}
       SET invoice_status=?,
           invoice_paid_at=?,
           payment_method=?,
           payment_ref=?
       WHERE id=?`
    ).run("paid", nowIso(), method, ref, id);

    gaLog(id, "payment_recorded", "system", { payment_method: method, payment_ref: ref });

    return res.json({ ok: true, load: getLoad(id) });
  });

  router.get("/ar", (req, res) => {
    const rows = gaDb
      .prepare(
        `SELECT id, invoice_number, invoice_amount, invoice_sent_at, booked_rate
         FROM ${loadsTable}
         WHERE invoice_status='sent' AND (invoice_paid_at IS NULL OR invoice_paid_at='')
         ORDER BY invoice_sent_at ASC`
      )
      .all() as any[];

    const now = Date.now();
    const bucket: Record<string, number> = { "0-7": 0, "8-14": 0, "15-30": 0, "31+": 0 };
    let total = 0;

    for (const r of rows) {
      const amt = typeof r.invoice_amount === "number" ? r.invoice_amount : typeof r.booked_rate === "number" ? r.booked_rate : 0;
      total += amt;

      const sent = r.invoice_sent_at ? Date.parse(r.invoice_sent_at) : NaN;
      const days = Number.isFinite(sent) ? Math.floor((now - sent) / (1000 * 60 * 60 * 24)) : 0;

      if (days <= 7) bucket["0-7"] += amt;
      else if (days <= 14) bucket["8-14"] += amt;
      else if (days <= 30) bucket["15-30"] += amt;
      else bucket["31+"] += amt;
    }

    return res.json({ ok: true, total_ar: total, buckets: bucket, open_invoices: rows });
  });

  return router;
}
