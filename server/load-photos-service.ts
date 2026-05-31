// Load Photos Service
// Manages driver-uploaded photos for loads (BOL, securement, POD, signed BOL).
// Storage: Cloudinary (via CLOUDINARY_URL env var).
// Records metadata in the existing load_documents table.

import { v2 as cloudinary } from 'cloudinary';
import { createHash } from 'crypto';
import { db } from './db';
import { loadDocuments, loads, drivers, driverLocations } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { smsLoadService } from './sms-service';
import { UPLOAD_PAGE_CLIENT_JS } from './upload-page-client-source';

export type PhotoStage =
  | 'pickup_bol'
  | 'pickup_securement'
  | 'delivery_pod'
  | 'delivery_signed_bol';

export const STAGE_LABELS: Record<PhotoStage, string> = {
  pickup_bol: 'Pickup BOL',
  pickup_securement: 'Securement / Tie-Down',
  delivery_pod: 'Delivery POD',
  delivery_signed_bol: 'Signed BOL',
};

export const PICKUP_STAGES: PhotoStage[] = ['pickup_bol', 'pickup_securement'];
export const DELIVERY_STAGES: PhotoStage[] = ['delivery_pod', 'delivery_signed_bol'];

// All four stages are required documents, but the driver should only ever see
// the slots for the phase the load is currently in — pickup slots before
// delivery, delivery slots once at/after delivery. Keeping the off-phase slots
// hidden prevents drivers uploading the wrong doc to the wrong slot.
export const REQUIRED_STAGES: PhotoStage[] = [
  'pickup_bol',
  'pickup_securement',
  'delivery_pod',
  'delivery_signed_bol',
];

// Load statuses that mean the truck is at / past the delivery dock. Anything
// else is treated as the pickup phase.
const DELIVERY_PHASE_STATUSES = new Set([
  'at_delivery',
  'unloaded',
  'delivered',
  'completed',
  'pod_received',
]);

/**
 * Which photo slots to show for a load given its current status. Pre-delivery
 * → pickup BOL + tie-down only. At/after delivery → POD + signed BOL only.
 * This is the single source of truth used by the /u/<token> page when the
 * link doesn't pin an explicit phase.
 */
export function stagesForLoadStatus(status: string | null | undefined): PhotoStage[] {
  return status && DELIVERY_PHASE_STATUSES.has(status)
    ? [...DELIVERY_STAGES]
    : [...PICKUP_STAGES];
}

function isConfigured(): boolean {
  return !!process.env.CLOUDINARY_URL || !!process.env.CLOUDINARY_CLOUD_NAME;
}

// cloudinary SDK auto-reads CLOUDINARY_URL when present (format: cloudinary://KEY:SECRET@CLOUD_NAME)
// but we also support individual vars for flexibility.
if (process.env.CLOUDINARY_CLOUD_NAME && !process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Build signed Cloudinary upload params for a direct browser-to-Cloudinary
 * upload. Returns the data the client needs to POST the file directly to
 * https://api.cloudinary.com/v1_1/<cloud>/image/upload.
 *
 * This path exists because uploading through our Express server (multer ->
 * Cloudinary SDK) failed intermittently on iOS Safari with weak signal —
 * the multipart body would buffer somewhere between the browser, Railway's
 * edge, and Node, and the request would never complete. Cloudinary's
 * upload endpoint is designed for direct browser POSTs and handles mobile
 * networks much better.
 *
 * Signature spec:
 *   sha1(<sorted-params-as-querystring> + api_secret)
 * Params signed: timestamp, folder, public_id, source
 * (api_key, file, and signature itself are NOT signed.)
 */
export interface CloudinaryDirectUploadParams {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  signature: string;
}

export function buildCloudinaryDirectUploadParams(
  loadNumber: string,
  stage: PhotoStage,
): { ok: true; params: CloudinaryDirectUploadParams } | { ok: false; error: string } {
  // Resolve credentials. cloudinary SDK auto-reads CLOUDINARY_URL but we
  // need the raw values for signing here.
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
  let apiKey = process.env.CLOUDINARY_API_KEY || "";
  let apiSecret = process.env.CLOUDINARY_API_SECRET || "";

  if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
    // Parse cloudinary://API_KEY:API_SECRET@CLOUD_NAME
    try {
      const u = new URL(process.env.CLOUDINARY_URL);
      apiKey = u.username || apiKey;
      apiSecret = u.password || apiSecret;
      cloudName = u.hostname || cloudName;
    } catch (_) {
      /* fall through */
    }
  }
  if (!cloudName || !apiKey || !apiSecret) {
    return { ok: false, error: "Cloudinary not configured" };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `traqiq/loads/${loadNumber}`;
  const publicId = `${stage}_${Date.now()}`;

  // Sorted alphabetically, joined as querystring, then concat api_secret
  // and SHA1. Cloudinary docs: https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
  const toSign = [
    `folder=${folder}`,
    `public_id=${publicId}`,
    `timestamp=${timestamp}`,
  ].join("&");

  // createHash is already imported from 'crypto' at the top of this file.
  const signature = createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");

  return {
    ok: true,
    params: { cloudName, apiKey, timestamp, folder, publicId, signature },
  };
}

/**
 * Record a Cloudinary-direct-uploaded photo in load_documents. Called by
 * the client AFTER the direct upload succeeds. Validates that the load
 * has a driver assigned (same orphaned-photo guard as uploadLoadPhoto).
 */
export async function recordDirectUploadedPhoto(p: {
  loadId: string;
  driverId?: string;
  stage: PhotoStage;
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  const load = await db.query.loads.findFirst({ where: eq(loads.id, p.loadId) });
  if (!load) return { ok: false, error: "Load not found" };

  const driverId = p.driverId || load.driverId || null;
  if (!driverId) {
    return {
      ok: false,
      error: "No driver assigned to this load. Contact dispatch before uploading.",
    };
  }

  // Sanity-check the URL came from our Cloudinary account. Without this,
  // a malicious client could POST any arbitrary URL and we'd record it.
  if (!/^https:\/\/res\.cloudinary\.com\//.test(p.fileUrl)) {
    return { ok: false, error: "Invalid file URL" };
  }

  try {
    const [doc] = await db
      .insert(loadDocuments)
      .values({
        loadId: p.loadId,
        driverId,
        documentType: p.stage,
        fileName: p.fileName,
        fileUrl: p.fileUrl,
        fileSize: p.fileSize,
        mimeType: p.mimeType,
        notes: p.notes || null,
        approvalStatus: "pending",
      } as any)
      .returning();

    if (typeof p.lat === "number" && typeof p.lng === "number") {
      try {
        await db.insert(driverLocations).values({
          driverId,
          latitude: p.lat,
          longitude: p.lng,
          timestamp: new Date(),
          loadId: p.loadId,
          isActive: true,
          source: "photo-upload",
        } as any);
      } catch (locErr: any) {
        console.warn("[load-photos] driverLocations insert failed:", locErr?.message || locErr);
      }
    }

    return { ok: true, docId: doc.id };
  } catch (err: any) {
    console.error("[load-photos] recordDirectUploadedPhoto error:", err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

export interface UploadPhotoParams {
  loadId: string;
  driverId?: string;
  stage: PhotoStage;
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

export async function uploadLoadPhoto(
  p: UploadPhotoParams,
): Promise<{ ok: true; url: string; docId: string } | { ok: false; error: string }> {
  if (!isConfigured()) {
    return {
      ok: false,
      error: 'Cloudinary not configured. Set CLOUDINARY_URL env var.',
    };
  }

  const load = await db.query.loads.findFirst({ where: eq(loads.id, p.loadId) });
  if (!load) return { ok: false, error: 'Load not found' };

  // BUG FIX: previously the upload went to Cloudinary even when no driver
  // was associated with the load, then silently skipped the DB write —
  // the photo got orphaned in cloud storage with no dispatch record. The
  // driver saw a green ✅ but dispatch never saw the photo. Fail fast
  // here instead so the driver sees a real error and dispatch isn't
  // missing photos for live loads.
  const driverId = p.driverId || load.driverId || null;
  if (!driverId) {
    console.error(`[load-photos] refusing upload for load ${p.loadId} — no driver assigned`);
    return {
      ok: false,
      error: 'No driver assigned to this load. Contact dispatch before uploading.',
    };
  }

  const folder = `traqiq/loads/${load.loadNumber}`;
  const publicId = `${p.stage}_${Date.now()}`;

  try {
    // Stream the buffer directly to Cloudinary instead of base64-encoding the
    // whole file into a data URI first. Base64 inflated payloads ~33% and
    // forced an extra full-file allocation on the server — meaningful on
    // mobile uploads of 4-12 MB photos.
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: 'image',
          overwrite: false,
          tags: ['traqiq', load.loadNumber, p.stage],
          // Server-side resize + quality optimization. Replaces the
          // unreliable client-side canvas compression that hung on iOS
          // Safari for HEIC photos. Cloudinary auto-converts HEIC to
          // JPEG, caps long edge at 2000px, and picks 'good' quality.
          // The original is never stored — only the optimized variant.
          transformation: [
            { width: 2000, height: 2000, crop: 'limit' },
            { quality: 'auto:good', fetch_format: 'auto' },
          ],
        },
        (err, res) => (err ? reject(err) : resolve(res)),
      );
      stream.end(p.buffer);
    });

    // driverId was guaranteed non-null by the early-return above.
    const [doc] = await db
      .insert(loadDocuments)
      .values({
        loadId: p.loadId,
        driverId,
        documentType: p.stage,
        fileName: p.originalName,
        fileUrl: result.secure_url,
        fileSize: result.bytes,
        mimeType: p.mimeType,
        notes: p.notes || null,
        approvalStatus: 'pending',
      } as any)
      .returning();
    const docId = doc.id;

    // Piggyback: record a driver_locations row if GPS was supplied. Feeds the
    // geofence cron so we know where the driver is between uploads too.
    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      try {
        await db.insert(driverLocations).values({
          driverId,
          latitude: p.lat,
          longitude: p.lng,
          timestamp: new Date(),
          loadId: p.loadId,
          isActive: true,
          source: 'photo-upload',
        } as any);
      } catch (locErr: any) {
        console.warn('[load-photos] driverLocations insert failed:', locErr?.message || locErr);
      }
    }

    return { ok: true, url: result.secure_url, docId: docId || '' };
  } catch (err: any) {
    console.error('[load-photos] upload error:', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Sibling of uploadLoadPhoto for the direct-to-Cloudinary upload path.
// The browser already pushed the photo to Cloudinary using a signed
// preset from /api/loads/:id/photos/cloudinary-signature, so we just
// need to write the load_documents row. Keeps the same return shape +
// driver/loadId safety checks as the multipart path.
export async function recordExternalPhotoUpload(p: {
  loadId: string;
  driverId?: string;
  stage: PhotoStage;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  fileSize?: number;
  mimeType?: string;
  originalName?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}): Promise<{ ok: true; url: string; docId: string } | { ok: false; error: string }> {
  const load = await db.query.loads.findFirst({ where: eq(loads.id, p.loadId) });
  if (!load) return { ok: false, error: 'Load not found' };

  // Same orphan-prevention guard as uploadLoadPhoto.
  const driverId = p.driverId || load.driverId || null;
  if (!driverId) {
    console.error(`[load-photos] refusing direct-upload record for load ${p.loadId} — no driver assigned`);
    return {
      ok: false,
      error: 'No driver assigned to this load. Contact dispatch before uploading.',
    };
  }

  try {
    const [doc] = await db
      .insert(loadDocuments)
      .values({
        loadId: p.loadId,
        driverId,
        documentType: p.stage,
        fileName: p.originalName || `${p.stage}.jpg`,
        fileUrl: p.cloudinaryUrl,
        fileSize: p.fileSize || 0,
        mimeType: p.mimeType || 'image/jpeg',
        notes: p.notes || null,
        approvalStatus: 'pending',
      } as any)
      .returning();

    if (typeof p.lat === 'number' && typeof p.lng === 'number') {
      try {
        await db.insert(driverLocations).values({
          driverId,
          latitude: p.lat,
          longitude: p.lng,
          timestamp: new Date(),
          loadId: p.loadId,
          isActive: true,
          source: 'photo-upload-direct',
        } as any);
      } catch (locErr: any) {
        console.warn('[load-photos] driverLocations insert failed:', locErr?.message || locErr);
      }
    }

    return { ok: true, url: p.cloudinaryUrl, docId: doc?.id || '' };
  } catch (err: any) {
    console.error('[load-photos] recordExternalPhotoUpload error:', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

export type UploadPhase = 'pickup' | 'delivery';

export function stagesForPhase(phase: UploadPhase): PhotoStage[] {
  return phase === 'delivery' ? [...DELIVERY_STAGES] : [...PICKUP_STAGES];
}

/**
 * Which required photos for a phase are present vs missing on a load.
 * A stage counts as present if ANY load_documents row exists for it (pending
 * or approved — the driver has done their part; dispatcher approval is a
 * separate downstream gate). This powers both the driver's "Done" button and
 * the server-side advancement gate.
 */
export async function getRequiredPhotoStatus(
  loadId: string,
  phase: UploadPhase,
): Promise<{ complete: boolean; present: PhotoStage[]; missing: PhotoStage[] }> {
  const required = stagesForPhase(phase);
  const docs = await db
    .select({ documentType: loadDocuments.documentType })
    .from(loadDocuments)
    .where(eq(loadDocuments.loadId, loadId));
  const have = new Set(docs.map((d) => d.documentType));
  const present = required.filter((s) => have.has(s));
  const missing = required.filter((s) => !have.has(s));
  return { complete: missing.length === 0, present, missing };
}

export async function listLoadPhotos(loadId: string) {
  const docs = await db
    .select()
    .from(loadDocuments)
    .where(eq(loadDocuments.loadId, loadId))
    .orderBy(desc(loadDocuments.createdAt as any));

  const byStage: Record<string, any[]> = {};
  for (const d of docs) {
    const key = d.documentType || 'other';
    (byStage[key] = byStage[key] || []).push(d);
  }
  return { docs, byStage };
}

// Send driver an SMS with the tokenized upload link for a given stage.
// Token format: load.id (we use the load id as the token; page is gated by
// the token being known only to the driver via SMS).
export async function sendUploadLink(
  loadId: string,
  stages: PhotoStage[],
  customMessage?: string,
): Promise<{ ok: boolean; sent: number; error?: string }> {
  const load = await db.query.loads.findFirst({ where: eq(loads.id, loadId) });
  if (!load) return { ok: false, sent: 0, error: 'Load not found' };
  if (!load.driverId) return { ok: false, sent: 0, error: 'No driver on load' };

  const driver = await db.query.drivers.findFirst({
    where: eq(drivers.id, load.driverId),
  });
  if (!driver?.phone) return { ok: false, sent: 0, error: 'Driver phone missing' };

  // MMS path — default OFF. Driver replies with photo instead of tapping a
  // link. The inbound /api/sms/webhook handler routes the photo to the
  // correct (load, stage) using pending_uploads rows written here. See
  // ~/.claude/plans/mms-bol-upload-CONTEXT.md.
  if (process.env.MMS_UPLOAD_ENABLED === 'true') {
    const { createPendingUpload, STAGE_REPLY_LABEL } = await import('./mms-upload-service');
    for (const stage of stages) {
      await createPendingUpload({ driverPhone: driver.phone, loadId, stage });
    }
    const firstLabel = STAGE_REPLY_LABEL[stages[0]];
    // Include pickup → delivery so the driver can identify the load by
    // route, not just load number. Most drivers remember where they're
    // going, not the load number.
    const pickup = load.originCity && load.originState
      ? `${load.originCity}, ${load.originState}`
      : load.pickupAddress || 'pickup';
    const delivery = load.destCity && load.destState
      ? `${load.destCity}, ${load.destState}`
      : load.deliveryAddress || 'delivery';
    const mmsMsg =
      customMessage ||
      `📸 LAMP Load ${load.loadNumber} (${pickup} → ${delivery})\nPickup: ${load.pickupAddress}\nDelivery: ${load.deliveryAddress}\nReply with a photo of the ${firstLabel}.`;
    const r = await smsLoadService.sendSMS(driver.phone, mmsMsg);
    return { ok: r.success, sent: r.success ? 1 : 0, error: r.error };
  }

  const baseUrl =
    process.env.PUBLIC_URL || process.env.APP_URL || 'https://traqiq.app';

  // New SMS links use signed tokens (HMAC-SHA256 over loadId+expiry).
  // Default 14-day TTL covers pickup-to-delivery + slack. The route
  // accepts both signed-token and legacy-UUID URLs during rollout.
  const { signUploadToken } = await import('./upload-token');
  const token = signUploadToken(loadId);
  const stagesParam = stages.join(',');
  const link = `${baseUrl}/u/${token}?stages=${stagesParam}`;

  const stageLabels = stages.map((s) => STAGE_LABELS[s]).join(' + ');
  // Include pickup → delivery so the driver can identify the load by
  // route. Most drivers remember where they're going, not the load number.
  const pickup = load.originCity && load.originState
    ? `${load.originCity}, ${load.originState}`
    : load.pickupAddress || 'pickup';
  const delivery = load.destCity && load.destState
    ? `${load.destCity}, ${load.destState}`
    : load.deliveryAddress || 'delivery';
  const msg =
    customMessage ||
    `📸 LAMP Load ${load.loadNumber} (${pickup} → ${delivery})\nPickup: ${load.pickupAddress}\nDelivery: ${load.deliveryAddress}\nPlease upload ${stageLabels}:\n${link}`;

  const r = await smsLoadService.sendSMS(driver.phone, msg);
  return { ok: r.success, sent: r.success ? 1 : 0, error: r.error };
}

// Computed once per boot — sha256 of the inlined client JS. The
// renderUploadPage HTML embeds this as a query string on the upload.js
// <script> tag so every shipped fix produces a brand-new URL, defeating
// any aggressive iOS Safari / CDN cache for the previous version.
const UPLOAD_JS_HASH = createHash('sha256').update(UPLOAD_PAGE_CLIENT_JS).digest('hex').slice(0, 12);

export function renderUploadPage(
  loadId: string,
  stages: PhotoStage[],
  loadNumber: string,
  uploadToken?: string | null,
): string {
  // Per code review: inline <script> inside a template literal had its
  // backslash escapes consumed by the template literal parser, which
  // turned regex literals into broken JS and blanked the page. The page
  // now embeds a tiny JSON island for configuration and loads the real
  // client script from a separate /u-assets/upload.js asset.
  const configJson = JSON.stringify({
    loadId,
    stages: stages.map((s) => ({ stage: s, label: STAGE_LABELS[s] })),
    token: uploadToken || null,
  })
    // Escape </script> in user-controlled fields just in case; loadNumber
    // is server-controlled but defensive doesn't hurt.
    .replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Upload Photos — Load ${loadNumber}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,system-ui,sans-serif;max-width:500px;margin:0 auto;padding:16px;background:#0f172a;color:#f1f5f9;min-height:100vh}
  h1{font-size:20px;color:#22d3ee;margin:8px 0 2px}
  .meta{color:#94a3b8;font-size:13px;margin-bottom:20px}
  .slot{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px;margin-bottom:14px}
  .slot h2{font-size:15px;margin:0 0 10px;color:#e2e8f0}
  .slot.done{border-color:#22c55e;background:#14532d33}
  .slot.done h2::before{content:"✅ ";color:#22c55e}
  .req-badge{display:inline-block;background:#7c2d12;color:#fed7aa;border:1px solid #ea580c;font-size:10px;font-weight:700;letter-spacing:.5px;padding:1px 6px;border-radius:4px;vertical-align:middle;margin-left:6px}
  .slot.done .req-badge{background:#14532d;border-color:#22c55e;color:#bbf7d0}
  input[type=file]{display:none}
  label.btn{display:block;background:#0ea5e9;color:white;padding:14px;border-radius:8px;text-align:center;font-weight:600;cursor:pointer;font-size:15px}
  label.btn:active{background:#0369a1}
  .status{font-size:13px;margin-top:8px;color:#94a3b8}
  .status.error{color:#f87171}
  .status.ok{color:#4ade80}
  img.preview{max-width:100%;border-radius:6px;margin-top:10px;border:1px solid #334155}
  .progress{height:4px;background:#334155;border-radius:2px;margin-top:8px;overflow:hidden}
  .progress > div{height:100%;background:#22d3ee;transition:width .3s}
  footer{text-align:center;color:#64748b;font-size:12px;margin-top:20px}
</style>
</head><body>
  <h1>📸 Upload Photos</h1>
  <div class="meta">Load <b>${loadNumber}</b> · LAMP Logistics</div>

  <div id="slots"></div>

  <details id="checkin-slot" style="margin-top:18px;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 14px">
    <summary style="cursor:pointer;color:#94a3b8;font-size:14px;font-weight:600;list-style:none">📍 Manual check-in (optional)</summary>
    <div style="font-size:12px;color:#64748b;margin:8px 0 10px">Only use if dispatch asks for one. Normal flow is just upload the BOL above.</div>
    <div id="checkin-buttons" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
    <div class="status" id="checkin-status"></div>
  </details>
  <footer>Photos auto-save. You can close this page when done.</footer>

<script id="upload-config" type="application/json">${configJson}</script>
<script src="/u-assets/upload.js?v=${UPLOAD_JS_HASH}" defer></script>
</body></html>`;
}
