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
