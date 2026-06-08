import { describe, it, expect } from "vitest";
import { buildInboundTwiml, buildAfterTwiml } from "../driver-line-service";

describe("buildInboundTwiml — no arbitrary dial (regression)", () => {
  it("when no driver matches, says 'not in service' and never dials", () => {
    const x = buildInboundTwiml(undefined, "+14045558821");
    expect(x).toContain("not in service");
    expect(x).not.toContain("<Dial");
  });
  it("when a driver matches, dials the DRIVER's cell (never the called number)", () => {
    const x = buildInboundTwiml({ phone: "+12058614115" }, "+14045558821");
    expect(x).toContain("<Dial");
    expect(x).toContain("+12058614115");          // driver's cell
    expect(x).toContain('callerId="+14045558821"'); // pass the real caller through
    expect(x).toContain("record-from-answer");
    expect(x).toContain("/api/twilio/voice/driver-inbound/after");
  });
});

describe("buildAfterTwiml — voicemail only on a missed call", () => {
  it("records voicemail on no-answer/busy/failed", () => {
    for (const s of ["no-answer", "busy", "failed"]) {
      expect(buildAfterTwiml(s)).toContain("<Record");
    }
  });
  it("just hangs up when the call completed (answered)", () => {
    const x = buildAfterTwiml("completed");
    expect(x).not.toContain("<Record");
    expect(x).toContain("<Hangup");
  });
});
