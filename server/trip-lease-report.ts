// Monthly trip-leased gross receipts report.
//
// A trip-lease endorsement on the carrier's auto policy is rated on the gross receipts
// of the trip-leased revenue, so the insurer asks for a monthly figure. Every load that
// ran under a Trip Lease Addendum is already recorded in trip_addenda
// (server/trip-addendum-service.ts), so this is an aggregation, not new bookkeeping.
//
// Read-only. No outbound traffic, nothing billable, nothing mutated.
//
// Regression guard: server/__tests__/trip-lease-report.test.ts

import { sql } from 'drizzle-orm';
import { db } from './db';

export interface ExposureRow {
  driverId: string | null;
  driverName: string | null;
  ownMcNumber: string | null;
  powerUnitType: string | null;
  loadNumber: string;
  addendumNumber: string;
  deliveryDate: Date | null;
  grossLinehaul: number | null;
  coverageVerified: boolean | null;
}

export interface DriverExposure {
  driverId: string | null;
  driverName: string | null;
  ownMcNumber: string | null;
  powerUnitType: string | null;
  loadCount: number;
  grossLinehaul: number;
}

export interface ExposureSummary {
  periodStart: Date;
  periodEnd: Date;
  loadCount: number;
  grossLinehaul: number;
  /** Loads whose coverage check failed at creation. Should be zero; investigate if not. */
  unverifiedCount: number;
  byDriver: DriverExposure[];
}

/** UTC month window, half-open: [first of month, first of next month). */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('year must be a 4-digit year between 2000 and 2100');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('month must be 1-12');
  }
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Round to cents. Floating-point sums of dollar amounts drift without this. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarizeExposure(
  rows: ExposureRow[],
  periodStart: Date,
  periodEnd: Date,
): ExposureSummary {
  const byDriver = new Map<string, DriverExposure>();
  let grossLinehaul = 0;
  let unverifiedCount = 0;

  for (const r of rows) {
    const gross = r.grossLinehaul ?? 0;
    grossLinehaul += gross;
    if (r.coverageVerified === false) unverifiedCount++;

    const key = r.driverId ?? '(unassigned)';
    const cur = byDriver.get(key) ?? {
      driverId: r.driverId,
      driverName: r.driverName,
      ownMcNumber: r.ownMcNumber,
      powerUnitType: r.powerUnitType,
      loadCount: 0,
      grossLinehaul: 0,
    };
    cur.loadCount += 1;
    cur.grossLinehaul += gross;
    byDriver.set(key, cur);
  }

  const drivers = Array.from(byDriver.values())
    .map((d) => ({ ...d, grossLinehaul: cents(d.grossLinehaul) }))
    .sort((a, b) => b.grossLinehaul - a.grossLinehaul);

  return {
    periodStart,
    periodEnd,
    loadCount: rows.length,
    grossLinehaul: cents(grossLinehaul),
    unverifiedCount,
    byDriver: drivers,
  };
}

/** CSV in the shape an underwriter expects: one line per driver, totals last. */
export function exposureToCsv(summary: ExposureSummary): string {
  const period = summary.periodStart.toISOString().slice(0, 7);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    'period,driver_name,own_mc_number,power_unit_type,loads,trip_leased_gross_linehaul',
  ];
  for (const d of summary.byDriver) {
    lines.push(
      [period, esc(d.driverName), esc(d.ownMcNumber), esc(d.powerUnitType), d.loadCount, d.grossLinehaul.toFixed(2)].join(','),
    );
  }
  lines.push([period, 'TOTAL', '', '', summary.loadCount, summary.grossLinehaul.toFixed(2)].join(','));
  return lines.join('\n') + '\n';
}

export async function getTripLeaseExposure(year: number, month: number): Promise<ExposureSummary> {
  const { start, end } = monthBounds(year, month);
  // Delivery date is the exposure date — the trip is what was insured, and a load
  // dispatched on the 31st that delivers on the 2nd is next month's exposure. Falls
  // back to created_at when a load carried no delivery date.
  const r = await db.execute(sql`
    SELECT ta.load_id, ta.load_number, ta.addendum_number, ta.gross_linehaul,
           ta.coverage_verified, ta.power_unit_type, ta.driver_id,
           COALESCE(ta.delivery_date, ta.created_at) AS exposure_date,
           d.name AS driver_name, d.own_mc_number
    FROM trip_addenda ta
    LEFT JOIN drivers d ON d.id = ta.driver_id
    WHERE COALESCE(ta.delivery_date, ta.created_at) >= ${start}
      AND COALESCE(ta.delivery_date, ta.created_at) < ${end}
    ORDER BY exposure_date ASC
  `);

  const rows: ExposureRow[] = ((r as any).rows ?? []).map((x: any) => ({
    driverId: x.driver_id ?? null,
    driverName: x.driver_name ?? null,
    ownMcNumber: x.own_mc_number ?? null,
    powerUnitType: x.power_unit_type ?? null,
    loadNumber: x.load_number,
    addendumNumber: x.addendum_number,
    deliveryDate: x.exposure_date ? new Date(x.exposure_date) : null,
    grossLinehaul: x.gross_linehaul ?? null,
    coverageVerified: x.coverage_verified ?? null,
  }));

  return summarizeExposure(rows, start, end);
}
