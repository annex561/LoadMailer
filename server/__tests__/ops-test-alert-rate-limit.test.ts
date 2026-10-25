/**
 * Regression guard: POST /api/ops/test-alert must carry a send ceiling.
 *
 * Why this exists: the handler sends a real Twilio SMS to the ops alert phone
 * (DISPATCHER_ALERT_PHONE) on every call, with no throttle of its own. Login
 * is pinned in test-endpoints-auth.test.ts; this pins the ceiling behind it.
 *
 * Source-level tripwire, same approach as gps-send-tracking-link-auth.test.ts:
 * a request-level test would need the Postgres-backed session store to boot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

describe("POST /api/ops/test-alert rate limit", () => {
  it("runs opsTestAlertRateLimiter right after isAuthenticated", () => {
    expect(
      /app\.post\(\s*['"`]\/api\/ops\/test-alert['"`]\s*,\s*isAuthenticated\s*,\s*opsTestAlertRateLimiter\s*,/.test(routesSrc),
      "POST /api/ops/test-alert must pass opsTestAlertRateLimiter after isAuthenticated — the handler has no other throttle.",
    ).toBe(true);
  });

  it("caps test alerts at 3 per hour on one shared key", () => {
    const m = routesSrc.match(/const opsTestAlertRateLimiter = rateLimit\(\{([\s\S]*?)\n\}\);/);
    expect(m, "opsTestAlertRateLimiter definition not found in routes.ts").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/windowMs:\s*60 \* 60 \* 1000/);
    expect(body).toMatch(/max:\s*3\b/);
    expect(body).toMatch(/keyGenerator:\s*\(\)\s*=>\s*['"`]ops-test-alert['"`]/);
  });
});
