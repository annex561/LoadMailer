// Telematics ingest cron — pulls ELD position and writes it into driver_locations as a
// FALLBACK for the phone feed. See server/telematics-service.ts for why this exists.
//
// SAFETY GUARDS (CLAUDE.md financial-impact rule):
//
// This path sends NOTHING. No SMS, no email, no voice, no OpenAI. It is a read from the
// telematics provider plus an INSERT into a table the app already writes on every phone ping.
// The guards below are therefore about data integrity and provider blast radius, not spend:
//
//   1. Default OFF — only schedules when TELEMATICS_ENABLED=true. Without it the module
//      imports cleanly, schedules nothing, and makes no outbound request.
//   2. Kill switch — TELEMATICS_DISABLED=true halts ticks instantly without removing creds.
//   3. Rate ceiling — TELEMATICS_MAX_PER_TICK caps inserts per tick (default 200).
//   4. Overlap guard — a slow provider can't stack ticks on top of each other.
//   5. Request timeout — 10s in the provider client; a hung ELD never stalls the cron.
//   6. Visibility — one summary line per tick with every skip reason counted, so a runaway or
//      a silently-empty feed is obvious in one tick.
//
// The behavioural guard that actually matters is shouldIngestTelematicsFix: the phone stays
// primary while it is fresh. If that inverts, the ELD overwrites better phone data and accuracy
// silently drops with no error anywhere. Pinned by server/__tests__/telematics-predicates.test.ts.

import cron from 'node-cron';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { drivers, driverLocations } from '@shared/schema';
import { storage } from './storage';
import {
  getTelematicsSource,
  shouldIngestTelematicsFix,
  isDuplicateFix,
  isValidFix,
  DEFAULT_PHONE_STALE_AFTER_MIN,
  DEFAULT_MAX_FIX_AGE_MIN,
  type TelematicsFix,
  type TelematicsSource,
} from './telematics-service';

const DEFAULT_SCHEDULE = '*/5 * * * *'; // the ELD is a fallback, not a live tracker
const DEFAULT_MAX_PER_TICK = 200;

export interface TelematicsTickResult {
  fetched: number;
  mapped: number;
  ingested: number;
  skippedUnmapped: number;
  skippedFreshPhone: number;
  skippedStale: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  cappedAt: number | null;
  errors: string[];
}

function emptyResult(): TelematicsTickResult {
  return {
    fetched: 0, mapped: 0, ingested: 0,
    skippedUnmapped: 0, skippedFreshPhone: 0, skippedStale: 0,
    skippedDuplicate: 0, skippedInvalid: 0,
    cappedAt: null, errors: [],
  };
}

class TelematicsCron {
  private job: any = null;
  private running = false;
  private ticking = false; // guard 4: no overlapping ticks

  async initialize(): Promise<void> {
    if (this.running) return;

    // Guard 1: default OFF.
    if (process.env.TELEMATICS_ENABLED !== 'true') {
      console.log('[telematics-cron] disabled (set TELEMATICS_ENABLED=true to enable)');
      return;
    }

    const schedule = process.env.TELEMATICS_CRON || DEFAULT_SCHEDULE;
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e: any) {
        console.error('[telematics-cron] tick error:', e?.message || e);
      }
    });
    this.running = true;
    console.log(`📡 Telematics cron running (${schedule}, provider=${getTelematicsSource().name})`);

    // First tick shortly after boot, once the server has settled.
    setTimeout(() => this.tick().catch(() => {}), 15_000);
  }

  async tick(source?: TelematicsSource): Promise<TelematicsTickResult> {
    const result = emptyResult();

    // Guard 2: kill switch, checked every tick so it takes effect without a restart.
    if (process.env.TELEMATICS_DISABLED === 'true') {
      console.log('[telematics-cron] halted by TELEMATICS_DISABLED');
      return result;
    }

    // Guard 4: overlap.
    if (this.ticking) {
      console.log('[telematics-cron] previous tick still running — skipping');
      return result;
    }
    this.ticking = true;

    try {
      const provider = source ?? getTelematicsSource();
      const fixes = await provider.fetchFixes();
      result.fetched = fixes.length;
      if (fixes.length === 0) {
        this.logSummary(result, provider.name);
        return result;
      }

      // Map provider vehicle ids → our drivers. One query, not one per vehicle.
      const linked = await db
        .select({ id: drivers.id, vehicleId: drivers.telematicsVehicleId })
        .from(drivers)
        .where(isNotNull(drivers.telematicsVehicleId));

      const byVehicle = new Map<string, string>();
      for (const d of linked) {
        if (d.vehicleId) byVehicle.set(String(d.vehicleId), d.id);
      }

      const maxPerTick = Number(process.env.TELEMATICS_MAX_PER_TICK) > 0
        ? Number(process.env.TELEMATICS_MAX_PER_TICK)
        : DEFAULT_MAX_PER_TICK;

      const phoneStaleAfterMin = Number(process.env.TELEMATICS_PHONE_STALE_MIN) > 0
        ? Number(process.env.TELEMATICS_PHONE_STALE_MIN)
        : DEFAULT_PHONE_STALE_AFTER_MIN;

      const maxFixAgeMin = Number(process.env.TELEMATICS_MAX_FIX_AGE_MIN) > 0
        ? Number(process.env.TELEMATICS_MAX_FIX_AGE_MIN)
        : DEFAULT_MAX_FIX_AGE_MIN;

      const now = new Date();

      for (const fix of fixes) {
        const driverId = byVehicle.get(fix.vehicleId);
        if (!driverId) { result.skippedUnmapped++; continue; }
        result.mapped++;

        if (!isValidFix(fix)) { result.skippedInvalid++; continue; }

        // Guard 3: rate ceiling.
        if (result.ingested >= maxPerTick) {
          result.cappedAt = maxPerTick;
          break;
        }

        try {
          const decided = await this.ingestOne(fix, driverId, now, phoneStaleAfterMin, maxFixAgeMin);
          switch (decided) {
            case 'ingested': result.ingested++; break;
            case 'fresh-phone': result.skippedFreshPhone++; break;
            case 'stale': result.skippedStale++; break;
            case 'duplicate': result.skippedDuplicate++; break;
          }
        } catch (e: any) {
          result.errors.push(`${fix.vehicleId}: ${e?.message || e}`);
        }
      }

      this.logSummary(result, provider.name);
      return result;
    } finally {
      this.ticking = false;
    }
  }

  /** Decide and (if admitted) persist a single fix. Returns why, for the tick summary. */
  private async ingestOne(
    fix: TelematicsFix,
    driverId: string,
    now: Date,
    phoneStaleAfterMin: number,
    maxFixAgeMin: number,
  ): Promise<'ingested' | 'fresh-phone' | 'stale' | 'duplicate'> {
    // Newest phone fix for this driver. Only 'gps' rows count — 'simulated' rows come from
    // the demo location service and must never make the phone look alive.
    const [phone] = await db
      .select({ timestamp: driverLocations.timestamp })
      .from(driverLocations)
      .where(and(eq(driverLocations.driverId, driverId), eq(driverLocations.source, 'gps')))
      .orderBy(desc(driverLocations.timestamp))
      .limit(1);

    const lastPhoneFixAt = phone?.timestamp ? new Date(phone.timestamp) : null;

    const admit = shouldIngestTelematicsFix({
      lastPhoneFixAt,
      telematicsFixAt: fix.recordedAt,
      now,
      phoneStaleAfterMin,
      maxFixAgeMin,
    });

    if (!admit) {
      // Distinguish the two reasons so the summary is diagnosable.
      const ageMin = (now.getTime() - fix.recordedAt.getTime()) / 60_000;
      return ageMin > maxFixAgeMin || ageMin < 0 ? 'stale' : 'fresh-phone';
    }

    // Duplicate suppression against our own last telematics row for this driver.
    const [prev] = await db
      .select({
        latitude: driverLocations.latitude,
        longitude: driverLocations.longitude,
        timestamp: driverLocations.timestamp,
      })
      .from(driverLocations)
      .where(and(eq(driverLocations.driverId, driverId), eq(driverLocations.source, 'truckx')))
      .orderBy(desc(driverLocations.timestamp))
      .limit(1);

    if (prev && isDuplicateFix(
      { latitude: prev.latitude, longitude: prev.longitude, recordedAt: new Date(prev.timestamp) },
      fix,
    )) {
      return 'duplicate';
    }

    // Reverse geocode the same way the phone route does, so the live map and the
    // dispatcher's "where is he" read identically regardless of which source won.
    let address: string | null = null;
    try {
      const { reverseGeocode } = await import('./geocoding-service');
      address = await reverseGeocode(fix.latitude, fix.longitude);
    } catch {
      // Geocoding is decoration. A failure must never drop the position itself.
    }

    await storage.createDriverLocation({
      driverId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      timestamp: fix.recordedAt,
      speed: fix.speedMph ?? undefined,
      heading: fix.headingDeg ?? undefined,
      address: address ?? undefined,
      isActive: true,
      source: 'truckx',
    } as any);

    // Deactivate our own older rows ONLY. Mirrors server/routes.ts, which deactivates
    // everything except source 'gps' — a real phone fix is never demoted by this cron.
    try {
      const recent = await storage.getDriverLocations(driverId, 10);
      for (const loc of recent.slice(1)) {
        if (loc.source !== 'gps' && loc.isActive) {
          await storage.updateDriverLocation(loc.id, { isActive: false });
        }
      }
    } catch {
      // Non-fatal: a stale isActive flag is cosmetic, the newest-by-timestamp read still wins.
    }

    return 'ingested';
  }

  private logSummary(r: TelematicsTickResult, provider: string): void {
    const parts = [
      `provider=${provider}`,
      `fetched=${r.fetched}`,
      `mapped=${r.mapped}`,
      `ingested=${r.ingested}`,
      `unmapped=${r.skippedUnmapped}`,
      `fresh-phone=${r.skippedFreshPhone}`,
      `stale=${r.skippedStale}`,
      `dup=${r.skippedDuplicate}`,
      `invalid=${r.skippedInvalid}`,
    ];
    if (r.cappedAt !== null) parts.push(`CAPPED@${r.cappedAt}`);
    if (r.errors.length) parts.push(`errors=${r.errors.length}`);
    console.log(`[telematics-cron] ${parts.join(' ')}`);
    for (const e of r.errors.slice(0, 5)) console.error(`[telematics-cron]   ${e}`);
  }

  stop(): void {
    if (this.job) { this.job.stop(); this.job = null; }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const telematicsCron = new TelematicsCron();
