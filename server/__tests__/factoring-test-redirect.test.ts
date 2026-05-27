/**
 * Regression: FACTORING_TEST_TO_EMAIL redirect must ALWAYS go through the
 * test-mode branch — never to Love's.
 *
 * Why this exists: the only way to preview a real factoring packet without
 * emailing Love's is the test redirect. If a future refactor moves the
 * test-mode block past the production sendMail (or drops the To: override),
 * a "preview" click would silently email Love's. That's a financial /
 * business blast event the dedup constraint doesn't catch (test sends
 * intentionally skip dedup, so the safety net is gone too).
 *
 * Source-text pin in the style of critical-path-chain.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "factoring-loves.ts"), "utf8");

describe("factoring-loves: FACTORING_TEST_TO_EMAIL redirect gate", () => {
  it("reads FACTORING_TEST_TO_EMAIL with trim() (handles trailing whitespace)", () => {
    expect(src).toMatch(/process\.env\.FACTORING_TEST_TO_EMAIL\?\.trim\(\)/);
  });

  it("test-mode block lives INSIDE submitToLoves AND BEFORE the dedup check", () => {
    // Slice from the function declaration to the dedup comment. The
    // test-mode redirect must appear inside that slice — otherwise the
    // dedup check or the real sendMail would fire first.
    const fnStart = src.indexOf("export async function submitToLoves");
    expect(fnStart).toBeGreaterThan(-1);
    const dedupComment = src.indexOf(
      "Dedup: if a submission row already exists for this load",
    );
    expect(dedupComment).toBeGreaterThan(fnStart);
    const preDedup = src.slice(fnStart, dedupComment);
    expect(preDedup).toMatch(/FACTORING_TEST_TO_EMAIL/);
    expect(preDedup).toMatch(/TEST REDIRECT/);
  });

  it("test-mode branch sends to the test address — NOT to schedulesLS@loves.com", () => {
    // Find the test-mode if-block by its hallmark log line, then assert
    // the sendMail INSIDE it uses testToEmail and not the Love's constant.
    const start = src.indexOf("TEST REDIRECT: loadId=");
    expect(start).toBeGreaterThan(-1);
    // The block runs until the matching `}` of the `if (testToEmail) {` —
    // approximate by slicing the next 4000 chars and checking content.
    const block = src.slice(start, start + 4000);
    expect(block).toMatch(/to:\s*testToEmail/);
    // Must NOT route to Love's from inside the test branch.
    expect(block).not.toMatch(/to:\s*SCHEDULES_LS/);
    expect(block).not.toMatch(/to:\s*['"]schedulesLS@loves\.com['"]/i);
  });

  it("test-mode branch subject is prefixed [TEST so any human reader sees it's not real", () => {
    const start = src.indexOf("TEST REDIRECT: loadId=");
    const block = src.slice(start, start + 4000);
    expect(block).toMatch(/\[TEST/);
  });

  it("test-mode branch skips the production factoring_submissions insert", () => {
    // The real path inserts a row into factoringSubmissions BEFORE sending.
    // Test mode must NOT touch that table — otherwise the dedup constraint
    // would block the next retest of the same load.
    const start = src.indexOf("TEST REDIRECT: loadId=");
    const block = src.slice(start, start + 4000);
    expect(block).not.toMatch(/\.insert\(factoringSubmissions\)/);
  });
});
