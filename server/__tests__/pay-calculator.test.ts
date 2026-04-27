import { describe, it, expect } from "vitest";
import { calculatePay, PayDriverInput, PayLoadInput } from "../pay-calculator";

const baseDriver: PayDriverInput = {
  payType: "percent",
  payRate: 25, // company's commission %
  payRateDeadhead: 0,
  deductFactoringEnabled: false,
  deductFactoringPct: 0,
  deductDispatchEnabled: false,
  deductDispatchPct: 0,
  deductFuelAdvanceEnabled: false,
  deductFuelAdvanceAmount: 0,
};

const baseLoad: PayLoadInput = {
  rate: 2850,
  loadedMiles: 800,
  deadheadMiles: 100,
};

describe("calculatePay — percent rule means COMPANY commission %", () => {
  it("user's TQL example: $900 load, 20% company, 3% factoring, 5% dispatch", () => {
    // The exact scenario user verified by hand:
    //   $900 - $180 (20% company) - $27 (3% factoring) - $45 (5% dispatch) = $648 driver net
    const r = calculatePay(
      { rate: 900, loadedMiles: 0, deadheadMiles: 0 },
      {
        ...baseDriver,
        payRate: 20,
        deductFactoringEnabled: true,
        deductFactoringPct: 3.0,
        deductDispatchEnabled: true,
        deductDispatchPct: 5.0,
      },
    );
    expect(r.grossPay).toBe(720);   // driver's pre-fee share: 80% of $900
    expect(r.netPay).toBe(648);     // after factoring + dispatch deductions
    expect(r.deductions.find((d) => d.label.includes("Factoring"))?.amount).toBe(-27);
    expect(r.deductions.find((d) => d.label.includes("Dispatch"))?.amount).toBe(-45);
  });

  it("25% company commission on $2850 → driver gross = 75% × $2850 = $2137.50", () => {
    const r = calculatePay(baseLoad, baseDriver);
    expect(r.grossPay).toBe(2137.5);
    expect(r.netPay).toBe(2137.5); // no deductions configured
  });

  it("per_mile rule: payRate is $/mile, factoring/dispatch still apply on gross load", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      payType: "per_mile",
      payRate: 0.75,
      payRateDeadhead: 0.5,
    });
    expect(r.grossPay).toBe(650); // 800 × 0.75 + 100 × 0.5 = 650
    expect(r.lineItems).toHaveLength(2);
  });

  it("flat rule: pays exact amount regardless of rate", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      payType: "flat",
      payRate: 500,
    });
    expect(r.grossPay).toBe(500);
    expect(r.netPay).toBe(500);
  });

  it("factoring deduction: 3% of $2850 = $85.50 off driver gross", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
    });
    // Driver gross = 75% × $2850 = $2137.50
    // Factoring = 3% × $2850 = $85.50
    // Net = $2137.50 - $85.50 = $2052.00
    expect(r.netPay).toBe(2052);
    expect(r.deductions.find((d) => d.label.includes("Factoring"))?.amount).toBe(-85.5);
  });

  it("factoring + dispatch stack: both calculated on gross load rate", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
      deductDispatchEnabled: true,
      deductDispatchPct: 5.0,
    });
    // Driver gross = $2137.50
    // Factoring 3% × $2850 = -$85.50
    // Dispatch 5% × $2850 = -$142.50
    // Net = $2137.50 - $85.50 - $142.50 = $1909.50
    expect(r.netPay).toBe(1909.5);
    expect(r.deductions).toHaveLength(2);
  });

  it("fuel advance is flat per-load deduction", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFuelAdvanceEnabled: true,
      deductFuelAdvanceAmount: 200,
    });
    expect(r.netPay).toBe(2137.5 - 200);
  });

  it("returns recurring deductions separately, not in net", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductInsuranceEnabled: true,
      deductInsuranceWeekly: 75,
      deductTrailerRentEnabled: true,
      deductTrailerRentWeekly: 200,
    });
    expect(r.netPay).toBe(2137.5); // recurring not applied to per-load net
    expect(r.recurringDeductions).toHaveLength(2);
    expect(r.recurringDeductions.find((r) => r.label.includes("Insurance"))?.amount).toBe(-75);
  });

  it("zero rate returns zero pay, not NaN", () => {
    const r = calculatePay({ ...baseLoad, rate: 0 }, baseDriver);
    expect(r.grossPay).toBe(0);
    expect(r.netPay).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    const r = calculatePay({ ...baseLoad, rate: 1234.567 }, baseDriver);
    // Driver gross = 75% × $1234.567 = $925.92525 → $925.93
    expect(r.grossPay).toBe(925.93);
  });
});
