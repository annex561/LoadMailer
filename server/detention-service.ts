// Detention — turn dock time into a billable claim with evidence.
//
// WHY THIS IS COMPUTED FROM RAW FIXES AND NOT FROM geofence_events
//
// The obvious approach is to read geofence_events.dwellTime, which exists in the schema and is
// written by GPSTrackingService.checkGeofences(). Do not do that. That code path is DEAD:
// the live phone route (server/routes.ts, POST /api/driver-location/update) writes straight to
// storage.createDriverLocation() and never calls GPSTrackingService.updateDriverLocation(), so
// checkGeofences() never runs in production and geofence_events is never populated. Building on
// that column returns zero for every load, silently, with no error to notice.
//
// The live geofencing is server/geofence-cron.ts, and it does something different: every 2
// minutes it haversines the SINGLE NEWEST fix against pickup/delivery at a 5-mile radius and
// fires the photo-upload SMS. It stores no arrival time and computes no dwell. Its 5 miles is
// tuned to give the driver SMS lead time before the gate — it is not a measurement of dock
// time, and reusing that constant here would count highway minutes as detention.
//
// So: dwell is derived here, from the driver_locations history, at a much tighter radius.
//
// Everything in this file is PURE — no DB, no network, no clock beyond the `now` you pass in.
// Pinned by server/__tests__/detention-math.test.ts.

import { haversineDistance } from './auto-load-matcher';

/** Default radius counted as "at the stop". Deliberately far tighter than geofence-cron's 5mi. */
export const DEFAULT_RADIUS_MILES = 0.5;

/** Billing rounds up to this granularity. Industry norm, and it rounds toward the carrier. */
export const BILLING_INCREMENT_MINUTES = 15;

/** A tracking gap longer than this inside the window makes the dwell a guess, not a measurement. */
export const MAX_TRUSTED_GAP_MINUTES = 30;

/** Fewer supporting fixes than this and the window is too thin to defend to a broker. */
export const MIN_TRUSTED_FIX_COUNT = 3;

export interface Fix {
  latitude: number;
  longitude: number;
  timestamp: Date;
}

export interface DwellWindow {
  arrivedAt: Date;
  /** null = still inside the radius as of the newest fix. */
  departedAt: Date | null;
  dwellMinutes: number;
  /** How many fixes fall inside the window. Thin support = weak evidence. */
  fixCount: number;
  /** Largest gap between consecutive fixes inside the window, in minutes. */
  gapMinutes: number;
}

export interface DetentionClaim {
  dwellMinutes: number;
  freeMinutes: number;
  billableMinutes: number;
  billableHours: number;
  ratePerHour: number;
  amount: number;
  confidence: 'high' | 'low';
  /** Every reason the claim is weak. Shown to the dispatcher before they send it. */
  reasons: string[];
}

const MS_PER_MIN = 60_000;

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_MIN;
}

/**
 * Find the first visit to a stop.
 *
 * Arrival is the first fix inside `radiusMiles`. Departure is the first fix AFTER arrival that
 * is back outside. A re-entry later does not extend the first window — a second visit is a
 * separate claim and is out of scope here; returning a window that spans a departure and a
 * return would bill the broker for the drive in between.
 *
 * Accepts fixes in any order; sorts internally, because storage.getDriverLocations returns
 * newest-first while a raw query returns oldest-first and callers should not have to care.
 *
 * Returns null when the driver never entered the radius.
 */
export function computeDwellWindow(
  fixes: Fix[],
  stopLat: number,
  stopLon: number,
  radiusMiles: number = DEFAULT_RADIUS_MILES,
  now: Date = new Date(),
): DwellWindow | null {
  if (!Array.isArray(fixes) || fixes.length === 0) return null;

  const sorted = [...fixes]
    .filter((f) => f && Number.isFinite(f.latitude) && Number.isFinite(f.longitude) && f.timestamp)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (sorted.length === 0) return null;

  const inside = (f: Fix) =>
    haversineDistance(f.latitude, f.longitude, stopLat, stopLon) <= radiusMiles;

  const firstInsideIdx = sorted.findIndex(inside);
  if (firstInsideIdx === -1) return null;

  const arrivedAt = sorted[firstInsideIdx].timestamp;

  // Walk forward to the first fix back outside the radius.
  let departedAt: Date | null = null;
  let lastInsideIdx = firstInsideIdx;
  for (let i = firstInsideIdx + 1; i < sorted.length; i++) {
    if (inside(sorted[i])) {
      lastInsideIdx = i;
    } else {
      departedAt = sorted[i].timestamp;
      break;
    }
  }

  const windowFixes = sorted.slice(firstInsideIdx, lastInsideIdx + 1);

  // Largest gap between consecutive supporting fixes. If tracking dropped for an hour in the
  // middle, the dwell is inferred across that hour rather than observed, and the dispatcher
  // needs to know that before sending an invoice.
  let gapMinutes = 0;
  for (let i = 1; i < windowFixes.length; i++) {
    const gap = minutesBetween(windowFixes[i].timestamp, windowFixes[i - 1].timestamp);
    if (gap > gapMinutes) gapMinutes = gap;
  }

  // Still inside → measure to now. A truck sitting at a dock right now is accruing detention.
  const endedAt = departedAt ?? now;
  const dwellMinutes = Math.max(0, minutesBetween(endedAt, arrivedAt));

  return {
    arrivedAt,
    departedAt,
    dwellMinutes,
    fixCount: windowFixes.length,
    gapMinutes,
  };
}

/**
 * Turn a dwell window into a claim.
 *
 * Returns null ONLY when there is no rate to bill at. Never guess a market detention rate: a
 * number the rate confirmation does not contain is not collectable, and inventing one puts the
 * operator in front of a broker with an invoice he cannot defend.
 *
 * A dwell inside free time returns a real claim with amount 0 rather than null, so the
 * dispatcher sees "you were inside free time" instead of an empty panel and wonders if it broke.
 */
export function computeDetentionClaim(
  window: DwellWindow | null,
  freeMinutes: number | null,
  ratePerHour: number | null,
): DetentionClaim | null {
  if (!window) return null;
  if (ratePerHour === null || !Number.isFinite(ratePerHour) || ratePerHour <= 0) return null;

  const reasons: string[] = [];

  let free = freeMinutes;
  if (free === null || !Number.isFinite(free) || free < 0) {
    free = 0;
    reasons.push('No free-time term parsed from the rate confirmation — assuming zero free time.');
  }

  if (window.departedAt === null) {
    reasons.push('Truck has not left the stop yet — dwell is still running.');
  }
  if (window.gapMinutes > MAX_TRUSTED_GAP_MINUTES) {
    reasons.push(`${Math.round(window.gapMinutes)} min gap in tracking inside the window.`);
  }
  if (window.fixCount < MIN_TRUSTED_FIX_COUNT) {
    reasons.push(`Only ${window.fixCount} position fix(es) support this window.`);
  }

  const billableMinutes = Math.max(0, window.dwellMinutes - free);
  const billableHours = billableMinutes === 0
    ? 0
    : roundUpToIncrement(billableMinutes, BILLING_INCREMENT_MINUTES) / 60;

  const amount = round2(billableHours * ratePerHour);

  return {
    dwellMinutes: Math.round(window.dwellMinutes),
    freeMinutes: free,
    billableMinutes: Math.round(billableMinutes),
    billableHours,
    ratePerHour,
    amount,
    confidence: reasons.length > 0 ? 'low' : 'high',
    reasons,
  };
}

function roundUpToIncrement(minutes: number, increment: number): number {
  return Math.ceil(minutes / increment) * increment;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Plain-text claim block a dispatcher can paste into an email to the broker.
 * Deliberately not sent from the app — see the spec's Phase 2 "do NOT". Sending is a new
 * outbound path and gets its own approval cycle.
 */
export function formatClaimText(args: {
  loadNumber: string;
  stopLabel: string;
  stopAddress: string;
  window: DwellWindow;
  claim: DetentionClaim;
}): string {
  const { loadNumber, stopLabel, stopAddress, window, claim } = args;
  const fmt = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'still on site');
  return [
    `Detention claim — load ${loadNumber}`,
    `${stopLabel}: ${stopAddress}`,
    `Arrived:   ${fmt(window.arrivedAt)}`,
    `Departed:  ${fmt(window.departedAt)}`,
    `Total on site: ${claim.dwellMinutes} min`,
    `Free time: ${claim.freeMinutes} min`,
    `Billable:  ${claim.billableMinutes} min (${claim.billableHours} hr at ${BILLING_INCREMENT_MINUTES}-min increments)`,
    `Rate:      $${claim.ratePerHour.toFixed(2)}/hr`,
    `Amount:    $${claim.amount.toFixed(2)}`,
    `Evidence:  ${window.fixCount} GPS position fixes on file for this window.`,
  ].join('\n');
}
