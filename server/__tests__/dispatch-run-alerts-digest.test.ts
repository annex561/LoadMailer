/**
 * Regression: POST /api/dispatch/run-alerts must send at most ONE owner SMS
 * per run, and at most one per hour, however many loads are overdue.
 *
 * History: the first cut texted OWNER_ALERT_PHONE once per overdue load, up
 * to 50 per lane, with no window. loads.podPath is never set by the upload
 * paths, so DISPATCH_ALERT_NO_POD=true matched every load ever delivered:
 * one click = ~100 texts, and a cron = thousands a day (the PR #62 pattern).
 * See docs/FIX-LEDGER.md.
 *
 * Behavioural: registers the routes on a fake app and calls the handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as any[], sms: [] as any[] }));

vi.mock("../db", () => {
  const q: any = {
    from: () => q,
    where: () => q,
    orderBy: () => q,
    limit: () => q,
    then: (res: any, rej: any) => Promise.resolve(h.rows).then(res, rej),
  };
  return { db: { select: () => q } };
});
vi.mock("../auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../sms-service", () => ({
  smsLoadService: { sendSMS: async (...a: any[]) => { h.sms.push(a); return { success: true }; } },
}));

const FLAGS = ["DISPATCH_ALERT_NO_CONFIRM", "DISPATCH_ALERT_NO_POD", "DISPATCH_ALERT_NO_INVOICE"];

async function runAlerts() {
  const mod = await import("../routes/dispatch-tracker-routes");
  const handlers: Record<string, any[]> = {};
  const app: any = { get: () => {}, patch: () => {}, post: (p: string, ...hs: any[]) => { handlers[p] = hs; } };
  mod.registerDispatchTrackerRoutes(app);
  const handler = handlers["/api/dispatch/run-alerts"].at(-1);
  let body: any;
  await handler({}, { json: (b: any) => { body = b; }, status: () => ({ json: (b: any) => { body = b; } }) });
  return { body, mod };
}

beforeEach(async () => {
  h.sms = [];
  // 40 loads delivered 2h ago, none with POD or invoice.
  h.rows = Array.from({ length: 40 }, (_, i) => ({
    id: `l${i}`,
    loadNumber: `LD${i}`,
    deliveredAt: new Date(Date.now() - 2 * 3_600_000),
    pickupDate: null,
  }));
  process.env.OWNER_ALERT_PHONE = "+15550000000";
  process.env.DISPATCH_ALERT_NO_POD = "true";
  process.env.DISPATCH_ALERT_NO_INVOICE = "true";
  const mod = await import("../routes/dispatch-tracker-routes");
  mod._resetAlertDigestThrottle();
});

afterEach(() => {
  for (const k of [...FLAGS, "OWNER_ALERT_PHONE"]) delete process.env[k];
});

describe("run-alerts digest", () => {
  it("40 overdue loads across two lanes = exactly one owner SMS", async () => {
    const { body } = await runAlerts();
    expect(body.alertsFired).toBeGreaterThan(1);
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0][1]).toMatch(/dispatch deadline/);
  });

  it("a second run inside the hour sends nothing", async () => {
    await runAlerts();
    await runAlerts();
    expect(h.sms).toHaveLength(1);
  });

  it("all flags off = no SMS", async () => {
    for (const k of FLAGS) delete process.env[k];
    const { body } = await runAlerts();
    expect(body.alertsFired).toBe(0);
    expect(h.sms).toHaveLength(0);
  });
});
