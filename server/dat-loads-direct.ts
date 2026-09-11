// Direct DAT loads endpoint.
//
// REGISTRATION IS GATED. See registerDirectDATLoads() below for why.
//
// Removed 2026-09-10: a ~100-line `liveDAT_Loads` array of hardcoded freight sat here under the
// comment "Authentic DAT load data from major freight exchanges". It was fabricated — invented
// rates and lanes carrying REAL broker names, real dispatch emails and real phone numbers
// (Schneider, Echo, TQL, C.H. Robinson, Coyote). Nothing referenced it, so it never reached the
// API, but it was a landmine: anyone wiring it up on the strength of that comment would have
// called a real broker about a load that does not exist. Deleted rather than left to be found.

import type { Express, RequestHandler } from 'express';
import { requireRole } from './auth';
import { datLoginMonitor } from './dat-login-monitor';

let authenticatedSessionLoads: any[] = [];

/**
 * Register the DAT-direct routes. NOT called unconditionally — see registerDirectDATLoads().
 *
 * `guard` is applied to every route here. It is a parameter rather than a hardcoded middleware so
 * the caller cannot accidentally register these unprotected: there is no code path that reaches
 * these handlers without one.
 */
export function setupDirectDATLoads(app: Express, guard: RequestHandler, includeLoginRoutes: boolean) {
  // Direct DAT loads endpoint - serves authenticated session loads
  app.get('/api/dat-loads-direct', guard, async (req, res) => {
    try {
      // Return cached loads if available
      if (authenticatedSessionLoads.length > 0) {
        console.log(`📋 Serving ${authenticatedSessionLoads.length} cached real DAT loads`);
        return res.json(authenticatedSessionLoads);
      }
      
      // No real loads available
      console.log('📋 [WAITING] No real DAT loads currently available');
      console.log('🔐 Use "Start DAT Login" to authenticate and load real DAT loads');
      res.json([]);
      
    } catch (error: any) {
      console.error('Error getting real DAT loads:', error);
      res.json([]);
    }
  });

  // Status endpoint for DAT scraping
  app.get('/api/dat/scraper-status', guard, async (req, res) => {
    res.json({
      authenticated: false,
      account: 'dispatch@traqiqs.io',
      status: 'ready',
      message: 'Click "Start DAT Login" to authenticate and load real DAT loads'
    });
  });

  // Initiate DAT login process using proven method
  // Everything below drives datLoginMonitor → Puppeteer → a real DAT session using real
  // credentials. Separate flag: "show me the cached loads" and "launch a browser and log into
  // DAT as us" are not the same decision and must not share a switch.
  if (!includeLoginRoutes) return;

  app.post('/api/dat/start-login', guard, async (req, res) => {
    try {
      console.log('🚀 User initiated proven DAT login process');
      const result = await datLoginMonitor.startLoginProcess();
      res.json(result);
    } catch (error: any) {
      console.error('❌ Start login error:', error);
      res.json({ status: 'error', message: error.message });
    }
  });

  // Check authentication status
  app.get('/api/dat/check-auth', guard, async (req, res) => {
    try {
      const status = await datLoginMonitor.checkAuthenticationStatus();
      
      if (status.status === 'authenticated') {
        // Immediately scrape loads if authenticated
        const loads = await datLoginMonitor.scrapeLoads();
        if (loads.length > 0) {
          authenticatedSessionLoads = loads;
        }
        
        res.json({
          authenticated: true,
          loadsFound: loads.length,
          loads: loads,
          message: `Found ${loads.length} real DAT loads`
        });
      } else {
        res.json({
          authenticated: false,
          message: status.message || 'Not yet authenticated'
        });
      }
    } catch (error: any) {
      console.error('❌ Auth check error:', error);
      res.json({ authenticated: false, message: error.message });
    }
  });

  // Force refresh using proven DAT scraper
  app.post('/api/dat/force-scrape-real', guard, async (req, res) => {
    console.log('🔧 FORCE SCRAPE: Using proven DAT method...');
    
    try {
      const loads = await datLoginMonitor.scrapeLoads();
      
      if (loads && loads.length > 0) {
        authenticatedSessionLoads = loads;
        console.log(`✅ Force scrape SUCCESS: Found ${loads.length} real DAT loads`);
        return res.json({ success: true, loadsFound: loads.length, loads: loads });
      } else {
        console.log('⚠️ Force scrape: No loads found - please authenticate first');
        return res.json({ success: false, message: 'Please authenticate with DAT first using "Start DAT Login"' });
      }
      
    } catch (error: any) {
      console.error('❌ Force scrape error:', error);
      return res.json({ success: false, error: error.message });
    }
  });

  // Force authentication check endpoint
  app.post('/api/dat/force-auth-check', guard, async (req, res) => {
    console.log('🔧 FORCE AUTH CHECK: User manually checking DAT authentication...');
    
    try {
      // NOTE: this used to call datLoginMonitor.checkAuthentication(), which does not exist on
      // DATLoginMonitor — the class only has startLoginProcess/checkAuthenticationStatus/
      // scrapeLoads. The route was unreachable (setupDirectDATLoads was never called), so the
      // TypeError never fired. Making it reachable means fixing it. The real method returns
      // { status, message }, not { authenticated }.
      const result = await datLoginMonitor.checkAuthenticationStatus();

      if (result?.status === 'authenticated') {
        console.log('✅ FORCE AUTH SUCCESS: DAT authentication confirmed!');
        // Immediately try to scrape loads
        const loads = await datLoginMonitor.scrapeLoads();
        authenticatedSessionLoads = loads || [];
        
        res.json({
          authenticated: true,
          message: 'DAT authentication successful - loads loading...',
          loadsFound: loads?.length || 0
        });
      } else {
        console.log('⚠️ FORCE AUTH: Still not authenticated - user needs to complete DAT login');
        res.json({
          authenticated: false,
          message: 'Please complete login in your DAT tab first'
        });
      }
    } catch (error: any) {
      console.error('❌ Force auth check error:', error);
      res.json({ authenticated: false, message: 'Authentication check failed' });
    }
  });
}

// ─── Gated entry point ───────────────────────────────────────────────────────

/** Is the read-only surface (cached loads + status) switched on? */
export function isDatDirectEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DAT_DIRECT_DISABLED === 'true') return false;
  return env.DAT_DIRECT_ENABLED === 'true';
}

/** Is the Puppeteer/credential surface switched on? Requires the base flag too. */
export function isDatDirectLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDatDirectEnabled(env) && env.DAT_DIRECT_LOGIN_ENABLED === 'true';
}

/**
 * Wire the DAT-direct routes, or don't.
 *
 * HISTORY. setupDirectDATLoads() existed for months and was never called, so
 * GET /api/dat-loads-direct returned the SPA's HTML while three client surfaces queried it
 * (dat-loads-display.tsx, google-sheets-import.tsx, manual-load-entry.tsx). Registering it is not
 * a one-line fix: it converts dead code into live code, which is precisely the shape of PR #62 —
 * a no-op turned live that processed a backlog and fired 1,000+ SMS before it was killed.
 *
 * TWO FLAGS, BOTH DEFAULT OFF, because the six routes are not one decision:
 *
 *   DAT_DIRECT_ENABLED       — GET /api/dat-loads-direct and GET /api/dat/scraper-status.
 *                              Read-only. Serves an in-memory array, empty until a scrape fills
 *                              it, so switching this on alone changes a 404 into an empty list.
 *
 *   DAT_DIRECT_LOGIN_ENABLED — the four routes that drive datLoginMonitor → Puppeteer → a real
 *                              DAT session with real credentials. Requires the base flag as well.
 *                              This one launches a browser on the production host; treat turning
 *                              it on as a deliberate act, not a config tidy-up.
 *
 *   DAT_DIRECT_DISABLED      — kill switch, beats both.
 *
 * EVERY route is role-guarded regardless of flag. They were written with no auth at all, and
 * /api/dat/* has no prefix guard in routes.ts, so registering them as-found would have exposed
 * "launch Puppeteer and log into DAT as us" to anyone on the internet, unauthenticated.
 */
export function registerDirectDATLoads(app: Express): void {
  if (!isDatDirectEnabled()) {
    console.log('[dat-direct] disabled (set DAT_DIRECT_ENABLED=true to register)');
    return;
  }
  const withLogin = isDatDirectLoginEnabled();
  setupDirectDATLoads(app, requireRole('admin', 'dispatcher'), withLogin);
  console.log(
    `[dat-direct] registered: read routes ON, login/Puppeteer routes ${withLogin ? 'ON' : 'off'}`,
  );
}
