# Universal Ratecon Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal ratecon intake system: forwarded email + PDF upload + manual entry → AI-parsed with confidence scores → validator-gated → auto-dispatch to driver (or route ambiguous ones to a review queue) with correct per-driver pay math baked in.

**Architecture:** One intake queue (`rateconIntake` table), three writers (Gmail poller, PDF upload endpoint, manual form). GPT-4o Vision returns structured JSON with per-field confidence. Deterministic validators gate auto-dispatch; failures route to review queue UI. Pay calculation is a pure function of (extracted rate + driver pay rule + active deduction toggles) stored on the driver profile. Driver receives SMS with tokenized confirmation link showing only their earnings breakdown — never gross linehaul.

**Tech Stack:** TypeScript, Express, React (Vite + wouter), Drizzle ORM, NeonDB (Postgres), Twilio, SendGrid, OpenAI GPT-4o Vision, pdfjs-dist, multer, zod, vitest (to be added).

---

## File Structure

### New server files
- `server/pay-calculator.ts` — pure function computing driver pay from load + driver profile.
- `server/ratecon-validators.ts` — deterministic validator chain (date sanity, geocode, rate bounds, etc.).
- `server/ratecon-intake-service.ts` — orchestrator: parse → validate → route to dispatch or review queue.
- `server/ratecon-confidence-parser.ts` — replacement for `ratecon-parser.ts`, returns per-field confidence.
- `server/driver-name-matcher.ts` — fuzzy-matches parsed driver name against driver profiles.
- `server/ratecon-intake-routes.ts` — Express routes for upload, manual entry, review queue CRUD.
- `server/driver-confirmation-routes.ts` — tokenized public routes for driver YES/NO accept page.
- `server/ratecon-admin-alerts.ts` — sends admin SMS when items hit review queue.
- `server/ratecon-escalation-cron.ts` — 30-min escalation if driver doesn't respond.

### New test files
- `server/__tests__/pay-calculator.test.ts`
- `server/__tests__/ratecon-validators.test.ts`
- `server/__tests__/driver-name-matcher.test.ts`
- `server/__tests__/ratecon-confidence-parser.test.ts`

### Modified server files
- `shared/schema.ts` — extend `drivers` with per-load and recurring deduction fields; add `rateconIntake` table; add `confirmationToken` / `confirmationStatus` columns to `loads`.
- `server/ratecon-parser.ts` — deprecated but kept for backward compatibility (mark with JSDoc comment).
- `server/email-ingestion-service.ts` — write to `rateconIntake` instead of `loads` directly.
- `server/routes.ts` — register new intake routes and confirmation routes.
- `server/index.ts` — register escalation cron.

### New client files
- `client/src/pages/review-queue.tsx` — dispatcher review queue UI.
- `client/src/pages/ratecon-upload.tsx` — drag-and-drop PDF upload UI.
- `client/src/pages/driver-confirm.tsx` — mobile-first driver confirmation page (tokenized, no auth).
- `client/src/components/driver-pay-rules-form.tsx` — pay rule + deductions form for driver profile.
- `client/src/components/review-queue-row.tsx` — single flagged-load row with inline edit.

### Modified client files
- `client/src/pages/driver-profile.tsx` — embed `DriverPayRulesForm`.
- `client/src/pages/driver-onboarding.tsx` — add pay rule step.
- `client/src/App.tsx` — add routes for `/review-queue`, `/ratecon-upload`, `/l/:token`.

### Config files
- `package.json` — add vitest + @vitest/ui + supertest.
- `vitest.config.ts` — new vitest config.

---

## Milestone 1: Test infrastructure + Pay engine

**Ship criterion:** Admin can set any pay rule and deduction combo on a driver profile. Calling `calculatePay(load, driver)` returns the correct net and line items. 100% unit test coverage on the calculator.

### Task 1.1: Install vitest + add test script

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest and supertest**

Run from repo root:
```bash
npm install --save-dev vitest@^2.1.0 @vitest/ui@^2.1.0 supertest@^7.0.0 @types/supertest@^6.0.2
```

- [ ] **Step 2: Add test scripts to `package.json`**

In the `scripts` block in `package.json`, add (keeping existing scripts):
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
```

- [ ] **Step 3: Create `vitest.config.ts` at repo root**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/__tests__/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
```

- [ ] **Step 4: Create a smoke test to verify setup**

Create `server/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test
```
Expected: 1 test passing, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts server/__tests__/smoke.test.ts
git commit -m "chore: add vitest test infrastructure"
```

---

### Task 1.2: Extend drivers schema with full pay/deduction fields

**Files:**
- Modify: `shared/schema.ts:144-210` (the `drivers` table)

- [ ] **Step 1: Replace the Settlement/pay config block in drivers table**

In `shared/schema.ts`, locate the existing block:
```ts
  // Settlement / pay config
  payType: text("pay_type").default("percent"), // percent, per_mile, flat
  payRate: real("pay_rate").default(80),
  weeklyFuelCost: real("weekly_fuel_cost").default(0),
  weeklyInsuranceCost: real("weekly_insurance_cost").default(0),
```

Replace with:
```ts
  // Settlement / pay config
  payType: text("pay_type").default("percent"), // percent, per_mile, flat
  payRate: real("pay_rate").default(80),               // percent => 0-100; per_mile => loaded $/mi; flat => $/load
  payRateDeadhead: real("pay_rate_deadhead").default(0), // per_mile only: $/mi for deadhead; 0 if not applicable

  // Per-load deductions (applied on every load)
  deductFactoringEnabled: boolean("deduct_factoring_enabled").notNull().default(false),
  deductFactoringPct: real("deduct_factoring_pct").default(3.0),    // % of gross
  deductDispatchEnabled: boolean("deduct_dispatch_enabled").notNull().default(false),
  deductDispatchPct: real("deduct_dispatch_pct").default(5.0),      // % of gross
  deductFuelAdvanceEnabled: boolean("deduct_fuel_advance_enabled").notNull().default(false),
  deductFuelAdvanceAmount: real("deduct_fuel_advance_amount").default(0),   // $ per load

  // Weekly / recurring deductions (shown on statement, not per-load net)
  deductTrailerRentEnabled: boolean("deduct_trailer_rent_enabled").notNull().default(false),
  deductTrailerRentWeekly: real("deduct_trailer_rent_weekly").default(0),
  deductInsuranceEnabled: boolean("deduct_insurance_enabled").notNull().default(false),
  deductInsuranceWeekly: real("deduct_insurance_weekly").default(0),
  deductEldEnabled: boolean("deduct_eld_enabled").notNull().default(false),
  deductEldMonthly: real("deduct_eld_monthly").default(0),
  deductOccAccEnabled: boolean("deduct_occ_acc_enabled").notNull().default(false),
  deductOccAccWeekly: real("deduct_occ_acc_weekly").default(0),

  // Legacy (keep for backward compat; prefer new fields above)
  weeklyFuelCost: real("weekly_fuel_cost").default(0),
  weeklyInsuranceCost: real("weekly_insurance_cost").default(0),
```

- [ ] **Step 2: Run TypeScript check to verify no schema breakage**

```bash
npm run check
```
Expected: no errors in `shared/schema.ts`. There may be pre-existing errors in other files — only the schema should type-check clean.

- [ ] **Step 3: Push schema to Neon**

```bash
npm run db:push
```
Expected: Drizzle prompts for column additions. Accept. New columns added to `drivers`.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(schema): extend drivers with full pay rule and deduction fields"
```

---

### Task 1.3: Pay calculator module (TDD)

**Files:**
- Create: `server/pay-calculator.ts`
- Create: `server/__tests__/pay-calculator.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `server/__tests__/pay-calculator.test.ts`:
```ts
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
    expect(r.netPay).toBe(712.5 - 21.375); // 3% of 712.50 = 21.375
    const factoring = r.deductions.find((d) => d.label.includes("Factoring"));
    expect(factoring?.amount).toBeCloseTo(-21.375, 2);
  });

  it("dispatch fee + factoring stack", () => {
    const r = calculatePay(baseLoad, {
      ...baseDriver,
      deductFactoringEnabled: true,
      deductFactoringPct: 3.0,
      deductDispatchEnabled: true,
      deductDispatchPct: 5.0,
    });
    // Deductions are % of gross pay (not load rate)
    expect(r.netPay).toBeCloseTo(712.5 - 21.375 - 35.625, 2);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- server/__tests__/pay-calculator.test.ts
```
Expected: All tests fail with "Cannot find module '../pay-calculator'".

- [ ] **Step 3: Implement `server/pay-calculator.ts`**

```ts
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
  deductions: PayLineItem[];     // per-load deductions (negative amounts)
  netPay: number;                // grossPay + deductions (deductions are negative)
  recurringDeductions: PayLineItem[]; // informational only; shown on driver page but not in netPay
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

  const deductions: PayLineItem[] = [];
  if (d.deductFactoringEnabled && d.deductFactoringPct > 0) {
    deductions.push({
      label: `Factoring fee (${d.deductFactoringPct}%)`,
      amount: -round2(gross * (d.deductFactoringPct / 100)),
    });
  }
  if (d.deductDispatchEnabled && d.deductDispatchPct > 0) {
    deductions.push({
      label: `Dispatch fee (${d.deductDispatchPct}%)`,
      amount: -round2(gross * (d.deductDispatchPct / 100)),
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

  return { grossPay: gross, lineItems: items, deductions, netPay, recurringDeductions };
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test -- server/__tests__/pay-calculator.test.ts
```
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/pay-calculator.ts server/__tests__/pay-calculator.test.ts
git commit -m "feat: add pay calculator with full rule and deduction support"
```

---

### Task 1.4: Driver pay rules form component

**Files:**
- Create: `client/src/components/driver-pay-rules-form.tsx`
- Modify: `client/src/pages/driver-profile.tsx`

- [ ] **Step 1: Create the form component**

Create `client/src/components/driver-pay-rules-form.tsx`:
```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DriverPayRules {
  payType: "percent" | "per_mile" | "flat";
  payRate: number;
  payRateDeadhead: number;
  deductFactoringEnabled: boolean;
  deductFactoringPct: number;
  deductDispatchEnabled: boolean;
  deductDispatchPct: number;
  deductFuelAdvanceEnabled: boolean;
  deductFuelAdvanceAmount: number;
  deductTrailerRentEnabled: boolean;
  deductTrailerRentWeekly: number;
  deductInsuranceEnabled: boolean;
  deductInsuranceWeekly: number;
  deductEldEnabled: boolean;
  deductEldMonthly: number;
  deductOccAccEnabled: boolean;
  deductOccAccWeekly: number;
}

interface Props {
  initial: DriverPayRules;
  onSave: (rules: DriverPayRules) => Promise<void>;
}

export function DriverPayRulesForm({ initial, onSave }: Props) {
  const [rules, setRules] = useState<DriverPayRules>(initial);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(rules);
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof DriverPayRules>(key: K, value: DriverPayRules[K]) =>
    setRules((r) => ({ ...r, [key]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay & Deductions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label>Pay Rule</Label>
          <RadioGroup
            value={rules.payType}
            onValueChange={(v) => set("payType", v as DriverPayRules["payType"])}
            className="space-y-2 mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="percent" id="pt-pct" />
              <Label htmlFor="pt-pct">Percentage of linehaul</Label>
              <Input
                type="number"
                value={rules.payType === "percent" ? rules.payRate : ""}
                onChange={(e) => set("payRate", Number(e.target.value))}
                disabled={rules.payType !== "percent"}
                className="w-20"
                data-testid="input-pay-percent"
              />
              <span>%</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <RadioGroupItem value="per_mile" id="pt-mi" />
              <Label htmlFor="pt-mi">Per mile — loaded $</Label>
              <Input
                type="number"
                step="0.01"
                value={rules.payType === "per_mile" ? rules.payRate : ""}
                onChange={(e) => set("payRate", Number(e.target.value))}
                disabled={rules.payType !== "per_mile"}
                className="w-24"
                data-testid="input-pay-loaded-mile"
              />
              <Label>deadhead $</Label>
              <Input
                type="number"
                step="0.01"
                value={rules.payType === "per_mile" ? rules.payRateDeadhead : ""}
                onChange={(e) => set("payRateDeadhead", Number(e.target.value))}
                disabled={rules.payType !== "per_mile"}
                className="w-24"
                data-testid="input-pay-deadhead-mile"
              />
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="flat" id="pt-flat" />
              <Label htmlFor="pt-flat">Flat per load $</Label>
              <Input
                type="number"
                value={rules.payType === "flat" ? rules.payRate : ""}
                onChange={(e) => set("payRate", Number(e.target.value))}
                disabled={rules.payType !== "flat"}
                className="w-24"
                data-testid="input-pay-flat"
              />
            </div>
          </RadioGroup>
        </div>

        <div>
          <Label className="mb-2 block">Standing Deductions</Label>
          <div className="space-y-2">
            <DeductionRow
              checked={rules.deductFactoringEnabled}
              onChecked={(v) => set("deductFactoringEnabled", v)}
              label="Factoring fee"
              value={rules.deductFactoringPct}
              onValueChange={(v) => set("deductFactoringPct", v)}
              suffix="% of gross"
            />
            <DeductionRow
              checked={rules.deductDispatchEnabled}
              onChecked={(v) => set("deductDispatchEnabled", v)}
              label="Dispatch fee"
              value={rules.deductDispatchPct}
              onValueChange={(v) => set("deductDispatchPct", v)}
              suffix="% of gross"
            />
            <DeductionRow
              checked={rules.deductFuelAdvanceEnabled}
              onChecked={(v) => set("deductFuelAdvanceEnabled", v)}
              label="Fuel advance"
              value={rules.deductFuelAdvanceAmount}
              onValueChange={(v) => set("deductFuelAdvanceAmount", v)}
              suffix="$ per load"
              prefix="$"
            />
            <DeductionRow
              checked={rules.deductTrailerRentEnabled}
              onChecked={(v) => set("deductTrailerRentEnabled", v)}
              label="Trailer rent"
              value={rules.deductTrailerRentWeekly}
              onValueChange={(v) => set("deductTrailerRentWeekly", v)}
              suffix="$ per week"
              prefix="$"
            />
            <DeductionRow
              checked={rules.deductInsuranceEnabled}
              onChecked={(v) => set("deductInsuranceEnabled", v)}
              label="Insurance"
              value={rules.deductInsuranceWeekly}
              onValueChange={(v) => set("deductInsuranceWeekly", v)}
              suffix="$ per week"
              prefix="$"
            />
            <DeductionRow
              checked={rules.deductEldEnabled}
              onChecked={(v) => set("deductEldEnabled", v)}
              label="ELD"
              value={rules.deductEldMonthly}
              onValueChange={(v) => set("deductEldMonthly", v)}
              suffix="$ per month"
              prefix="$"
            />
            <DeductionRow
              checked={rules.deductOccAccEnabled}
              onChecked={(v) => set("deductOccAccEnabled", v)}
              label="Occ/Acc insurance"
              value={rules.deductOccAccWeekly}
              onValueChange={(v) => set("deductOccAccWeekly", v)}
              suffix="$ per week"
              prefix="$"
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} data-testid="btn-save-pay-rules">
          {saving ? "Saving..." : "Save Driver Rules"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DeductionRow(props: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  suffix: string;
  prefix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox checked={props.checked} onCheckedChange={(v) => props.onChecked(!!v)} />
      <Label className="w-36">{props.label}</Label>
      {props.prefix && <span>{props.prefix}</span>}
      <Input
        type="number"
        step="0.01"
        value={props.value}
        onChange={(e) => props.onValueChange(Number(e.target.value))}
        disabled={!props.checked}
        className="w-24"
      />
      <span className="text-sm text-muted-foreground">{props.suffix}</span>
    </div>
  );
}
```

- [ ] **Step 2: Add API endpoint to update driver pay rules**

In `server/routes.ts`, find the existing driver update route (search for `app.patch` or `app.put` with `/drivers/`). Add a dedicated endpoint above or next to it:
```ts
// PATCH /api/drivers/:id/pay-rules — update driver pay config
app.patch("/api/drivers/:id/pay-rules", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    // Whitelist pay-related fields only
    const allowed = [
      "payType", "payRate", "payRateDeadhead",
      "deductFactoringEnabled", "deductFactoringPct",
      "deductDispatchEnabled", "deductDispatchPct",
      "deductFuelAdvanceEnabled", "deductFuelAdvanceAmount",
      "deductTrailerRentEnabled", "deductTrailerRentWeekly",
      "deductInsuranceEnabled", "deductInsuranceWeekly",
      "deductEldEnabled", "deductEldMonthly",
      "deductOccAccEnabled", "deductOccAccWeekly",
    ];
    const payload: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) payload[key] = updates[key];
    }
    const { db } = await import("./db");
    const { drivers } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [updated] = await db.update(drivers).set(payload).where(eq(drivers.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Driver not found" });
    res.json(updated);
  } catch (err: any) {
    console.error("[pay-rules] update failed:", err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Embed form in driver profile page**

In `client/src/pages/driver-profile.tsx`, import and render the form. Add at the top of the file:
```tsx
import { DriverPayRulesForm, DriverPayRules } from "@/components/driver-pay-rules-form";
```

Find the main render block and add a section for pay rules after the existing fields. Example integration (adjust to match existing page structure):
```tsx
{driver && (
  <DriverPayRulesForm
    initial={{
      payType: (driver.payType ?? "percent") as DriverPayRules["payType"],
      payRate: driver.payRate ?? 0,
      payRateDeadhead: driver.payRateDeadhead ?? 0,
      deductFactoringEnabled: driver.deductFactoringEnabled ?? false,
      deductFactoringPct: driver.deductFactoringPct ?? 3,
      deductDispatchEnabled: driver.deductDispatchEnabled ?? false,
      deductDispatchPct: driver.deductDispatchPct ?? 5,
      deductFuelAdvanceEnabled: driver.deductFuelAdvanceEnabled ?? false,
      deductFuelAdvanceAmount: driver.deductFuelAdvanceAmount ?? 0,
      deductTrailerRentEnabled: driver.deductTrailerRentEnabled ?? false,
      deductTrailerRentWeekly: driver.deductTrailerRentWeekly ?? 0,
      deductInsuranceEnabled: driver.deductInsuranceEnabled ?? false,
      deductInsuranceWeekly: driver.deductInsuranceWeekly ?? 0,
      deductEldEnabled: driver.deductEldEnabled ?? false,
      deductEldMonthly: driver.deductEldMonthly ?? 0,
      deductOccAccEnabled: driver.deductOccAccEnabled ?? false,
      deductOccAccWeekly: driver.deductOccAccWeekly ?? 0,
    }}
    onSave={async (rules) => {
      const res = await fetch(`/api/drivers/${driver.id}/pay-rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      if (!res.ok) throw new Error("Save failed");
      // refresh page data
      window.location.reload();
    }}
  />
)}
```

- [ ] **Step 4: Run typecheck and dev server**

```bash
npm run check
npm run dev
```
Navigate to a driver profile page. Verify the Pay & Deductions card renders. Toggle a checkbox, enter a value, click Save. Expected: network request succeeds (200), page reloads, values persist.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/driver-pay-rules-form.tsx client/src/pages/driver-profile.tsx server/routes.ts
git commit -m "feat: driver pay rules form in profile with full deductions UI"
```

---

## Milestone 2: Universal intake + AI parser v2

**Ship criterion:** Every intake path (forwarded email, PDF upload, manual entry) writes to `rateconIntake`. The new parser returns per-field JSON with confidence scores. Nothing auto-dispatches yet.

### Task 2.1: Add `rateconIntake` schema

**Files:**
- Modify: `shared/schema.ts` (append new table near the existing `loads` definition around line 307)

- [ ] **Step 1: Add the new table after the `loads` table block**

In `shared/schema.ts`, after the closing `]);` of the `loads` table (around line 307), add:
```ts
// ============================================================================
// RATECON INTAKE - universal queue for all incoming ratecons
// ============================================================================

export const rateconIntake = pgTable("ratecon_intake", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),

  // Source tracking
  sourceType: text("source_type").notNull(), // "email" | "upload" | "manual"
  sourceEmailMessageId: text("source_email_message_id"), // Gmail message id if email
  sourceFilename: text("source_filename"),
  sourceUploadedBy: varchar("source_uploaded_by"), // user id if upload/manual

  // Raw artifact storage
  pdfPath: text("pdf_path"),             // where the original PDF is stored
  rawEmailText: text("raw_email_text"),  // for email-without-PDF cases

  // Parsed output (full JSON blob from parser, including per-field confidence)
  parsedJson: jsonb("parsed_json"),
  parsedAt: timestamp("parsed_at"),
  parserModel: text("parser_model"), // e.g. "gpt-4o-2024-08-06"
  parseError: text("parse_error"),

  // Validator output
  validatorsPassedAt: timestamp("validators_passed_at"),
  validatorFailures: jsonb("validator_failures"), // array of { field, reason }

  // Lifecycle
  status: text("status").notNull().default("pending"),
  // "pending" -> "parsed" -> ("auto_dispatched" | "in_review") -> ("approved" | "rejected") -> "dispatched"
  reviewReason: text("review_reason"), // why it went to review (summary of validator failures + low-confidence fields)
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),

  // Link to finalized load once dispatched
  loadId: varchar("load_id"),

  // Driver assignment
  matchedDriverId: varchar("matched_driver_id"),
  matchedDriverConfidence: real("matched_driver_confidence"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_ratecon_intake_status").on(table.status),
  index("idx_ratecon_intake_company").on(table.companyId),
]);

export type RateconIntake = typeof rateconIntake.$inferSelect;
export type InsertRateconIntake = typeof rateconIntake.$inferInsert;
```

- [ ] **Step 2: Push schema**

```bash
npm run check && npm run db:push
```
Expected: clean compile for this file; Drizzle creates the `ratecon_intake` table.

- [ ] **Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(schema): add rateconIntake table for universal intake queue"
```

---

### Task 2.2: Confidence-aware ratecon parser (TDD)

**Files:**
- Create: `server/ratecon-confidence-parser.ts`
- Create: `server/__tests__/ratecon-confidence-parser.test.ts`

- [ ] **Step 1: Write failing test for schema shape**

Create `server/__tests__/ratecon-confidence-parser.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseRateconFixture } from "../ratecon-confidence-parser";

describe("parseRatecon — structured output shape", () => {
  it("returns fixture result with all required fields", () => {
    // parseRateconFixture is a deterministic test-only helper that returns
    // the same shape as the live parser, without calling OpenAI.
    const result = parseRateconFixture("tql-standard");
    expect(result.broker.value).toBe("TQL Logistics");
    expect(result.broker.confidence).toBeGreaterThan(0.9);
    expect(result.loadNumber.value).toBeTypeOf("string");
    expect(result.pickup.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.pickup.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.pickup.confidence).toBeGreaterThanOrEqual(0);
    expect(result.pickup.confidence).toBeLessThanOrEqual(1);
    expect(result.rate.value).toBeTypeOf("number");
    expect(result.driverName).toBeDefined();
  });

  it("reports low confidence when pickup time is missing AM/PM", () => {
    const result = parseRateconFixture("missing-ampm");
    expect(result.pickup.confidence).toBeLessThan(0.85);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- server/__tests__/ratecon-confidence-parser.test.ts
```
Expected: Fails — module not found.

- [ ] **Step 3: Implement the parser**

Create `server/ratecon-confidence-parser.ts`:
```ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

export interface FieldWithConfidence<T> {
  value: T;
  confidence: number; // 0..1
}

export interface ParsedRateconV2 {
  broker: FieldWithConfidence<string>;
  loadNumber: FieldWithConfidence<string>;
  rate: FieldWithConfidence<number>;
  equipmentType: FieldWithConfidence<string>;
  weightLbs: FieldWithConfidence<number | null>;
  miles: FieldWithConfidence<number | null>;

  pickup: {
    city: string;
    state: string;
    address?: string;
    date: string;            // ISO YYYY-MM-DD
    time: string;            // HH:MM 24h
    confidence: number;      // overall confidence across pickup block
  };
  drop: {
    city: string;
    state: string;
    address?: string;
    date: string;
    time: string;
    confidence: number;
  };

  driverName: FieldWithConfidence<string | null>; // can be null if not on ratecon
  commodity: FieldWithConfidence<string | null>;
  specialInstructions: FieldWithConfidence<string | null>;

  rawText?: string;
  model: string;
}

const SYSTEM_PROMPT = `You are a freight logistics document expert. Parse this Rate Confirmation into strict JSON.

Return ONLY JSON matching this exact schema:
{
  "broker": { "value": "<broker name>", "confidence": 0.0-1.0 },
  "loadNumber": { "value": "<load/ref/order number>", "confidence": 0.0-1.0 },
  "rate": { "value": <number, no $ or commas>, "confidence": 0.0-1.0 },
  "equipmentType": { "value": "<dry van|reefer|flatbed|step deck|power only|other>", "confidence": 0.0-1.0 },
  "weightLbs": { "value": <number or null>, "confidence": 0.0-1.0 },
  "miles": { "value": <number or null>, "confidence": 0.0-1.0 },
  "pickup": {
    "city": "<city>",
    "state": "<2-letter state>",
    "address": "<full address if visible>",
    "date": "YYYY-MM-DD",
    "time": "HH:MM (24h)",
    "confidence": 0.0-1.0
  },
  "drop": { ...same shape as pickup },
  "driverName": { "value": "<driver name or null>", "confidence": 0.0-1.0 },
  "commodity": { "value": "<commodity or null>", "confidence": 0.0-1.0 },
  "specialInstructions": { "value": "<instructions or null>", "confidence": 0.0-1.0 }
}

Confidence rules — BE HONEST:
- 1.0 only if the field is unambiguous, clearly labeled, and you are certain.
- 0.85-0.95 if clearly visible but abbreviated or in unusual location.
- 0.6-0.84 if you had to infer or the document is ambiguous.
- <0.6 if the field is unclear, missing AM/PM, uses non-standard formatting, or required guessing.
- Set confidence to 0.5 or below if any required disambiguation was needed.
- When pickup/drop time lacks AM/PM or timezone, set that block's confidence below 0.85.
Return ONLY raw JSON. No prose, no markdown fences.`;

export async function parseRatecon(pdfBuffer: Buffer): Promise<ParsedRateconV2> {
  const base64 = pdfBuffer.toString("base64");
  const model = "gpt-4o";
  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the rate confirmation details:" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  const parsed = JSON.parse(content) as Omit<ParsedRateconV2, "model">;
  return { ...parsed, model };
}

/**
 * Deterministic fixture parser used in tests. Does NOT call OpenAI.
 */
export function parseRateconFixture(fixture: "tql-standard" | "missing-ampm"): ParsedRateconV2 {
  if (fixture === "tql-standard") {
    return {
      broker: { value: "TQL Logistics", confidence: 0.98 },
      loadNumber: { value: "A847291", confidence: 0.99 },
      rate: { value: 2850, confidence: 0.99 },
      equipmentType: { value: "dry van", confidence: 0.97 },
      weightLbs: { value: 42000, confidence: 0.95 },
      miles: { value: 780, confidence: 0.9 },
      pickup: { city: "Atlanta", state: "GA", date: "2026-05-01", time: "08:00", confidence: 0.94, address: "123 Shipper Way" },
      drop: { city: "Dallas", state: "TX", date: "2026-05-02", time: "17:00", confidence: 0.93, address: "456 Consignee Rd" },
      driverName: { value: "John Smith", confidence: 0.91 },
      commodity: { value: "General freight", confidence: 0.85 },
      specialInstructions: { value: null, confidence: 1.0 },
      model: "fixture",
    };
  }
  // missing-ampm
  return {
    broker: { value: "CH Robinson", confidence: 0.98 },
    loadNumber: { value: "B552104", confidence: 0.97 },
    rate: { value: 1950, confidence: 0.99 },
    equipmentType: { value: "reefer", confidence: 0.96 },
    weightLbs: { value: 38000, confidence: 0.9 },
    miles: { value: 500, confidence: 0.85 },
    pickup: { city: "Chicago", state: "IL", date: "2026-05-03", time: "08:00", confidence: 0.7, address: "789 Cold Storage" },
    drop: { city: "Memphis", state: "TN", date: "2026-05-04", time: "14:00", confidence: 0.75 },
    driverName: { value: null, confidence: 1.0 },
    commodity: { value: "Frozen produce", confidence: 0.9 },
    specialInstructions: { value: "Keep at 34F", confidence: 0.95 },
    model: "fixture",
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- server/__tests__/ratecon-confidence-parser.test.ts
```
Expected: Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ratecon-confidence-parser.ts server/__tests__/ratecon-confidence-parser.test.ts
git commit -m "feat: confidence-aware ratecon parser with fixture-driven tests"
```

---

### Task 2.3: Intake service (orchestrator — no validators yet)

**Files:**
- Create: `server/ratecon-intake-service.ts`

- [ ] **Step 1: Implement the service**

Create `server/ratecon-intake-service.ts`:
```ts
import { db } from "./db";
import { rateconIntake, type InsertRateconIntake } from "@shared/schema";
import { parseRatecon } from "./ratecon-confidence-parser";
import { eq } from "drizzle-orm";

export interface IntakeInput {
  sourceType: "email" | "upload" | "manual";
  companyId: string | null;
  pdfBuffer?: Buffer;
  rawEmailText?: string;
  sourceEmailMessageId?: string;
  sourceFilename?: string;
  sourceUploadedBy?: string;
}

export async function enqueueRatecon(input: IntakeInput) {
  const row: InsertRateconIntake = {
    sourceType: input.sourceType,
    companyId: input.companyId,
    sourceEmailMessageId: input.sourceEmailMessageId,
    sourceFilename: input.sourceFilename,
    sourceUploadedBy: input.sourceUploadedBy,
    rawEmailText: input.rawEmailText,
    status: "pending",
  };
  const [created] = await db.insert(rateconIntake).values(row).returning();
  return created;
}

export async function parseIntake(intakeId: string, pdfBuffer: Buffer) {
  try {
    const parsed = await parseRatecon(pdfBuffer);
    await db
      .update(rateconIntake)
      .set({
        parsedJson: parsed as unknown as Record<string, unknown>,
        parsedAt: new Date(),
        parserModel: parsed.model,
        status: "parsed",
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
    return { ok: true as const, parsed };
  } catch (err: any) {
    await db
      .update(rateconIntake)
      .set({
        parseError: err.message,
        status: "in_review",
        reviewReason: `Parser error: ${err.message}`,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
    return { ok: false as const, error: err.message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/ratecon-intake-service.ts
git commit -m "feat: ratecon intake service skeleton (enqueue + parse)"
```

---

### Task 2.4: PDF upload endpoint + manual entry endpoint

**Files:**
- Create: `server/ratecon-intake-routes.ts`
- Modify: `server/routes.ts` (register new routes)

- [ ] **Step 1: Create the routes file**

Create `server/ratecon-intake-routes.ts`:
```ts
import type { Express } from "express";
import multer from "multer";
import { enqueueRatecon, parseIntake } from "./ratecon-intake-service";
import { db } from "./db";
import { rateconIntake } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

export function registerRateconIntakeRoutes(app: Express) {
  // POST /api/ratecon-intake/upload — PDF drag-and-drop
  app.post("/api/ratecon-intake/upload", upload.single("pdf"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "PDF required" });
      const companyId = (req as any).user?.companyId ?? null;
      const userId = (req as any).user?.id ?? null;
      const intake = await enqueueRatecon({
        sourceType: "upload",
        companyId,
        pdfBuffer: req.file.buffer,
        sourceFilename: req.file.originalname,
        sourceUploadedBy: userId,
      });
      // Fire-and-forget parse (don't block the request)
      parseIntake(intake.id, req.file.buffer).catch((e) =>
        console.error("[intake-upload] parse failed:", e.message),
      );
      res.json({ intakeId: intake.id, status: "queued" });
    } catch (err: any) {
      console.error("[intake-upload]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ratecon-intake/manual — typed-in manual entry
  app.post("/api/ratecon-intake/manual", async (req, res) => {
    try {
      const companyId = (req as any).user?.companyId ?? null;
      const userId = (req as any).user?.id ?? null;
      const intake = await enqueueRatecon({
        sourceType: "manual",
        companyId,
        sourceUploadedBy: userId,
      });
      // Manual entry skips parser, puts directly into in_review with user-provided fields
      await db
        .update(rateconIntake)
        .set({
          parsedJson: req.body,
          parsedAt: new Date(),
          parserModel: "manual",
          status: "in_review",
          reviewReason: "Manual entry — review before dispatch",
          updatedAt: new Date(),
        })
        .where(eq(rateconIntake.id, intake.id));
      res.json({ intakeId: intake.id, status: "in_review" });
    } catch (err: any) {
      console.error("[intake-manual]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ratecon-intake — list recent (for dashboard)
  app.get("/api/ratecon-intake", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const qb = db.select().from(rateconIntake);
      const rows = status
        ? await qb.where(eq(rateconIntake.status, status)).orderBy(desc(rateconIntake.createdAt)).limit(50)
        : await qb.orderBy(desc(rateconIntake.createdAt)).limit(50);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ratecon-intake/:id
  app.get("/api/ratecon-intake/:id", async (req, res) => {
    const [row] = await db.select().from(rateconIntake).where(eq(rateconIntake.id, req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });
}
```

- [ ] **Step 2: Register in `server/routes.ts`**

Near the other route registrations at the bottom of `server/routes.ts` (or wherever routes are wired), add:
```ts
import { registerRateconIntakeRoutes } from "./ratecon-intake-routes";
// ...
registerRateconIntakeRoutes(app);
```

- [ ] **Step 3: Run typecheck**

```bash
npm run check
```
Expected: no new errors in the new files.

- [ ] **Step 4: Commit**

```bash
git add server/ratecon-intake-routes.ts server/routes.ts
git commit -m "feat: PDF upload + manual entry endpoints writing to rateconIntake"
```

---

### Task 2.5: Rewire email ingestion to write to intake

**Files:**
- Modify: `server/email-ingestion-service.ts`

- [ ] **Step 1: Replace the direct-to-loads insert with intake enqueue**

Read `server/email-ingestion-service.ts` in full to understand the current flow. Then locate the section where a parsed email creates a `loads` row. Replace that path so that:
1. If an attachment PDF is present → call `enqueueRatecon({ sourceType: "email", pdfBuffer, sourceEmailMessageId })` then `parseIntake()`.
2. If no PDF → enqueue with `rawEmailText` set; set status to `"in_review"` with reason `"Email without PDF attachment"`.

Add this import at the top:
```ts
import { enqueueRatecon, parseIntake } from "./ratecon-intake-service";
```

Replace the body of `processMessage` (keep the email-fetching logic at the top) with:
```ts
// After extracting attachments and text
if (attachments.length > 0) {
  const pdfAttachment = attachments.find((a) => a.mimeType === "application/pdf");
  if (pdfAttachment) {
    const intake = await enqueueRatecon({
      sourceType: "email",
      companyId,
      pdfBuffer: pdfAttachment.data,
      sourceEmailMessageId: messageId,
      sourceFilename: pdfAttachment.filename,
    });
    parseIntake(intake.id, pdfAttachment.data).catch((e) =>
      console.error("[email-ingestion] parse failed:", e.message),
    );
    return { messageId, subject, from, date, status: "processed" };
  }
}

// No PDF — enqueue as text-only for review
await enqueueRatecon({
  sourceType: "email",
  companyId,
  rawEmailText: emailBodyText,
  sourceEmailMessageId: messageId,
});
return { messageId, subject, from, date, status: "processed" };
```

Remove or comment out the old direct-`loads`-insert code path — we do not want two systems fighting.

- [ ] **Step 2: Typecheck**

```bash
npm run check
```

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Send yourself a test email with a ratecon PDF to the Gmail account the poller watches. Run:
```bash
curl -X POST http://localhost:5000/api/admin/trigger-email-poll
```
(Or whatever endpoint currently triggers the poll — inspect `routes.ts`.)
Then verify a new `ratecon_intake` row exists in Neon with `status=parsed`.

- [ ] **Step 4: Commit**

```bash
git add server/email-ingestion-service.ts
git commit -m "refactor: email ingestion writes to rateconIntake instead of loads"
```

---

### Task 2.6: Upload UI page

**Files:**
- Create: `client/src/pages/ratecon-upload.tsx`
- Modify: `client/src/App.tsx` (add route)

- [ ] **Step 1: Create the upload page**

Create `client/src/pages/ratecon-upload.tsx`:
```tsx
import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function RateconUploadPage() {
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setStatus("Uploading...");
    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch("/api/ratecon-intake/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const { intakeId } = await res.json();
      setStatus("Parsing with AI...");
      // Poll for status
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(`/api/ratecon-intake/${intakeId}`);
        const row = await r.json();
        if (row.status === "parsed" || row.status === "in_review" || row.status === "auto_dispatched") {
          setLocation(`/review-queue?highlight=${intakeId}`);
          return;
        }
      }
      setStatus("Parsing took longer than expected — check the review queue.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Rate Confirmation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted"
            onClick={() => inputRef.current?.click()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onDragOver={(e) => e.preventDefault()}
            data-testid="upload-dropzone"
          >
            {file ? (
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            ) : (
              <p className="text-muted-foreground">Drag PDF here or click to select</p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full"
            data-testid="btn-upload-ratecon"
          >
            {uploading ? "Processing..." : "Upload & Parse"}
          </Button>
          {status && <p className="text-sm">{status}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register route in `client/src/App.tsx`**

Locate the wouter `<Switch>` block. Add:
```tsx
import RateconUploadPage from "@/pages/ratecon-upload";
// ...
<Route path="/ratecon-upload" component={RateconUploadPage} />
```

- [ ] **Step 3: Run dev, manual smoke test**

```bash
npm run dev
```
Navigate to `/ratecon-upload`. Drop a test ratecon PDF. Expected: upload succeeds, page redirects to `/review-queue?highlight=...` within ~5-10s (review queue UI not built yet — URL is fine, blank page expected).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ratecon-upload.tsx client/src/App.tsx
git commit -m "feat: PDF drag-drop upload page for ratecon intake"
```

---

## Milestone 3: Validators + Review queue

**Ship criterion:** Every parsed intake runs through the validator chain. Low-confidence or failing loads land in a dispatcher review queue with inline edit + approve/reject actions. Admin gets an SMS alert. Driver name fuzzy-matches against profiles.

### Task 3.1: Validator chain (TDD)

**Files:**
- Create: `server/ratecon-validators.ts`
- Create: `server/__tests__/ratecon-validators.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/ratecon-validators.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runValidators } from "../ratecon-validators";
import { parseRateconFixture } from "../ratecon-confidence-parser";

describe("runValidators", () => {
  it("tql-standard fixture passes all validators", () => {
    const r = runValidators(parseRateconFixture("tql-standard"), { today: new Date("2026-04-24") });
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("missing-ampm fixture fails on low pickup confidence", () => {
    const r = runValidators(parseRateconFixture("missing-ampm"), { today: new Date("2026-04-24") });
    expect(r.passed).toBe(false);
    const pickup = r.failures.find((f) => f.field === "pickup");
    expect(pickup).toBeDefined();
    expect(pickup?.reason).toMatch(/confidence/i);
  });

  it("flags pickup date in the past", () => {
    const base = parseRateconFixture("tql-standard");
    base.pickup.date = "2020-01-01";
    const r = runValidators(base, { today: new Date("2026-04-24") });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.field === "pickup" && /past/i.test(f.reason))).toBe(true);
  });

  it("flags rate outside sanity range", () => {
    const base = parseRateconFixture("tql-standard");
    base.rate.value = 50;
    const r = runValidators(base, { today: new Date("2026-04-24") });
    expect(r.failures.some((f) => f.field === "rate")).toBe(true);
  });

  it("flags rate per mile outside range when miles known", () => {
    const base = parseRateconFixture("tql-standard");
    base.rate.value = 20000; // absurd
    base.miles.value = 100;
    const r = runValidators(base, { today: new Date("2026-04-24") });
    expect(r.failures.some((f) => f.field === "rate" && /per mile/i.test(f.reason))).toBe(true);
  });

  it("flags pickup >14 days out", () => {
    const base = parseRateconFixture("tql-standard");
    base.pickup.date = "2026-06-01";
    const r = runValidators(base, { today: new Date("2026-04-24") });
    expect(r.failures.some((f) => f.field === "pickup" && /too far/i.test(f.reason))).toBe(true);
  });

  it("flags missing driver name as needs-assignment (non-fatal but marks review)", () => {
    const base = parseRateconFixture("missing-ampm"); // has driverName: null
    const r = runValidators(base, { today: new Date("2026-04-24") });
    expect(r.failures.some((f) => f.field === "driverName")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npm test -- server/__tests__/ratecon-validators.test.ts
```

- [ ] **Step 3: Implement validators**

Create `server/ratecon-validators.ts`:
```ts
import type { ParsedRateconV2 } from "./ratecon-confidence-parser";

export interface ValidatorFailure {
  field: string;
  reason: string;
  severity: "error" | "warning";
}

export interface ValidatorResult {
  passed: boolean;
  failures: ValidatorFailure[];
}

interface Opts {
  today?: Date;
  rateMin?: number;
  rateMax?: number;
  ratePerMileMin?: number;
  ratePerMileMax?: number;
  confidenceMin?: number;
  pickupMaxDaysOut?: number;
}

export function runValidators(p: ParsedRateconV2, opts: Opts = {}): ValidatorResult {
  const today = opts.today ?? new Date();
  const rateMin = opts.rateMin ?? 200;
  const rateMax = opts.rateMax ?? 15000;
  const rpmMin = opts.ratePerMileMin ?? 0.5;
  const rpmMax = opts.ratePerMileMax ?? 8;
  const confMin = opts.confidenceMin ?? 0.85;
  const daysMax = opts.pickupMaxDaysOut ?? 14;

  const failures: ValidatorFailure[] = [];

  // Pickup date range
  const pickupDate = new Date(`${p.pickup.date}T00:00:00`);
  const dayMs = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor((pickupDate.getTime() - today.getTime()) / dayMs);
  if (isNaN(pickupDate.getTime())) {
    failures.push({ field: "pickup", reason: "Pickup date could not be parsed", severity: "error" });
  } else if (daysDiff < 0) {
    failures.push({ field: "pickup", reason: `Pickup date ${p.pickup.date} is in the past`, severity: "error" });
  } else if (daysDiff > daysMax) {
    failures.push({
      field: "pickup",
      reason: `Pickup date is too far out (${daysDiff} days)`,
      severity: "warning",
    });
  }

  // Confidence thresholds
  if (p.pickup.confidence < confMin) {
    failures.push({
      field: "pickup",
      reason: `Low confidence (${(p.pickup.confidence * 100).toFixed(0)}%) — possible missing AM/PM or ambiguous time`,
      severity: "warning",
    });
  }
  if (p.drop.confidence < confMin) {
    failures.push({
      field: "drop",
      reason: `Low confidence (${(p.drop.confidence * 100).toFixed(0)}%)`,
      severity: "warning",
    });
  }
  if (p.rate.confidence < confMin) {
    failures.push({ field: "rate", reason: "Rate confidence below threshold", severity: "warning" });
  }

  // Rate sanity
  if (p.rate.value < rateMin || p.rate.value > rateMax) {
    failures.push({
      field: "rate",
      reason: `Rate $${p.rate.value} outside sanity range ($${rateMin}-$${rateMax})`,
      severity: "error",
    });
  }

  // Rate per mile (if miles known)
  if (p.miles.value && p.miles.value > 0) {
    const rpm = p.rate.value / p.miles.value;
    if (rpm < rpmMin || rpm > rpmMax) {
      failures.push({
        field: "rate",
        reason: `Rate per mile $${rpm.toFixed(2)} outside range $${rpmMin}-$${rpmMax}`,
        severity: "warning",
      });
    }
  }

  // Driver name
  if (!p.driverName.value) {
    failures.push({
      field: "driverName",
      reason: "Driver name not found on ratecon — manual assignment needed",
      severity: "warning",
    });
  }

  // Broker + load number must be present
  if (!p.broker.value || p.broker.value.length < 2) {
    failures.push({ field: "broker", reason: "Broker name missing", severity: "error" });
  }
  if (!p.loadNumber.value || p.loadNumber.value.length < 1) {
    failures.push({ field: "loadNumber", reason: "Load number missing", severity: "error" });
  }

  return { passed: failures.length === 0, failures };
}

export function summarizeFailures(f: ValidatorFailure[]): string {
  if (f.length === 0) return "";
  return f.map((x) => `${x.field}: ${x.reason}`).join("; ");
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- server/__tests__/ratecon-validators.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/ratecon-validators.ts server/__tests__/ratecon-validators.test.ts
git commit -m "feat: deterministic ratecon validators with TDD coverage"
```

---

### Task 3.2: Driver name fuzzy matcher (TDD)

**Files:**
- Create: `server/driver-name-matcher.ts`
- Create: `server/__tests__/driver-name-matcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/driver-name-matcher.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { matchDriverByName } from "../driver-name-matcher";

const drivers = [
  { id: "1", name: "John Smith" },
  { id: "2", name: "Juan Rodriguez" },
  { id: "3", name: "María García" },
  { id: "4", name: "Mike O'Brien" },
];

describe("matchDriverByName", () => {
  it("exact match returns confidence 1", () => {
    const r = matchDriverByName("John Smith", drivers);
    expect(r?.driverId).toBe("1");
    expect(r?.confidence).toBe(1);
  });

  it("case-insensitive exact match", () => {
    const r = matchDriverByName("john smith", drivers);
    expect(r?.driverId).toBe("1");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("matches last name only when unique", () => {
    const r = matchDriverByName("Rodriguez", drivers);
    expect(r?.driverId).toBe("2");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("handles accent stripping", () => {
    const r = matchDriverByName("Maria Garcia", drivers);
    expect(r?.driverId).toBe("3");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("returns null for no match", () => {
    const r = matchDriverByName("Some Rando Stranger", drivers);
    expect(r).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchDriverByName("", drivers)).toBeNull();
    expect(matchDriverByName(null, drivers)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
npm test -- server/__tests__/driver-name-matcher.test.ts
```

- [ ] **Step 3: Implement matcher**

Create `server/driver-name-matcher.ts`:
```ts
export interface DriverCandidate {
  id: string;
  name: string;
}

export interface MatchResult {
  driverId: string;
  confidence: number;
  driverName: string;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function matchDriverByName(
  raw: string | null | undefined,
  drivers: DriverCandidate[],
): MatchResult | null {
  if (!raw || raw.trim().length === 0) return null;
  const needle = normalize(raw);
  const needleTokens = tokenSet(raw);

  let best: MatchResult | null = null;
  for (const d of drivers) {
    const hay = normalize(d.name);
    let conf = 0;

    if (needle === hay) {
      conf = 1;
    } else if (hay.includes(needle) || needle.includes(hay)) {
      conf = 0.95;
    } else {
      conf = jaccard(needleTokens, tokenSet(d.name));
      // Bonus if last name matches uniquely
      const needleLast = needle.split(" ").pop() ?? "";
      const hayLast = hay.split(" ").pop() ?? "";
      if (needleLast && needleLast === hayLast) conf = Math.max(conf, 0.88);
    }

    if (!best || conf > best.confidence) {
      best = { driverId: d.id, confidence: conf, driverName: d.name };
    }
  }

  if (!best || best.confidence < 0.6) return null;
  return best;
}
```

- [ ] **Step 4: Run — pass**

```bash
npm test -- server/__tests__/driver-name-matcher.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/driver-name-matcher.ts server/__tests__/driver-name-matcher.test.ts
git commit -m "feat: driver name fuzzy matcher with accent + last-name fallback"
```

---

### Task 3.3: Wire validators + matcher into intake parse flow

**Files:**
- Modify: `server/ratecon-intake-service.ts`

- [ ] **Step 1: Extend `parseIntake` to run validators and matcher**

In `server/ratecon-intake-service.ts`, add imports at the top:
```ts
import { runValidators, summarizeFailures } from "./ratecon-validators";
import { matchDriverByName } from "./driver-name-matcher";
import { drivers } from "@shared/schema";
```

Replace the `parseIntake` function body with:
```ts
export async function parseIntake(intakeId: string, pdfBuffer: Buffer) {
  try {
    const parsed = await parseRatecon(pdfBuffer);

    // Run validators
    const validation = runValidators(parsed);

    // Fuzzy-match driver name if present
    let matchedDriverId: string | null = null;
    let matchedConfidence = 0;
    if (parsed.driverName.value) {
      const allDrivers = await db.select({ id: drivers.id, name: drivers.name }).from(drivers);
      const match = matchDriverByName(parsed.driverName.value, allDrivers);
      if (match) {
        matchedDriverId = match.driverId;
        matchedConfidence = match.confidence;
      }
    }

    // Decide status
    const hasErrors = validation.failures.some((f) => f.severity === "error");
    const hasWarnings = validation.failures.some((f) => f.severity === "warning");
    const needsDriverAssignment = !matchedDriverId || matchedConfidence < 0.85;

    let status: string;
    let reviewReason: string | null = null;
    if (hasErrors) {
      status = "in_review";
      reviewReason = `Errors: ${summarizeFailures(validation.failures.filter((f) => f.severity === "error"))}`;
    } else if (hasWarnings || needsDriverAssignment) {
      status = "in_review";
      const parts: string[] = [];
      if (hasWarnings) parts.push(summarizeFailures(validation.failures));
      if (needsDriverAssignment) parts.push("Driver needs manual assignment");
      reviewReason = parts.join(" | ");
    } else {
      status = "parsed"; // ready for auto-dispatch (Milestone 4 picks this up)
    }

    await db
      .update(rateconIntake)
      .set({
        parsedJson: parsed as unknown as Record<string, unknown>,
        parsedAt: new Date(),
        parserModel: parsed.model,
        validatorFailures: validation.failures as unknown as Record<string, unknown>[],
        validatorsPassedAt: validation.passed ? new Date() : null,
        matchedDriverId,
        matchedDriverConfidence: matchedConfidence,
        status,
        reviewReason,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));

    return { ok: true as const, parsed, status, validation };
  } catch (err: any) {
    await db
      .update(rateconIntake)
      .set({
        parseError: err.message,
        status: "in_review",
        reviewReason: `Parser error: ${err.message}`,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
    return { ok: false as const, error: err.message };
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add server/ratecon-intake-service.ts
git commit -m "feat: validators + driver matcher run on every intake parse"
```

---

### Task 3.4: Review queue API endpoints

**Files:**
- Modify: `server/ratecon-intake-routes.ts`

- [ ] **Step 1: Add review queue endpoints**

Append these handlers to `server/ratecon-intake-routes.ts` inside `registerRateconIntakeRoutes`:
```ts
  // GET /api/ratecon-intake/review-queue
  app.get("/api/ratecon-intake/review-queue", async (_req, res) => {
    const rows = await db
      .select()
      .from(rateconIntake)
      .where(eq(rateconIntake.status, "in_review"))
      .orderBy(desc(rateconIntake.createdAt))
      .limit(100);
    res.json(rows);
  });

  // PATCH /api/ratecon-intake/:id — edit parsed fields (dispatcher inline edits)
  app.patch("/api/ratecon-intake/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { parsedJson, matchedDriverId } = req.body;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (parsedJson) updates.parsedJson = parsedJson;
      if (matchedDriverId !== undefined) {
        updates.matchedDriverId = matchedDriverId;
        updates.matchedDriverConfidence = 1.0; // human-assigned = certain
      }
      const [updated] = await db
        .update(rateconIntake)
        .set(updates)
        .where(eq(rateconIntake.id, id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ratecon-intake/:id/reject
  app.post("/api/ratecon-intake/:id/reject", async (req, res) => {
    const userId = (req as any).user?.id ?? null;
    const [updated] = await db
      .update(rateconIntake)
      .set({ status: "rejected", reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(rateconIntake.id, req.params.id))
      .returning();
    res.json(updated);
  });
```

(The `approve-and-dispatch` endpoint is added in Milestone 4 once dispatch wiring is in place.)

- [ ] **Step 2: Typecheck**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add server/ratecon-intake-routes.ts
git commit -m "feat: review-queue list/edit/reject endpoints"
```

---

### Task 3.5: Review queue UI page

**Files:**
- Create: `client/src/components/review-queue-row.tsx`
- Create: `client/src/pages/review-queue.tsx`
- Modify: `client/src/App.tsx` (add route)

- [ ] **Step 1: Create the row component**

Create `client/src/components/review-queue-row.tsx`:
```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface IntakeRow {
  id: string;
  createdAt: string;
  parsedJson: any;
  reviewReason: string | null;
  matchedDriverId: string | null;
  matchedDriverConfidence: number | null;
  validatorFailures: Array<{ field: string; reason: string; severity: string }>;
  pdfPath: string | null;
}

interface Props {
  row: IntakeRow;
  drivers: Array<{ id: string; name: string }>;
  onSave: (patch: Partial<IntakeRow>) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}

export function ReviewQueueRow({ row, drivers, onSave, onApprove, onReject }: Props) {
  const parsed = row.parsedJson ?? {};
  const [edited, setEdited] = useState(parsed);
  const [driverId, setDriverId] = useState(row.matchedDriverId ?? "");
  const [saving, setSaving] = useState(false);

  const warningsFor = (field: string) =>
    (row.validatorFailures ?? []).filter((f) => f.field === field);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ parsedJson: edited, matchedDriverId: driverId || null });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4" data-testid={`review-row-${row.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <Badge variant="destructive">{parsed.broker?.value ?? "Unknown"}</Badge>{" "}
            <span className="font-mono text-sm">{parsed.loadNumber?.value}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Pickup</label>
            <div className="flex gap-1">
              <Input
                value={parsed.pickup?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={parsed.pickup?.state ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, state: e.target.value } })
                }
                placeholder="ST"
                className="w-16"
              />
            </div>
            <div className="flex gap-1 mt-1">
              <Input
                type="date"
                value={parsed.pickup?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={parsed.pickup?.time ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, pickup: { ...edited.pickup, time: e.target.value } })
                }
              />
            </div>
            {warningsFor("pickup").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium">Drop</label>
            <div className="flex gap-1">
              <Input
                value={parsed.drop?.city ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, city: e.target.value } })
                }
                placeholder="City"
              />
              <Input
                value={parsed.drop?.state ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, state: e.target.value } })
                }
                placeholder="ST"
                className="w-16"
              />
            </div>
            <div className="flex gap-1 mt-1">
              <Input
                type="date"
                value={parsed.drop?.date ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, date: e.target.value } })
                }
              />
              <Input
                type="time"
                value={parsed.drop?.time ?? ""}
                onChange={(e) =>
                  setEdited({ ...edited, drop: { ...edited.drop, time: e.target.value } })
                }
              />
            </div>
            {warningsFor("drop").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium">Rate</label>
            <Input
              type="number"
              value={parsed.rate?.value ?? ""}
              onChange={(e) =>
                setEdited({ ...edited, rate: { ...edited.rate, value: Number(e.target.value) } })
              }
            />
            {warningsFor("rate").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium">Assign Driver</label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full border rounded p-2"
              data-testid={`select-driver-${row.id}`}
            >
              <option value="">— select —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {warningsFor("driverName").map((w, i) => (
              <p key={i} className="text-xs text-amber-600 mt-1">⚠ {w.reason}</p>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button variant="destructive" onClick={onReject}>
            Reject
          </Button>
          <Button onClick={onApprove} data-testid={`btn-approve-${row.id}`}>
            Approve & Dispatch
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create the page**

Create `client/src/pages/review-queue.tsx`:
```tsx
import { useEffect, useState } from "react";
import { ReviewQueueRow, type IntakeRow } from "@/components/review-queue-row";

export default function ReviewQueuePage() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);

  const load = async () => {
    const [rqRes, drvRes] = await Promise.all([
      fetch("/api/ratecon-intake/review-queue"),
      fetch("/api/drivers"),
    ]);
    setRows(await rqRes.json());
    setDrivers(await drvRes.json());
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // 30s auto-refresh
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">
        Review Queue <span className="text-muted-foreground">({rows.length})</span>
      </h1>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No loads need review. ✓</p>
      ) : (
        rows.map((r) => (
          <ReviewQueueRow
            key={r.id}
            row={r}
            drivers={drivers}
            onSave={async (patch) => {
              await fetch(`/api/ratecon-intake/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              load();
            }}
            onApprove={async () => {
              await fetch(`/api/ratecon-intake/${r.id}/approve-and-dispatch`, { method: "POST" });
              load();
            }}
            onReject={async () => {
              await fetch(`/api/ratecon-intake/${r.id}/reject`, { method: "POST" });
              load();
            }}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register route**

In `client/src/App.tsx`:
```tsx
import ReviewQueuePage from "@/pages/review-queue";
// ...
<Route path="/review-queue" component={ReviewQueuePage} />
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```
Upload a PDF via `/ratecon-upload`. Navigate to `/review-queue`. Expected: row appears, shows warnings inline, inline edit saves. (Approve button will 404 until Milestone 4.)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/review-queue-row.tsx client/src/pages/review-queue.tsx client/src/App.tsx
git commit -m "feat: review queue UI with inline edit and driver assignment"
```

---

### Task 3.6: Admin SMS alert on review queue push

**Files:**
- Create: `server/ratecon-admin-alerts.ts`
- Modify: `server/ratecon-intake-service.ts`

- [ ] **Step 1: Create alerts module**

Create `server/ratecon-admin-alerts.ts`:
```ts
import { smsService } from "./sms-service";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function notifyAdminReviewNeeded(params: {
  companyId: string | null;
  intakeId: string;
  broker: string;
  reason: string;
}) {
  try {
    // Find admin users. IMPORTANT: inspect shared/schema.ts `users` table (around line 2555)
    // first to pick the correct admin-identifying column. If your table has:
    //   - `role: text("role")` — use `eq(users.role, "admin")`
    //   - `isAdmin: boolean("is_admin")` — use `eq(users.isAdmin, true)`
    //   - neither — add an `isAdmin` boolean column first via schema + db:push.
    // Also add `.where(eq(users.companyId, params.companyId))` to the query below if users
    // are scoped to companies (multi-tenant); otherwise omit.
    const admins = await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"));
    for (const admin of admins) {
      const phone = (admin as any).phone ?? (admin as any).phoneNumber;
      if (!phone) continue;
      const body =
        `[TRAQ-IQ] Ratecon needs review\n` +
        `Broker: ${params.broker}\n` +
        `Reason: ${params.reason}\n` +
        `Open: https://traqiqs.io/review-queue`;
      await smsService.sendSMS(phone, body);
    }
  } catch (err: any) {
    console.error("[admin-alerts] send failed:", err.message);
  }
}
```

(If `smsService.sendSMS` isn't the right method, inspect `server/sms-service.ts` and use whatever the existing outbound method is. If the `users` table lacks a `role` column, inspect `shared/schema.ts:users` (around line 2555) and use the existing admin-detection mechanism — e.g. an `isAdmin` boolean.)

- [ ] **Step 2: Call from `parseIntake` when status becomes `in_review`**

In `server/ratecon-intake-service.ts`, at the end of `parseIntake` just before returning, add:
```ts
if (status === "in_review") {
  const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
  notifyAdminReviewNeeded({
    companyId: (await db.select().from(rateconIntake).where(eq(rateconIntake.id, intakeId)))[0]
      ?.companyId ?? null,
    intakeId,
    broker: parsed.broker.value,
    reason: reviewReason ?? "unknown",
  }).catch((e) => console.error("[parseIntake] alert failed:", e.message));
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add server/ratecon-admin-alerts.ts server/ratecon-intake-service.ts
git commit -m "feat: admin SMS alert when ratecon lands in review queue"
```

---

## Milestone 4: Auto-dispatch + Driver SMS

**Ship criterion:** When `status === "parsed"` and validators passed, system auto-creates a `loads` row, calculates driver pay, and sends driver SMS with tokenized confirmation link. Dispatcher approval in review queue does the same thing. Driver YES/NO responses handled.

### Task 4.1: Promote intake → load

**Files:**
- Create: `server/ratecon-dispatch-service.ts`

- [ ] **Step 1: Implement promoter**

Create `server/ratecon-dispatch-service.ts`:
```ts
import { db } from "./db";
import { rateconIntake, loads, drivers, type RateconIntake } from "@shared/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { calculatePay, type PayDriverInput, type PayLoadInput } from "./pay-calculator";

export interface DispatchOutcome {
  ok: boolean;
  loadId?: string;
  confirmationToken?: string;
  error?: string;
}

export async function dispatchFromIntake(intakeId: string): Promise<DispatchOutcome> {
  const [intake] = await db.select().from(rateconIntake).where(eq(rateconIntake.id, intakeId));
  if (!intake) return { ok: false, error: "Intake not found" };
  if (!intake.matchedDriverId) return { ok: false, error: "No driver assigned" };
  if (!intake.parsedJson) return { ok: false, error: "No parsed data" };

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, intake.matchedDriverId));
  if (!driver) return { ok: false, error: "Driver not found" };

  const parsed = intake.parsedJson as any;
  const confirmationToken = nanoid(24);

  // Create the load
  const loadNumber = parsed.loadNumber?.value ?? `RC-${Date.now()}`;
  const pickupDate = new Date(`${parsed.pickup.date}T${parsed.pickup.time}:00`);
  const deliveryDate = new Date(`${parsed.drop.date}T${parsed.drop.time}:00`);

  // Resolve or auto-create customer from broker name (loads.customerId is required)
  const { customers } = await import("@shared/schema");
  const brokerName = parsed.broker?.value ?? "Unknown Broker";
  let customerId: string;
  const [existingCustomer] = await db
    .select()
    .from(customers)
    .where(eq(customers.name, brokerName))
    .limit(1);
  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const [newCustomer] = await db
      .insert(customers)
      .values({
        companyId: intake.companyId,
        name: brokerName,
        contactPerson: "",
        email: "",
        phone: "",
        address: "",
        status: "active",
      })
      .returning();
    customerId = newCustomer.id;
  }

  const [load] = await db
    .insert(loads)
    .values({
      companyId: intake.companyId,
      loadNumber,
      customerId,
      driverId: driver.id,
      description: parsed.commodity?.value ?? "General freight",
      pickupAddress: `${parsed.pickup.address ?? ""} ${parsed.pickup.city}, ${parsed.pickup.state}`.trim(),
      pickupDate,
      pickupTime: parsed.pickup.time,
      deliveryAddress: `${parsed.drop.address ?? ""} ${parsed.drop.city}, ${parsed.drop.state}`.trim(),
      deliveryDate,
      deliveryTime: parsed.drop.time,
      specialInstructions: parsed.specialInstructions?.value ?? null,
      status: "assigned",
      equipmentType: (parsed.equipmentType?.value ?? "dry_van").replace(/\s+/g, "_").toLowerCase(),
      rate: parsed.rate?.value ?? 0,
      miles: parsed.miles?.value ?? null,
      weight: parsed.weightLbs?.value ?? null,
      brokerName: parsed.broker?.value ?? null,
      assignedDriverName: driver.name,
      sourceBoard: intake.sourceType === "email" ? "email" : "manual",
      originCity: parsed.pickup.city,
      originState: parsed.pickup.state,
      destCity: parsed.drop.city,
      destState: parsed.drop.state,
      offeredRate: parsed.rate?.value ?? 0,
    })
    .returning();

  // Update intake
  await db
    .update(rateconIntake)
    .set({
      status: "dispatched",
      loadId: load.id,
      updatedAt: new Date(),
    })
    .where(eq(rateconIntake.id, intakeId));

  return { ok: true, loadId: load.id, confirmationToken };
}

export function driverProfileToPayInput(driver: any): PayDriverInput {
  return {
    payType: (driver.payType ?? "percent") as PayDriverInput["payType"],
    payRate: driver.payRate ?? 0,
    payRateDeadhead: driver.payRateDeadhead ?? 0,
    deductFactoringEnabled: driver.deductFactoringEnabled ?? false,
    deductFactoringPct: driver.deductFactoringPct ?? 0,
    deductDispatchEnabled: driver.deductDispatchEnabled ?? false,
    deductDispatchPct: driver.deductDispatchPct ?? 0,
    deductFuelAdvanceEnabled: driver.deductFuelAdvanceEnabled ?? false,
    deductFuelAdvanceAmount: driver.deductFuelAdvanceAmount ?? 0,
    deductTrailerRentEnabled: driver.deductTrailerRentEnabled ?? false,
    deductTrailerRentWeekly: driver.deductTrailerRentWeekly ?? 0,
    deductInsuranceEnabled: driver.deductInsuranceEnabled ?? false,
    deductInsuranceWeekly: driver.deductInsuranceWeekly ?? 0,
    deductEldEnabled: driver.deductEldEnabled ?? false,
    deductEldMonthly: driver.deductEldMonthly ?? 0,
    deductOccAccEnabled: driver.deductOccAccEnabled ?? false,
    deductOccAccWeekly: driver.deductOccAccWeekly ?? 0,
  };
}

export function computeLoadPayInput(parsed: any): PayLoadInput {
  const totalMiles = parsed.miles?.value ?? 0;
  // If deadhead unknown, treat all miles as loaded
  return {
    rate: parsed.rate?.value ?? 0,
    loadedMiles: totalMiles,
    deadheadMiles: 0,
  };
}
```

- [ ] **Step 2: Add `confirmation_token` column to loads**

In `shared/schema.ts`, inside the `loads` table definition (after `rateconPath` around line 283), add:
```ts
  confirmationToken: varchar("confirmation_token", { length: 32 }).unique(),
  confirmationStatus: text("confirmation_status").default("pending"), // pending, accepted, declined
  confirmationRespondedAt: timestamp("confirmation_responded_at"),
```

Then:
```bash
npm run db:push
```

- [ ] **Step 3: Update dispatcher to persist token**

In `server/ratecon-dispatch-service.ts`, update the `loads` insert to include `confirmationToken: confirmationToken` and `confirmationStatus: "pending"`.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts server/ratecon-dispatch-service.ts
git commit -m "feat: dispatch service promotes intake to loads with confirmation token"
```

---

### Task 4.2: Driver SMS dispatch

**Files:**
- Modify: `server/ratecon-dispatch-service.ts`
- Modify: `server/ratecon-intake-routes.ts` (add approve-and-dispatch endpoint)

- [ ] **Step 1: Add SMS sender to dispatch service**

At the bottom of `server/ratecon-dispatch-service.ts` add:
```ts
import { calculatePay } from "./pay-calculator";
import { smsService } from "./sms-service";

export async function sendDispatchSms(loadId: string): Promise<{ ok: boolean; error?: string }> {
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load || !load.driverId) return { ok: false, error: "Load or driver missing" };
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
  if (!driver) return { ok: false, error: "Driver not found" };
  if (!driver.phoneNumber && !driver.phone) return { ok: false, error: "Driver has no phone" };

  const payInput = computeLoadPayInput({
    rate: { value: load.rate ?? 0 },
    miles: { value: load.miles ?? 0 },
  });
  const pay = calculatePay(payInput, driverProfileToPayInput(driver));

  const url = `https://traqiqs.io/l/${load.confirmationToken}`;
  const body =
    `TRAQ-IQ Dispatch\n` +
    `New load #${load.loadNumber}\n\n` +
    `📍 PICKUP\n${load.originCity}, ${load.originState}\n` +
    `${load.pickupDate.toLocaleDateString()} @ ${load.pickupTime}\n\n` +
    `📍 DROP\n${load.destCity}, ${load.destState}\n` +
    `${load.deliveryDate.toLocaleDateString()} @ ${load.deliveryTime}\n\n` +
    `💰 NET PAY: $${pay.netPay.toFixed(2)}\n\n` +
    `Details & confirm: ${url}\n\n` +
    `Reply YES to accept · NO to decline`;

  const phone = driver.phoneNumber ?? driver.phone!;
  await smsService.sendSMS(phone, body);
  return { ok: true };
}
```

- [ ] **Step 2: Add approve-and-dispatch endpoint**

In `server/ratecon-intake-routes.ts` inside `registerRateconIntakeRoutes`:
```ts
  app.post("/api/ratecon-intake/:id/approve-and-dispatch", async (req, res) => {
    try {
      const userId = (req as any).user?.id ?? null;
      const { dispatchFromIntake, sendDispatchSms } = await import("./ratecon-dispatch-service");
      const outcome = await dispatchFromIntake(req.params.id);
      if (!outcome.ok) return res.status(400).json({ error: outcome.error });
      await db
        .update(rateconIntake)
        .set({ reviewedBy: userId, reviewedAt: new Date() })
        .where(eq(rateconIntake.id, req.params.id));
      const smsResult = await sendDispatchSms(outcome.loadId!);
      res.json({ ...outcome, sms: smsResult });
    } catch (err: any) {
      console.error("[approve-and-dispatch]", err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Auto-dispatch on successful parse**

In `server/ratecon-intake-service.ts`, at the end of `parseIntake`, just after the `if (status === "in_review")` block, add:
```ts
if (status === "parsed") {
  const { dispatchFromIntake, sendDispatchSms } = await import("./ratecon-dispatch-service");
  const outcome = await dispatchFromIntake(intakeId);
  if (outcome.ok && outcome.loadId) {
    await sendDispatchSms(outcome.loadId);
    await db
      .update(rateconIntake)
      .set({ status: "auto_dispatched", updatedAt: new Date() })
      .where(eq(rateconIntake.id, intakeId));
  } else {
    // fallback: bump to review
    await db
      .update(rateconIntake)
      .set({
        status: "in_review",
        reviewReason: `Auto-dispatch failed: ${outcome.error}`,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/ratecon-dispatch-service.ts server/ratecon-intake-routes.ts server/ratecon-intake-service.ts
git commit -m "feat: driver SMS dispatch with pay breakdown + approve-and-dispatch endpoint"
```

---

### Task 4.3: Driver SMS response handler (YES/NO)

**Files:**
- Modify: `server/sms-communication-service.ts` (or wherever inbound SMS is handled)

- [ ] **Step 1: Inspect existing inbound SMS handler**

```bash
```

Read `server/sms-communication-service.ts` and `server/sms-service.ts` to find where Twilio webhook inbound messages are handled. Likely a route like `app.post("/api/sms/inbound", ...)` or a handler in `sms-service.ts`.

- [ ] **Step 2: Add YES/NO intent detection**

Inside the inbound-handler function, before the existing routing logic, add:
```ts
// Check if this is a dispatch confirmation response
const body = (incoming.Body ?? "").trim().toUpperCase();
const fromPhone = incoming.From;

if (body === "YES" || body === "NO" || body === "Y" || body === "N") {
  const { db } = await import("./db");
  const { loads, drivers } = await import("@shared/schema");
  const { eq, and, desc } = await import("drizzle-orm");
  // Find most recent pending confirmation for this driver
  const [drv] = await db.select().from(drivers).where(eq(drivers.phoneNumber, fromPhone));
  if (drv) {
    const [pending] = await db
      .select()
      .from(loads)
      .where(and(eq(loads.driverId, drv.id), eq(loads.confirmationStatus, "pending")))
      .orderBy(desc(loads.createdAt))
      .limit(1);
    if (pending) {
      const accepted = body === "YES" || body === "Y";
      await db
        .update(loads)
        .set({
          confirmationStatus: accepted ? "accepted" : "declined",
          confirmationRespondedAt: new Date(),
          status: accepted ? "assigned" : "cancelled",
        })
        .where(eq(loads.id, pending.id));
      // reply to driver
      const reply = accepted
        ? `Load #${pending.loadNumber} confirmed. Safe travels.`
        : `Load #${pending.loadNumber} declined. Dispatcher notified.`;
      await smsService.sendSMS(fromPhone, reply);
      // If declined, notify admin
      if (!accepted) {
        const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
        notifyAdminReviewNeeded({
          companyId: pending.companyId,
          intakeId: pending.id,
          broker: pending.brokerName ?? "Unknown",
          reason: `Driver ${drv.name} declined load ${pending.loadNumber}`,
        });
      }
      return; // handled
    }
  }
}
// ...existing handler continues
```

Adjust variable names to match the actual function — `incoming.Body` / `incoming.From` are Twilio webhook field names; your existing code may already have parsed these.

- [ ] **Step 3: Commit**

```bash
git add server/sms-communication-service.ts
git commit -m "feat: handle driver YES/NO replies to dispatch SMS"
```

---

### Task 4.4: 30-minute escalation cron

**Files:**
- Create: `server/ratecon-escalation-cron.ts`
- Modify: `server/index.ts` (register cron)

- [ ] **Step 1: Create cron**

Create `server/ratecon-escalation-cron.ts`:
```ts
import cron from "node-cron";
import { db } from "./db";
import { loads } from "@shared/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { notifyAdminReviewNeeded } from "./ratecon-admin-alerts";

const THIRTY_MIN_MS = 30 * 60 * 1000;
const EMITTED = new Set<string>(); // in-process dedupe

export function startRateconEscalationCron() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - THIRTY_MIN_MS);
      const stale = await db
        .select()
        .from(loads)
        .where(
          and(
            eq(loads.confirmationStatus, "pending"),
            lt(loads.createdAt, cutoff),
          ),
        );
      for (const l of stale) {
        if (EMITTED.has(l.id)) continue;
        EMITTED.add(l.id);
        await notifyAdminReviewNeeded({
          companyId: l.companyId,
          intakeId: l.id,
          broker: l.brokerName ?? "Unknown",
          reason: `Driver has not responded to load ${l.loadNumber} in 30+ min`,
        });
      }
    } catch (err: any) {
      console.error("[ratecon-escalation-cron]", err.message);
    }
  });
  console.log("[ratecon-escalation-cron] scheduled every 5 min");
}
```

- [ ] **Step 2: Register in `server/index.ts`**

Near where other crons are started (search for `cron.schedule` or `geofence-cron`), add:
```ts
import { startRateconEscalationCron } from "./ratecon-escalation-cron";
// ... after app setup ...
startRateconEscalationCron();
```

- [ ] **Step 3: Commit**

```bash
git add server/ratecon-escalation-cron.ts server/index.ts
git commit -m "feat: 30-min escalation cron for unacknowledged dispatches"
```

---

## Milestone 5: Driver confirmation page

**Ship criterion:** Link from driver SMS opens a mobile-first page with maps, PDF, pay breakdown, and Accept/Decline buttons. No login. Tokenized.

### Task 5.1: Tokenized public endpoints

**Files:**
- Create: `server/driver-confirmation-routes.ts`
- Modify: `server/routes.ts`

- [ ] **Step 1: Create routes**

Create `server/driver-confirmation-routes.ts`:
```ts
import type { Express } from "express";
import { db } from "./db";
import { loads, drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { calculatePay } from "./pay-calculator";
import { driverProfileToPayInput, computeLoadPayInput } from "./ratecon-dispatch-service";

export function registerDriverConfirmationRoutes(app: Express) {
  app.get("/api/confirm/:token", async (req, res) => {
    try {
      const [load] = await db
        .select()
        .from(loads)
        .where(eq(loads.confirmationToken, req.params.token));
      if (!load) return res.status(404).json({ error: "not found" });
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId!));
      if (!driver) return res.status(404).json({ error: "driver missing" });

      const payInput = computeLoadPayInput({
        rate: { value: load.rate ?? 0 },
        miles: { value: load.miles ?? 0 },
      });
      const pay = calculatePay(payInput, driverProfileToPayInput(driver));

      // Driver-facing view — hide gross linehaul
      res.json({
        loadNumber: load.loadNumber,
        broker: load.brokerName,
        pickup: {
          city: load.originCity,
          state: load.originState,
          address: load.pickupAddress,
          date: load.pickupDate,
          time: load.pickupTime,
        },
        drop: {
          city: load.destCity,
          state: load.destState,
          address: load.deliveryAddress,
          date: load.deliveryDate,
          time: load.deliveryTime,
        },
        specialInstructions: load.specialInstructions,
        equipmentType: load.equipmentType,
        weight: load.weight,
        pay: {
          lineItems: pay.lineItems,
          deductions: pay.deductions,
          netPay: pay.netPay,
          recurringDeductions: pay.recurringDeductions,
        },
        confirmationStatus: load.confirmationStatus,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/confirm/:token/accept", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          confirmationStatus: "accepted",
          confirmationRespondedAt: new Date(),
          status: "assigned",
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/confirm/:token/decline", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          confirmationStatus: "declined",
          confirmationRespondedAt: new Date(),
          status: "cancelled",
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
      await notifyAdminReviewNeeded({
        companyId: updated.companyId,
        intakeId: updated.id,
        broker: updated.brokerName ?? "Unknown",
        reason: `Driver declined load ${updated.loadNumber} via web`,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
```

- [ ] **Step 2: Register in `routes.ts`**

```ts
import { registerDriverConfirmationRoutes } from "./driver-confirmation-routes";
// ...
registerDriverConfirmationRoutes(app);
```

- [ ] **Step 3: Commit**

```bash
git add server/driver-confirmation-routes.ts server/routes.ts
git commit -m "feat: tokenized driver confirmation API endpoints"
```

---

### Task 5.2: Driver confirmation page UI

**Files:**
- Create: `client/src/pages/driver-confirm.tsx`
- Modify: `client/src/App.tsx` (add route `/l/:token`)

- [ ] **Step 1: Create page**

Create `client/src/pages/driver-confirm.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Confirmation {
  loadNumber: string;
  broker: string;
  pickup: { city: string; state: string; address: string; date: string; time: string };
  drop: { city: string; state: string; address: string; date: string; time: string };
  specialInstructions: string | null;
  equipmentType: string;
  weight: number | null;
  pay: {
    lineItems: Array<{ label: string; amount: number }>;
    deductions: Array<{ label: string; amount: number }>;
    netPay: number;
    recurringDeductions: Array<{ label: string; amount: number }>;
  };
  confirmationStatus: string;
}

export default function DriverConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Confirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/confirm/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setData)
      .catch(() => setError("Load not found or link expired"));
  }, [token]);

  const respond = async (action: "accept" | "decline") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/confirm/${token}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      // refresh to show new status
      const r = await fetch(`/api/confirm/${token}`);
      setData(await r.json());
    } catch {
      setError("Submit failed — try again");
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <div className="p-6 text-center">{error}</div>;
  if (!data) return <div className="p-6 text-center">Loading...</div>;

  const mapsUrl = (city: string, state: string, addr: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addr}, ${city}, ${state}`)}`;

  return (
    <div className="max-w-md mx-auto p-4 pb-24 space-y-3">
      <div className="text-center">
        <div className="text-sm text-muted-foreground">Load</div>
        <div className="text-2xl font-bold">#{data.loadNumber}</div>
        <div className="text-sm">{data.broker}</div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">📍 Pickup</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm">
          <p className="font-medium">{data.pickup.city}, {data.pickup.state}</p>
          <p>{data.pickup.address}</p>
          <p className="text-muted-foreground">
            {new Date(data.pickup.date).toLocaleDateString()} @ {data.pickup.time}
          </p>
          <a
            href={mapsUrl(data.pickup.city, data.pickup.state, data.pickup.address)}
            target="_blank" rel="noreferrer"
            className="text-blue-600 underline text-sm"
          >
            Open in Maps
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">📍 Drop</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm">
          <p className="font-medium">{data.drop.city}, {data.drop.state}</p>
          <p>{data.drop.address}</p>
          <p className="text-muted-foreground">
            {new Date(data.drop.date).toLocaleDateString()} @ {data.drop.time}
          </p>
          <a
            href={mapsUrl(data.drop.city, data.drop.state, data.drop.address)}
            target="_blank" rel="noreferrer"
            className="text-blue-600 underline text-sm"
          >
            Open in Maps
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">💰 Your Pay</CardTitle></CardHeader>
        <CardContent className="pt-0 text-sm space-y-1">
          {data.pay.lineItems.map((li, i) => (
            <div key={i} className="flex justify-between">
              <span>{li.label}</span>
              <span>${li.amount.toFixed(2)}</span>
            </div>
          ))}
          {data.pay.deductions.map((d, i) => (
            <div key={i} className="flex justify-between text-muted-foreground">
              <span>{d.label}</span>
              <span>${d.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="border-t my-2" />
          <div className="flex justify-between font-bold">
            <span>Net this load</span>
            <span>${data.pay.netPay.toFixed(2)}</span>
          </div>
          {data.pay.recurringDeductions.length > 0 && (
            <div className="mt-3 pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Weekly deductions (on statement):</p>
              {data.pay.recurringDeductions.map((d, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{d.label}</span>
                  <span>${d.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data.specialInstructions && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent className="pt-0 text-sm">{data.specialInstructions}</CardContent>
        </Card>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-3 flex gap-2">
        {data.confirmationStatus === "pending" ? (
          <>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => respond("decline")}
              disabled={submitting}
              data-testid="btn-decline"
            >
              Decline
            </Button>
            <Button
              className="flex-1"
              onClick={() => respond("accept")}
              disabled={submitting}
              data-testid="btn-accept"
            >
              Accept Load
            </Button>
          </>
        ) : (
          <div className="flex-1 text-center font-medium">
            {data.confirmationStatus === "accepted" ? "✓ Accepted" : "✗ Declined"}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register route in `App.tsx`**

```tsx
import DriverConfirmPage from "@/pages/driver-confirm";
// ...
<Route path="/l/:token" component={DriverConfirmPage} />
```

- [ ] **Step 3: Manual end-to-end test**

Start the dev server. Drop a test ratecon PDF into `/ratecon-upload`. Check that:
1. Intake row appears in Neon.
2. Validator ran. If it went to review, check `/review-queue`; edit + approve → driver SMS fires.
3. Open SMS link (the `/l/:token` page) — verify pay shows no gross, only driver's earnings.
4. Tap Accept — status updates to `accepted`, load status becomes `assigned`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/driver-confirm.tsx client/src/App.tsx
git commit -m "feat: mobile-first driver confirmation page with tokenized access"
```

---

## Final checks

### Task F.1: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npm test
```
Expected: all suites pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run check
```
Expected: no new errors in files created by this plan. (Pre-existing project errors are out of scope.)

- [ ] **Step 3: Build check**

```bash
npm run build
```
Expected: clean production build.

### Task F.2: Smoke test checklist

- [ ] Forward a real broker email with a ratecon PDF to the Gmail account the poller watches. Wait ≤2 min. Verify: `rateconIntake` row created → parsed → either auto-dispatched or in review queue.
- [ ] Drop a PDF at `/ratecon-upload`. Verify flow.
- [ ] On the review queue, flip a driver assignment and click Approve. Verify driver SMS sends with correct pay numbers.
- [ ] Reply YES from a driver phone. Verify load status updates.
- [ ] Reply NO from a driver phone. Verify admin SMS alert fires.
- [ ] Wait 30+ min without responding. Verify escalation cron fires.
- [ ] Change driver pay rule. Re-dispatch. Verify new pay math reflects the change.

---

## Rollback Plan

If severe issues arise in production:
1. **Feature flag:** gate auto-dispatch behind `AUTO_DISPATCH_ENABLED=false` env var. Do this by wrapping the `if (status === "parsed")` auto-dispatch block in Task 4.2 Step 3 with that check. All loads go to review queue; manual dispatch still works.
2. **Revert email rewiring:** `git revert` the commit from Task 2.5. Email ingestion falls back to the legacy direct-to-loads flow.
3. **Keep validators relaxed:** bump `confidenceMin` in `runValidators` to 0.5 to push more loads through auto-dispatch once trust is established, or to 0.95 to push more to review while tuning.

---

## Done.
