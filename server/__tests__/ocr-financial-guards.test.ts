/**
 * Source-text pin tests for the Phase 2 OCR financial guards.
 *
 * The user's CLAUDE.md ABSOLUTE RULE requires explicit safety guards on
 * every new outbound vendor call. OCR address verification calls OpenAI
 * vision (~$0.005/call) on every inbound MMS BOL photo. A silent
 * regression that removes the timeout, the kill switch, or the
 * per-driver cap could rack up real cost in a runaway loop.
 *
 * These are cheap CI tripwires — if the guard string disappears,
 * something has been silently weakened and the build fails loud.
 *
 * If a future refactor moves WHERE a guard lives, update the path and
 * the pinned string. Do NOT delete a guard without an explicit
 * replacement covered by a new test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Phase 2 OCR financial guards (source pins)", () => {
  it("factoring-bol-address-verify.ts has a hard timeout on the OpenAI call", () => {
    const src = read("factoring-bol-address-verify.ts");
    // The constant declares the cap.
    expect(src).toMatch(/const OPENAI_TIMEOUT_MS = \d+/);
    // The actual await uses Promise.race so the timeout fires even if
    // the OpenAI SDK ignores it. Without this, a hung connection would
    // hold the inbound webhook open and Twilio would retry → more cost.
    expect(src).toContain("Promise.race([openaiCall, timeoutPromise])");
  });

  it("factoring-bol-address-verify.ts is gated behind ADDRESS_VERIFY_ENABLED (default OFF)", () => {
    const src = read("factoring-bol-address-verify.ts");
    expect(src).toContain('process.env.ADDRESS_VERIFY_ENABLED === "true"');
    expect(src).toContain("export function isAddressVerifyEnabled");
  });

  it("factoring-bol-address-verify.ts requires OPENAI_API_KEY (no silent zero-key calls)", () => {
    const src = read("factoring-bol-address-verify.ts");
    expect(src).toContain('"OPENAI_API_KEY not set"');
  });

  it("mms-upload-service.ts enforces a per-driver hourly OCR cap", () => {
    const src = read("mms-upload-service.ts");
    expect(src).toContain("PER_DRIVER_OCR_PER_HOUR");
    expect(src).toContain("canRunOcrForDriver");
    expect(src).toContain("recordOcrAttempt");
    // The cap must be CONSULTED before the OpenAI call. If the call
    // happens unconditionally, the cap is decorative.
    expect(src).toMatch(/canRunOcrForDriver\(p\.phone\)/);
  });

  it("mms-upload-service.ts never throws OCR errors at the inbound webhook (caller falls back to ✅ reply)", () => {
    const src = read("mms-upload-service.ts");
    // The OCR step lives inside runOcrAddressCheckIfEnabled. Any failure
    // path must update ocrStatus and return — never throw. Pin the
    // error-path branches so a future refactor doesn't drop one.
    expect(src).toContain("ocrStatus: 'error'");
    expect(src).toContain("ocrStatus: 'disabled'");
    expect(src).toContain("ocrStatus: 'unreadable'");
  });

  it("mms-upload-service.ts OVERRIDE handler does NOT auto-approve for factoring (dispatcher review still required)", () => {
    const src = read("mms-upload-service.ts");
    // OVERRIDE only marks ocrStatus + override columns. It does NOT
    // touch approvalStatus. Phase 1's factoring gate requires
    // approvalStatus='approved' (dispatcher), so OVERRIDE alone never
    // ships a wrong BOL to Love's. Pin this — if a future "convenience"
    // refactor adds approvalStatus: 'approved' to the OVERRIDE update,
    // the wrong-load risk is back at full strength.
    // Split on the function definition line specifically so we get the
    // body, not the earlier reference inside processMMSReply.
    const parts = src.split("export async function handleOverrideReply");
    expect(parts.length).toBeGreaterThan(1);
    const overrideBlock = parts[1];
    expect(overrideBlock).toContain("ocrStatus: 'override'");
    expect(overrideBlock).not.toMatch(/approvalStatus:\s*['"]approved['"]/);
  });
});
