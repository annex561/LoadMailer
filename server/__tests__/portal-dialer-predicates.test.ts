import { describe, it, expect } from "vitest";
import { normalizeNanp, isDialableDestination, buildPortalOutboundTwiml, buildCalleeNoticeTwiml, rateCheck, isPollerOutboundSkip } from "../portal-dialer-service";

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
});
