// Daily HOS (Hours of Service) check
// Every morning at 6 AM (configurable), SMS each on-roster driver:
//   "TRAQ IQ — reply ON if on duty, OFF if off duty."
// Drivers reply ON/OFF (handled in sms-communication-service.ts) which sets
// drivers.is_on_duty. The geofence cron only triggers photo-upload SMS for
// drivers currently on duty, so off-duty drivers don't get pinged.
//
// SAFETY GUARDS (added per CLAUDE.md financial-impact rule):
//
//   1. Default OFF — cron only starts when HOS_CHECK_ENABLED=true. Without
//      that env var, the module imports cleanly but never schedules anything,
//      never calls SMS. Removes the deploy-time blast risk.
//
//   2. Per-driver-per-day dedup — every send writes to hos_check_log keyed
//      on (driver_id, date). If the cron fires twice in one day (server
//      restart, timezone drift, accidental double-schedule) the second
//      attempt is a no-op for already-sent drivers.
//
//   3. Rate ceiling — MAX_SENDS_PER_TICK caps how many drivers can be
//      messaged in a single tick. If the roster grows beyond this, the
//      tick halts and logs an alert. Tunable via HOS_MAX_SENDS_PER_TICK.
//
//   4. Kill switch — HOS_CHECK_DISABLED=true halts ticks immediately
//      without restarting the process. Belt-and-suspenders alongside the
//      universal SMS_DISABLED switch.

import cron from 'node-cron';
import { db } from './db';
import { drivers } from '@shared/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { smsService } from './sms-service';

const HOS_PROMPT =
  "TRAQ IQ — reply ON if you are on duty today, OFF if you are off duty. " +
  "On-duty drivers will receive load updates and pickup/delivery photo prompts.";

const DEFAULT_MAX_SENDS_PER_TICK = 60;

export interface HosTickResult {
  drivers: number;
  sent: number;
  failed: number;
  skippedDedup: number;
  rateCappedAt: number | null;
  errors: string[];
}

function todayUtcDateString(): string {
  // YYYY-MM-DD in UTC. Same key for the entire 24h window regardless of
  // when in the day a duplicate tick fires. Sufficient for dedup purposes.
  return new Date().toISOString().slice(0, 10);
}

class HosCheckCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;

    // SAFETY: default OFF. Required env var to even schedule anything.
    if (process.env.HOS_CHECK_ENABLED !== 'true') {
      console.log('[hos-cron] HOS_CHECK_ENABLED is not "true" — cron not scheduled');
      return;
    }

    const schedule = process.env.HOS_CHECK_CRON || '0 6 * * *';
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[hos-cron] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🌅 HOS check cron running (schedule: ${schedule})`);
  }

  async tick(): Promise<HosTickResult> {
    const result: HosTickResult = {
      drivers: 0,
      sent: 0,
      failed: 0,
      skippedDedup: 0,
      rateCappedAt: null,
      errors: [],
    };

    // Kill switch — checked at tick time so flipping it takes effect on the
    // next scheduled fire without a process restart.
    if (process.env.HOS_CHECK_DISABLED === 'true') {
      console.log('[hos-cron] HOS_CHECK_DISABLED=true — tick aborted');
      return result;
    }

    // Universal SMS kill switch (PR #63). If SMS_DISABLED=true the underlying
    // sms-service returns failure for every send; we short-circuit here too
    // so we don't churn through the driver list pointlessly.
    if (process.env.SMS_DISABLED === 'true') {
      console.log('[hos-cron] SMS_DISABLED=true — tick aborted');
      return result;
    }

    if (!smsService.isServiceConfigured?.()) {
      console.log('[hos-cron] SMS not configured — skipping');
      return result;
    }

    const maxSends = Math.max(
      1,
      Math.min(500, Number(process.env.HOS_MAX_SENDS_PER_TICK) || DEFAULT_MAX_SENDS_PER_TICK),
    );
    const today = todayUtcDateString();

    const allDrivers = await db
      .select()
      .from(drivers)
      .where(isNotNull(drivers.phone));

    for (const drv of allDrivers) {
      const phone = drv.phone || drv.phoneNumber;
      if (!phone) continue;
      result.drivers++;

      // SAFETY: dedup. INSERT ... ON CONFLICT DO NOTHING — if this driver
      // already got the HOS prompt today, the insert is a no-op and rowCount
      // is 0, so we skip the SMS.
      let insertedRow: any = null;
      try {
        const inserted = await db.execute(sql`
          INSERT INTO hos_check_log (driver_id, send_date)
          VALUES (${drv.id}, ${today})
          ON CONFLICT (driver_id, send_date) DO NOTHING
          RETURNING id
        `);
        insertedRow = (inserted as any).rows?.[0] ?? null;
      } catch (e: any) {
        // If the table doesn't exist yet (first deploy before ensureSchema
        // runs), fall back to sending without dedup but log loudly. Better
        // than silently sending nothing.
        console.error('[hos-cron] dedup table unavailable, falling back to no-dedup:', e?.message);
        insertedRow = { fallback: true };
      }

      if (!insertedRow) {
        result.skippedDedup++;
        continue;
      }

      // Rate ceiling — defense in depth. If we somehow have hundreds of
      // drivers and somehow they all dedup-passed (e.g. first run after
      // a missed day), still cap the tick to a sane upper bound.
      if (result.sent >= maxSends) {
        result.rateCappedAt = maxSends;
        console.error(`[hos-cron] hit rate ceiling at ${maxSends} sends — halting tick. Set HOS_MAX_SENDS_PER_TICK to raise.`);
        break;
      }

      try {
        const r = await smsService.sendSMS({
          to: phone,
          body: HOS_PROMPT,
          skipFooter: true,
        });
        if (r.success) {
          result.sent++;
        } else {
          result.failed++;
          result.errors.push(`${drv.name}: ${r.error}`);
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push(`${drv.name}: ${e?.message || e}`);
      }
    }

    console.log(
      `[hos-cron] tick done — ${result.drivers} drivers, ${result.sent} sent, ` +
        `${result.skippedDedup} skipped (already sent today), ${result.failed} failed` +
        (result.rateCappedAt ? `, capped at ${result.rateCappedAt}` : ''),
    );
    return result;
  }

  getStatus() {
    return {
      running: this.running,
      enabled: process.env.HOS_CHECK_ENABLED === 'true',
      disabled: process.env.HOS_CHECK_DISABLED === 'true',
      schedule: process.env.HOS_CHECK_CRON || '0 6 * * *',
      maxSendsPerTick:
        Number(process.env.HOS_MAX_SENDS_PER_TICK) || DEFAULT_MAX_SENDS_PER_TICK,
    };
  }

  async triggerNow() {
    return this.tick();
  }
}

export const hosCheckCron = new HosCheckCron();
