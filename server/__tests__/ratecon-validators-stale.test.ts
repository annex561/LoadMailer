/**
 * Regression test: when a pickup date was valid at email arrival but is now
 * in the past (re-validated later), the failure must be a warning, not an error.
 *
 * Scenario from the packet:
 *   - Email arrived 2026-10-22 (intakeCreatedAt)
 *   - Pickup date: 2026-10-23 (valid — still in the future at arrival)
 *   - Re-validated on 2026-10-26 (now in the past)
 *   → severity must be "warning", not "error"
 *
 * See docs/FIX-LEDGER.md.
 */
import { describe, it, expect } from "vitest";
import { runValidators } from "../ratecon-validators";
import { parseRateconFixture } from "../ratecon-confidence-parser";

function makeBase() {
  const b = parseRateconFixture("tql-standard");
  // Override to the specific scenario dates
  b.pickup.date = "2026-10-23";
  b.pickup.confidence = 0.95;
  return b;
}

describe("runValidators — stale pickup demotion (intakeCreatedAt)", () => {
  it("past pickup is error when no intakeCreatedAt provided", () => {
    const b = makeBase();
    const r = runValidators(b, { today: new Date("2026-10-26") });
    const f = r.failures.find((f) => f.field === "pickup" && /past/i.test(f.reason));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("error");
  });

  it("past pickup is warning when pickup was valid at email arrival (10/22 created, 10/23 pickup, 10/26 now)", () => {
    const b = makeBase();
    const r = runValidators(b, {
      today: new Date("2026-10-26"),
      intakeCreatedAt: new Date("2026-10-22"),
    });
    const f = r.failures.find((f) => f.field === "pickup");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warning");
    expect(f?.reason).toMatch(/stale/i);
  });

  it("is still error when pickup was already in the past at email arrival", () => {
    // Email arrived 10/24, pickup was 10/20 — already stale at arrival
    const b = makeBase();
    b.pickup.date = "2026-10-20";
    const r = runValidators(b, {
      today: new Date("2026-10-26"),
      intakeCreatedAt: new Date("2026-10-24"),
    });
    const f = r.failures.find((f) => f.field === "pickup" && /past/i.test(f.reason));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("error");
  });

  it("no pickup failure when pickup is in the future", () => {
    const b = parseRateconFixture("tql-standard");
    b.pickup.date = "2026-10-28";
    b.pickup.confidence = 0.95;
    const r = runValidators(b, {
      today: new Date("2026-10-26"),
      intakeCreatedAt: new Date("2026-10-24"),
    });
    expect(r.failures.find((f) => f.field === "pickup" && /past|stale/i.test(f.reason))).toBeUndefined();
  });
});
