import { describe, it, expect } from "vitest";
import { calculatePay, PayDriverInput, PayLoadInput } from "../pay-calculator";

const baseDriver: PayDriverInput = {
  payType: "percent",
  payRate: 80, // driver's percentage of gross load (matches DB default)
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

describe("calculatePay — percent rule means DRIVER's % of gross", () => {
  it("user's TQL example: $900 load, 80% driver, 3% factoring, 5% dispatch → $648 net", () => {
    // Verified by hand:
    //   $900 gross - $180 (20% company) - $27 (3% factoring) - $45 (5% dispatch) = $648 driver
    // Equivalent:
    //   $900 × 80% = $720 driver share, then -$27 -$45 = $648 net.
    const r = calculatePay(
      { rate: 900, loadedMiles: 0, deadheadMiles: 0 },
      {
        ...baseDriver,
        payRate: 80,
        deductFactoringEnabled: true,
        deductFactoringPct: 3.0,
        deductDispatchEnabled: true,
        deductDispatchPct: 5.0,
      },
    );
    expect(r.grossPay).toBe(720);   // 80% × $900
    expect(r.netPay).toBe(648);     // $720 - $27 - $45
    expect(r.deductions.find((d) => d.label.includes("Factoring"))?.amount).toBe(-27);
    expect(r.deductions.find((d) => d.label.includes("Dispatch"))?.amount).toBe(-45);
  });

  it("80% driver share on $2850 = $2280 with no fees", () => {
    const r = calculatePay(baseLoad, baseDriver);
    expect(r.grossPay).toBe(2280); // 80% × $2850
    expect(r.netPay).toBe(2280);
  });

  it("per_mile rule: payRate is $/mile to driver", () => {
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

  it("factoring 3% of $2850 = $85.50 deducted from driver pay", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
    });
    expect(r.grossPay).toBe(2280);
    expect(r.netPay).toBe(2194.5); // $2280 - $85.50
    expect(r.deductions.find((d) => d.label.includes("Factoring"))?.amount).toBe(-85.5);
  });

  it("factoring + dispatch stack, both calculated on gross load rate", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
      deductDispatchEnabled: true,
      deductDispatchPct: 5.0,
    });
    // $2280 - $85.50 (factoring) - $142.50 (dispatch) = $2052
    expect(r.netPay).toBe(2052);
    expect(r.deductions).toHaveLength(2);
  });

  it("fuel advance is flat per-load deduction", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFuelAdvanceEnabled: true,
      deductFuelAdvanceAmount: 200,
    });
    expect(r.netPay).toBe(2280 - 200); // $2080
  });

  it("returns recurring deductions separately, not in net", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductInsuranceEnabled: true,
      deductInsuranceWeekly: 75,
      deductTrailerRentEnabled: true,
      deductTrailerRentWeekly: 200,
    });
    expect(r.netPay).toBe(2280); // recurring not applied per-load
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
    // 80% × $1234.567 = $987.6536 → $987.65
    expect(r.grossPay).toBe(987.65);
  });
});
