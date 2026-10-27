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

// ponytail: in-process Maps; resets on restart — acceptable for a single-dyno
// alert channel where missing one burst is not a data-loss event.
// Upgrade to Redis/DB if multi-dyno or durability matters.
const _burst = new Map<string, number>(); // loadId:phase => lastFireMs
const _daily = new Map<string, number>(); // loadId:YYYY-MM-DD => count

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
  _burst.set(burstKey, now);
  _daily.set(dk, dayCount + 1);

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
    const viewUrl = `${baseUrl}/loads/${p.loadId}/documents`;

    const msg = `LAMP ${load.loadNumber}${brokerPart}: driver ${driverName} uploaded ${stageLabel} [${n} of ${m}]. View: ${viewUrl}`;

    await smsLoadService.sendSMS(phone, msg);
  } catch (err: any) {
    // Non-blocking: log only; upload result is already returned to driver
    console.error('[owner-alert] alert failed (non-blocking):', err?.message || err);
  }
}
