/**
 * Regression test: a Gmail attachment that already has an intake row must not
 * be enqueued or parsed again.
 *
 * History: the scan query includes read mail (newer_than:2d) and the only dedup
 * was an in-memory 24h map that every deploy wiped. Each PDF was enqueued,
 * uploaded and sent to OpenAI 2-10 times; during the 2026-07-06 credit outage
 * that left 608 error rows for 233 attachments. See docs/FIX-LEDGER.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const intake = vi.hoisted(() => ({
  hasIntakeForEmailAttachment: vi.fn(),
  enqueueRatecon: vi.fn(async () => ({ id: "intake-1" })),
  parseIntake: vi.fn(async () => ({ ok: true, status: "in_review" })),
}));
vi.mock("../ratecon-intake-service", () => intake);
vi.mock("../db", () => ({ db: {} }));
vi.mock("../services/ratecon-parser", () => ({ rateconParser: {} }));
vi.mock("../ga-db", () => ({ default: {} }));
vi.mock("../ga-scoring", () => ({ scoreLoad: () => 0 }));

function fakeGmail(parts: any[], subject = "Rate Confirmation 123") {
  return {
    users: {
      messages: {
        get: vi.fn(async () => ({ data: { payload: { headers: [{ name: "Subject", value: subject }], parts } } })),
        attachments: { get: vi.fn(async () => ({ data: { data: Buffer.from("%PDF-1.4").toString("base64") } })) },
        batchModify: vi.fn(async () => ({})),
      },
    },
  };
}

describe("gmail processMessage: durable dedup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips an attachment that already has an intake row", async () => {
    const { gmailIngest } = await import("../services/gmail");
    vi.spyOn(gmailIngest, "resolveCompanyId").mockResolvedValue("c1");
    intake.hasIntakeForEmailAttachment.mockResolvedValue(true);
    const gmail = fakeGmail([{ filename: "RC 123.pdf", body: { attachmentId: "a1" } }]);

    await gmailIngest.processMessage(gmail, "msg-seen", "c1", true);

    expect(intake.hasIntakeForEmailAttachment).toHaveBeenCalledWith("msg-seen", "RC 123.pdf");
    expect(gmail.users.messages.attachments.get).not.toHaveBeenCalled();
    expect(intake.enqueueRatecon).not.toHaveBeenCalled();
    expect(intake.parseIntake).not.toHaveBeenCalled();
  });

  it("still enqueues and parses a new attachment once", async () => {
    const { gmailIngest } = await import("../services/gmail");
    vi.spyOn(gmailIngest, "resolveCompanyId").mockResolvedValue("c1");
    intake.hasIntakeForEmailAttachment.mockResolvedValue(false);
    const gmail = fakeGmail([{ filename: "RC 123.pdf", body: { attachmentId: "a1" } }]);

    await gmailIngest.processMessage(gmail, "msg-new", "c1", true);

    expect(intake.enqueueRatecon).toHaveBeenCalledTimes(1);
    expect(intake.parseIntake).toHaveBeenCalledTimes(1);
  });

  it("skips a TQL driver-sheet email that already has an intake row", async () => {
    const { gmailIngest } = await import("../services/gmail");
    intake.hasIntakeForEmailAttachment.mockResolvedValue(true);
    const gmail = fakeGmail([], "TQL PO# 1 | Driver/Carrier Information");

    await gmailIngest.processMessage(gmail, "msg-tql", "c1", true);

    expect(intake.hasIntakeForEmailAttachment).toHaveBeenCalledWith("msg-tql", "TQL-Driver-Sheet.pdf");
    expect(intake.enqueueRatecon).not.toHaveBeenCalled();
    expect(intake.parseIntake).not.toHaveBeenCalled();
  });
});
