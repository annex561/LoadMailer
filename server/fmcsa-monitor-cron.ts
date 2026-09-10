// Daily FMCSA monitor — checks a carrier's public FMCSA SAFER record and SMSes
// the operator ONLY when a monitored status CHANGES: USDOT status, operating
// authority, out-of-service order, or MCS-150 staleness. Built per the user's
// request to watch DOT 4397421 (LAMP PLLC) so a federal-standing change is
// caught fast instead of discovered when loads dry up.
//
// SAFETY GUARDS (CLAUDE.md financial-impact rule — this is a new outbound SMS path):
//
//   1. Default OFF — only schedules when FMCSA_MONITOR_ENABLED=true. Without it
//      the module imports cleanly but never schedules and never sends.
//
//   2. Baseline watermark — the first time a DOT is ever seen, the snapshot is
//      recorded SILENTLY (no SMS). A fresh deploy against a carrier that already
//      has e.g. an OOS order will NOT blast; only the NEXT change alerts. This is
//      the boot-watermark equivalent for a state monitor.
//
//   3. Per-state dedup — last_alerted_hash. Once an SMS fires for a given status,
//      the same status never re-alerts (double tick, restart, re-detect → no-op).
//
//   4. Rate ceiling — v1 watches one configured DOT, so at most ONE SMS per tick
//      by construction. (Multi-carrier expansion would add a per-tick cap here.)
//
//   5. Kill switches — FMCSA_MONITOR_DISABLED=true halts ticks instantly; the
//      universal SMS_DISABLED=true also aborts without touching stored state.
//
//   6. Visibility — every decision (baseline / no-change / dedup / alert / error)
//      is logged, so a runaway is visible in one tick, not 1,000 messages later.
//
// The alert decision is delegated to the pure, unit-tested predicates in
// server/fmcsa-service.ts (guarded by server/__tests__/fmcsa-monitor.test.ts).

import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { smsService } from './sms-service';
import {
  fetchSaferSnapshot,
  normalizeSnapshot,
  hashMonitoredState,
  decideFmcsaAlert,
  buildFmcsaAlertSms,
  type SaferRawSnapshot,
  type MonitoredState,
} from './fmcsa-service';

const DEFAULT_SCHEDULE = '0 8 * * *'; // 08:00 UTC daily (~3 AM CT)

export interface FmcsaTickResult {
  checked: number;
  baselineRecorded: boolean;
  changed: number;
  alertsSent: number;
  skippedDedup: boolean;
  noChange: boolean;
  errors: string[];
}

class FmcsaMonitorCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;

    // SAFETY: default OFF. Required env var to even schedule anything.
    if (process.env.FMCSA_MONITOR_ENABLED !== 'true') {
      console.log('[fmcsa-cron] FMCSA_MONITOR_ENABLED is not "true" — cron not scheduled');
      return;
    }

    const schedule = process.env.FMCSA_MONITOR_CRON || DEFAULT_SCHEDULE;
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[fmcsa-cron] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🛡️ FMCSA monitor cron running (schedule: ${schedule})`);
  }

  async tick(): Promise<FmcsaTickResult> {
    const result: FmcsaTickResult = {
      checked: 0,
      baselineRecorded: false,
      changed: 0,
      alertsSent: 0,
      skippedDedup: false,
      noChange: false,
      errors: [],
    };

    // Kill switch — evaluated at tick time so flipping it takes effect on the
    // next fire without a process restart.
    if (process.env.FMCSA_MONITOR_DISABLED === 'true') {
      console.log('[fmcsa-cron] FMCSA_MONITOR_DISABLED=true — tick aborted');
      return result;
    }

    // Universal SMS kill switch. We abort WITHOUT touching stored state, so a
    // change that lands while SMS is disabled is still pending and will alert
    // once SMS is re-enabled (never silently swallowed).
    if (process.env.SMS_DISABLED === 'true') {
      console.log('[fmcsa-cron] SMS_DISABLED=true — tick aborted (stored state untouched)');
      return result;
    }

    const dot = (process.env.FMCSA_MONITOR_DOT || '').trim();
    if (!dot) {
      console.log('[fmcsa-cron] FMCSA_MONITOR_DOT not set — nothing to check');
      return result;
    }

    const phone = process.env.FMCSA_ALERT_PHONE || process.env.DISPATCHER_PHONE_NUMBER;
    if (!phone) {
      console.log('[fmcsa-cron] no FMCSA_ALERT_PHONE / DISPATCHER_PHONE_NUMBER — cannot alert');
      return result;
    }
    if (!smsService.isServiceConfigured?.()) {
      console.log('[fmcsa-cron] SMS not configured — skipping');
      return result;
    }

    // Fetch the federal record. On any failure we log and return WITHOUT
    // modifying stored state — a transient SAFER outage must not look like a
    // status change.
    const fetched = await fetchSaferSnapshot(dot);
    if (!fetched.ok) {
      result.errors.push(fetched.error);
      console.error(`[fmcsa-cron] ${fetched.error} — skipping (stored state untouched)`);
      return result;
    }
    result.checked = 1;

    const raw = fetched.raw;
    const now = new Date();
    const curr = normalizeSnapshot(raw, now);
    const currHash = hashMonitoredState(curr);

    let prevRow: any = null;
    try {
      const r = await db.execute(sql`
        SELECT usdot_status, authority_status, out_of_service, mcs150, last_alerted_hash
        FROM fmcsa_carrier_snapshots
        WHERE dot_number = ${dot}
        LIMIT 1
      `);
      prevRow = (r as any).rows?.[0] ?? null;
    } catch (e: any) {
      result.errors.push(`db read: ${e?.message || e}`);
      console.error('[fmcsa-cron] snapshot table read failed — aborting to stay safe:', e?.message);
      return result;
    }

    const prev: MonitoredState | null = prevRow
      ? {
          usdotStatus: prevRow.usdot_status,
          authorityStatus: prevRow.authority_status,
          outOfService: prevRow.out_of_service,
          mcs150: prevRow.mcs150,
        }
      : null;

    const decision = decideFmcsaAlert(prev, curr, prevRow?.last_alerted_hash ?? null, currHash);

    if (decision.action === 'baseline') {
      await this.upsert(dot, raw, curr, currHash, null, now, false);
      result.baselineRecorded = true;
      console.log(
        `[fmcsa-cron] baseline recorded for DOT ${dot} (${raw.legalName}) — no alert (watermark)`,
      );
      return result;
    }

    if (decision.action === 'no-change') {
      await this.upsert(dot, raw, curr, currHash, prevRow.last_alerted_hash ?? null, now, false);
      result.noChange = true;
      console.log(`[fmcsa-cron] DOT ${dot} (${raw.legalName}) — no change`);
      return result;
    }

    result.changed = decision.changes.length;

    if (decision.action === 'dedup') {
      // Already alerted for this exact status — adopt the new normalized state so
      // we stop re-detecting it, but send nothing.
      await this.upsert(dot, raw, curr, currHash, prevRow.last_alerted_hash ?? null, now, false);
      result.skippedDedup = true;
      console.log(`[fmcsa-cron] DOT ${dot} change matches last-alerted state — dedup, no SMS`);
      return result;
    }

    // decision.action === 'alert'
    const summary = decision.changes.map((c) => `${c.label}:${c.from}->${c.to}`).join(', ');
    console.log(`[fmcsa-cron] DOT ${dot} ALERT — ${summary}`);
    const body = buildFmcsaAlertSms(raw, decision.changes);
    const r = await smsService.sendSMS({ to: phone, body, skipFooter: true });

    if (r.success) {
      result.alertsSent = 1;
      // Persist new state AND mark it alerted so it never re-fires.
      await this.upsert(dot, raw, curr, currHash, currHash, now, true);
    } else {
      result.errors.push(r.error || 'sms failed');
      console.error(
        `[fmcsa-cron] SMS failed (${r.error}) — NOT advancing monitored state so it retries next tick`,
      );
      // Keep prev normalized state + alerted hash; only refresh the raw payload
      // and snapshot timestamp, so the change is re-detected and retried.
      await this.touchRawOnly(dot, raw, now);
    }
    return result;
  }

  private async upsert(
    dot: string,
    raw: SaferRawSnapshot,
    curr: MonitoredState,
    currHash: string,
    alertedHash: string | null,
    now: Date,
    alertSent: boolean,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO fmcsa_carrier_snapshots
        (dot_number, legal_name, usdot_status, authority_status, out_of_service, mcs150,
         mcs150_form_date, out_of_service_date, monitored_hash, last_alerted_hash,
         baseline_recorded_at, last_snapshot_at, last_alert_sent_at, raw, updated_at)
      VALUES
        (${dot}, ${raw.legalName}, ${curr.usdotStatus}, ${curr.authorityStatus},
         ${curr.outOfService}, ${curr.mcs150}, ${raw.mcs150FormDate}, ${raw.outOfServiceDate},
         ${currHash}, ${alertedHash}, NOW(), ${now}, ${alertSent ? now : null},
         ${JSON.stringify(raw)}::jsonb, NOW())
      ON CONFLICT (dot_number) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        usdot_status = EXCLUDED.usdot_status,
        authority_status = EXCLUDED.authority_status,
        out_of_service = EXCLUDED.out_of_service,
        mcs150 = EXCLUDED.mcs150,
        mcs150_form_date = EXCLUDED.mcs150_form_date,
        out_of_service_date = EXCLUDED.out_of_service_date,
        monitored_hash = EXCLUDED.monitored_hash,
        last_alerted_hash = ${alertedHash},
        last_snapshot_at = EXCLUDED.last_snapshot_at,
        last_alert_sent_at = COALESCE(EXCLUDED.last_alert_sent_at, fmcsa_carrier_snapshots.last_alert_sent_at),
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `);
  }

  // Used only when a real change was detected but the SMS failed: refresh the raw
  // payload + timestamp WITHOUT advancing the monitored state, so the next tick
  // re-detects the change and retries the send.
  private async touchRawOnly(dot: string, raw: SaferRawSnapshot, now: Date): Promise<void> {
    await db.execute(sql`
      UPDATE fmcsa_carrier_snapshots
      SET raw = ${JSON.stringify(raw)}::jsonb, last_snapshot_at = ${now}, updated_at = NOW()
      WHERE dot_number = ${dot}
    `);
  }

  getStatus() {
    return {
      running: this.running,
      enabled: process.env.FMCSA_MONITOR_ENABLED === 'true',
      disabled: process.env.FMCSA_MONITOR_DISABLED === 'true',
      dot: process.env.FMCSA_MONITOR_DOT || null,
      alertPhoneConfigured: !!(process.env.FMCSA_ALERT_PHONE || process.env.DISPATCHER_PHONE_NUMBER),
      schedule: process.env.FMCSA_MONITOR_CRON || DEFAULT_SCHEDULE,
    };
  }

  async triggerNow(): Promise<FmcsaTickResult> {
    return this.tick();
  }
}

export const fmcsaMonitorCron = new FmcsaMonitorCron();
