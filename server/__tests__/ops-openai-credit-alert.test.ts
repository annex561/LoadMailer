/**
 * Regression test: an OpenAI credit outage must reach the alert phone within a day.
 *
 * History: the parser-degraded check only heard from the old parser, so the
 * 2026-07-06 outage failed every RateCon parse for 3.5 months with no alert.
 * checkOpenAiCredits reads ratecon_intake instead. See docs/FIX-LEDGER.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const sendSMS = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("../db", () => ({ db: { execute } }));
vi.mock("../sms-service", () => ({ smsLoadService: { sendSMS } }));

const CREDIT_ROW = { parse_error: "429 You have no credits remaining. Add credits", created_at: "2026-10-24T19:00:00Z" };

async function freshMonitor() {
  vi.resetModules();
  return (await import("../ops-monitor-service")).opsMonitor;
}

describe("ops monitor: OpenAI credit alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPS_OPENAI_CREDIT_ALERT;
  });

  it("texts once per 24h while credit errors are newer than the last good parse", async () => {
    const m = await freshMonitor();
    execute.mockResolvedValue({ rows: [] });
    execute.mockResolvedValueOnce({ rows: [CREDIT_ROW] }).mockResolvedValueOnce({ rows: [{ last_ok: "2026-07-03T13:51:00Z" }] });
    await m.checkOpenAiCredits();
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS.mock.calls[0][1]).toMatch(/out of credits/);

    execute.mockResolvedValueOnce({ rows: [CREDIT_ROW] }).mockResolvedValueOnce({ rows: [{ last_ok: null }] });
    await m.checkOpenAiCredits();
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(m.getSnapshot().openaiCreditErrors24h).toBe(1);
  });

  it("stays quiet once a parse succeeds after the last credit error", async () => {
    const m = await freshMonitor();
    execute.mockResolvedValueOnce({ rows: [CREDIT_ROW] }).mockResolvedValueOnce({ rows: [{ last_ok: "2026-10-24T20:00:00Z" }] });
    await m.checkOpenAiCredits();
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("ignores rate-limit 429s", async () => {
    const m = await freshMonitor();
    execute.mockResolvedValueOnce({ rows: [{ parse_error: "429 Rate limit reached. Please try again in 1s.", created_at: "2026-10-24T19:00:00Z" }] });
    await m.checkOpenAiCredits();
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("OPS_OPENAI_CREDIT_ALERT=off silences it", async () => {
    const m = await freshMonitor();
    process.env.OPS_OPENAI_CREDIT_ALERT = "off";
    execute.mockResolvedValue({ rows: [CREDIT_ROW] });
    await m.checkOpenAiCredits();
    expect(execute).not.toHaveBeenCalled();
    expect(sendSMS).not.toHaveBeenCalled();
  });
});
