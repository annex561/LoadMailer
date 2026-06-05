/**
 * Regression guard for the new-driver example load.
 *
 * A brand-new driver signs up and taps their SMS dashboard link, but has no
 * loads yet — without the example card they hit an empty dashboard and don't
 * understand what the app does. The example card teaches the UI and must:
 *   1. Show ONLY when the driver has zero active loads (count === 0).
 *   2. Vanish the moment they have a real load (count > 0) — never compete
 *      with or mask a real dispatch.
 *   3. Carry the id 'example', which the renderLoadDetail short-circuit
 *      (loadId === 'example') depends on to serve the demo page without a DB
 *      lookup. If the id drifts, real load detail breaks or the demo 404s.
 *
 * This test fails on the pre-change code (the symbols did not exist) and on any
 * future change that loosens the count gate or renames the example id.
 */
import { describe, it, expect } from "vitest";
import { EXAMPLE_LOAD, shouldShowExampleLoad } from "../driver-portal-example";

describe("shouldShowExampleLoad", () => {
  it("shows the example only for a brand-new driver with zero active loads", () => {
    expect(shouldShowExampleLoad(0)).toBe(true);
  });

  it("hides the example as soon as the driver has a real active load", () => {
    expect(shouldShowExampleLoad(1)).toBe(false);
    expect(shouldShowExampleLoad(3)).toBe(false);
  });
});

describe("EXAMPLE_LOAD contract", () => {
  it("uses the id 'example' that renderLoadDetail short-circuits on", () => {
    expect(EXAMPLE_LOAD.id).toBe("example");
  });

  it("is clearly labelled as an example so a driver never mistakes it for a real load", () => {
    expect(EXAMPLE_LOAD.loadNumber).toMatch(/EXAMPLE/i);
  });

  it("carries realistic display data (origin, dest, miles, rate)", () => {
    expect(EXAMPLE_LOAD.originCity).toBeTruthy();
    expect(EXAMPLE_LOAD.destCity).toBeTruthy();
    expect(EXAMPLE_LOAD.miles).toBeGreaterThan(0);
    expect(EXAMPLE_LOAD.rate).toBeGreaterThan(0);
  });
});
