// Settlements Service
// Computes per-driver weekly pay from delivered loads.
//
// Pay + deduction math lives in pay-calculator.ts (calculatePay), which is
// unit-tested against the operator's verified examples. This file aggregates
// that per-load math across a Mon–Sun week and layers on weekly items:
// recurring deductions (trailer/insurance/ELD/occ-acc), a manual advance
// repayment, manual misc lines (tolls/repairs), and a weekly fuel figure.
//
// The pure aggregator is `aggregateSettlement` — tested in
// server/__tests__/settlements-aggregate.test.ts. Do NOT inline this math back
// into computeSettlements without updating that test.

import { db } from './db';
import { loads, drivers } from '@shared/schema';
import { and, gte, lt, isNotNull, eq } from 'drizzle-orm';
import { calculatePay, type PayDriverInput, type PayLineItem } from './pay-calculator';

export interface SettlementLoadLine {
  loadId: string;
  loadNumber: string;
  deliveredAt: Date | null;
  rate: number;
  miles: number;
  pay: number; // driver share for this load, BEFORE per-load deductions
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
  grossPay: number;                    // driver's share before deductions
  perLoadDeductions: PayLineItem[];    // factoring/dispatch/fuel-advance, summed per category (negative)
  recurringDeductions: PayLineItem[];  // trailer/insurance/ELD/occ-acc, applied once (negative)
  advanceDeduction: number;            // manual advance repayment this week (positive number)
  miscDeductions: PayLineItem[];       // manual one-offs: tolls/repairs (negative)
  fuelCost: number;                    // weekly fuel deduction (imported total or legacy)
  insuranceCost: number;               // display alias of recurring insurance (already in recurringDeductions)
  totalDeductions: number;             // grossPay − netPay
  netPay: number;                      // bottom line take-home
  totalPay: number;                    // alias of netPay for backward compat
  lines: SettlementLoadLine[];
}

// Shape the aggregator needs from a driver row (subset of the drivers table).
export interface SettlementDriverLike {
  id: string;
  name: string;
  payType?: string | null;
  payRate?: number | null;
  payRateDeadhead?: number | null;
  deductFactoringEnabled?: boolean | null;
  deductFactoringPct?: number | null;
  deductDispatchEnabled?: boolean | null;
  deductDispatchPct?: number | null;
  deductFuelAdvanceEnabled?: boolean | null;
  deductFuelAdvanceAmount?: number | null;
  deductTrailerRentEnabled?: boolean | null;
  deductTrailerRentWeekly?: number | null;
  deductInsuranceEnabled?: boolean | null;
  deductInsuranceWeekly?: number | null;
  deductEldEnabled?: boolean | null;
  deductEldMonthly?: number | null;
  deductOccAccEnabled?: boolean | null;
  deductOccAccWeekly?: number | null;
  weeklyFuelCost?: number | null;
  weeklyInsuranceCost?: number | null;
}

// Shape the aggregator needs from a load row.
export interface SettlementLoadLike {
  id: string;
  loadNumber: string;
  deliveredAt: Date | null;
  rate: number | null;
  offeredRate?: number | null;
  miles: number | null;
  fuelCost?: number | null;
  originCity?: string | null;
  originState?: string | null;
  destCity?: string | null;
  destState?: string | null;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
}

export interface SettlementExtras {
  advanceDeduction?: number;        // manual advance repayment for the week
  miscLines?: PayLineItem[];        // manual one-off deductions (negative amounts)
  fuelOverride?: number | null;     // imported fuel total; when null, fall back to legacy weeklyFuelCost
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toPayDriverInput(d: SettlementDriverLike): PayDriverInput {
  return {
    payType: ((d.payType as any) || 'percent'),
    payRate: d.payRate ?? 80,
    payRateDeadhead: d.payRateDeadhead ?? 0,
    deductFactoringEnabled: !!d.deductFactoringEnabled,
    deductFactoringPct: d.deductFactoringPct ?? 0,
    deductDispatchEnabled: !!d.deductDispatchEnabled,
    deductDispatchPct: d.deductDispatchPct ?? 0,
    deductFuelAdvanceEnabled: !!d.deductFuelAdvanceEnabled,
    deductFuelAdvanceAmount: d.deductFuelAdvanceAmount ?? 0,
    deductTrailerRentEnabled: !!d.deductTrailerRentEnabled,
    deductTrailerRentWeekly: d.deductTrailerRentWeekly ?? 0,
    deductInsuranceEnabled: !!d.deductInsuranceEnabled,
    deductInsuranceWeekly: d.deductInsuranceWeekly ?? 0,
    deductEldEnabled: !!d.deductEldEnabled,
    deductEldMonthly: d.deductEldMonthly ?? 0,
    deductOccAccEnabled: !!d.deductOccAccEnabled,
    deductOccAccWeekly: d.deductOccAccWeekly ?? 0,
  };
}

// Group a label down to its category by stripping the parenthetical detail.
// "Factoring fee (3% of $1000.00)" → "Factoring fee"
function categoryOf(label: string): string {
  const i = label.indexOf('(');
  return (i >= 0 ? label.slice(0, i) : label).trim();
}

/**
 * Pure weekly aggregator. Takes a driver + their delivered loads for the week
 * and returns the full settlement breakdown. No DB access — unit-tested.
 */
export function aggregateSettlement(
  driver: SettlementDriverLike,
  driverLoads: SettlementLoadLike[],
  weekStart: Date,
  weekEnd: Date,
  extras: SettlementExtras = {},
): DriverSettlement {
  const payInput = toPayDriverInput(driver);
  const payType = payInput.payType;
  const payRate = payInput.payRate;

  const lines: SettlementLoadLine[] = [];
  const perLoadByCategory = new Map<string, number>();
  let grossPay = 0;
  let totalRevenue = 0;

  for (const l of driverLoads) {
    const rate = l.rate || l.offeredRate || 0;
    const miles = l.miles || 0;
    const r = calculatePay(
      { rate, loadedMiles: miles, deadheadMiles: 0 },
      payInput,
    );
    grossPay = round2(grossPay + r.grossPay);
    totalRevenue = round2(totalRevenue + rate);
    for (const d of r.deductions) {
      const cat = categoryOf(d.label);
      perLoadByCategory.set(cat, round2((perLoadByCategory.get(cat) || 0) + d.amount));
    }
    lines.push({
      loadId: l.id,
      loadNumber: l.loadNumber,
      deliveredAt: l.deliveredAt,
      rate,
      miles,
      pay: r.grossPay,
      origin:
        [l.originCity, l.originState].filter(Boolean).join(', ') ||
        l.pickupAddress ||
        '',
      destination:
        [l.destCity, l.destState].filter(Boolean).join(', ') ||
        l.deliveryAddress ||
        '',
    });
  }

  const perLoadDeductions: PayLineItem[] = Array.from(perLoadByCategory.entries()).map(
    ([label, amount]) => ({ label, amount }),
  );

  // Recurring deductions are driver-level constants → take from one calc, apply once.
  const recurringDeductions: PayLineItem[] =
    driverLoads.length > 0
      ? calculatePay({ rate: 0, loadedMiles: 0, deadheadMiles: 0 }, payInput).recurringDeductions
      : [];
  const insuranceCost = Math.abs(
    recurringDeductions.find((d) => d.label.toLowerCase().includes('insurance'))?.amount ?? 0,
  );

  const fuelCost = round2(extras.fuelOverride ?? driver.weeklyFuelCost ?? 0);
  const advanceDeduction = round2(extras.advanceDeduction ?? 0);
  const miscDeductions = (extras.miscLines ?? []).map((m) => ({ ...m, amount: round2(m.amount) }));

  const perLoadSum = perLoadDeductions.reduce((s, x) => s + x.amount, 0);
  const recurringSum = recurringDeductions.reduce((s, x) => s + x.amount, 0);
  const miscSum = miscDeductions.reduce((s, x) => s + x.amount, 0);

  const netPay = round2(
    grossPay + perLoadSum + recurringSum + miscSum - fuelCost - advanceDeduction,
  );
  const totalDeductions = round2(grossPay - netPay);

  return {
    driverId: driver.id,
    driverName: driver.name,
    payType,
    payRate,
    weekStart: fmtYMD(weekStart),
    weekEnd: fmtYMD(new Date(weekEnd.getTime() - 1)),
    loadCount: lines.length,
    totalRevenue,
    grossPay,
    perLoadDeductions,
    recurringDeductions,
    advanceDeduction,
    miscDeductions,
    fuelCost,
    insuranceCost,
    totalDeductions,
    netPay,
    totalPay: netPay,
    lines,
  };
}

// Week runs Mon 00:00 through Sun 23:59:59 (UTC on server)
export function weekRange(isoDateYMD: string): { start: Date; end: Date } {
  const [y, m, d] = isoDateYMD.split('-').map(Number);
  const ref = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
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

  const byDriver = new Map<string, typeof delivered>();
  for (const l of delivered) {
    if (!l.driverId) continue;
    const arr = byDriver.get(l.driverId) || [];
    arr.push(l);
    byDriver.set(l.driverId, arr);
  }

  const results: DriverSettlement[] = [];
  for (const [driverId, driverLoads] of Array.from(byDriver.entries())) {
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
    });
    if (!driver) continue;
    // Live advance repayment for this driver (decremented only on paystub finalize).
    const { scheduledRepaymentForDriver } = await import('./advances-service');
    const advanceDeduction = await scheduledRepaymentForDriver(driverId);
    results.push(
      aggregateSettlement(
        driver as SettlementDriverLike,
        driverLoads as SettlementLoadLike[],
        start,
        end,
        { advanceDeduction },
      ),
    );
  }

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
