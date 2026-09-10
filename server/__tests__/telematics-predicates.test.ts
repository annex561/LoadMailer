// Guards for server/telematics-service.ts.
//
// The load-bearing assertion in this file is "phone wins while fresh". If that inverts, the ELD
// starts overwriting better phone data and accuracy drops with NO error anywhere — geofence-cron
// reads only the newest row, so a lower-quality newer row silently replaces a better one and
// nothing throws. That is the failure mode this file exists to catch.

import { describe, it, expect } from 'vitest';
import {
  shouldIngestTelematicsFix,
  isDuplicateFix,
  isValidFix,
  mapTruckXPayload,
  DEFAULT_PHONE_STALE_AFTER_MIN,
  DEFAULT_MAX_FIX_AGE_MIN,
  type TelematicsFix,
} from '../telematics-service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const minsAhead = (m: number) => new Date(NOW.getTime() + m * 60_000);

function decide(over: Partial<Parameters<typeof shouldIngestTelematicsFix>[0]> = {}) {
  return shouldIngestTelematicsFix({
    lastPhoneFixAt: null,
    telematicsFixAt: minsAgo(1),
    now: NOW,
    phoneStaleAfterMin: DEFAULT_PHONE_STALE_AFTER_MIN,
    maxFixAgeMin: DEFAULT_MAX_FIX_AGE_MIN,
    ...over,
  });
}

function fix(over: Partial<TelematicsFix> = {}): TelematicsFix {
  return {
    vehicleId: 'V1',
    latitude: 35.0457,
    longitude: -85.3097,
    speedMph: 55,
    headingDeg: 90,
    recordedAt: minsAgo(1),
    ...over,
  };
}

describe('shouldIngestTelematicsFix', () => {
  it('ingests when the driver has never sent a phone fix', () => {
    expect(decide({ lastPhoneFixAt: null })).toBe(true);
  });

  it('REFUSES while the phone is still fresh (the phone stays primary)', () => {
    // Phone reported 2 minutes ago, threshold is 5 — phone is alive, ELD must not overwrite it.
    expect(decide({ lastPhoneFixAt: minsAgo(2) })).toBe(false);
  });

  it('ingests once the phone has gone quiet past the stale threshold', () => {
    expect(decide({ lastPhoneFixAt: minsAgo(9) })).toBe(true);
  });

  it('treats the stale threshold as exclusive at the boundary', () => {
    // Exactly 5 minutes is not yet "stale" — must still defer to the phone.
    expect(decide({ lastPhoneFixAt: minsAgo(DEFAULT_PHONE_STALE_AFTER_MIN) })).toBe(false);
    expect(decide({ lastPhoneFixAt: minsAgo(DEFAULT_PHONE_STALE_AFTER_MIN + 0.5) })).toBe(true);
  });

  it('REFUSES a telematics fix that is itself older than maxFixAgeMin', () => {
    // A stale ELD fix poisons geofence-cron, which trusts whatever row is newest.
    expect(decide({ lastPhoneFixAt: null, telematicsFixAt: minsAgo(45) })).toBe(false);
  });

  it('refuses a stale fix even when the phone is also dead', () => {
    expect(decide({ lastPhoneFixAt: minsAgo(120), telematicsFixAt: minsAgo(31) })).toBe(false);
  });

  it('tolerates small clock skew but refuses a fix far in the future', () => {
    expect(decide({ telematicsFixAt: minsAhead(1) })).toBe(true);
    expect(decide({ telematicsFixAt: minsAhead(10) })).toBe(false);
  });

  it('honours caller-supplied thresholds over the defaults', () => {
    expect(decide({ lastPhoneFixAt: minsAgo(2), phoneStaleAfterMin: 1 })).toBe(true);
    expect(decide({ telematicsFixAt: minsAgo(20), maxFixAgeMin: 10 })).toBe(false);
  });
});

describe('isDuplicateFix', () => {
  it('is never a duplicate when nothing is stored yet', () => {
    expect(isDuplicateFix(null, fix())).toBe(false);
  });

  it('flags an identical replayed sample (parked truck, provider repeats the last fix)', () => {
    const t = minsAgo(3);
    const prev = { latitude: 35.0457, longitude: -85.3097, recordedAt: t };
    expect(isDuplicateFix(prev, fix({ recordedAt: t }))).toBe(true);
  });

  it('is not a duplicate when the timestamp advances even at the same coordinates', () => {
    const prev = { latitude: 35.0457, longitude: -85.3097, recordedAt: minsAgo(9) };
    expect(isDuplicateFix(prev, fix({ recordedAt: minsAgo(3) }))).toBe(false);
  });

  it('is not a duplicate when the truck moved', () => {
    const t = minsAgo(3);
    const prev = { latitude: 35.9606, longitude: -83.9207, recordedAt: t };
    expect(isDuplicateFix(prev, fix({ recordedAt: t }))).toBe(false);
  });
});

describe('isValidFix', () => {
  it('accepts a real coordinate', () => {
    expect(isValidFix(fix())).toBe(true);
  });

  it('rejects Null Island, which is always a provider default and never a truck', () => {
    expect(isValidFix(fix({ latitude: 0, longitude: 0 }))).toBe(false);
  });

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(isValidFix(fix({ latitude: 91 }))).toBe(false);
    expect(isValidFix(fix({ longitude: -181 }))).toBe(false);
    expect(isValidFix(fix({ latitude: NaN }))).toBe(false);
  });

  it('rejects an unparseable timestamp', () => {
    expect(isValidFix(fix({ recordedAt: new Date('nonsense') }))).toBe(false);
  });
});

describe('mapTruckXPayload', () => {
  it('maps a flat array of vehicles', () => {
    const out = mapTruckXPayload([
      { vehicleId: 'TX-9', latitude: 35.04, longitude: -85.3, speed: 61, heading: 275, timestamp: '2026-09-10T11:58:00Z' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].vehicleId).toBe('TX-9');
    expect(out[0].speedMph).toBe(61);
    expect(out[0].recordedAt.toISOString()).toBe('2026-09-10T11:58:00.000Z');
  });

  it('unwraps a { data: [...] } envelope and a nested location object', () => {
    const out = mapTruckXPayload({
      data: [
        {
          vehicle_id: 'TX-10',
          location: { lat: 36.16, lng: -86.78, gps_time: '2026-09-10T11:50:00Z' },
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].vehicleId).toBe('TX-10');
    expect(out[0].latitude).toBeCloseTo(36.16);
    expect(out[0].longitude).toBeCloseTo(-86.78);
  });

  it('unwraps a doubly-nested { data: { vehicles: [...] } } envelope', () => {
    const out = mapTruckXPayload({
      data: { vehicles: [{ id: 'TX-11', lat: 35.1, lon: -90.0, timestamp: 1789041000 }] },
    });
    expect(out).toHaveLength(1);
    expect(out[0].vehicleId).toBe('TX-11');
    // Unix SECONDS must be widened to ms, not read as 1970.
    expect(out[0].recordedAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('drops unmappable rows without losing the good ones', () => {
    const out = mapTruckXPayload([
      { vehicleId: 'TX-1', lat: 35.0, lon: -85.0, timestamp: '2026-09-10T11:59:00Z' },
      { latitude: 35.0, longitude: -85.0, timestamp: '2026-09-10T11:59:00Z' }, // no vehicle id
      { vehicleId: 'TX-2' },                                                    // no coordinates
      { vehicleId: 'TX-3', lat: 0, lon: 0, timestamp: '2026-09-10T11:59:00Z' }, // Null Island
    ]);
    expect(out.map((f) => f.vehicleId)).toEqual(['TX-1']);
  });

  it('returns an empty array for shapes it does not recognise instead of throwing', () => {
    expect(mapTruckXPayload(null)).toEqual([]);
    expect(mapTruckXPayload('nope')).toEqual([]);
    expect(mapTruckXPayload({ unexpected: true })).toEqual([]);
  });
});
