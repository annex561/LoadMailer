// Regression guard for the monthly trip-leased gross receipts report
// (server/trip-lease-report.ts). This number goes to an underwriter and sets the
// premium on the trip-lease endorsement, so the month window and the sum have to be
// exactly right.
//
// The assert that matters: the month window is half-open. A load delivering at
// midnight on the 1st of the next month belongs to that month, not this one. An
// inclusive end date double-counts it in both reports.

import { describe, it, expect } from 'vitest';
import {
  monthBounds,
  summarizeExposure,
  exposureToCsv,
  type ExposureRow,
} from '../trip-lease-report';

function row(over: Partial<ExposureRow> = {}): ExposureRow {
  return {
    driverId: 'd1',
    driverName: 'Marcus Webb',
    ownMcNumber: 'MC-1234567',
    powerUnitType: 'box_truck',
    loadNumber: 'L-1',
    addendumNumber: 'TLA-L-1',
    deliveryDate: new Date('2026-09-12T00:00:00Z'),
    grossLinehaul: 1500,
    coverageVerified: true,
    ...over,
  };
}

describe('monthBounds', () => {
  it('is half-open: start inclusive, end exclusive', () => {
    const { start, end } = monthBounds(2026, 9);
    expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls December into the next year', () => {
    expect(monthBounds(2026, 12).end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects a nonsense month or year', () => {
    expect(() => monthBounds(2026, 0)).toThrow();
    expect(() => monthBounds(2026, 13)).toThrow();
    expect(() => monthBounds(1999, 6)).toThrow();
    expect(() => monthBounds(2026, 1.5)).toThrow();
  });
});

describe('summarizeExposure', () => {
  const { start, end } = monthBounds(2026, 9);

  it('totals gross and load count', () => {
    const s = summarizeExposure([row(), row({ loadNumber: 'L-2', grossLinehaul: 2200 })], start, end);
    expect(s.loadCount).toBe(2);
    expect(s.grossLinehaul).toBe(3700);
  });

  it('groups by driver, biggest first', () => {
    const s = summarizeExposure(
      [
        row({ driverId: 'd1', grossLinehaul: 1000 }),
        row({ driverId: 'd2', driverName: 'Dana Ruiz', grossLinehaul: 4000 }),
        row({ driverId: 'd1', grossLinehaul: 500 }),
      ],
      start, end,
    );
    expect(s.byDriver.map((d) => d.driverId)).toEqual(['d2', 'd1']);
    expect(s.byDriver[1].grossLinehaul).toBe(1500);
    expect(s.byDriver[1].loadCount).toBe(2);
  });

  it('rounds to cents so floating-point sums do not drift', () => {
    const s = summarizeExposure(
      [row({ grossLinehaul: 0.1 }), row({ grossLinehaul: 0.2 })],
      start, end,
    );
    expect(s.grossLinehaul).toBe(0.3);
  });

  it('treats a null gross as zero rather than NaN', () => {
    const s = summarizeExposure([row({ grossLinehaul: null })], start, end);
    expect(s.grossLinehaul).toBe(0);
    expect(s.loadCount).toBe(1);
  });

  it('counts loads whose coverage check failed at creation', () => {
    const s = summarizeExposure(
      [row(), row({ loadNumber: 'L-2', coverageVerified: false })],
      start, end,
    );
    expect(s.unverifiedCount).toBe(1);
  });
});

describe('exposureToCsv', () => {
  const { start, end } = monthBounds(2026, 9);

  it('emits a header, one line per driver, and a TOTAL line', () => {
    const csv = exposureToCsv(
      summarizeExposure([row(), row({ loadNumber: 'L-2', grossLinehaul: 500 })], start, end),
    );
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('trip_leased_gross_linehaul');
    expect(lines[1]).toContain('Marcus Webb');
    expect(lines[lines.length - 1]).toBe('2026-09,TOTAL,,,2,2000.00');
  });

  it('quotes a driver name containing a comma', () => {
    const csv = exposureToCsv(summarizeExposure([row({ driverName: 'Webb, Marcus' })], start, end));
    expect(csv).toContain('"Webb, Marcus"');
  });
});
