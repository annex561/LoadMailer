/**
 * Regression guard: GPS tracking SMS must reuse the driver's trackingToken,
 * never re-mint it, and never send it through the public is.gd shortener.
 *
 * Why: storage.generateTrackingToken overwrites drivers.trackingToken. The same
 * token authenticates the driver portal (/driver/<token>) and the GPS posts from
 * an open /driver-tracker tab. Re-minting on every send killed the driver's
 * portal links and 401'd their live tracker, so GPS went stale and the health
 * monitor sent another reminder (and another token) 15 minutes later.
 * See docs/FIX-LEDGER.md "GPS tracking SMS rotated the driver's token".
 *
 * gps-health-monitor is tested by behaviour with storage/SMS mocked.
 * sendGPSTrackingSMS is private to routes.ts (which needs Postgres and Twilio
 * to load), so it gets a source-level tripwire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { storage, smsService, shortenUrl } = vi.hoisted(() => ({
  storage: { generateTrackingToken: vi.fn() },
  smsService: { sendSMS: vi.fn(), isServiceConfigured: vi.fn() },
  shortenUrl: vi.fn(),
}));
vi.mock("../storage", () => ({ storage }));
vi.mock("../sms-service", () => ({ smsService }));
vi.mock("../url-shortener-service", () => ({ urlShortener: { shortenUrl } }));
// Cap/cooldown are covered by gps-reminder-daily-cap.test.ts; here every reminder is allowed.
vi.mock("../gps-reminder-ledger", () => ({ reserveGpsReminder: vi.fn(async () => ({ ok: true })) }));

import { GPSHealthMonitorService } from "../gps-health-monitor";

function inTransitLoad(driver: Record<string, unknown> & { id: string }) {
  return {
    driverId: driver.id,
    loadNumber: "L100",
    pickupAddress: "Dallas, TX",
    deliveryAddress: "Austin, TX",
    driver: { name: "Test Driver", phoneNumber: "4235550100", ...driver },
  };
}

async function sendReminder(load: ReturnType<typeof inTransitLoad>): Promise<boolean> {
  return (new GPSHealthMonitorService() as any).sendGPSReminder(load);
}

const sentBody = () => smsService.sendSMS.mock.calls[0][0].body as string;

beforeEach(() => {
  vi.clearAllMocks();
  smsService.sendSMS.mockResolvedValue({ success: true, messageSid: "SM1" });
  shortenUrl.mockResolvedValue({ success: true, shortUrl: "https://is.gd/abc123" });
});

describe("GPS health-monitor reminder", () => {
  it("reuses the driver's token (minting would kill their live links)", async () => {
    expect(await sendReminder(inTransitLoad({ id: "d1", trackingToken: "tok123" }))).toBe(true);
    expect(storage.generateTrackingToken).not.toHaveBeenCalled();
    expect(sentBody()).toContain("/driver-tracker?driver=d1&token=tok123");
  });

  it("reads tracking_token from raw-SQL fallback rows instead of minting", async () => {
    expect(await sendReminder(inTransitLoad({ id: "d4", tracking_token: "raw789" }))).toBe(true);
    expect(storage.generateTrackingToken).not.toHaveBeenCalled();
    expect(sentBody()).toContain("token=raw789");
  });

  it("mints once when the driver has no token", async () => {
    storage.generateTrackingToken.mockResolvedValue({ token: "new456" });
    expect(await sendReminder(inTransitLoad({ id: "d2", trackingToken: null }))).toBe(true);
    expect(storage.generateTrackingToken).toHaveBeenCalledTimes(1);
    expect(storage.generateTrackingToken).toHaveBeenCalledWith("d2");
    expect(sentBody()).toContain("/driver-tracker?driver=d2&token=new456");
  });

  it("never sends the token through the public shortener", async () => {
    await sendReminder(inTransitLoad({ id: "d1", trackingToken: "tok123" }));
    expect(shortenUrl).not.toHaveBeenCalled();
    expect(sentBody()).not.toContain("is.gd");
  });

  it("sends nothing when no token can be minted", async () => {
    storage.generateTrackingToken.mockResolvedValue(undefined);
    expect(await sendReminder(inTransitLoad({ id: "d3" }))).toBe(false);
    expect(smsService.sendSMS).not.toHaveBeenCalled();
  });
});

describe("sendGPSTrackingSMS (routes.ts)", () => {
  const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");
  const start = routesSrc.indexOf("async function sendGPSTrackingSMS(");
  const body = routesSrc.slice(start, routesSrc.indexOf("\n}\n", start));

  it("is found in routes.ts", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("reuses the driver's token via ensureTrackingToken, never generateTrackingToken", () => {
    expect(body).toContain("ensureTrackingToken(driver, storage)");
    expect(body).not.toContain("generateTrackingToken");
  });

  it("does not send the token URL through urlShortener", () => {
    expect(body).not.toContain("urlShortener");
  });
});
