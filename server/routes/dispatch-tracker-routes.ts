/**
 * S14 — LAMP Dispatch Tracker routes.
 *
 * GET   /api/dispatch/board              — staff dispatcher board (all recent loads + checklist)
 * PATCH /api/loads/:id/dispatch-checklist — update lane checklist fields (staff only)
 * POST  /api/loads/:id/bol-required-override — staff override signedBolRequired (audit-logged)
 * POST  /api/dispatch/run-alerts         — fire deadline alerts (call via cron/n8n; staff only)
 *
 * 14a-1: broker fields (brokerName, brokerPhone, brokerEmail) ARE included in the
 * board response because this endpoint is staff-only. They must NEVER appear in
 * driver-facing endpoints (driver-load-texts, driver-sms-upload-routes, etc.).
 *
 * Every new alert flag defaults OFF:
 *   DISPATCH_ALERT_NO_CONFIRM   — alert when driver unconfirmed before pickup
 *   DISPATCH_ALERT_NO_POD       — alert when no POD 1h after delivery
 *   DISPATCH_ALERT_NO_INVOICE   — alert when no invoice 24h after delivery
 */

import type { Express } from "express";
import { db } from "../db";
import { loads, bolOverrideAudit } from "@shared/schema";
import { and, desc, gte, isNull, lt, or, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "../auth";
import { z } from "zod";

// Fields the dispatcher can update via the checklist endpoint
const checklistPatchSchema = z.object({
  lane2BrokerVerified: z.enum(["Y", "N", "not_yet"]).optional(),
  lane2BrokerVerifiedBy: z.string().optional(),
  lane3AppointmentStatus: z.enum(["Y", "N", "not_yet"]).optional(),
  lane5ArUpdated: z.enum(["Y", "N", "not_yet"]).optional(),
  relayTasks: z.string().optional(),
  dispatchNotes: z.string().optional(),
});

/** Send an SMS alert to OWNER_ALERT_PHONE (non-fatal — fails silently if not set). */
async function alertOwner(body: string): Promise<void> {
  const phone = process.env.OWNER_ALERT_PHONE?.trim();
  if (!phone) return;
  try {
    const { smsLoadService } = await import("../sms-service");
    await (smsLoadService as any).sendSMS(phone, body);
  } catch (err: any) {
    console.error(`[dispatch-tracker] alert SMS failed: ${err.message}`);
  }
}

// run-alerts sends ONE digest SMS per run, at most once per hour, and only looks
// at deliveries from the last 7 days, so a cron or a flag flip can never blast
// the historical backlog (the PR #62 pattern). Pinned by
// server/__tests__/dispatch-run-alerts-digest.test.ts
const ALERT_DIGEST_INTERVAL_MS = 60 * 60 * 1000;
const ALERT_LOOKBACK_MS = 7 * 86_400_000;
let lastAlertDigestAt = 0; // ponytail: process-scoped throttle, fine on one instance

export function _resetAlertDigestThrottle(): void {
  lastAlertDigestAt = 0;
}

export function registerDispatchTrackerRoutes(app: Express) {
  // ──────────────────────────────────────────────
  // GET /api/dispatch/board — staff-only board view
  // Returns up to 200 most recent loads with all checklist columns.
  // Broker fields included here because this is a staff-only endpoint (14a-1).
  // ──────────────────────────────────────────────
  app.get("/api/dispatch/board", isAuthenticated, async (_req, res) => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30); // last 30 days

      const rows = await db
        .select()
        .from(loads)
        .where(gte(loads.createdAt, cutoff))
        .orderBy(desc(loads.createdAt))
        .limit(200);

      // Compute derived lane statuses for each load
      const board = rows.map((load: typeof rows[number]) => {
        const now = Date.now();

        // Lane 3 — driver confirmed: derived from driverTextConfirmedAt (S13 column)
        const lane3DriverConfirmed = load.driverTextConfirmedAt ? "Y" : "not_yet";

        // Lane 4 — Love's submission: derived from factoringStatus
        const lane4Factoring = (() => {
          const s = load.factoringStatus;
          if (s === "submitted" || s === "funded") return "Y";
          if (s === "rejected" || s === "manual_review") return "N";
          return "not_yet";
        })();

        // Lane 5 — POD within 1h: Y if podUploadedAt within 1h of deliveredAt
        const lane5Pod = (() => {
          if (!load.deliveredAt) return "not_yet";
          if (!load.podUploadedAt) return "not_yet";
          const diffMs = new Date(load.podUploadedAt).getTime() - new Date(load.deliveredAt).getTime();
          return diffMs <= 3_600_000 ? "Y" : "N";
        })();

        // Lane 5 — invoice within 24h: derived from factoringSubmittedAt vs deliveredAt
        const lane5Invoice = (() => {
          if (!load.deliveredAt) return "not_yet";
          if (!load.factoringSubmittedAt) return "not_yet";
          const diffMs = new Date(load.factoringSubmittedAt).getTime() - new Date(load.deliveredAt).getTime();
          return diffMs <= 86_400_000 ? "Y" : "N";
        })();

        return {
          ...load,
          // Derived (computed) fields — read-only, not stored
          lane3DriverConfirmed,
          lane4Factoring,
          lane5Pod,
          lane5Invoice,
        };
      });

      return res.json(board);
    } catch (err: any) {
      console.error("[dispatch-tracker] board error:", err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // PATCH /api/loads/:id/dispatch-checklist
  // Update stored lane checklist fields on a load (staff only).
  // Automatically timestamps lane2BrokerVerifiedAt when set to 'Y'.
  // ──────────────────────────────────────────────
  app.patch("/api/loads/:id/dispatch-checklist", isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const parsed = checklistPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid fields", errors: parsed.error.errors });
    }

    const data = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (data.lane2BrokerVerified !== undefined) {
      updates.lane2BrokerVerified = data.lane2BrokerVerified;
      if (data.lane2BrokerVerified === "Y") {
        updates.lane2BrokerVerifiedAt = new Date();
        updates.lane2BrokerVerifiedBy =
          data.lane2BrokerVerifiedBy ?? (req.user as any)?.email ?? "staff";
      }
    }
    if (data.lane3AppointmentStatus !== undefined) updates.lane3AppointmentStatus = data.lane3AppointmentStatus;
    if (data.lane5ArUpdated !== undefined) updates.lane5ArUpdated = data.lane5ArUpdated;
    if (data.relayTasks !== undefined) updates.relayTasks = data.relayTasks;
    if (data.dispatchNotes !== undefined) updates.dispatchNotes = data.dispatchNotes;

    await db.update(loads).set(updates as any).where(eq(loads.id, id));
    return res.json({ ok: true });
  });

  // ──────────────────────────────────────────────
  // POST /api/loads/:id/bol-required-override
  // Staff override for signedBolRequired. Every flip is audit-logged (who, when, why).
  // FALSE skips ONLY the signed-BOL gate; the load must still be delivered + POD in
  // and pass the 90% check or have Annex's OK before Love's submission.
  // ──────────────────────────────────────────────
  app.post("/api/loads/:id/bol-required-override", isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { newValue, reason } = req.body as { newValue: unknown; reason: unknown };

    if (typeof newValue !== "boolean") {
      return res.status(400).json({ message: "newValue must be boolean" });
    }
    if (typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ message: "reason is required" });
    }

    const overriddenBy = (req.user as any)?.email ?? "staff";

    await db
      .update(loads)
      .set({ signedBolRequired: newValue, updatedAt: new Date() } as any)
      .where(eq(loads.id, id));

    await db.insert(bolOverrideAudit).values({
      loadId: id,
      overriddenBy,
      reason: reason.trim(),
      newValue,
    });

    console.log(
      `[dispatch-tracker] signedBolRequired=${newValue} on load ${id} by ${overriddenBy}: ${reason.trim()}`,
    );

    return res.json({ ok: true, loadId: id, newValue, overriddenBy });
  });

  // ──────────────────────────────────────────────
  // POST /api/dispatch/run-alerts
  // Fire deadline alerts for loads with overdue lanes.
  // All three flags default OFF — must be set in Railway env to enable.
  //   DISPATCH_ALERT_NO_CONFIRM=true  — alert if driver unconfirmed before pickup
  //   DISPATCH_ALERT_NO_POD=true      — alert if no POD 1h after delivery
  //   DISPATCH_ALERT_NO_INVOICE=true  — alert if no invoice 24h after delivery
  // Wire to an external cron or n8n webhook. Staff-only.
  // ──────────────────────────────────────────────
  app.post("/api/dispatch/run-alerts", isAuthenticated, async (_req, res) => {
    const alerts: string[] = [];
    const now = new Date();
    const lookback = new Date(now.getTime() - ALERT_LOOKBACK_MS);

    // Lane 3 — no confirm before pickup
    if (process.env.DISPATCH_ALERT_NO_CONFIRM === "true") {
      const unconfirmed = await db
        .select({ id: loads.id, loadNumber: loads.loadNumber, pickupDate: loads.pickupDate })
        .from(loads)
        .where(
          and(
            isNull(loads.driverTextConfirmedAt),
            isNull(loads.deliveredAt),
          ),
        )
        .limit(50);

      for (const load of unconfirmed) {
        if (!load.pickupDate) continue;
        const pickup = new Date(load.pickupDate);
        // Alert if pickup is within 4 hours and driver hasn't confirmed
        if (pickup.getTime() - now.getTime() < 4 * 3_600_000 && pickup > now) {
          const msg = `[LAMP Alert] Load #${load.loadNumber}: driver NOT confirmed and pickup is in <4h (${pickup.toISOString()})`;
          alerts.push(msg);
        }
      }
    }

    // Lane 5 — no POD within 1h of delivery
    if (process.env.DISPATCH_ALERT_NO_POD === "true") {
      const oneHourAgo = new Date(now.getTime() - 3_600_000);
      const noPod = await db
        .select({ id: loads.id, loadNumber: loads.loadNumber, deliveredAt: loads.deliveredAt })
        .from(loads)
        .where(
          and(
            isNull(loads.podPath),
            lt(loads.deliveredAt, oneHourAgo),
            gte(loads.deliveredAt, lookback),
            // /u/ and MMS uploads land in load_documents and never set podPath.
            sql`NOT EXISTS (SELECT 1 FROM load_documents d WHERE d.load_id = ${loads.id} AND d.document_type IN ('delivery_pod', 'delivery_signed_bol', 'pod'))`,
          ),
        )
        .limit(50);

      for (const load of noPod) {
        const msg = `[LAMP Alert] Load #${load.loadNumber}: no POD uploaded >1h after delivery`;
        alerts.push(msg);
      }
    }

    // Lane 5 — no invoice within 24h of delivery
    if (process.env.DISPATCH_ALERT_NO_INVOICE === "true") {
      const twentyFourHoursAgo = new Date(now.getTime() - 86_400_000);
      const noInvoice = await db
        .select({ id: loads.id, loadNumber: loads.loadNumber, deliveredAt: loads.deliveredAt })
        .from(loads)
        .where(
          and(
            isNull(loads.factoringSubmittedAt),
            lt(loads.deliveredAt, twentyFourHoursAgo),
            gte(loads.deliveredAt, lookback),
          ),
        )
        .limit(50);

      for (const load of noInvoice) {
        const msg = `[LAMP Alert] Load #${load.loadNumber}: no invoice submitted >24h after delivery`;
        alerts.push(msg);
      }
    }

    let digestSent = false;
    if (alerts.length > 0 && now.getTime() - lastAlertDigestAt >= ALERT_DIGEST_INTERVAL_MS) {
      lastAlertDigestAt = now.getTime();
      const top = alerts.slice(0, 3).map((a) => a.replace("[LAMP Alert] ", "")).join("\n");
      const more = alerts.length > 3 ? `\n+${alerts.length - 3} more at /dispatch/board` : "";
      await alertOwner(`[LAMP Alert] ${alerts.length} dispatch deadline(s):\n${top}${more}`);
      digestSent = true;
    }
    console.log(`[dispatch-tracker] run-alerts: ${alerts.length} overdue, digestSent=${digestSent}`);

    return res.json({ ok: true, alertsFired: alerts.length, digestSent, alerts });
  });
}
