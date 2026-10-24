/**
 * Regression tests for the 2026-07-06 to 2026-10-24 OpenAI credit outage.
 * See docs/FIX-LEDGER.md, "RateCon parses failing with OpenAI 429 for 3.5 months".
 *
 * - isOpenAiCreditError must catch both 429 texts OpenAI sent, and not a rate limit.
 * - parseIntake({ autoDispatch: false }) must never create a load or text a driver:
 *   the backfill re-parses RateCons for freight that moved weeks ago.
 * - the backfill helpers group, classify and recommend correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isOpenAiCreditError } from "../openai-errors";

const updates = vi.hoisted(() => [] as any[]);
const dispatch = vi.hoisted(() => ({
  dispatchFromIntake: vi.fn(async () => ({ ok: true, loadId: "L1" })),
  sendDispatchSms: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../db", () => {
  const rows = [{ id: "d1", name: "Bob Driver", companyId: null }];
  const from = () => Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
  return {
    db: {
      select: () => ({ from }),
      update: () => ({ set: (v: any) => ({ where: async () => updates.push(v) }) }),
      execute: async () => ({ rows: [] }),
    },
  };
});
vi.mock("../ratecon-confidence-parser", () => ({
  parseRatecon: async () => ({
    loadNumber: { value: "", confidence: 1 },
    broker: { value: "TQL", confidence: 1 },
    driverName: { value: "Bob Driver", confidence: 1 },
    model: "gpt-4o",
  }),
  extractPdfText: async () => "",
}));
vi.mock("../ratecon-validators", () => ({
  runValidators: () => ({ failures: [], passed: true }),
  summarizeFailures: () => "",
}));
vi.mock("../driver-name-matcher", () => ({ matchDriverByName: () => ({ driverId: "d1", confidence: 0.99 }) }));
vi.mock("../ratecon-dispatch-service", () => dispatch);

describe("isOpenAiCreditError", () => {
  it("matches both credit-outage messages", () => {
    expect(isOpenAiCreditError("429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings")).toBe(true);
    expect(isOpenAiCreditError("429 You exceeded your current quota, please check your plan and billing details.")).toBe(true);
  });
  it("ignores rate limits, other errors and empty values", () => {
    expect(isOpenAiCreditError("429 Rate limit reached for gpt-4o on tokens per min (TPM): Limit 30000. Please try again in 1.2s.")).toBe(false);
    expect(isOpenAiCreditError("500 credit card processor down")).toBe(false);
    expect(isOpenAiCreditError(null)).toBe(false);
  });
});

describe("parseIntake autoDispatch", () => {
  beforeEach(() => {
    updates.length = 0;
    vi.clearAllMocks();
  });

  it("autoDispatch:false stops a clean parse at in_review with no dispatch and no SMS", async () => {
    const { parseIntake } = await import("../ratecon-intake-service");
    const res = await parseIntake("i1", Buffer.from("%PDF"), { autoDispatch: false });

    expect(res.ok).toBe(true);
    expect(res.status).toBe("in_review");
    expect(dispatch.dispatchFromIntake).not.toHaveBeenCalled();
    expect(dispatch.sendDispatchSms).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: "in_review", parseError: null });
  });

  it("default still auto-dispatches a clean parse", async () => {
    const { parseIntake } = await import("../ratecon-intake-service");
    const res = await parseIntake("i1", Buffer.from("%PDF"));

    expect(res.status).toBe("parsed");
    expect(dispatch.dispatchFromIntake).toHaveBeenCalledWith("i1");
    expect(dispatch.sendDispatchSms).toHaveBeenCalledWith("L1");
  });
});

describe("credit backfill helpers", () => {
  it("groups rows per email attachment, oldest row kept", async () => {
    const { groupByAttachment } = await import("../../scripts/ratecon-credit-backfill");
    const row = (id: string, msg: string, file: string) =>
      ({ id, source_email_message_id: msg, source_filename: file, pdf_path: null, created_at: "", parse_error: null });
    const groups = groupByAttachment([row("1", "m1", "a.pdf"), row("2", "m2", "a.pdf"), row("3", "m1", "a.pdf"), row("4", "m1", "b.pdf")]);

    expect(groups.map((g) => [g.keep.id, g.dupes.map((d) => d.id)])).toEqual([
      ["1", ["3"]],
      ["2", []],
      ["4", []],
    ]);
  });

  it("classifies letter-spaced ratecons, agreements, BOLs and driver sheets", async () => {
    const { classify } = await import("../../scripts/ratecon-credit-backfill");
    expect(classify("AIS1_x.pdf", "S h i p p i n g I n s t r u c t i o n s & R a t e C o n f i r m")).toBe("ratecon");
    expect(classify("Stryker BCA - V1.pdf", "carrier shall honor each rate confirmation")).toBe("agreement");
    expect(classify("BOL-load9596697.pdf", "bill of lading")).toBe("bol");
    expect(classify("TQL-Driver-Sheet.pdf", "")).toBe("driver-sheet");
    expect(classify("Location Settings - Apple.pdf", "C h a n g i n g L o c a t i o n")).toBe("other");
  });

  it("recommends re-parse only for unique ratecons with no existing load", async () => {
    const { shouldReparse, refsIn } = await import("../../scripts/ratecon-credit-backfill");
    const base = { kind: "ratecon", existingLoad: "", matchesIntake: "", samePdfAs: "" };
    expect(shouldReparse(base)).toBe(true);
    expect(shouldReparse({ ...base, existingLoad: "38206919" })).toBe(false);
    expect(shouldReparse({ ...base, samePdfAs: "x" })).toBe(false);
    expect(shouldReparse({ ...base, kind: "agreement" })).toBe(false);
    expect(refsIn("TQL-38642227-RATECON-2026-10-05.pdf")).toContain("38642227");
  });
});
