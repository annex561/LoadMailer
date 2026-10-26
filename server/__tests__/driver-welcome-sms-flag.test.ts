/**
 * Regression guard: POST /api/drivers welcome SMS must be gated behind
 * DRIVER_WELCOME_SMS_ENABLED=true (default OFF).
 *
 * Why this exists: the driver-creation route auto-texts a portal link to
 * every new driver with a phone number. That SMS fires on every POST —
 * including during imports, tests, and batch back-fills — burning real
 * Twilio spend. The flag lets the operator keep the text enabled on prod
 * while staging/test environments stay silent.
 *
 * Two layers:
 *   1. Behavioral tests of sendDriverWelcomeSms() — mock the SMS sender,
 *      assert it is called or not depending on the flag.
 *   2. Source-level pin confirming routes.ts routes the welcome SMS through
 *      the gated helper (not a raw smsLoadService.sendSMS call).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sendDriverWelcomeSms, type SmsSender } from "../driver-welcome-sms";

// ── behavioral tests ────────────────────────────────────────────────────────

describe("sendDriverWelcomeSms flag gate", () => {
  afterEach(() => {
    delete process.env.DRIVER_WELCOME_SMS_ENABLED;
  });

  it("does NOT call sendSms when DRIVER_WELCOME_SMS_ENABLED is unset", async () => {
    delete process.env.DRIVER_WELCOME_SMS_ENABLED;
    const sendSms = vi.fn<SmsSender>().mockResolvedValue({ success: true });

    const sent = await sendDriverWelcomeSms("Alice", "+16155550001", "https://example.com/portal", sendSms);

    expect(sendSms).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });

  it("does NOT call sendSms when DRIVER_WELCOME_SMS_ENABLED is '1'", async () => {
    process.env.DRIVER_WELCOME_SMS_ENABLED = "1";
    const sendSms = vi.fn<SmsSender>().mockResolvedValue({ success: true });

    await sendDriverWelcomeSms("Alice", "+16155550001", "https://example.com/portal", sendSms);

    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does NOT call sendSms when DRIVER_WELCOME_SMS_ENABLED is 'false'", async () => {
    process.env.DRIVER_WELCOME_SMS_ENABLED = "false";
    const sendSms = vi.fn<SmsSender>().mockResolvedValue({ success: true });

    await sendDriverWelcomeSms("Alice", "+16155550001", "https://example.com/portal", sendSms);

    expect(sendSms).not.toHaveBeenCalled();
  });

  it("calls sendSms exactly once when DRIVER_WELCOME_SMS_ENABLED is 'true'", async () => {
    process.env.DRIVER_WELCOME_SMS_ENABLED = "true";
    const sendSms = vi.fn<SmsSender>().mockResolvedValue({ success: true });

    const sent = await sendDriverWelcomeSms("Bob", "+16155550002", "https://example.com/portal/bob", sendSms);

    expect(sendSms).toHaveBeenCalledOnce();
    expect(sent).toBe(true);
    const { to, body } = sendSms.mock.calls[0][0];
    expect(to).toBe("+16155550002");
    expect(body).toContain("Bob");
    expect(body).toContain("https://example.com/portal/bob");
  });

  it("skips the send when phone is null even if flag is true", async () => {
    process.env.DRIVER_WELCOME_SMS_ENABLED = "true";
    const sendSms = vi.fn<SmsSender>().mockResolvedValue({ success: true });

    const sent = await sendDriverWelcomeSms("NoPhone", null, "https://example.com/portal", sendSms);

    expect(sendSms).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });

  it("driver creation still succeeds (function returns false) when flag is off", async () => {
    delete process.env.DRIVER_WELCOME_SMS_ENABLED;
    const sendSms = vi.fn<SmsSender>();

    // No exception thrown — caller can treat false as "SMS skipped, driver created OK"
    await expect(
      sendDriverWelcomeSms("Charlie", "+16155550003", "https://example.com/portal", sendSms),
    ).resolves.toBe(false);
  });
});

// ── source-level tripwire ───────────────────────────────────────────────────

describe("POST /api/drivers routes welcome SMS through the gated helper", () => {
  const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

  it("imports sendDriverWelcomeSms from driver-welcome-sms", () => {
    expect(
      /from\s+['"`]\.\/driver-welcome-sms['"`]/.test(routesSrc),
      "routes.ts must import from ./driver-welcome-sms — the gate lives there.",
    ).toBe(true);
  });

  it("calls sendDriverWelcomeSms in the POST /api/drivers handler", () => {
    // Grab the handler body starting at the POST /api/drivers route
    const marker = 'app.post("/api/drivers"';
    const start = routesSrc.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const block = routesSrc.slice(start, start + 2000);

    expect(
      block.includes("sendDriverWelcomeSms("),
      "POST /api/drivers must call sendDriverWelcomeSms() — the DRIVER_WELCOME_SMS_ENABLED " +
        "gate lives inside that function. A raw smsLoadService.sendSMS() call in this handler " +
        "bypasses the flag and fires real Twilio spend on every driver creation.",
    ).toBe(true);
  });
});
