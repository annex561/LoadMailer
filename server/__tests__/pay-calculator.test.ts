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

  it("factoring deduction subtracts from gross", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
    });
    expect(r.netPay).toBe(691.12); // 3% of 712.50 = 21.38 (rounded), net = 691.12
    const factoring = r.deductions.find((d) => d.label.includes("Factoring"));
    expect(factoring?.amount).toBe(-21.38);
  });

  it("dispatch fee + factoring stack", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
      deductDispatchEnabled: true,
      deductDispatchPct: 5.0,
    });
    // Deductions are % of gross pay (not load rate), each rounded to cents
    expect(r.netPay).toBe(655.49); // 712.50 - 21.38 - 35.63
    expect(r.deductions).toHaveLength(2);
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
