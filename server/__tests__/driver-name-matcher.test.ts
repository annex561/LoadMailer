import { describe, it, expect } from "vitest";
import { matchDriverByName, suggestDriverByFirstName } from "../driver-name-matcher";

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

// ── suggestDriverByFirstName — review-UI pre-select hint ──────────────────────
// Regression-pinned: step 6 of fix/ratecon-intake-to-loads.
// Never auto-dispatches; confidence is always 0.7 (below the 0.85 bar).
describe("suggestDriverByFirstName", () => {
  const fleet = [
    { id: "1", name: "John Smith" },
    { id: "2", name: "Juan Rodriguez" },
    { id: "3", name: "María García" },
    { id: "4", name: "Mike O'Brien" },
  ];

  it("returns the unique first-name match with confidence 0.7", () => {
    const r = suggestDriverByFirstName("Juan Lopez", fleet);
    expect(r).not.toBeNull();
    expect(r?.driverId).toBe("2");
    expect(r?.confidence).toBe(0.7);
  });

  it("returns null when two drivers share the first name (ambiguous)", () => {
    const ambiguous = [
      { id: "1", name: "John Smith" },
      { id: "5", name: "John Davis" },
    ];
    expect(suggestDriverByFirstName("John Somebody", ambiguous)).toBeNull();
  });

  it("returns null when no driver matches the first name", () => {
    expect(suggestDriverByFirstName("Carlos Whoever", fleet)).toBeNull();
  });

  it("strips diacritics before matching", () => {
    // María → maria; raw "Maria Hernandez" should match driver 3
    const r = suggestDriverByFirstName("Maria Hernandez", fleet);
    expect(r?.driverId).toBe("3");
  });

  it("returns null for empty or null input", () => {
    expect(suggestDriverByFirstName("", fleet)).toBeNull();
    expect(suggestDriverByFirstName(null, fleet)).toBeNull();
    expect(suggestDriverByFirstName(undefined, fleet)).toBeNull();
  });

  it("returns null for a single-character first name", () => {
    expect(suggestDriverByFirstName("J Smith", fleet)).toBeNull();
  });
});
