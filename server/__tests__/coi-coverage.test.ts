// Regression guard for the trip-addendum coverage gate (server/coi-service.ts).
//
// Master Trip Lease Section 10.4 forbids tendering a Trip Addendum while any required
// coverage is lapsed. The gate is only as good as the date it checks against.
//
// The assert that matters most: a certificate that is valid TODAY but expires BEFORE the
// scheduled delivery must NOT pass. Checking against `now` instead of the delivery date
// waves through a truck that goes bare mid-trip, which is the exact failure this gate
// exists to prevent. If anyone "simplifies" evaluateCoverage to compare against the
// current date, that test fails loudly.

import { describe, it, expect } from 'vitest';
import {
  REQUIRED_COI_TYPES,
  evaluateCoverage,
  coverageFailureReason,
  assertCoverageCurrentForTripLease,
  daysUntil,
  type CoverageDoc,
} from '../coi-service';

const NOW = new Date('2026-09-09T12:00:00Z');
const DELIVERY = new Date('2026-09-12T17:00:00Z');

function fullSet(expiry: string, overrides: Record<string, string> = {}): CoverageDoc[] {
  return REQUIRED_COI_TYPES.map((type) => ({
    type,
    expiryDate: new Date(overrides[type] ?? expiry),
    status: 'active',
  }));
}

describe('evaluateCoverage', () => {
  it('passes when every required coverage is on file and outlasts delivery', () => {
    const s = evaluateCoverage(fullSet('2027-01-01'), DELIVERY);
    expect(s.ok).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.lapsed).toEqual([]);
  });

  it('fails when a required coverage has no certificate on file', () => {
    const docs = fullSet('2027-01-01').filter((d) => d.type !== 'coi_bobtail');
    const s = evaluateCoverage(docs, DELIVERY);
    expect(s.ok).toBe(false);
    expect(s.missing).toEqual(['coi_bobtail']);
  });

  it('fails a certificate that is valid today but expires BEFORE delivery', () => {
    // Valid on 09-09, dead on 09-11, delivery is 09-12. This is the whole point.
    const docs = fullSet('2027-01-01', { coi_auto_liability: '2026-09-11T00:00:00Z' });
    const s = evaluateCoverage(docs, DELIVERY);
    expect(s.ok).toBe(false);
    expect(s.lapsed.map((l) => l.type)).toEqual(['coi_auto_liability']);

    // Same documents against today alone would have passed — proving the gate would be
    // useless if it compared to `now`.
    expect(evaluateCoverage(docs, NOW).ok).toBe(true);
  });

  it('fails an already-expired certificate', () => {
    const docs = fullSet('2027-01-01', { coi_cargo: '2026-08-01T00:00:00Z' });
    const s = evaluateCoverage(docs, DELIVERY);
    expect(s.ok).toBe(false);
    expect(s.lapsed.map((l) => l.type)).toEqual(['coi_cargo']);
  });

  it('ignores documents whose status is not active', () => {
    const docs = fullSet('2027-01-01').map((d) =>
      d.type === 'coi_occ_acc' ? { ...d, status: 'revoked' } : d,
    );
    const s = evaluateCoverage(docs, DELIVERY);
    expect(s.ok).toBe(false);
    expect(s.missing).toEqual(['coi_occ_acc']);
  });

  it('counts a renewal filed alongside the expiring original', () => {
    const docs: CoverageDoc[] = [
      ...fullSet('2027-01-01'),
      { type: 'coi_auto_liability', expiryDate: new Date('2026-09-10T00:00:00Z'), status: 'active' },
    ];
    // The old one expires before delivery, the renewal does not. Newest expiry wins.
    expect(evaluateCoverage(docs, DELIVERY).ok).toBe(true);
  });

  it('treats a missing status as active', () => {
    const docs = fullSet('2027-01-01').map(({ type, expiryDate }) => ({ type, expiryDate }));
    expect(evaluateCoverage(docs, DELIVERY).ok).toBe(true);
  });

  it('reports the soonest expiry across the required set', () => {
    const docs = fullSet('2027-01-01', { coi_bobtail: '2026-10-05T00:00:00Z' });
    expect(evaluateCoverage(docs, DELIVERY).soonestExpiry).toEqual(
      new Date('2026-10-05T00:00:00Z'),
    );
  });
});

describe('coverageFailureReason', () => {
  it('is empty when coverage passes', () => {
    expect(coverageFailureReason(evaluateCoverage(fullSet('2027-01-01'), DELIVERY))).toBe('');
  });

  it('names both the missing and the lapsed coverages', () => {
    const docs = fullSet('2027-01-01', { coi_cargo: '2026-08-01T00:00:00Z' }).filter(
      (d) => d.type !== 'coi_bobtail',
    );
    const reason = coverageFailureReason(evaluateCoverage(docs, DELIVERY));
    expect(reason).toContain('bobtail');
    expect(reason).toContain('cargo');
    expect(reason).toContain('2026-08-01');
  });
});

describe('assertCoverageCurrentForTripLease', () => {
  it('does not throw on current coverage', () => {
    expect(() =>
      assertCoverageCurrentForTripLease(evaluateCoverage(fullSet('2027-01-01'), DELIVERY)),
    ).not.toThrow();
  });

  it('throws and cites Section 10.4 when coverage is lapsed', () => {
    const docs = fullSet('2027-01-01', { coi_physical_damage: '2026-08-01T00:00:00Z' });
    expect(() =>
      assertCoverageCurrentForTripLease(evaluateCoverage(docs, DELIVERY)),
    ).toThrow(/10\.4/);
  });
});

describe('daysUntil', () => {
  it('counts whole days forward', () => {
    expect(daysUntil(new Date('2026-09-19T12:00:00Z'), NOW)).toBe(10);
  });

  it('goes negative once expired', () => {
    expect(daysUntil(new Date('2026-09-07T12:00:00Z'), NOW)).toBe(-2);
  });
});
