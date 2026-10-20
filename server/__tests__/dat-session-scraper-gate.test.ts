/**
 * Regression guard: the boot-time session DAT scraper stays off unless
 * DAT_SESSION_SCRAPER_ENABLED=true, and it closes Chrome on every path.
 *
 * Why: on Railway the headless Chrome has no DAT cookies. DAT redirects it to its
 * marketing page (https://www.dat.com/home-1?s=loads, no "login" in the URL), so
 * checkAuthenticatedSession reported "Authenticated DAT session detected!" on every
 * boot. The 15s loop then launched Chrome for 0 loads, and a navigation timeout
 * skipped browser.close(), so Chromes piled up: LoadMailer ran at 1-3 vCPU and up
 * to 24GB, the container hit "Cannot fork", and it was ~half the Railway bill.
 * See docs/FIX-LEDGER.md "Session DAT scraper burned 1-3 vCPU".
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { launch, browser, page } = vi.hoisted(() => {
  const page = {
    setUserAgent: vi.fn(async () => {}),
    goto: vi.fn(async () => {
      throw new Error("Navigation timeout of 20000 ms exceeded");
    }),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  return { launch: vi.fn(async () => browser), browser, page };
});
vi.mock("puppeteer", () => ({ default: { launch } }));
vi.mock("../storage.js", () => ({ storage: {} }));

import { sessionBasedDATScraper, isDatSessionScraperEnabled } from "../session-based-dat-scraper";

describe("isDatSessionScraperEnabled", () => {
  it("is off by default", () => {
    expect(isDatSessionScraperEnabled({})).toBe(false);
    expect(isDatSessionScraperEnabled({ DAT_SESSION_SCRAPER_ENABLED: "false" })).toBe(false);
  });

  it("is on only for the literal 'true'", () => {
    expect(isDatSessionScraperEnabled({ DAT_SESSION_SCRAPER_ENABLED: "true" })).toBe(true);
  });
});

describe("server/index.ts boot block", () => {
  const src = readFileSync(resolve(__dirname, "../index.ts"), "utf8");

  it("checks the gate before launching Chrome to test the DAT session", () => {
    const gate = src.indexOf("isDatSessionScraperEnabled()");
    const check = src.indexOf("checkAuthenticatedSession()");
    expect(gate, "gate missing from index.ts").toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(gate);
    expect(src.slice(gate, check)).toContain("return;");
  });
});

describe("scrapeAuthenticatedSession", () => {
  it("closes Chrome when navigation times out (it used to leak one per run)", async () => {
    expect(await sessionBasedDATScraper.scrapeAuthenticatedSession()).toEqual([]);
    expect(page.goto).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
