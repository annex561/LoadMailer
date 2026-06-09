/**
 * Regression guard: the Twilio VOICE webhook must return text/xml, NOT the
 * application/json that the global `/api` middleware (server/index.ts) forces
 * onto every res.send. A real driver test call FAILED in production with Twilio
 * error 12300 ("Invalid Content-Type") — the call dropped to "busy" and never
 * forwarded — because the handler used res.send. The fix routes TwiML through
 * `sendTwiml` (res.end), which the middleware does not monkeypatch.
 *
 * Source-level tripwire: asserts the inbound webhook sends TwiML via sendTwiml/
 * res.end and never hands a TwiML builder to res.send. Fails if a future edit
 * reintroduces the content-type bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../driver-line-routes.ts"), "utf8");

describe("driver inbound webhook returns text/xml (not JSON)", () => {
  it("defines a sendTwiml helper that sets text/xml and uses res.end", () => {
    const ok = /function sendTwiml\([\s\S]*?Content-Type["']\s*,\s*["']text\/xml["'][\s\S]*?res\.end\(/.test(src);
    expect(ok, "sendTwiml must set Content-Type text/xml and write via res.end (res.send is force-jsoned by the global /api middleware)").toBe(true);
  });

  it("sends inbound + after TwiML through sendTwiml, never bare res.send", () => {
    const calls = (src.match(/sendTwiml\(\s*res,/g) || []).length;
    expect(calls, "both the inbound and /after handlers must return TwiML via sendTwiml").toBeGreaterThanOrEqual(2);
    expect(src, "buildInboundTwiml output must not go through res.send (forces application/json → Twilio 12300)").not.toMatch(/res\.send\(\s*buildInboundTwiml/);
    expect(src).not.toMatch(/res\.send\(\s*buildAfterTwiml/);
  });
});
