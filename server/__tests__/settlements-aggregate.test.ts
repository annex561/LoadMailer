import { describe, it, expect } from "vitest";
import {
  aggregateSettlement,
  type SettlementDriverLike,
  type SettlementLoadLike,
} from "../settlements-service";

// Minimal driver on defaults — every deduction OFF (matches a fresh DB row).
const baseDriver: SettlementDriverLike = {
  id: "drv-1",
  name: "Test Driver",
  payType: "percent",
  payRate: 80,
  payRateDeadhead: 0,
  deductFactoringEnabled: false,
  deductFactoringPct: 3,
  deductDispatchEnabled: false,
  deductDispatchPct: 5,
  deductFuelAdvanceEnabled: false,
  deductFuelAdvanceAmount: 0,
  deductTrailerRentEnabled: false,
  deductTrailerRentWeekly: 0,
  deductInsuranceEnabled: false,
  deductInsuranceWeekly: 0,
  deductEldEnabled: false,
  deductEldMonthly: 0,
  deductOccAccEnabled: false,
  deductOccAccWeekly: 0,
  weeklyFuelCost: 0,
  weeklyInsuranceCost: 0,
};

function load(over: Partial<SettlementLoadLike> = {}): SettlementLoadLike {
  return {
    id: over.id || "l1",
    loadNumber: over.loadNumber || "L-001",
    deliveredAt: over.deliveredAt ?? new Date("2026-05-26T12:00:00Z"),
    rate: over.rate ?? 1000,
    offeredRate: over.offeredRate ?? null,
    miles: over.miles ?? 500,
    fuelCost: over.fuelCost ?? null,
    originCity: over.originCity ?? "Atlanta",
    originState: over.originState ?? "GA",
    destCity: over.destCity ?? "Miami",
    destState: over.destState ?? "FL",
    pickupAddress: over.pickupAddress ?? null,
    deliveryAddress: over.deliveryAddress ?? null,
  };
}

const wkStart = new Date("2026-05-25T00:00:00Z");
const wkEnd = new Date("2026-06-01T00:00:00Z");

describe("aggregateSettlement — weekly roll-up now honors configured deductions", () => {
  // REGRESSION: the old computeSettlements ignored factoring/dispatch entirely
  // and only subtracted legacy weeklyFuelCost/weeklyInsuranceCost. This asserts
  // the configured per-load deductions actually reduce net pay now.
  it("applies factoring 3% + dispatch 5% per load (old code ignored these)", () => {
    const s = aggregateSettlement(
      {
        ...baseDriver,
        deductFactoringEnabled: true,
        deductFactoringPct: 3,
        deductDispatchEnabled: true,
        deductDispatchPct: 5,
      },
      [load({ rate: 1000, id: "a", loadNumber: "A" }), load({ rate: 2000, id: "b", loadNumber: "B" })],
      wkStart,
      wkEnd,
    );
    // gross = 80% of (1000+2000) = 2400
    expect(s.grossPay).toBe(2400);
    // factoring = 3% of 3000 = 90; dispatch = 5% of 3000 = 150
    // net = 2400 - 90 - 150 = 2160
    expect(s.netPay).toBe(2160);
    expect(s.totalDeductions).toBe(240);
    expect(s.loadCount).toBe(2);
  });

  it("recurring deductions (trailer rent) apply ONCE per week, not per load", () => {
    const s = aggregateSettlement(
      { ...baseDriver, deductTrailerRentEnabled: true, deductTrailerRentWeekly: 200 },
      [load({ rate: 1000, id: "a" }), load({ rate: 1000, id: "b" })],
      wkStart,
      wkEnd,
    );
    // gross = 80% of 2000 = 1600; trailer rent once = 200; net = 1400
    expect(s.grossPay).toBe(1600);
    expect(s.netPay).toBe(1400);
    const trailer = s.recurringDeductions.find((d) => d.label.includes("Trailer"));
    expect(trailer?.amount).toBe(-200);
  });

  it("manual advance repayment reduces net by exactly the keyed amount", () => {
    const s = aggregateSettlement(
      baseDriver,
      [load({ rate: 1000 })],
      wkStart,
      wkEnd,
      { advanceDeduction: 150 },
    );
    expect(s.grossPay).toBe(800);
    expect(s.netPay).toBe(650);
    expect(s.advanceDeduction).toBe(150);
  });

  it("manual misc lines (tolls/repairs) reduce net", () => {
    const s = aggregateSettlement(
      baseDriver,
      [load({ rate: 1000 })],
      wkStart,
      wkEnd,
      { miscLines: [{ label: "Toll reimbursement", amount: -40 }, { label: "Repair", amount: -60 }] },
    );
    expect(s.netPay).toBe(800 - 100);
    expect(s.miscDeductions).toHaveLength(2);
  });

  it("fuelOverride (imported fuel total) replaces legacy weeklyFuelCost", () => {
    const s = aggregateSettlement(
      { ...baseDriver, weeklyFuelCost: 999 },
      [load({ rate: 1000 })],
      wkStart,
      wkEnd,
      { fuelOverride: 250 },
    );
    expect(s.fuelCost).toBe(250);
    expect(s.netPay).toBe(800 - 250);
  });

  it("no deductions, no extras → net equals gross", () => {
    const s = aggregateSettlement(baseDriver, [load({ rate: 1000 })], wkStart, wkEnd);
    expect(s.grossPay).toBe(800);
    expect(s.netPay).toBe(800);
    expect(s.totalDeductions).toBe(0);
  });

  it("per-load pay line equals driver share before per-load deductions", () => {
    const s = aggregateSettlement(
      { ...baseDriver, deductFactoringEnabled: true, deductFactoringPct: 3 },
      [load({ rate: 1000, id: "a", loadNumber: "A" })],
      wkStart,
      wkEnd,
    );
    expect(s.lines[0].pay).toBe(800); // 80% of 1000, pre-deduction
    expect(s.netPay).toBe(800 - 30); // less 3% factoring
  });
});
