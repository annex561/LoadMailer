/**
 * Regression guard: outbound SMS must always have an explicit From field.
 *
 * Bug: when TWILIO_PHONE_NUMBER is unset and no TWILIO_MESSAGING_SERVICE_SID
 * is configured, the fallback branch set messageParams.from = '' (empty string),
 * which Twilio rejects with error 21212 (InvalidFrom). The call still hit the
 * Twilio API and consumed a billable attempt.
 *
 * Fix: fail closed — return { success: false, error: 'TWILIO_PHONE_NUMBER not configured' }
 * before calling this.twilioClient.messages.create.
 *
 * Source pin: ensures the guard is in sms-service.ts, not just documented here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const smsSrc = readFileSync(resolve(__dirname, "../sms-service.ts"), "utf8");

describe("sms-service.ts From field guard", () => {
  it("has an else-if branch for twilioPhoneNumber (not a bare else)", () => {
    // The original code was:
    //   } else { messageParams.from = this.twilioPhoneNumber }
    // which silently sends with from='' when TWILIO_PHONE_NUMBER is unset.
    // The fix is `else if (this.twilioPhoneNumber) { ... } else { ... reject ... }`.
    expect(smsSrc).toMatch(/else\s+if\s*\(\s*this\.twilioPhoneNumber\s*\)/);
  });

  it("has a fail-closed else branch that logs and returns an error without calling Twilio", () => {
    // Find the fallback else branch and confirm it contains no messages.create call.
    // We identify it as the block that contains 'TWILIO_PHONE_NUMBER not configured'.
    const notConfiguredIdx = smsSrc.indexOf("TWILIO_PHONE_NUMBER not configured");
    expect(
      notConfiguredIdx,
      "sms-service.ts must have a fail-closed branch that returns an error when TWILIO_PHONE_NUMBER is unset",
    ).toBeGreaterThan(0);

    // The guard must appear BEFORE this.twilioClient.messages.create
    const createIdx = smsSrc.indexOf("this.twilioClient.messages.create");
    expect(createIdx).toBeGreaterThan(0);
    expect(
      notConfiguredIdx,
      "The TWILIO_PHONE_NUMBER guard must come before the Twilio API call",
    ).toBeLessThan(createIdx);
  });

  it("fail-closed branch returns early (no SMS send on missing From)", () => {
    // The branch returns { success: false, error: 'TWILIO_PHONE_NUMBER not configured' }.
    // Check the whole source for this exact return pattern.
    expect(
      /return\s*\{\s*success\s*:\s*false.*TWILIO_PHONE_NUMBER not configured/.test(smsSrc),
      "The fail-closed branch must return { success:false, error:'TWILIO_PHONE_NUMBER not configured' }",
    ).toBe(true);
  });

  it("the messaging-service-sid branch still sets messagingServiceSid (not From)", () => {
    // Primary path must not regress.
    expect(smsSrc).toMatch(/messageParams\.messagingServiceSid\s*=\s*this\.twilioMessagingServiceSid/);
  });

  it("the phone-number branch sets from = this.twilioPhoneNumber (not a literal)", () => {
    // Must use the instance field, not a raw process.env lookup at send time.
    expect(smsSrc).toMatch(/messageParams\.from\s*=\s*this\.twilioPhoneNumber/);
  });
});
