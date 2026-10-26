/**
 * Regression guard: lifecycle email flags default OFF, thank-you = draft only,
 * and the release-driver / submit-factoring routes require admin auth.
 *
 * All source-level tripwires (reads routes.ts / load-lifecycle-service.ts
 * directly) so they run without a database or Twilio/SMTP credentials.
 *
 * Why this exists:
 * - Phase 5A was auto-emailing FACTORING_EMAIL / EINSTEIN_EMAIL (Einstein has
 *   left the company) with no flag guard and no DRY_RUN_OUTBOUND check.
 * - Phase 5B was auto-sending broker thank-you emails with no approval gate.
 * - POST /api/lifecycle/release-driver/:loadId and
 *   POST /api/lifecycle/submit-factoring/:loadId had zero auth, so any
 *   anonymous caller could send the "Good to Go" SMS or trigger a factoring
 *   email send.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const lifecycleSrc = readFileSync(
  resolve(__dirname, "../load-lifecycle-service.ts"),
  "utf8",
);

// ── Auth tripwires ─────────────────────────────────────────────────────────

describe("lifecycle admin routes require authentication", () => {
  it("POST /api/lifecycle/release-driver/:loadId has isAuthenticated as first middleware", () => {
    const gated =
      /app\.post\(\s*['"`]\/api\/lifecycle\/release-driver\/:loadId['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      gated,
      "POST /api/lifecycle/release-driver/:loadId must be gated — it sends the 'Good to Go' SMS to the driver. An anonymous caller must get 401.",
    ).toBe(true);
  });

  it("POST /api/lifecycle/submit-factoring/:loadId has isAuthenticated as first middleware", () => {
    const gated =
      /app\.post\(\s*['"`]\/api\/lifecycle\/submit-factoring\/:loadId['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      gated,
      "POST /api/lifecycle/submit-factoring/:loadId must be gated — it emails a factoring package. An anonymous caller must get 401.",
    ).toBe(true);
  });
});

// ── Phase 5A flag guard ────────────────────────────────────────────────────

describe("Phase 5A factoring email is gated by LIFECYCLE_FACTORING_EMAIL_ENABLED", () => {
  it("checks LIFECYCLE_FACTORING_EMAIL_ENABLED === 'true' before sending factoring email", () => {
    // The flag check must appear in the lifecycle service before the Phase 5A mailer block
    const flagCheck =
      /LIFECYCLE_FACTORING_EMAIL_ENABLED.*===.*['"]true['"]/.test(lifecycleSrc);
    expect(
      flagCheck,
      "load-lifecycle-service.ts must check LIFECYCLE_FACTORING_EMAIL_ENABLED === 'true' before Phase 5A runs. Default OFF keeps factoring emails from firing for anonymous or missing recipients.",
    ).toBe(true);
  });

  it("respects DRY_RUN_OUTBOUND inside Phase 5A (no send on dry run)", () => {
    // The lifecycle service must check DRY_RUN_OUTBOUND before calling sendMail in Phase 5A
    const dryRunCheck =
      /DRY_RUN_OUTBOUND.*===.*['"]true['"]/.test(lifecycleSrc);
    expect(
      dryRunCheck,
      "load-lifecycle-service.ts must check DRY_RUN_OUTBOUND before sending the factoring email in Phase 5A.",
    ).toBe(true);
  });
});

// ── Phase 5B flag guard + draft-only ──────────────────────────────────────

describe("Phase 5B thank-you email is gated by LIFECYCLE_THANKYOU_EMAIL_ENABLED and is draft-only", () => {
  it("checks LIFECYCLE_THANKYOU_EMAIL_ENABLED === 'true' before running Phase 5B", () => {
    const flagCheck =
      /LIFECYCLE_THANKYOU_EMAIL_ENABLED.*===.*['"]true['"]/.test(lifecycleSrc);
    expect(
      flagCheck,
      "load-lifecycle-service.ts must check LIFECYCLE_THANKYOU_EMAIL_ENABLED === 'true' before Phase 5B runs.",
    ).toBe(true);
  });

  it("Phase 5B does NOT call mailer.sendMail for the thank-you (draft only)", () => {
    // Extract the Phase 5B block and assert it contains no mailer.sendMail call.
    // We identify Phase 5B as the region between "PHASE 5B" and "PHASE 5C".
    const phase5bMatch = lifecycleSrc.match(
      /PHASE 5B[\s\S]*?(?=PHASE 5C|$)/,
    );
    expect(phase5bMatch, "Could not find Phase 5B block in load-lifecycle-service.ts").toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    const callsSendMail = /mailer\.sendMail\s*\(/.test(phase5bBlock);
    expect(
      callsSendMail,
      "Phase 5B must NOT call mailer.sendMail — thank-you emails are drafts only. Remove any mailer.sendMail call from the Phase 5B block.",
    ).toBe(false);
  });

  it("Phase 5B logs a DRAFT message instead of sending", () => {
    const phase5bMatch = lifecycleSrc.match(/PHASE 5B[\s\S]*?(?=PHASE 5C|$)/);
    expect(phase5bMatch).toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    const logsDraft = /DRAFT|draft/.test(phase5bBlock);
    expect(
      logsDraft,
      "Phase 5B must log a DRAFT indicator instead of sending — the thank-you email should be reviewable before Annex sends it manually.",
    ).toBe(true);
  });
});
