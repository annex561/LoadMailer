// Guards for server/dat-loads-direct.ts.
//
// Four of the six routes drive datLoginMonitor → Puppeteer → a real DAT session with real
// credentials, and /api/dat/* has NO prefix guard in routes.ts. The two assertions that matter
// most are therefore:
//
//   1. Nothing registers unless a flag says so, and the Puppeteer routes need their OWN flag.
//   2. Every route carries a role guard in the source, so there is no path to those handlers
//      from an unauthenticated request.
//
// If (1) inverts, a config tidy-up silently exposes a browser-launcher. If (2) inverts, it is
// exposed to the whole internet.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isDatDirectEnabled, isDatDirectLoginEnabled } from '../dat-loads-direct';

const SRC = readFileSync(resolve(__dirname, '../dat-loads-direct.ts'), 'utf8');

/**
 * SRC with comments stripped. Assertions about CODE SHAPE must run against this — the file
 * documents the bugs it fixed, so prose quoting `checkAuthentication()` or a broker domain would
 * otherwise fail a test that is asking about the code.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('DAT-direct gating — default off', () => {
  it('registers nothing when no flags are set', () => {
    expect(isDatDirectEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isDatDirectLoginEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('treats any value other than the exact string "true" as off', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', '', 'false']) {
      expect(isDatDirectEnabled({ DAT_DIRECT_ENABLED: v } as any), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe('DAT-direct gating — the Puppeteer routes need their own flag', () => {
  it('enables the read routes without enabling the login routes', () => {
    const env = { DAT_DIRECT_ENABLED: 'true' } as any;
    expect(isDatDirectEnabled(env)).toBe(true);
    expect(isDatDirectLoginEnabled(env)).toBe(false);
  });

  it('does NOT enable the login routes from the login flag alone', () => {
    // Setting only the login flag must not be a back door around the base flag.
    const env = { DAT_DIRECT_LOGIN_ENABLED: 'true' } as any;
    expect(isDatDirectEnabled(env)).toBe(false);
    expect(isDatDirectLoginEnabled(env)).toBe(false);
  });

  it('enables the login routes only when BOTH flags are set', () => {
    const env = { DAT_DIRECT_ENABLED: 'true', DAT_DIRECT_LOGIN_ENABLED: 'true' } as any;
    expect(isDatDirectEnabled(env)).toBe(true);
    expect(isDatDirectLoginEnabled(env)).toBe(true);
  });
});

describe('DAT-direct gating — kill switch', () => {
  it('beats both flags', () => {
    const env = {
      DAT_DIRECT_ENABLED: 'true',
      DAT_DIRECT_LOGIN_ENABLED: 'true',
      DAT_DIRECT_DISABLED: 'true',
    } as any;
    expect(isDatDirectEnabled(env)).toBe(false);
    expect(isDatDirectLoginEnabled(env)).toBe(false);
  });
});

describe('DAT-direct — every route is role-guarded in source', () => {
  it('attaches a guard to all six routes', () => {
    const routes = CODE.match(/app\.(get|post)\('\/api\/dat[^']*',\s*[a-zA-Z]+/g) ?? [];
    expect(routes.length, 'expected six /api/dat* route registrations').toBe(6);
    for (const r of routes) {
      expect(r, `route registered without a guard: ${r}`).toMatch(/,\s*guard$/);
    }
  });

  it('takes the guard as a parameter so it cannot be registered unprotected', () => {
    // If setupDirectDATLoads ever loses the required `guard` parameter, a caller could wire the
    // routes with no middleware at all and nothing would complain.
    expect(CODE).toMatch(/export function setupDirectDATLoads\(\s*app: Express,\s*guard: RequestHandler/);
  });

  it('uses a role guard, not merely an authenticated-session check', () => {
    expect(CODE).toMatch(/requireRole\(['"]admin['"],\s*['"]dispatcher['"]\)/);
  });

  it('fences the Puppeteer routes behind the includeLoginRoutes early return', () => {
    const fence = CODE.indexOf('if (!includeLoginRoutes) return;');
    expect(fence, 'includeLoginRoutes fence missing').toBeGreaterThan(-1);
    // All four credential-driving routes must sit AFTER the fence.
    for (const r of ['/api/dat/start-login', '/api/dat/check-auth', '/api/dat/force-scrape-real', '/api/dat/force-auth-check']) {
      expect(CODE.indexOf(r), `${r} must be behind the fence`).toBeGreaterThan(fence);
    }
    // Both read-only routes must sit BEFORE it.
    for (const r of ["'/api/dat-loads-direct'", "'/api/dat/scraper-status'"]) {
      expect(CODE.indexOf(r), `${r} should be a read route, before the fence`).toBeLessThan(fence);
    }
  });
});

describe('DAT-direct — fabricated load data stays deleted', () => {
  it('does not reintroduce the hardcoded liveDAT_Loads array', () => {
    // ~100 lines of invented freight carrying REAL broker names, emails and phone numbers, under
    // a comment calling it "Authentic DAT load data". Acting on it means calling Schneider about
    // a load that does not exist.
    expect(CODE).not.toMatch(/const liveDAT_Loads/);
    for (const broker of ['schneider.com', 'echo.com', 'tql.com', 'chrobinson.com', 'coyote.com']) {
      expect(CODE, `fabricated broker contact reintroduced: ${broker}`).not.toContain(broker);
    }
  });

  it('calls a method that exists on DATLoginMonitor', () => {
    // The route called datLoginMonitor.checkAuthentication(), which is not a method on that
    // class — a guaranteed TypeError the moment the route became reachable.
    expect(CODE).not.toMatch(/checkAuthentication\(\)/);
    expect(CODE).toMatch(/checkAuthenticationStatus\(\)/);
  });
});
