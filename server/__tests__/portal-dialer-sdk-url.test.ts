/**
 * Regression guard: the in-portal dialer's Twilio Voice SDK <script> must load
 * from a reachable CDN. It originally pointed at
 * `https://sdk.twilio.com/js/voice/releases/<v>/twilio.min.js`, which returns
 * 403 AccessDenied (that bucket doesn't serve the Voice SDK) — so `Twilio.Device`
 * never loaded and the dialer couldn't place a call. Fixed to jsDelivr's
 * `@twilio/voice-sdk` build.
 *
 * Source-level tripwire: asserts the dialer markup does NOT reference the broken
 * sdk.twilio.com voice path and DOES load @twilio/voice-sdk from a CDN.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../driver-portal.ts"), "utf8");

describe("portal dialer Voice SDK CDN", () => {
  it("does not use the broken sdk.twilio.com voice path", () => {
    expect(src).not.toMatch(/sdk\.twilio\.com\/js\/voice/);
  });
  it("loads @twilio/voice-sdk from a reachable CDN", () => {
    expect(/@twilio\/voice-sdk@[\d.]+\/dist\/twilio(\.min)?\.js/.test(src)).toBe(true);
  });
});
