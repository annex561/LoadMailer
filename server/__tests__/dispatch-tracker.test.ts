/**
 * S14 — Dispatch tracker regression guards.
 *
 * Source-text pin tests (no DB / no Twilio / no network) covering all six
 * required behavioural contracts:
 *
 *   1. No broker data in driver-facing output (14a-1)
 *   2. No Love's send before delivery + POD (14a-2)
 *   3. signedBolRequired=true + missing BOL blocks submit, sets needs_review,
 *      alerts Annex (14a-3)
 *   4. signedBolRequired defaults to TRUE (14b schema)
 *   5. Staff override sets FALSE and writes an audit log entry
 *   6. FALSE path skips ONLY the BOL gate; POD/delivery gate (14a-2) still
 *      applies and blocks when POD missing
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------
const factoringLovesSrc = readFileSync(join(__dirname, "../factoring-loves.ts"), "utf8");
const schemaSrc = readFileSync(resolve(__dirname, "../../shared/schema.ts"), "utf8");
const ensureSchemaSrc = readFileSync(join(__dirname, "../ensure-schema.ts"), "utf8");
const driverLoadTextsSrc = readFileSync(join(__dirname, "../driver-load-texts.ts"), "utf8");
const dispatchRoutesSrc = readFileSync(join(__dirname, "../routes/dispatch-tracker-routes.ts"), "utf8");

/**
 * Grab the body of buildFactoringPacket so assertions are scoped to that
 * function and don't fire on other occurrences of the same field names.
 */
function getBuildPacketBody(): string {
  const marker = "export async function buildFactoringPacket";
  const start = factoringLovesSrc.indexOf(marker);
  expect(start, "buildFactoringPacket must exist in factoring-loves.ts").toBeGreaterThan(-1);
  // Grab 8 000 chars — function is < 600 lines
  return factoringLovesSrc.slice(start, start + 8_000);
}

// ---------------------------------------------------------------------------
// 1. 14a-1 — no broker data in driver-facing SMS output
// ---------------------------------------------------------------------------
describe("14a-1: broker data never in driver-facing SMS output", () => {
  it("Text 1 and Text 2 templates do not interpolate brokerName", () => {
    // Templates in driver-load-texts.ts use ${...} interpolation.
    // Broker name / phone must not appear in any template literal the driver receives.
    expect(driverLoadTextsSrc).not.toMatch(/\$\{[^}]*brokerName/i);
  });

  it("Text 1 and Text 2 templates do not interpolate brokerPhone", () => {
    expect(driverLoadTextsSrc).not.toMatch(/\$\{[^}]*brokerPhone/i);
  });

  it("Text 1 and Text 2 templates do not interpolate brokerEmail", () => {
    expect(driverLoadTextsSrc).not.toMatch(/\$\{[^}]*brokerEmail/i);
  });
});

// ---------------------------------------------------------------------------
// 2. 14a-2 — Love's blocked before delivery + POD
// ---------------------------------------------------------------------------
describe("14a-2: buildFactoringPacket blocks before delivery + POD", () => {
  it("checks deliveredAt before building the packet", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/deliveredAt/);
  });

  it("checks podPath before building the packet", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/podPath/);
  });

  it("gate carries the 14a-2 label (greppable for incident triage)", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/14a-2/);
  });

  it("gate error message references delivery", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/Factoring blocked \(14a-2\)/);
  });

  it("14a-2 gate appears BEFORE generateBillOfSale (delivery checked before packet built)", () => {
    const body = getBuildPacketBody();
    const gateOffset = body.indexOf("14a-2");
    const bosOffset = body.indexOf("generateBillOfSale");
    expect(gateOffset).toBeGreaterThan(-1);
    expect(bosOffset).toBeGreaterThan(-1);
    expect(gateOffset).toBeLessThan(bosOffset);
  });

  it("gate returns ok:false (does not continue to submission)", () => {
    const body = getBuildPacketBody();
    // The return statement inside the 14a-2 block
    const gateStart = body.indexOf("14a-2");
    const snippet = body.slice(gateStart, gateStart + 300);
    expect(snippet).toMatch(/ok:\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 3. 14a-3 — signed BOL gate (fail-closed)
// ---------------------------------------------------------------------------
describe("14a-3: signed BOL gate blocks, sets needs_review, alerts Annex", () => {
  it("checks bolPath when signedBolRequired is true", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/bolPath/);
  });

  it("checks bolVerifiedAt when signedBolRequired is true", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/bolVerifiedAt/);
  });

  it("gate carries the 14a-3 label", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/14a-3/);
  });

  it("sets factoringStatus to manual_review (fail-closed)", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/manual_review/);
  });

  it("reads OWNER_ALERT_PHONE to send the Annex alert", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/OWNER_ALERT_PHONE/);
  });

  it("returns ok:false with 14a-3 message", () => {
    const body = getBuildPacketBody();
    expect(body).toMatch(/Factoring blocked \(14a-3\)/);
  });

  it("14a-2 gate precedes 14a-3 gate (delivery checked before BOL checked)", () => {
    const body = getBuildPacketBody();
    const gate2Offset = body.indexOf("14a-2");
    const gate3Offset = body.indexOf("14a-3");
    expect(gate2Offset).toBeGreaterThan(-1);
    expect(gate3Offset).toBeGreaterThan(-1);
    expect(gate2Offset).toBeLessThan(gate3Offset);
  });
});

// ---------------------------------------------------------------------------
// 4. 14b — signedBolRequired defaults to TRUE in schema
// ---------------------------------------------------------------------------
describe("14b: signedBolRequired field default", () => {
  it("schema.ts declares signed_bol_required with .default(true)", () => {
    expect(schemaSrc).toMatch(/signed_bol_required.*\.default\(true\)/);
  });

  it("ensure-schema.ts registers signed_bol_required as BOOLEAN DEFAULT true", () => {
    expect(ensureSchemaSrc).toMatch(/'signed_bol_required',\s*'BOOLEAN DEFAULT true'/);
  });

  it("gate condition uses !== false so only explicit FALSE skips it (14b)", () => {
    const body = getBuildPacketBody();
    // signedBolRequired !== false means null/undefined/true all trigger the gate
    expect(body).toMatch(/signedBolRequired\s*!==\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 5. Staff BOL override: sets FALSE and writes audit log
// ---------------------------------------------------------------------------
describe("staff BOL override: writes audit log entry", () => {
  it("POST /api/loads/:id/bol-required-override endpoint exists", () => {
    expect(dispatchRoutesSrc).toMatch(/bol-required-override/);
  });

  it("endpoint inserts into bolOverrideAudit table", () => {
    expect(dispatchRoutesSrc).toMatch(/bolOverrideAudit/);
    expect(dispatchRoutesSrc).toMatch(/db\.insert/);
  });

  it("endpoint requires isAuthenticated (staff-only)", () => {
    expect(dispatchRoutesSrc).toMatch(/isAuthenticated/);
  });

  it("endpoint rejects requests without a reason string", () => {
    expect(dispatchRoutesSrc).toMatch(/reason is required/);
  });

  it("endpoint rejects non-boolean newValue", () => {
    expect(dispatchRoutesSrc).toMatch(/newValue must be boolean/);
  });
});

// ---------------------------------------------------------------------------
// 6. FALSE path: delivery gate still applies (FALSE skips ONLY the BOL gate)
// ---------------------------------------------------------------------------
describe("14b FALSE path: delivery gate still blocks when POD missing", () => {
  it("14a-2 delivery gate is outside the signedBolRequired branch (always runs)", () => {
    const body = getBuildPacketBody();
    // 14a-2 must appear BEFORE the `if (load.signedBolRequired !== false)` block,
    // so it fires regardless of the BOL requirement flag.
    const gate2Offset = body.indexOf("14a-2");
    const bolBranchOffset = body.indexOf("signedBolRequired !== false");
    expect(gate2Offset).toBeGreaterThan(-1);
    expect(bolBranchOffset).toBeGreaterThan(-1);
    // Delivery check precedes the signedBolRequired branch
    expect(gate2Offset).toBeLessThan(bolBranchOffset);
  });

  it("board endpoint is staff-only (isAuthenticated guards /api/dispatch/board)", () => {
    expect(dispatchRoutesSrc).toMatch(/\/api\/dispatch\/board/);
    expect(dispatchRoutesSrc).toMatch(/isAuthenticated/);
  });
});

// ---------------------------------------------------------------------------
// Schema completeness — S14 columns in both schema.ts and ensure-schema.ts
// ---------------------------------------------------------------------------
describe("S14 schema completeness", () => {
  const s14EnsureCols = [
    "lane2_broker_verified",
    "lane2_broker_verified_at",
    "lane2_broker_verified_by",
    "lane3_appointment_status",
    "lane5_ar_updated",
    "relay_tasks",
    "dispatch_notes",
  ];

  for (const col of s14EnsureCols) {
    it(`ensure-schema.ts registers ${col} in loadsColumns`, () => {
      expect(ensureSchemaSrc).toContain(`'${col}'`);
    });
  }

  it("bol_override_audit table is created in ensure-schema.ts", () => {
    expect(ensureSchemaSrc).toMatch(/CREATE TABLE IF NOT EXISTS bol_override_audit/);
  });

  it("bolOverrideAudit is exported from shared/schema.ts", () => {
    expect(schemaSrc).toMatch(/export const bolOverrideAudit/);
  });
});
