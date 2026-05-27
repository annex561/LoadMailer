/**
 * Regression: auto-submit-to-factoring on BOL approval must stay
 * gated behind THREE conditions, all of which must be true:
 *
 *   1. process.env.FACTORING_AUTO_SUBMIT === 'true'  (default-OFF flag)
 *   2. document.documentType === 'bol'               (only BOLs trigger)
 *   3. document.loadId is truthy                     (no orphan docs)
 *
 * Plus: the call must go through submitToLoves (which carries the kill
 * switch, the enable flag, the per-load DB dedup, and the rate ceiling).
 * Calling Love's SMTP directly would bypass all of that.
 *
 * Why this exists: the document-approve route is on a hot path that
 * dispatchers click many times a day. A future refactor that loosens
 * any of the three gates above could send a packet to Love's on the
 * wrong document type, or fire for every approval globally — both of
 * which are financial blast-radius events.
 *
 * Source-text pin in the style of critical-path-chain.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "routes.ts"), "utf8");

// Pull the handler body for POST /api/documents/:documentId/approve so the
// pins below only inspect that block, not the whole routes.ts file.
function getApproveHandler(): string {
  const marker = "'/api/documents/:documentId/approve'";
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  // Grab a generous window — the handler is < 80 lines.
  return src.slice(start, start + 4000);
}

describe("routes: POST /api/documents/:documentId/approve auto-submit gate", () => {
  it("gates on FACTORING_AUTO_SUBMIT === 'true' (default-OFF env flag)", () => {
    const block = getApproveHandler();
    expect(block).toMatch(
      /process\.env\.FACTORING_AUTO_SUBMIT\s*===\s*['"]true['"]/,
    );
  });

  it("gates on documentType === 'bol' (no other doc types trigger Love's)", () => {
    const block = getApproveHandler();
    expect(block).toMatch(/document\.documentType\s*===\s*['"]bol['"]/);
  });

  it("gates on document.loadId truthiness (no orphan-doc sends)", () => {
    const block = getApproveHandler();
    expect(block).toMatch(/document\.loadId/);
  });

  it("auto-submit goes through submitToLoves (carries kill switch + dedup + rate ceiling)", () => {
    const block = getApproveHandler();
    // Must call submitToLoves — NOT raw nodemailer / sendMail / SMTP.
    expect(block).toMatch(/submitToLoves\s*\(/);
    // And must NOT be reaching into Love's SMTP directly from this handler.
    expect(block).not.toMatch(/schedulesLS@loves\.com/i);
    expect(block).not.toMatch(/nodemailer/);
  });
});
