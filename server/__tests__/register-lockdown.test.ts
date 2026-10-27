/**
 * Security lockdown: POST /api/register must require admin auth or ADMIN_API_KEY.
 *
 * Why this exists: the endpoint creates dispatcher accounts with full load
 * access. Before this fix it was fully public — any unauthenticated caller
 * could POST credentials and immediately receive a logged-in session with
 * dispatcher-role access to the entire platform.
 *
 * Two layers:
 *   1. Behavioral tests of requireAdminOrApiKey middleware (unit, no DB)
 *   2. Source-level tripwire confirming the middleware is wired on the route
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireAdminOrApiKey } from "../auth";

// ── helpers ────────────────────────────────────────────────────────────────

function makeReq(opts: {
  authed?: boolean;
  role?: string;
  apiKey?: string;
}): Request {
  return {
    isAuthenticated: () => !!opts.authed,
    user: opts.authed ? { id: "u1", role: opts.role ?? null } : undefined,
    headers: opts.apiKey ? { "x-admin-api-key": opts.apiKey } : {},
  } as unknown as Request;
}

function makeRes() {
  const res: Partial<Response> & { _status?: number; _body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = vi.fn((body: unknown) => {
    res._body = body;
    return res as Response;
  }) as unknown as Response["json"];
  return res as Response & { _status?: number; _body?: any };
}

// ── behavioral tests ────────────────────────────────────────────────────────

describe("requireAdminOrApiKey middleware", () => {
  const next = vi.fn() as unknown as NextFunction;

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_API_KEY;
  });

  it("rejects an unauthenticated request with 401", () => {
    const req = makeReq({ authed: false });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong API key with 401", () => {
    process.env.ADMIN_API_KEY = "correct-secret";
    const req = makeReq({ authed: false, apiKey: "wrong-secret" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when ADMIN_API_KEY is unset and no admin session (fail-closed)", () => {
    // ADMIN_API_KEY not set
    const req = makeReq({ authed: false, apiKey: "any-key" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a dispatcher session (non-admin role) even with a valid key", () => {
    process.env.ADMIN_API_KEY = "my-secret";
    // Has a session but as dispatcher, and does NOT include the header
    const req = makeReq({ authed: true, role: "dispatcher" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a valid admin session (no key header needed)", () => {
    const req = makeReq({ authed: true, role: "admin" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows a request with the correct ADMIN_API_KEY header", () => {
    process.env.ADMIN_API_KEY = "correct-secret";
    const req = makeReq({ authed: false, apiKey: "correct-secret" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects when ADMIN_API_KEY is still the placeholder value", () => {
    process.env.ADMIN_API_KEY = "replace-with-random-string";
    const req = makeReq({ authed: false, apiKey: "replace-with-random-string" });
    const res = makeRes();

    requireAdminOrApiKey(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── source-level tripwire ───────────────────────────────────────────────────

describe("POST /api/register is gated on requireAdminOrApiKey", () => {
  const authSrc = readFileSync(resolve(__dirname, "../auth.ts"), "utf8");

  it("requireAdminOrApiKey is wired as the first middleware on /api/register", () => {
    expect(
      /app\.post\(\s*['"`]\/api\/register['"`]\s*,\s*requireAdminOrApiKey\s*,/.test(authSrc),
      "POST /api/register in auth.ts must have requireAdminOrApiKey as its first middleware. " +
        "Without it, any unauthenticated caller can create dispatcher accounts with full load access.",
    ).toBe(true);
  });
});
