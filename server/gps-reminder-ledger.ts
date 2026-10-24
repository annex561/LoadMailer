// Persistent cap + cooldown for the GPS "Tracking Stopped" reminder SMS
// (server/gps-health-monitor.ts). One gps_reminder_log row per attempt, written
// BEFORE the SMS goes out, so a deploy, a restart or a second container can't
// reset the count. Table is created by ensure-schema.ts.
//
// Fails closed: if the log can't be read or written, no reminder is sent.

import { sql } from "drizzle-orm";
import { db } from "./db";

const DEFAULT_DAILY_CAP = 6;

// GPS_REMINDER_DAILY_CAP: unset/empty → 6. A plain non-negative integer → that.
// Anything else ("abc", "6.5", "-1") → 0, i.e. no reminders, so a typo never raises the cap.
export function gpsReminderDailyCap(raw = process.env.GPS_REMINDER_DAILY_CAP): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_CAP;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
  console.error(`❌ GPS_REMINDER_DAILY_CAP="${raw}" is not a whole number — GPS reminders halted`);
  return 0;
}

export type ReminderVerdict = { ok: true } | { ok: false; reason: "daily_cap" | "cooldown" | "ledger_error" };

export async function reserveGpsReminder(
  driverId: string,
  loadId: string | null,
  cooldownMinutes: number,
): Promise<ReminderVerdict> {
  const cap = gpsReminderDailyCap();
  try {
    return await db.transaction(async (tx: any) => {
      // Serialise per driver so two containers ticking at the same second can't both pass.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${driverId}))`);
      const r = await tx.execute(sql`
        SELECT count(*)::int AS sent_24h,
               count(*) FILTER (WHERE sent_at > NOW() - make_interval(mins => ${cooldownMinutes}))::int AS sent_cooldown
        FROM gps_reminder_log
        WHERE driver_id = ${driverId} AND sent_at > NOW() - INTERVAL '24 hours'
      `);
      const row = (r as any).rows?.[0];
      if (!row) throw new Error("gps_reminder_log count returned no row");
      if (Number(row.sent_cooldown) > 0) return { ok: false, reason: "cooldown" } as const;
      if (Number(row.sent_24h) >= cap) return { ok: false, reason: "daily_cap" } as const;
      await tx.execute(sql`INSERT INTO gps_reminder_log (driver_id, load_id) VALUES (${driverId}, ${loadId})`);
      return { ok: true } as const;
    });
  } catch (error: any) {
    console.error(`❌ GPS reminder ledger unavailable for driver ${driverId} — not sending: ${error?.message || error}`);
    return { ok: false, reason: "ledger_error" };
  }
}
