// Daily COI lapse monitor — SMSes the operator when a split-authority owner-operator's
// insurance certificate is approaching expiry or has expired.
//
// Spec: docs/specs/coi-lapse-monitor-spec.md. Built to mirror
// server/fmcsa-monitor-cron.ts, which is the reference implementation in this repo for
// a guarded outbound monitor. Every decision is delegated to the pure predicates in
// server/coi-service.ts.
//
// SAFETY GUARDS (CLAUDE.md financial-impact rule — this is a NEW outbound SMS path):
//
//   1. Default OFF — only schedules when COI_MONITOR_ENABLED=true. Without it the
//      module imports cleanly, schedules nothing, and sends nothing.
//
//   2. Baseline watermark — the first time a document is ever seen, its state is
//      recorded SILENTLY. Rolling this out against a backlog of twelve already-expired
//      certificates sends ZERO messages. Only a NEW escalation after that alerts.
//
//   3. Per-document dedup — last_alerted_threshold is a monotonic ratchet. A given
//      document alerts at most once per threshold bucket, ever. Restart, double tick,
//      re-detect, or a corrected date moving the wrong way all send nothing.
//
//   4. Rate ceiling — COI_MONITOR_MAX_PER_TICK (default 5). At the cap the tick stops
//      sending and logs the remainder; unsent documents keep their old state and are
//      picked up on the next tick.
//
//   5. Kill switches — COI_MONITOR_DISABLED=true halts ticks instantly; the universal
//      SMS_DISABLED=true also aborts WITHOUT touching stored state, so a lapse that
//      lands while SMS is off is still pending rather than silently swallowed.
//
//   6. Visibility — every per-document decision is logged, so a runaway is visible in
//      one tick rather than 1,000 messages later.
//
// SMS failure does NOT advance the alert state, so the escalation retries next tick.

import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { smsService } from './sms-service';
import {
  daysUntil,
  thresholdBucket,
  decideCoiAlert,
  buildCoiAlertSms,
  REQUIRED_COI_TYPES,
} from './coi-service';

const DEFAULT_SCHEDULE = '0 13 * * *'; // 13:00 UTC (~8 AM CT). Not 08:00 — that is FMCSA's slot.
const DEFAULT_MAX_PER_TICK = 5;

export interface CoiTickResult {
  checked: number;
  baselines: number;
  alertsSent: number;
  dedup: number;
  noChange: number;
  cappedOut: number;
  errors: string[];
}

class CoiMonitorCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;
    if (process.env.COI_MONITOR_ENABLED !== 'true') {
      console.log('[coi-cron] COI_MONITOR_ENABLED is not "true" — cron not scheduled');
      return;
    }
    const schedule = process.env.COI_MONITOR_CRON || DEFAULT_SCHEDULE;
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[coi-cron] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🛡️ COI lapse monitor cron running (schedule: ${schedule})`);
  }

  async tick(): Promise<CoiTickResult> {
    const result: CoiTickResult = {
      checked: 0, baselines: 0, alertsSent: 0, dedup: 0, noChange: 0, cappedOut: 0, errors: [],
    };

    if (process.env.COI_MONITOR_DISABLED === 'true') {
      console.log('[coi-cron] COI_MONITOR_DISABLED=true — tick aborted');
      return result;
    }
    // Abort WITHOUT touching stored state so nothing is silently swallowed.
    if (process.env.SMS_DISABLED === 'true') {
      console.log('[coi-cron] SMS_DISABLED=true — tick aborted (stored state untouched)');
      return result;
    }

    const phone = process.env.COI_ALERT_PHONE || process.env.DISPATCHER_PHONE_NUMBER;
    if (!phone) {
      console.log('[coi-cron] no COI_ALERT_PHONE / DISPATCHER_PHONE_NUMBER — cannot alert');
      return result;
    }
    if (!smsService.isServiceConfigured?.()) {
      console.log('[coi-cron] SMS not configured — skipping');
      return result;
    }

    const maxPerTick = Number(process.env.COI_MONITOR_MAX_PER_TICK || DEFAULT_MAX_PER_TICK);
    const now = new Date();

    // Only split-authority drivers, only required coverage types, only inside the
    // widest threshold. Everything else is not this monitor's business.
    let rows: any[] = [];
    try {
      const r = await db.execute(sql`
        SELECT cd.id, cd.driver_id, cd.type, cd.expiry_date, d.name AS driver_name,
               s.last_alerted_threshold, s.baseline_recorded_at
        FROM compliance_documents cd
        JOIN drivers d ON d.id = cd.driver_id AND COALESCE(d.split_authority_enabled, FALSE) = TRUE
        LEFT JOIN coi_alert_state s ON s.document_id = cd.id
        WHERE cd.status = 'active'
          AND cd.type = ANY(${REQUIRED_COI_TYPES as unknown as string[]})
          AND cd.expiry_date <= NOW() + INTERVAL '31 days'
        ORDER BY cd.expiry_date ASC
        LIMIT 200
      `);
      rows = (r as any).rows ?? [];
    } catch (e: any) {
      result.errors.push(`db read: ${e?.message || e}`);
      console.error('[coi-cron] read failed — aborting to stay safe:', e?.message);
      return result;
    }

    result.checked = rows.length;

    for (const row of rows) {
      const expiry = new Date(row.expiry_date);
      const left = daysUntil(expiry, now);
      const bucket = thresholdBucket(left);
      const isFirstSight = !row.baseline_recorded_at;
      const prev = row.last_alerted_threshold === null || row.last_alerted_threshold === undefined
        ? null
        : Number(row.last_alerted_threshold);

      const decision = decideCoiAlert(prev, isFirstSight, bucket);

      if (decision.action === 'baseline') {
        await this.upsert(row, decision.threshold, false, now);
        result.baselines++;
        console.log(`[coi-cron] baseline ${row.type} for ${row.driver_name} (${left}d) — no alert (watermark)`);
        continue;
      }
      if (decision.action === 'no-change') {
        await this.touch(row.id, now);
        result.noChange++;
        continue;
      }
      if (decision.action === 'dedup') {
        await this.touch(row.id, now);
        result.dedup++;
        console.log(`[coi-cron] dedup ${row.type} for ${row.driver_name} (bucket ${decision.threshold})`);
        continue;
      }

      // action === 'alert'
      if (result.alertsSent >= maxPerTick) {
        result.cappedOut++;
        console.log(`[coi-cron] rate ceiling ${maxPerTick} reached — ${row.type} for ${row.driver_name} deferred to next tick`);
        continue;
      }

      const body = buildCoiAlertSms(row.driver_name ?? 'Driver', row.type, left, expiry);
      const sent = await smsService.sendSMS({ to: phone, body, skipFooter: true });
      if (sent.success) {
        await this.upsert(row, decision.threshold, true, now);
        result.alertsSent++;
        console.log(`[coi-cron] ALERT ${row.type} for ${row.driver_name} (${left}d, bucket ${decision.threshold})`);
      } else {
        result.errors.push(sent.error || 'sms failed');
        // Do NOT advance the ratchet — the escalation is re-detected next tick.
        await this.touch(row.id, now);
        console.error(`[coi-cron] SMS failed (${sent.error}) — state not advanced, will retry`);
      }
    }

    console.log(
      `[coi-cron] tick done: checked=${result.checked} baselines=${result.baselines} ` +
        `alerts=${result.alertsSent} dedup=${result.dedup} capped=${result.cappedOut}`,
    );
    return result;
  }

  private async upsert(row: any, threshold: number | null, alertSent: boolean, now: Date) {
    await db.execute(sql`
      INSERT INTO coi_alert_state
        (document_id, driver_id, doc_type, expiry_date, last_alerted_threshold,
         baseline_recorded_at, last_checked_at, last_alert_sent_at, updated_at)
      VALUES
        (${row.id}, ${row.driver_id}, ${row.type}, ${row.expiry_date}, ${threshold},
         NOW(), ${now}, ${alertSent ? now : null}, NOW())
      ON CONFLICT (document_id) DO UPDATE SET
        expiry_date = EXCLUDED.expiry_date,
        last_alerted_threshold = ${threshold},
        last_checked_at = EXCLUDED.last_checked_at,
        last_alert_sent_at = COALESCE(EXCLUDED.last_alert_sent_at, coi_alert_state.last_alert_sent_at),
        updated_at = NOW()
    `);
  }

  private async touch(documentId: string, now: Date) {
    await db.execute(sql`
      UPDATE coi_alert_state SET last_checked_at = ${now}, updated_at = NOW()
      WHERE document_id = ${documentId}
    `);
  }

  getStatus() {
    return {
      running: this.running,
      enabled: process.env.COI_MONITOR_ENABLED === 'true',
      disabled: process.env.COI_MONITOR_DISABLED === 'true',
      alertPhoneConfigured: !!(process.env.COI_ALERT_PHONE || process.env.DISPATCHER_PHONE_NUMBER),
      maxPerTick: Number(process.env.COI_MONITOR_MAX_PER_TICK || DEFAULT_MAX_PER_TICK),
      schedule: process.env.COI_MONITOR_CRON || DEFAULT_SCHEDULE,
    };
  }

  async triggerNow(): Promise<CoiTickResult> {
    return this.tick();
  }
}

export const coiMonitorCron = new CoiMonitorCron();
