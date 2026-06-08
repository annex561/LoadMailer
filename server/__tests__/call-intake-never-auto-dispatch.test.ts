import { describe, it, expect } from "vitest";
import { buildCallIntakeRow, shouldAutoSurfaceLoadOffer } from "../call-intake-service";

describe("call intake never auto-dispatches (regression)", () => {
  it("forces status 'in_review' even for a 0.99-confidence load offer", () => {
    const row = buildCallIntakeRow({
      companyId: "c1", callRecordId: "cr1",
      classification: { category: "load_offer", isLoadOffer: true, confidence: 0.99 },
    });
    expect(row.status).toBe("in_review");
    expect(row.sourceType).toBe("call");
    expect(row.sourceCallId).toBe("cr1");
  });

  it("never yields an auto_dispatched status at any confidence", () => {
    for (const confidence of [0, 0.5, 0.7, 0.95, 1]) {
      const row = buildCallIntakeRow({
        companyId: "c1", callRecordId: "cr1",
        classification: { category: "load_offer", isLoadOffer: true, confidence },
      });
      expect(row.status).toBe("in_review");
      expect(row.status).not.toBe("auto_dispatched");
    }
  });
});

describe("shouldAutoSurfaceLoadOffer", () => {
  it("surfaces only load offers at/above the 0.7 threshold", () => {
    expect(shouldAutoSurfaceLoadOffer({ category: "load_offer", isLoadOffer: true, confidence: 0.7 })).toBe(true);
    expect(shouldAutoSurfaceLoadOffer({ category: "load_offer", isLoadOffer: true, confidence: 0.69 })).toBe(false);
    expect(shouldAutoSurfaceLoadOffer({ category: "driver", isLoadOffer: false, confidence: 0.99 })).toBe(false);
    expect(shouldAutoSurfaceLoadOffer(null)).toBe(false);
  });
});
