/**
 * Regression: dispatchFromIntake must persist intake.pdfPath onto the
 * load it creates as loads.rateconPath.
 *
 * Why this exists: before this guard, the RateCon PDF lived only on
 * rateconIntake.pdfPath. Factoring code looked at loads.rateconPath and
 * had to fall back to a secondary lookup — and when that fallback was
 * incomplete the load showed up in the factoring queue with no RateCon
 * attached, breaking the packet build.
 *
 * Source-text pin in the style of critical-path-chain.test.ts: cheap
 * enough to keep in CI forever, catches the exact class of bug where a
 * future refactor moves the field around or quietly drops it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(__dirname, "..", "ratecon-dispatch-service.ts"),
  "utf8",
);

describe("ratecon-dispatch-service: rateconPath wiring", () => {
  it("dispatchFromIntake → loadValues includes rateconPath: intake.pdfPath", () => {
    expect(src).toMatch(/rateconPath:\s*intake\.pdfPath/);
  });

  it("loadValues block is the one that gets inserted/updated to loads", () => {
    // Sanity: ensure the pinned field lives inside the actual loadValues
    // object, not some unrelated helper. Catches accidental relocation.
    const block = src.split("const loadValues = {")[1]?.split("};")[0] ?? "";
    expect(block).toMatch(/rateconPath/);
  });
});
