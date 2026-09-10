// Detention claim endpoint — READ ONLY.
//
// Computes, stores nothing, and sends nothing. Generating a claim is not the same as filing one:
// filing it means outbound email to a broker, which is a new paid path and gets its own approval
// cycle (CLAUDE.md financial-impact rule). The dispatcher copies the text block and sends it.
//
// The math lives in server/detention-service.ts and is unit-tested by
// server/__tests__/detention-math.test.ts. Nothing here should grow logic — if a rule changes,
// it changes in the pure module where the guard test can see it.

import type { Express, Request, Response } from 'express';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { loads, driverLocations } from '@shared/schema';
import { geocode } from '../geocoder';
import {
  computeDwellWindow,
  computeDetentionClaim,
  formatClaimText,
  DEFAULT_RADIUS_MILES,
  type Fix,
} from '../detention-service';

/** How far back to pull position history for a load. A multi-day run still fits. */
const LOOKBACK_DAYS = 14;
const MAX_FIXES = 5000;

export function registerDetentionRoutes(app: Express): void {
  app.get('/api/loads/:id/detention', async (req: Request, res: Response) => {
    try {
      const loadId = String(req.params.id);
      const stop = String(req.query.stop || 'delivery').toLowerCase();
      if (stop !== 'pickup' && stop !== 'delivery') {
        return res.status(400).json({ error: "stop must be 'pickup' or 'delivery'" });
      }

      const [load] = await db.select().from(loads).where(eq(loads.id, loadId)).limit(1);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (!load.driverId) {
        return res.status(409).json({ error: 'Load has no driver assigned — no position history to measure' });
      }

      // Prefer the city/state pair the way geofence-cron does; fall back to the raw address.
      const key =
        stop === 'pickup'
          ? [load.originCity, load.originState].filter(Boolean).join(', ') || String(load.pickupAddress || '')
          : [load.destCity, load.destState].filter(Boolean).join(', ') || String(load.deliveryAddress || '');

      const address = stop === 'pickup' ? String(load.pickupAddress || '') : String(load.deliveryAddress || '');
      if (!key) return res.status(409).json({ error: `Load has no ${stop} address to geocode` });

      const coords = await geocode(key.toLowerCase());
      if (!coords) return res.status(409).json({ error: `Could not geocode the ${stop} address: ${key}` });
      const [stopLat, stopLon] = coords;

      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          latitude: driverLocations.latitude,
          longitude: driverLocations.longitude,
          timestamp: driverLocations.timestamp,
          source: driverLocations.source,
        })
        .from(driverLocations)
        .where(and(eq(driverLocations.driverId, load.driverId), gte(driverLocations.timestamp, since)))
        .orderBy(desc(driverLocations.timestamp))
        .limit(MAX_FIXES);

      // 'simulated' rows come from the demo location service and must never reach an invoice.
      const usable = rows.filter((r: typeof rows[number]) => r.source !== 'simulated');

      const fixes: Fix[] = usable.map((r: typeof rows[number]) => ({
        latitude: r.latitude,
        longitude: r.longitude,
        timestamp: new Date(r.timestamp),
      }));

      const radiusMiles = Number(process.env.DETENTION_RADIUS_MILES) > 0
        ? Number(process.env.DETENTION_RADIUS_MILES)
        : DEFAULT_RADIUS_MILES;

      const window = computeDwellWindow(fixes, stopLat, stopLon, radiusMiles, new Date());
      const claim = computeDetentionClaim(
        window,
        load.detentionFreeMinutes ?? null,
        load.detentionRatePerHour ?? null,
      );

      // Only the fixes inside the window, so the UI can show the evidence behind the number.
      const evidence = window
        ? fixes
            .filter((f) => {
              const t = f.timestamp.getTime();
              return t >= window.arrivedAt.getTime() && (window.departedAt === null || t <= window.departedAt.getTime());
            })
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        : [];

      res.json({
        loadId,
        loadNumber: load.loadNumber,
        stop,
        stopAddress: address || key,
        radiusMiles,
        terms: {
          freeMinutes: load.detentionFreeMinutes ?? null,
          ratePerHour: load.detentionRatePerHour ?? null,
        },
        window,
        claim,
        claimText:
          window && claim
            ? formatClaimText({
                loadNumber: load.loadNumber,
                stopLabel: stop === 'pickup' ? 'Pickup' : 'Delivery',
                stopAddress: address || key,
                window,
                claim,
              })
            : null,
        evidence,
        totalFixesConsidered: fixes.length,
      });
    } catch (err: any) {
      console.error('[detention] claim error:', err?.message || err);
      res.status(500).json({ error: 'Failed to compute detention' });
    }
  });
}
