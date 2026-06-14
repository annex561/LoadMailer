/**
 * Regression guard: the in-portal dialer uses the dial-out BRIDGE, not WebRTC.
 *
 * History: the dialer first shipped on the Twilio Voice JS SDK (WebRTC softphone).
 * Two CDN/iOS bugs followed — the SDK <script> 403'd from sdk.twilio.com, and once
 * that was fixed, iOS Safari rejected the SDK's mic acquisition with
 * AcquisitionFailedError (31402). We abandoned WebRTC for a server-originated
 * dial-out bridge: tapping Call POSTs `/driver/:token/bridge-call`, the server rings
 * the driver's own cell from the 833 line and Twilio bridges to the destination
 * (recorded). No browser mic, no SDK — works on every phone.
 *
 * Source-level tripwire: the dialer markup must NOT reload any Twilio Voice WebRTC
 * SDK (which is what broke iOS), and MUST call the bridge endpoint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../driver-portal.ts"), "utf8");

describe("portal dialer uses the dial-out bridge (no WebRTC)", () => {
  it("does not load any Twilio Voice WebRTC SDK", () => {
    expect(src).not.toMatch(/sdk\.twilio\.com\/js\/voice/);
    expect(src).not.toMatch(/@twilio\/voice-sdk/);
    expect(src).not.toMatch(/new Twilio\.Device/);
  });
  it("places calls via the server-side bridge endpoint", () => {
    expect(src).toMatch(/\/bridge-call/);
  });
});
