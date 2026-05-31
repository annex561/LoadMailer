/**
 * Regression test for upload-slot phasing (2026-05-31).
 *
 * THE PROBLEM:
 *   The driver upload page showed ALL FOUR slots (Pickup BOL, Tie-Down,
 *   Delivery POD, Signed BOL) at pickup time, because dispatch SMS links were
 *   bare /u/<token> with no ?stages and the route fell back to all four.
 *   Drivers got confused / uploaded the wrong doc to the wrong slot.
 *
 * THE RULE (per owner):
 *   - At pickup: show ONLY pickup_bol + pickup_securement, both required.
 *   - Delivery slots NEVER appear until the load is at/after delivery.
 *
 * stagesForLoadStatus() is the single source of truth the /u page uses when a
 * link doesn't pin an explicit phase. These tests pin that behavior.
 */

import { describe, it, expect } from "vitest";
import {
  stagesForLoadStatus,
  PICKUP_STAGES,
  DELIVERY_STAGES,
} from "../load-photos-service";

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
});
