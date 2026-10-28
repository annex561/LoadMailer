/**
 * Security regression guard: photo route auth lockdown (2026-10-26).
 *
 * Gaps closed (Section 2 items 1-4 of CLAUDE-PACKET-DRIVER-DOC-UPLOAD-2026-10-25.md):
 *   1. PATCH /api/loads/:id/photos/:photoId — no auth → anyone with a load UUID
 *      and photo id could set approvalStatus='approved', feeding docs straight into
 *      the Love's factoring packet.
 *   2. GET /api/loads/:id/photos — no auth → leaked Cloudinary BOL/POD URLs to
 *      any anonymous caller who knew a load UUID.
 *   3. POST /api/loads/:id/photos/request — no auth → anonymous callers could
 *      trigger Twilio SMS spend and spam drivers.
 *   4. Raw /u/${load.id} links in driver-portal.ts and geofence-cron.ts — replaced
 *      with signUploadToken() so links are cryptographically bound to the load.
 *
 * Pattern: source-level tripwires (file reads), same approach as
 * loads-drivers-auth.test.ts — no DB, no HTTP server, no Twilio calls.
 * One middleware per route, NOT app.use('/api/loads') prefix guard (spec §4).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const driverPortalSrc = readFileSync(resolve(__dirname, "../driver-portal.ts"), "utf8");
const geofenceSrc = readFileSync(resolve(__dirname, "../geofence-cron.ts"), "utf8");

// ─── Item 1: PATCH /api/loads/:id/photos/:photoId ────────────────────────────

describe("PATCH /api/loads/:id/photos/:photoId requires isAuthenticated", () => {
  it("is registered with isAuthenticated as its first middleware", () => {
    const guarded =
      /app\.patch\(\s*['"`]\/api\/loads\/:id\/photos\/:photoId['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      guarded,
      "PATCH /api/loads/:id/photos/:photoId must have isAuthenticated (or requireRole) " +
        "as its FIRST argument after the path. Without it, anyone with a load UUID and " +
        "photo id can set approvalStatus='approved' and route docs into the factoring packet.",
    ).toBe(true);
  });

  it("does NOT use an app.use('/api/loads') prefix guard (would lock driver token routes)", () => {
    // Per spec §4: one middleware per route, not a prefix guard, because a prefix guard
    // would also intercept /api/loads/:id/photos/sign and /photos/record which the driver
    // token page calls without a session.
    const prefixGuard = /app\.use\(\s*['"`]\/api\/loads['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
      routesSrc,
    );
    expect(
      prefixGuard,
      "Do NOT gate /api/loads via app.use() prefix guard — it would lock the driver-facing " +
        "token routes (/photos/sign, /photos/record, /photos/confirm, /checkin) that " +
        "authenticate by upload token, not session.",
    ).toBe(false);
  });
});

// ─── Item 2: GET /api/loads/:id/photos — staff session OR valid upload token ──

describe("GET /api/loads/:id/photos allows staff session or valid upload token", () => {
  /** Grab only the GET /api/loads/:id/photos handler body (up to the next app. call). */
  function getPhotosHandlerBlock(): string {
    const marker = "app.get('/api/loads/:id/photos'";
    const start = routesSrc.indexOf(marker);
    if (start === -1) throw new Error("Could not find GET /api/loads/:id/photos route");
    // Read forward ~800 chars — enough for the handler without spilling into the next route
    return routesSrc.slice(start, start + 800);
  }

  it("handler calls verifyUploadToken on ?token= query param", () => {
    const block = getPhotosHandlerBlock();
    expect(
      block.includes("verifyUploadToken"),
      "GET /api/loads/:id/photos must call verifyUploadToken when a ?token= param is present " +
        "so the driver-side upload page can list its own docs without a staff session.",
    ).toBe(true);
  });

  it("handler checks that the token's loadId matches :id", () => {
    const block = getPhotosHandlerBlock();
    // The handler must compare v.loadId (or similar) to req.params.id
    expect(
      /v\.loadId.*req\.params\.id|req\.params\.id.*v\.loadId/.test(block),
      "GET /api/loads/:id/photos must verify the token belongs to this specific load " +
        "(v.loadId !== req.params.id → 403), not just that it's a valid token.",
    ).toBe(true);
  });

  it("handler checks req.isAuthenticated() for staff session fallback", () => {
    const block = getPhotosHandlerBlock();
    expect(
      /isAuthenticated\(\)|req\.isAuthenticated/.test(block),
      "GET /api/loads/:id/photos must check req.isAuthenticated() so staff can view " +
        "photos without an upload token.",
    ).toBe(true);
  });

  it("handler returns 401 when neither token nor session is present", () => {
    const block = getPhotosHandlerBlock();
    expect(
      block.includes("401"),
      "GET /api/loads/:id/photos must return 401 when the caller has neither a valid " +
        "upload token nor a staff session.",
    ).toBe(true);
  });

  it("handler returns 410 for an expired token", () => {
    const block = getPhotosHandlerBlock();
    expect(
      block.includes("410"),
      "GET /api/loads/:id/photos must return 410 (not 401) for an expired token so the " +
        "driver knows to ask dispatch for a fresh link.",
    ).toBe(true);
  });
});

// ─── Item 3: POST /api/loads/:id/photos/request — isAuthenticated + rate limit ─

describe("POST /api/loads/:id/photos/request requires isAuthenticated + rate limit", () => {
  it("is registered with isAuthenticated as its first middleware", () => {
    const guarded =
      /app\.post\(\s*['"`]\/api\/loads\/:id\/photos\/request['"`]\s*,\s*(requireRole\(|isAuthenticated\b)/.test(
        routesSrc,
      );
    expect(
      guarded,
      "POST /api/loads/:id/photos/request must have isAuthenticated as its FIRST middleware. " +
        "Without it, any anonymous caller can trigger real Twilio SMS spend and spam drivers.",
    ).toBe(true);
  });

  it("has a rate limiter in the middleware chain after isAuthenticated", () => {
    // Grab only the photos/request route registration line
    const marker = "app.post('/api/loads/:id/photos/request'";
    const start = routesSrc.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    // The line should be isAuthenticated, <rateLimiter>, async handler
    const line = routesSrc.slice(start, start + 300);
    const hasLimiter = /isAuthenticated\b.*RateLimiter|isAuthenticated\b.*rateLimiter/.test(line);
    expect(
      hasLimiter,
      "POST photos/request must have a rate limiter after isAuthenticated to cap Twilio " +
        "spend even for authenticated staff — a dispatcher with an auto-clicker or a " +
        "script can still exhaust the budget without a ceiling.",
    ).toBe(true);
  });

  it("rate limiter keys by load id (not globally)", () => {
    // The keyGenerator for the photos/request limiter must reference params.id
    // so the limit is per-load, not shared across all loads.
    expect(
      routesSrc.includes("photo-request-"),
      "The photos/request rate limiter must key by load id (e.g. `photo-request-${req.params.id}`) " +
        "not globally. A global key would let one busy load exhaust the limit for all others.",
    ).toBe(true);
  });
});

// ─── Item 4: No raw /u/${loadId} link emitters ────────────────────────────────

describe("Raw /u/${loadId} upload links are banned from server/ sources", () => {
  it("driver-portal.ts does not emit /u/${load.id} (raw UUID)", () => {
    expect(
      driverPortalSrc,
      "driver-portal.ts must not emit raw /u/${load.id} links. " +
        "Use signUploadToken(load.id) so the URL is cryptographically bound to the load.",
    ).not.toMatch(/\/u\/\$\{load\.id\}/);
  });

  it("geofence-cron.ts does not emit /u/${load.id} (raw UUID)", () => {
    expect(
      geofenceSrc,
      "geofence-cron.ts must not emit raw /u/${load.id} links. " +
        "Use signUploadToken(load.id) so the URL is cryptographically bound to the load.",
    ).not.toMatch(/\/u\/\$\{load\.id\}/);
  });

  it("driver-portal.ts uses signUploadToken() for the upload button link", () => {
    expect(
      driverPortalSrc.includes("signUploadToken"),
      "driver-portal.ts must call signUploadToken(load.id) to build the /u/ link for the " +
        "'📷 Upload Photos / Check In' button. Raw UUID links are accepted only while " +
        "UPLOAD_TOKEN_REQUIRED=false; signing them now means we can flip that flag safely.",
    ).toBe(true);
  });

  it("geofence-cron.ts uses signUploadToken() for geofence SMS links", () => {
    expect(
      geofenceSrc.includes("signUploadToken"),
      "geofence-cron.ts must call signUploadToken(load.id) to build the /u/ links it SMSes " +
        "to drivers. Raw UUID links can be guessed from other publicly-visible UUIDs.",
    ).toBe(true);
  });

  it("no server/ source emits /u/${loadId} (raw local variable form)", () => {
    // Scan all .ts files in server/ for the raw loadId form too
    const { readdirSync, readFileSync: rfs } = require("node:fs");
    const { resolve: res, join } = require("node:path");
    const serverDir = res(__dirname, "..");
    const tsFiles = readdirSync(serverDir).filter(
      (f: string) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const rawPattern = /\/u\/\$\{loadId\}/;
    const hits: string[] = [];
    for (const f of tsFiles) {
      const src = rfs(join(serverDir, f), "utf8");
      if (rawPattern.test(src)) hits.push(f);
    }
    expect(
      hits,
      `These server/ files still emit raw /u/\${loadId} links: ${hits.join(", ")}. ` +
        "Replace with signUploadToken(loadId).",
    ).toHaveLength(0);
  });
});
