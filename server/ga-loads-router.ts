// server/ga-loads-router.ts - GA Loads API Router with Revenue Pipeline
import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import db, { logActivity } from "./ga-db";
import { scoreLoad } from "./ga-scoring";
import { recommendForLoad } from "./ga-recommend";
import { runGaArMigrations } from "./ga-ar-migrations";
import { buildGaArRouter } from "./ga-ar-router";
import { runGaItemsMigrations } from "./ga-items-migrations";
import { gaItemsRouter } from "./ga-items-router";
import { dispatchGate } from "./dispatch-gate-service";
import { db as pgDb } from "./db";
import { activityLog, loads as pgLoads } from "@shared/schema";
import { eq } from "drizzle-orm";
import { rateConService } from "./ratecon-service";
import { invoicingService } from "./invoicing-service";
import { calculateMiles } from "./services/distance-calculator";

const router: Router = express.Router();

// Run A/R migrations (idempotent)
runGaArMigrations(db, "ga_loads");

// Run Items migrations (idempotent)
runGaItemsMigrations(db);

// Mount A/R router
router.use(
  buildGaArRouter({
    gaDb: db,
    loadsTable: "ga_loads",
    gaLog: logActivity,
  })
);

// Mount Items router
router.use("/items", gaItemsRouter);

// Feature flag for booking pipeline
const ENABLE_GA_BOOKING = process.env.ENABLE_GA_BOOKING !== "0";

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

function nowIso(): string {
  return new Date().toISOString();
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

// =============================================
// BASIC ENDPOINTS
// =============================================

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
        logActivity(load.id, "ingested", "system", { source: load.source, score });
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
    const includeAssigned = req.query.includeAssigned === "true";

    // By default, exclude dispatched loads (they've been moved to Active Dispatch tracking)
    let sql = `SELECT * FROM ga_loads WHERE 1=1`;
    const params: any[] = [];

    if (!includeAssigned) {
      // Hide loads that have been dispatched (assigned and ready for tracking)
      sql += ` AND status NOT IN ('dispatched', 'in_transit', 'delivered')`;
    }

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
    // Only show actionable loads (not yet dispatched/in-transit/delivered)
    const rows = db
      .prepare(`SELECT * FROM ga_loads WHERE status NOT IN ('dispatched', 'in_transit', 'delivered') ORDER BY score DESC, created_at DESC LIMIT ?`)
      .all(limit);
    res.json({ ok: true, loads: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/loads/:id", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const row = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });
    res.json({ ok: true, load: row });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =============================================
// ACTIVITY LOG
// =============================================

router.get("/loads/:id/activity", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const rows = db
      .prepare(`SELECT * FROM ga_activity_log WHERE load_id=? ORDER BY created_at DESC LIMIT 100`)
      .all(id);
    res.json({ ok: true, activity: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =============================================
// AI TRUCK/DRIVER RECOMMENDATION
// =============================================

router.get("/loads/:id/recommend", async (req: Request, res: Response) => {
  const id = req.params.id;
  const load = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id) as any;
  if (!load) return res.status(404).json({ ok: false, error: "Load not found" });

  try {
    const rec = await recommendForLoad(load);
    logActivity(id, "recommend", "system", { message: "Generated truck/driver recommendations" });
    return res.json(rec);
  } catch (e: any) {
    logActivity(id, "recommend_error", "system", { error: e?.message ?? "Unknown recommend error" });
    return res.status(500).json({ ok: false, error: e?.message ?? "Recommend failed" });
  }
});

// =============================================
// LEGACY QUOTE ENDPOINT (for backwards compat)
// =============================================

router.post("/loads/:id/quote", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    db.prepare(`UPDATE ga_loads SET status='quoted' WHERE id=?`).run(id);
    logActivity(id, "quoted", req.body.actor || "dispatcher", { rate: row.rate_total });

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

// =============================================
// REVENUE PIPELINE ENDPOINTS
// =============================================

// OFFER - Mark load as offered with rate
router.post("/loads/:id/offer", (req: Request, res: Response) => {
  if (!ENABLE_GA_BOOKING) {
    return res.status(404).json({ ok: false, error: "Booking pipeline disabled" });
  }

  try {
    const id = String(req.params.id);
    const { offered_rate, notes, actor } = req.body || {};

    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    const rate = toNum(offered_rate) ?? row.rate_total;

    db.prepare(`
      UPDATE ga_loads 
      SET status='offered', offered_at=?, offered_rate=?, notes=COALESCE(?, notes)
      WHERE id=?
    `).run(nowIso(), rate, notes || null, id);

    logActivity(id, "offered", actor || "dispatcher", { offered_rate: rate, notes });

    res.json({ ok: true, id, status: "offered", offered_rate: rate });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// BOOK - Mark load as booked with truck/driver assignment
router.post("/loads/:id/book", async (req: Request, res: Response) => {
  if (!ENABLE_GA_BOOKING) {
    return res.status(404).json({ ok: false, error: "Booking pipeline disabled" });
  }

  try {
    const id = String(req.params.id);
    const { 
      booked_rate, 
      assigned_truck_id, 
      assigned_driver_id, 
      override_reason,
      notes, 
      actor,
      skip_dispatch_gate,
      company_id,
      status: requestedStatus
    } = req.body || {};

    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    let dispatchGateStatus = "N/A";

    if (assigned_truck_id && !skip_dispatch_gate) {
      try {
        await dispatchGate.validateBooking(assigned_truck_id, override_reason);
        const gateResult = await dispatchGate.getTruckGateStatus(assigned_truck_id);
        dispatchGateStatus = gateResult.status;
      } catch (gateErr: any) {
        if (gateErr.message?.includes("Booking Blocked")) {
          return res.status(400).json({ 
            ok: false, 
            error: gateErr.message,
            dispatch_status: "RED",
            requires_override: true
          });
        }
        console.warn("Dispatch gate check failed:", gateErr);
      }
    }

    const rate = toNum(booked_rate) ?? row.offered_rate ?? row.rate_total;
    
    // If driver is assigned, use 'dispatched' status to move to Active Dispatch
    // Otherwise default to 'booked'
    const finalStatus = requestedStatus || (assigned_driver_id ? 'dispatched' : 'booked');

    db.prepare(`
      UPDATE ga_loads 
      SET status=?, 
          booked_at=?, 
          booked_rate=?,
          assigned_truck_id=?,
          assigned_driver_id=?,
          override_reason=?,
          notes=COALESCE(?, notes)
      WHERE id=?
    `).run(
      finalStatus,
      nowIso(), 
      rate, 
      assigned_truck_id || null, 
      assigned_driver_id || null,
      override_reason || null,
      notes || null, 
      id
    );

    logActivity(id, "booked", actor || "dispatcher", { 
      booked_rate: rate, 
      assigned_truck_id, 
      assigned_driver_id,
      dispatch_gate_status: dispatchGateStatus,
      override_reason: override_reason || null
    });

    if (company_id) {
      try {
        await pgDb.insert(activityLog).values({
          companyId: company_id,
          entityType: "LOAD",
          entityId: id,
          action: "LOAD_BOOKED",
          actor: actor || "SYSTEM",
          details: { 
            truckId: assigned_truck_id, 
            bookedRate: rate, 
            overrideUsed: !!override_reason,
            dispatchGateStatus
          }
        });
      } catch (pgErr) {
        console.warn("PostgreSQL activity log failed:", pgErr);
      }
    }

    // Send SMS to driver if assigned
    let smsSent = false;
    if (assigned_driver_id) {
      try {
        const { storage } = await import("./storage");
        const driver = await storage.getDriver(assigned_driver_id);
        
        if (driver?.phone) {
          const baseUrl = process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN || 'https://traq-iq.replit.app';
          const loadViewUrl = `${baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl}/driver/load/${id}`;
          
          const message = 
            `TRAQ IQ - New Load Assigned\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `Load #${row.load_number || 'LOAD-' + Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 900000 + 100000)}\n\n` +
            `📍 ${row.origin_city || 'TBD'}, ${row.origin_state || ''}\n` +
            `   ↓\n` +
            `📍 ${row.dest_city || 'TBD'}, ${row.dest_state || ''}\n\n` +
            `💵 Rate: $${rate || 0}\n` +
            `🚛 Miles: ${row.miles || 'TBD'}\n` +
            `📅 Pickup: ${row.pickup_date || 'TBD'}\n\n` +
            `View & Accept:\n${loadViewUrl}\n\n` +
            `Reply YES to confirm or call dispatch with questions.`;
          
          const twilioClient = (await import("twilio")).default(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
          );
          const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
          
          if (twilioClient && twilioPhone) {
            await twilioClient.messages.create({
              to: driver.phone.startsWith('+') ? driver.phone : '+1' + driver.phone.replace(/\D/g, ''),
              from: twilioPhone,
              body: message
            });
            smsSent = true;
            console.log(`📱 SMS sent to driver ${driver.name} for load ${id}`);
          }
        }
      } catch (smsErr) {
        console.warn("Failed to send SMS to driver:", smsErr);
      }
    }

    // Copy load to PostgreSQL for tracking when booked (with or without driver)
    let pgLoadId: string | null = null;
    // Always copy to PostgreSQL when booking a load so it appears in Active Loads
    {
      try {
        const { storage } = await import("./storage");
        const { customers } = await import("@shared/schema");
        
        // Parse dates from GA load fields (pickup_dt, delivery_dt format: "2025-12-01" or "12/1/2025")
        const parseDate = (dateStr: string | null | undefined): Date => {
          if (!dateStr) return new Date();
          try {
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? new Date() : d;
          } catch {
            return new Date();
          }
        };
        
        // Get or create a default customer for tracking
        let defaultCustomerId: string;
        try {
          const existingCustomers = await pgDb.select({ id: customers.id }).from(customers).limit(1);
          if (existingCustomers.length > 0) {
            defaultCustomerId = existingCustomers[0].id;
          } else {
            // Create a default customer if none exists
            const [newCustomer] = await pgDb.insert(customers).values({
              name: row.broker_name || "Default Broker",
              email: row.broker_email || "broker@example.com",
              phone: row.broker_phone || "",
              companyName: row.broker_name || "Default Company",
              address: ""
            }).returning({ id: customers.id });
            defaultCustomerId = newCustomer.id;
            console.log(`✅ Created default customer for load tracking (ID: ${defaultCustomerId})`);
          }
        } catch (custErr) {
          console.warn("Could not get/create customer:", custErr);
          throw new Error("No valid customer for load tracking");
        }
        
        // Check if load already exists in PostgreSQL (by load number)
        const existingLoad = await pgDb
          .select()
          .from(pgLoads)
          .where(eq(pgLoads.loadNumber, row.load_number || id.slice(0, 8)))
          .limit(1);

        if (existingLoad.length === 0) {
          // Create load in PostgreSQL for tracking
          const [newLoad] = await pgDb.insert(pgLoads).values({
            loadNumber: row.load_number || id.slice(0, 8),
            customerId: defaultCustomerId,
            driverId: assigned_driver_id ? String(assigned_driver_id) : null,
            description: `${row.origin_city || 'TBD'}, ${row.origin_state || ''} to ${row.dest_city || 'TBD'}, ${row.dest_state || ''}`,
            originCity: row.origin_city || 'TBD',
            originState: row.origin_state || '',
            destCity: row.dest_city || 'TBD',
            destState: row.dest_state || '',
            pickupAddress: `${row.origin_city || 'TBD'}, ${row.origin_state || ''}`,
            pickupDate: parseDate(row.pickup_dt),
            pickupTime: "TBD",
            deliveryAddress: `${row.dest_city || 'TBD'}, ${row.dest_state || ''}`,
            deliveryDate: parseDate(row.delivery_dt),
            deliveryTime: "TBD",
            status: "dispatched",
            rate: rate || row.rate_total || 0,
            miles: row.miles || null,
            weight: row.weight || 0,
            equipmentType: row.equipment?.toLowerCase()?.replace(/\s+/g, '_') || "dry_van",
            companyId: company_id || null
          }).returning({ id: pgLoads.id });
          
          pgLoadId = newLoad?.id || null;
          console.log(`✅ Load ${row.load_number || id.slice(0, 8)} copied to PostgreSQL for tracking (ID: ${pgLoadId})`);
        } else {
          // Update existing load with driver assignment and city/state info
          await pgDb.update(pgLoads)
            .set({ 
              driverId: assigned_driver_id ? String(assigned_driver_id) : undefined,
              status: "dispatched",
              originCity: row.origin_city || undefined,
              originState: row.origin_state || undefined,
              destCity: row.dest_city || undefined,
              destState: row.dest_state || undefined
            })
            .where(eq(pgLoads.loadNumber, row.load_number || id.slice(0, 8)));
          
          pgLoadId = existingLoad[0].id;
          console.log(`✅ Load ${row.load_number || id.slice(0, 8)} updated in PostgreSQL with driver assignment`);
        }
      } catch (pgErr) {
        console.warn("Failed to copy load to PostgreSQL:", pgErr);
      }
    }

    res.json({ 
      ok: true, 
      id, 
      status: "booked", 
      booked_rate: rate,
      assigned_truck_id,
      assigned_driver_id,
      dispatch_gate_status: dispatchGateStatus,
      sms_sent: smsSent,
      pg_load_id: pgLoadId
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// SKIP - Skip/dismiss a load with reason
// DISPATCH NOW — manual dispatch button on RateCon Inbox row.
// Safety net for when auto-dispatch missed (parser failure, no driver linked, etc.)
router.post("/loads/:id/dispatch-now", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { driverId } = req.body || {};

    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found in inbox" });
    if (!row.load_number) return res.status(400).json({ ok: false, error: "Load has no load_number — cannot dispatch" });

    // If driverId provided, attach it to the Postgres load record before dispatch
    if (driverId) {
      await pgDb.update(pgLoads)
        .set({ driverId, status: 'confirmed' })
        .where(eq(pgLoads.loadNumber, row.load_number));
    }

    // Mirror driver assignment into ga_loads
    if (driverId) {
      db.prepare(`UPDATE ga_loads SET assigned_driver_id=?, status='dispatched' WHERE id=?`)
        .run(driverId, id);
    }

    const { gmailIngest } = await import("./services/gmail");
    await gmailIngest.resolveAndDispatch(row.load_number, {
      driverName: row.driver_name || undefined,
    });

    logActivity(id, "manual_dispatch", "dispatcher", { driverId: driverId || null });

    res.json({ ok: true, id, loadNumber: row.load_number, dispatched: true });
  } catch (err: any) {
    console.error("dispatch-now error:", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/loads/:id/skip", (req: Request, res: Response) => {
  if (!ENABLE_GA_BOOKING) {
    return res.status(404).json({ ok: false, error: "Booking pipeline disabled" });
  }

  try {
    const id = String(req.params.id);
    const { reason, actor } = req.body || {};

    db.prepare(`UPDATE ga_loads SET status='skipped', notes=COALESCE(?, notes) WHERE id=?`)
      .run(reason || null, id);

    logActivity(id, "skipped", actor || "dispatcher", { reason });

    res.json({ ok: true, id, status: "skipped" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// DISMISS - Alias for skip (backwards compat)
router.post("/loads/:id/dismiss", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { reason, actor } = req.body || {};

    db.prepare(`UPDATE ga_loads SET status='dismissed', notes=COALESCE(?, notes) WHERE id=?`)
      .run(reason || null, id);

    logActivity(id, "dismissed", actor || "dispatcher", { reason });

    res.json({ ok: true, id, status: "dismissed" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =============================================
// RATECON GENERATION TRIGGER
// =============================================

router.post("/loads/:id/ratecon/generate", async (req: Request, res: Response) => {
  if (!ENABLE_GA_BOOKING) {
    return res.status(404).json({ ok: false, error: "Booking pipeline disabled" });
  }

  try {
    const id = String(req.params.id);
    const { actor, company_id, pg_load_id } = req.body || {};
    
    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    if (row.status !== "booked") {
      return res.status(400).json({ ok: false, error: "Load must be booked before generating RateCon" });
    }

    const rateconPath = `/documents/ratecons/RC-${id.slice(0, 8)}.pdf`;
    
    db.prepare(`
      UPDATE ga_loads 
      SET ratecon_path=?, ratecon_generated_at=?, status='scheduled'
      WHERE id=?
    `).run(rateconPath, nowIso(), id);

    logActivity(id, "ratecon_generated", actor || "system", { path: rateconPath });

    if (pg_load_id && company_id) {
      try {
        await rateConService.generateRateCon(pg_load_id, actor || "SYSTEM");
      } catch (pgErr) {
        console.warn("PostgreSQL RateCon generation failed:", pgErr);
      }
    } else if (company_id) {
      try {
        await pgDb.insert(activityLog).values({
          companyId: company_id,
          entityType: "LOAD",
          entityId: id,
          action: "RATECON_GENERATED",
          actor: actor || "SYSTEM",
          details: { path: rateconPath, version: 1 }
        });
      } catch (pgErr) {
        console.warn("PostgreSQL activity log failed:", pgErr);
      }
    }

    res.json({ 
      ok: true, 
      id, 
      ratecon_path: rateconPath,
      status: "scheduled",
      message: "RateCon generated successfully. Load moved to scheduled status."
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =============================================
// FACTORING / INVOICING
// =============================================

router.post("/loads/:id/package-for-factoring", async (req: Request, res: Response) => {
  if (!ENABLE_GA_BOOKING) {
    return res.status(404).json({ ok: false, error: "Booking pipeline disabled" });
  }

  try {
    const id = String(req.params.id);
    const { actor, pg_load_id, company_id } = req.body || {};
    
    const row: any = db.prepare(`SELECT * FROM ga_loads WHERE id=?`).get(id);
    if (!row) return res.status(404).json({ ok: false, error: "Load not found" });

    if (row.status !== "scheduled" && row.status !== "delivered") {
      return res.status(400).json({ 
        ok: false, 
        error: "Load must be scheduled or delivered before packaging for factoring" 
      });
    }

    if (!row.ratecon_path || !row.pod_path) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing documents. Both RateCon and POD are required for factoring.",
        missing: {
          ratecon: !row.ratecon_path,
          pod: !row.pod_path
        }
      });
    }

    db.prepare(`
      UPDATE ga_loads 
      SET status='invoiced', invoiced_at=?
      WHERE id=?
    `).run(nowIso(), id);

    logActivity(id, "packaged_for_factoring", actor || "system", { 
      ratecon: row.ratecon_path, 
      pod: row.pod_path 
    });

    let pgInvoice = null;
    if (pg_load_id) {
      try {
        const result = await invoicingService.packageForFactoring(pg_load_id, actor || "SYSTEM");
        pgInvoice = result.invoice;
      } catch (pgErr: any) {
        console.warn("PostgreSQL invoicing failed:", pgErr.message);
      }
    } else if (company_id) {
      try {
        await pgDb.insert(activityLog).values({
          companyId: company_id,
          entityType: "LOAD",
          entityId: id,
          action: "PACKAGED_FOR_FACTORING",
          actor: actor || "SYSTEM",
          details: { ratecon: row.ratecon_path, pod: row.pod_path }
        });
      } catch (pgErr) {
        console.warn("PostgreSQL activity log failed:", pgErr);
      }
    }

    res.json({ 
      ok: true, 
      id, 
      status: "invoiced",
      package: {
        ratecon: row.ratecon_path,
        pod: row.pod_path
      },
      pg_invoice: pgInvoice,
      message: "Load packaged for factoring successfully."
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// =============================================
// PIPELINE STATS
// =============================================

// Deploy sentinel — used to verify Railway picked up latest build
router.get("/_version", (_req: Request, res: Response) => {
  res.json({ ok: true, version: "2026-04-22-cleanup-pg-first", hasDispatchNow: true, hasSopPage: true, hasOpsMonitor: true, hasParseDedup: true, hasOpsUI: true, hasSettlements: true, hasMarkDelivered: true, hasStatementsCron: true, hasTokenBackfill: true, hasDriverPhotos: true, hasGeofence: true, hasNominatim: true, hasPhotoTab: true, hasDispatchTrackingLink: true, hasPhotoApproval: true, hasDriverCheckin: true, hasFuelInsuranceDeductions: true, hasMyPayPortal: true, hasDriverPortal: true, hasDriverPreferences: true, hasSmsPortalFooter: true, hasDriverOnboarding: true, hasLazyRoutes: true });
});

// Backfill load_number on ga_loads rows from raw_json.loadNumber where column is null
router.post("/loads/backfill-load-number", (_req: Request, res: Response) => {
  try {
    const rows: any[] = db.prepare(
      `SELECT id, raw_json FROM ga_loads WHERE (load_number IS NULL OR load_number = '') AND raw_json IS NOT NULL`
    ).all();

    const update = db.prepare(`UPDATE ga_loads SET load_number=? WHERE id=?`);
    const updated: Array<{ id: string; loadNumber: string }> = [];
    const skipped: string[] = [];

    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.raw_json);
        const ln = String(parsed?.loadNumber || '').replace(/^#/, '').trim();
        if (ln) {
          update.run(ln, r.id);
          updated.push({ id: r.id, loadNumber: ln });
        } else {
          skipped.push(r.id);
        }
      } catch {
        skipped.push(r.id);
      }
    }

    res.json({ ok: true, scanned: rows.length, updated: updated.length, skipped: skipped.length, samples: updated.slice(0, 10) });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// POST /api/ga/loads/cleanup-garbage — deletes skeleton rows left behind by
// failed RateCon parses: loadNumber matching RC-<timestamp> AND origin/dest
// of Unknown AND rate 0. Deletes from BOTH ga_loads (SQLite) and loads (Postgres).
// Safe to re-run; idempotent.
router.post("/loads/cleanup-garbage", async (_req: Request, res: Response) => {
  try {
    // Postgres is source of truth. Find RC-<timestamp> rows with Unknown/empty
    // origin+dest AND rate 0. Delete them. Mirror the delete into ga_loads.
    const { and, eq: dEq, or, isNull, sql } = await import('drizzle-orm');

    const pgRows: any[] = await pgDb
      .select({ id: pgLoads.id, loadNumber: pgLoads.loadNumber })
      .from(pgLoads)
      .where(
        and(
          sql`${pgLoads.loadNumber} ~ '^RC-[0-9]{10,}$'`,
          or(isNull(pgLoads.pickupAddress), dEq(pgLoads.pickupAddress, 'Unknown'), dEq(pgLoads.pickupAddress, '')),
          or(isNull(pgLoads.deliveryAddress), dEq(pgLoads.deliveryAddress, 'Unknown'), dEq(pgLoads.deliveryAddress, '')),
          or(isNull(pgLoads.rate), dEq(pgLoads.rate, 0)),
        )
      );

    const loadNumbers = Array.from(new Set(pgRows.map((r: any) => String(r.loadNumber)).filter(Boolean)));

    let pgDeleted = 0;
    if (loadNumbers.length > 0) {
      const { inArray } = await import('drizzle-orm');
      const result: any = await pgDb
        .delete(pgLoads)
        .where(inArray(pgLoads.loadNumber, loadNumbers))
        .returning({ id: pgLoads.id });
      pgDeleted = Array.isArray(result) ? result.length : 0;
    }

    // Also scrub ga_loads mirror rows if any remain.
    let gaDeleted = 0;
    if (loadNumbers.length > 0) {
      const placeholders = loadNumbers.map(() => '?').join(',');
      const gaStmt = db.prepare(
        `DELETE FROM ga_loads WHERE load_number IN (${placeholders})`
      );
      const info = gaStmt.run(...loadNumbers);
      gaDeleted = Number(info.changes || 0);
    }

    res.json({ ok: true, pgDeleted, gaDeleted, count: loadNumbers.length, samples: loadNumbers.slice(0, 10) });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/stats", (req: Request, res: Response) => {
  try {
    const stats = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(CASE WHEN booked_rate IS NOT NULL THEN booked_rate ELSE rate_total END) as total_revenue
      FROM ga_loads
      GROUP BY status
    `).all();

    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_loads,
        COUNT(CASE WHEN status='booked' THEN 1 END) as booked_loads,
        SUM(CASE WHEN status='booked' THEN booked_rate END) as booked_revenue
      FROM ga_loads
    `).get();

    res.json({ ok: true, by_status: stats, totals });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// POST /api/ga/loads/fix-broker-info - Fix broker info from raw_json for existing loads
router.post("/loads/fix-broker-info", async (req: Request, res: Response) => {
  try {
    const loadsWithRawJson = db.prepare(`
      SELECT id, raw_json, broker_name, broker_email, broker_phone, dispatcher_name, driver_name
      FROM ga_loads 
      WHERE raw_json IS NOT NULL
    `).all() as any[];
    
    console.log(`🔧 Fixing broker info for ${loadsWithRawJson.length} loads from raw_json...`);
    
    let updated = 0;
    for (const load of loadsWithRawJson) {
      try {
        const parsed = JSON.parse(load.raw_json);
        if (parsed.brokerEmail || parsed.brokerPhone || parsed.dispatcherName || parsed.driverName) {
          db.prepare(`
            UPDATE ga_loads SET 
              broker_email = COALESCE(?, broker_email),
              broker_phone = COALESCE(?, broker_phone),
              dispatcher_name = COALESCE(?, dispatcher_name),
              driver_name = COALESCE(?, driver_name)
            WHERE id = ?
          `).run(
            parsed.brokerEmail || null,
            parsed.brokerPhone || null,
            parsed.dispatcherName || null,
            parsed.driverName || null,
            load.id
          );
          updated++;
          logActivity(load.id, "BROKER_INFO_FIXED", "system", { 
            brokerEmail: parsed.brokerEmail,
            brokerPhone: parsed.brokerPhone,
            dispatcherName: parsed.dispatcherName,
            driverName: parsed.driverName
          });
        }
      } catch (parseErr) {
        console.warn(`⚠️ Could not parse raw_json for load ${load.id}`);
      }
    }
    
    // Also update Gmail-sourced loads to 'booked' status (rate confirmations are already booked)
    const statusResult = db.prepare(`
      UPDATE ga_loads SET status = 'booked' 
      WHERE source = 'gmail' AND status = 'new'
    `).run();
    const statusUpdated = statusResult.changes;
    
    console.log(`✅ Fixed broker info for ${updated} loads, updated ${statusUpdated} to booked status`);
    res.json({ ok: true, updated, statusUpdated, total: loadsWithRawJson.length });
  } catch (err: any) {
    console.error('❌ Error fixing broker info:', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// POST /api/ga/loads/calculate-all-miles - Calculate miles for all loads missing miles (MUST be before /:id routes)
router.post("/loads/calculate-all-miles", async (req: Request, res: Response) => {
  try {
    const loadsWithoutMiles = db.prepare(`
      SELECT id, origin_city, origin_state, dest_city, dest_state, rate_total 
      FROM ga_loads 
      WHERE (miles IS NULL OR miles = 0) 
      AND origin_city IS NOT NULL AND dest_city IS NOT NULL
    `).all() as any[];
    
    console.log(`📍 Calculating miles for ${loadsWithoutMiles.length} loads without miles...`);
    
    const results: Array<{id: string, miles: number, rpm: number | null}> = [];
    
    for (const load of loadsWithoutMiles) {
      const origin = [load.origin_city, load.origin_state].filter(Boolean).join(', ');
      const dest = [load.dest_city, load.dest_state].filter(Boolean).join(', ');
      
      const miles = await calculateMiles(origin, dest);
      if (miles) {
        const rpm = load.rate_total && miles > 0 ? Math.round((load.rate_total / miles) * 100) / 100 : null;
        
        db.prepare(`UPDATE ga_loads SET miles = ?, rpm = ?, score = ? WHERE id = ?`)
          .run(miles, rpm, scoreLoad({ ...load, miles, rpm }), load.id);
        
        logActivity(load.id, "MILES_CALCULATED", "system", { miles, rpm, origin, dest });
        results.push({ id: load.id, miles, rpm });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    
    console.log(`✅ Calculated miles for ${results.length} loads`);
    res.json({ ok: true, updated: results.length, results });
  } catch (err: any) {
    console.error('❌ Error calculating miles:', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// POST /api/ga/loads/:id/calculate-miles - Calculate missing miles for a load
router.post("/loads/:id/calculate-miles", async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const load = db.prepare(`SELECT * FROM ga_loads WHERE id = ?`).get(id) as any;
    if (!load) {
      return res.status(404).json({ ok: false, error: "Load not found" });
    }
    
    if (load.miles && load.miles > 0) {
      return res.json({ ok: true, miles: load.miles, message: "Miles already set" });
    }
    
    const origin = [load.origin_city, load.origin_state].filter(Boolean).join(', ');
    const dest = [load.dest_city, load.dest_state].filter(Boolean).join(', ');
    
    if (!origin || !dest) {
      return res.status(400).json({ ok: false, error: "Missing origin or destination" });
    }
    
    const miles = await calculateMiles(origin, dest);
    if (!miles) {
      return res.status(500).json({ ok: false, error: "Could not calculate distance" });
    }
    
    const rpm = load.rate_total && miles > 0 ? Math.round((load.rate_total / miles) * 100) / 100 : null;
    
    db.prepare(`UPDATE ga_loads SET miles = ?, rpm = ?, score = ? WHERE id = ?`)
      .run(miles, rpm, scoreLoad({ ...load, miles, rpm }), id);
    
    logActivity(id, "MILES_CALCULATED", "system", { miles, rpm, origin, dest });
    
    res.json({ ok: true, miles, rpm });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
