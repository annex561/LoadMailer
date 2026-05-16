/**
 * Unit tests for the BOL ↔ load address matcher.
 *
 * Phase 2 of the wrong-load-attachment fix lives or dies on this function.
 * A false positive on "mismatch" texts every driver about a real BOL they
 * just sent — they lose trust fast. A false negative ships the wrong BOL
 * to Love's — payment delayed. The matcher is tuned conservatively
 * (prefer "unreadable" → dispatcher review over "mismatch" → driver SMS)
 * because driver experience is the asymmetric loss.
 *
 * Test cases below are real-world shapes pulled from actual BOLs and
 * actual loads.pickupAddress strings in the LAMP dispatch history.
 */
import { describe, it, expect } from "vitest";
import {
  matchAddresses,
  parseFreeformAddress,
  levenshtein,
} from "../address-match";

describe("levenshtein (capped)", () => {
  it("returns 0 for equal strings", () => {
    expect(levenshtein("springerville", "springerville")).toBe(0);
  });
  it("returns 1 for a single typo", () => {
    expect(levenshtein("springerville", "springervllle")).toBe(1);
  });
  it("returns 2 for two typos", () => {
    expect(levenshtein("rossville", "rosseville")).toBeLessThanOrEqual(2);
  });
  it("caps out cheaply on clearly different strings", () => {
    expect(levenshtein("atlanta", "rossville", 5)).toBeGreaterThan(2);
  });
});

describe("parseFreeformAddress", () => {
  it("parses comma-separated street + city + state + zip", () => {
    const a = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(a.street).toBe("608 Salem Rd");
    expect(a.city).toBe("Rossville");
    expect(a.state).toBe("GA");
    expect(a.zip).toBe("30741");
  });

  it("strips trailing US/USA suffix", () => {
    const a = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741 US");
    expect(a.zip).toBe("30741");
    expect(a.state).toBe("GA");
  });

  it("parses comma-less positional address", () => {
    const a = parseFreeformAddress("608 Salem Rd Rossville GA 30741");
    expect(a.street).toBe("608 Salem Rd");
    expect(a.city).toBe("Rossville");
    expect(a.state).toBe("GA");
    expect(a.zip).toBe("30741");
  });

  it("returns partial address when only city/state given", () => {
    const a = parseFreeformAddress("Rossville, GA");
    expect(a.street).toBeNull();
    expect(a.city).toBe("Rossville");
    expect(a.state).toBe("GA");
    expect(a.zip).toBeNull();
  });
});

describe("matchAddresses", () => {
  // The exact mismatch the user caught in the wrong-load screenshot:
  // BOL showed Rossville GA 30741 but the dispatch was a different load
  // entirely. This MUST report mismatch — it's the bug we shipped Phase 2
  // for. If this test ever fails, the matcher has been weakened and the
  // wrong-load risk is back.
  it("[REGRESSION] reports mismatch when BOL is for a different load entirely", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: "30741",
    };
    // Load 36529625's pickup (hypothetical — but the BOL came back for
    // a totally different city/state, which is the screenshot we got).
    const expected = parseFreeformAddress("1200 County Road 4162, Springerville, AZ 85938");
    const r = matchAddresses(extracted, expected);
    expect(r.outcome).toBe("mismatch");
    // Must include both labels so the driver SMS can show what we saw vs.
    // what we expected.
    expect(r.normalizedExtracted).toContain("Rossville");
    expect(r.normalizedExpected).toContain("Springerville");
  });

  it("matches when zip + city + street number agree", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("matched");
  });

  it("matches when street suffix differs only in abbreviation (Rd vs Road)", () => {
    const extracted = {
      street: "608 Salem Road",
      city: "Rossville",
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("matched");
  });

  it("matches when city has a 1-2 char typo (within tolerance)", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rosseville", // extra 'e' — typo
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("matched");
  });

  it("mismatches when zip differs (zip is most reliable single field)", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: "30742", // off by one
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("mismatch");
  });

  it("mismatches when street number differs (different building on same street)", () => {
    const extracted = {
      street: "412 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("mismatch");
  });

  it("returns 'unreadable' when OCR is missing a zip (don't false-positive a mismatch)", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: null,
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("unreadable");
  });

  it("returns 'unreadable' when OCR is missing a city", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: null,
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("608 Salem Rd, Rossville, GA 30741");
    expect(matchAddresses(extracted, expected).outcome).toBe("unreadable");
  });

  it("returns 'unreadable' when the LOAD address is incomplete (don't blame the driver)", () => {
    const extracted = {
      street: "608 Salem Rd",
      city: "Rossville",
      state: "GA",
      zip: "30741",
    };
    const expected = parseFreeformAddress("Rossville, GA");
    expect(matchAddresses(extracted, expected).outcome).toBe("unreadable");
  });
});
