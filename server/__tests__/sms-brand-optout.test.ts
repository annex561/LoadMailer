import { describe, it, expect } from "vitest";
import { withBrandAndOptOut } from "../sms-service";

/**
 * withBrandAndOptOut shapes outbound SMS bodies for A2P 10DLC compliance:
 *   - prefix with "TRAQ-IQ:" so the brand is identifiable
 *   - append "Reply STOP to opt out, HELP for help." when missing
 *   - idempotent: calling twice does not double up either piece
 *
 * These properties are what carriers and TCR auditors check, so regressions here
 * directly cause delivery to be filtered.
 */
describe("withBrandAndOptOut", () => {
  it("adds brand prefix when absent", () => {
    const out = withBrandAndOptOut("New load Atlanta to Dallas $2,450");
    expect(out.startsWith("TRAQ-IQ:")).toBe(true);
  });

  it("adds STOP suffix when absent", () => {
    const out = withBrandAndOptOut("Hello driver");
    expect(out).toMatch(/reply\s+stop/i);
  });

  it("does not duplicate the brand prefix when already present", () => {
    const out = withBrandAndOptOut("TRAQ-IQ: New load offer");
    const matches = out.match(/TRAQ-IQ:/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("accepts 'TRAQ IQ' (space variant) without re-prefixing", () => {
    const out = withBrandAndOptOut("TRAQ IQ: hello");
    expect(out.match(/TRAQ[- ]?IQ/g)?.length).toBe(1);
  });

  it("does not duplicate the STOP suffix when already present", () => {
    const out = withBrandAndOptOut("New load. Reply STOP to opt out");
    const matches = out.toLowerCase().match(/reply\s+stop/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("is idempotent — calling twice gives the same string", () => {
    const once = withBrandAndOptOut("Pickup at 0800 in Atlanta");
    const twice = withBrandAndOptOut(once);
    expect(twice).toBe(once);
  });

  it("respects includeStopSuffix=false (transactional templates that already have a STOP elsewhere)", () => {
    const out = withBrandAndOptOut("OTP: 123456", { includeStopSuffix: false });
    expect(out.startsWith("TRAQ-IQ:")).toBe(true);
    expect(out).not.toMatch(/reply\s+stop/i);
  });

  it("trims leading/trailing whitespace from the input before formatting", () => {
    const out = withBrandAndOptOut("  hello  ");
    // Brand prefix should be followed by a single space then the trimmed body.
    expect(out.startsWith("TRAQ-IQ: hello")).toBe(true);
  });
});
