// Telematics / ELD ingest — provider abstraction + pure admission predicates.
//
// WHY THIS EXISTS
//
// Driver position today comes from browser geolocation: client/src/pages/driver-tracker.tsx
// (watchPosition + Wake Lock) and the background script in server/driver-portal.ts, both
// POSTing to /api/driver-location/update. That feed only runs WHILE THE PAGE IS OPEN. iOS
// suspends background JS the moment the screen locks or the driver switches to Waze, so the
// feed dies constantly — which is exactly why server/gps-health-monitor.ts exists to SMS the
// driver a "restart tracking" link every time it goes quiet.
//
// The ELD is hardwired to the truck, always on, and already paid for. This module lets it act
// as the FALLBACK that needs no driver cooperation. It does not replace the phone: the phone is
// more accurate and stays primary while it is fresh (see shouldIngestTelematicsFix).
//
// The payoff is not "another dot on the map". It is that geofence arrival, dwell time, and the
// detention claim built on top of them (server/detention-service.ts) stop depending on whether
// a driver kept a browser tab open at the moment the truck crossed the gate.
//
// SHAPE OF THIS FILE
//
// Everything above the "I/O half" banner is PURE — no network, no DB, no clock, no env. Those
// predicates are what server/__tests__/telematics-predicates.test.ts pins. Do not move clock or
// network access above that line; the tests are the tripwire for the fallback semantics and
// they only work while the logic stays pure.

// ─── Types ───────────────────────────────────────────────────────────────────

/** One position sample from a telematics/ELD provider, already normalized. */
export interface TelematicsFix {
  /** The provider's own vehicle identifier, matched to drivers.telematicsVehicleId. */
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedMph: number | null;
  headingDeg: number | null;
  /** Provider's timestamp for the sample, NOT the time we ingested it. */
  recordedAt: Date;
}

/** A telematics provider. Add a vendor by adding a file, not by editing the cron. */
export interface TelematicsSource {
  readonly name: string;
  /** All vehicles in one call. Must resolve to [] (never throw) when unconfigured. */
  fetchFixes(): Promise<TelematicsFix[]>;
}

/** The previously stored fix for a driver, used for duplicate suppression. */
export interface StoredFix {
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

export interface IngestDecisionInput {
  /** Newest driver_locations row with source 'gps' (the phone), or null if none. */
  lastPhoneFixAt: Date | null;
  telematicsFixAt: Date;
  now: Date;
  /** Phone counts as fresh for this many minutes. Mirrors GPS_STALE_THRESHOLD_MINUTES. */
  phoneStaleAfterMin: number;
  /** Ignore telematics fixes older than this. Mirrors geofence-cron MAX_LOCATION_AGE_MIN. */
  maxFixAgeMin: number;
}

// Defaults deliberately mirror the constants the rest of the system already uses, so the
// fallback hands over exactly when gps-health-monitor would otherwise start nagging.
export const DEFAULT_PHONE_STALE_AFTER_MIN = 5;  // = gps-health-monitor GPS_STALE_THRESHOLD_MINUTES
export const DEFAULT_MAX_FIX_AGE_MIN = 30;       // = geofence-cron MAX_LOCATION_AGE_MIN
/** A provider clock ahead of ours by more than this is broken, not merely skewed. */
export const MAX_CLOCK_SKEW_MIN = 2;
/** Two fixes closer together than this are the same physical position. ~1.1 metres. */
export const DUPLICATE_COORD_EPSILON = 0.00001;

const MS_PER_MIN = 60_000;

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_MIN;
}

// ─── Pure predicates (unit-tested — see server/__tests__/telematics-predicates.test.ts) ───

/**
 * Should this ELD fix be written to driver_locations?
 *
 * The phone wins while it is fresh. Writing an ELD fix on top of a live phone feed would
 * downgrade accuracy for no reason, and geofence-cron only ever reads the NEWEST row — so a
 * lower-quality newer row silently replaces a better one.
 *
 * Rejects, in order:
 *   - a fix from the future beyond MAX_CLOCK_SKEW_MIN (broken provider clock)
 *   - a fix already older than maxFixAgeMin (poisons geofence-cron, which trusts the newest row)
 *   - any fix at all while the phone has reported inside phoneStaleAfterMin
 */
export function shouldIngestTelematicsFix(input: IngestDecisionInput): boolean {
  const { lastPhoneFixAt, telematicsFixAt, now, phoneStaleAfterMin, maxFixAgeMin } = input;

  const fixAgeMin = minutesBetween(now, telematicsFixAt);

  // Negative age = timestamped in the future. Small skew is normal, large skew is a broken clock.
  if (fixAgeMin < -MAX_CLOCK_SKEW_MIN) return false;
  if (fixAgeMin > maxFixAgeMin) return false;

  // No phone data at all → the ELD is the only source, always take it.
  if (lastPhoneFixAt === null) return true;

  // Phone still fresh → it stays primary.
  return minutesBetween(now, lastPhoneFixAt) > phoneStaleAfterMin;
}

/**
 * Is this fix the same sample we already stored? Providers commonly replay the newest fix on
 * every poll for a parked truck; without this the table grows one identical row per tick.
 */
export function isDuplicateFix(previous: StoredFix | null, next: TelematicsFix): boolean {
  if (previous === null) return false;
  if (previous.recordedAt.getTime() !== next.recordedAt.getTime()) return false;
  return (
    Math.abs(previous.latitude - next.latitude) < DUPLICATE_COORD_EPSILON &&
    Math.abs(previous.longitude - next.longitude) < DUPLICATE_COORD_EPSILON
  );
}

/** A fix is only usable if the coordinates are real numbers inside valid earth bounds. */
export function isValidFix(fix: TelematicsFix): boolean {
  const { latitude: lat, longitude: lon } = fix;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  // 0,0 is Null Island — always a provider default, never a truck.
  if (lat === 0 && lon === 0) return false;
  return Number.isFinite(fix.recordedAt.getTime());
}

/**
 * Normalize one raw TruckX vehicle record into a TelematicsFix.
 *
 * ISOLATED ON PURPOSE. The exact TruckX response shape is the one thing in this feature that
 * was not verifiable from inside the repo, so every field-name guess lives in this single
 * function behind a fixture test. When the real payload differs, this is a one-function fix
 * rather than a refactor. Field aliases below cover the shapes TruckX's docs and the
 * TruckerCloud normalization both use.
 *
 * Returns null for a record it cannot map, so one bad row never kills the whole poll.
 */
export function mapTruckXPayload(raw: unknown): TelematicsFix[] {
  const rows = extractRows(raw);
  const out: TelematicsFix[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, any>;

    const vehicleId = firstString(r, ['vehicleId', 'vehicle_id', 'assetId', 'asset_id', 'id', 'deviceId', 'device_id']);
    if (!vehicleId) continue;

    // Location may be flat on the row or nested under location/lastLocation/position.
    const loc = (r.location ?? r.lastLocation ?? r.last_location ?? r.position ?? r.gps ?? r) as Record<string, any>;

    const latitude = firstNumber(loc, ['latitude', 'lat']);
    const longitude = firstNumber(loc, ['longitude', 'lon', 'lng', 'long']);
    if (latitude === null || longitude === null) continue;

    const recordedRaw =
      firstDefined(loc, ['recordedAt', 'recorded_at', 'timestamp', 'time', 'gpsTime', 'gps_time', 'lastUpdated', 'last_updated']) ??
      firstDefined(r, ['recordedAt', 'recorded_at', 'timestamp', 'time', 'lastUpdated', 'last_updated']);
    const recordedAt = toDate(recordedRaw);
    if (recordedAt === null) continue;

    const fix: TelematicsFix = {
      vehicleId,
      latitude,
      longitude,
      speedMph: firstNumber(loc, ['speedMph', 'speed_mph', 'speed']),
      headingDeg: firstNumber(loc, ['headingDeg', 'heading_deg', 'heading', 'bearing', 'course']),
      recordedAt,
    };
    if (isValidFix(fix)) out.push(fix);
  }

  return out;
}

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, any>;
    for (const key of ['data', 'vehicles', 'results', 'items', 'assets', 'records']) {
      if (Array.isArray(r[key])) return r[key];
    }
    // Some endpoints wrap twice: { data: { vehicles: [...] } }
    if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) return extractRows(r.data);
  }
  return [];
}

function firstDefined(o: Record<string, any>, keys: string[]): unknown {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  return undefined;
}

function firstString(o: Record<string, any>, keys: string[]): string | null {
  const v = firstDefined(o, keys);
  if (v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function firstNumber(o: Record<string, any>, keys: string[]): number | null {
  const v = firstDefined(o, keys);
  if (v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
  if (v === undefined || v === null) return null;
  // Unix seconds vs milliseconds: anything below this is seconds (year 2001 in ms).
  if (typeof v === 'number') {
    const ms = v < 1_000_000_000_000 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

// ─── I/O half — network, env, provider selection ─────────────────────────────

/** Milliseconds before a provider request is abandoned. A hung ELD must not stall the cron. */
const REQUEST_TIMEOUT_MS = 10_000;

let warnedUnconfigured = false;

export class TruckXSource implements TelematicsSource {
  readonly name = 'truckx';

  private get baseUrl(): string | null {
    const raw = process.env.TRUCKX_API_BASE || 'https://api.truckx.com';
    return raw.replace(/\/+$/, '') || null;
  }

  private get apiKey(): string | null {
    return process.env.TRUCKX_API_KEY || null;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.baseUrl);
  }

  async fetchFixes(): Promise<TelematicsFix[]> {
    if (!this.isConfigured()) {
      if (!warnedUnconfigured) {
        console.log('[telematics] TRUCKX_API_KEY not set — telematics ingest is inert');
        warnedUnconfigured = true;
      }
      return [];
    }

    const path = process.env.TRUCKX_VEHICLES_PATH || '/v1/vehicles/status';
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': this.apiKey as string,
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.error(`[telematics] ${this.name} responded ${resp.status} for ${path}`);
        return [];
      }
      return mapTruckXPayload(await resp.json());
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : err?.message || err;
      console.error(`[telematics] ${this.name} fetch failed: ${reason}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Resolve the configured provider. TELEMATICS_PROVIDER selects; unknown names fall back to
 * TruckX with a warning rather than throwing, because this runs during boot.
 */
export function getTelematicsSource(): TelematicsSource {
  const name = (process.env.TELEMATICS_PROVIDER || 'truckx').toLowerCase();
  if (name !== 'truckx') {
    console.warn(`[telematics] unknown TELEMATICS_PROVIDER "${name}" — falling back to truckx`);
  }
  return new TruckXSource();
}
