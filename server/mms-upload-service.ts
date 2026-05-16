// MMS Upload Service — context-based MMS reply routing for BOL uploads.
// Gated by MMS_UPLOAD_ENABLED. See ~/.claude/plans/mms-bol-upload-CONTEXT.md.

import { db } from './db';
import { pendingUploads, loadDocuments } from '@shared/schema';
import { and, eq, isNull, gt, desc, sql, inArray } from 'drizzle-orm';
import { uploadLoadPhoto, type PhotoStage } from './load-photos-service';

export function isMMSUploadEnabled(): boolean {
  return process.env.MMS_UPLOAD_ENABLED === 'true';
}

// Per-driver-per-hour cap on OpenAI vision calls (defense in depth
// against a runaway loop racking up cost). In-memory; resets on
// process restart, which is fine — this is a budget tripwire, not a
// strict billing meter. If a single phone exceeds the cap, subsequent
// OCR attempts are skipped (treated as ocr_status='disabled' for that
// document) and dispatcher review remains the final gate either way.
const PER_DRIVER_OCR_PER_HOUR = 10;
const ocrTimestamps: Map<string, number[]> = new Map();

export function canRunOcrForDriver(phone: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const arr = ocrTimestamps.get(phone) ?? [];
  // Drop expired entries.
  const recent = arr.filter((t) => t >= oneHourAgo);
  ocrTimestamps.set(phone, recent);
  return recent.length < PER_DRIVER_OCR_PER_HOUR;
}

export function recordOcrAttempt(phone: string): void {
  const arr = ocrTimestamps.get(phone) ?? [];
  arr.push(Date.now());
  ocrTimestamps.set(phone, arr);
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

// "WRONG" reply rolls back the most recent fulfilled upload for this
// driver: marks the load_documents row as rejected and clears the
// pending_uploads.fulfilled_at so the driver can retry on the correct
// load. Returns the user-facing TwiML reply.
export async function handleWrongReply(
  driverPhone: string,
): Promise<{ handled: boolean; reply?: string }> {
  if (!isMMSUploadEnabled()) return { handled: false };
  const candidates = phoneVariants(driverPhone);
  // Find the most-recently-fulfilled pending row for this phone.
  const [recent] = await db
    .select({
      id: pendingUploads.id,
      loadId: pendingUploads.loadId,
      stage: pendingUploads.stage,
      fulfilledMessageSid: pendingUploads.fulfilledMessageSid,
    })
    .from(pendingUploads)
    .where(inArray(pendingUploads.driverPhone, candidates))
    .orderBy(desc(pendingUploads.fulfilledAt))
    .limit(1);
  if (!recent || !recent.fulfilledMessageSid) {
    return {
      handled: true,
      reply: 'No recent upload found to flag as wrong. Contact dispatch.',
    };
  }
  // Mark the load_documents row as rejected so dispatch sees it in the
  // review queue. The factoring pipeline filters out approval_status
  // !== 'approved', so a rejected photo never goes downstream.
  try {
    const { loadDocuments, loads } = await import('@shared/schema');
    const stage = recent.stage as PhotoStage;
    await db
      .update(loadDocuments)
      .set({
        approvalStatus: 'rejected',
        rejectionReason: 'Driver flagged as wrong load',
        rejectedAt: new Date(),
      } as any)
      .where(
        and(
          eq(loadDocuments.loadId, recent.loadId),
          eq(loadDocuments.documentType, stage),
        ),
      );
    // Clear fulfilled state so a fresh upload can replace it.
    await db
      .update(pendingUploads)
      .set({ fulfilledAt: null, fulfilledMessageSid: null } as any)
      .where(eq(pendingUploads.id, recent.id));
    // Look up the load number for the reply.
    const [loadRow] = await db
      .select({ loadNumber: loads.loadNumber })
      .from(loads)
      .where(eq(loads.id, recent.loadId))
      .limit(1);
    const loadNumber = loadRow?.loadNumber ?? recent.loadId;
    return {
      handled: true,
      reply: `Flagged the last photo as wrong load (was load ${loadNumber}). Dispatch has been notified. Please resend the correct photo.`,
    };
  } catch (err: any) {
    console.error('[mms-upload] handleWrongReply failed:', err.message);
    return {
      handled: true,
      reply: 'Could not flag the photo. Contact dispatch to correct it manually.',
    };
  }
}

// Main entry — used by /api/sms/webhook.
// Returns the TwiML reply body the webhook should send back, plus a flag
// telling the webhook whether to fall through to the legacy SMS handler.
export async function processMMSReply(p: {
  from: string;
  messageSid: string;
  body?: string;
  mediaUrl?: string;
  mediaContentType?: string;
  numMedia: number;
}): Promise<{ handled: boolean; reply?: string }> {
  if (!isMMSUploadEnabled()) return { handled: false };

  // "WRONG" reply path — driver telling us we attached a photo to the
  // wrong load. Trim/case-insensitive match on the body, ignore any
  // surrounding text so common variants ("wrong load", "WRONG!", " wrong ")
  // all hit. Must precede the media check so a text-only WRONG reply
  // doesn't bail out at the numMedia gate.
  const body = (p.body || '').trim().toUpperCase();
  if (/^WRONG\b/.test(body)) {
    return handleWrongReply(p.from);
  }

  // "OVERRIDE" reply path — driver acknowledging an OCR address mismatch
  // and asking us to keep the photo anyway. The actual factoring gate
  // still requires dispatcher approval (per Phase 1) — OVERRIDE alone
  // does NOT auto-approve the photo, it just stops re-prompting the
  // driver and lets dispatcher see "driver acknowledged mismatch" when
  // reviewing. Must precede the media check (text-only reply).
  if (/^OVERRIDE\b/.test(body)) {
    return handleOverrideReply(p.from, p.messageSid);
  }

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

  // Look up the user-facing load number AND the load's pickup/delivery
  // addresses for the confirmation reply + the Phase 2 OCR check. The
  // driver needs to see exactly which load their photo was bound to so
  // they can flag a mistake before the BOL flows downstream into the
  // factoring submission. Cheap and worth the round-trip.
  const { loads } = await import('@shared/schema');
  const [loadRow] = await db
    .select({
      loadNumber: loads.loadNumber,
      pickupAddress: loads.pickupAddress,
      deliveryAddress: loads.deliveryAddress,
    })
    .from(loads)
    .where(eq(loads.id, pending.loadId))
    .limit(1);
  const loadNumber = loadRow?.loadNumber ?? pending.loadId;

  const media = await downloadTwilioMedia(p.mediaUrl);
  const result = await uploadLoadPhoto({
    loadId: pending.loadId,
    stage: pending.stage,
    buffer: media.buffer,
    mimeType: media.mimeType,
    originalName: `mms-${p.messageSid}.jpg`,
  });
  if (!result.ok) {
    return { handled: true, reply: `Upload failed for load ${loadNumber}: ${result.error}` };
  }
  await markFulfilled(pending.id, p.messageSid);

  // Phase 2: OCR address verification. Gated behind ADDRESS_VERIFY_ENABLED
  // (default OFF) so flipping MMS_UPLOAD_ENABLED on doesn't accidentally
  // trigger OpenAI bills. When ON, every saved BOL photo is OCR'd against
  // the load's pickup (for pickup_bol/pickup_securement) or delivery
  // (for delivery_pod/delivery_signed_bol) address. Three outcomes:
  //   - matched → save with ocr_status='matched', send the normal ✅ reply
  //   - mismatch → save with ocr_status='mismatch', send the mismatch SMS
  //     with the OVERRIDE option
  //   - unreadable/error/disabled → save with the corresponding ocr_status,
  //     send the normal ✅ reply with a "dispatch will verify" note
  // The factoring gate from Phase 1 (approvalStatus='approved') still
  // applies — OCR match never auto-approves for factoring, dispatcher
  // review is always required. OCR just reduces the wrong-load surface
  // before the human ever sees the photo.
  const ocrReply = await runOcrAddressCheckIfEnabled({
    docId: result.docId,
    phone: p.from,
    stage: pending.stage,
    fileUrl: result.url,
    loadNumber,
    loadPickupAddress: loadRow?.pickupAddress ?? null,
    loadDeliveryAddress: loadRow?.deliveryAddress ?? null,
  });
  if (ocrReply.driverSmsOverride) {
    return { handled: true, reply: ocrReply.driverSmsOverride };
  }

  const next = nextStage(pending.stage);
  const label = STAGE_REPLY_LABEL[pending.stage];
  // Fix A (CLAUDE.md user request): echo the load number in every
  // confirmation so the driver can spot a wrong-load attachment
  // immediately. The factoring/RateCon flow depends on photos being on
  // the correct load_id, and the driver is the last line of defense
  // before the BOL goes downstream.
  const ocrSuffix = ocrReply.suffixForOkReply ?? '';
  const reply = next
    ? `✅ ${label} saved for load ${loadNumber}.${ocrSuffix} Next: reply with a photo of the ${STAGE_REPLY_LABEL[next]}. Reply WRONG if this load number is incorrect.`
    : `✅ ${label} saved for load ${loadNumber}.${ocrSuffix} All photos received. Reply WRONG if this load number is incorrect.`;
  return { handled: true, reply };
}

// OCR address check + load_documents update. Returns either a full
// driverSmsOverride (mismatch SMS — caller short-circuits and returns
// this verbatim) or a short suffix to append to the normal ✅ reply
// (added context like " (address verified)").
//
// Never throws — any OpenAI failure / timeout / cap-hit is logged and
// returns suffix only, falling back to the existing dispatcher review
// surface as the guardrail. This function is the load-bearing place
// where the OCR cost gate lives — the caller does not need to know
// about ADDRESS_VERIFY_ENABLED or the per-driver cap.
async function runOcrAddressCheckIfEnabled(p: {
  docId: string;
  phone: string;
  stage: PhotoStage;
  fileUrl: string;
  loadNumber: string;
  loadPickupAddress: string | null;
  loadDeliveryAddress: string | null;
}): Promise<{ driverSmsOverride?: string; suffixForOkReply?: string }> {
  const { isAddressVerifyEnabled, extractBolAddresses } = await import('./factoring-bol-address-verify');
  if (!isAddressVerifyEnabled()) {
    await updateOcrStatus(p.docId, { ocrStatus: 'disabled' });
    return {};
  }
  if (!canRunOcrForDriver(p.phone)) {
    console.warn(`[mms-upload] OCR per-driver hourly cap hit for ${p.phone} — skipping`);
    await updateOcrStatus(p.docId, { ocrStatus: 'disabled' });
    return { suffixForOkReply: '' };
  }
  recordOcrAttempt(p.phone);

  // Pickup BOL/securement match against load.pickupAddress.
  // Delivery POD/signed BOL match against load.deliveryAddress.
  const isPickupStage = p.stage === 'pickup_bol' || p.stage === 'pickup_securement';
  const expectedFreeform = isPickupStage ? p.loadPickupAddress : p.loadDeliveryAddress;

  const extract = await extractBolAddresses(p.fileUrl);
  await updateOcrStatus(p.docId, { ocrAttemptedAt: new Date() });
  if (!extract.ok) {
    await updateOcrStatus(p.docId, { ocrStatus: 'error' });
    return { suffixForOkReply: '' };
  }
  const extractedSide = isPickupStage ? extract.shipFrom : extract.shipTo;
  if (!extractedSide || !expectedFreeform) {
    await updateOcrStatus(p.docId, { ocrStatus: 'unreadable' });
    return { suffixForOkReply: ' Address auto-check incomplete — dispatch will verify.' };
  }

  const { matchAddresses, parseFreeformAddress } = await import('./address-match');
  const expected = parseFreeformAddress(expectedFreeform);
  const result = matchAddresses(extractedSide, expected);

  // Persist the extracted labels on whichever side this stage cares
  // about. Both columns are written (extracted side gets the label;
  // other side stays null) so the dispatcher UI can render "OCR saw X,
  // expected Y" at a glance.
  const persistedExtracted = result.normalizedExtracted ?? null;
  if (isPickupStage) {
    await updateOcrStatus(p.docId, {
      ocrStatus: result.outcome,
      ocrExtractedPickup: persistedExtracted,
    });
  } else {
    await updateOcrStatus(p.docId, {
      ocrStatus: result.outcome,
      ocrExtractedDropoff: persistedExtracted,
    });
  }

  if (result.outcome === 'matched') {
    return { suffixForOkReply: ` Address verified (${result.normalizedExtracted}).` };
  }
  if (result.outcome === 'unreadable') {
    return { suffixForOkReply: ' Address auto-check incomplete — dispatch will verify.' };
  }
  // Mismatch — full driver-facing override SMS. Spell out both sides so
  // the driver can self-correct without calling dispatch.
  const sideLabel = isPickupStage ? 'pickup' : 'delivery';
  return {
    driverSmsOverride:
      `⚠️ The BOL photo shows ${sideLabel} as ${result.normalizedExtracted}, ` +
      `but Load #${p.loadNumber}'s ${sideLabel} is ${result.normalizedExpected}. ` +
      `This may be the wrong BOL.\n\n` +
      `Send a new photo, OR reply OVERRIDE to keep this one.\n\n` +
      `⚠️ If you OVERRIDE and the BOL is wrong, factoring will reject it and payment for Load #${p.loadNumber} will be delayed.`,
  };
}

async function updateOcrStatus(
  docId: string,
  patch: Partial<{
    ocrStatus: string;
    ocrExtractedPickup: string | null;
    ocrExtractedDropoff: string | null;
    ocrAttemptedAt: Date;
  }>,
): Promise<void> {
  if (!docId) return;
  try {
    await db.update(loadDocuments).set(patch as any).where(eq(loadDocuments.id, docId));
  } catch (err: any) {
    console.error(`[mms-upload] OCR status update failed for ${docId}:`, err.message);
  }
}

// "OVERRIDE" handler — driver acknowledging an OCR mismatch and asking
// us to keep the photo on the load anyway. Finds the most recent
// load_documents row for this phone (via the most-recent fulfilled
// pending_uploads row) with ocr_status='mismatch' and stamps the
// acknowledgment. Factoring still requires dispatcher approval, so
// OVERRIDE alone never causes a wrong BOL to ship to Love's.
export async function handleOverrideReply(
  driverPhone: string,
  messageSid: string,
): Promise<{ handled: boolean; reply?: string }> {
  if (!isMMSUploadEnabled()) return { handled: false };
  const candidates = phoneVariants(driverPhone);
  // Find the most-recently-fulfilled pending row for this phone.
  const [recent] = await db
    .select({
      loadId: pendingUploads.loadId,
      stage: pendingUploads.stage,
      fulfilledMessageSid: pendingUploads.fulfilledMessageSid,
    })
    .from(pendingUploads)
    .where(inArray(pendingUploads.driverPhone, candidates))
    .orderBy(desc(pendingUploads.fulfilledAt))
    .limit(1);
  if (!recent || !recent.fulfilledMessageSid) {
    return {
      handled: true,
      reply: 'No recent BOL upload found to override. If you meant to send a photo, please send it now.',
    };
  }
  // Find the load_documents row for that load + stage in 'mismatch' state.
  const [doc] = await db
    .select({ id: loadDocuments.id, ocrStatus: loadDocuments.ocrStatus })
    .from(loadDocuments)
    .where(
      and(
        eq(loadDocuments.loadId, recent.loadId),
        eq(loadDocuments.documentType, recent.stage),
      ),
    )
    .orderBy(desc(loadDocuments.createdAt))
    .limit(1);
  if (!doc) {
    return {
      handled: true,
      reply: 'No recent BOL upload found to override. Contact dispatch.',
    };
  }
  if (doc.ocrStatus !== 'mismatch') {
    return {
      handled: true,
      reply: 'Your most recent BOL is not flagged for mismatch. Nothing to override.',
    };
  }
  // Look up the load number for the reply.
  const { loads } = await import('@shared/schema');
  const [loadRow] = await db
    .select({ loadNumber: loads.loadNumber })
    .from(loads)
    .where(eq(loads.id, recent.loadId))
    .limit(1);
  const loadNumber = loadRow?.loadNumber ?? recent.loadId;
  try {
    await db
      .update(loadDocuments)
      .set({
        ocrStatus: 'override',
        overrideAcknowledgedAt: new Date(),
        overrideMessageSid: messageSid,
      } as any)
      .where(eq(loadDocuments.id, doc.id));
  } catch (err: any) {
    console.error('[mms-upload] OVERRIDE persist failed:', err.message);
    return {
      handled: true,
      reply: 'Could not record your override — please try again or contact dispatch.',
    };
  }
  return {
    handled: true,
    reply:
      `✅ Override recorded for Load #${loadNumber}. Photo will go to dispatch for final review. ` +
      `Payment depends on dispatcher approval — if the BOL is wrong, factoring will reject it.`,
  };
}
