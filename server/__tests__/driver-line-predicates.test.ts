import { describe, it, expect } from "vitest";
import { areaCodeOf, provisionDecision, isSpareNumber } from "../driver-line-service";

describe("areaCodeOf", () => {
  it("extracts the area code from a +1 E.164 number", () => {
    expect(areaCodeOf("+12058614115")).toBe("205");
  });
  it("returns null for malformed input", () => {
    expect(areaCodeOf("")).toBeNull();
    expect(areaCodeOf("12345")).toBeNull();
    expect(areaCodeOf(undefined as any)).toBeNull();
  });
});

describe("provisionDecision", () => {
  it("reuses when a spare exists", () => {
    expect(provisionDecision({ hasSpare: true, provisionEnabled: false })).toBe("reuse");
  });
  it("buys only when no spare AND enabled", () => {
    expect(provisionDecision({ hasSpare: false, provisionEnabled: true })).toBe("buy");
  });
  it("refuses to buy when disabled and no spare", () => {
    expect(provisionDecision({ hasSpare: false, provisionEnabled: false })).toBe("buy-disabled");
  });
});

describe("isSpareNumber (never grab an SMS/main/assigned number)", () => {
  const ctx = {
    mainNumber: "+16605572729",
    assignedVoiceNumbers: new Set(["+12055550142"]),
    ourWebhookUrl: "https://traqiq.app/api/twilio/voice/driver-inbound",
    messagingPoolNumbers: new Set<string>(),
  };
  it("rejects the main SMS number", () => {
    expect(isSpareNumber({ phoneNumber: "+16605572729", smsUrl: "", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects a number with an active (non-demo) sms_url", () => {
    expect(isSpareNumber({ phoneNumber: "+14235295051", smsUrl: "https://traqiq.app/api/sms/webhook", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects an already-assigned driver number", () => {
    expect(isSpareNumber({ phoneNumber: "+12055550142", smsUrl: "", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects a number whose voice_url points elsewhere (e.g. the SP1 main line flow)", () => {
    expect(isSpareNumber({ phoneNumber: "+18333629813", smsUrl: "", voiceUrl: "https://webhooks.twilio.com/v1/Accounts/AC/Flows/FW" }, ctx)).toBe(false);
  });
  it("accepts a genuinely idle number (no sms, demo/empty voice)", () => {
    expect(isSpareNumber({ phoneNumber: "+19045550001", smsUrl: "https://demo.twilio.com/welcome/sms/reply/", voiceUrl: "https://demo.twilio.com/welcome/voice/" }, ctx)).toBe(true);
  });
  it("C1: rejects a Messaging Service pool number even with empty smsUrl", () => {
    expect(isSpareNumber(
      { phoneNumber: "+15155550001", smsUrl: "", voiceUrl: "" },
      { mainNumber: "+16605572729", assignedVoiceNumbers: new Set<string>(), ourWebhookUrl: "https://traqiq.app/api/twilio/voice/driver-inbound", messagingPoolNumbers: new Set(["+15155550001"]) },
    )).toBe(false);
  });
  it("M3: treats our webhook with a trailing slash as ours (still spare)", () => {
    expect(isSpareNumber(
      { phoneNumber: "+19045550002", smsUrl: "", voiceUrl: "https://traqiq.app/api/twilio/voice/driver-inbound/" },
      ctx,
    )).toBe(true);
  });
});
