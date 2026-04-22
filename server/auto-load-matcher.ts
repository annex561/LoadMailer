/**
 * Auto Load Matcher Service
 *
 * Continuously scans available loads, scores them against LAMP Logistics criteria,
 * finds the nearest available driver by GPS, and surfaces "Hot Load" matches
 * for the dispatcher to approve with one click.
 *
 * Flow: Google Sheets loads → score → rank drivers by proximity → pending match
 */

import { storage } from "./storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DispatchCriteria {
  minRPM: number;           // e.g. 1.80
  minMiles: number;         // e.g. 100
  maxDeadheadMiles: number; // e.g. 150
  preferredOriginStates: string[];   // e.g. ["TN", "GA", "FL"]
  preferredDestStates: string[];     // e.g. ["TN", "GA", "FL", "NC"]
  equipmentTypes: string[];          // e.g. ["dry_van", "box_truck"]
  autoCreateLoad: boolean;  // if true, automatically create load record (vs pending review)
}

export interface HotLoad {
  id: string;
  sourceLoadId: string;      // ID from Google Sheets / DAT source
  origin: string;
  destination: string;
  pickupDate: string;
  rate: number;
  miles: number;
  rpm: number;
  score: number;
  weight?: string;
  equipment?: string;
  broker?: string;
  brokerPhone?: string;
  company?: string;
  matchedDriverId?: string;
  matchedDriverName?: string;
  matchedDriverPhone?: string;
  deadheadMiles?: number;
  driverDistanceMiles?: number;
  status: 'pending' | 'dispatched' | 'dismissed';
  createdAt: string;
}

// ─── Default criteria (editable by dispatcher) ────────────────────────────────

const DEFAULT_CRITERIA: DispatchCriteria = {
  minRPM: 1.80,
  minMiles: 100,
  maxDeadheadMiles: 150,
  preferredOriginStates: ["TN", "GA", "FL", "AL", "NC", "SC", "MS", "KY"],
  preferredDestStates: ["TN", "GA", "FL", "AL", "NC", "SC", "MS", "KY", "OH", "TX"],
  equipmentTypes: ["dry_van", "box_truck", "sprinter_van", "van", "flatbed"],
  autoCreateLoad: false,
};

// ─── In-memory store for hot loads and criteria ───────────────────────────────
// (Persists until server restart — production would use DB)

let criteria: DispatchCriteria = { ...DEFAULT_CRITERIA };
const hotLoads: Map<string, HotLoad> = new Map();
let matcherInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// ─── Haversine distance calculator ───────────────────────────────────────────

export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Approximate geocoder for common SE/Midwest cities ───────────────────────

const CITY_COORDS: Record<string, [number, number]> = {
  "knoxville, tn": [35.9606, -83.9207],
  "nashville, tn": [36.1627, -86.7816],
  "memphis, tn": [35.1495, -90.0490],
  "chattanooga, tn": [35.0456, -85.3097],
  "atlanta, ga": [33.7490, -84.3880],
  "savannah, ga": [32.0835, -81.0998],
  "jacksonville, fl": [30.3322, -81.6557],
  "miami, fl": [25.7617, -80.1918],
  "orlando, fl": [28.5383, -81.3792],
  "tampa, fl": [27.9506, -82.4572],
  "birmingham, al": [33.5186, -86.8104],
  "montgomery, al": [32.3617, -86.2792],
  "charlotte, nc": [35.2271, -80.8431],
  "raleigh, nc": [35.7796, -78.6382],
  "columbia, sc": [34.0007, -81.0348],
  "charleston, sc": [32.7765, -79.9311],
  "louisville, ky": [38.2527, -85.7585],
  "lexington, ky": [38.0406, -84.5037],
  "jackson, ms": [32.2988, -90.1848],
  "houston, tx": [29.7604, -95.3698],
  "dallas, tx": [32.7767, -96.7970],
  "san antonio, tx": [29.4241, -98.4936],
  "columbus, oh": [39.9612, -82.9988],
  "cleveland, oh": [41.4993, -81.6944],
  "cincinnati, oh": [39.1031, -84.5120],
  "kansas city, mo": [39.0997, -94.5786],
  "st. louis, mo": [38.6270, -90.1994],
  "chicago, il": [41.8781, -87.6298],
  "indianapolis, in": [39.7684, -86.1581],
  "pittsburgh, pa": [40.4406, -79.9959],
  "philadelphia, pa": [39.9526, -75.1652],
  "new york, ny": [40.7128, -74.0060],
  "boston, ma": [42.3601, -71.0589],
  "richmond, va": [37.5407, -77.4360],
  "norfolk, va": [36.8508, -76.2859],
  "campton, nh": [43.8376, -71.6414],
  "brunswick, ga": [31.1499, -81.4915],
  "albany, ny": [42.6526, -73.7562],
  "hendersonville, nc": [35.3182, -82.4607],
  "altamonte spgs, fl": [28.6611, -81.3659],
  "algood, tn": [36.1934, -85.4497],
  "mount juliet, tn": [36.2001, -86.5186],
  "cuba, mo": [38.0617, -91.4024],
  "smyrna, ga": [33.8840, -84.5144],
  "schiller park, il": [41.9553, -87.8734],
  "lake hubert, mn": [46.4458, -94.3794],
  "douglas, ga": [31.5088, -82.8490],
  "las vegas, nv": [36.1699, -115.1398],
  "seattle, wa": [47.6062, -122.3321],
  "kingsport, tn": [36.5484, -82.5618],
};

export function getCityCoords(cityState: string): [number, number] | null {
  const key = cityState.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];

  // Try partial match on city name
  for (const [k, coords] of Object.entries(CITY_COORDS)) {
    if (key.includes(k.split(",")[0]) || k.includes(key.split(",")[0])) {
      return coords;
    }
  }
  return null;
}

// ─── Load scorer ──────────────────────────────────────────────────────────────

function scoreLoad(load: any, c: DispatchCriteria): number {
  const rate = parseFloat(String(load.rate || load.rate_total || "0").replace(/[$,]/g, "")) || 0;
  const miles = parseFloat(String(load.miles || "0").replace(/,/g, "")) || 0;
  const rpm = miles > 0 ? rate / miles : 0;

  // Hard floor: below min RPM → score 0
  if (rpm > 0 && rpm < c.minRPM) return 0;
  if (miles > 0 && miles < c.minMiles) return 0;

  let score = 0;

  // RPM score (0–50)
  const idealRPM = 2.30;
  const maxRPM = 3.50;
  if (rpm >= c.minRPM) {
    const t = Math.min((rpm - c.minRPM) / (maxRPM - c.minRPM), 1);
    score += Math.round(t * 50);
  }

  // Miles score (0–20) — prefer 300–600 mile loads
  if (miles >= 300 && miles <= 600) score += 20;
  else if (miles >= 200 && miles < 300) score += 12;
  else if (miles > 600) score += 10;
  else score += 5;

  // Origin state preference (0–15)
  const originState = (load.origin || load.pickup || "").split(",").pop()?.trim().toUpperCase() || "";
  if (c.preferredOriginStates.some(s => originState.includes(s))) score += 15;

  // Destination state preference (0–15)
  const destState = (load.destination || load.delivery || "").split(",").pop()?.trim().toUpperCase() || "";
  if (c.preferredDestStates.some(s => destState.includes(s))) score += 15;

  return Math.min(score, 100);
}

// ─── Main matching function ───────────────────────────────────────────────────

async function runMatcher(): Promise<void> {
  try {
    // 1. Get all loads from Google Sheets source (via /api/dat-loads in-memory store)
    const allLoads: any[] = (global as any).__googleSheetsLoads || [];
    if (allLoads.length === 0) return;

    // 2. Get all drivers with known GPS
    const drivers = await storage.getAllDrivers();
    const driverLocations = await storage.getAllCurrentDriverLocations();

    const availableDrivers = drivers.filter(d =>
      d.status === 'available' || d.status === 'Active' || !d.status
    );

    // 3. Score and rank loads
    const scored = allLoads
      .map(load => ({ load, score: scoreLoad(load, criteria) }))
      .filter(({ score }) => score >= 50) // Only hot loads (score ≥ 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Top 20 matches

    // 4. For each hot load, find nearest available driver
    for (const { load, score } of scored) {
      const loadId = load.id || `${load.origin}-${load.destination}-${load.rate}`.replace(/\s/g, "_");

      // Skip if already in hot loads list
      if (hotLoads.has(loadId)) continue;

      const rate = parseFloat(String(load.rate || "0").replace(/[$,]/g, "")) || 0;
      const miles = parseFloat(String(load.miles || "0").replace(/,/g, "")) || 0;
      const rpm = miles > 0 ? Math.round((rate / miles) * 100) / 100 : 0;

      // Find pickup coords
      const pickupCityState = load.origin || load.pickup || "";
      const pickupCoords = getCityCoords(pickupCityState);

      let bestDriver: any = null;
      let bestDistance = Infinity;

      // Parse destination state for per-driver preferred-states filter
      const destStr = String(load.destination || load.delivery || '').toUpperCase();
      const destStateMatch = destStr.match(/,\s*([A-Z]{2})\b/) || destStr.match(/\b([A-Z]{2})\b\s*$/);
      const destState = destStateMatch ? destStateMatch[1] : '';

      if (pickupCoords && availableDrivers.length > 0) {
        for (const driver of availableDrivers) {
          // Per-driver preference filters
          // 1) Preferred destinations (states): empty/null = anywhere
          const prefs: string[] = Array.isArray((driver as any).preferredDestinations)
            ? (driver as any).preferredDestinations.map((s: string) => String(s).toUpperCase())
            : [];
          if (prefs.length > 0 && destState && !prefs.includes(destState)) {
            continue; // driver doesn't want this destination
          }
          // 2) Effective deadhead limit — use driver's personal setting, fall back to criteria default.
          // Hard cap at 150mi (system-wide max) so any legacy 200mi values stored on driver rows are clamped.
          const HARD_CAP = 150;
          const driverPref = Number.isFinite((driver as any).maxDeadheadMiles)
            ? Number((driver as any).maxDeadheadMiles)
            : criteria.maxDeadheadMiles;
          const driverMaxDeadhead = Math.min(driverPref, HARD_CAP);

          // Priority 1: live GPS ping
          const loc = driverLocations.find(l => l.driverId === driver.id);
          let driverLat: number | null = null;
          let driverLon: number | null = null;
          let locationSource = "none";

          if (loc?.latitude && loc?.longitude) {
            driverLat = loc.latitude;
            driverLon = loc.longitude;
            locationSource = "gps";
          } else if (driver.city) {
            // Priority 2: driver's home city from profile
            const homeCoords = getCityCoords(driver.city);
            if (homeCoords) {
              driverLat = homeCoords[0];
              driverLon = homeCoords[1];
              locationSource = "home_city";
            }
          }

          // Skip driver entirely if we have no location at all
          if (driverLat === null || driverLon === null) continue;

          const dist = haversineDistance(
            driverLat, driverLon,
            pickupCoords[0], pickupCoords[1]
          );

          // Only match if driver is actually within THEIR personal deadhead limit
          if (dist <= driverMaxDeadhead && dist < bestDistance) {
            bestDistance = dist;
            bestDriver = { ...driver, _locationSource: locationSource };
          }
        }
      }

      // NO fallback — if no driver is close enough, skip this load entirely
      if (!bestDriver) {
        console.log(`[AutoMatcher] ⏭️  Skipping load ${loadId} — no driver within ${criteria.maxDeadheadMiles}mi of ${pickupCityState}`);
        continue;
      }

      const hotLoad: HotLoad = {
        id: loadId,
        sourceLoadId: load.id || loadId,
        origin: load.origin || load.pickup || "Unknown",
        destination: load.destination || load.delivery || "Unknown",
        pickupDate: load.pickup_date || load.pickupDate || new Date().toISOString(),
        rate,
        miles,
        rpm,
        score,
        weight: load.weight,
        equipment: load.equipment,
        broker: load.broker,
        brokerPhone: load.phone,
        company: load.company,
        matchedDriverId: bestDriver?.id,
        matchedDriverName: bestDriver?.name,
        matchedDriverPhone: bestDriver?.phone,
        driverDistanceMiles: bestDistance === Infinity ? undefined : Math.round(bestDistance),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      hotLoads.set(loadId, hotLoad);

      // ── AUTO-DISPATCH: send SMS immediately, no dispatcher click needed ──
      if (bestDriver?.phone) {
        try {
          const { smsLoadService } = await import('./sms-service');
          const smsLoad = {
            loadNumber: loadId,
            load_number: loadId,
            rate,
            rate_total: rate,
            originCity: hotLoad.origin,
            origin_city: hotLoad.origin,
            destCity: hotLoad.destination,
            dest_city: hotLoad.destination,
          };
          const smsDriver = { phone: bestDriver.phone, name: bestDriver.name };
          const result = await smsLoadService.sendBookingRequest(smsLoad, smsDriver);
          if (result.success) {
            hotLoad.status = 'dispatched';
            console.log(`[AutoMatcher] ✅ Auto-dispatched load ${loadId} → ${bestDriver.name} (${bestDriver.phone})`);
          } else {
            console.warn(`[AutoMatcher] ⚠️ SMS failed for ${loadId}: ${result.error}`);
          }
        } catch (smsErr: any) {
          console.error(`[AutoMatcher] SMS error for ${loadId}:`, smsErr.message);
        }
      } else {
        // No driver phone — leave as pending for dispatcher to handle
        console.log(`[AutoMatcher] 📋 Hot load ${loadId} queued (no driver phone — manual dispatch needed)`);
      }
    }

    // Clean up dismissed/dispatched loads older than 2 hours
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, hl] of hotLoads) {
      if (hl.status !== 'pending' && new Date(hl.createdAt).getTime() < twoHoursAgo) {
        hotLoads.delete(id);
      }
    }

    const autoSent = Array.from(hotLoads.values()).filter(h => h.status === 'dispatched').length;
    const pending = Array.from(hotLoads.values()).filter(h => h.status === 'pending').length;
    console.log(`[AutoMatcher] Run complete: ${scored.length} hot loads scored, ${autoSent} auto-dispatched, ${pending} pending manual`);
  } catch (err: any) {
    console.error("[AutoMatcher] Error:", err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const autoLoadMatcher = {
  start() {
    if (isRunning) return;
    isRunning = true;

    // Clear any stale matches from previous runs
    hotLoads.clear();

    // Run immediately, then every 2 minutes. Previously 30s, but that collided with
    // the gmail scanner + lifecycle service and spiked event-loop latency on the API
    // process. 2min is plenty fast — loads still get matched before drivers see them.
    runMatcher();
    matcherInterval = setInterval(runMatcher, 2 * 60 * 1000);
    console.log("[AutoMatcher] Started — scanning every 2 minutes");
  },

  stop() {
    if (matcherInterval) {
      clearInterval(matcherInterval);
      matcherInterval = null;
    }
    isRunning = false;
  },

  getHotLoads(): HotLoad[] {
    return Array.from(hotLoads.values())
      .filter(h => h.status === 'pending')
      .sort((a, b) => b.score - a.score);
  },

  getAllMatches(): HotLoad[] {
    return Array.from(hotLoads.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  dismissMatch(id: string): boolean {
    const match = hotLoads.get(id);
    if (!match) return false;
    match.status = 'dismissed';
    return true;
  },

  markDispatched(id: string): boolean {
    const match = hotLoads.get(id);
    if (!match) return false;
    match.status = 'dispatched';
    return true;
  },

  getCriteria(): DispatchCriteria {
    return { ...criteria };
  },

  updateCriteria(updates: Partial<DispatchCriteria>): DispatchCriteria {
    criteria = { ...criteria, ...updates };
    // Re-run matcher immediately with new criteria
    runMatcher();
    return { ...criteria };
  },

  resetCriteria(): DispatchCriteria {
    criteria = { ...DEFAULT_CRITERIA };
    return { ...criteria };
  },

  // Call this from google-sheets-simple.ts to feed loads into the matcher
  feedLoads(loads: any[]) {
    (global as any).__googleSheetsLoads = loads;
  },

  getStats() {
    const all = Array.from(hotLoads.values());
    return {
      total: all.length,
      pending: all.filter(h => h.status === 'pending').length,
      dispatched: all.filter(h => h.status === 'dispatched').length,
      dismissed: all.filter(h => h.status === 'dismissed').length,
      isRunning,
      criteria,
    };
  },
};
