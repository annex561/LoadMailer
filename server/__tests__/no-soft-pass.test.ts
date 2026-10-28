/**
 * Regression: former soft-pass paths (infra error, catch block) must yield
 * needs_review — fail closed — and must NOT proceed to factoring/send as if
 * the BOL was verified.
 *
 * S12-D / fix/no-soft-pass — DO NOT delete.
 *
 * Each test pins one invariant in source so that if a future refactor
 * reintroduces a soft-pass, this file fails loudly before merge.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const smsSrc = fs.readFileSync(
  path.join(__dirname, "..", "sms-communication-service.ts"),
  "utf8",
);
const bolSrc = fs.readFileSync(
  path.join(__dirname, "..", "factoring-bol-verify.ts"),
  "utf8",
);

describe("no-soft-pass: infra-error path sets needsReview, not verified", () => {
  it("needsReview is declared alongside verified", () => {
    // Both variables must be declared; absence means the guard was removed.
    expect(smsSrc).toMatch(/let verified\s*=\s*false/);
    expect(smsSrc).toMatch(/let needsReview\s*=\s*false/);
  });

  it("needsReview=true appears at least twice (infra-error branch + catch block)", () => {
    const hits = smsSrc.match(/needsReview\s*=\s*true/g);
    // Two paths must both set needsReview, never verified=true.
    expect(hits?.length).toBeGreaterThanOrEqual(2);
  });

  it("the infra-error branch does NOT set verified=true", () => {
    // After isInfraError check, the old code set verified=true (soft-pass).
    // The new code must NOT do that — it sets needsReview=true.
    const infraIdx = smsSrc.indexOf("isInfraError");
    expect(infraIdx).toBeGreaterThan(-1);
    // Extract the isInfraError if-block (up to the matching else)
    const infraRegion = smsSrc.slice(infraIdx, infraIdx + 400);
    expect(infraRegion).toMatch(/needsReview\s*=\s*true/);
    expect(infraRegion).not.toMatch(/verified\s*=\s*true/);
  });

  it("the catch block does NOT set verified=true", () => {
    // Find the catch inside the BOL-verify try block.
    // There are multiple catches in the file; look for the one near "bol-verify"
    const bolVerifyTryIdx = smsSrc.indexOf("verifyBolPhoto(imageUrl)");
    expect(bolVerifyTryIdx).toBeGreaterThan(-1);
    const catchIdx = smsSrc.indexOf("} catch (err: any) {", bolVerifyTryIdx);
    expect(catchIdx).toBeGreaterThan(-1);
    const catchRegion = smsSrc.slice(catchIdx, catchIdx + 300);
    expect(catchRegion).toMatch(/needsReview\s*=\s*true/);
    expect(catchRegion).not.toMatch(/verified\s*=\s*true/);
  });

  it("the needsReview output branch notifies staff and sends a review message (not retake)", () => {
    // The if(needsReview) block must call notifyAdminReviewNeeded and tell the
    // driver their photo is under review — not ask them to retake a fine BOL.
    const needsReviewBranchIdx = smsSrc.indexOf("if (needsReview)");
    expect(needsReviewBranchIdx).toBeGreaterThan(-1);
    const branchRegion = smsSrc.slice(needsReviewBranchIdx, needsReviewBranchIdx + 900);
    expect(branchRegion).toMatch(/notifyAdminReviewNeeded/);
    // Driver-facing sendReply in this branch must say "manually" (manual review),
    // not "retake" (which would wrongly ask driver to re-shoot a valid BOL).
    expect(branchRegion).toMatch(/manually/i);
  });
});

describe("no-soft-pass: factoring-bol-verify catch returns ok:false", () => {
  it("catch block in verifyBolPhoto returns ok:false (never ok:true)", () => {
    // The verifier must not soft-pass at the source — it always returns
    // ok:false on error so the caller cannot misinterpret a failure as a pass.
    const catchIdx = bolSrc.lastIndexOf("} catch");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = bolSrc.slice(catchIdx);
    expect(catchBody).toContain("ok: false");
    expect(catchBody).not.toContain("ok: true");
  });
});
