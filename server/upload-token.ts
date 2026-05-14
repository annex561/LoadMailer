/**
 * HMAC-signed upload tokens for the driver photo-upload page.
 *
 * Problem this solves: the legacy /u/<loadId> URL used the raw load UUID
 * as its only "auth." Anyone who learned or guessed a UUID could POST
 * photos to /api/loads/:id/photos. With a real broker portal coming, we
 * need cryptographically-bound, time-limited tokens.
 *
 * Token format:  base64url(loadId).base64url(expMs).base64url(hmac)
 *   - loadId  is the target load UUID
 *   - expMs   is a JS-epoch millisecond timestamp after which the token
 *             stops being accepted
 *   - hmac    is HMAC-SHA256 over `${loadId}.${expMs}` with the server
 *             secret (UPLOAD_TOKEN_SECRET env var)
 *
 * Tokens are stateless — no DB row needed. Revocation is implicit via
 * the expiry (default 14 days). To force-revoke a token early, rotate
 * UPLOAD_TOKEN_SECRET and every outstanding token becomes invalid.
 *
 * Backward compatibility: during rollout, both /u/<UUID> (legacy) and
 * /u/<token> (signed) URLs must work. The route uses parseUploadToken()
 * to detect which form was used; if it can't parse a token, it falls
 * back to treating the param as a raw load id. Once all live SMS links
 * have rolled over to signed tokens, set UPLOAD_TOKEN_REQUIRED=true to
 * reject legacy URLs.
 */

import crypto from "crypto";

const DEFAULT_TTL_DAYS = 14;

function getSecret(): string {
  // Falls back to a dev secret if not configured. We log loudly if the
  // env var is missing — production absolutely must set this.
  const s = process.env.UPLOAD_TOKEN_SECRET;
  if (!s || s.length < 16) {
    if (!getSecret._warned) {
      console.warn(
        "[upload-token] UPLOAD_TOKEN_SECRET is missing or too short; " +
          "using dev fallback. Set a 32+ char secret in production.",
      );
      getSecret._warned = true;
    }
    return "dev-upload-token-secret-do-not-use-in-prod";
  }
  return s;
}
(getSecret as any)._warned = false;

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(data: string): string {
  return b64url(crypto.createHmac("sha256", getSecret()).update(data).digest());
}

/**
 * Sign a new upload token for the given loadId. Default TTL is 14 days,
 * which covers a typical pickup-to-delivery window plus slack. Override
 * with `ttlMs` for short-lived single-use tokens (e.g. 24h after
 * delivery for late-uploading paperwork).
 */
export function signUploadToken(loadId: string, ttlMs?: number): string {
  if (!loadId) throw new Error("signUploadToken: loadId required");
  const ttl = ttlMs && ttlMs > 0 ? ttlMs : DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expMs = Date.now() + ttl;
  const payload = `${loadId}.${expMs}`;
  return `${b64url(loadId)}.${b64url(String(expMs))}.${hmac(payload)}`;
}

export type ParsedUploadToken =
  | { kind: "valid"; loadId: string; expMs: number }
  | { kind: "expired"; loadId: string; expMs: number }
  | { kind: "invalid"; reason: string };

/**
 * Verify a signed upload token. Returns a tagged-union result so the
 * caller can distinguish "expired" (driver needs a fresh link) from
 * "invalid" (tampering or wrong format).
 *
 * Constant-time HMAC compare to avoid timing oracles.
 */
export function verifyUploadToken(token: string): ParsedUploadToken {
  if (!token || typeof token !== "string") {
    return { kind: "invalid", reason: "empty token" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { kind: "invalid", reason: "wrong format" };
  }
  let loadId: string;
  let expMs: number;
  try {
    loadId = b64urlDecode(parts[0]).toString("utf8");
    expMs = Number(b64urlDecode(parts[1]).toString("utf8"));
  } catch (_) {
    return { kind: "invalid", reason: "base64 decode failed" };
  }
  if (!loadId || !Number.isFinite(expMs)) {
    return { kind: "invalid", reason: "payload missing fields" };
  }
  const expected = hmac(`${loadId}.${expMs}`);
  // Constant-time compare. crypto.timingSafeEqual requires equal-length
  // buffers, so we check length first.
  if (expected.length !== parts[2].length) {
    return { kind: "invalid", reason: "signature length mismatch" };
  }
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
  if (!ok) return { kind: "invalid", reason: "signature mismatch" };
  if (Date.now() > expMs) return { kind: "expired", loadId, expMs };
  return { kind: "valid", loadId, expMs };
}

/**
 * Best-effort detector: returns true if `s` looks like a signed token
 * (3 dot-separated base64url parts), false if it looks like a bare UUID.
 * Used by the /u/:param route to choose between the legacy and signed
 * code paths during rollout.
 */
export function looksLikeSignedToken(s: string): boolean {
  if (!s) return false;
  const parts = s.split(".");
  if (parts.length !== 3) return false;
  // base64url chars only — fast reject before we try a full decode.
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

/**
 * Whether legacy non-tokenized /u/<UUID> URLs should be rejected.
 * Defaults to FALSE (accept legacy) so SMS already-sent stay working.
 * Flip UPLOAD_TOKEN_REQUIRED=true once all in-flight SMS have rolled
 * over to signed-token URLs.
 */
export function isTokenRequired(): boolean {
  return process.env.UPLOAD_TOKEN_REQUIRED === "true";
}
