/**
 * Regression test for the review-queue blank-page bug.
 *
 * History: /review-queue rendered a fully black page when the user's
 * session expired. The page hit /api/ratecon-intake/review-queue, the
 * server returned 401 with body {"message":"Unauthorized"}, and the
 * page did `setRows(await rqRes.json())` unconditionally. `rows` became
 * `{message:"Unauthorized"}` (an object, not an array). The next
 * `rows.filter(...)` call inside a useMemo threw TypeError, React
 * unmounted the entire tree, and the dispatcher saw an empty viewport
 * with no clue what was wrong.
 *
 * Fix (this test pins it): non-array responses are coerced to [] and a
 * banner explains what happened. The page must NEVER crash on a
 * non-array body from this endpoint.
 *
 * Lives in server/__tests__/ because the project's vitest.config.ts
 * only includes that path. The file under test is a TSX page in
 * client/src/pages/ but we source-text-pin its behavior here without
 * needing a JSDOM environment.
 *
 * DO NOT delete. Source: dispatcher reported a black /review-queue
 * screenshot and asked to "fix this".
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "client", "src", "pages", "review-queue.tsx"),
  "utf8",
);

describe("review-queue page — defensive fetch handling", () => {
  it("guards rqRes parsing against non-array bodies", () => {
    // The fix replaces `setRows(await rqRes.json())` with an
    // Array.isArray check. The old anti-pattern must NOT come back.
    expect(SRC).toMatch(/Array\.isArray\(rqJson\)/);
    expect(SRC).not.toMatch(/setRows\(await rqRes\.json\(\)\)/);
  });

  it("handles 401/403 explicitly with a session-expired message", () => {
    expect(SRC).toMatch(/rqRes\.status === 401/);
    expect(SRC).toMatch(/session expired/i);
  });

  it("renders an error banner when loadError is set", () => {
    // The banner is the user-visible escape hatch — without it the page
    // looks identical whether the queue is empty or auth failed.
    expect(SRC).toMatch(/data-testid="review-queue-error-banner"/);
    expect(SRC).toMatch(/Review queue unavailable/);
  });

  it("does not crash on network errors (catch + fallback)", () => {
    expect(SRC).toMatch(/catch \(err: any\) \{/);
    expect(SRC).toMatch(/Could not reach the server/);
  });

  it("sends credentials with both fetches (preserves session cookie)", () => {
    // Without credentials: 'include', the dispatcher's session cookie
    // wouldn't reach /api/ratecon-intake/review-queue and they'd get
    // a 401 even when logged in.
    const matches = SRC.match(/credentials:\s*"include"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
