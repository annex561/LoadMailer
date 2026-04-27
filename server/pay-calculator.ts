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
  grossPay: number;
  lineItems: PayLineItem[];      // how grossPay was computed
  deductions: PayLineItem[];     // per-load deductions FROM driver pay (negative amounts)
  netPay: number;                // grossPay + deductions (deductions are negative)
  recurringDeductions: PayLineItem[]; // informational only; shown on driver page but not in netPay
  // Company-side accounting (NOT subtracted from driver pay — these are company expenses)
  companyExpenses: PayLineItem[];
  companyNet: number; // load gross - driver gross - companyExpenses
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function computeGross(load: PayLoadInput, d: PayDriverInput): { gross: number; items: PayLineItem[] } {
  if (d.payType === "percent") {
    const gross = round2(load.rate * (d.payRate / 100));
    return {
      gross,
      items: [{ label: `Driver pay (${d.payRate}% of linehaul)`, amount: gross }],
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

  // ---- Driver-side: what comes out of DRIVER's pay ----
  // Per business rule: factoring and dispatch fees are COMPANY expenses, NOT
  // deducted from driver pay. Driver takes home their full % (or per-mile, or flat).
  // Only fuel advance (cash given to driver pre-load) reduces per-load take-home.
  const deductions: PayLineItem[] = [];
  if (d.deductFuelAdvanceEnabled && d.deductFuelAdvanceAmount > 0) {
    deductions.push({
      label: "Fuel advance",
      amount: -round2(d.deductFuelAdvanceAmount),
    });
  }

  const netPay = round2(gross + deductions.reduce((s, x) => s + x.amount, 0));

  // ---- Recurring (weekly/monthly): shown on driver statement, NOT subtracted from per-load net ----
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

  // ---- Company-side: per-load expenses ----
  // These DO NOT reduce driver pay. They're shown only on the admin company P&L view.
  const companyExpenses: PayLineItem[] = [];
  if (d.deductFactoringEnabled && d.deductFactoringPct > 0) {
    companyExpenses.push({
      label: `Factoring fee (${d.deductFactoringPct}% of gross)`,
      amount: -round2(load.rate * (d.deductFactoringPct / 100)),
    });
  }
  if (d.deductDispatchEnabled && d.deductDispatchPct > 0) {
    companyExpenses.push({
      label: `Dispatch fee (${d.deductDispatchPct}% of gross)`,
      amount: -round2(load.rate * (d.deductDispatchPct / 100)),
    });
  }
  // Company net = gross load - driver gross - company expenses
  const companyExpenseTotal = companyExpenses.reduce((s, x) => s + x.amount, 0);
  const companyNet = round2(load.rate - gross + companyExpenseTotal);

  return {
    grossPay: gross,
    lineItems: items,
    deductions,
    netPay,
    recurringDeductions,
    companyExpenses,
    companyNet,
  };
}
