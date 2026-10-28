/**
 * Tests for dry-run mode (DRY_RUN_OUTBOUND=true).
 *
 * Two layers:
 *   1. Behavioral tests for the dry-run helper itself
 *   2. Source-text pins on each vendor wrapper that uses the gate
 *
 * The pins are the load-bearing safety guarantee: if a future refactor
 * drops the gate from any vendor wrapper, the user could flip
 * DRY_RUN_OUTBOUND=true expecting no real outbound traffic and
 * accidentally burn real money. Pins catch the silent-removal class
 * of bug before it ships.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDryRunOutbound, logDryRun, dryRunFakeId } from "../dry-run";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("dry-run helper", () => {
  afterEach(() => {
    delete process.env.DRY_RUN_OUTBOUND;
  });

  it("isDryRunOutbound returns false when env var unset (production-safe default)", () => {
    delete process.env.DRY_RUN_OUTBOUND;
    expect(isDryRunOutbound()).toBe(false);
  });

  it("isDryRunOutbound returns true only on the literal string 'true' (case-sensitive)", () => {
    process.env.DRY_RUN_OUTBOUND = "true";
    expect(isDryRunOutbound()).toBe(true);
    process.env.DRY_RUN_OUTBOUND = "TRUE";
    expect(isDryRunOutbound()).toBe(false); // strict match — protects against accidental enablement via "True", "1", etc.
    process.env.DRY_RUN_OUTBOUND = "false";
    expect(isDryRunOutbound()).toBe(false);
    process.env.DRY_RUN_OUTBOUND = "";
    expect(isDryRunOutbound()).toBe(false);
  });

  it("dryRunFakeId returns a recognizable string with the vendor prefix", () => {
    const id = dryRunFakeId("twilio");
    expect(id).toMatch(/^dry-twilio-\d+-[a-z0-9]{6}$/);
  });

  it("logDryRun writes a [DRY-RUN] prefix line (greppable in Railway logs)", () => {
    const out: string[] = [];
    const orig = console.log;
    console.log = (...args: any[]) => out.push(args.join(" "));
    try {
      logDryRun({ vendor: "twilio", action: "sendSMS", payload: { to: "+15551234567" } });
    } finally {
      console.log = orig;
    }
    expect(out.join("\n")).toContain("[DRY-RUN] twilio.sendSMS");
    expect(out.join("\n")).toContain("+15551234567");
  });
});

describe("dry-run gates (source pins on each vendor wrapper)", () => {
  it("sms-service.ts Twilio sendSMS gates on isDryRunOutbound() BEFORE the Twilio API call", () => {
    const src = read("sms-service.ts");
    // The gate must be present.
    expect(src).toContain("isDryRunOutbound()");
    // And must come BEFORE the Twilio client send (or the gate is decorative).
    const gateIdx = src.indexOf("if (isDryRunOutbound())");
    const sendIdx = src.indexOf("this.twilioClient.messages.create");
    expect(gateIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(sendIdx);
  });

  it("telnyx-service.ts sendTelnyxSms gates on isDryRunOutbound() BEFORE the fetch to api.telnyx.com", () => {
    const src = read("telnyx-service.ts");
    expect(src).toContain("isDryRunOutbound()");
    const gateIdx = src.indexOf("if (isDryRunOutbound())");
    const fetchIdx = src.indexOf("fetch(TELNYX_API_URL");
    expect(gateIdx).toBeGreaterThan(0);
    expect(fetchIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(fetchIdx);
  });

  it("factoring-bol-address-verify.ts extractBolAddresses gates BEFORE the OpenAI call", () => {
    const src = read("factoring-bol-address-verify.ts");
    expect(src).toContain("isDryRunOutbound()");
    const gateIdx = src.indexOf("if (isDryRunOutbound())");
    // The OpenAI call site (openai.chat.completions.create wrapped in a Promise).
    const openaiIdx = src.indexOf("openai.chat.completions.create");
    expect(gateIdx).toBeGreaterThan(0);
    expect(openaiIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(openaiIdx);
  });

  it("factoring-bol-verify.ts verifyBolPhoto gates BEFORE the OpenAI call", () => {
    const src = read("factoring-bol-verify.ts");
    expect(src).toContain("isDryRunOutbound()");
    const gateIdx = src.indexOf("if (isDryRunOutbound())");
    const openaiIdx = src.indexOf("openai.chat.completions.create");
    expect(gateIdx).toBeGreaterThan(0);
    expect(openaiIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(openaiIdx);
  });

  it("factoring-loves.ts submitToLoves gates BEFORE the Resend send to Love's", () => {
    // #111 swapped nodemailer (factoringMailer.sendMail) for sendViaResend().
    // Anchor on the send whose recipient is Love's, not the first send in the
    // file: the FACTORING_TEST_TO_EMAIL branch sends earlier (see todo below).
    const src = read("factoring-loves.ts");
    expect(src).toContain("isDryRunOutbound()");
    const gateIdx = src.indexOf("if (isDryRunOutbound())");
    // Each sendViaResend({ ... }) call site, with its argument object.
    const sends = [...src.matchAll(/sendViaResend\(\{/g)].map((m) => ({
      idx: m.index!,
      args: src.slice(m.index!, src.indexOf("});", m.index!)),
    }));
    const lovesSends = sends.filter((c) => /to:\s*SCHEDULES_LS/.test(c.args));
    // Exactly one send path reaches Love's, and it sits behind the gate.
    expect(lovesSends).toHaveLength(1);
    expect(gateIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(lovesSends[0].idx);
  });

  // KNOWN GAP since #109 (d9227de): the FACTORING_TEST_TO_EMAIL branch sends a
  // real Resend email to the test inbox BEFORE this gate, so DRY_RUN_OUTBOUND
  // does not suppress it. Love's is never contacted. Changing send behaviour
  // is approval-gated; see docs/FIX-LEDGER.md "DRY_RUN_OUTBOUND does not stop the FACTORING_TEST_TO_EMAIL send".
  it.todo("factoring-loves.ts DRY_RUN_OUTBOUND also suppresses the FACTORING_TEST_TO_EMAIL send");

  it("dry-run gates return success-shaped responses (so chain continues, doesn't halt)", () => {
    // SMS gates return success:true messageSid:dry-...
    const smsSrc = read("sms-service.ts");
    expect(smsSrc).toMatch(/return\s+\{\s*success:\s*true,\s*messageSid:\s*dryRunFakeId\(/);
    const telnyxSrc = read("telnyx-service.ts");
    expect(telnyxSrc).toMatch(/return\s+\{\s*success:\s*true,\s*messageSid:\s*dryRunFakeId\(/);
    // Love's gate returns ok:true with emailMessageId so the chain
    // proceeds (factoringStatus updates, queue UI reflects sent).
    const lovesSrc = read("factoring-loves.ts");
    expect(lovesSrc).toContain("emailMessageId: fakeMessageId");
  });
});
