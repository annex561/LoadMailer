/**
 * Regression test: notifyAdminReviewNeeded must send a throttled digest SMS
 * to DISPATCHER_PHONE_NUMBER only, guarded by RATECON_REVIEW_DIGEST_ENABLED.
 *
 * Root cause: the original implementation was a no-op export. Every parse
 * called it; nothing ever sent. The review queue silently backed up to 57
 * rows with zero alert. See docs/FIX-LEDGER.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const sendSMS = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("../db", () => ({ db: { execute } }));
vi.mock("../sms-service", () => ({ smsLoadService: { sendSMS } }));

const IN_REVIEW_ROWS = [
  { id: "a1", parsedJson: { broker: { value: "TQL" }, loadNumber: { value: "TQL-001" }, pickup: { date: "2026-10-22" } } },
  { id: "a2", parsedJson: { broker: { value: "Echo" }, loadNumber: { value: "ECH-002" }, pickup: { date: "2026-10-23" } } },
];

async function freshModule() {
  vi.resetModules();
  const mod = await import("../ratecon-admin-alerts");
  mod._resetDigestThrottleForTests();
  return mod;
}

describe("notifyAdminReviewNeeded", () => {
  const origPhone = process.env.DISPATCHER_PHONE_NUMBER;
  const origFlag = process.env.RATECON_REVIEW_DIGEST_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISPATCHER_PHONE_NUMBER = "+12055550001";
    process.env.RATECON_REVIEW_DIGEST_ENABLED = "true";
  });

  afterEach(() => {
    if (origPhone === undefined) delete process.env.DISPATCHER_PHONE_NUMBER;
    else process.env.DISPATCHER_PHONE_NUMBER = origPhone;
    if (origFlag === undefined) delete process.env.RATECON_REVIEW_DIGEST_ENABLED;
    else process.env.RATECON_REVIEW_DIGEST_ENABLED = origFlag;
  });

  it("sends SMS to DISPATCHER_PHONE_NUMBER when flag is on and queue is non-empty", async () => {
    execute.mockResolvedValueOnce({ rows: [{ cnt: 2 }] }).mockResolvedValueOnce({ rows: IN_REVIEW_ROWS });
    const { notifyAdminReviewNeeded } = await freshModule();
    await notifyAdminReviewNeeded({ companyId: "co-1", intakeId: "i-1", broker: "TQL", reason: "test" });
    expect(sendSMS).toHaveBeenCalledTimes(1);
    expect(sendSMS.mock.calls[0][0]).toBe("+12055550001");
    const body: string = sendSMS.mock.calls[0][1];
    expect(body).toMatch(/ratecon/i);
    expect(body).toMatch(/review/i);
  });

  it("throttles to once per 6 hours — second call within window is skipped", async () => {
    execute.mockResolvedValue({ rows: [{ cnt: 1 }] });
    const { notifyAdminReviewNeeded } = await freshModule();
    const params = { companyId: "co-1", intakeId: "i-1", broker: "TQL", reason: "test" };
    await notifyAdminReviewNeeded(params);
    await notifyAdminReviewNeeded(params);
    expect(sendSMS).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when RATECON_REVIEW_DIGEST_ENABLED is not 'true'", async () => {
    process.env.RATECON_REVIEW_DIGEST_ENABLED = "false";
    const { notifyAdminReviewNeeded } = await freshModule();
    await notifyAdminReviewNeeded({ companyId: "co-1", intakeId: "i-1", broker: "TQL", reason: "test" });
    expect(sendSMS).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("warns and no-ops when DISPATCHER_PHONE_NUMBER is missing", async () => {
    delete process.env.DISPATCHER_PHONE_NUMBER;
    execute.mockResolvedValue({ rows: [{ cnt: 3 }] });
    const { notifyAdminReviewNeeded } = await freshModule();
    await notifyAdminReviewNeeded({ companyId: "co-1", intakeId: "i-1", broker: "TQL", reason: "test" });
    expect(sendSMS).not.toHaveBeenCalled();
  });

  it("sends no SMS when queue is empty (cnt=0)", async () => {
    execute.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });
    const { notifyAdminReviewNeeded } = await freshModule();
    await notifyAdminReviewNeeded({ companyId: "co-1", intakeId: "i-1", broker: "TQL", reason: "test" });
    expect(sendSMS).not.toHaveBeenCalled();
  });
});
