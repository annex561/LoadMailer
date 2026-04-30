import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireRole } from "../auth";

/**
 * requireRole is a small middleware factory. We exercise it directly with
 * a fake req/res/next so these tests stay synchronous and DB-free.
 *
 * Behavior we care about (gated routes for Julio rollout):
 *   - unauthenticated request → 401
 *   - authenticated but role not in the allow-list → 403
 *   - authenticated AND role in allow-list → next() called, no status set
 */

function makeReq(opts: { authed: boolean; role?: string | null }): Request {
  return {
    isAuthenticated: () => opts.authed,
    user: opts.authed ? { id: "u1", role: opts.role ?? null } : undefined,
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

describe("requireRole", () => {
  it("returns 401 when the request is not authenticated", () => {
    const req = makeReq({ authed: false });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole("admin")(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body).toEqual({ message: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated but role is missing entirely", () => {
    const req = makeReq({ authed: true, role: null });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole("admin")(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body).toEqual({ message: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated role is not in the allow-list (Julio dispatcher hitting admin route)", () => {
    const req = makeReq({ authed: true, role: "dispatcher" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole("admin")(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when authenticated role matches a single allowed role", () => {
    const req = makeReq({ authed: true, role: "admin" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole("admin")(req, res, next);

    expect(res._status).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls next() when role matches one of several allowed roles", () => {
    const req = makeReq({ authed: true, role: "finance" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    // Doc approve/verify accepts both admin AND finance — make sure that compound case works.
    requireRole("admin", "finance")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects an unrelated role even when several roles are allowed", () => {
    const req = makeReq({ authed: true, role: "dispatcher" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireRole("admin", "finance")(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
