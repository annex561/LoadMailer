/**
 * Security regression guard: upload auth leftovers (2026-10-26).
 *
 * Closes Section 2 items 5 & 6 of CLAUDE-PACKET-DRIVER-DOC-UPLOAD-2026-10-25.md:
 *   5. getSecret() in upload-token.ts must FAIL CLOSED in production when
 *      UPLOAD_TOKEN_SECRET is missing or < 32 chars. No dev-key fallback in prod.
 *   6. POST /api/loads/:id/checkin must require a valid upload token (matching
 *      :id) or a staff session. No token + no session → 401.
 *
 * Pattern: source-level tripwires + isolated unit tests. No DB, no HTTP server,
 * no Twilio, no Stripe, no OpenAI calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── helpers ────────────────────────────────────────────────────────────────

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

/** Grab the source block starting at `marker` for the next `chars` characters. */
function block(src: string, marker: string, chars = 2000): string {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found: ${marker}`);
  return src.slice(start, start + chars);
}

// ─── Item 5: getSecret() fail-closed in production ──────────────────────────

describe("upload-token: getSecret() fails closed in production", () => {
  // We import fresh module instances by resetting the module registry between
  // each test so NODE_ENV and UPLOAD_TOKEN_SECRET changes take effect.

  let savedEnv: string | undefined;
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
    savedSecret = process.env.UPLOAD_TOKEN_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
    if (savedSecret === undefined) delete process.env.UPLOAD_TOKEN_SECRET;
    else process.env.UPLOAD_TOKEN_SECRET = savedSecret;
    vi.resetModules();
  });

  it("throws when NODE_ENV=production and UPLOAD_TOKEN_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.UPLOAD_TOKEN_SECRET;
    const { signUploadToken } = await import("../upload-token");
    expect(() => signUploadToken("load-abc")).toThrow(/UPLOAD_TOKEN_SECRET/);
  });

  it("throws when NODE_ENV=production and UPLOAD_TOKEN_SECRET is < 32 chars", async () => {
    process.env.NODE_ENV = "production";
    process.env.UPLOAD_TOKEN_SECRET = "tooshort";
    const { signUploadToken } = await import("../upload-token");
    expect(() => signUploadToken("load-abc")).toThrow(/UPLOAD_TOKEN_SECRET/);
  });

  it("throws on verify too when NODE_ENV=production and secret is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.UPLOAD_TOKEN_SECRET;
    const { verifyUploadToken } = await import("../upload-token");
    // "anything" has no dots → exits before hmac(). Use a 3-part base64url
    // token so the code reaches hmac() where getSecret() is called.
    const b64u = (s: string) =>
      Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fakeToken = `${b64u("some-load")}.${b64u("9999999999999")}.fakesig`;
    expect(() => verifyUploadToken(fakeToken)).toThrow(/UPLOAD_TOKEN_SECRET/);
  });

  it("does NOT throw in development when secret is missing (dev fallback)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.UPLOAD_TOKEN_SECRET;
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const token = signUploadToken("load-abc");
    expect(token).toBeTypeOf("string");
    expect(verifyUploadToken(token).kind).toBe("valid");
  });

  it("does NOT throw in test when secret is missing (dev fallback)", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.UPLOAD_TOKEN_SECRET;
    const { signUploadToken } = await import("../upload-token");
    expect(() => signUploadToken("load-abc")).not.toThrow();
  });

  it("works normally in production when a 32+ char secret is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.UPLOAD_TOKEN_SECRET = "a-very-long-production-secret-key-value";
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const token = signUploadToken("load-abc");
    expect(verifyUploadToken(token).kind).toBe("valid");
  });

  // Source tripwire: confirm the throw lives in upload-token.ts so future
  // refactors can't quietly hollow it out.
  it("upload-token.ts source contains a production throw for missing secret", () => {
    const src = readFileSync(resolve(__dirname, "../upload-token.ts"), "utf8");
    expect(
      src,
      "upload-token.ts must throw (fail closed) when NODE_ENV=production " +
        "and UPLOAD_TOKEN_SECRET is absent or too short. " +
        "Falling back to the dev key in prod makes every token trivially forgeable.",
    ).toMatch(/NODE_ENV.*production[\s\S]{0,800}throw/);
  });
});

// ─── Item 6: POST /api/loads/:id/checkin auth gate ──────────────────────────

describe("POST /api/loads/:id/checkin auth gate (Section 2 item 6)", () => {
  // All tests are source-level — no HTTP server needed.

  it("checkin handler calls verifyUploadToken on x-upload-token header", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    expect(
      b.includes("verifyUploadToken"),
      "POST /api/loads/:id/checkin must call verifyUploadToken() on the " +
        "x-upload-token header so the driver-side upload page can check in " +
        "without a staff session.",
    ).toBe(true);
  });

  it("checkin handler checks that the token's loadId matches :id", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    expect(
      /v\.loadId.*req\.params\.id|req\.params\.id.*v\.loadId/.test(b),
      "POST /api/loads/:id/checkin must verify v.loadId === req.params.id " +
        "— a valid token for load A must not grant access to load B.",
    ).toBe(true);
  });

  it("checkin handler returns 401 when token is expired", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    expect(
      b.includes("410"),
      "POST /api/loads/:id/checkin must return 410 for an expired token " +
        "so the driver knows to request a fresh link from dispatch.",
    ).toBe(true);
  });

  it("checkin handler returns 401 for invalid token", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    // Must reject invalid tokens with 401
    expect(
      /kind.*invalid[\s\S]{0,100}401|401[\s\S]{0,100}kind.*invalid/.test(b),
      "POST /api/loads/:id/checkin must return 401 when the token is invalid.",
    ).toBe(true);
  });

  it("checkin handler returns 403 when token is for a different load", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    expect(
      b.includes("403"),
      "POST /api/loads/:id/checkin must return 403 when a valid token's " +
        "loadId doesn't match :id — prevents cross-load check-in with a recycled link.",
    ).toBe(true);
  });

  it("checkin handler falls back to isAuthenticated() for staff sessions", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    expect(
      /isAuthenticated/.test(b),
      "POST /api/loads/:id/checkin must accept authenticated staff sessions " +
        "as an alternative to the upload token so dispatchers can trigger check-ins " +
        "from the portal.",
    ).toBe(true);
  });

  it("checkin handler returns 401 when neither token nor session is present", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    // Must have a 401 branch that fires when neither token nor session passed
    const has401 = /isAuthenticated[\s\S]{0,300}401/.test(b);
    expect(
      has401,
      "POST /api/loads/:id/checkin must return 401 when there is no upload " +
        "token AND no staff session. Without this gate, any anonymous caller " +
        "can advance load state (at_pickup → loaded → unloaded) and bypass the " +
        "photo lifecycle check.",
    ).toBe(true);
  });

  it("checkin token check fires BEFORE the stage/DB logic", () => {
    const b = block(routesSrc, "app.post('/api/loads/:id/checkin'");
    const tokenIdx = b.indexOf("verifyUploadToken");
    const stageIdx = b.indexOf("at_pickup");
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(-1);
    expect(
      tokenIdx,
      "The verifyUploadToken() call in POST /api/loads/:id/checkin must appear " +
        "BEFORE the stage/fieldMap logic — auth must be checked first.",
    ).toBeLessThan(stageIdx);
  });
});

// ─── Unit test: token-gated checkin using signUploadToken ───────────────────

describe("checkin token gate — unit-level via signUploadToken", () => {
  const LOAD_ID = "test-load-uuid-checkin-001";
  const OTHER_LOAD = "other-load-uuid-002";

  beforeEach(() => {
    process.env.UPLOAD_TOKEN_SECRET = "test-secret-for-checkin-gate-32chars!!";
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.UPLOAD_TOKEN_SECRET;
    vi.resetModules();
  });

  it("a valid token for the correct load passes verifyUploadToken", async () => {
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const token = signUploadToken(LOAD_ID);
    const v = verifyUploadToken(token);
    expect(v.kind).toBe("valid");
    if (v.kind === "valid") expect(v.loadId).toBe(LOAD_ID);
  });

  it("a valid token for a DIFFERENT load fails the loadId check", async () => {
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const token = signUploadToken(OTHER_LOAD);
    const v = verifyUploadToken(token);
    // Token is valid by HMAC, but loadId won't match the target load
    expect(v.kind).toBe("valid");
    if (v.kind === "valid") {
      expect(v.loadId).not.toBe(LOAD_ID); // handler would return 403
    }
  });

  it("an expired token returns kind=expired (handler returns 410)", async () => {
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const realNow = Date.now;
    try {
      Date.now = () => realNow() - 60_000;
      const token = signUploadToken(LOAD_ID, 1_000);
      Date.now = realNow;
      const v = verifyUploadToken(token);
      expect(v.kind).toBe("expired");
    } finally {
      Date.now = realNow;
    }
  });

  it("a tampered token returns kind=invalid (handler returns 401)", async () => {
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const token = signUploadToken(LOAD_ID);
    const parts = token.split(".");
    const flipped = parts[2].slice(0, -1) + (parts[2].slice(-1) === "A" ? "B" : "A");
    const tampered = [parts[0], parts[1], flipped].join(".");
    expect(verifyUploadToken(tampered).kind).toBe("invalid");
  });
});
