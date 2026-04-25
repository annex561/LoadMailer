import { describe, it, expect } from "vitest";
import { matchDriverByName } from "../driver-name-matcher";

const drivers = [
  { id: "1", name: "John Smith" },
  { id: "2", name: "Juan Rodriguez" },
  { id: "3", name: "María García" },
  { id: "4", name: "Mike O'Brien" },
];

describe("matchDriverByName", () => {
  it("exact match returns confidence 1", () => {
    const r = matchDriverByName("John Smith", drivers);
    expect(r?.driverId).toBe("1");
    expect(r?.confidence).toBe(1);
  });

  it("case-insensitive exact match", () => {
    const r = matchDriverByName("john smith", drivers);
    expect(r?.driverId).toBe("1");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("matches last name only when unique", () => {
    const r = matchDriverByName("Rodriguez", drivers);
    expect(r?.driverId).toBe("2");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("handles accent stripping", () => {
    const r = matchDriverByName("Maria Garcia", drivers);
    expect(r?.driverId).toBe("3");
    expect(r?.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("returns null for no match", () => {
    const r = matchDriverByName("Some Rando Stranger", drivers);
    expect(r).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchDriverByName("", drivers)).toBeNull();
    expect(matchDriverByName(null, drivers)).toBeNull();
  });
});
