/**
 * Regression guard: driver SMS must link to the tokenized portal
 * (/driver/<trackingToken>), never to the legacy React page
 * /mobile-driver-dashboard?driverId=<uuid>.
 *
 * Why: the legacy page uses the raw driver UUID as its credential and calls
 * /api/drivers/:id routes, which now require a staff session (PR #128). Drivers
 * have no session, so a ?driverId= link opens a broken page. Four senders in
 * routes.ts still sent it. See docs/FIX-LEDGER.md "Driver SMS linked the
 * legacy ?driverId= page".
 *
 * Source-level tripwire for the senders (a request test would need Postgres
 * and Twilio), plus a unit test of the shared link builder.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { driverPortalUrl } from "../driver-portal-link";

const routesSrc = readFileSync(resolve(__dirname, "../routes.ts"), "utf8");

/** Body of the route registered at `path`, up to the next app.<verb>( call. */
function handlerSource(method: string, path: string): string {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = routesSrc.search(new RegExp(`app\\.${method}\\(["']${escaped}["']`));
  expect(start, `${method.toUpperCase()} ${path} not found in routes.ts`).toBeGreaterThan(-1);
  const rest = routesSrc.slice(start + 1);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete|use)\(/);
  return rest.slice(0, next === -1 ? undefined : next);
}

const SENDERS: Array<{ method: string; path: string }> = [
  { method: "post", path: "/api/sms/send-template" }, // TRIP template
  { method: "post", path: "/api/drivers" }, // welcome SMS on create
  { method: "post", path: "/api/drivers/:id/send-dashboard-link" },
  { method: "post", path: "/api/drivers/send-dashboard-links" },
];

describe("driver SMS senders link the tokenized portal", () => {
  it("routes.ts never builds a ?driverId= dashboard link", () => {
    expect(routesSrc).not.toMatch(/driver-dashboard\?driverId=/);
  });

  for (const { method, path } of SENDERS) {
    it(`${method.toUpperCase()} ${path} builds its link with driverPortalUrl`, () => {
      const src = handlerSource(method, path);
      expect(src).toContain("driverPortalUrl(getBaseUrl(), driver, storage)");
      expect(src).not.toContain("driverId=");
    });
  }

  it("portal links are not sent through the public URL shortener", () => {
    for (const { method, path } of SENDERS.slice(1)) {
      expect(handlerSource(method, path)).not.toContain("urlShortener");
    }
  });
});

describe("driverPortalUrl", () => {
  it("reuses an existing token and never mints (minting overwrites live links)", async () => {
    const store = { generateTrackingToken: vi.fn() };
    const url = await driverPortalUrl("https://traqiq.app", { id: "d1", trackingToken: "tok123" }, store);
    expect(url).toBe("https://traqiq.app/driver/tok123");
    expect(store.generateTrackingToken).not.toHaveBeenCalled();
  });

  it("reads tracking_token from raw-SQL fallback rows instead of minting", async () => {
    // storage.getDriver/getAllDrivers return snake_case rows when the Drizzle
    // select fails; re-minting there would kill every driver's live link.
    const store = { generateTrackingToken: vi.fn() };
    const url = await driverPortalUrl("https://traqiq.app", { id: "d4", tracking_token: "raw789" }, store);
    expect(url).toBe("https://traqiq.app/driver/raw789");
    expect(store.generateTrackingToken).not.toHaveBeenCalled();
  });

  it("mints a token once when the driver has none", async () => {
    const store = { generateTrackingToken: vi.fn().mockResolvedValue({ token: "new456" }) };
    const url = await driverPortalUrl("https://traqiq.app", { id: "d2", trackingToken: null }, store);
    expect(url).toBe("https://traqiq.app/driver/new456");
    expect(store.generateTrackingToken).toHaveBeenCalledTimes(1);
    expect(store.generateTrackingToken).toHaveBeenCalledWith("d2");
  });

  it("throws instead of sending a tokenless link", async () => {
    const store = { generateTrackingToken: vi.fn().mockResolvedValue(undefined) };
    await expect(driverPortalUrl("https://traqiq.app", { id: "d3" }, store)).rejects.toThrow(/d3/);
  });
});
