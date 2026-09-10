// Guards for server/detention-service.ts.
//
// This is a money path: the number these functions produce goes on an invoice to a broker. The
// two assertions that matter most are (a) a re-entry after leaving does NOT extend the first
// window, which would bill the broker for the drive in between, and (b) a missing rate returns
// null rather than a guessed market rate, which would put the operator behind an invoice he
// cannot defend.

import { describe, it, expect } from 'vitest';
import {
  computeDwellWindow,
  computeDetentionClaim,
  formatClaimText,
  DEFAULT_RADIUS_MILES,
  BILLING_INCREMENT_MINUTES,
  type Fix,
} from '../detention-service';

// Chattanooga yard, and a point ~9 miles away that is unambiguously off-site.
const STOP = { lat: 35.0457, lon: -85.3097 };
const AWAY = { lat: 35.1700, lon: -85.3097 };

const T0 = new Date('2026-09-10T08:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const atStop = (min: number): Fix => ({ latitude: STOP.lat, longitude: STOP.lon, timestamp: at(min) });
const away = (min: number): Fix => ({ latitude: AWAY.lat, longitude: AWAY.lon, timestamp: at(min) });

describe('computeDwellWindow', () => {
  it('returns null when the driver never reached the stop', () => {
    const w = computeDwellWindow([away(0), away(30)], STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(60));
    expect(w).toBeNull();
  });

  it('measures arrival to departure', () => {
    const w = computeDwellWindow(
      [away(0), atStop(10), atStop(40), atStop(70), away(100)],
      STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(120),
    );
    expect(w).not.toBeNull();
    expect(w!.arrivedAt.toISOString()).toBe(at(10).toISOString());
    expect(w!.departedAt!.toISOString()).toBe(at(100).toISOString());
    expect(w!.dwellMinutes).toBe(90);
    expect(w!.fixCount).toBe(3);
  });

  it('sorts unsorted input, so newest-first storage results work unchanged', () => {
    const shuffled = [away(100), atStop(40), away(0), atStop(70), atStop(10)];
    const w = computeDwellWindow(shuffled, STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(120));
    expect(w!.arrivedAt.toISOString()).toBe(at(10).toISOString());
    expect(w!.dwellMinutes).toBe(90);
  });

  it('does NOT let a later re-entry extend the first window', () => {
    // Arrives 10, leaves 40, comes back 200, leaves 260. Billing the whole 10→260 span would
    // charge the broker for a two-hour round trip the truck spent on the road.
    const w = computeDwellWindow(
      [atStop(10), atStop(30), away(40), away(150), atStop(200), away(260)],
      STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(300),
    );
    expect(w!.departedAt!.toISOString()).toBe(at(40).toISOString());
    expect(w!.dwellMinutes).toBe(30);
  });

  it('measures to now and reports departedAt null while the truck is still on site', () => {
    const w = computeDwellWindow([away(0), atStop(20), atStop(50)], STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(80));
    expect(w!.departedAt).toBeNull();
    expect(w!.dwellMinutes).toBe(60);
  });

  it('reports the largest tracking gap inside the window', () => {
    const w = computeDwellWindow(
      [atStop(0), atStop(5), atStop(95), away(100)],
      STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(120),
    );
    expect(w!.gapMinutes).toBe(90);
  });

  it('respects the radius — a fix 9 miles out is not "at the stop"', () => {
    // geofence-cron uses 5 miles for SMS lead time. If that constant leaked in here, this
    // 9-mile point would register as an arrival and highway minutes would bill as detention.
    const w = computeDwellWindow([away(0), away(60)], STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(90));
    expect(w).toBeNull();
    const wide = computeDwellWindow([away(0), away(60)], STOP.lat, STOP.lon, 12, at(90));
    expect(wide).not.toBeNull();
  });

  it('handles an empty or junk fix list without throwing', () => {
    expect(computeDwellWindow([], STOP.lat, STOP.lon)).toBeNull();
    expect(computeDwellWindow([{ latitude: NaN, longitude: 0, timestamp: at(0) }], STOP.lat, STOP.lon)).toBeNull();
  });
});

describe('computeDetentionClaim', () => {
  // Realistic support: telematics-cron polls every 5 minutes, so a truck sitting from t+10 to
  // t+190 leaves a dense trail. Sparse fixtures trip the gap guard, which is the guard working.
  const dense: Fix[] = [away(0)];
  for (let m = 10; m <= 185; m += 5) dense.push(atStop(m));
  dense.push(away(190));

  const solidWindow = computeDwellWindow(dense, STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(240))!;

  it('subtracts free time and bills the remainder', () => {
    // 180 min on site, 120 free → 60 billable → 1.0 hr at $50 = $50.
    const c = computeDetentionClaim(solidWindow, 120, 50)!;
    expect(c.dwellMinutes).toBe(180);
    expect(c.billableMinutes).toBe(60);
    expect(c.billableHours).toBe(1);
    expect(c.amount).toBe(50);
    expect(c.confidence).toBe('high');
    expect(c.reasons).toEqual([]);
  });

  it('rounds billable time UP to the billing increment, toward the carrier', () => {
    // 180 on site, 165 free → 15 billable exactly → 0.25 hr.
    expect(computeDetentionClaim(solidWindow, 165, 60)!.billableHours).toBe(0.25);
    // 180 on site, 170 free → 10 billable → rounds up to 15 → 0.25 hr.
    const c = computeDetentionClaim(solidWindow, 170, 60)!;
    expect(c.billableMinutes).toBe(10);
    expect(c.billableHours).toBe(BILLING_INCREMENT_MINUTES / 60);
    expect(c.amount).toBe(15);
  });

  it('returns a zero claim, not null, when the dwell fits inside free time', () => {
    const c = computeDetentionClaim(solidWindow, 240, 50)!;
    expect(c).not.toBeNull();
    expect(c.billableMinutes).toBe(0);
    expect(c.billableHours).toBe(0);
    expect(c.amount).toBe(0);
  });

  it('returns null when there is no rate — never guesses a market rate', () => {
    expect(computeDetentionClaim(solidWindow, 120, null)).toBeNull();
    expect(computeDetentionClaim(solidWindow, 120, 0)).toBeNull();
    expect(computeDetentionClaim(solidWindow, 120, NaN)).toBeNull();
  });

  it('returns null when there is no window', () => {
    expect(computeDetentionClaim(null, 120, 50)).toBeNull();
  });

  it('assumes zero free time when the rate confirmation had none, and says so', () => {
    const c = computeDetentionClaim(solidWindow, null, 50)!;
    expect(c.freeMinutes).toBe(0);
    expect(c.billableMinutes).toBe(180);
    expect(c.confidence).toBe('low');
    expect(c.reasons.join(' ')).toMatch(/free-time/i);
  });

  it('marks a claim low-confidence when tracking gapped inside the window', () => {
    const gappy = computeDwellWindow(
      [atStop(0), atStop(5), atStop(180), away(190)],
      STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(240),
    )!;
    const c = computeDetentionClaim(gappy, 60, 50)!;
    expect(c.confidence).toBe('low');
    expect(c.reasons.join(' ')).toMatch(/gap in tracking/i);
  });

  it('marks a claim low-confidence when too few fixes support it', () => {
    const thin = computeDwellWindow([atStop(0), away(200)], STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(240))!;
    const c = computeDetentionClaim(thin, 60, 50)!;
    expect(c.confidence).toBe('low');
    expect(c.reasons.join(' ')).toMatch(/position fix/i);
  });

  it('marks a claim low-confidence while the truck is still on site', () => {
    const open = computeDwellWindow(
      [atStop(0), atStop(60), atStop(120), atStop(180)],
      STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(200),
    )!;
    const c = computeDetentionClaim(open, 60, 50)!;
    expect(c.confidence).toBe('low');
    expect(c.reasons.join(' ')).toMatch(/has not left/i);
  });
});

describe('formatClaimText', () => {
  it('renders every number a broker would ask about', () => {
    const fixes: Fix[] = [away(0)];
    for (let m = 10; m <= 185; m += 5) fixes.push(atStop(m));
    fixes.push(away(190));
    const w = computeDwellWindow(fixes, STOP.lat, STOP.lon, DEFAULT_RADIUS_MILES, at(240))!;
    const c = computeDetentionClaim(w, 120, 50)!;
    const text = formatClaimText({
      loadNumber: 'A847291',
      stopLabel: 'Delivery',
      stopAddress: '456 Consignee Rd, Dallas, TX',
      window: w,
      claim: c,
    });
    expect(text).toContain('A847291');
    expect(text).toContain('456 Consignee Rd, Dallas, TX');
    expect(text).toContain('$50.00');
    expect(text).toContain('36 GPS position fixes');
  });
});
