/**
 * Regression guard: GPS "Tracking Stopped" reminders are capped per driver and the
 * cooldown lives in the database, not in process memory.
 *
 * Why: the monitor runs every 3 minutes. Its 15-minute cooldown was an in-memory Map,
 * so a stale driver could get 4 SMS/hour, ~96/day, and every deploy reset the Map
 * (3 deploys on 2026-10-24). Each reminder is 4-6 Twilio segments.
 * See docs/FIX-LEDGER.md "GPS reminder SMS had no daily cap".
 *
 * The real reminder ledger (server/gps-reminder-ledger.ts) runs against a fake db that
 * keeps rows across GPSHealthMonitorService instances, so a new instance = a restart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => {
  const rows: { driverId: string; at: number }[] = [];
  const execute = async (query: unknown) => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql: text, params } = new PgDialect().sqlToQuery(query as any);
    const driverId = params.find((p) => typeof p === "string") as string;
    if (/pg_advisory_xact_lock/i.test(text)) return { rows: [] };
    if (/count\(\*\)/i.test(text)) {
      const cooldownMin = params.find((p) => typeof p === "number") as number;
      const now = Date.now();
      const mine = rows.filter((r) => r.driverId === driverId && r.at > now - 24 * 60 * 60_000);
      return {
        rows: [{
          sent_24h: mine.length,
          sent_cooldown: mine.filter((r) => r.at > now - cooldownMin * 60_000).length,
        }],
      };
    }
    if (/insert into gps_reminder_log/i.test(text)) {
      rows.push({ driverId, at: Date.now() });
      return { rows: [{ id: String(rows.length) }] };
    }
    throw new Error(`unexpected SQL in test fake: ${text}`);
  };
  return {
    rows,
    db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ execute })) },
    storage: { generateTrackingToken: vi.fn() },
    smsService: { sendSMS: vi.fn(), isServiceConfigured: vi.fn() },
  };
});
vi.mock("../db", () => ({ db: h.db, pool: null }));
vi.mock("../storage", () => ({ storage: h.storage }));
vi.mock("../sms-service", () => ({ smsService: h.smsService }));

import { GPSHealthMonitorService } from "../gps-health-monitor";

const MIN = 60_000;
const T0 = new Date("2026-10-24T12:00:00Z").getTime();

const load = (driverId = "drv-1") => ({
  id: `load-${driverId}`,
  driverId,
  loadNumber: "L100",
  pickupAddress: "Dallas, TX",
  deliveryAddress: "Austin, TX",
  driver: { id: driverId, name: "Test Driver", phoneNumber: "4235550100", trackingToken: "tok123" },
});

const remind = (svc: GPSHealthMonitorService, driverId?: string): Promise<boolean> =>
  (svc as any).sendGPSReminder(load(driverId));

const at = (ms: number) => vi.setSystemTime(T0 + ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  h.rows.length = 0;
  vi.clearAllMocks();
  delete process.env.GPS_REMINDER_DAILY_CAP;
  h.smsService.sendSMS.mockResolvedValue({ success: true, messageSid: "SM1" });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GPS_REMINDER_DAILY_CAP;
});

describe("GPS reminder daily cap (default 6 per driver per 24h)", () => {
  it("refuses the 7th reminder in 24 hours", async () => {
    const svc = new GPSHealthMonitorService();
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      at(i * 16 * MIN);
      results.push(await remind(svc));
    }
    expect(results).toEqual([true, true, true, true, true, true, false]);
    expect(h.smsService.sendSMS).toHaveBeenCalledTimes(6);
  });

  it("is a rolling 24h window, not a permanent block", async () => {
    const svc = new GPSHealthMonitorService();
    for (let i = 0; i < 6; i++) {
      at(i * 16 * MIN);
      await remind(svc);
    }
    at(24 * 60 * MIN + 1);
    expect(await remind(svc)).toBe(true);
    expect(h.smsService.sendSMS).toHaveBeenCalledTimes(7);
  });

  it("counts each driver separately", async () => {
    const svc = new GPSHealthMonitorService();
    for (let i = 0; i < 6; i++) {
      at(i * 16 * MIN);
      await remind(svc, "drv-1");
    }
    expect(await remind(svc, "drv-2")).toBe(true);
  });

  it("honours GPS_REMINDER_DAILY_CAP", async () => {
    process.env.GPS_REMINDER_DAILY_CAP = "2";
    const svc = new GPSHealthMonitorService();
    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      at(i * 16 * MIN);
      results.push(await remind(svc));
    }
    expect(results).toEqual([true, true, false]);
  });

  it("GPS_REMINDER_DAILY_CAP=0 sends nothing", async () => {
    process.env.GPS_REMINDER_DAILY_CAP = "0";
    expect(await remind(new GPSHealthMonitorService())).toBe(false);
    expect(h.smsService.sendSMS).not.toHaveBeenCalled();
  });
});

describe("GPS reminder cooldown survives a restart", () => {
  it("a new monitor instance 1 minute after a send does not send again", async () => {
    expect(await remind(new GPSHealthMonitorService())).toBe(true);
    at(1 * MIN);
    const afterRestart = new GPSHealthMonitorService();
    expect(await remind(afterRestart)).toBe(false);
    expect(h.smsService.sendSMS).toHaveBeenCalledTimes(1);
    at(16 * MIN);
    expect(await remind(afterRestart)).toBe(true);
  });

  it("records the attempt before sending, so a failed send still holds the cooldown", async () => {
    h.smsService.sendSMS.mockResolvedValueOnce({ success: false, error: "SMS_DISABLED=true" });
    expect(await remind(new GPSHealthMonitorService())).toBe(false);
    at(3 * MIN);
    expect(await remind(new GPSHealthMonitorService())).toBe(false);
    expect(h.smsService.sendSMS).toHaveBeenCalledTimes(1);
  });
});

describe("GPS reminder fails closed", () => {
  it("sends nothing when the reminder log can't be read", async () => {
    h.db.transaction.mockRejectedValueOnce(new Error('relation "gps_reminder_log" does not exist'));
    expect(await remind(new GPSHealthMonitorService())).toBe(false);
    expect(h.smsService.sendSMS).not.toHaveBeenCalled();
  });
});

describe("gpsReminderDailyCap env parsing", () => {
  it.each([
    [undefined, 6],
    ["", 6],
    ["0", 0],
    ["3", 3],
    [" 4 ", 4],
    ["abc", 0],
    ["6.5", 0],
    ["-1", 0],
    ["1e3", 0],
  ])("GPS_REMINDER_DAILY_CAP=%j -> %i", async (raw, expected) => {
    const { gpsReminderDailyCap } = await import("../gps-reminder-ledger");
    expect(gpsReminderDailyCap(raw)).toBe(expected);
  });
});

describe("ensure-schema creates gps_reminder_log", () => {
  const src = readFileSync(resolve(__dirname, "../ensure-schema.ts"), "utf8");

  it("creates the table and its (driver_id, sent_at) index", () => {
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS gps_reminder_log/);
    expect(src).toMatch(/ON gps_reminder_log\s*\(driver_id, sent_at\)/);
  });
});
