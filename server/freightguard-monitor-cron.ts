// Carrier Defense Kit — Phase 2: FreightGuard ingestion + alert cron.
//
// ingestEmail() turns a raw Carrier411 notification email into a freightguard_cases
// row (dedup on response_code). tick() then SMS-alerts the operator about any OPEN,
// un-alerted case so they catch the 72-hour clock instead of discovering the report
// when their loads dry up.
//
// NEW OUTBOUND SMS PATH — default OFF and fully guarded per CLAUDE.md, same pattern
// as the FMCSA monitor (server/fmcsa-monitor-cron.ts):
//
//   1. Default OFF — only schedules when FREIGHTGUARD_MONITOR_ENABLED=true.
//   2. Per-case dedup — alerted_at; a case is SMS'd at most once, ever.
//   3. Boot watermark — shouldAlertCase() never alerts a case older than
//      FREIGHTGUARD_ALERT_MAX_AGE_HOURS (default 96h); a fresh deploy or backlog
//      can't re-blast historical reports. Old un-alerted cases are marked
//      'stale' + alerted (no SMS) so they don't linger.
//   4. Rate ceiling — FREIGHTGUARD_MAX_ALERTS_PER_TICK (default 3).
//   5. Kill switches — FREIGHTGUARD_MONITOR_DISABLED=true, plus universal
//      SMS_DISABLED=true (aborts without touching state).
//   6. SMS failure leaves the case un-alerted → retried next tick (never lost).
//   7. Every decision logged.
//
// Ingestion source: POST /api/freightguard/ingest (key-gated). The operator wires a
// Gmail filter / Apps Script to forward no-reply@carrier411.com mail to that endpoint;
// the alert decision is delegated to the pure, tested helpers in freightguard-service.ts.

import cron from 'node-cron';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { smsService } from './sms-service';
import {
  parseFreightGuardEmail,
  shouldAlertCase,
  buildFreightGuardAlertSms,
} from './freightguard-service';

const DEFAULT_SCHEDULE = '*/10 * * * *'; // every 10 min — the 72h clock is time-critical
const DEFAULT_MAX_ALERTS = 3;
const DEFAULT_MAX_AGE_HOURS = 96;

export interface FgIngestResult {
  ok: boolean;
  created: boolean;
  responseCode?: string;
  mcNumber?: string;
  error?: string;
}

export interface FgTickResult {
  scanned: number;
  alertsSent: number;
  skippedOld: number;
  alreadyAlerted: number;
  errors: string[];
}

class FreightGuardMonitorCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;
    if (process.env.FREIGHTGUARD_MONITOR_ENABLED !== 'true') {
      console.log('[fg-cron] FREIGHTGUARD_MONITOR_ENABLED is not "true" — cron not scheduled');
      return;
    }
    const schedule = process.env.FREIGHTGUARD_MONITOR_CRON || DEFAULT_SCHEDULE;
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[fg-cron] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🛡️ FreightGuard monitor cron running (schedule: ${schedule})`);
  }

  // Parse a raw Carrier411 email and upsert a case. Dedup on response_code via
  // ON CONFLICT DO NOTHING — re-ingesting the same email is a no-op. No SMS here.
  async ingestEmail(rawEmail: string, sourceId?: string): Promise<FgIngestResult> {
    const parsed = parseFreightGuardEmail(rawEmail || '');
    if (!parsed) return { ok: false, created: false, error: 'not a parseable FreightGuard email' };
    try {
      const r = await db.execute(sql`
        INSERT INTO freightguard_cases
          (mc_number, reported_company, broker_company, broker_contact, broker_phone,
           items_reported, additional_comments, response_code, window_hours, filed_at, deadline_at,
           status, raw_email, source_email_id)
        VALUES
          (${parsed.mcNumber}, ${parsed.reportedCompany}, ${parsed.brokerCompany}, ${parsed.brokerContact},
           ${parsed.brokerPhone}, ${JSON.stringify(parsed.itemsReported)}::jsonb, ${parsed.additionalComments},
           ${parsed.responseCode}, ${parsed.windowHours}, ${parsed.filedAt}, ${parsed.deadlineAt},
           'open', ${rawEmail}, ${sourceId ?? null})
        ON CONFLICT (response_code) DO NOTHING
        RETURNING id
      `);
      const created = !!(r as any).rows?.[0];
      return { ok: true, created, responseCode: parsed.responseCode, mcNumber: parsed.mcNumber };
    } catch (e: any) {
      return { ok: false, created: false, error: e?.message || String(e) };
    }
  }

  async tick(): Promise<FgTickResult> {
    const result: FgTickResult = { scanned: 0, alertsSent: 0, skippedOld: 0, alreadyAlerted: 0, errors: [] };

    if (process.env.FREIGHTGUARD_MONITOR_DISABLED === 'true') {
      console.log('[fg-cron] FREIGHTGUARD_MONITOR_DISABLED=true — tick aborted');
      return result;
    }
    if (process.env.SMS_DISABLED === 'true') {
      console.log('[fg-cron] SMS_DISABLED=true — tick aborted (state untouched)');
      return result;
    }

    const phone =
      process.env.FREIGHTGUARD_ALERT_PHONE ||
      process.env.FMCSA_ALERT_PHONE ||
      process.env.DISPATCHER_PHONE_NUMBER;
    if (!phone) {
      console.log('[fg-cron] no alert phone configured — skipping');
      return result;
    }
    if (!smsService.isServiceConfigured?.()) {
      console.log('[fg-cron] SMS not configured — skipping');
      return result;
    }

    const maxAlerts = Math.max(
      1,
      Math.min(20, Number(process.env.FREIGHTGUARD_MAX_ALERTS_PER_TICK) || DEFAULT_MAX_ALERTS),
    );
    const maxAgeHours = Math.max(
      1,
      Number(process.env.FREIGHTGUARD_ALERT_MAX_AGE_HOURS) || DEFAULT_MAX_AGE_HOURS,
    );
    const now = new Date();

    let rows: any[] = [];
    try {
      const r = await db.execute(sql`
        SELECT id, mc_number, broker_company, items_reported, response_code, deadline_at,
               status, alerted_at, created_at
        FROM freightguard_cases
        WHERE alerted_at IS NULL AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 50
      `);
      rows = (r as any).rows ?? [];
    } catch (e: any) {
      result.errors.push(`db read: ${e?.message || e}`);
      console.error('[fg-cron] read failed — aborting to stay safe:', e?.message);
      return result;
    }

    for (const row of rows) {
      result.scanned++;
      const decision = shouldAlertCase(
        { status: row.status, alertedAt: row.alerted_at, createdAt: row.created_at },
        now,
        maxAgeHours,
      );

      if (!decision.alert) {
        if (decision.reason === 'too-old') {
          // Mark stale + alerted so it never SMSes and stops being scanned. Watermark.
          result.skippedOld++;
          await db.execute(sql`
            UPDATE freightguard_cases
            SET alerted_at = NOW(),
                status = CASE WHEN status = 'open' THEN 'stale' ELSE status END,
                updated_at = NOW()
            WHERE id = ${row.id}
          `);
        } else {
          result.alreadyAlerted++;
        }
        continue;
      }

      if (result.alertsSent >= maxAlerts) {
        console.error(`[fg-cron] hit rate ceiling at ${maxAlerts} — halting tick`);
        break;
      }

      const body = buildFreightGuardAlertSms(
        {
          mcNumber: row.mc_number,
          brokerCompany: row.broker_company,
          itemsReported: Array.isArray(row.items_reported) ? row.items_reported : [],
          responseCode: row.response_code,
          deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
        },
        now,
      );
      const sent = await smsService.sendSMS({ to: phone, body, skipFooter: true });
      if (sent.success) {
        result.alertsSent++;
        await db.execute(sql`UPDATE freightguard_cases SET alerted_at = NOW(), updated_at = NOW() WHERE id = ${row.id}`);
        console.log(`[fg-cron] alerted on ${row.mc_number} (${row.response_code})`);
      } else {
        // Leave un-alerted so it retries next tick.
        result.errors.push(`${row.response_code}: ${sent.error}`);
        console.error(`[fg-cron] SMS failed for ${row.response_code} (${sent.error}) — left un-alerted to retry`);
      }
    }

    console.log(
      `[fg-cron] tick: scanned ${result.scanned}, sent ${result.alertsSent}, ` +
        `old-skipped ${result.skippedOld}, already ${result.alreadyAlerted}, errors ${result.errors.length}`,
    );
    return result;
  }

  getStatus() {
    return {
      running: this.running,
      enabled: process.env.FREIGHTGUARD_MONITOR_ENABLED === 'true',
      disabled: process.env.FREIGHTGUARD_MONITOR_DISABLED === 'true',
      schedule: process.env.FREIGHTGUARD_MONITOR_CRON || DEFAULT_SCHEDULE,
      alertPhoneConfigured: !!(
        process.env.FREIGHTGUARD_ALERT_PHONE ||
        process.env.FMCSA_ALERT_PHONE ||
        process.env.DISPATCHER_PHONE_NUMBER
      ),
    };
  }

  async triggerNow(): Promise<FgTickResult> {
    return this.tick();
  }
}

export const freightGuardMonitorCron = new FreightGuardMonitorCron();
