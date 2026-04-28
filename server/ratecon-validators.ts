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

  // Pickup date range — compare by calendar DATE only (no time/timezone math).
  // Previous bug: comparing millisecond timestamps would say "tomorrow" was
  // "in the past" because the server's UTC clock was already a few hours
  // into the next calendar day relative to the pickup date string.
  const pickupDate = new Date(`${p.pickup.date}T00:00:00`);
  if (isNaN(pickupDate.getTime())) {
    failures.push({ field: "pickup", reason: "Pickup date could not be parsed", severity: "error" });
  } else {
    // Use UTC midnight of each date for a stable day-level diff.
    const pickupUtcMidnight = Date.UTC(
      pickupDate.getFullYear(),
      pickupDate.getMonth(),
      pickupDate.getDate(),
    );
    const todayUtcMidnight = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const daysDiff = Math.round((pickupUtcMidnight - todayUtcMidnight) / (24 * 60 * 60 * 1000));
    if (daysDiff < 0) {
      failures.push({
        field: "pickup",
        reason: `Pickup date ${p.pickup.date} is in the past`,
        severity: "error",
      });
    } else if (daysDiff > daysMax) {
      failures.push({
        field: "pickup",
        reason: `Pickup date is too far out (${daysDiff} days)`,
        severity: "warning",
      });
    }
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
