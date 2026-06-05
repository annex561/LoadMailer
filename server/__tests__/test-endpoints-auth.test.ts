/**
 * Regression guard: the SMS/test endpoints must never be unauthenticated.
 *
 * Why this exists: POST /api/test-sms shipped with NO auth middleware. Anyone
 * on the internet could POST {to, message} and send arbitrary Twilio SMS from
 * the company number — the exact runaway Twilio-cost failure mode the project
 * CLAUDE.md warns about (PR #62 burned 1,000+ messages). Same risk on the two
 * sibling test endpoints.
 *
 * This is a source-level tripwire: it reads server/routes.ts and asserts each
 * endpoint is registered with an auth middleware (requireRole(...) or
 * isAuthenticated) as the FIRST argument after the path — i.e. before the
 * handler ever runs. It fails on the pre-fix code (no middleware) and on any
 * future edit that drops the guard. A request-level integration test would
 * need the Postgres-backed session store to boot; this guards the exact
 * regression (missing middleware on the route) without that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

/** Endpoints that send outbound Twilio SMS / trigger paid pipelines and must be gated. */
const GATED_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: "post", path: "/api/test-sms" },
  { method: "post", path: "/api/test/ratecon-pipeline" },
  { method: "post", path: "/api/sms/test/:driverId" },
];

describe("SMS/test endpoints require authentication", () => {
  for (const { method, path } of GATED_ENDPOINTS) {
    it(`${method.toUpperCase()} ${path} is registered with an auth middleware`, () => {
      // Escape regex metachars in the path, then require an auth middleware
      // (requireRole(...) or isAuthenticated) immediately after the path arg.
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const guarded = new RegExp(
        `app\\.${method}\\(\\s*['"\`]${escaped}['"\`]\\s*,\\s*(requireRole\\(|isAuthenticated\\b)`,
      );
      expect(
        guarded.test(routesSrc),
        `${method.toUpperCase()} ${path} must be gated by requireRole(...) or isAuthenticated as its first middleware — found it unauthenticated. Do NOT remove the guard (open Twilio-cost vector).`,
      ).toBe(true);
    });
  }
});
