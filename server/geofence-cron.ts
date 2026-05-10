// Geofence Cron
// Every 2 min: for each active load with a driver, check latest GPS fix.
// When driver enters ~2 miles of pickup → auto-SMS pickup photo upload link.
// When driver enters ~2 miles of delivery → auto-SMS delivery photo upload link.
// Dedupes via load.sopProgress so we only fire once per (loadId, phase).

import cron from 'node-cron';
import { db } from './db';
import { loads, driverLocations, drivers } from '@shared/schema';
import { and, isNotNull, isNull, eq, desc } from 'drizzle-orm';
import { haversineDistance } from './auto-load-matcher';
import { geocode } from './geocoder';
import { sendUploadLink, PICKUP_STAGES, DELIVERY_STAGES } from './load-photos-service';

const MILES_THRESHOLD = 2;
const MAX_LOCATION_AGE_MIN = 30; // ignore stale fixes

export interface GeofenceTickResult {
  checked: number;
  firedPickup: number;
  firedDelivery: number;
  skipped: number;
  errors: string[];
}

class GeofenceCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;
    this.job = cron.schedule('*/2 * * * *', async () => {
      try { await this.tick(); } catch (e) { console.error('[geofence-cron] tick error:', e); }
    });
    this.running = true;
    console.log('🎯 Geofence cron running (every 2 min)');
    // Run first tick soon
    setTimeout(() => this.tick().catch(() => {}), 10_000);
  }

  async tick(): Promise<GeofenceTickResult> {
    const result: GeofenceTickResult = { checked: 0, firedPickup: 0, firedDelivery: 0, skipped: 0, errors: [] };

    // Active loads with a driver, not yet delivered
    const active = await db.query.loads.findMany({
      where: and(
        isNotNull(loads.driverId),
        isNull(loads.deliveredAt),
      ),
      limit: 200,
    });

    for (const load of active) {
      result.checked++;
      try {
        const sop = (load.sopProgress as any) || {};
        const pickupDone = !!sop.pickupPhotoRequestedAt;
        const deliveryDone = !!sop.deliveryPhotoRequestedAt;
        if (pickupDone && deliveryDone) { result.skipped++; continue; }

        // Skip if driver is off duty (HOS check) — no SMS spam when not working
        const [drv] = await db
          .select({ isOnDuty: drivers.isOnDuty })
          .from(drivers)
          .where(eq(drivers.id, load.driverId!))
          .limit(1);
        if (drv && drv.isOnDuty === false) { result.skipped++; continue; }

        // Latest driver location
        const [loc] = await db
          .select()
          .from(driverLocations)
          .where(eq(driverLocations.driverId, load.driverId!))
          .orderBy(desc(driverLocations.timestamp))
          .limit(1);

        if (!loc) { result.skipped++; continue; }
        const ageMin = (Date.now() - new Date(loc.timestamp).getTime()) / 60000;
        if (ageMin > MAX_LOCATION_AGE_MIN) { result.skipped++; continue; }

        // Resolve pickup + delivery coords
        const pickupKey = [load.originCity, load.originState].filter(Boolean).join(', ').toLowerCase()
          || String(load.pickupAddress || '').toLowerCase();
        const deliveryKey = [load.destCity, load.destState].filter(Boolean).join(', ').toLowerCase()
          || String(load.deliveryAddress || '').toLowerCase();

        const pickup = await geocode(pickupKey);
        const delivery = await geocode(deliveryKey);

        // Pickup check
        if (!pickupDone && pickup) {
          const mi = haversineDistance(loc.latitude, loc.longitude, pickup[0], pickup[1]);
          if (mi <= MILES_THRESHOLD) {
            const r = await sendUploadLink(load.id, PICKUP_STAGES);
            if (r.ok) {
              await this.markPhase(load.id, 'pickupPhotoRequestedAt');
              result.firedPickup++;
              console.log(`[geofence-cron] 📸 pickup link sent for load ${load.loadNumber} (${mi.toFixed(1)}mi)`);
            } else {
              result.errors.push(`${load.loadNumber} pickup: ${r.error}`);
            }
          }
        }

        // Delivery check
        if (!deliveryDone && delivery) {
          const mi = haversineDistance(loc.latitude, loc.longitude, delivery[0], delivery[1]);
          if (mi <= MILES_THRESHOLD) {
            const r = await sendUploadLink(load.id, DELIVERY_STAGES);
            if (r.ok) {
              await this.markPhase(load.id, 'deliveryPhotoRequestedAt');
              result.firedDelivery++;
              console.log(`[geofence-cron] 📸 delivery link sent for load ${load.loadNumber} (${mi.toFixed(1)}mi)`);
            } else {
              result.errors.push(`${load.loadNumber} delivery: ${r.error}`);
            }
          }
        }
      } catch (e: any) {
        result.errors.push(String(e?.message || e));
      }
    }

    if (result.firedPickup > 0 || result.firedDelivery > 0) {
      console.log(
        `[geofence-cron] tick done — ${result.checked} checked, ${result.firedPickup}P/${result.firedDelivery}D fired, ${result.skipped} skipped`,
      );
    }
    return result;
  }

  private async markPhase(loadId: string, field: 'pickupPhotoRequestedAt' | 'deliveryPhotoRequestedAt') {
    const [l] = await db.select({ sopProgress: loads.sopProgress }).from(loads).where(eq(loads.id, loadId));
    const sop = (l?.sopProgress as any) || {};
    sop[field] = new Date().toISOString();
    await db.update(loads).set({ sopProgress: sop }).where(eq(loads.id, loadId));
  }

  getStatus() {
    return { running: this.running, thresholdMiles: MILES_THRESHOLD, maxLocationAgeMin: MAX_LOCATION_AGE_MIN };
  }

  async triggerNow() { return this.tick(); }
}

export const geofenceCron = new GeofenceCron();
