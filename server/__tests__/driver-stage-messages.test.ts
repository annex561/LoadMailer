/**
 * Snapshot tests for buildDriverStageMessages — the single source of truth
 * for per-stage driver reply SMS text. If any of these snapshots change,
 * the text every driver sees changes too. Reviewer should look at the diff
 * carefully and confirm the new wording is intentional before approving.
 */

import { describe, it, expect } from "vitest";
import {
  buildDriverStageMessages,
  type DriverStageInputs,
} from "../ratecon-dispatch-service";

const baseInputs: DriverStageInputs = {
  loadId: "load-uuid-abc123",
  loadNumber: "LD29505831",
  deliveryAddress: "1650 GA-155 S, McDonough, GA 30253 US",
  deliveryDate: new Date("2026-05-04T08:00:00Z"),
  deliveryTime: "08:00",
  destCity: "McDonough",
  destState: "GA",
  trackingToken: "abc123trackingtoken",
  baseUrl: "https://traqiq.app",
};

describe("buildDriverStageMessages", () => {
  describe('step = "accepted"', () => {
    it("returns one message with tracker link when trackingToken is present", () => {
      const out = buildDriverStageMessages(baseInputs, "accepted");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchInlineSnapshot(`
        "Load #LD29505831 CONFIRMED
        ==================
        AT PICKUP
        Upload a clear photo of the signed BOL:
        https://traqiq.app/u/load-uuid-abc123

        Or reply PICKED UP when loaded.
        ==================
        GPS tracking is now ON.
        Keep your phone tracker open:
        https://traqiq.app/driver/abc123trackingtoken#tracking"
      `);
    });

    it("falls back to generic GPS message when no trackingToken", () => {
      const out = buildDriverStageMessages(
        { ...baseInputs, trackingToken: null },
        "accepted",
      );
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchInlineSnapshot(`
        "Load #LD29505831 CONFIRMED
        ==================
        AT PICKUP
        Upload a clear photo of the signed BOL:
        https://traqiq.app/u/load-uuid-abc123

        Or reply PICKED UP when loaded.
        ==================
        GPS tracking is now ON. Drive safe."
      `);
    });
  });

  describe('step = "picked-up"', () => {
    it("returns two messages: transition confirmation + dropoff w/ upload URL", () => {
      const out = buildDriverStageMessages(baseInputs, "picked-up");
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchInlineSnapshot(`
        "Load #LD29505831 PICKED UP
        ==================
        Drive safe.
        GPS tracking continues — no action needed."
      `);
      expect(out[1]).toMatchInlineSnapshot(`
        "DELIVER TO:
        1650 GA-155 S, McDonough, GA 30253 US
        Mon 5/4  8:00 AM
        ==================
        AT DELIVERY
        Upload the signed BOL:
        https://traqiq.app/u/load-uuid-abc123

        Or text the BOL photo to this number.
        Reply DELIVERED when offloaded."
      `);
    });

    it("falls back to city/state when deliveryAddress is empty", () => {
      const out = buildDriverStageMessages(
        { ...baseInputs, deliveryAddress: null },
        "picked-up",
      );
      expect(out[1]).toContain("DELIVER TO:\nMcDonough, GA");
    });

    it("omits time when deliveryTime is missing", () => {
      const out = buildDriverStageMessages(
        { ...baseInputs, deliveryTime: null },
        "picked-up",
      );
      expect(out[1]).toContain("Mon 5/4");
      expect(out[1]).not.toContain("AM");
      expect(out[1]).not.toContain("PM");
    });

    it("formats 24h time → 12h with AM/PM", () => {
      const afternoon = buildDriverStageMessages(
        { ...baseInputs, deliveryTime: "14:30" },
        "picked-up",
      );
      expect(afternoon[1]).toContain("2:30 PM");

      const midnight = buildDriverStageMessages(
        { ...baseInputs, deliveryTime: "00:15" },
        "picked-up",
      );
      expect(midnight[1]).toContain("12:15 AM");
    });
  });

  // Regression guards for the MMS-reply mode (gated upstream by
  // MMS_UPLOAD_ENABLED). When the flag is on, the driver replies to the SMS
  // with the BOL photo instead of clicking the /u/<token> link. The link
  // is omitted entirely — the inbound MMS webhook routes the photo via the
  // pending_uploads row the caller wrote before sending.
  //
  // The web upload page has hung in production through PRs #83-#97. This
  // mode is the load-bearing path. These tests pin the wording so the link
  // can't accidentally come back when the flag is on.
  describe("mmsReplyMode = true", () => {
    it("accepted: defers the photo prompt to geofence-arrival, does NOT tell the driver to reply now", () => {
      const out = buildDriverStageMessages(
        { ...baseInputs, mmsReplyMode: true },
        "accepted",
      );
      expect(out).toHaveLength(1);
      // Link must NOT appear — the web upload page is the wrong-load risk too.
      expect(out[0]).not.toContain("https://traqiq.app/u/");
      expect(out[0]).not.toContain("Upload a clear photo");
      // Phase 1 regression guard: the SMS at acceptance must NOT instruct
      // the driver to reply with a photo immediately. No pending_uploads
      // row exists yet — a photo sent now would bind to the wrong load if
      // the driver is on >1 load. The geofence-arrival SMS (sent later
      // when the driver is physically at the shipper) is the one that
      // carries the actual reply prompt.
      expect(out[0]).not.toContain("Reply to this text with a photo");
      expect(out[0]).toContain(
        "We'll text you when you arrive at the pickup so you can send the signed BOL.",
      );
      // PICKED UP shortcut still works as a manual override.
      expect(out[0]).toContain("Or reply PICKED UP when loaded.");
    });

    it("picked-up: defers the delivery photo prompt to geofence-arrival, does NOT prompt immediately", () => {
      const out = buildDriverStageMessages(
        { ...baseInputs, mmsReplyMode: true },
        "picked-up",
      );
      expect(out).toHaveLength(2);
      expect(out[1]).not.toContain("https://traqiq.app/u/");
      expect(out[1]).not.toContain("Upload the signed BOL");
      expect(out[1]).not.toContain("Or text the BOL photo to this number.");
      expect(out[1]).not.toContain("Reply to this text with a photo");
      expect(out[1]).toContain(
        "We'll text you when you arrive at the delivery so you can send the signed BOL.",
      );
      expect(out[1]).toContain("Reply DELIVERED when offloaded.");
    });

    it("delivered: unchanged (no upload prompt in this step)", () => {
      const off = buildDriverStageMessages(baseInputs, "delivered");
      const on = buildDriverStageMessages(
        { ...baseInputs, mmsReplyMode: true },
        "delivered",
      );
      expect(on).toEqual(off);
    });

    it("flag OFF (default): legacy link path is preserved", () => {
      // Defense in depth: if mmsReplyMode is missing or false, the SMS still
      // carries the /u/<token> link so already-deployed environments without
      // the env var keep working.
      const out = buildDriverStageMessages(baseInputs, "accepted");
      expect(out[0]).toContain("https://traqiq.app/u/load-uuid-abc123");
      expect(out[0]).toContain("Upload a clear photo of the signed BOL:");
      expect(out[0]).not.toContain(
        "Reply to this text with a photo of the signed BOL",
      );
    });
  });

  describe('step = "delivered"', () => {
    it("returns a Good-to-Go acknowledgement with no pay numbers", () => {
      const out = buildDriverStageMessages(baseInputs, "delivered");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchInlineSnapshot(`
        "Load #LD29505831 DELIVERED
        ==================
        Good to go. Paperwork is being processed and your factoring submission is queued.

        Full pay breakdown is on your dashboard.

        Thank you — drive safe."
      `);
    });

    it("intentionally does NOT inline dollar amounts even when payLines is passed", () => {
      // Pay numbers shift on weekly settlement (recurring deductions, fuel
      // advances). Locking a number in an SMS at delivery time can be
      // misleading by Friday. Pay breakdown lives on the dashboard only.
      const out = buildDriverStageMessages(
        {
          ...baseInputs,
          payLines: [
            "Pay summary for this load:",
            "  Gross: $1,000.00",
            "  -----",
            "  Net this load: $970.00",
          ],
        },
        "delivered",
      );
      expect(out[0]).not.toMatch(/\$\d/);
      expect(out[0]).not.toContain("Gross");
      expect(out[0]).not.toContain("Net this load");
    });
  });
});
