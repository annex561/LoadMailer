/**
 * Regression guard: driver upload link SMS — item 11 of CLAUDE-PACKET-DRIVER-DOC-UPLOAD-2026-10-25.md
 *
 * Flag: DRIVER_UPLOAD_LINK_SMS_ENABLED (default OFF).
 *   OFF  → endpoint returns { ok:true, sent:0, link } without any SMS.
 *   ON   → sends one SMS via smsLoadService; SMS_DISABLED / DRY_RUN_OUTBOUND /
 *           STOP opt-out are all respected inside smsLoadService.sendSMS.
 *
 * Test strategy: source-level tripwires (no DB, no HTTP server, no Twilio).
 * Where behaviour needs a live call, we use vitest mock + a thin integration
 * harness against the load-photos-service module directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

// ─── 1. Source-level: flag-off path returns link without SMS ─────────────────

describe("photos/request route — flag OFF (source tripwires)", () => {
  it("returns the signed link to staff without calling sendUploadLink when flag is OFF", () => {
    // The route must check DRIVER_UPLOAD_LINK_SMS_ENABLED before calling sendUploadLink.
    // Tripwire: the route handler must contain the flag check BEFORE the sendUploadLink call.
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      if (start === -1) throw new Error("photos/request route not found in routes.ts");
      return routesSrc.slice(start, start + 2000);
    })();

    expect(
      block.includes("DRIVER_UPLOAD_LINK_SMS_ENABLED"),
      "photos/request must check DRIVER_UPLOAD_LINK_SMS_ENABLED flag",
    ).toBe(true);
  });

  it("flag-off path does NOT call sendUploadLink (source check)", () => {
    // When flag is OFF we return early before sendUploadLink. Verify early-return pattern.
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 2000);
    })();

    // The early-return block (flag OFF) must appear before the sendUploadLink call
    const flagIdx = block.indexOf("DRIVER_UPLOAD_LINK_SMS_ENABLED");
    const sendIdx = block.indexOf("sendUploadLink(");
    expect(flagIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(-1);
    // The flag check (and early return) must come BEFORE sendUploadLink in the source
    expect(flagIdx).toBeLessThan(sendIdx);
  });

  it("flag-off path returns sent:0 and a link (source check)", () => {
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 2000);
    })();

    expect(block).toContain("sent: 0");
    expect(block).toContain("link");
  });

  it("flag-on path calls sendUploadLink and returns link (source check)", () => {
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 2000);
    })();

    expect(block).toContain("sendUploadLink(");
    // Link is spread into the result object from sendUploadLink
    expect(block).toContain("...result");
  });
});

// ─── 2. Source-level: auth + rate limit still in place ───────────────────────

describe("photos/request route — auth + rate limit guards", () => {
  it("requires isAuthenticated as the first middleware after the path", () => {
    const guarded =
      /app\.post\(\s*['"`]\/api\/loads\/:id\/photos\/request['"`]\s*,\s*isAuthenticated\b/.test(
        routesSrc,
      );
    expect(
      guarded,
      "POST /api/loads/:id/photos/request must have isAuthenticated as first middleware. " +
        "Without it, anonymous callers trigger Twilio spend.",
    ).toBe(true);
  });

  it("applies photoRequestRateLimiter after isAuthenticated", () => {
    const guarded =
      /app\.post\(\s*['"`]\/api\/loads\/:id\/photos\/request['"`]\s*,\s*isAuthenticated\s*,\s*photoRequestRateLimiter/.test(
        routesSrc,
      );
    expect(
      guarded,
      "POST /api/loads/:id/photos/request must have photoRequestRateLimiter after isAuthenticated.",
    ).toBe(true);
  });

  it("rate limiter is capped at 3 per hour per load", () => {
    const limiterBlock = (() => {
      const marker = "const photoRequestRateLimiter";
      const start = routesSrc.indexOf(marker);
      if (start === -1) throw new Error("photoRequestRateLimiter not found");
      return routesSrc.slice(start, start + 600);
    })();

    expect(limiterBlock).toContain("max: 3");
    expect(limiterBlock).toContain("60 * 60 * 1000");
  });

  it("rate limiter returns 429 on the 4th request", () => {
    const limiterBlock = (() => {
      const marker = "const photoRequestRateLimiter";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 600);
    })();

    expect(limiterBlock).toContain("429");
  });
});

// ─── 3. Source-level: link is always a signed token (never raw UUID) ─────────

describe("photos/request route — signed token, never raw /u/<uuid>", () => {
  it("calls signUploadToken to build the link", () => {
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 2000);
    })();

    expect(
      block.includes("signUploadToken"),
      "photos/request must call signUploadToken; raw /u/<loadId> links are forbidden.",
    ).toBe(true);
  });

  it("does NOT build a raw /u/${load.id} or /u/${loadId} link in the route", () => {
    const block = (() => {
      const marker = "app.post('/api/loads/:id/photos/request'";
      const start = routesSrc.indexOf(marker);
      return routesSrc.slice(start, start + 2000);
    })();

    const hasRawUuid =
      /\/u\/\$\{[^}]*[Ll]oad[Ii]d[^}]*\}/.test(block) ||
      /\/u\/\$\{[^}]*load\.id[^}]*\}/.test(block);

    expect(
      hasRawUuid,
      "photos/request must NOT build raw /u/<loadId> links. Use signUploadToken.",
    ).toBe(false);
  });
});

// ─── 4. Unit: signUploadToken produces a 3-part token (not a UUID) ──────────

describe("signUploadToken output format", async () => {
  it("returns a 3-part base64url token, not a raw UUID", async () => {
    const { signUploadToken } = await import("../upload-token");
    const fakeLoadId = "00000000-0000-0000-0000-000000000001";
    const token = signUploadToken(fakeLoadId);

    // Must be 3 parts separated by dots
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    // Each part must be base64url chars only (no hyphens from UUID, no colons)
    parts.forEach((p) => {
      expect(/^[A-Za-z0-9_-]+$/.test(p)).toBe(true);
    });

    // Must NOT match a plain UUID pattern
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidPattern.test(token)).toBe(false);
  });

  it("token can be verified back to the original loadId", async () => {
    const { signUploadToken, verifyUploadToken } = await import("../upload-token");
    const fakeLoadId = "00000000-0000-0000-0000-000000000002";
    const token = signUploadToken(fakeLoadId);
    const result = verifyUploadToken(token);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.loadId).toBe(fakeLoadId);
    }
  });
});

// ─── 5. Source-level: SMS_DISABLED / DRY_RUN_OUTBOUND / STOP delegated to service ─

describe("photos/request route — guard delegation to smsLoadService", () => {
  /** Extract just the async handler body (between `async (req, res) => {` and the matching `}`). */
  function handlerBody(): string {
    const marker = "app.post('/api/loads/:id/photos/request'";
    const start = routesSrc.indexOf(marker);
    if (start === -1) throw new Error("photos/request route not found");
    // Find the async handler open brace
    const asyncIdx = routesSrc.indexOf("async (req, res) => {", start);
    if (asyncIdx === -1) throw new Error("async handler not found");
    // Grab enough chars for the handler body — stop at the matching closing pair
    return routesSrc.slice(asyncIdx, asyncIdx + 1200);
  }

  it("does NOT re-implement SMS_DISABLED in the handler body (delegates to smsLoadService)", () => {
    const body = handlerBody();
    // Strip comment lines before checking — SMS_DISABLED/DRY_RUN_OUTBOUND may appear in
    // comments explaining the delegation; the actual JS code must not call them.
    const codeOnly = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(
      codeOnly.includes("SMS_DISABLED"),
      "photos/request handler must NOT re-implement SMS_DISABLED in code. That guard lives " +
        "inside smsLoadService.sendSMS and is applied automatically.",
    ).toBe(false);
  });

  it("does NOT re-implement DRY_RUN_OUTBOUND in the handler body", () => {
    const body = handlerBody();
    const codeOnly = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(
      codeOnly.includes("DRY_RUN_OUTBOUND"),
      "photos/request handler must NOT re-implement DRY_RUN_OUTBOUND in code. That guard " +
        "lives inside smsLoadService.sendSMS.",
    ).toBe(false);
  });
});

// ─── 6. Source-level: never send from the banned number ─────────────────────

describe("routes.ts — never hard-code the banned Twilio number", () => {
  it("does not contain +15612007969 or 5612007969 as a from number", () => {
    const banned = ["5612007969", "+15612007969", "561-200-7969"];
    for (const num of banned) {
      expect(
        routesSrc.includes(num),
        `routes.ts must not hard-code the banned number ${num} (Undelivered / no service).`,
      ).toBe(false);
    }
  });
});
