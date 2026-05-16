/**
 * Regression guards for the auto-matcher → loads-table persistence fix.
 *
 * Bug the user caught while live-testing Phase 2: auto-matcher dispatched
 * a Google Sheets load via SMS but never persisted the load to the DB.
 * Driver replied YES → handleDispatchKeyword queried `loads` for
 * confirmationStatus='pending' → empty → silent dead loop, no CONFIRMED
 * follow-up SMS, no upload prompt, Phase 2 OCR never gets a chance to
 * fire because the YES → CONFIRMED transition never completes.
 *
 * These tests are SOURCE-TEXT PINS — the persist logic in
 * auto-load-matcher.ts is intertwined with the in-memory hotLoads Map
 * and a behavior test would need to mock Drizzle + the SMS service +
 * the customers FK lookup. Pin the load-bearing strings instead: cheap
 * CI tripwire that catches a refactor silently dropping the DB write or
 * silently sending an SMS when the DB write failed.
 *
 * If the persist function moves or its signature changes, update the
 * pinned strings — do NOT delete a guard without a replacement covered
 * by a new behavior test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Auto-matcher load persistence (regression pins)", () => {
  it("auto-load-matcher.ts persists a loads row BEFORE sending the SMS", () => {
    const src = read("auto-load-matcher.ts");
    // The call site must exist.
    expect(src).toContain("persistLoadForAutoMatch");
    // Persist must come BEFORE sendBookingRequest in the source, so a
    // refactor that flips the order is caught. Indexes from the file.
    const persistIdx = src.indexOf("await persistLoadForAutoMatch");
    const sendIdx = src.indexOf("sendBookingRequest");
    expect(persistIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(0);
    expect(persistIdx).toBeLessThan(sendIdx);
  });

  it("auto-load-matcher.ts REFUSES to send the SMS when persist fails", () => {
    const src = read("auto-load-matcher.ts");
    // Pinned refusal message + early return shape. Without this guard, a
    // failed DB write would still send the SMS — driver YES → dead loop.
    expect(src).toContain(
      "Refusing to dispatch",
    );
    expect(src).toContain("Driver will NOT receive an SMS");
    // The else-branch is the only path that calls sendBookingRequest.
    // Pin the structural pattern: persisted.ok gates the SMS send.
    expect(src).toMatch(/if \(!persisted\.ok\)/);
  });

  it("persistLoadForAutoMatch sets confirmationStatus='pending' (the field handleDispatchKeyword keys on)", () => {
    const src = read("auto-load-matcher.ts");
    // CRITICAL field — without this, the YES handler can't find the
    // load. Pin literally so a future refactor renaming or removing
    // the field is caught immediately.
    expect(src).toContain('confirmationStatus: "pending"');
    // sms-communication-service.ts must still key on this exact value.
    const smsSrc = read("sms-communication-service.ts");
    expect(smsSrc).toContain('eq(loads.confirmationStatus, "pending")');
  });

  it("persistLoadForAutoMatch is idempotent — reuses an existing row by loadNumber", () => {
    const src = read("auto-load-matcher.ts");
    // Without this, re-running the matcher on the same load would throw
    // on the unique constraint and skip the SMS — driver gets dispatched
    // once but a retry fails silently.
    expect(src).toContain("eq(loadsTable.loadNumber, p.loadId)");
    expect(src).toMatch(/if \(existing\)/);
  });

  it("persistLoadForAutoMatch ensures a customers row exists (loads.customer_id is NOT NULL)", () => {
    const src = read("auto-load-matcher.ts");
    expect(src).toContain("ensureAutoMatchCustomer");
    expect(src).toContain("Google Sheets Auto-Match");
  });
});
