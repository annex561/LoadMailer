/**
 * Regression: the S14 factoring gates (14a-2 delivery+POD, 14a-3 signed BOL)
 * must accept a dispatcher-approved delivery doc in load_documents.
 *
 * History: the first cut of the gate read only loads.podPath / bolPath /
 * bolVerifiedAt. The live upload paths (/u/<loadId> page, MMS) write
 * load_documents rows and never set those columns, so a delivered load with
 * an approved POD was blocked forever and every Submit/Preview click texted
 * Annex again. See docs/FIX-LEDGER.md.
 *
 * Behavioural: runs buildFactoringPacket with the DB, PDF templates, fetch
 * and SMS mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  sms: [] as any[],
}));

vi.mock("../db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const select = () => ({
    from: (table: any) => {
      const result = h.rows[getTableName(table)] ?? [];
      const q: any = {
        where: () => q,
        limit: () => q,
        orderBy: () => q,
        then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
      };
      return q;
    },
  });
  const update = () => ({ set: () => ({ where: async () => undefined }) });
  return { db: { select, update } };
});

vi.mock("../sms-service", () => ({
  smsLoadService: { sendSMS: async (...a: any[]) => { h.sms.push(a); return { success: true }; } },
}));

vi.mock("../factoring-pdf-templates", () => ({
  LAMP: { legalName: "Lamp, PLLC", dba: "LAMP Logistics", clientCode: "LAMP01", phone: "x", email: "x" },
  generateBillOfSale: async () => Buffer.from("%PDF-bill-of-sale"),
  generateInvoice: async () => Buffer.from("%PDF-invoice"),
  mergePacketPdfs: async () => new Uint8Array(Buffer.from("%PDF-merged")),
}));

// A delivered load as the live upload path leaves it: no podPath/bolPath/bolVerifiedAt.
const uploadedLoad = (extra: Record<string, any> = {}) => ({
  id: "load-1",
  loadNumber: "LD1",
  rate: 1500,
  rateconPath: "https://files.test/ratecon.pdf",
  brokerName: "Test Broker",
  deliveredAt: new Date("2026-01-01T10:00:00Z"),
  podPath: null,
  bolPath: null,
  bolVerifiedAt: null,
  signedBolRequired: true,
  factoringStatus: null,
  ...extra,
});
const doc = (documentType: string) => ({
  id: `doc-${documentType}`,
  fileUrl: `https://files.test/${documentType}.jpg`,
  documentType,
  createdAt: new Date(),
});

beforeEach(() => {
  h.sms = [];
  process.env.OWNER_ALERT_PHONE = "+15550000000";
  vi.stubGlobal("fetch", async () => new Response(Buffer.from("%PDF-file"), { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OWNER_ALERT_PHONE;
});

describe("buildFactoringPacket gates accept dispatcher-approved delivery docs", () => {
  it("approved delivery_pod passes 14a-2 and 14a-3 with no loads.podPath/bolPath", async () => {
    h.rows = { loads: [uploadedLoad()], load_documents: [doc("delivery_pod"), doc("pickup_bol")] };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.error ?? "").not.toMatch(/14a-/);
    expect(r.ok).toBe(true);
    expect(h.sms).toHaveLength(0);
  });

  it("approved delivery_signed_bol also passes both gates", async () => {
    h.rows = { loads: [uploadedLoad()], load_documents: [doc("delivery_signed_bol")] };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.error ?? "").not.toMatch(/14a-/);
  });

  it("only a pickup BOL is still blocked by 14a-2 (no POD)", async () => {
    h.rows = { loads: [uploadedLoad()], load_documents: [doc("pickup_bol")] };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/14a-2/);
  });

  it("not delivered and no approved delivery doc is blocked by 14a-2", async () => {
    h.rows = { loads: [uploadedLoad({ deliveredAt: null })], load_documents: [] };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.error).toMatch(/14a-2/);
  });
});

describe("14a-3 owner alert fires once per load, not per click", () => {
  const unverifiedBol = { podPath: "https://files.test/pod.jpg" };

  it("first block texts Annex once", async () => {
    h.rows = { loads: [uploadedLoad(unverifiedBol)], load_documents: [] };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.error).toMatch(/14a-3/);
    expect(h.sms).toHaveLength(1);
  });

  it("load already in manual_review: blocked again, no second text", async () => {
    h.rows = {
      loads: [uploadedLoad({ ...unverifiedBol, factoringStatus: "manual_review" })],
      load_documents: [],
    };
    const { buildFactoringPacket } = await import("../factoring-loves");
    const r = await buildFactoringPacket("load-1");
    expect(r.error).toMatch(/14a-3/);
    expect(h.sms).toHaveLength(0);
  });
});
