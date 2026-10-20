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

  // 2026-10-19: every /api/drivers/:param route was open except the two /advances routes.
  // GET /api/drivers/:id returned the full row incl. trackingToken; POST
  // /:driverId/generate-tracking-token ROTATED it (hijacks /driver/:token, kills the
  // driver's real link); PUT/DELETE edited or deleted the driver; send-dashboard-link
  // sent a billable SMS per call. Driver UUIDs are not secret — anonymous GET
  // /api/driver-locations/active lists them. Scans every route whose third path segment
  // is a param, so a new unguarded /api/drivers/:id/... route fails here too. The
  // tokenized portal route is /api/drivers/self/:token (literal "self"), not matched.
  describe("every /api/drivers/:param route requires authentication", () => {
    const routeRe =
      /app\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/drivers\/:[^'"`]*)\2\s*,\s*([^,]*)/g;
    const routes = [...routesSrc.matchAll(routeRe)].map((m) => ({
      method: m[1],
      path: m[3],
      firstArg: m[4].trim(),
    }));

    it("finds the known routes (scan has not drifted)", () => {
      expect(routes.length).toBeGreaterThanOrEqual(12);
    });

    for (const { method, path, firstArg } of routes) {
      it(`${method.toUpperCase()} ${path} is gated`, () => {
        expect(
          /^(requireRole\(|isAuthenticated\b)/.test(firstArg),
          `${method.toUpperCase()} ${path} must pass isAuthenticated (or requireRole(...)) before its handler. Driver UUIDs leak from public endpoints, so an unguarded /api/drivers/:id route is an anonymous read/write on that driver.`,
        ).toBe(true);
      });
    }
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
