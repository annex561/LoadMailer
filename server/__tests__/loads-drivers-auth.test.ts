/**
 * Regression guard: GET /api/loads and GET /api/drivers must never be
 * unauthenticated.
 *
 * Why this exists: both endpoints shipped with NO auth middleware and were
 * readable by anonymous internet requests on production (traqiq.app). GET
 * /api/drivers returned every driver's name, email, phone, licenseNumber,
 * smsConsentIp, pay rates AND their `trackingToken` — the token that addresses
 * the tokenized driver portal (/driver/:token, PATCH /api/drivers/self/:token).
 * GET /api/loads returned the full load book (~240KB). Same class of bug as the
 * unauthenticated voice + SMS/test endpoints (see voice-routes-auth.test.ts,
 * test-endpoints-auth.test.ts).
 *
 * Source-level tripwire, same approach as its sibling tests: asserts each
 * endpoint is registered with an auth middleware as the FIRST argument after
 * the path, so the guard runs before the handler. A request-level test would
 * need the Postgres-backed session store to boot; this guards the exact
 * regression (missing middleware on the route) without that.
 *
 * NOTE — do not "simplify" this into an app.use('/api/drivers', ...) prefix
 * guard. Express prefix guards also match subpaths, which would lock
 * PATCH /api/drivers/self/:token (the tokenized driver portal, public by
 * design) and the other 40 /api/loads//api/drivers subpath routes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

/** List endpoints that expose driver PII / tracking tokens / the load book. */
const GATED_ENDPOINTS: Array<{ method: string; path: string }> = [
  { method: "get", path: "/api/loads" },
  { method: "get", path: "/api/drivers" },
  // 2026-10-19: returned every active driver's id, name and live GPS to anonymous
  // callers, and those ids unlocked the /api/drivers/:id routes. Callers are all
  // logged-in admin pages (gps-tracking, dispatcher-dashboard, loadops-dashboard,
  // manual-dispatch, dashboard via DriverLocationMap).
  { method: "get", path: "/api/driver-locations/active" },
];

describe("load + driver list endpoints require authentication", () => {
  for (const { method, path } of GATED_ENDPOINTS) {
    it(`${method.toUpperCase()} ${path} is registered with an auth middleware`, () => {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const guarded = new RegExp(
        `app\\.${method}\\(\\s*['"\`]${escaped}['"\`]\\s*,\\s*(requireRole\\(|isAuthenticated\\b)`,
      );
      expect(
        guarded.test(routesSrc),
        `${method.toUpperCase()} ${path} must be gated by isAuthenticated (or requireRole(...)) as its first middleware — found it unauthenticated. Do NOT remove the guard: this endpoint leaks driver PII and trackingToken values to anonymous callers.`,
      ).toBe(true);
    });
  }

  it("keeps GET /api/health public (Railway healthcheckPath)", () => {
    // railway.toml sets healthcheckPath = "/api/health". Guarding it would fail
    // the deploy healthcheck and restart-loop the service.
    const healthGuarded =
      /app\.get\(\s*['"`]\/api\/health['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      healthGuarded,
      "GET /api/health must stay public — railway.toml uses it as healthcheckPath.",
    ).toBe(false);
  });

  it("keeps PATCH /api/drivers/self/:token public (tokenized driver portal)", () => {
    const selfGuarded =
      /app\.patch\(\s*['"`]\/api\/drivers\/self\/:token['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      selfGuarded,
      "PATCH /api/drivers/self/:token authenticates by token and must stay session-free — drivers have no login.",
    ).toBe(false);
  });

  it("keeps POST /api/driver-location/update public (driver GPS feed)", () => {
    // Singular "driver-location". The tokenized portal /driver/:token, the legacy
    // /mobile-driver-dashboard and /driver-tracker all post GPS here with no session.
    const updateGuarded =
      /app\.post\(\s*['"`]\/api\/driver-location\/update['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      updateGuarded,
      "POST /api/driver-location/update must stay session-free — drivers have no login and the portal pushes GPS here.",
    ).toBe(false);
  });

  // 2026-10-19: /api/coverage was mounted bare. GET /drivers returned every driver's
  // name, phone, own MC/DOT and COI file paths to anonymous callers, and the PATCH/
  // DELETE routes let anyone edit a driver's authority or delete a certificate.
  // A prefix guard is correct here (unlike /api/drivers above): every /api/coverage
  // route is admin CRUD and the only caller is the logged-in /driver-coverage page.
  it("mounts /api/coverage behind isAuthenticated", () => {
    expect(
      /app\.use\(\s*['"`]\/api\/coverage['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(routesSrc),
      "app.use('/api/coverage', ...) must pass isAuthenticated before coverageRoutes — the router leaks driver PII and allows anonymous edits/deletes.",
    ).toBe(true);
  });
});
