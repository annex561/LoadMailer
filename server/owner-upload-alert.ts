/**
 * Owner upload alert — item 7 of the driver-doc-upload packet.
 *
 * Sends one SMS to OWNER_ALERT_PHONE after every successful driver upload
 * and once more when the driver taps "Done" (confirm). Gated by
 * UPLOAD_OWNER_ALERT_ENABLED (default OFF). All sends go through
 * smsLoadService so SMS_DISABLED and DRY_RUN_OUTBOUND both apply.
 *
 * Debounce: one SMS per upload burst (2-min window per load+phase).
 *           confirm=true bypasses the window (always fires on Done).
 * Daily cap: 10 alerts per load per calendar day.
 * Hourly ceiling: 20 alerts per rolling hour across all loads
 *                 (OWNER_ALERT_HOURLY_MAX overrides).
 *
 * Callers: the browser upload routes in routes.ts and the MMS-reply path
 * (processMMSReply in mms-upload-service.ts).
 *
 * Alert failures NEVER propagate — callers fire-and-forget via .catch().
 */

import { smsLoadService } from './sms-service';
import { db } from './db';
import { loadDocuments, loads, drivers } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { STAGE_LABELS, PICKUP_STAGES, PhotoStage } from './load-photos-service';

const BURST_MS = 2 * 60 * 1000; // 2 minutes
const DAILY_MAX = 10;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HOURLY_MAX = 20; // across ALL loads; override with OWNER_ALERT_HOURLY_MAX

// ponytail: in-process Maps; resets on restart — acceptable for a single-dyno
// alert channel where missing one burst is not a data-loss event.
// Upgrade to Redis/DB if multi-dyno or durability matters.
const _burst = new Map<string, number>(); // loadId:phase => lastFireMs
const _daily = new Map<string, number>(); // loadId:YYYY-MM-DD => count
const _sentAt: number[] = []; // fire times in the last hour, oldest first

function phaseOf(stage: PhotoStage): 'pickup' | 'delivery' {
  return PICKUP_STAGES.includes(stage) ? 'pickup' : 'delivery';
}

function todaySuffix(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

/** Exported for tests only — resets in-process debounce/cap state. */
export function _resetAlertState(): void {
  _burst.clear();
  _daily.clear();
  _sentAt.length = 0;
}

export async function notifyOwnerOfUpload(p: {
  loadId: string;
  stage: PhotoStage;
  /** Pass true on /photos/confirm to bypass the burst window. */
  confirm?: boolean;
}): Promise<void> {
  if (process.env.UPLOAD_OWNER_ALERT_ENABLED !== 'true') return;

  const phone = (process.env.OWNER_ALERT_PHONE || '').trim();
  if (!phone) {
    console.warn('[owner-alert] OWNER_ALERT_PHONE not set — skipping');
    return;
  }

  const phase = phaseOf(p.stage);

  // ── Daily cap ───────────────────────────────────────────────────────────
  const dk = `${p.loadId}:${todaySuffix()}`;
  const dayCount = _daily.get(dk) ?? 0;
  if (dayCount >= DAILY_MAX) {
    console.log(`[owner-alert] daily cap (${DAILY_MAX}) hit for load ${p.loadId}`);
    return;
  }

  // ── Burst debounce (skip on confirm) ────────────────────────────────────
  const burstKey = `${p.loadId}:${phase}`;
  const now = Date.now();
  if (!p.confirm) {
    const last = _burst.get(burstKey) ?? 0;
    if (now - last < BURST_MS) return; // already fired in this burst window
  }

  // ── Global hourly ceiling (all loads, confirm included) ─────────────────
  // Per-load caps alone scale with the number of loads; this bounds the
  // total spend if uploads spike across many loads at once.
  const hourlyMax = Number(process.env.OWNER_ALERT_HOURLY_MAX) || DEFAULT_HOURLY_MAX;
  while (_sentAt.length && now - _sentAt[0] >= HOUR_MS) _sentAt.shift();
  if (_sentAt.length >= hourlyMax) {
    console.log(`[owner-alert] hourly ceiling (${hourlyMax}) hit — suppressing alert for load ${p.loadId}`);
    return;
  }

  _burst.set(burstKey, now);
  _daily.set(dk, dayCount + 1);
  _sentAt.push(now);

  try {
    const load = await db.query.loads.findFirst({ where: eq(loads.id, p.loadId) });
    if (!load) return;

    const driver = load.driverId
      ? await db.query.drivers.findFirst({ where: eq(drivers.id, load.driverId) })
      : null;
    const driverName = (driver as any)?.name || 'Driver';

    // Count uploaded docs for this phase (n of m)
    const allDocs = await db
      .select({ documentType: loadDocuments.documentType })
      .from(loadDocuments)
      .where(eq(loadDocuments.loadId, p.loadId));
    const phaseStages = phase === 'pickup' ? PICKUP_STAGES : (await import('./load-photos-service')).DELIVERY_STAGES;
    const n = allDocs.filter((d: { documentType: string | null }) => phaseStages.includes(d.documentType as PhotoStage)).length;
    const m = phaseStages.length;

    const broker = (load as any).brokerName || '';
    const brokerPart = broker ? ` (${broker})` : '';
    const stageLabel = STAGE_LABELS[p.stage] || p.stage;
    const baseUrl = process.env.PUBLIC_URL || process.env.APP_URL || 'https://traqiq.app';
    // /loads/:id is the staff load-details page (Documents section). There is
    // no /loads/:id/documents route in the client; that path renders NotFound.
    const viewUrl = `${baseUrl}/loads/${p.loadId}`;

    const what = p.confirm ? `submitted ${phase} photos` : `uploaded ${stageLabel}`;
    const msg = `LAMP ${load.loadNumber}${brokerPart}: driver ${driverName} ${what} [${n} of ${m}]. View: ${viewUrl}`;

    // skipFooter: the owner's number is also a driver record, so the default
    // footer would append his own /driver/<token> portal link to every alert
    // and double the segment count. Same as the other admin alert crons.
    await smsLoadService.sendSMS({ to: phone, body: msg, skipFooter: true });
  } catch (err: any) {
    // Non-blocking: log only; upload result is already returned to driver
    console.error('[owner-alert] alert failed (non-blocking):', err?.message || err);
  }
}
