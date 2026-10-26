/**
 * Regression tests for upload-slot phasing.
 *
 * Original bug (2026-05-31): dispatch SMS links had no ?stages and the route
 * fell back to showing all four slots at once. Drivers uploaded wrong docs.
 *
 * New requirement (2026-10-26, Annex live-test feedback on TQL 38896802):
 *   - The SERVER must reject any stages= list that mixes pickup + delivery docs.
 *   - Pickup link → exactly pickup_bol + pickup_securement. Nothing else.
 *   - Delivery link → exactly delivery_signed_bol + delivery_pod. Nothing else.
 *   - After confirm, driver gets a phase-specific success message.
 *   - Driver confirmation SMS is behind DRIVER_UPLOAD_CONFIRM_SMS_ENABLED (default OFF).
 *   - Check-in at_pickup / loaded / at_delivery auto-sends the phase-correct
 *     link when DRIVER_UPLOAD_LINK_SMS_ENABLED=true.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  stagesForLoadStatus,
  stagesForPhase,
  isMixedPhaseStages,
  PICKUP_STAGES,
  DELIVERY_STAGES,
} from "../load-photos-service";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const clientSrc = readFileSync(resolve(__dirname, "../upload-page.client.js"), "utf8");

// ─── Pure function: stagesForLoadStatus ────────────────────────────────────

describe("stagesForLoadStatus — phase-correct upload slots", () => {
  it("shows ONLY pickup slots before delivery", () => {
    for (const status of [
      null,
      undefined,
      "assigned",
      "booked",
      "in_transit",
      "picked_up",
      "at_pickup",
      "loaded",
    ]) {
      const stages = stagesForLoadStatus(status as any);
      expect(stages).toEqual(PICKUP_STAGES);
      // Delivery docs must NOT be present pre-delivery
      expect(stages).not.toContain("delivery_pod");
      expect(stages).not.toContain("delivery_signed_bol");
    }
  });

  it("shows ONLY delivery slots once at/after delivery", () => {
    for (const status of ["at_delivery", "unloaded", "delivered", "completed"]) {
      const stages = stagesForLoadStatus(status);
      expect(stages).toEqual(DELIVERY_STAGES);
      expect(stages).not.toContain("pickup_bol");
      expect(stages).not.toContain("pickup_securement");
    }
  });

  it("never returns all four stages at once (the bug)", () => {
    for (const status of ["assigned", "in_transit", "at_delivery", "delivered"]) {
      expect(stagesForLoadStatus(status).length).toBe(2);
    }
  });

  it("pickup phase is BOL + tie-down, both required", () => {
    expect(stagesForLoadStatus("assigned")).toEqual([
      "pickup_bol",
      "pickup_securement",
    ]);
  });

  it("stagesForPhase maps phase → the two required docs for that phase", () => {
    expect(stagesForPhase("pickup")).toEqual(PICKUP_STAGES);
    expect(stagesForPhase("delivery")).toEqual(DELIVERY_STAGES);
  });
});

// ─── Pure function: isMixedPhaseStages ────────────────────────────────────

describe("isMixedPhaseStages — server-side mixed-phase guard", () => {
  it("returns false for all-pickup stages", () => {
    expect(isMixedPhaseStages(["pickup_bol", "pickup_securement"])).toBe(false);
    expect(isMixedPhaseStages(["pickup_bol"])).toBe(false);
    expect(isMixedPhaseStages(["pickup_securement"])).toBe(false);
  });

  it("returns false for all-delivery stages", () => {
    expect(isMixedPhaseStages(["delivery_pod", "delivery_signed_bol"])).toBe(false);
    expect(isMixedPhaseStages(["delivery_pod"])).toBe(false);
    expect(isMixedPhaseStages(["delivery_signed_bol"])).toBe(false);
  });

  it("returns true for the mixed-phase bug that triggered Annex's feedback", () => {
    // This is the exact list the test link showed (all 4 at pickup time).
    expect(
      isMixedPhaseStages([
        "pickup_bol",
        "pickup_securement",
        "delivery_pod",
        "delivery_signed_bol",
      ]),
    ).toBe(true);
  });

  it("returns true for any cross-phase combination", () => {
    expect(isMixedPhaseStages(["pickup_bol", "delivery_pod"])).toBe(true);
    expect(isMixedPhaseStages(["pickup_securement", "delivery_signed_bol"])).toBe(true);
  });

  it("returns false for an empty list (nothing to mix)", () => {
    expect(isMixedPhaseStages([])).toBe(false);
  });
});

// ─── Server route: /u/:param rejects mixed stages ─────────────────────────

describe("/u/:param route rejects mixed-phase stages", () => {
  it("calls isMixedPhaseStages on the stages list parsed from ?stages=", () => {
    // The route must import and call isMixedPhaseStages when stages.length > 0.
    expect(routesSrc).toContain("isMixedPhaseStages");
    // The rejection path must return a 400.
    expect(routesSrc).toMatch(/isMixedPhaseStages.*\n.*400/s);
  });

  it("pickup link has exactly PICKUP_STAGES — no delivery docs in the route import", () => {
    // The route imports PICKUP_STAGES and DELIVERY_STAGES — both must be present
    // as named exports (already tested in stagesForPhase above). Guard that the
    // route does NOT pass PICKUP_STAGES + DELIVERY_STAGES merged into one array.
    const mergedPattern = /PICKUP_STAGES.*DELIVERY_STAGES|DELIVERY_STAGES.*PICKUP_STAGES/;
    // The route may reference them separately (e.g. for the photos/request
    // handler). It must NEVER spread both into a single stages array for the
    // link. Confirm the /u handler doesn't combine them.
    expect(routesSrc).not.toMatch(/\[\s*\.\.\.PICKUP_STAGES\s*,\s*\.\.\.DELIVERY_STAGES\s*\]/);
    expect(routesSrc).not.toMatch(/\[\s*\.\.\.DELIVERY_STAGES\s*,\s*\.\.\.PICKUP_STAGES\s*\]/);
  });
});

// ─── Server route: photos/request rejects mixed stages ────────────────────

describe("photos/request rejects a mixed-phase stages array", () => {
  it("calls isMixedPhaseStages when req.body.stages is provided", () => {
    // The handler must guard the raw stages array path with isMixedPhaseStages.
    expect(routesSrc).toMatch(/isMixedPhaseStages.*req\.body\.stages/s);
  });

  it("returns 400 when stages are mixed", () => {
    // The rejection must produce a 400 with a useful error.
    expect(routesSrc).toContain("stages must all be pickup or all be delivery, not mixed");
  });
});

// ─── Confirm endpoint: driver confirmation SMS ────────────────────────────

describe("photos/confirm — driver confirmation SMS", () => {
  it("calls sendDriverConfirmSms after a successful confirm", () => {
    expect(routesSrc).toContain("sendDriverConfirmSms");
    // Must be in the confirm handler (after the sopProgress update), not just imported.
    expect(routesSrc).toMatch(/sendDriverConfirmSms\s*\(\s*req\.params\.id/);
  });

  it("DRIVER_UPLOAD_CONFIRM_SMS_ENABLED guard is in load-photos-service", () => {
    const svcSrc = readFileSync(
      resolve(__dirname, "../load-photos-service.ts"),
      "utf8",
    );
    expect(svcSrc).toContain("DRIVER_UPLOAD_CONFIRM_SMS_ENABLED");
    // Default must be OFF — only 'true' enables it.
    expect(svcSrc).toContain("!== 'true'");
  });

  it("flag OFF → early return before any sendSMS call (source pin)", () => {
    const svcSrc = readFileSync(
      resolve(__dirname, "../load-photos-service.ts"),
      "utf8",
    );
    // The guard must return early when flag is not 'true' — before any DB or SMS call.
    expect(svcSrc).toMatch(/DRIVER_UPLOAD_CONFIRM_SMS_ENABLED.*!==.*'true'.*\n.*return/s);
  });

  it("flag ON → smsLoadService.sendSMS called with phase label in message (source pin)", () => {
    const svcSrc = readFileSync(
      resolve(__dirname, "../load-photos-service.ts"),
      "utf8",
    );
    // The sendDriverConfirmSms function must call smsLoadService.sendSMS.
    expect(svcSrc).toContain("smsLoadService.sendSMS");
    // The message must reference the phase label (phaseLabel) and "all set".
    expect(svcSrc).toContain("all set for");
    expect(svcSrc).toContain("phaseLabel");
    // It must only fire when the flag is 'true'.
    expect(svcSrc).toMatch(/DRIVER_UPLOAD_CONFIRM_SMS_ENABLED.*!==.*'true'/s);
  });
});

// ─── Timing: checkin auto-sends phase-correct link ────────────────────────

describe("checkin timing — auto-sends the correct phase link", () => {
  it("DRIVER_UPLOAD_LINK_SMS_ENABLED guard is in the checkin handler", () => {
    expect(routesSrc).toContain("DRIVER_UPLOAD_LINK_SMS_ENABLED");
  });

  it("at_pickup or loaded → triggers sendUploadLink with PICKUP_STAGES only", () => {
    // The checkin handler must check for the pickup stages on at_pickup / loaded.
    expect(routesSrc).toMatch(/isPickupStage.*at_pickup.*loaded|at_pickup.*isPickupStage/s);
    // Must call sendUploadLink with PICKUP_STAGES, NOT DELIVERY_STAGES.
    expect(routesSrc).toMatch(/sendUploadLink.*PICKUP_STAGES/s);
  });

  it("at_delivery → triggers sendUploadLink with DELIVERY_STAGES only", () => {
    expect(routesSrc).toMatch(/isDeliveryStage.*at_delivery|at_delivery.*isDeliveryStage/s);
    expect(routesSrc).toMatch(/sendUploadLink.*DELIVERY_STAGES/s);
  });

  it("never sends both pickup and delivery links in one checkin call", () => {
    // The logic must be an if/else if — never both branches firing.
    // Confirm the route does NOT have a pattern that calls sendUploadLink
    // with PICKUP_STAGES and DELIVERY_STAGES in the same call.
    expect(routesSrc).not.toMatch(
      /sendUploadLink\s*\(\s*req\.params\.id\s*,\s*\[\s*\.\.\.PICKUP_STAGES.*DELIVERY_STAGES/s,
    );
  });

  it("dedupes by pickupPhotoRequestedAt / deliveryPhotoRequestedAt", () => {
    expect(routesSrc).toContain("pickupPhotoRequestedAt");
    expect(routesSrc).toContain("deliveryPhotoRequestedAt");
  });
});

// ─── Client JS: success message + auto-redirect ───────────────────────────

describe("upload client JS — success message and auto-redirect", () => {
  it("shows a phase-specific 'all set' message after confirm", () => {
    expect(clientSrc).toContain("you're all set for pickup");
    expect(clientSrc).toContain("you're all set for delivery");
  });

  it("auto-redirects after ~3 seconds via setTimeout", () => {
    expect(clientSrc).toContain("setTimeout");
    // Must be roughly 3s (2500-3500ms range is fine).
    expect(clientSrc).toMatch(/setTimeout.*3000|3000.*setTimeout/s);
  });

  it("tries history.back() before window.close() before /'", () => {
    expect(clientSrc).toContain("history.back");
    expect(clientSrc).toContain("window.close");
  });
});
