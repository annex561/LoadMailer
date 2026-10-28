/**
 * Regression guard: all outbound SMS in routes.ts and ga-loads-router.ts must
 * route through messagingServiceSid — no raw from-number fallback, no 7969.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const gaRouterSrc = readFileSync(resolve(__dirname, "../ga-loads-router.ts"), "utf8");

describe("Twilio sender hygiene", () => {
  it("routes.ts has no bare `from: twilioPhoneNumber` at call sites", () => {
    const bareFrom = /messages\.create\s*\(\s*\{[^}]*from\s*:\s*twilioPhoneNumber/s;
    expect(bareFrom.test(routesSrc)).toBe(false);
  });

  it("ga-loads-router.ts has no bare `from: twilioPhone` at create calls", () => {
    const bareFromGa = /messages\.create\s*\(\s*\{[^}]*from\s*:\s*twilioPhone\b/s;
    expect(bareFromGa.test(gaRouterSrc)).toBe(false);
  });

  it("routes.ts uses twilioMsgParams helper for message creation", () => {
    expect(routesSrc).toMatch(/twilioMsgParams\s*\(/);
  });

  // ---- New guards added for PR #155 fix ----

  it("twilioMsgParams throws (fail-closed) when TWILIO_MESSAGING_SERVICE_SID is unset", () => {
    // The helper must contain an early throw guarded by !twilioMessagingServiceSid
    expect(routesSrc).toMatch(/if\s*\(\s*!twilioMessagingServiceSid\s*\)\s*\{[^}]*throw/s);
  });

  it("twilioMsgParams has no from-number fallback path", () => {
    // The old `if (twilioPhoneNumber) return { ...base, from: twilioPhoneNumber }` must be gone
    expect(routesSrc).not.toMatch(/twilioPhoneNumber[^;]*from\s*:/);
  });

  it("ga-loads-router.ts book path sets messagingServiceSid on messages.create params", () => {
    // Accepts both `gaParams.messagingServiceSid =` and inline object literal `messagingServiceSid:`
    expect(gaRouterSrc).toMatch(/messagingServiceSid\s*[=:]/);
  });

  it("ga-loads-router.ts book path sets statusCallback on messages.create params", () => {
    // Accepts both `gaParams.statusCallback =` and inline object literal `statusCallback:`
    expect(gaRouterSrc).toMatch(/statusCallback\s*[=:]/);
  });

  it("ga-loads-router.ts has no from-number fallback at the book create site", () => {
    // The old `else gaParams.from = gaTwilioPhone` must be gone
    expect(gaRouterSrc).not.toMatch(/gaParams\.from\s*=/);
  });

  it("ga-loads-router.ts book path guards on gaMsgSid only (not gaTwilioPhone)", () => {
    // Must not reference gaTwilioPhone at all
    expect(gaRouterSrc).not.toMatch(/gaTwilioPhone/);
  });
});
