// "Your truck is free" — the ONE path in the split-authority feature set that texts a
// DRIVER rather than the operator. Treated accordingly.
//
// SAFETY GUARDS (CLAUDE.md financial-impact rule). PR #62 fired 1,000+ Twilio messages
// by converting dead code to live code against a backlog. Every guard below exists to
// make that impossible here:
//
//   1. Default OFF — TRUCK_FREE_SMS_ENABLED must be "true". Without it this module
//      imports cleanly, schedules nothing, and sends nothing.
//
//   2. Boot watermark — the first time a driver is ever seen, his state is recorded
//      SILENTLY. A deploy can never text anyone on its first tick.
//
//   3. Per-LOAD dedup — truck_free_notifications.load_id is a PRIMARY KEY. One text per
//      freeing load, ever. A re-tick, a restart, or a redeploy is a no-op.
//
//   4. Recency bound — only loads that delivered within TRUCK_FREE_LOOKBACK_MINUTES
//      (default 120) can notify. This is the hard cap on a redeploy's blast radius:
//      even if guards 2 and 3 were both defeated, the reachable population is only the
//      split-authority drivers freed in the last two hours.
//
//   5. Rate ceiling + kill switches — TRUCK_FREE_MAX_PER_TICK (default 3);
//      TRUCK_FREE_SMS_DISABLED=true halts instantly; the universal SMS_DISABLED=true
//      also aborts WITHOUT touching stored state.
//
//   6. Visibility — every send-or-suppress decision is logged with its reason, so a
//      runaway is visible in one tick rather than 1,000 messages later.
//
// Plus one guard the others do not have: quiet hours. A driver does not need a 3 AM
// text. Sends are confined to TRUCK_FREE_SEND_START_UTC..TRUCK_FREE_SEND_END_UTC
// (default 12:00-02:00 UTC, roughly 7 AM to 9 PM Central).
//
// Only split-authority drivers are ever considered. A company driver cannot be reached
// by this code at all.

import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { smsService } from './sms-service';
import { computeAvailability } from './truck-availability-service';
import { decideTruckFreeNotify, buildTruckFreeSms } from './truck-free-notify-service';

const DEFAULT_SCHEDULE = '*/15 * * * *';
const DEFAULT_MAX_PER_TICK = 3;
const DEFAULT_LOOKBACK_MIN = 120;

export interface FreeNotifyTickResult {
  considered: number;
  sent: number;
  skipped: Record<string, number>;
  errors: string[];
}

class TruckFreeNotifyCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;
    if (process.env.TRUCK_FREE_SMS_ENABLED !== 'true') {
      console.log('[truck-free] TRUCK_FREE_SMS_ENABLED is not "true" — cron not scheduled');
      return;
    }
    const schedule = process.env.TRUCK_FREE_SMS_CRON || DEFAULT_SCHEDULE;
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[truck-free] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🚚 Truck-free notifier running (schedule: ${schedule})`);
  }

  async tick(): Promise<FreeNotifyTickResult> {
    const result: FreeNotifyTickResult = { considered: 0, sent: 0, skipped: {}, errors: [] };
    const skip = (r: string) => { result.skipped[r] = (result.skipped[r] ?? 0) + 1; };

    if (process.env.TRUCK_FREE_SMS_DISABLED === 'true') {
      console.log('[truck-free] TRUCK_FREE_SMS_DISABLED=true — tick aborted');
      return result;
    }
    if (process.env.SMS_DISABLED === 'true') {
      console.log('[truck-free] SMS_DISABLED=true — tick aborted (stored state untouched)');
      return result;
    }
    if (!smsService.isServiceConfigured?.()) {
      console.log('[truck-free] SMS not configured — skipping');
      return result;
    }

    const now = new Date();
    const lookbackMinutes = Number(process.env.TRUCK_FREE_LOOKBACK_MINUTES || DEFAULT_LOOKBACK_MIN);
    const maxPerTick = Number(process.env.TRUCK_FREE_MAX_PER_TICK || DEFAULT_MAX_PER_TICK);
    const startHourUtc = Number(process.env.TRUCK_FREE_SEND_START_UTC ?? 12);
    const endHourUtc = Number(process.env.TRUCK_FREE_SEND_END_UTC ?? 2);

    // Candidate = split-authority driver whose most recent load delivered inside the
    // lookback window. The SQL itself enforces guard 4, so a stale backlog can never
    // even be read into memory.
    let rows: any[] = [];
    try {
      const r = await db.execute(sql`
        SELECT DISTINCT ON (l.driver_id)
               l.id AS load_id, l.load_number, l.driver_id, l.delivery_date, l.delivery_address,
               d.name AS driver_name, d.phone AS driver_phone,
               n.notified_at, n.load_id AS notified_load_id,
               EXISTS (
                 SELECT 1 FROM truck_free_notifications x WHERE x.driver_id = l.driver_id
               ) AS driver_seen
        FROM loads l
        JOIN drivers d
          ON d.id = l.driver_id AND COALESCE(d.split_authority_enabled, FALSE) = TRUE
        LEFT JOIN truck_free_notifications n ON n.load_id = l.id
        WHERE l.delivery_date IS NOT NULL
          AND l.delivery_date <= ${now}
          AND l.delivery_date >= ${new Date(now.getTime() - lookbackMinutes * 60000)}
        ORDER BY l.driver_id, l.delivery_date DESC
        LIMIT 50
      `);
      rows = (r as any).rows ?? [];
    } catch (e: any) {
      result.errors.push(`db read: ${e?.message || e}`);
      console.error('[truck-free] read failed — aborting to stay safe:', e?.message);
      return result;
    }

    result.considered = rows.length;

    for (const row of rows) {
      const availability = await this.availabilityFor(row, now);
      const decision = decideTruckFreeNotify(
        {
          state: availability.state,
          availableFrom: availability.availableFrom,
          firstLookExpiresAt: availability.firstLookExpiresAt,
          alreadyNotified: !!row.notified_load_id,
          isFirstSight: row.driver_seen !== true,
          driverPhone: row.driver_phone,
        },
        now,
        { lookbackMinutes, startHourUtc, endHourUtc },
      );

      if (decision.action === 'skip') {
        skip(decision.reason);
        console.log(`[truck-free] skip ${row.driver_name} load ${row.load_number}: ${decision.reason}`);
        // Baseline: record the driver silently so he is no longer first-sight, but do
        // NOT mark this load notified — a genuine future freeing still texts him.
        if (decision.reason === 'baseline') {
          await this.record(row, null, 'baseline');
        }
        continue;
      }

      if (result.sent >= maxPerTick) {
        skip('rate-ceiling');
        console.log(`[truck-free] rate ceiling ${maxPerTick} reached — ${row.driver_name} deferred`);
        continue;
      }

      const body = buildTruckFreeSms(row.delivery_address ?? null, availability.firstLookExpiresAt);
      const sent = await smsService.sendSMS({ to: row.driver_phone, body, skipFooter: true });
      if (sent.success) {
        await this.record(row, now, null);
        result.sent++;
        console.log(`[truck-free] SENT ${row.driver_name} load ${row.load_number}`);
      } else {
        result.errors.push(sent.error || 'sms failed');
        // Do NOT record — the send is retried next tick rather than silently lost.
        console.error(`[truck-free] SMS failed (${sent.error}) — not recorded, will retry`);
      }
    }

    console.log(
      `[truck-free] tick done: considered=${result.considered} sent=${result.sent} ` +
        `skipped=${JSON.stringify(result.skipped)}`,
    );
    return result;
  }

  private async availabilityFor(row: any, now: Date) {
    const b = await db.execute(sql`
      SELECT starts_at, ends_at FROM driver_availability_blocks
      WHERE driver_id = ${row.driver_id} AND ends_at > ${now}
    `);
    const blocks = ((b as any).rows ?? []).map((x: any) => ({
      startsAt: new Date(x.starts_at),
      endsAt: new Date(x.ends_at),
    }));
    return computeAvailability(
      {
        loadNumber: row.load_number,
        availableFrom: new Date(row.delivery_date),
        availableAt: row.delivery_address ?? null,
      },
      blocks,
      now,
    );
  }

  private async record(row: any, notifiedAt: Date | null, suppressedReason: string | null) {
    await db.execute(sql`
      INSERT INTO truck_free_notifications (load_id, driver_id, notified_at, suppressed_reason, created_at)
      VALUES (${row.load_id}, ${row.driver_id}, ${notifiedAt}, ${suppressedReason}, NOW())
      ON CONFLICT (load_id) DO UPDATE SET
        notified_at = COALESCE(EXCLUDED.notified_at, truck_free_notifications.notified_at),
        suppressed_reason = EXCLUDED.suppressed_reason
    `);
  }

  getStatus() {
    return {
      running: this.running,
      enabled: process.env.TRUCK_FREE_SMS_ENABLED === 'true',
      disabled: process.env.TRUCK_FREE_SMS_DISABLED === 'true',
      schedule: process.env.TRUCK_FREE_SMS_CRON || DEFAULT_SCHEDULE,
      maxPerTick: Number(process.env.TRUCK_FREE_MAX_PER_TICK || DEFAULT_MAX_PER_TICK),
      lookbackMinutes: Number(process.env.TRUCK_FREE_LOOKBACK_MINUTES || DEFAULT_LOOKBACK_MIN),
      sendWindowUtc: `${process.env.TRUCK_FREE_SEND_START_UTC ?? 12}:00-${process.env.TRUCK_FREE_SEND_END_UTC ?? 2}:00`,
    };
  }

  async triggerNow(): Promise<FreeNotifyTickResult> {
    return this.tick();
  }
}

export const truckFreeNotifyCron = new TruckFreeNotifyCron();
