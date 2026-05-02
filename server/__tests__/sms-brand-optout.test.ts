import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withBrandAndOptOut } from "../sms-service";

/**
 * withBrandAndOptOut shapes outbound SMS bodies for A2P 10DLC compliance:
 *   - prefix with the brand name registered to the TCR campaign
 *     (default "LAMP Dispatch" — overridable via SMS_BRAND_PREFIX env var)
 *   - append "Reply STOP to opt out, HELP for help." when missing
 *   - idempotent: calling twice does not double up either piece
 *   - strips legacy "TRAQ-IQ" prefix from older code paths to avoid
 *     brand mismatch with carrier filters (Twilio error 30007)
 *
 * These properties are what carriers and TCR auditors check, so regressions
 * here directly cause delivery to be filtered.
 */
describe("withBrandAndOptOut", () => {
  // Default brand prefix is "LAMP Dispatch" — that's what the TCR campaign on
  // this Twilio account is registered with. Tests pin the env so they don't
  // depend on whatever the running shell has set.
  beforeEach(() => {
    delete process.env.SMS_BRAND_PREFIX;
  });
  afterEach(() => {
    delete process.env.SMS_BRAND_PREFIX;
  });

  it("adds the registered brand prefix when absent (default LAMP Dispatch)", () => {
    const out = withBrandAndOptOut("New load Atlanta to Dallas");
    expect(out.startsWith("LAMP Dispatch:")).toBe(true);
  });

  it("adds STOP suffix when absent", () => {
    const out = withBrandAndOptOut("Hello driver");
    expect(out).toMatch(/reply\s+stop/i);
  });

  it("does not duplicate the brand prefix when already present", () => {
    const out = withBrandAndOptOut("LAMP Dispatch: New load offer");
    const matches = out.match(/LAMP Dispatch:/g) ?? [];
    expect(matches.length).toBe(1);
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

  it("respects includeStopSuffix=false (transactional templates with STOP elsewhere)", () => {
    const out = withBrandAndOptOut("OTP: 123456", { includeStopSuffix: false });
    expect(out.startsWith("LAMP Dispatch:")).toBe(true);
    expect(out).not.toMatch(/reply\s+stop/i);
  });

  it("trims leading/trailing whitespace from the input before formatting", () => {
    const out = withBrandAndOptOut("  hello  ");
    expect(out.startsWith("LAMP Dispatch: hello")).toBe(true);
  });

  it("strips legacy TRAQ-IQ prefix to avoid double-branding (TRAQ-IQ Dispatch)", () => {
    // Older code paths emitted `TRAQ-IQ Dispatch\n...`. The helper should
    // remove it and substitute the registered brand so carrier filters
    // see consistent branding across all sends.
    const out = withBrandAndOptOut("TRAQ-IQ Dispatch\nLoad #123 from broker");
    expect(out).not.toMatch(/TRAQ-IQ/);
    expect(out.startsWith("LAMP Dispatch:")).toBe(true);
  });

  it("strips legacy TRAQ-IQ: colon prefix from older send paths", () => {
    const out = withBrandAndOptOut("TRAQ-IQ: Pickup tomorrow at 8am");
    expect(out).not.toMatch(/TRAQ-IQ/);
    expect(out.startsWith("LAMP Dispatch:")).toBe(true);
  });

  it("honors SMS_BRAND_PREFIX env override", () => {
    process.env.SMS_BRAND_PREFIX = "Acme Trucking";
    const out = withBrandAndOptOut("New load offer");
    expect(out.startsWith("Acme Trucking:")).toBe(true);
  });
});
