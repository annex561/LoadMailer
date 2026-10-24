/**
 * Regression: DRY_RUN_OUTBOUND=true must stop the FACTORING_TEST_TO_EMAIL send.
 *
 * History: #109 (d9227de) put the test-redirect branch at the top of
 * submitToLoves with its own send, ahead of the dry-run gate. With both env
 * vars set, Submit still sent a real Resend email to the test inbox, so
 * "DRY_RUN_OUTBOUND=true = zero outbound" was false. Love's was never
 * contacted. See docs/FIX-LEDGER.md.
 *
 * Behavioural, not a source pin: runs submitToLoves end to end with the DB,
 * PDF templates and fetch mocked, and counts calls to api.resend.com.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const rows: Record<string, any[]> = {
    loads: [
      {
        id: "load-1",
        loadNumber: "LD1",
        rate: 1500,
        rateconPath: "https://files.test/ratecon.pdf",
        brokerName: "Test Broker",
      },
    ],
    load_documents: [
      { id: "doc-1", fileUrl: "https://files.test/bol.pdf", documentType: "pickup_bol" },
    ],
  };
  const select = () => ({
    from: (table: any) => {
      const result = rows[getTableName(table)] ?? [];
      const q: any = {
        where: () => q,
        limit: () => q,
        then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
      };
      return q;
    },
  });
  const noWrites = () => {
    throw new Error("test-redirect path must not write to the DB");
  };
  return { db: { select, insert: noWrites, update: noWrites } };
});

vi.mock("../factoring-pdf-templates", () => ({
  LAMP: {
    legalName: "Lamp, PLLC",
    dba: "LAMP Logistics",
    clientCode: "LAMP01",
    phone: "(205) 861-4115",
    email: "dispatch@traqiq.app",
  },
  generateBillOfSale: async () => Buffer.from("%PDF-bill-of-sale"),
  generateInvoice: async () => Buffer.from("%PDF-invoice"),
  mergePacketPdfs: async () => new Uint8Array(Buffer.from("%PDF-merged")),
}));

const ENV_KEYS = [
  "DRY_RUN_OUTBOUND",
  "FACTORING_TEST_TO_EMAIL",
  "LOVES_FACTORING_ENABLED",
  "FACTORING_DISABLED",
  "RESEND_API_KEY",
] as const;

let resendCalls: any[];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.LOVES_FACTORING_ENABLED = "true";
  process.env.FACTORING_TEST_TO_EMAIL = "ops-test@example.com";
  process.env.RESEND_API_KEY = "re_test_key";
  resendCalls = [];
  vi.stubGlobal("fetch", async (url: string, init?: any) => {
    if (url.startsWith("https://api.resend.com")) {
      resendCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "real-resend-id" }), { status: 200 });
    }
    return new Response(Buffer.from("%PDF-file"), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("submitToLoves: FACTORING_TEST_TO_EMAIL under DRY_RUN_OUTBOUND", () => {
  it("DRY_RUN_OUTBOUND=true: no Resend call, success-shaped fake id, [DRY-RUN] log", async () => {
    process.env.DRY_RUN_OUTBOUND = "true";
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: any[]) => {
      logs.push(a.join(" "));
    });
    try {
      const { submitToLoves } = await import("../factoring-loves");
      const result = await submitToLoves("load-1", "tester");
      expect(resendCalls).toHaveLength(0);
      expect(result.ok).toBe(true);
      expect(result.emailMessageId).toMatch(/^dry-/);
      expect(logs.join("\n")).toContain("[DRY-RUN] loves-factoring.sendTestPacket");
      expect(logs.join("\n")).toContain("ops-test@example.com");
    } finally {
      spy.mockRestore();
    }
  });

  it("DRY_RUN_OUTBOUND unset: test redirect still sends one real email, to the test inbox only", async () => {
    const { submitToLoves } = await import("../factoring-loves");
    const result = await submitToLoves("load-1", "tester");
    expect(result).toMatchObject({ ok: true, emailMessageId: "real-resend-id" });
    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].to).toEqual(["ops-test@example.com"]);
    expect(JSON.stringify(resendCalls[0])).not.toMatch(/schedulesLS@loves\.com/i);
  });
});
