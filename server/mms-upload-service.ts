// MMS Upload Service — context-based MMS reply routing for BOL uploads.
// Gated by MMS_UPLOAD_ENABLED. See ~/.claude/plans/mms-bol-upload-CONTEXT.md.

import { db } from './db';
import { pendingUploads } from '@shared/schema';
import { and, eq, isNull, gt, desc, sql, inArray } from 'drizzle-orm';
import { uploadLoadPhoto, type PhotoStage } from './load-photos-service';

export function isMMSUploadEnabled(): boolean {
  return process.env.MMS_UPLOAD_ENABLED === 'true';
}

// Phone number candidates for matching a pending_uploads row.
// Twilio's `From` is always E.164 (e.g., "+15551234567"). The driver.phone
// column in the DB may have been stored as any of: "+15551234567",
// "15551234567", "5551234567", or "(555) 123-4567". This builds the set of
// reasonable variants for the same number so the inbound MMS matches the
// pending row regardless of how the upstream code stored it.
export function phoneVariants(input: string): string[] {
  // Strip all non-digits.
  const digits = (input || '').replace(/\D+/g, '');
  if (!digits) return [input];
  // Last 10 digits = the canonical US area+local.
  const ten = digits.slice(-10);
  if (ten.length !== 10) return [input];
  const raw = [
    input,                                            // exact as supplied
    `+1${ten}`,                                       // E.164
    `1${ten}`,                                        // 11-digit no plus
    ten,                                              // 10-digit
    `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, // pretty
    `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`,   // dashed
  ];
  return Array.from(new Set(raw));
}

// Default 7 days — covers pickup → delivery window with slack.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Per-load rate ceiling. Defense in depth against retry storms.
export const PER_LOAD_HOURLY_CAP = 10;

// Normalize to E.164 (+1XXXXXXXXXX) at write time. Twilio's `From` field is
// always E.164, so storing the same shape on the way in eliminates the
// format-mismatch class of bugs going forward. phoneVariants() in the
// lookup is the fallback for rows written before this normalization.
export function toE164(input: string): string {
  const digits = (input || '').replace(/\D+/g, '');
  const ten = digits.slice(-10);
  return ten.length === 10 ? `+1${ten}` : input;
}

export async function createPendingUpload(p: {
  driverPhone: string;
  loadId: string;
  stage: PhotoStage;
  ttlMs?: number;
}): Promise<{ id: string }> {
  const ttl = p.ttlMs ?? DEFAULT_TTL_MS;
  const [row] = await db
    .insert(pendingUploads)
    .values({
      driverPhone: toE164(p.driverPhone),
      loadId: p.loadId,
      stage: p.stage,
      expiresAt: new Date(Date.now() + ttl),
    } as any)
    .returning({ id: pendingUploads.id });
  return { id: row.id };
}

export async function findPendingForPhone(
  driverPhone: string,
): Promise<{ id: string; loadId: string; stage: PhotoStage } | null> {
  const now = new Date();
  // Match across the set of plausible storage formats for the same number.
  // See phoneVariants() docblock — historical inbound paths persisted
  // driver.phone in inconsistent formats and we can't backfill them all.
  const candidates = phoneVariants(driverPhone);
  const [row] = await db
    .select()
    .from(pendingUploads)
    .where(
      and(
        inArray(pendingUploads.driverPhone, candidates),
        isNull(pendingUploads.fulfilledAt),
        gt(pendingUploads.expiresAt, now),
      ),
    )
    .orderBy(desc(pendingUploads.createdAt))
    .limit(1);
  if (!row) return null;
  return { id: row.id, loadId: row.loadId, stage: row.stage as PhotoStage };
}

export async function markFulfilled(
  pendingId: string,
  messageSid: string,
): Promise<void> {
  await db
    .update(pendingUploads)
    .set({ fulfilledAt: new Date(), fulfilledMessageSid: messageSid } as any)
    .where(eq(pendingUploads.id, pendingId));
}

export async function countRecentForLoad(
  loadId: string,
  windowMs = 60 * 60 * 1000,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pendingUploads)
    .where(
      and(eq(pendingUploads.loadId, loadId), gt(pendingUploads.createdAt, since)),
    );
  return rows[0]?.c ?? 0;
}

export async function downloadTwilioMedia(
  mediaUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) throw new Error('Twilio credentials not configured');
  const auth = 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64');
  const res = await fetch(mediaUrl, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Twilio media fetch failed: HTTP ${res.status}`);
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType };
}

// Stage progression — used to tell the driver what's next.
export function nextStage(current: PhotoStage): PhotoStage | null {
  const order: PhotoStage[] = [
    'pickup_bol',
    'pickup_securement',
    'delivery_pod',
    'delivery_signed_bol',
  ];
  const i = order.indexOf(current);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
}

export const STAGE_REPLY_LABEL: Record<PhotoStage, string> = {
  pickup_bol: 'Pickup BOL',
  pickup_securement: 'Securement / Tie-Down photo',
  delivery_pod: 'Delivery POD',
  delivery_signed_bol: 'Signed BOL',
};

// Main entry — used by /api/sms/webhook.
// Returns the TwiML reply body the webhook should send back, plus a flag
// telling the webhook whether to fall through to the legacy SMS handler.
export async function processMMSReply(p: {
  from: string;
  messageSid: string;
  mediaUrl?: string;
  mediaContentType?: string;
  numMedia: number;
}): Promise<{ handled: boolean; reply?: string }> {
  if (!isMMSUploadEnabled()) return { handled: false };
  if (p.numMedia < 1 || !p.mediaUrl) return { handled: false };

  // Dedup: same MessageSid already fulfilled? Twilio retries on 5xx.
  const [seen] = await db
    .select({ id: pendingUploads.id })
    .from(pendingUploads)
    .where(eq(pendingUploads.fulfilledMessageSid, p.messageSid))
    .limit(1);
  if (seen) {
    return { handled: true, reply: 'Already received — no action taken.' };
  }

  const pending = await findPendingForPhone(p.from);
  if (!pending) return { handled: false }; // fall through to legacy SMS handler

  // Per-load rate ceiling.
  const recent = await countRecentForLoad(pending.loadId);
  if (recent >= PER_LOAD_HOURLY_CAP) {
    return {
      handled: true,
      reply: 'Too many uploads in the last hour for this load. Contact dispatch.',
    };
  }

  const media = await downloadTwilioMedia(p.mediaUrl);
  const result = await uploadLoadPhoto({
    loadId: pending.loadId,
    stage: pending.stage,
    buffer: media.buffer,
    mimeType: media.mimeType,
    originalName: `mms-${p.messageSid}.jpg`,
  });
  if (!result.ok) {
    return { handled: true, reply: `Upload failed: ${result.error}` };
  }
  await markFulfilled(pending.id, p.messageSid);

  const next = nextStage(pending.stage);
  const label = STAGE_REPLY_LABEL[pending.stage];
  const reply = next
    ? `✅ Got it — ${label} saved. Next: reply with a photo of the ${STAGE_REPLY_LABEL[next]}.`
    : `✅ Got it — ${label} saved. All photos received. Thank you.`;
  return { handled: true, reply };
}
