/**
 * Load Lifecycle Service
 *
 * Central automation engine for the full LAMP Logistics SOP:
 *
 * Phase 1 — Dispatch confirmed (driver replied YES)
 *   → Send full dispatch instructions + GPS tracking link
 *   → Update load status to in_transit
 *
 * Phase 2 — Pickup monitoring
 *   → Detect GPS arrival at pickup → request BOL + freight photos
 *   → Alert dispatcher: driver arrived at pickup
 *
 * Phase 3 — In-transit monitoring
 *   → 4-hour check-in SMS to driver
 *   → Alert dispatcher if driver silent for 30+ min (no GPS)
 *   → ETA calculation from GPS position
 *
 * Phase 4 — Delivery monitoring
 *   → Detect GPS arrival at delivery → request POD + delivery photos
 *   → Release driver once docs received
 *
 * Phase 5 — Post-delivery
 *   → Auto-email full doc package to Einstein (factoring)
 *   → Send thank-you email to broker with POD attached
 *   → Close load in system
 *
 * Runs every 2 minutes.
 */

import cron from "node-cron";
import nodemailer from "nodemailer";
import { storage } from "./storage";

// ─── Config ───────────────────────────────────────────────────────────────────

const EINSTEIN_EMAIL   = process.env.EINSTEIN_EMAIL   || process.env.FACTORING_EMAIL || "";
const DISPATCHER_PHONE = process.env.DISPATCHER_PHONE || process.env.TWILIO_PHONE_NUMBER || "";
const BASE_URL         = process.env.CUSTOM_DOMAIN    || "https://traqiq.app";

const CHECK_IN_HOURS      = 4;     // Send check-in SMS N hours after confirmation
const SILENCE_MINUTES     = 30;    // Alert dispatcher if no GPS ping for N min
const PICKUP_RADIUS_MILES = 2;     // GPS proximity to trigger pickup arrival
const DELIVERY_RADIUS_MILES = 2;   // GPS proximity to trigger delivery arrival

// ─── Email transporter (reuses existing config) ───────────────────────────────

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "",
  },
});

// ─── Haversine ────────────────────────────────────────────────────────────────

function milesApart(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── City geocoder (shared with auto-load-matcher) ───────────────────────────

const CITY_COORDS: Record<string, [number, number]> = {
  "knoxville, tn":     [35.9606, -83.9207],
  "nashville, tn":     [36.1627, -86.7816],
  "memphis, tn":       [35.1495, -90.0490],
  "chattanooga, tn":   [35.0456, -85.3097],
  "atlanta, ga":       [33.7490, -84.3880],
  "savannah, ga":      [32.0835, -81.0998],
  "jacksonville, fl":  [30.3322, -81.6557],
  "miami, fl":         [25.7617, -80.1918],
  "orlando, fl":       [28.5383, -81.3792],
  "tampa, fl":         [27.9506, -82.4572],
  "birmingham, al":    [33.5186, -86.8104],
  "montgomery, al":    [32.3617, -86.2792],
  "charlotte, nc":     [35.2271, -80.8431],
  "raleigh, nc":       [35.7796, -78.6382],
  "columbia, sc":      [34.0007, -81.0348],
  "charleston, sc":    [32.7765, -79.9311],
  "louisville, ky":    [38.2527, -85.7585],
  "jackson, ms":       [32.2988, -90.1848],
  "houston, tx":       [29.7604, -95.3698],
  "dallas, tx":        [32.7767, -96.7970],
  "kingsport, tn":     [36.5484, -82.5618],
  "mount juliet, tn":  [36.2001, -86.5186],
  "smyrna, ga":        [33.8840, -84.5144],
  "brunswick, ga":     [31.1499, -81.4915],
  "algood, tn":        [36.1934, -85.4497],
};

function cityCoords(cityState: string): [number, number] | null {
  const key = cityState.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.split(",")[0].trim() === k.split(",")[0].trim()) return v;
  }
  return null;
}

// ─── In-memory state (tracks what we've already sent) ────────────────────────

const sentCheckIns     = new Set<string>(); // loadId
const sentPickupReqs   = new Set<string>(); // loadId
const sentDeliveryReqs = new Set<string>(); // loadId
const sentEinsteinPkg  = new Set<string>(); // loadId
const sentThankYou     = new Set<string>(); // loadId

// ─── SMS helper (uses Twilio via existing service) ────────────────────────────

async function sendSMS(to: string, body: string): Promise<void> {
  try {
    const { smsLoadService } = await import("./sms-service");
    await (smsLoadService as any).sendSMS(to, body);
  } catch (e: any) {
    console.error("[Lifecycle] SMS error:", e.message);
  }
}

// ─── Core lifecycle checker ───────────────────────────────────────────────────

async function runLifecycleCheck(): Promise<void> {
  try {
    const allLoads  = await storage.getAllLoads();
    const allDrivers = await storage.getAllDrivers();
    const allLocations = await storage.getAllCurrentDriverLocations();
    const now = Date.now();

    for (const load of allLoads) {
      if (!load.driverId) continue;

      const driver  = allDrivers.find(d => d.id === load.driverId);
      if (!driver?.phone) continue;

      const driverLoc = allLocations.find(l => l.driverId === load.driverId);
      const sopProgress: any = (load as any).sopProgress || {};

      // ── PHASE 1: Driver confirmed (YES received) → send full dispatch instructions ──
      if (
        load.driverConfirmedAt &&
        !sopProgress.dispatchInstructionsSent &&
        (load.status === "dispatched" || load.status === "confirmed" || load.status === "booked" || load.status === "scheduled")
      ) {
        try {
          const { smsLoadService } = await import("./sms-service");
          await smsLoadService.sendDispatchInstructions(load, driver);

          await storage.updateLoad(load.id, {
            status: "in_transit",
            sopProgress: { ...sopProgress, dispatchInstructionsSent: true, dispatchedAt: new Date().toISOString() },
          });

          console.log(`[Lifecycle] ✅ Dispatch instructions sent to ${driver.name} for load #${load.loadNumber}`);
        } catch (e: any) {
          console.error(`[Lifecycle] Dispatch instructions error:`, e.message);
        }
        continue;
      }

      if (load.status !== "in_transit" && load.status !== "at_pickup" && load.status !== "at_delivery" && load.status !== "delivered") continue;

      // ── PHASE 2: GPS near pickup → request BOL + freight photos ──
      if (
        load.status === "in_transit" &&
        !sentPickupReqs.has(load.id) &&
        !sopProgress.pickupDocsRequested
      ) {
        const pickupCity = (load as any).originCity || (load as any).origin_city || "";
        const coords = cityCoords(pickupCity);
        if (coords && driverLoc?.latitude && driverLoc?.longitude) {
          const dist = milesApart(driverLoc.latitude, driverLoc.longitude, coords[0], coords[1]);
          if (dist <= PICKUP_RADIUS_MILES) {
            await sendSMS(driver.phone,
              `📍 You've arrived at pickup!\n\nLoad #${load.loadNumber || ""}\n\nPlease send us:\n📸 1. Photos of the freight BEFORE loading\n📄 2. Photo of the signed BOL\n🔒 3. Seal number (text it to us)\n\nDo NOT depart until you have sent all three.`
            );

            // Alert dispatcher
            if (DISPATCHER_PHONE) {
              await sendSMS(DISPATCHER_PHONE,
                `🚛 PICKUP ALERT\nDriver ${driver.name} has arrived at pickup.\nLoad #${load.loadNumber} · ${(load as any).originCity || "Origin"} → ${(load as any).destCity || "Dest"}`
              );
            }

            sentPickupReqs.add(load.id);
            await storage.updateLoad(load.id, {
              status: "at_pickup",
              sopProgress: { ...sopProgress, pickupDocsRequested: true, arrivedPickupAt: new Date().toISOString() },
            });
            console.log(`[Lifecycle] 📍 Pickup arrival detected for ${driver.name} — docs requested`);
          }
        }
      }

      // ── PHASE 3A: 4-hour check-in SMS ──
      if (
        !sentCheckIns.has(load.id) &&
        !sopProgress.checkInSent &&
        (load.status === "in_transit" || load.status === "at_pickup")
      ) {
        const dispatchedAt = sopProgress.dispatchedAt ? new Date(sopProgress.dispatchedAt).getTime() :
          (load.driverConfirmedAt ? new Date(load.driverConfirmedAt).getTime() : null);

        if (dispatchedAt && now - dispatchedAt >= CHECK_IN_HOURS * 60 * 60 * 1000) {
          await sendSMS(driver.phone,
            `🚛 Load #${load.loadNumber} check-in\n\nHow's the trip going? Please reply with your current location and ETA to delivery.\n\nAlso — notify us 1 hour before you reach the delivery location.`
          );

          sentCheckIns.add(load.id);
          await storage.updateLoad(load.id, {
            sopProgress: { ...sopProgress, checkInSent: true, checkInSentAt: new Date().toISOString() },
          });
          console.log(`[Lifecycle] ⏰ 4-hour check-in sent to ${driver.name}`);
        }
      }

      // ── PHASE 3B: Silence alert (no GPS ping for 30+ min) ──
      if (
        (load.status === "in_transit" || load.status === "at_pickup") &&
        DISPATCHER_PHONE &&
        driverLoc?.updatedAt
      ) {
        const lastPing = new Date(driverLoc.updatedAt).getTime();
        const minutesSilent = (now - lastPing) / 60000;

        if (minutesSilent >= SILENCE_MINUTES) {
          const silenceKey = `${load.id}-silence-${Math.floor(minutesSilent / 30)}`;
          if (!sentCheckIns.has(silenceKey)) {
            await sendSMS(DISPATCHER_PHONE,
              `⚠️ DRIVER SILENT — ${Math.round(minutesSilent)} min\n${driver.name} has not updated GPS.\nLoad #${load.loadNumber}\nLast ping: ${new Date(lastPing).toLocaleTimeString()}\nCall driver: ${driver.phone}`
            );
            sentCheckIns.add(silenceKey);
          }
        }
      }

      // ── PHASE 4: GPS near delivery → request POD + delivery photos ──
      if (
        (load.status === "in_transit" || load.status === "at_pickup") &&
        !sentDeliveryReqs.has(load.id) &&
        !sopProgress.deliveryDocsRequested
      ) {
        const deliveryCity = (load as any).destCity || (load as any).dest_city || "";
        const coords = cityCoords(deliveryCity);
        if (coords && driverLoc?.latitude && driverLoc?.longitude) {
          const dist = milesApart(driverLoc.latitude, driverLoc.longitude, coords[0], coords[1]);
          if (dist <= DELIVERY_RADIUS_MILES) {
            await sendSMS(driver.phone,
              `🏁 You've arrived at delivery!\n\nLoad #${load.loadNumber || ""}\n\nPlease send us:\n📸 1. Photos of the freight being offloaded\n📄 2. BOL with RECEIVER SIGNATURE\n🕐 Note your arrival time\n\nDo NOT leave until BOL is signed and sent.`
            );

            sentDeliveryReqs.add(load.id);
            await storage.updateLoad(load.id, {
              status: "at_delivery",
              sopProgress: { ...sopProgress, deliveryDocsRequested: true, arrivedDeliveryAt: new Date().toISOString() },
            });
            console.log(`[Lifecycle] 🏁 Delivery arrival detected for ${driver.name} — docs requested`);
          }
        }
      }

      // ── PHASE 4B: Release driver once delivery docs received ──
      if (
        load.status === "at_delivery" &&
        !sopProgress.driverReleased
      ) {
        const docs = await storage.getDocumentsByLoad?.(load.id) || [];
        const hasPOD = docs.some((d: any) => d.documentType === "pod" || d.documentType === "delivery_bol");

        if (hasPOD) {
          await sendSMS(driver.phone,
            `✅ You are GOOD TO GO!\n\nLoad #${load.loadNumber} is complete. Thank you for the great work!\n\nYour documents have been received. Stay safe out there. We'll be in touch for your next load. 🚛`
          );

          await storage.updateLoad(load.id, {
            status: "delivered",
            sopProgress: { ...sopProgress, driverReleased: true, deliveredAt: new Date().toISOString() },
          });
          console.log(`[Lifecycle] ✅ Driver ${driver.name} released — load #${load.loadNumber} delivered`);
        }
      }

      // ── PHASE 5A: Email full doc package to Einstein ──
      if (
        load.status === "delivered" &&
        !sentEinsteinPkg.has(load.id) &&
        !sopProgress.einsteinSubmitted &&
        EINSTEIN_EMAIL
      ) {
        const docs = await storage.getDocumentsByLoad?.(load.id) || [];
        const hasBOL    = docs.some((d: any) => ["bol", "pickup_bol", "delivery_bol", "pod"].includes(d.documentType));
        const hasPhotos = docs.some((d: any) => d.documentType === "freight_photo");

        if (hasBOL) {
          try {
            const rate = (load as any).rate || (load as any).rate_total || 0;
            await mailer.sendMail({
              from: process.env.SMTP_USER || "dispatch@traqiq.app",
              to: EINSTEIN_EMAIL,
              subject: `📦 Factoring Package — Load #${load.loadNumber} | ${(load as any).originCity || "Origin"} → ${(load as any).destCity || "Dest"}`,
              html: `
                <h2>Factoring Submission — Load #${load.loadNumber}</h2>
                <table style="border-collapse:collapse;width:100%;font-family:sans-serif;">
                  <tr><td style="padding:6px;font-weight:bold;">Driver</td><td style="padding:6px;">${driver.name}</td></tr>
                  <tr><td style="padding:6px;font-weight:bold;">Route</td><td style="padding:6px;">${(load as any).originCity || ""} → ${(load as any).destCity || ""}</td></tr>
                  <tr><td style="padding:6px;font-weight:bold;">Rate</td><td style="padding:6px;">$${rate.toLocaleString()}</td></tr>
                  <tr><td style="padding:6px;font-weight:bold;">Load #</td><td style="padding:6px;">${load.loadNumber}</td></tr>
                  <tr><td style="padding:6px;font-weight:bold;">Documents</td><td style="padding:6px;">${docs.length} files attached/on file</td></tr>
                  <tr><td style="padding:6px;font-weight:bold;">Delivered At</td><td style="padding:6px;">${sopProgress.deliveredAt || new Date().toLocaleString()}</td></tr>
                </table>
                <p style="margin-top:16px;color:#666;">
                  Please submit to factoring: RateCon + BOL + freight photos.<br/>
                  Documents are stored in TRAQ-IQ under Load #${load.loadNumber}.
                </p>
                <p style="color:#999;font-size:12px;">Sent automatically by TRAQ-IQ Load Lifecycle · LAMP Logistics</p>
              `,
            });

            sentEinsteinPkg.add(load.id);
            await storage.updateLoad(load.id, {
              sopProgress: { ...sopProgress, einsteinSubmitted: true, einsteinSubmittedAt: new Date().toISOString() },
            });
            console.log(`[Lifecycle] 📧 Einstein factoring package sent for load #${load.loadNumber}`);
          } catch (e: any) {
            console.error(`[Lifecycle] Einstein email error:`, e.message);
          }
        }
      }

      // ── PHASE 5B: Thank-you email to broker ──
      if (
        load.status === "delivered" &&
        !sentThankYou.has(load.id) &&
        !sopProgress.thankYouSent
      ) {
        const brokerEmail = (load as any).brokerEmail || (load as any).broker_email || (load as any).customerEmail;
        const brokerName  = (load as any).brokerName  || (load as any).broker_name  || (load as any).customerName || "Team";

        if (brokerEmail) {
          try {
            await mailer.sendMail({
              from: process.env.SMTP_USER || "dispatch@traqiq.app",
              to: brokerEmail,
              subject: `POD — Load #${load.loadNumber} | ${(load as any).originCity || ""} → ${(load as any).destCity || ""}`,
              html: `
                <p>Hi ${brokerName.split(" ")[0]},</p>
                <p>Thank you for the opportunity to haul Load #${load.loadNumber}. Please find the Proof of Delivery attached.</p>
                <p>It was a pleasure working with your team. We look forward to working with you again soon.</p>
                <br/>
                <p>Best,<br/>LAMP Logistics Dispatch<br/>dispatch@traqiq.app</p>
                <p style="color:#999;font-size:12px;">Sent automatically by TRAQ-IQ · LAMP Logistics</p>
              `,
            });

            sentThankYou.add(load.id);
            await storage.updateLoad(load.id, {
              sopProgress: { ...sopProgress, thankYouSent: true, thankYouSentAt: new Date().toISOString() },
            });
            console.log(`[Lifecycle] 📧 Thank-you email sent to broker for load #${load.loadNumber}`);
          } catch (e: any) {
            console.error(`[Lifecycle] Thank-you email error:`, e.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Lifecycle] Run error:", err.message);
  }
}

// ─── Service export ───────────────────────────────────────────────────────────

let job: cron.ScheduledTask | null = null;

export const loadLifecycleService = {
  start() {
    if (job) return;
    // Run immediately then every 2 minutes
    runLifecycleCheck();
    job = cron.schedule("*/2 * * * *", runLifecycleCheck);
    console.log("[Lifecycle] Started — checking every 2 minutes");
  },

  stop() {
    job?.stop();
    job = null;
  },

  // Call this directly when driver sends YES (faster than waiting for cron)
  async triggerForLoad(loadId: string) {
    try {
      const load = await storage.getLoad(loadId);
      if (!load) return;
      const driver = await storage.getDriver(load.driverId!);
      if (!driver?.phone) return;

      const sopProgress: any = (load as any).sopProgress || {};
      if (load.driverConfirmedAt && !sopProgress.dispatchInstructionsSent) {
        const { smsLoadService } = await import("./sms-service");
        await smsLoadService.sendDispatchInstructions(load, driver);
        await storage.updateLoad(loadId, {
          status: "in_transit",
          sopProgress: { ...sopProgress, dispatchInstructionsSent: true, dispatchedAt: new Date().toISOString() },
        });
        console.log(`[Lifecycle] ⚡ Immediate dispatch instructions sent to ${driver.name}`);
      }
    } catch (e: any) {
      console.error("[Lifecycle] triggerForLoad error:", e.message);
    }
  },
};
