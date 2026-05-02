import type { Express } from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { drivers, loads } from "@shared/schema";
import { requireRole } from "../auth";

/**
 * Admin diagnostic endpoints. The whole point: when something silently
 * doesn't work (SMS doesn't arrive, dispatch fails, footer skipped),
 * the user can hit one URL and see exactly why instead of guessing.
 *
 *   GET  /api/admin/health                       - global config + DB schema check
 *   GET  /api/admin/dispatch-diagnose/:loadId    - per-load preconditions
 */

const EXPECTED_DRIVER_COLUMNS = [
  "id", "company_id", "name", "email", "phone", "phone_number", "city",
  "status", "license_number", "emergency_contact", "emergency_phone",
  "is_onboarded", "equipment_type", "load_type", "max_length", "max_weight",
  "enable_sms_notifications", "sms_consent_at", "sms_consent_source",
  "sms_consent_ip", "sms_opted_out_at", "current_mood", "tracking_token",
  "pay_type", "pay_rate",
];

async function listDriverColumns(): Promise<string[]> {
  if (!pool) return [];
  try {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'drivers'`
    );
    return r.rows.map((row: any) => row.column_name);
  } catch {
    return [];
  }
}

export function registerAdminHealthRoutes(app: Express) {
  // Global health: Twilio config, env vars, DB schema completeness
  app.get("/api/admin/health", requireRole("admin"), async (_req, res) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    // Twilio creds
    const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    checks.push({
      name: "Twilio credentials",
      ok: twilioConfigured,
      detail: twilioConfigured
        ? "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set"
        : "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN — SMS will never send",
    });

    // Messaging Service SID (10DLC)
    const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID || "";
    checks.push({
      name: "10DLC Messaging Service SID",
      ok: !!msgSid && msgSid.startsWith("MG"),
      detail: msgSid
        ? `Set to ${msgSid}`
        : "TWILIO_MESSAGING_SERVICE_SID is not set — sends will fall back to raw phone number and may be filtered by carriers",
    });

    // Direct Twilio number (fallback)
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER || "";
    checks.push({
      name: "Twilio phone number (fallback)",
      ok: !!twilioPhone,
      detail: twilioPhone ? `Set to ${twilioPhone}` : "TWILIO_PHONE_NUMBER unset (only critical if Messaging Service SID is also unset)",
    });

    // Dispatcher alert phone
    const dispatcherPhone = process.env.DISPATCHER_PHONE_NUMBER || process.env.DISPATCHER_PHONE || "";
    checks.push({
      name: "Dispatcher alert phone",
      ok: !!dispatcherPhone,
      detail: dispatcherPhone
        ? `Set to ${dispatcherPhone} — RateCon-no-driver alerts will go here`
        : "DISPATCHER_PHONE_NUMBER unset — admin alerts about new RateCons won't be sent",
    });

    // Custom domain for SMS links
    const customDomain = process.env.CUSTOM_DOMAIN || "";
    checks.push({
      name: "Custom domain (CUSTOM_DOMAIN)",
      ok: !!customDomain,
      detail: customDomain ? `Set to ${customDomain}` : "Defaults to https://traqiq.app — set CUSTOM_DOMAIN to override",
    });

    // SMS minimal mode flag
    const smsMinimal = process.env.SMS_MINIMAL === "true";
    checks.push({
      name: "SMS template mode",
      ok: true,
      detail: smsMinimal
        ? "SMS_MINIMAL=true → keyword-only template (URLs stripped). Set SMS_MINIMAL=false (or unset) for rich template"
        : "Rich template active (icons + URLs + driver dashboard footer)",
    });

    // DB schema completeness — drivers table
    const actualColumns = await listDriverColumns();
    const missingColumns = EXPECTED_DRIVER_COLUMNS.filter((c) => !actualColumns.includes(c));
    checks.push({
      name: "DB schema: drivers columns",
      ok: missingColumns.length === 0,
      detail: missingColumns.length === 0
        ? `All ${EXPECTED_DRIVER_COLUMNS.length} expected columns present`
        : `MISSING: ${missingColumns.join(", ")} — run ensureSchema or restart the server`,
    });

    // DB connectivity
    let dbConnectivity = false;
    let driverCount = -1;
    let loadCount = -1;
    try {
      const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(drivers);
      driverCount = r.c;
      const [r2] = await db.select({ c: sql<number>`count(*)::int` }).from(loads);
      loadCount = r2.c;
      dbConnectivity = true;
    } catch (e: any) {
      checks.push({ name: "DB connectivity", ok: false, detail: `Query failed: ${e?.message ?? e}` });
    }
    if (dbConnectivity) {
      checks.push({ name: "DB connectivity", ok: true, detail: `${driverCount} drivers, ${loadCount} loads` });
    }

    const allOk = checks.every((c) => c.ok);
    res.json({ ok: allOk, checks, env: { node: process.version } });
  });

  // Per-load dispatch diagnosis. Walks every precondition sendDispatchSms checks
  // and reports pass/fail with explanation. Does NOT actually send the SMS.
  app.get("/api/admin/dispatch-diagnose/:loadId", requireRole("admin"), async (req, res) => {
    const { loadId } = req.params;
    const findings: Array<{ name: string; ok: boolean; detail: string }> = [];

    // 1. Load exists?
    const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
    if (!load) {
      return res.json({
        ok: false,
        wouldDispatch: false,
        findings: [{ name: "Load lookup", ok: false, detail: `No load with id=${loadId}` }],
      });
    }
    findings.push({
      name: "Load lookup",
      ok: true,
      detail: `Load #${load.loadNumber} (${load.brokerName ?? "no broker"})`,
    });

    // 2. Driver assigned?
    findings.push({
      name: "Driver assigned",
      ok: !!load.driverId,
      detail: load.driverId ? `driver_id=${load.driverId}` : "load.driverId is null — Approve & Dispatch will reject with 'Load or driver missing'",
    });
    if (!load.driverId) {
      return res.json({ ok: false, wouldDispatch: false, findings });
    }

    // 3. Driver row exists?
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
    findings.push({
      name: "Driver row exists",
      ok: !!driver,
      detail: driver ? `${driver.name} (${driver.id})` : `driver_id=${load.driverId} not found in drivers table`,
    });
    if (!driver) {
      return res.json({ ok: false, wouldDispatch: false, findings });
    }

    // 4. Driver has phone?
    const phone = (driver as any).phoneNumber ?? (driver as any).phone;
    findings.push({
      name: "Driver phone",
      ok: !!phone,
      detail: phone ? `Will send to ${phone}` : "Driver has no phone or phoneNumber — dispatch will return 'Driver has no phone'",
    });

    // 5. Driver opted out?
    findings.push({
      name: "Opt-out status",
      ok: !driver.smsOptedOutAt,
      detail: driver.smsOptedOutAt
        ? `BLOCKED: driver opted out at ${new Date(driver.smsOptedOutAt).toISOString()} — sms-service hard-skips. Have driver text START to resubscribe.`
        : "Driver has not opted out",
    });

    // 6. Has tracking token (for dashboard footer to render)?
    findings.push({
      name: "Tracking token (for dashboard footer)",
      ok: !!driver.trackingToken,
      detail: driver.trackingToken
        ? `Footer will link to /driver/${driver.trackingToken}`
        : "No trackingToken — dashboard footer will be skipped (SMS still sends, just without the 👤 link)",
    });

    // 7. Twilio reachable?
    const twilioOk = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    findings.push({
      name: "Twilio configured",
      ok: twilioOk,
      detail: twilioOk ? "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN present" : "Twilio creds missing — sendSMS will return success:false",
    });

    const wouldDispatch = findings.every((f) => f.ok || f.name === "Tracking token (for dashboard footer)");
    res.json({
      ok: wouldDispatch,
      wouldDispatch,
      findings,
      load: { id: load.id, loadNumber: load.loadNumber, brokerName: load.brokerName, driverId: load.driverId, confirmationToken: load.confirmationToken },
      driver: driver
        ? { id: driver.id, name: driver.name, phone, smsOptedOutAt: driver.smsOptedOutAt, trackingToken: driver.trackingToken }
        : null,
    });
  });
}
