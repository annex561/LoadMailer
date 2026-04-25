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
