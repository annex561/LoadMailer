// Driver Self-Onboarding
// -----------------------
// Public URL a dispatcher shares with a new driver. Driver fills the form
// once; we create their record, mint a trackingToken, and bounce them
// straight into their mobile portal.
//
// Routes wired in server/routes.ts:
//   GET  /onboard            → mobile-friendly signup form
//   POST /onboard            → creates driver, 302 to /driver/:token
//
// Auth model: no password. The trackingToken IS their credential — the
// form-submit response immediately places them in their authenticated
// portal, and from then on they use their per-driver dashboard link.

import type { Request, Response } from 'express';
import { db } from './db';
import { drivers } from '@shared/schema';
import { or, eq } from 'drizzle-orm';
import { VEHICLE_TYPES, DEADHEAD_PRESETS } from './driver-portal';

const DEFAULT_COMPANY_ID = 'comp-traqiq-001';

function escapeHtml(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}

function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function generateToken(): string {
  // 32 hex chars (128-bit) — same shape as existing tokens
  const bytes = new Uint8Array(16);
  (globalThis.crypto as any)?.getRandomValues?.(bytes);
  if (bytes.every((b) => b === 0)) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function renderOnboardForm(opts: { error?: string; values?: Record<string, any> } = {}): string {
  const err = opts.error ? `<div class="err">${escapeHtml(opts.error)}</div>` : '';
  const v = opts.values || {};
  const vehicleOptions = VEHICLE_TYPES.map((t) => {
    const sel = v.vehicleType === t.value ? ' selected' : '';
    return `<option value="${t.value}"${sel}>${escapeHtml(t.label)}</option>`;
  }).join('');
  const deadheadPills = DEADHEAD_PRESETS.map((n) => {
    const checked = String(v.maxDeadheadMiles ?? 150) === String(n) ? 'checked' : '';
    return `<label class="pill"><input type="radio" name="maxDeadheadMiles" value="${n}" ${checked}/>${n} mi</label>`;
  }).join('');

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="theme-color" content="#0f172a">
<title>Driver Onboarding · LAMP Logistics</title>
<style>
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;padding:0;background:#0f172a;color:#f1f5f9;font-family:-apple-system,system-ui,sans-serif}
  body{padding:20px 16px 60px;max-width:520px;margin:0 auto;min-height:100vh}
  .hero{background:linear-gradient(135deg,#0c4a6e,#0369a1);border:1px solid #38bdf8;border-radius:14px;padding:20px;margin-bottom:18px;text-align:center}
  .hero h1{margin:0 0 6px;font-size:22px;color:#fff}
  .hero p{margin:0;color:#bae6fd;font-size:13px}
  h2{font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 8px}
  label{display:block;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:12px}
  input,select,textarea{width:100%;background:#1e293b;border:1px solid #334155;color:#f1f5f9;padding:11px 12px;border-radius:8px;font-size:15px;margin-top:4px;font-family:inherit}
  input:focus,select:focus,textarea:focus{outline:0;border-color:#22d3ee}
  .req{color:#f87171}
  .pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .pill{background:#1e293b;border:1px solid #334155;border-radius:999px;padding:8px 14px;font-size:13px;color:#cbd5e1;cursor:pointer}
  .pill input{display:none}
  .pill:has(input:checked){background:#164e63;border-color:#22d3ee;color:#e0f2fe}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .hint{color:#64748b;font-size:12px;margin-top:4px}
  .btn{display:block;width:100%;margin-top:24px;background:#22c55e;color:#052e16;padding:14px;border:0;border-radius:10px;font-weight:800;font-size:16px;cursor:pointer;letter-spacing:.3px}
  .btn:active{background:#16a34a}
  .err{background:#7f1d1d;color:#fecaca;border:1px solid #f87171;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:14px}
  .foot{color:#64748b;font-size:12px;text-align:center;margin-top:20px}
  .states{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:8px}
  .states label{margin:0;padding:0;text-transform:none;letter-spacing:0}
  .states label input{display:none}
  .states span{display:block;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:8px 2px;text-align:center;font-size:12px;color:#cbd5e1;cursor:pointer;font-weight:600}
  .states label:has(input:checked) span{background:#164e63;border-color:#22d3ee;color:#e0f2fe}
</style>
</head><body>
  <div class="hero">
    <h1>🚛 Join LAMP Logistics</h1>
    <p>Fill this out once — you'll get a personal dashboard link for loads, pay &amp; updates.</p>
  </div>
  ${err}
  <form method="post" action="/onboard" autocomplete="on">
    <h2>About You</h2>
    <label>Full Name <span class="req">*</span></label>
    <input name="name" required value="${escapeHtml(v.name || '')}" placeholder="John Smith"/>

    <div class="grid2">
      <div>
        <label>Mobile Phone <span class="req">*</span></label>
        <input name="phone" type="tel" required value="${escapeHtml(v.phone || '')}" placeholder="(205) 555-1234"/>
        <div class="hint">We text loads to this number.</div>
      </div>
      <div>
        <label>Email <span class="req">*</span></label>
        <input name="email" type="email" required value="${escapeHtml(v.email || '')}" placeholder="you@email.com"/>
      </div>
    </div>

    <label>Home Base (City, ST)</label>
    <input name="homeBase" value="${escapeHtml(v.homeBase || '')}" placeholder="Birmingham, AL"/>

    <h2>Vehicle</h2>
    <label>Vehicle / Trailer Type <span class="req">*</span></label>
    <select name="vehicleType" required>
      <option value="">— Select —</option>
      ${vehicleOptions}
    </select>

    <div class="grid2">
      <div>
        <label>Trailer Length (ft)</label>
        <input name="trailerLength" type="number" min="0" max="80" value="${escapeHtml(v.trailerLength || '')}" placeholder="e.g. 40"/>
      </div>
      <div>
        <label>CDL / License #</label>
        <input name="licenseNumber" value="${escapeHtml(v.licenseNumber || '')}" placeholder="License #"/>
      </div>
    </div>

    <h2>Load Preferences</h2>
    <label>How far will you deadhead to a pickup?</label>
    <div class="pills">${deadheadPills}</div>

    <label>Preferred destination states (leave empty = anywhere)</label>
    <div class="states">${renderStateCheckboxes(v.preferredDestinations)}</div>
    <div class="hint">Tap states you want loads to. Blank = we'll send you anywhere.</div>

    <h2>Emergency Contact</h2>
    <label>Name / Phone</label>
    <input name="emergencyContact" value="${escapeHtml(v.emergencyContact || '')}" placeholder="Jane Smith / 205-555-9999"/>

    <button class="btn" type="submit">Create My Account →</button>
    <div class="foot">By submitting you agree to receive SMS messages about loads &amp; dispatch.<br/>Standard message rates apply.</div>
  </form>
</body></html>`;
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

function renderStateCheckboxes(preferred: any): string {
  const prefs = new Set<string>(
    (Array.isArray(preferred) ? preferred : typeof preferred === 'string' ? preferred.split(',') : [])
      .map((s: any) => String(s).trim().toUpperCase())
      .filter(Boolean),
  );
  return US_STATES.map((st) => {
    const checked = prefs.has(st) ? 'checked' : '';
    return `<label><input type="checkbox" name="preferredDestinations" value="${st}" ${checked}/><span>${st}</span></label>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleOnboardGet(_req: Request, res: Response) {
  res.type('html').send(renderOnboardForm());
}

export async function handleOnboardPost(req: Request, res: Response) {
  const body = (req.body || {}) as Record<string, any>;
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phoneRaw = String(body.phone || '').trim();
  const phone = normalizePhone(phoneRaw);
  const vehicleType = String(body.vehicleType || '').trim();

  const rerender = (error: string) =>
    res.status(400).type('html').send(renderOnboardForm({ error, values: body }));

  if (!name) return rerender('Please enter your full name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return rerender('Please enter a valid email.');
  if (!phone || phone.replace(/\D/g, '').length < 10) return rerender('Please enter a valid phone number.');
  if (!vehicleType || !VEHICLE_TYPES.find((t) => t.value === vehicleType)) {
    return rerender('Please pick a vehicle / trailer type.');
  }

  // Dedupe by email or phone
  try {
    const existing = await db
      .select()
      .from(drivers)
      .where(or(eq(drivers.email, email), eq(drivers.phone, phone)))
      .limit(1);
    if (existing.length > 0) {
      const dup = existing[0];
      if (dup.trackingToken) {
        return res.redirect(`/driver/${dup.trackingToken}?welcome=back`);
      }
      // Mint a token for them and redirect
      const token = generateToken();
      await db.update(drivers).set({ trackingToken: token }).where(eq(drivers.id, dup.id));
      return res.redirect(`/driver/${token}?welcome=back`);
    }
  } catch (err) {
    console.error('[onboard] dedupe check failed', err);
  }

  // Preferred destinations
  let preferredDestinations: string[] = [];
  const raw = body.preferredDestinations;
  if (Array.isArray(raw)) preferredDestinations = raw.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  else if (typeof raw === 'string' && raw) preferredDestinations = [raw.trim().toUpperCase()];
  preferredDestinations = preferredDestinations.slice(0, 20);

  // Deadhead
  let maxDeadheadMiles = 150;
  const dhRaw = Number(body.maxDeadheadMiles);
  if (Number.isFinite(dhRaw) && dhRaw >= 0 && dhRaw <= 2000) maxDeadheadMiles = Math.round(dhRaw);

  // Trailer length
  let trailerLength: number | null = null;
  const tl = Number(body.trailerLength);
  if (Number.isFinite(tl) && tl > 0 && tl <= 80) trailerLength = Math.round(tl);

  const token = generateToken();
  const record: any = {
    companyId: DEFAULT_COMPANY_ID,
    name,
    email,
    phone,
    phoneNumber: phone,
    status: 'available',
    isOnboarded: true,
    licenseNumber: String(body.licenseNumber || '').trim() || null,
    emergencyContact: String(body.emergencyContact || '').trim() || null,
    homeBase: String(body.homeBase || '').trim() || null,
    vehicleType,
    trailerLength,
    maxDeadheadMiles,
    preferredDestinations,
    enableSmsNotifications: true,
    trackingToken: token,
    equipmentType: vehicleType.startsWith('semi_') ? mapSemiEquipment(vehicleType) : 'dry_van',
  };

  try {
    const [created] = await db.insert(drivers).values(record).returning();
    console.log(`[onboard] created driver ${created.id} ${created.name} (${created.phone})`);
    return res.redirect(`/driver/${token}?welcome=1`);
  } catch (err: any) {
    console.error('[onboard] insert failed', err);
    return rerender(`Could not create account: ${err?.message || 'server error'}. Please try again or text dispatch.`);
  }
}

function mapSemiEquipment(vt: string): string {
  switch (vt) {
    case 'semi_dryvan': return 'dry_van';
    case 'semi_reefer': return 'refrigerated';
    case 'semi_flatbed': return 'flatbed';
    case 'semi_stepdeck': return 'step_deck';
    case 'semi_lowboy': return 'lowboy';
    case 'semi_rgn': return 'removable_gooseneck';
    case 'semi_conestoga': return 'conestoga';
    case 'semi_poweronly': return 'power_only';
    case 'semi_tanker': return 'tanker';
    case 'semi_dump': return 'dump_truck';
    case 'car_hauler_open':
    case 'car_hauler_enc': return 'car_carrier';
    default: return 'dry_van';
  }
}
