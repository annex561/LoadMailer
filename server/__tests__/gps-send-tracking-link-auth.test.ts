/**
 * Regression guard: POST /api/gps/send-tracking-link must require a login and
 * carry a per-driver send ceiling.
 *
 * Why this exists: the route shipped with no auth middleware. It calls
 * sendGPSTrackingSMS(driverId, loadId || null), which sends a Twilio SMS and
 * (until PR #134) rotates the driver's tracking token. The 30-minute throttle in
 * sendGPSTrackingSMS only runs when a loadId is given, so an anonymous caller
 * with a driver UUID could send unlimited SMS to that driver on our Twilio bill.
 *
 * Source-level tripwire, same approach as loads-drivers-auth.test.ts: a
 * request-level test would need the Postgres-backed session store to boot.
 *
 * NOTE — do not "simplify" this into an app.use('/api/gps', ...) prefix guard.
 * Driver devices post GPS with a token and no session; check every route under
 * a prefix before guarding it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

describe("POST /api/gps/send-tracking-link", () => {
  it("is registered with isAuthenticated as its first middleware", () => {
    expect(
      /app\.post\(\s*['"`]\/api\/gps\/send-tracking-link['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(routesSrc),
      "POST /api/gps/send-tracking-link must be gated by isAuthenticated (or requireRole(...)) first — without it anonymous callers can send unlimited Twilio SMS to any driver.",
    ).toBe(true);
  });

  it("runs the per-driver rate limiter after auth", () => {
    expect(
      /app\.post\(\s*['"`]\/api\/gps\/send-tracking-link['"`]\s*,\s*isAuthenticated\s*,\s*gpsTrackingLinkRateLimiter\s*,/.test(routesSrc),
      "POST /api/gps/send-tracking-link must pass gpsTrackingLinkRateLimiter after isAuthenticated — the no-loadId path has no other throttle.",
    ).toBe(true);
  });

  it("keys the limiter on driverId with a ceiling of 5 per hour", () => {
    const m = routesSrc.match(/const gpsTrackingLinkRateLimiter = rateLimit\(\{([\s\S]*?)\n\}\);/);
    expect(m, "gpsTrackingLinkRateLimiter definition not found in routes.ts").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/windowMs:\s*60 \* 60 \* 1000/);
    expect(body).toMatch(/max:\s*5\b/);
    expect(body).toMatch(/keyGenerator:[^\n]*req\.body\?\.driverId/);
  });

  it("keeps POST /api/driver-location/update session-free (driver devices post with a token)", () => {
    expect(
      /app\.post\(\s*['"`]\/api\/driver-location\/update['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(routesSrc),
      "POST /api/driver-location/update authenticates by tracking token; drivers have no login.",
    ).toBe(false);
  });
});
