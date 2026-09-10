// Admin CRUD for owner-operator insurance certificates (compliance_documents,
// type = 'coi_*'). Backs client/src/pages/driver-coverage.tsx and feeds the
// Coverage Verified interlock on the Trip Lease Addendum.
//
// THE ONE RULE IN THIS FILE: a COI row is written with truck_id = NULL, always.
//
// server/dispatch-gate-service.ts selects compliance_documents BY truck_id and returns
// RED on any expired row, and validateBooking() THROWS "Booking Blocked" from
// server/ga-loads-router.ts on the booking path. Attaching a COI to a truck therefore
// hard-blocks that truck from booking the moment the certificate lapses. That may
// eventually be desirable, but it is a live behaviour change to a working workflow and
// it is not in scope here. Driver-scoped rows are invisible to the dispatch gate.
//
// Regression guard: server/__tests__/coverage-routes.test.ts

import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { REQUIRED_COI_TYPES, evaluateCoverage, coverageFailureReason } from './coi-service';

const router = Router();

/** Strip any caller-supplied truck_id. See the file header — this is load-bearing. */
export function sanitizeCoiInput(body: any): {
  driverId: string;
  type: string;
  expiryDate: Date;
  filePath: string | null;
  status: string;
  truckId: null;
} | { error: string } {
  const driverId = String(body?.driverId ?? '').trim();
  if (!driverId) return { error: 'driverId is required' };

  const type = String(body?.type ?? '').trim();
  if (!type) return { error: 'type is required' };
  if (!(REQUIRED_COI_TYPES as readonly string[]).includes(type)) {
    return { error: `type must be one of: ${REQUIRED_COI_TYPES.join(', ')}` };
  }

  const raw = body?.expiryDate;
  const expiryDate = raw ? new Date(raw) : null;
  if (!expiryDate || Number.isNaN(expiryDate.getTime())) {
    return { error: 'expiryDate is required and must be a valid date' };
  }

  const status = String(body?.status ?? 'active').trim() || 'active';
  const filePath = body?.filePath ? String(body.filePath) : null;

  return { driverId, type, expiryDate, filePath, status, truckId: null };
}

/** GET /api/coverage/drivers — split-authority drivers with their coverage verdict. */
router.get('/drivers', async (_req, res) => {
  try {
    const d = await db.execute(sql`
      SELECT id, name, phone,
             COALESCE(split_authority_enabled, FALSE) AS split_authority_enabled,
             own_mc_number, own_dot_number,
             COALESCE(power_unit_type, 'box_truck') AS power_unit_type
      FROM drivers
      ORDER BY COALESCE(split_authority_enabled, FALSE) DESC, name ASC
    `);
    const docs = await db.execute(sql`
      SELECT id, driver_id, type, expiry_date, status, file_path
      FROM compliance_documents
      WHERE driver_id IS NOT NULL
      ORDER BY expiry_date ASC
    `);

    const byDriver = new Map<string, any[]>();
    for (const row of ((docs as any).rows ?? [])) {
      const list = byDriver.get(row.driver_id) ?? [];
      list.push({
        id: row.id,
        type: row.type,
        expiryDate: row.expiry_date,
        status: row.status,
        filePath: row.file_path,
      });
      byDriver.set(row.driver_id, list);
    }

    const now = new Date();
    const drivers = ((d as any).rows ?? []).map((row: any) => {
      const documents = byDriver.get(row.id) ?? [];
      const status = evaluateCoverage(
        documents.map((x) => ({ type: x.type, expiryDate: new Date(x.expiryDate), status: x.status })),
        now,
      );
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        splitAuthorityEnabled: row.split_authority_enabled === true,
        ownMcNumber: row.own_mc_number,
        ownDotNumber: row.own_dot_number,
        powerUnitType: row.power_unit_type,
        documents,
        coverage: { ...status, reason: coverageFailureReason(status) },
      };
    });

    res.json({ ok: true, requiredTypes: REQUIRED_COI_TYPES, drivers });
  } catch (err: any) {
    console.error('[coverage] list failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'failed to load coverage' });
  }
});

/** POST /api/coverage/documents — add a certificate. truck_id is forced NULL. */
router.post('/documents', async (req, res) => {
  const input = sanitizeCoiInput(req.body);
  if ('error' in input) return res.status(400).json({ error: input.error });
  try {
    const r = await db.execute(sql`
      INSERT INTO compliance_documents
        (company_id, driver_id, truck_id, type, expiry_date, file_path, status, created_at, updated_at)
      SELECT company_id, ${input.driverId}, NULL, ${input.type}, ${input.expiryDate},
             ${input.filePath}, ${input.status}, NOW(), NOW()
      FROM drivers WHERE id = ${input.driverId}
      RETURNING id
    `);
    const id = (r as any).rows?.[0]?.id;
    if (!id) return res.status(404).json({ error: 'driver not found' });
    res.json({ ok: true, id });
  } catch (err: any) {
    console.error('[coverage] insert failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'failed to add certificate' });
  }
});

/** PATCH /api/coverage/documents/:id — update expiry or status. Never sets truck_id. */
router.patch('/documents/:id', async (req, res) => {
  try {
    const expiry = req.body?.expiryDate ? new Date(req.body.expiryDate) : null;
    if (req.body?.expiryDate && (!expiry || Number.isNaN(expiry.getTime()))) {
      return res.status(400).json({ error: 'expiryDate must be a valid date' });
    }
    const status = req.body?.status ? String(req.body.status) : null;
    await db.execute(sql`
      UPDATE compliance_documents
      SET expiry_date = COALESCE(${expiry}, expiry_date),
          status = COALESCE(${status}, status),
          updated_at = NOW()
      WHERE id = ${req.params.id}
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to update certificate' });
  }
});

/** DELETE /api/coverage/documents/:id */
router.delete('/documents/:id', async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM compliance_documents WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to delete certificate' });
  }
});

/** PATCH /api/coverage/drivers/:id — split-authority settings for one driver. */
router.patch('/drivers/:id', async (req, res) => {
  try {
    const enabled = typeof req.body?.splitAuthorityEnabled === 'boolean'
      ? req.body.splitAuthorityEnabled : null;
    const mc = req.body?.ownMcNumber !== undefined ? String(req.body.ownMcNumber || '') : null;
    const dot = req.body?.ownDotNumber !== undefined ? String(req.body.ownDotNumber || '') : null;
    const unit = req.body?.powerUnitType ? String(req.body.powerUnitType) : null;
    await db.execute(sql`
      UPDATE drivers
      SET split_authority_enabled = COALESCE(${enabled}, split_authority_enabled),
          own_mc_number = COALESCE(${mc}, own_mc_number),
          own_dot_number = COALESCE(${dot}, own_dot_number),
          power_unit_type = COALESCE(${unit}, power_unit_type)
      WHERE id = ${req.params.id}
    `);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to update driver' });
  }
});

/**
 * GET /api/coverage/trip-lease-report?year=2026&month=9[&format=csv]
 * Monthly trip-leased gross receipts — the figure a trip-lease endorsement is rated on.
 */
router.get('/trip-lease-report', async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year ?? now.getUTCFullYear());
    const month = Number(req.query.month ?? now.getUTCMonth() + 1);
    const { getTripLeaseExposure, exposureToCsv } = await import('./trip-lease-report');
    const summary = await getTripLeaseExposure(year, month);

    if (String(req.query.format).toLowerCase() === 'csv') {
      const period = summary.periodStart.toISOString().slice(0, 7);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="trip-lease-exposure-${period}.csv"`);
      return res.send(exposureToCsv(summary));
    }
    res.json({ ok: true, ...summary });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'failed to build report' });
  }
});

/** GET /api/coverage/availability/:driverId — current state of one shared truck. */
router.get('/availability/:driverId', async (req, res) => {
  try {
    const at = req.query.at ? new Date(String(req.query.at)) : new Date();
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'at must be a valid date' });
    const { getDriverAvailability, canOffer } = await import('./truck-availability-service');
    const availability = await getDriverAvailability(req.params.driverId, at);
    res.json({ ok: true, availability, offer: canOffer(availability) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to read availability' });
  }
});

/** POST /api/coverage/availability/:driverId/block — driver reserves his own window. */
router.post('/availability/:driverId/block', async (req, res) => {
  try {
    const startsAt = new Date(req.body?.startsAt);
    const endsAt = new Date(req.body?.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return res.status(400).json({ error: 'startsAt and endsAt must be valid dates' });
    }
    if (endsAt <= startsAt) return res.status(400).json({ error: 'endsAt must be after startsAt' });
    const id = `blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO driver_availability_blocks (id, driver_id, starts_at, ends_at, note, created_at)
      VALUES (${id}, ${req.params.driverId}, ${startsAt}, ${endsAt},
              ${req.body?.note ? String(req.body.note) : null}, NOW())
    `);
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to add block' });
  }
});

/** DELETE /api/coverage/availability/block/:id — release a reserved window. */
router.delete('/availability/block/:id', async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM driver_availability_blocks WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to remove block' });
  }
});

export default router;
