/**
 * Regression test: duplicate load guard on approve-and-dispatch.
 *
 * When the same (loadNumber, companyId) already exists in `loads`,
 * dispatchFromIntake must return ok:false with existingLoadId (not silently
 * overwrite the load). The link-to-load path must set status=dispatched
 * and NOT call sendSMS.
 *
 * Source-text pins — the same approach used by ratecon-dispatch-customer-company-fk.test.ts.
 * Cheap enough for CI; catches the exact class of regression where the dup-check
 * or the existingLoadId field gets dropped.
 *
 * See docs/FIX-LEDGER.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(__dirname, "..", "ratecon-dispatch-service.ts"),
  "utf8",
);

const ROUTES = readFileSync(
  join(__dirname, "..", "ratecon-intake-routes.ts"),
  "utf8",
);

describe("dispatchFromIntake — duplicate load guard (source-text pins)", () => {
  it("DispatchOutcome declares existingLoadId", () => {
    expect(SRC).toMatch(/existingLoadId\?:\s*string/);
  });

  it("duplicate check queries loads by loadNumber and companyId IS NOT DISTINCT FROM", () => {
    expect(SRC).toMatch(/IS NOT DISTINCT FROM/);
    expect(SRC).toMatch(/dupCheck/);
  });

  it("returns existingLoadId in the ok:false path", () => {
    // The guard must surface the existing load's id so the caller can link instead of re-create.
    expect(SRC).toMatch(/existingLoadId:\s*dupCheck\.id/);
  });

  it("does NOT overwrite an existing load — dupCheck guard fires before loadValues", () => {
    // Verify the guard pattern: dupCheck guard returns before const loadValues is built.
    // The old code had an if/else upsert; the new code refuses on dup.
    const dupCheckIdx = SRC.indexOf("const [dupCheck]");
    const loadValuesIdx = SRC.indexOf("const loadValues");
    // dupCheck declaration must appear before loadValues (dup guard runs first)
    expect(dupCheckIdx).toBeGreaterThan(0);
    expect(loadValuesIdx).toBeGreaterThan(dupCheckIdx);
    // The guard must return the existingLoadId before building the load
    const betweenDupAndLoad = SRC.slice(dupCheckIdx, loadValuesIdx);
    expect(betweenDupAndLoad).toMatch(/existingLoadId:\s*dupCheck\.id/);
  });
});

describe("link-to-load route (source-text pins)", () => {
  it("link-to-load route exists and sets status to 'dispatched'", () => {
    expect(ROUTES).toMatch(/\/api\/ratecon-intake\/:id\/link-to-load/);
    expect(ROUTES).toMatch(/status:\s*["']dispatched["']/);
  });

  it("link-to-load handler does NOT call sendSMS or sendDispatchSms", () => {
    // The handler must have a NO SMS comment and no SMS calls
    expect(ROUTES).toMatch(/NO SMS/i);
    // Isolate the link-to-load handler specifically
    const handlerStart = ROUTES.indexOf(`app.post("/api/ratecon-intake/:id/link-to-load"`);
    const handlerEnd = ROUTES.indexOf(`app.post("/api/ratecon-intake/reject-stale"`);
    const block = ROUTES.slice(handlerStart, handlerEnd);
    expect(block).not.toMatch(/sendSMS|sendDispatchSms/);
    expect(block).toMatch(/NO SMS/i);
  });

  it("approve-and-dispatch returns 409 with existingLoadId and action link-to-load on dup", () => {
    const approveStart = ROUTES.indexOf(`app.post("/api/ratecon-intake/:id/approve-and-dispatch"`);
    const block = ROUTES.slice(approveStart);
    expect(block).toMatch(/existingLoadId/);
    expect(block).toMatch(/409/);
    expect(block).toMatch(/link-to-load/);
  });
});
