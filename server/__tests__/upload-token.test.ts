/**
 * Tests for the HMAC-signed upload token. Pinned to the predicate so
 * future refactors can't quietly weaken the auth.
 *
 * If these start failing because somebody changed the token format or
 * loosened verification, STOP and read upload-token.ts before editing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  signUploadToken,
  verifyUploadToken,
  looksLikeSignedToken,
  isTokenRequired,
} from "../upload-token";

beforeAll(() => {
  // Set a deterministic secret so signatures are reproducible across runs.
  process.env.UPLOAD_TOKEN_SECRET = "test-secret-must-be-at-least-sixteen-chars-long";
});

describe("upload-token", () => {
  describe("signUploadToken / verifyUploadToken happy path", () => {
    it("round-trips a valid token", () => {
      const token = signUploadToken("load-uuid-123");
      const v = verifyUploadToken(token);
      expect(v.kind).toBe("valid");
      if (v.kind === "valid") {
        expect(v.loadId).toBe("load-uuid-123");
        expect(v.expMs).toBeGreaterThan(Date.now());
      }
    });

    it("respects custom TTL", () => {
      const token = signUploadToken("load-uuid-123", 5_000);
      const v = verifyUploadToken(token);
      expect(v.kind).toBe("valid");
      if (v.kind === "valid") {
        expect(v.expMs - Date.now()).toBeLessThanOrEqual(5_000);
      }
    });

    it("throws on empty loadId", () => {
      expect(() => signUploadToken("")).toThrow();
    });
  });

  describe("verifyUploadToken — adversarial inputs", () => {
    it("rejects empty / null / undefined", () => {
      expect(verifyUploadToken("").kind).toBe("invalid");
      expect(verifyUploadToken(null as any).kind).toBe("invalid");
      expect(verifyUploadToken(undefined as any).kind).toBe("invalid");
    });

    it("rejects wrong-shape tokens (not 3 parts)", () => {
      expect(verifyUploadToken("abc").kind).toBe("invalid");
      expect(verifyUploadToken("abc.def").kind).toBe("invalid");
      expect(verifyUploadToken("a.b.c.d").kind).toBe("invalid");
    });

    it("rejects tampered loadId", () => {
      const good = signUploadToken("load-A");
      const parts = good.split(".");
      // Swap part[0] (loadId) for a different-but-same-length base64 string
      const tampered = ["bG9hZC1C", parts[1], parts[2]].join(".");
      expect(verifyUploadToken(tampered).kind).toBe("invalid");
    });

    it("rejects tampered expiry", () => {
      const good = signUploadToken("load-A");
      const parts = good.split(".");
      // Bump expiry far into the future — sig won't match.
      const farFuture = Buffer.from(String(Date.now() + 100 * 365 * 24 * 3600 * 1000))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const tampered = [parts[0], farFuture, parts[2]].join(".");
      expect(verifyUploadToken(tampered).kind).toBe("invalid");
    });

    it("rejects tampered signature", () => {
      const good = signUploadToken("load-A");
      const parts = good.split(".");
      const flipped = parts[2].slice(0, -1) + (parts[2].slice(-1) === "A" ? "B" : "A");
      const tampered = [parts[0], parts[1], flipped].join(".");
      expect(verifyUploadToken(tampered).kind).toBe("invalid");
    });

    it("returns expired (not invalid) when timestamp is past", () => {
      // Mint with negative TTL — token is already expired when issued.
      // (Cheat: pass a tiny TTL then sleep, or directly stub Date.now)
      const realNow = Date.now;
      try {
        Date.now = () => realNow() - 60_000; // 60s ago
        const token = signUploadToken("load-A", 1_000); // 1s TTL
        Date.now = realNow;
        const v = verifyUploadToken(token);
        expect(v.kind).toBe("expired");
        if (v.kind === "expired") expect(v.loadId).toBe("load-A");
      } finally {
        Date.now = realNow;
      }
    });
  });

  describe("looksLikeSignedToken", () => {
    it("returns true for a real signed token", () => {
      const token = signUploadToken("load-A");
      expect(looksLikeSignedToken(token)).toBe(true);
    });

    it("returns false for bare UUIDs", () => {
      expect(looksLikeSignedToken("77e480f5-8e4e-4152-ab17-f3509a74c608")).toBe(false);
    });

    it("returns false for nonsense input", () => {
      expect(looksLikeSignedToken("")).toBe(false);
      expect(looksLikeSignedToken("a.b")).toBe(false);
      expect(looksLikeSignedToken("a.b.c.d")).toBe(false);
    });
  });

  describe("isTokenRequired", () => {
    it("defaults to false (rollout-friendly)", () => {
      const saved = process.env.UPLOAD_TOKEN_REQUIRED;
      delete process.env.UPLOAD_TOKEN_REQUIRED;
      try {
        expect(isTokenRequired()).toBe(false);
      } finally {
        if (saved !== undefined) process.env.UPLOAD_TOKEN_REQUIRED = saved;
      }
    });

    it("returns true only when env is exactly 'true'", () => {
      const saved = process.env.UPLOAD_TOKEN_REQUIRED;
      try {
        process.env.UPLOAD_TOKEN_REQUIRED = "true";
        expect(isTokenRequired()).toBe(true);
        process.env.UPLOAD_TOKEN_REQUIRED = "1";
        expect(isTokenRequired()).toBe(false);
        process.env.UPLOAD_TOKEN_REQUIRED = "TRUE";
        expect(isTokenRequired()).toBe(false);
      } finally {
        if (saved === undefined) delete process.env.UPLOAD_TOKEN_REQUIRED;
        else process.env.UPLOAD_TOKEN_REQUIRED = saved;
      }
    });
  });
});
