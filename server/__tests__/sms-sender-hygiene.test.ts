/**
 * Regression guard: all outbound SMS in routes.ts and ga-loads-router.ts must
 * route through messagingServiceSid or the twilioMsgParams helper.
 * No bare `from: twilioPhoneNumber` is allowed at send sites.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
const gaRouterSrc = readFileSync(resolve(__dirname, "../ga-loads-router.ts"), "utf8");

describe("Twilio sender hygiene", () => {
  it("routes.ts has no bare `from: twilioPhoneNumber` at call sites", () => {
    // After the migration, the only occurrence of `from: twilioPhoneNumber`
    // should be inside the twilioMsgParams helper, not at message.create calls.
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
});
