/**
 * Regression tests for the recruitment lead pipeline — Stage 1.
 *
 * What this guards:
 *
 * 1. Phone normalization. A landing-page form will accept "(404) 555-1234",
 *    "+1 404-555-1234", "4045551234", and "14045551234". They must ALL normalize
 *    to "+14045551234" so the upsert-by-phone dedup actually catches duplicates.
 *    A regression where one shape got through unnormalized would create duplicate
 *    leads for the same human and double-send any future Stage 2 automated SMS.
 *
 * 2. SMS consent. The TCR (A2P 10DLC) audit requires timestamped consent + IP
 *    on every record we'll text. Stage 1 doesn't text automatically, but Stage 2
 *    will, and Stage 2 will trust these fields without re-prompting. If any future
 *    refactor drops smsConsentAt / smsConsentSource / smsConsentIp from the insert
 *    builder, this test fails BEFORE that PR can ship.
 *
 * 3. The smsConsent flag is REQUIRED. Setting it to false (or omitting it) must
 *    throw — never silently insert a lead without consent.
 *
 * 4. Stage 1 produces NO automated outbound. This test asserts the routes module
 *    does not import Twilio or any SMS-sending service. If somebody wires SMS
 *    into Stage 1 without the kill-switch, watermark, dedup, and rate-ceiling
 *    pattern required by the financial-blast-radius project rule, this test
 *    catches it before merge.
 *
 * Predicate under test: buildLeadInsertFromForm (pure, no DB).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLeadInsertFromForm,
  normalizePhoneE164,
} from "../recruitment-routes";

describe("normalizePhoneE164", () => {
  it("converts a 10-digit US number to E.164", () => {
    expect(normalizePhoneE164("4045551234")).toBe("+14045551234");
  });
  it("normalizes a formatted US number to E.164", () => {
    expect(normalizePhoneE164("(404) 555-1234")).toBe("+14045551234");
  });
  it("normalizes a US number with country code prefix", () => {
    expect(normalizePhoneE164("14045551234")).toBe("+14045551234");
  });
  it("normalizes an already-E.164 number", () => {
    expect(normalizePhoneE164("+1 404-555-1234")).toBe("+14045551234");
  });
  it("returns null on too-short input", () => {
    expect(normalizePhoneE164("404555")).toBeNull();
  });
  it("returns null on empty/null input", () => {
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
  });
  it("ALL 4 common shapes of a US number map to the SAME E.164 — duplicate dedup must hold", () => {
    const shapes = [
      "4045551234",
      "(404) 555-1234",
      "404-555-1234",
      "+1 (404) 555-1234",
    ];
    const normalized = shapes.map(normalizePhoneE164);
    const unique = new Set(normalized);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe("+14045551234");
  });
});

describe("buildLeadInsertFromForm — consent + payload integrity", () => {
  const baseForm = {
    firstName: "Tony",
    lastName: "Hauler",
    phone: "(404) 555-1234",
    email: "tony@example.com",
    currentCarrier: "Schneider",
    kind: "owner_operator" as const,
    source: "landing_page" as const,
    smsConsent: true as const,
  };
  const ctx = {
    companyId: "co_123",
    ip: "10.0.0.1",
    userAgent: "Mozilla/5.0",
    now: new Date("2026-05-23T15:30:00Z"),
  };

  it("normalizes phone, captures consent timestamp + source + IP", () => {
    const row = buildLeadInsertFromForm(baseForm, ctx);
    expect(row.phone).toBe("+14045551234");
    expect(row.smsConsentAt).toEqual(ctx.now);
    expect(row.smsConsentSource).toBe("landing_page_form");
    expect(row.smsConsentIp).toBe("10.0.0.1");
    expect(row.smsConsentUserAgent).toBe("Mozilla/5.0");
  });

  it("stages new leads at 'new' regardless of form contents", () => {
    const row = buildLeadInsertFromForm(baseForm, ctx);
    expect(row.stage).toBe("new");
  });

  it("scrubs whitespace from name fields", () => {
    const row = buildLeadInsertFromForm(
      { ...baseForm, firstName: "  Tony  ", lastName: "  Hauler  " },
      ctx
    );
    expect(row.firstName).toBe("Tony");
    expect(row.lastName).toBe("Hauler");
  });

  it("treats empty optional fields as null, not empty string", () => {
    const row = buildLeadInsertFromForm(
      { ...baseForm, lastName: "", email: "", currentCarrier: "" },
      ctx
    );
    expect(row.lastName).toBeNull();
    expect(row.email).toBeNull();
    expect(row.currentCarrier).toBeNull();
  });

  it("THROWS when phone is unrecoverable — never insert a lead we can't reach", () => {
    expect(() =>
      buildLeadInsertFromForm({ ...baseForm, phone: "abc" }, ctx)
    ).toThrow("invalid_phone");
  });

  it("THROWS when smsConsent is false — never insert without explicit consent", () => {
    expect(() =>
      // Cast required because the form schema literal type is `true`,
      // but the runtime guard must still hold if somebody bypasses the schema.
      buildLeadInsertFromForm({ ...baseForm, smsConsent: false as unknown as true }, ctx)
    ).toThrow("sms_consent_required");
  });

  it("captures the raw form payload for audit", () => {
    const row = buildLeadInsertFromForm(baseForm, ctx);
    expect(row.rawFormPayload).toMatchObject({
      firstName: "Tony",
      phone: "(404) 555-1234", // raw, pre-normalization
      smsConsent: true,
    });
  });
});

describe("recruitment-routes module — Stage 1 ships ZERO automated outbound", () => {
  it("does not import Twilio or any SMS-sending service", () => {
    // Hard read of the source file. If Stage 2 wires in SMS, it MUST come via
    // a separate, approval-gated PR that adds the kill-switch / watermark /
    // dedup / rate-ceiling pattern from the financial-blast-radius project rule.
    const src = readFileSync(
      join(__dirname, "..", "recruitment-routes.ts"),
      "utf-8"
    );
    expect(src).not.toMatch(/from\s+["']twilio["']/);
    expect(src).not.toMatch(/from\s+["']\.\/telnyx-service["']/);
    expect(src).not.toMatch(/from\s+["']\.\/sms-service["']/);
    expect(src).not.toMatch(/twilioClient\./);
    expect(src).not.toMatch(/\.messages\.create\(/);
  });
});
