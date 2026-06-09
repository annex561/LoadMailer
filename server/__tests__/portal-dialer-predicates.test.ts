import { describe, it, expect } from "vitest";
import { normalizeNanp, isDialableDestination, buildPortalOutboundTwiml, buildCalleeNoticeTwiml, rateCheck, isPollerOutboundSkip, mintVoiceToken } from "../portal-dialer-service";

describe("normalizeNanp / isDialableDestination", () => {
  it("normalizes 10-digit, 11-digit, and +1 forms", () => {
    expect(normalizeNanp("205-555-0148")).toBe("+12055550148");
    expect(normalizeNanp("12055550148")).toBe("+12055550148");
    expect(normalizeNanp("+1 (205) 555-0148")).toBe("+12055550148");
  });
  it("rejects short codes, premium, and non-NANP", () => {
    expect(normalizeNanp("411")).toBeNull();
    expect(normalizeNanp("+19005551234")).toBeNull();   // 900 premium
    expect(normalizeNanp("+449005551234")).toBeNull();  // non-NANP
    expect(normalizeNanp("")).toBeNull();
  });
  it("isDialableDestination mirrors normalizeNanp", () => {
    expect(isDialableDestination("205-555-0148")).toBe(true);
    expect(isDialableDestination("411")).toBe(false);
  });
});

describe("buildPortalOutboundTwiml", () => {
  it("always sets the company caller ID and records", () => {
    const x = buildPortalOutboundTwiml({ to: "+12055550148", callerId: "+18333629813", recordingCallbackUrl: "https://x/cb", noticeUrl: "https://x/notice" });
    expect(x).toContain('callerId="+18333629813"');
    expect(x).toContain('record="record-from-answer"');
    expect(x).toContain('recordingStatusCallback="https://x/cb"');
    expect(x).toContain('url="https://x/notice"');     // notice played to callee
    expect(x).toContain("+12055550148");
  });
  it("omits the callee notice when noticeUrl is absent", () => {
    const x = buildPortalOutboundTwiml({ to: "+12055550148", callerId: "+18333629813", recordingCallbackUrl: "https://x/cb" });
    expect(x).not.toContain("url=");
  });
  it("XML-escapes a raw & in the recording callback URL (avoids Twilio error 12300)", () => {
    const x = buildPortalOutboundTwiml({ to: "+12055550148", callerId: "+18333629813", recordingCallbackUrl: "https://x/cb?a=1&b=2" });
    expect(x).toContain("a=1&amp;b=2");
    expect(x).not.toContain("?a=1&b=2");
  });
});

describe("buildCalleeNoticeTwiml", () => {
  it("announces recording", () => {
    expect(buildCalleeNoticeTwiml()).toContain("recorded");
  });
});

describe("rateCheck (per-driver hourly ceiling)", () => {
  it("allows up to max within the last hour, then blocks", () => {
    const now = 1_000_000_000_000;
    let times: number[] = [];
    for (let i = 0; i < 20; i++) { const r = rateCheck(times, now, 20); expect(r.ok).toBe(true); times = r.next; }
    expect(rateCheck(times, now, 20).ok).toBe(false);
  });
  it("forgets calls older than an hour", () => {
    const now = 1_000_000_000_000;
    const old = [now - 3_600_001];
    expect(rateCheck(old, now, 1).ok).toBe(true);
  });
});

describe("isPollerOutboundSkip", () => {
  it("skips outbound only on the poller path (job.direction undefined)", () => {
    expect(isPollerOutboundSkip(undefined, "outbound-api")).toBe(true);
    expect(isPollerOutboundSkip(undefined, "outbound-dial")).toBe(true);
    expect(isPollerOutboundSkip(undefined, "inbound")).toBe(false);
    expect(isPollerOutboundSkip("outbound", "outbound-api")).toBe(false); // callback path proceeds
  });
  it("also skips when the poller value is null (null-safe sentinel)", () => {
    expect(isPollerOutboundSkip(null, "outbound-api")).toBe(true);
    expect(isPollerOutboundSkip(null, "inbound")).toBe(false);
  });
});

describe("mintVoiceToken", () => {
  it("mints a token with a server-set driver-<id> identity", () => {
    const prev = {
      sid: process.env.TWILIO_ACCOUNT_SID,
      key: process.env.TWILIO_API_KEY,
      secret: process.env.TWILIO_API_SECRET,
      app: process.env.TWILIO_TWIML_APP_SID,
    };
    process.env.TWILIO_ACCOUNT_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_API_KEY = "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    process.env.TWILIO_API_SECRET = "dummysecret";
    process.env.TWILIO_TWIML_APP_SID = "APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    try {
      const r = mintVoiceToken({ id: "abc123" });
      expect(r.identity).toBe("driver-abc123");
      expect(typeof r.token).toBe("string");
      expect(r.token.length).toBeGreaterThan(0);
    } finally {
      // Restore env so file isolation is tidy regardless of vitest per-file isolation.
      prev.sid === undefined ? delete process.env.TWILIO_ACCOUNT_SID : (process.env.TWILIO_ACCOUNT_SID = prev.sid);
      prev.key === undefined ? delete process.env.TWILIO_API_KEY : (process.env.TWILIO_API_KEY = prev.key);
      prev.secret === undefined ? delete process.env.TWILIO_API_SECRET : (process.env.TWILIO_API_SECRET = prev.secret);
      prev.app === undefined ? delete process.env.TWILIO_TWIML_APP_SID : (process.env.TWILIO_TWIML_APP_SID = prev.app);
    }
  });
});
