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
  sanitizeQualificationPatch,
} from "../recruitment-routes";
import { buildHotLeadEmail, buildHotLeadSlackPayload } from "../recruitment-notify";

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

describe("recruitment-routes module — Stage 1 ships ZERO automated outbound SMS", () => {
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

// ============================================================================
// STAGE 1.5 — Hot-lead notification + qualification quiz
// ============================================================================

describe("sanitizeQualificationPatch — public welcome page write-allowlist", () => {
  it("drops fields not in the allowlist (security gate)", () => {
    const result = sanitizeQualificationPatch({
      // Allowed:
      hasCdlA: true,
      yearsExperience: 7,
      mcNumber: "MC-123456",
      // BLOCKED (must be dropped — security-critical):
      stage: "lease_signed",
      signedDriverId: "driver_abc",
      smsConsentAt: new Date(),
      smsOptedOutAt: new Date(),
      ownerUserId: "user_evil",
      lostReason: "evil-overwrite-attempt",
      hotLeadAcknowledgedAt: new Date(),
    });
    expect(result.typed).toHaveProperty("hasCdlA", true);
    expect(result.typed).toHaveProperty("yearsExperience", 7);
    expect(result.typed).toHaveProperty("mcNumber", "MC-123456");
    expect(result.typed).not.toHaveProperty("stage");
    expect(result.typed).not.toHaveProperty("signedDriverId");
    expect(result.typed).not.toHaveProperty("smsConsentAt");
    expect(result.typed).not.toHaveProperty("smsOptedOutAt");
    expect(result.typed).not.toHaveProperty("ownerUserId");
    expect(result.typed).not.toHaveProperty("lostReason");
    expect(result.typed).not.toHaveProperty("hotLeadAcknowledgedAt");
  });

  it("coerces 'yes'/'no'/'true'/'1' to booleans for bool fields", () => {
    const result = sanitizeQualificationPatch({
      hasCdlA: "yes",
      hazmatEndorsement: "true",
      twicCard: "1",
      recentViolations3y: "no",
      dwiEver: "false",
      amazonRelayInterest: "0",
    });
    expect(result.typed.hasCdlA).toBe(true);
    expect(result.typed.hazmatEndorsement).toBe(true);
    expect(result.typed.twicCard).toBe(true);
    expect(result.typed.recentViolations3y).toBe(false);
    expect(result.typed.dwiEver).toBe(false);
    expect(result.typed.amazonRelayInterest).toBe(false);
  });

  it("rejects invalid booleans (null, not silent-true)", () => {
    const result = sanitizeQualificationPatch({ hasCdlA: "maybe" });
    expect(result.typed.hasCdlA).toBeNull();
  });

  it("coerces numeric strings to integers, treats empty as null", () => {
    expect(sanitizeQualificationPatch({ yearsExperience: "12" }).typed.yearsExperience).toBe(12);
    expect(sanitizeQualificationPatch({ truckYear: "2019" }).typed.truckYear).toBe(2019);
    expect(sanitizeQualificationPatch({ yearsExperience: "" }).typed.yearsExperience).toBeNull();
    expect(sanitizeQualificationPatch({ truckYear: "abc" }).typed.truckYear).toBeNull();
  });

  it("trims strings; empty strings become null", () => {
    expect(sanitizeQualificationPatch({ mcNumber: "  MC-123  " }).typed.mcNumber).toBe("MC-123");
    expect(sanitizeQualificationPatch({ mcNumber: "   " }).typed.mcNumber).toBeNull();
  });

  it("`complete` flag is consumed separately, never written as a column", () => {
    const result = sanitizeQualificationPatch({ complete: true, hasCdlA: true });
    expect(result.typed).not.toHaveProperty("complete");
    expect(result.blob).not.toHaveProperty("complete");
    expect(result.typed.hasCdlA).toBe(true);
  });

  it("returns empty objects if nothing in the allowlist is present (route returns 400)", () => {
    const result = sanitizeQualificationPatch({
      stage: "lost",
      signedDriverId: "x",
      somethingWeird: "y",
    });
    expect(Object.keys(result.typed).length).toBe(0);
    expect(Object.keys(result.blob).length).toBe(0);
  });
});

describe("buildHotLeadEmail — owner alert email", () => {
  const baseLead = {
    id: "lead_abc",
    firstName: "Tony",
    lastName: "Hauler",
    phone: "+14045551234",
    email: "tony@example.com",
    currentCarrier: "Schneider",
    source: "landing_page",
    createdAt: new Date("2026-05-23T15:30:00Z"),
  };

  it("subject line names the lead and includes the phone for at-a-glance triage", () => {
    const { subject } = buildHotLeadEmail(baseLead, "https://app.example.com");
    expect(subject).toContain("Tony Hauler");
    expect(subject).toContain("+14045551234");
    expect(subject.toLowerCase()).toContain("hot lead");
  });

  it("plain-text body includes a tel: link for one-tap dial on phone", () => {
    const { text } = buildHotLeadEmail(baseLead, "https://app.example.com");
    expect(text).toContain("tel:+14045551234");
    expect(text).toContain("Tony");
    expect(text).toContain("Schneider");
  });

  it("HTML body includes a tel: link and a dashboard link", () => {
    const { html } = buildHotLeadEmail(baseLead, "https://app.example.com");
    expect(html).toContain('href="tel:+14045551234"');
    expect(html).toContain('href="https://app.example.com/admin/recruitment"');
  });

  it("handles missing optional fields without crashing", () => {
    const lead = { ...baseLead, lastName: null, email: null, currentCarrier: null };
    const { subject, text, html } = buildHotLeadEmail(lead, "https://app.example.com");
    expect(subject).toContain("Tony");
    expect(subject).not.toContain("null");
    expect(text).toContain("not provided");
    expect(html).toContain("not provided");
  });

  it("strips trailing slash from baseUrl when building dashboard link", () => {
    const { html } = buildHotLeadEmail(baseLead, "https://app.example.com/");
    expect(html).toContain('"https://app.example.com/admin/recruitment"');
    expect(html).not.toContain('"https://app.example.com//admin/recruitment"');
  });
});

describe("buildHotLeadSlackPayload — Slack mobile push", () => {
  const baseLead = {
    id: "lead_abc",
    firstName: "Tony",
    lastName: "Hauler",
    phone: "+14045551234",
    email: "tony@example.com",
    currentCarrier: "Schneider",
    source: "landing_page",
    createdAt: new Date("2026-05-23T15:30:00Z"),
  };

  it("includes a top-level `text` field — this drives the mobile push notification preview", () => {
    const payload = buildHotLeadSlackPayload(baseLead, "https://app.example.com");
    expect(payload).toHaveProperty("text");
    expect(payload.text as string).toContain("Tony Hauler");
    expect(payload.text as string).toContain("+14045551234");
    expect((payload.text as string).toLowerCase()).toContain("hot lead");
  });

  it("uses Block Kit blocks with a header, fields, and action buttons", () => {
    const payload = buildHotLeadSlackPayload(baseLead, "https://app.example.com");
    const blocks = payload.blocks as any[];
    expect(blocks.find((b) => b.type === "header")).toBeTruthy();
    expect(blocks.find((b) => b.type === "section" && Array.isArray(b.fields))).toBeTruthy();
    expect(blocks.find((b) => b.type === "actions")).toBeTruthy();
  });

  it("renders the phone as a tel: link — clickable on mobile for one-tap dial", () => {
    const payload = buildHotLeadSlackPayload(baseLead, "https://app.example.com");
    const json = JSON.stringify(payload);
    expect(json).toContain("tel:+14045551234");
  });

  it("action buttons include both Call (tel:) and Open dashboard URLs", () => {
    const payload = buildHotLeadSlackPayload(baseLead, "https://app.example.com");
    const blocks = payload.blocks as any[];
    const actions = blocks.find((b) => b.type === "actions");
    const urls = (actions.elements as any[]).map((e) => e.url);
    expect(urls).toContain("tel:+14045551234");
    expect(urls).toContain("https://app.example.com/admin/recruitment");
  });

  it("handles missing optional fields without crashing", () => {
    const lead = { ...baseLead, lastName: null, email: null, currentCarrier: null };
    const payload = buildHotLeadSlackPayload(lead, "https://app.example.com");
    expect(payload.text).toContain("Tony");
    const json = JSON.stringify(payload);
    expect(json).not.toContain("null");
  });
});

describe("recruitment-routes module — Stage 1.5 still ships ZERO automated outbound SMS", () => {
  it("still does not import Twilio or any SMS-sending service after adding email", () => {
    const src = readFileSync(
      join(__dirname, "..", "recruitment-routes.ts"),
      "utf-8"
    );
    expect(src).not.toMatch(/from\s+["']twilio["']/);
    expect(src).not.toMatch(/from\s+["']\.\/telnyx-service["']/);
    expect(src).not.toMatch(/from\s+["']\.\/sms-service["']/);
    expect(src).not.toMatch(/\.messages\.create\(/);
  });

  it("notify module imports nodemailer (email) but NOT Twilio (SMS)", () => {
    const src = readFileSync(
      join(__dirname, "..", "recruitment-notify.ts"),
      "utf-8"
    );
    expect(src).toMatch(/from\s+["']nodemailer["']/);
    expect(src).not.toMatch(/from\s+["']twilio["']/);
    expect(src).not.toMatch(/\.messages\.create\(/);
  });
});
