import { describe, it, expect } from "vitest";
import { calculatePay, PayDriverInput, PayLoadInput } from "../pay-calculator";

const baseDriver: PayDriverInput = {
  payType: "percent",
  payRate: 25,
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

describe("calculatePay", () => {
  it("percent rule: 25% of $2850 = $712.50", () => {
    const r = calculatePay(baseLoad, baseDriver);
    expect(r.grossPay).toBe(712.5);
    expect(r.lineItems).toEqual([{ label: "Driver pay (25% of linehaul)", amount: 712.5 }]);
    expect(r.netPay).toBe(712.5);
  });

  it("per_mile rule: $0.75 loaded + $0.50 deadhead", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      payType: "per_mile",
      payRate: 0.75,
      payRateDeadhead: 0.5,
    });
    expect(r.grossPay).toBe(650); // 800 * 0.75 + 100 * 0.5 = 600 + 50
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

  it("factoring is a COMPANY expense, not deducted from driver pay", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
    });
    // Driver still takes home full 25% of $2850 = $712.50 — no factoring reduction
    expect(r.netPay).toBe(712.5);
    expect(r.deductions).toHaveLength(0);
    // Factoring shows up on the COMPANY side as 3% of GROSS LOAD ($2850), not driver pay
    const factoring = r.companyExpenses.find((d) => d.label.includes("Factoring"));
    expect(factoring?.amount).toBe(-85.5); // 3% of 2850 = 85.50
  });

  it("dispatch + factoring stack as COMPANY expenses, driver still gets full pay", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
      deductDispatchEnabled: true,
      deductDispatchPct: 5.0,
    });
    // Driver pay unaffected by factoring/dispatch
    expect(r.netPay).toBe(712.5);
    expect(r.deductions).toHaveLength(0);
    // Both fees show on company side, % of gross load rate
    expect(r.companyExpenses).toHaveLength(2);
    expect(r.companyExpenses.find((e) => e.label.includes("Factoring"))?.amount).toBe(-85.5);  // 3% × 2850
    expect(r.companyExpenses.find((e) => e.label.includes("Dispatch"))?.amount).toBe(-142.5);  // 5% × 2850
    // Company net = 2850 - 712.50 (driver) - 85.50 (factoring) - 142.50 (dispatch) = 1909.50
    expect(r.companyNet).toBe(1909.5);
  });

  it("user's TQL example: $900 load, 20% driver, 3% factoring, 5% dispatch", () => {
    // Reproduces the exact scenario the user verified by hand:
    //   $900 - $180 (driver) - $27 (factoring) - $45 (dispatch) = $648 (company net)
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
    expect(r.netPay).toBe(180);                    // driver takes home $180 clean
    expect(r.companyExpenses.find((e) => e.label.includes("Factoring"))?.amount).toBe(-27);
    expect(r.companyExpenses.find((e) => e.label.includes("Dispatch"))?.amount).toBe(-45);
    expect(r.companyNet).toBe(648);                // company keeps $648
  });

  it("fuel advance is flat per-load amount", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFuelAdvanceEnabled: true,
      deductFuelAdvanceAmount: 200,
    });
    expect(r.netPay).toBe(712.5 - 200);
  });

  it("returns recurring deductions separately, not in net", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductInsuranceEnabled: true,
      deductInsuranceWeekly: 75,
      deductTrailerRentEnabled: true,
      deductTrailerRentWeekly: 200,
    });
    expect(r.netPay).toBe(712.5); // recurring not applied here
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
    expect(r.grossPay).toBe(308.64); // 1234.567 * 0.25 = 308.64175 → 308.64
  });
});
