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
