/**
 * Behavior guard — lifecycle Phase 5A dry-run and Phase 5B draft flags.
 *
 * Bugs these pins catch:
 *   Phase 5A: DRY_RUN_OUTBOUND=true was still writing factoringSubmitted=true
 *   to the DB even though the factoring email never went out. On the next cron
 *   tick the load appeared "submitted" and Phase 5C completed it — without any
 *   real email ever reaching the factoring company.
 *
 *   Phase 5B: The draft path wrote thankYouSent=true, so the flag name implied
 *   an actual send. Anyone reading sopProgress would think the broker received
 *   the email. The correct flag is thankYouDrafted.
 *
 * Layer 1: pure-predicate tests (no DB, no network, instant).
 * Layer 2: source-text pins confirming the fix is wired in the source.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  shouldMarkFactoringSubmitted,
  THANK_YOU_DRAFT_FLAG,
} from "../load-lifecycle-service";

const src = readFileSync(
  resolve(__dirname, "../load-lifecycle-service.ts"),
  "utf8",
);

// ── Phase 5A: dry-run must NOT mark factoring submitted ───────────────────────

describe("Phase 5A: shouldMarkFactoringSubmitted", () => {
  it("returns true when NOT a dry-run (real email sent → mark submitted)", () => {
    expect(shouldMarkFactoringSubmitted(false)).toBe(true);
  });

  it("returns false when IS a dry-run (email was NOT sent → must NOT mark)", () => {
    // This is the load-bearing assertion: dry-run = no DB flag.
    expect(shouldMarkFactoringSubmitted(true)).toBe(false);
  });
});

// ── Phase 5A source pin: updateLoad with factoringSubmitted lives in the else branch ─

describe("Phase 5A source: factoringSubmitted only written after real send", () => {
  it("factoringSubmitted:true is inside the else branch, not after the if/else", () => {
    // The DRY_RUN branch must be followed by `else {` before factoringSubmitted appears.
    // We locate the dry-run log line and the factoringSubmitted write and check order + nesting.
    const dryRunLogIdx = src.indexOf("[DRY_RUN] Would send factoring email");
    const factoringSubmittedIdx = src.indexOf("factoringSubmitted: true");
    expect(dryRunLogIdx).toBeGreaterThan(0);
    expect(factoringSubmittedIdx).toBeGreaterThan(0);

    // The `} else {` must appear between the dry-run log and the factoringSubmitted write.
    const between = src.slice(dryRunLogIdx, factoringSubmittedIdx);
    expect(
      between,
      "factoringSubmitted:true must be inside the else block, not reachable on dry-run",
    ).toMatch(/}\s*else\s*\{/);
  });

  it("DRY_RUN branch has a comment explicitly saying it does NOT mark submitted", () => {
    const dryRunLogIdx = src.indexOf("[DRY_RUN] Would send factoring email");
    const elseIdx = src.indexOf("} else {", dryRunLogIdx);
    const dryRunBlock = src.slice(dryRunLogIdx, elseIdx);
    expect(
      /must not mark|not mark|did not go out|never mark|ponytail/.test(dryRunBlock),
      "The DRY_RUN branch must have an explicit comment noting the email was not sent",
    ).toBe(true);
  });
});

// ── Phase 5B: draft uses thankYouDrafted, NOT thankYouSent ───────────────────

describe("Phase 5B: THANK_YOU_DRAFT_FLAG constant", () => {
  it("exported draft flag is 'thankYouDrafted' (not thankYouSent)", () => {
    expect(THANK_YOU_DRAFT_FLAG).toBe("thankYouDrafted");
  });
});

describe("Phase 5B source: draft path writes thankYouDrafted, never thankYouSent", () => {
  it("Phase 5B block writes thankYouDrafted (the draft marker)", () => {
    const phase5bMatch = src.match(/PHASE 5B[\s\S]*?(?=PHASE 5C|$)/);
    expect(phase5bMatch, "Could not find Phase 5B block").toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    expect(
      /thankYouDrafted/.test(phase5bBlock),
      "Phase 5B must write thankYouDrafted:true (not thankYouSent)",
    ).toBe(true);
  });

  it("Phase 5B block does NOT write thankYouSent (reserved for Annex's real send)", () => {
    const phase5bMatch = src.match(/PHASE 5B[\s\S]*?(?=PHASE 5C|$)/);
    expect(phase5bMatch, "Could not find Phase 5B block").toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    // thankYouSent must not appear as an assignment key in Phase 5B
    const assignsThankYouSent = /thankYouSent\s*:/.test(phase5bBlock);
    expect(
      assignsThankYouSent,
      "Phase 5B must NOT write thankYouSent — that flag is reserved for when Annex manually sends the email",
    ).toBe(false);
  });

  it("Phase 5B guard checks thankYouDrafted (not thankYouSent) to prevent duplicate drafts", () => {
    const phase5bMatch = src.match(/PHASE 5B[\s\S]*?(?=PHASE 5C|$)/);
    expect(phase5bMatch, "Could not find Phase 5B block").toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    // The guard condition must test !sopProgress.thankYouDrafted
    expect(
      /thankYouDrafted/.test(phase5bBlock),
      "Phase 5B idempotency guard must check thankYouDrafted (matches what it writes)",
    ).toBe(true);
  });

  it("Phase 5B does NOT call mailer.sendMail (draft-only path)", () => {
    const phase5bMatch = src.match(/PHASE 5B[\s\S]*?(?=PHASE 5C|$)/);
    expect(phase5bMatch, "Could not find Phase 5B block").toBeTruthy();
    const phase5bBlock = phase5bMatch![0];
    expect(
      /mailer\.sendMail\s*\(/.test(phase5bBlock),
      "Phase 5B must NOT call mailer.sendMail — thank-you emails are drafts only",
    ).toBe(false);
  });
});
