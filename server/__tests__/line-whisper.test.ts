import { describe, it, expect } from "vitest";
import { buildWhisperTwiml, buildInboundTwiml } from "../driver-line-service";

/**
 * Line-whisper feature: when an inbound company line forwards to a phone, the
 * ANSWERING party hears a one-word whisper (e.g. "Office" / "Direct") before
 * the caller is bridged in. Mechanism: <Dial><Number url="…"> plays the TwiML
 * from `url` to the called party on answer, before bridging. So the whisper is
 * a tiny endpoint returning <Say>label</Say>, pointed at by the Number's url.
 *
 * These assertions lock:
 *   1. buildWhisperTwiml returns a single <Response> with a <Say> of the label.
 *   2. buildInboundTwiml with a whisperLabel adds url=…/whisper?label=… to the
 *      <Number> while preserving the existing dial behavior.
 *   3. buildInboundTwiml without a whisperLabel is byte-for-byte the SP2
 *      behavior — no url= on the Number (back-compat).
 */

describe("buildWhisperTwiml", () => {
  it("returns a single <Response> with a <Say> of the label", () => {
    const x = buildWhisperTwiml("Office");
    expect(x).toContain("<Say");
    expect(x).toContain("Office");
    expect((x.match(/<Response>/g) || []).length).toBe(1);
    expect((x.match(/<\/Response>/g) || []).length).toBe(1);
  });

  it("XML-escapes the label so it can't break the TwiML", () => {
    const x = buildWhisperTwiml('Of"fice&<>');
    expect(x).not.toContain('Of"fice&<>');
    expect(x).toContain("&quot;");
    expect(x).toContain("&amp;");
    expect((x.match(/<Response>/g) || []).length).toBe(1);
  });
});

describe("buildInboundTwiml — whisper label", () => {
  it("with a whisperLabel, points the <Number> at the whisper endpoint (label URL-encoded) and still dials the driver", () => {
    const x = buildInboundTwiml({ phone: "+12058614115" }, "+14045558821", "Direct");
    expect(x).toContain("<Number");
    expect(x).toContain("url=");
    expect(x).toContain("/api/twilio/voice/whisper");
    expect(x).toContain("label=Direct"); // URL-encoded (Direct has no special chars)
    expect(x).toContain("+12058614115"); // still dials the driver's cell
    expect(x).toContain('record="record-from-answer"'); // still records
    expect((x.match(/<Response>/g) || []).length).toBe(1);
  });

  it("URL-encodes a label with spaces/special chars", () => {
    const x = buildInboundTwiml({ phone: "+12058614115" }, "+14045558821", "Main Office");
    expect(x).toContain("label=Main%20Office");
    expect(x).not.toContain("label=Main Office");
  });

  it("without a whisperLabel, the <Number> has NO url= (SP2 back-compat unchanged)", () => {
    const x = buildInboundTwiml({ phone: "+12058614115" }, "+14045558821");
    expect(x).toContain("<Number");
    expect(x).not.toContain("url=");
    expect(x).toContain("+12058614115");
    expect(x).toContain('record="record-from-answer"');
  });

  it("an empty/whitespace whisperLabel is treated as absent (no url=)", () => {
    expect(buildInboundTwiml({ phone: "+12058614115" }, "+14045558821", "")).not.toContain("url=");
    expect(buildInboundTwiml({ phone: "+12058614115" }, "+14045558821", "   ")).not.toContain("url=");
    expect(buildInboundTwiml({ phone: "+12058614115" }, "+14045558821", null)).not.toContain("url=");
  });
});
