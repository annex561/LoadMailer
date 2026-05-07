import type { Express } from "express";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import { drivers, loads } from "@shared/schema";
import { requireRole } from "../auth";
import { buildDispatchSmsBody } from "../ratecon-dispatch-service";

/**
 * Admin-only "Test Dispatch SMS" tooling.
 *
 *   POST /api/admin/test-dispatch/preview  → render body, do not send
 *   POST /api/admin/test-dispatch/send     → render body and send via Twilio
 *
 * Both accept a free-form load + driver shape so the user can test any
 * scenario without creating a load row in the DB or modifying real loads.
 *
 * Required body fields:
 *   phone          - destination phone (E.164 or raw digits)
 * Optional load fields (sensible defaults applied):
 *   loadNumber, brokerName, originCity, originState, destCity, destState,
 *   pickupAddress, deliveryAddress, pickupDate, pickupTime, deliveryDate,
 *   deliveryTime, rate, miles, description, specialInstructions,
 *   confirmationToken
 * Optional driver fields:
 *   driverName, payType ('percent' | 'per_mile' | 'flat'), payRate
 */

interface TestDispatchBody {
  phone?: string;
  loadNumber?: string;
  brokerName?: string;
  originCity?: string;
  originState?: string;
  destCity?: string;
  destState?: string;
  pickupAddress?: string;
  deliveryAddress?: string;
  pickupDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  rate?: number;
  miles?: number;
  description?: string;
  specialInstructions?: string;
  confirmationToken?: string;
  driverName?: string;
  payType?: "percent" | "per_mile" | "flat";
  payRate?: number;
}

function defaultLoad(overrides: TestDispatchBody) {
  return {
    loadNumber: overrides.loadNumber ?? "TEST-" + Date.now().toString().slice(-6),
    brokerName: overrides.brokerName ?? "Total Quality Logistics (TEST)",
    originCity: overrides.originCity ?? "Atlanta",
    originState: overrides.originState ?? "GA",
    destCity: overrides.destCity ?? "Dallas",
    destState: overrides.destState ?? "TX",
    pickupAddress: overrides.pickupAddress ?? "",
    deliveryAddress: overrides.deliveryAddress ?? "",
    pickupDate: overrides.pickupDate ?? new Date(Date.now() + 86400_000).toISOString(),
    pickupTime: overrides.pickupTime ?? "08:00",
    deliveryDate: overrides.deliveryDate ?? new Date(Date.now() + 2 * 86400_000).toISOString(),
    deliveryTime: overrides.deliveryTime ?? "17:00",
    rate: overrides.rate ?? 2450,
    miles: overrides.miles ?? 800,
    description: overrides.description ?? "General freight",
    specialInstructions: overrides.specialInstructions ?? "",
    confirmationToken: overrides.confirmationToken ?? `test-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function defaultDriver(overrides: TestDispatchBody) {
  return {
    name: overrides.driverName ?? "Test Driver",
    payType: overrides.payType ?? "percent",
    payRate: overrides.payRate ?? 80,
    payRateDeadhead: 0,
    deductFactoringEnabled: false,
    deductFactoringPct: 0,
    deductDispatchEnabled: false,
    deductDispatchPct: 0,
    deductFuelAdvanceEnabled: false,
    deductFuelAdvanceAmount: 0,
  };
}

export function registerTestDispatchRoutes(app: Express) {
  // Preview only — render the body, do not send. Useful for iterating on copy.
  app.post("/api/admin/test-dispatch/preview", requireRole("admin"), async (req, res) => {
    try {
      const overrides = (req.body ?? {}) as TestDispatchBody;
      const load = defaultLoad(overrides);
      const driver = defaultDriver(overrides);
      const { body, url } = buildDispatchSmsBody(load, driver);
      const { withBrandAndOptOut } = await import("../sms-service");
      // No dashboard footer — single URL only (carrier filter avoidance).
      const finalBody = withBrandAndOptOut(body);
      res.json({ ok: true, body: finalBody, url, load, driver });
    } catch (err: any) {
      console.error("[test-dispatch:preview]", err);
      res.status(500).json({ ok: false, error: err?.message ?? "preview failed" });
    }
  });

  // Send a test dispatch SMS using a REAL load's data (broker, addresses,
  // dates, real confirmationToken) but redirect the message to a chosen
  // phone instead of the load's actual driver. Lets the admin verify the
  // exact end-to-end SMS — including a clickable /l/<token> link that
  // resolves to a real load — without messaging the real driver.
  app.post("/api/admin/test-dispatch/from-load/:loadId", requireRole("admin"), async (req, res) => {
    try {
      const { loadId } = req.params;
      const phone = (req.body?.phone ?? "").toString().trim();
      if (!phone) {
        return res.status(400).json({ ok: false, error: "phone is required" });
      }

      const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
      if (!load) return res.status(404).json({ ok: false, error: "Load not found" });

      // Use the load's real driver if one is assigned (so NET PAY is computed
      // with the actual pay terms). Otherwise fall back to a sensible default
      // so the SMS still renders.
      let driver: any = null;
      if (load.driverId) {
        const [d] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
        driver = d;
      }
      if (!driver) {
        driver = {
          name: "Test Driver",
          payType: "percent",
          payRate: 80,
          payRateDeadhead: 0,
          deductFactoringEnabled: false,
          deductFactoringPct: 0,
          deductDispatchEnabled: false,
          deductDispatchPct: 0,
          deductFuelAdvanceEnabled: false,
          deductFuelAdvanceAmount: 0,
        };
      }

      const { body, url } = buildDispatchSmsBody(load, driver);
      const { smsService, withBrandAndOptOut } = await import("../sms-service");

      // Manually append the "👤 My Dashboard" footer using the load's
      // No second URL (driver dashboard footer) — carriers filter messages
      // with two URLs as suspicious, even with 10DLC approved. The single
      // /l/<token> link in the body lets the driver reach everything.
      const finalBody = withBrandAndOptOut(body);

      const result = await smsService.sendSMS({
        to: phone,
        body: finalBody,
        skipFooter: true,
      });
      console.log(
        `[test-dispatch:from-load] loadId=${loadId} loadNum=${load.loadNumber} -> ${phone} ok=${result.success} sid=${result.messageSid ?? "-"} (real driver phone bypassed)`
      );
      res.json({
        ok: result.success,
        error: result.error,
        messageSid: result.messageSid,
        body: finalBody,
        url,
        load: { id: load.id, loadNumber: load.loadNumber, brokerName: load.brokerName, confirmationToken: load.confirmationToken },
        driver: { name: (driver as any).name, payType: (driver as any).payType, payRate: (driver as any).payRate },
      });
    } catch (err: any) {
      console.error("[test-dispatch:from-load]", err);
      res.status(500).json({ ok: false, error: err?.message ?? "send failed" });
    }
  });

  // Send to a specified phone. Goes through the SAME smsService.sendSMS path
  // as production dispatch, so 10DLC compliance, opt-out check, and the
  // driver-dashboard footer all apply identically.
  // URL diagnostic — fires TWO sends to the same recipient with body
  // identical except one includes the load Details URL and one omits it.
  // Used to test Twilio T&S hypothesis (ticket #26735656) that the
  // traqiq.app/l/test-* URL pattern is what's tripping carrier filtering.
  app.post("/api/admin/test-dispatch/url-diagnostic", requireRole("admin"), async (req, res) => {
    try {
      const overrides = (req.body ?? {}) as TestDispatchBody;
      if (!overrides.phone) {
        return res.status(400).json({ ok: false, error: "phone is required" });
      }

      const load = defaultLoad({ ...overrides, loadNumber: "URL-TEST-" + Date.now().toString().slice(-6) });
      const driver = defaultDriver(overrides);
      const { body: bodyWithTestUrl } = buildDispatchSmsBody(load, driver);

      // Variant 2: production-style URL (no "test-" prefix). Real loads use
      // nanoid tokens — we synthesize one here and swap it into the URL.
      // Carriers may have flagged "test-" specifically; if a clean nanoid
      // URL passes, real production traffic will work as-is.
      const prodToken = nanoid(8);
      const bodyWithProdUrl = bodyWithTestUrl.replace(
        /(https:\/\/[^\s/]+\/l\/)test-[a-z0-9]+/i,
        `$1${prodToken}`,
      );

      // Variant 3: SHORT URL pattern — much shorter token + shorter path.
      // Carrier filter heuristics often score URL "shape" (length, token
      // entropy, path depth). A 2-char token at /r/ is much less spam-like
      // than a long /l/test-... pattern. If this passes, we just change the
      // production URL pattern — no domain change required.
      const shortToken = Math.random().toString(36).slice(2, 4); // 2 chars
      const bodyWithShortUrl = bodyWithTestUrl.replace(
        /(https:\/\/[^\s/]+)\/l\/test-[a-z0-9]+/i,
        `$1/r/${shortToken}`,
      );

      // Variant 4: no URL line at all — confirms baseline deliverability.
      const bodyNoUrl = bodyWithTestUrl.replace(/^Details:\s+\S+\s*\n?/im, "");

      const { smsService, withBrandAndOptOut } = await import("../sms-service");
      const withTestUrlFinal = withBrandAndOptOut(bodyWithTestUrl);
      const withProdUrlFinal = withBrandAndOptOut(bodyWithProdUrl);
      const withShortUrlFinal = withBrandAndOptOut(bodyWithShortUrl);
      const noUrlFinal = withBrandAndOptOut(bodyNoUrl);

      console.log(`[url-diagnostic] sending quad to ${overrides.phone} (load=${load.loadNumber})`);

      const r1 = await smsService.sendSMS({ to: overrides.phone, body: withTestUrlFinal, skipFooter: true });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const r2 = await smsService.sendSMS({ to: overrides.phone, body: withProdUrlFinal, skipFooter: true });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const r3 = await smsService.sendSMS({ to: overrides.phone, body: withShortUrlFinal, skipFooter: true });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const r4 = await smsService.sendSMS({ to: overrides.phone, body: noUrlFinal, skipFooter: true });

      console.log(`[url-diagnostic] testUrl=${r1.messageSid ?? "-"} prodUrl=${r2.messageSid ?? "-"} shortUrl=${r3.messageSid ?? "-"} noUrl=${r4.messageSid ?? "-"}`);

      res.json({
        ok: r1.success && r2.success && r3.success && r4.success,
        loadNumber: load.loadNumber,
        withUrl: {
          ok: r1.success,
          messageSid: r1.messageSid,
          error: r1.error,
          body: withTestUrlFinal,
        },
        withProdUrl: {
          ok: r2.success,
          messageSid: r2.messageSid,
          error: r2.error,
          body: withProdUrlFinal,
        },
        withShortUrl: {
          ok: r3.success,
          messageSid: r3.messageSid,
          error: r3.error,
          body: withShortUrlFinal,
        },
        noUrl: {
          ok: r4.success,
          messageSid: r4.messageSid,
          error: r4.error,
          body: noUrlFinal,
        },
      });
    } catch (err: any) {
      console.error("[url-diagnostic]", err);
      res.status(500).json({ ok: false, error: err?.message ?? "diagnostic failed" });
    }
  });

  app.post("/api/admin/test-dispatch/send", requireRole("admin"), async (req, res) => {
    try {
      const overrides = (req.body ?? {}) as TestDispatchBody;
      if (!overrides.phone) {
        return res.status(400).json({ ok: false, error: "phone is required" });
      }

      const load = defaultLoad(overrides);
      const driver = defaultDriver(overrides);
      const { body, url } = buildDispatchSmsBody(load, driver);

      const { smsService, withBrandAndOptOut } = await import("../sms-service");
      // Manually append the dashboard footer with a demo token so the test
      // phone (which is typically not a registered driver) still sees the
      // No second URL — single load detail link only (carrier filter avoidance).
      const finalBody = withBrandAndOptOut(body);
      const result = await smsService.sendSMS({
        to: overrides.phone,
        body: finalBody,
        skipFooter: true,
      });
      console.log(
        `[test-dispatch:send] phone=${overrides.phone} loadNumber=${load.loadNumber} ok=${result.success} sid=${result.messageSid ?? "-"}`
      );
      res.json({ ok: result.success, error: result.error, messageSid: result.messageSid, body: finalBody, url });
    } catch (err: any) {
      console.error("[test-dispatch:send]", err);
      res.status(500).json({ ok: false, error: err?.message ?? "send failed" });
    }
  });
}
