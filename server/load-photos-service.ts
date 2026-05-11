// Load Photos Service
// Manages driver-uploaded photos for loads (BOL, securement, POD, signed BOL).
// Storage: Cloudinary (via CLOUDINARY_URL env var).
// Records metadata in the existing load_documents table.

import { v2 as cloudinary } from 'cloudinary';
import { db } from './db';
import { loadDocuments, loads, drivers, driverLocations } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { smsLoadService } from './sms-service';

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
        },
        (err, res) => (err ? reject(err) : resolve(res)),
      );
      stream.end(p.buffer);
    });

    const driverId = p.driverId || load.driverId || null;

    let docId: string | null = null;
    if (driverId) {
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
      docId = doc.id;
    } else {
      // Still record the upload even without a driver; use first driver_id NOT NULL hack
      console.warn(`[load-photos] no driverId for load ${p.loadId}, skipping doc row`);
    }

    // Piggyback: record a driver_locations row if GPS was supplied. Feeds the
    // geofence cron so we know where the driver is between uploads too.
    if (driverId && typeof p.lat === 'number' && typeof p.lng === 'number') {
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

  const baseUrl =
    process.env.PUBLIC_URL || process.env.APP_URL || 'https://traqiq.app';

  const stagesParam = stages.join(',');
  const link = `${baseUrl}/u/${loadId}?stages=${stagesParam}`;

  const stageLabels = stages.map((s) => STAGE_LABELS[s]).join(' + ');
  const msg =
    customMessage ||
    `📸 LAMP: Load ${load.loadNumber} — please upload ${stageLabels}. Tap: ${link}`;

  const r = await smsLoadService.sendSMS(driver.phone, msg);
  return { ok: r.success, sent: r.success ? 1 : 0, error: r.error };
}

export function renderUploadPage(
  loadId: string,
  stages: PhotoStage[],
  loadNumber: string,
): string {
  const stagesJson = JSON.stringify(
    stages.map((s) => ({ stage: s, label: STAGE_LABELS[s] })),
  );

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

<script>
const LOAD_ID = ${JSON.stringify(loadId)};
const STAGES = ${stagesJson};
const root = document.getElementById('slots');

// ---------- Check-In buttons ----------
const CHECKINS = [
  { stage: 'at_pickup',   label: '🚚 At Pickup' },
  { stage: 'loaded',      label: '📦 Loaded' },
  { stage: 'at_delivery', label: '🏁 At Delivery' },
  { stage: 'unloaded',    label: '✅ Unloaded' },
];
const ciRoot = document.getElementById('checkin-buttons');
const ciStatus = document.getElementById('checkin-status');
CHECKINS.forEach((c) => {
  const b = document.createElement('button');
  b.textContent = c.label;
  b.style.cssText = 'background:#334155;color:#f1f5f9;border:1px solid #475569;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer';
  b.onclick = async () => {
    b.disabled = true;
    ciStatus.className = 'status';
    ciStatus.textContent = 'Sending ' + c.label + '...';
    try {
      const coords = await new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { timeout: 4000, maximumAge: 60000 }
        );
      });
      const body = { stage: c.stage, ...(coords || {}) };
      const res = await fetch('/api/loads/' + LOAD_ID + '/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      b.style.background = '#14532d';
      b.style.borderColor = '#22c55e';
      b.textContent = '✅ ' + c.label;
      ciStatus.className = 'status ok';
      ciStatus.textContent = c.label + ' recorded.';
    } catch (err) {
      b.disabled = false;
      ciStatus.className = 'status error';
      ciStatus.textContent = 'Failed: ' + err.message;
    }
  };
  ciRoot.appendChild(b);
});

STAGES.forEach((s) => {
  const el = document.createElement('div');
  el.className = 'slot';
  el.id = 'slot-' + s.stage;
  el.innerHTML =
    '<h2>' + s.label + '</h2>' +
    '<label class="btn" for="file-' + s.stage + '">📷 Take / Choose Photo</label>' +
    '<input type="file" id="file-' + s.stage + '" accept="image/*">' +
    '<div class="progress" style="display:none"><div style="width:0%"></div></div>' +
    '<div class="status"></div>' +
    '<img class="preview" style="display:none" />';
  root.appendChild(el);
  const input = el.querySelector('input');
  input.addEventListener('change', () => handleUpload(s.stage, input.files[0]));
});

// Downscale the image client-side before upload. iPhone photos are routinely
// 4-12 MB; on LTE that takes 30-60s and the user thinks the app is dead.
// Resizing to max 2000px on the long edge + JPEG quality 0.85 typically cuts
// to 300-700 KB with no visible quality loss for BOL/POD purposes.
function compressImage(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 2000;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function fmtKB(n) { return n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB'; }

async function handleUpload(stage, rawFile) {
  if (!rawFile) return;
  const slot = document.getElementById('slot-' + stage);
  const status = slot.querySelector('.status');
  const bar = slot.querySelector('.progress');
  const barFill = bar.querySelector('div');
  const preview = slot.querySelector('img.preview');
  const label = slot.querySelector('label.btn');

  // Lock the slot so users don't tap again mid-upload
  label.style.pointerEvents = 'none';
  label.style.opacity = '0.6';
  slot.classList.remove('done');
  bar.style.display = 'block';
  barFill.style.width = '2%';
  status.className = 'status';
  status.textContent = 'Preparing photo…';

  // Show preview immediately so the user knows the tap registered
  const reader = new FileReader();
  reader.onload = () => { preview.src = reader.result; preview.style.display = 'block'; };
  reader.readAsDataURL(rawFile);

  let file = rawFile;
  try {
    file = await compressImage(rawFile);
  } catch (_) { /* fall through with original */ }

  status.textContent = 'Uploading ' + fmtKB(file.size) + '…';

  // GPS in parallel — don't block upload waiting for it
  const coordsPromise = new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 3000, maximumAge: 60000 }
    );
  });
  const coords = await coordsPromise;

  const fd = new FormData();
  fd.append('photo', file);
  fd.append('stage', stage);
  if (coords) { fd.append('lat', String(coords.lat)); fd.append('lng', String(coords.lng)); }

  // XHR for REAL upload progress. fetch() doesn't expose upload progress.
  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/loads/' + LOAD_ID + '/photos');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.min(95, Math.round((e.loaded / e.total) * 95));
          barFill.style.width = pct + '%';
          status.textContent = 'Uploading ' + pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          barFill.style.width = '100%';
          resolve(null);
        } else {
          let msg = 'HTTP ' + xhr.status;
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timed out'));
      xhr.timeout = 120000;
      xhr.send(fd);
    });

    slot.classList.add('done');
    status.className = 'status ok';
    status.textContent = '✅ Uploaded — saved to dispatch.';
    label.textContent = '📷 Replace Photo';
    label.style.background = '#14532d';
    label.style.pointerEvents = '';
    label.style.opacity = '';
    if (navigator.vibrate) navigator.vibrate(80);
  } catch (err) {
    status.className = 'status error';
    status.textContent = '❌ Upload failed: ' + err.message + ' — tap the button to retry';
    bar.style.display = 'none';
    label.style.pointerEvents = '';
    label.style.opacity = '';
  }
}
</script>
</body></html>`;
}
