export interface PayDriverInput {
  payType: "percent" | "per_mile" | "flat";
  payRate: number;
  payRateDeadhead: number;

  deductFactoringEnabled: boolean;
  deductFactoringPct: number;
  deductDispatchEnabled: boolean;
  deductDispatchPct: number;
  deductFuelAdvanceEnabled: boolean;
  deductFuelAdvanceAmount: number;

  deductTrailerRentEnabled?: boolean;
  deductTrailerRentWeekly?: number;
  deductInsuranceEnabled?: boolean;
  deductInsuranceWeekly?: number;
  deductEldEnabled?: boolean;
  deductEldMonthly?: number;
  deductOccAccEnabled?: boolean;
  deductOccAccWeekly?: number;
}

export interface PayLoadInput {
  rate: number;
  loadedMiles: number;
  deadheadMiles: number;
}

export interface PayLineItem {
  label: string;
  amount: number;
}

export interface PayResult {
  grossPay: number;                  // driver's pre-deduction share
  lineItems: PayLineItem[];           // how grossPay was computed
  deductions: PayLineItem[];          // per-load deductions FROM driver pay
  netPay: number;                     // grossPay + sum(deductions) — what driver takes home
  recurringDeductions: PayLineItem[]; // weekly/monthly statement items, NOT in netPay
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute the driver's pre-deduction share for this load.
 *
 * Pay rules:
 * - "percent":  payRate is the DRIVER's percentage of gross load.
 *               Driver gross = grossLoad × payRate/100.
 *               Example: $900 load, payRate=80 → driver gross $720.
 *               (The remaining 20% = company commission.)
 * - "per_mile": payRate is $/mile to driver (with optional payRateDeadhead).
 * - "flat":     payRate is the flat $ the driver gets per load.
 */
function computeGross(
  load: PayLoadInput,
  d: PayDriverInput,
): { gross: number; items: PayLineItem[] } {
  if (d.payType === "percent") {
    const gross = round2(load.rate * (d.payRate / 100));
    return {
      gross,
      items: [{ label: `Driver share (${d.payRate}% of $${load.rate.toFixed(2)})`, amount: gross }],
    };
  }
  if (d.payType === "per_mile") {
    const loadedPay = round2(load.loadedMiles * d.payRate);
    const deadheadPay = round2(load.deadheadMiles * d.payRateDeadhead);
    const gross = round2(loadedPay + deadheadPay);
    const items: PayLineItem[] = [
      { label: `Loaded miles (${load.loadedMiles} × $${d.payRate.toFixed(2)})`, amount: loadedPay },
    ];
    if (load.deadheadMiles > 0 && d.payRateDeadhead > 0) {
      items.push({
        label: `Deadhead miles (${load.deadheadMiles} × $${d.payRateDeadhead.toFixed(2)})`,
        amount: deadheadPay,
      });
    }
    return { gross, items };
  }
  // flat
  return {
    gross: round2(d.payRate),
    items: [{ label: "Driver pay (flat)", amount: round2(d.payRate) }],
  };
}

export function calculatePay(load: PayLoadInput, d: PayDriverInput): PayResult {
  const { gross, items } = computeGross(load, d);

  // Per-load deductions FROM driver pay. Factoring + dispatch are calculated as
  // % of GROSS LOAD RATE (not driver's share) — this matches how factoring
  // companies and dispatchers actually charge, and the user's verified math:
  //   $900 (gross) - $180 (20% co) - $27 (3% factoring) - $45 (5% dispatch) = $648
  // Equivalent: driver share $720 - $27 - $45 = $648.
  const deductions: PayLineItem[] = [];
  if (d.deductFactoringEnabled && d.deductFactoringPct > 0) {
    deductions.push({
      label: `Factoring fee (${d.deductFactoringPct}% of $${load.rate.toFixed(2)})`,
      amount: -round2(load.rate * (d.deductFactoringPct / 100)),
    });
  }
  if (d.deductDispatchEnabled && d.deductDispatchPct > 0) {
    deductions.push({
      label: `Dispatch fee (${d.deductDispatchPct}% of $${load.rate.toFixed(2)})`,
      amount: -round2(load.rate * (d.deductDispatchPct / 100)),
    });
  }
  if (d.deductFuelAdvanceEnabled && d.deductFuelAdvanceAmount > 0) {
    deductions.push({
      label: "Fuel advance",
      amount: -round2(d.deductFuelAdvanceAmount),
    });
  }

  const netPay = round2(gross + deductions.reduce((s, x) => s + x.amount, 0));

  const recurringDeductions: PayLineItem[] = [];
  if (d.deductTrailerRentEnabled && (d.deductTrailerRentWeekly ?? 0) > 0) {
    recurringDeductions.push({ label: "Trailer rent (weekly)", amount: -round2(d.deductTrailerRentWeekly!) });
  }
  if (d.deductInsuranceEnabled && (d.deductInsuranceWeekly ?? 0) > 0) {
    recurringDeductions.push({ label: "Insurance (weekly)", amount: -round2(d.deductInsuranceWeekly!) });
  }
  if (d.deductEldEnabled && (d.deductEldMonthly ?? 0) > 0) {
    recurringDeductions.push({ label: "ELD (monthly)", amount: -round2(d.deductEldMonthly!) });
  }
  if (d.deductOccAccEnabled && (d.deductOccAccWeekly ?? 0) > 0) {
    recurringDeductions.push({ label: "Occ/Acc insurance (weekly)", amount: -round2(d.deductOccAccWeekly!) });
  }

  return {
    grossPay: gross,
    lineItems: items,
    deductions,
    netPay,
    recurringDeductions,
  };
}
