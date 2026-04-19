// Settlements Service
// Computes per-driver weekly pay from delivered loads.
//
// Pay rules (per driver, configured on drivers.pay_type / pay_rate):
//   - percent:  payRate = percent of load.rate (e.g. 75 → 75% of rate)
//   - per_mile: payRate = dollars per mile (load.miles * payRate)
//   - flat:     payRate = flat dollars per delivered load
//
// Defaults: percent at 75% if unset.

import { db } from './db';
import { loads, drivers } from '@shared/schema';
import { and, gte, lt, isNotNull, eq } from 'drizzle-orm';

export interface SettlementLoadLine {
  loadId: string;
  loadNumber: string;
  deliveredAt: Date | null;
  rate: number;
  miles: number;
  pay: number;
  origin: string;
  destination: string;
}

export interface DriverSettlement {
  driverId: string;
  driverName: string;
  payType: string;
  payRate: number;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  loadCount: number;
  totalRevenue: number;
  totalPay: number;
  lines: SettlementLoadLine[];
}

// Week runs Mon 00:00 through Sun 23:59:59 (local-ish; UTC on server)
export function weekRange(isoDateYMD: string): { start: Date; end: Date } {
  const [y, m, d] = isoDateYMD.split('-').map(Number);
  const ref = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  // Monday start
  const day = ref.getUTCDay(); // 0 = Sun, 1 = Mon...
  const offsetToMon = (day + 6) % 7;
  const start = new Date(ref);
  start.setUTCDate(ref.getUTCDate() - offsetToMon);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

export function fmtYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function calcPay(
  rate: number,
  miles: number,
  payType: string,
  payRate: number,
): number {
  switch (payType) {
    case 'per_mile':
      return +(miles * payRate).toFixed(2);
    case 'flat':
      return +payRate.toFixed(2);
    case 'percent':
    default:
      return +((rate * payRate) / 100).toFixed(2);
  }
}

export async function computeSettlements(
  weekRef: string,
): Promise<DriverSettlement[]> {
  const { start, end } = weekRange(weekRef);

  const delivered = await db.query.loads.findMany({
    where: and(
      isNotNull(loads.driverId),
      isNotNull(loads.deliveredAt),
      gte(loads.deliveredAt, start),
      lt(loads.deliveredAt, end),
    ),
  });

  // Group by driverId
  const byDriver = new Map<string, typeof delivered>();
  for (const l of delivered) {
    if (!l.driverId) continue;
    const arr = byDriver.get(l.driverId) || [];
    arr.push(l);
    byDriver.set(l.driverId, arr);
  }

  const results: DriverSettlement[] = [];
  for (const [driverId, driverLoads] of byDriver.entries()) {
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
    });
    if (!driver) continue;

    const payType = driver.payType || 'percent';
    const payRate = driver.payRate ?? 75;

    const lines: SettlementLoadLine[] = driverLoads.map((l) => {
      const rate = l.rate || l.offeredRate || 0;
      const miles = l.miles || 0;
      return {
        loadId: l.id,
        loadNumber: l.loadNumber,
        deliveredAt: l.deliveredAt,
        rate,
        miles,
        pay: calcPay(rate, miles, payType, payRate),
        origin:
          [l.originCity, l.originState].filter(Boolean).join(', ') ||
          l.pickupAddress ||
          '',
        destination:
          [l.destCity, l.destState].filter(Boolean).join(', ') ||
          l.deliveryAddress ||
          '',
      };
    });

    const totalPay = +lines.reduce((s, x) => s + x.pay, 0).toFixed(2);
    const totalRevenue = +lines.reduce((s, x) => s + x.rate, 0).toFixed(2);

    results.push({
      driverId,
      driverName: driver.name,
      payType,
      payRate,
      weekStart: fmtYMD(start),
      weekEnd: fmtYMD(new Date(end.getTime() - 1)),
      loadCount: lines.length,
      totalRevenue,
      totalPay,
      lines,
    });
  }

  // Sort highest earner first
  results.sort((a, b) => b.totalPay - a.totalPay);
  return results;
}

export async function computeSettlementForDriver(
  driverId: string,
  weekRef: string,
): Promise<DriverSettlement | null> {
  const all = await computeSettlements(weekRef);
  return all.find((s) => s.driverId === driverId) || null;
}
