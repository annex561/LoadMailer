// Driver Mobile Portal
// ----------------------
// Server-rendered HTML pages a driver accesses from their SMS link.
// Auth = drivers.trackingToken (driver ID is implicit — they only see their own data).
//
// Routes served (wired in server/routes.ts):
//   GET  /driver/:token              → home dashboard
//   GET  /driver/:token/loads        → load list
//   GET  /driver/:token/loads/:id    → load detail + photos + check-in
//   GET  /driver/:token/profile      → editable profile + preferences
//   PATCH /api/drivers/self/:token   → JSON update of editable fields only

import { db } from './db';
import { drivers, loads, loadDocuments } from '@shared/schema';
import { eq, and, desc, or, isNull } from 'drizzle-orm';
import { weekRange, fmtYMD, computeSettlementForDriver } from './settlements-service';
import { STAGE_LABELS } from './load-photos-service';

// ---------------------------------------------------------------------------
// Canonical vehicle / trailer type list.
// ---------------------------------------------------------------------------
export interface VehicleTypeEntry {
  value: string;
  label: string;
  category: 'pickup' | 'box' | 'semi';
}

export const VEHICLE_TYPES: VehicleTypeEntry[] = [
  // Pickup / Hotshot
  { value: 'pickup_bumper',     label: 'Pickup + Bumper Pull',    category: 'pickup' },
  { value: 'pickup_gooseneck',  label: 'Pickup + Gooseneck',      category: 'pickup' },
  { value: 'hotshot_flatbed',   label: 'Hotshot Flatbed (40 ft)', category: 'pickup' },
  { value: 'hotshot_3car',      label: 'Hotshot 3-Car Hauler',    category: 'pickup' },

  // Box / small
  { value: 'sprinter',          label: 'Sprinter / Cargo Van',    category: 'box' },
  { value: 'box_16',            label: "Box Truck 16'",           category: 'box' },
  { value: 'box_24',            label: "Box Truck 24'",           category: 'box' },
  { value: 'box_26',            label: "Box Truck 26'",           category: 'box' },

  // Semi / CDL
  { value: 'semi_dryvan',       label: "Dry Van 53'",             category: 'semi' },
  { value: 'semi_reefer',       label: "Reefer 53'",              category: 'semi' },
  { value: 'semi_flatbed',      label: "Flatbed 48/53'",          category: 'semi' },
  { value: 'semi_stepdeck',     label: 'Step Deck',               category: 'semi' },
  { value: 'semi_lowboy',       label: 'Lowboy / Double Drop',    category: 'semi' },
  { value: 'semi_rgn',          label: 'RGN (Removable Goose)',   category: 'semi' },
  { value: 'semi_conestoga',    label: 'Conestoga',               category: 'semi' },
  { value: 'semi_poweronly',    label: 'Power Only',              category: 'semi' },
  { value: 'semi_tanker',       label: 'Tanker',                  category: 'semi' },
  { value: 'semi_dump',         label: 'Dump',                    category: 'semi' },
  { value: 'car_hauler_open',   label: 'Car Hauler (Open)',       category: 'semi' },
  { value: 'car_hauler_enc',    label: 'Car Hauler (Enclosed)',   category: 'semi' },
];

export const DEADHEAD_PRESETS = [50, 75, 100, 150, 200];

// Fields a driver is allowed to edit about themselves
export const SELF_EDITABLE_FIELDS = [
  'phone',
  'address',
  'city',
  'state',
  'zipCode',
  'emergencyContact',
  'vehicleType',
  'trailerLength',
  'maxDeadheadMiles',
  'preferredDestinations',
  'homeBase',
  'licenseState',
  'licenseExpiry',
  'vehicleYear',
  'vehicleMake',
  'vehicleModel',
  'vehicleVin',
  'vehiclePlate',
] as const;

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
export async function driverFromToken(token: string) {
  if (!token) return null;
  const [d] = await db.select().from(drivers).where(eq(drivers.trackingToken, token));
  return d || null;
}

// ---------------------------------------------------------------------------
// Shared layout — dark mobile theme, bottom tab nav.
// ---------------------------------------------------------------------------
export function layout({
  title,
  token,
  active,
  body,
  showBack = false,
  backHref,
}: {
  title: string;
  token: string;
  active: 'home' | 'loads' | 'pay' | 'profile';
  body: string;
  showBack?: boolean;
  backHref?: string;
}): string {
  const tab = (key: string, label: string, icon: string, href: string) => `
    <a href="${href}" class="tab ${active === key ? 'active' : ''}">
      <div class="tab-ico">${icon}</div>
      <div class="tab-lbl">${label}</div>
    </a>`;
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="theme-color" content="#0f172a">
<title>${title}</title>
<style>
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{margin:0;padding:0;background:#0f172a;color:#f1f5f9;font-family:-apple-system,system-ui,sans-serif}
  body{padding:16px 16px 96px;max-width:500px;margin:0 auto;min-height:100vh}
  a{color:inherit;text-decoration:none}
  h1{font-size:22px;margin:6px 0 4px;color:#22d3ee;font-weight:700}
  h2{font-size:15px;margin:18px 0 8px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
  .topbar{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .back{background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:6px 10px;border-radius:8px;font-size:14px}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;margin-bottom:10px}
  .card.emph{background:linear-gradient(135deg,#0c4a6e,#0369a1);border-color:#38bdf8}
  .row{display:flex;justify-content:space-between;gap:12px;align-items:center}
  .muted{color:#94a3b8;font-size:13px}
  .big{font-size:26px;font-weight:800;color:#4ade80}
  .btn{display:inline-block;background:#0ea5e9;color:white;padding:10px 14px;border-radius:8px;font-weight:600;font-size:14px;border:0;cursor:pointer;text-align:center}
  .btn:active{background:#0369a1}
  .btn.secondary{background:#334155;color:#e2e8f0;border:1px solid #475569}
  .btn.success{background:#16a34a}
  .btn.danger{background:#dc2626}
  .btn.block{display:block;width:100%;margin:6px 0}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase}
  .badge.amber{background:#78350f;color:#fcd34d}
  .badge.green{background:#14532d;color:#86efac}
  .badge.blue{background:#1e3a8a;color:#93c5fd}
  .badge.red{background:#7f1d1d;color:#fca5a5}
  .badge.gray{background:#1e293b;color:#94a3b8;border:1px solid #334155}
  .list-item{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .list-item:active{background:#334155}
  input,select,textarea{width:100%;background:#0f172a;border:1px solid #334155;color:#f1f5f9;padding:10px 12px;border-radius:8px;font-size:14px;margin-top:4px;font-family:inherit}
  input:focus,select:focus,textarea:focus{outline:0;border-color:#22d3ee}
  label{display:block;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:12px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .pill-opt{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 4px;text-align:center;font-size:13px;font-weight:600;cursor:pointer}
  .pill-opt.on{background:#164e63;border-color:#22d3ee;color:#e0f2fe}
  .status{font-size:13px;margin-top:8px}
  .status.ok{color:#4ade80}
  .status.err{color:#f87171}
  .tabbar{position:fixed;bottom:0;left:0;right:0;background:#0f172a;border-top:1px solid #334155;display:flex;max-width:500px;margin:0 auto;z-index:50}
  .tab{flex:1;padding:10px 0 14px;text-align:center;color:#64748b;font-size:11px}
  .tab.active{color:#22d3ee}
  .tab-ico{font-size:20px;line-height:1}
  .tab-lbl{margin-top:2px}
</style>
</head><body>
  <div class="topbar">
    ${showBack ? `<a class="back" href="${backHref || `/driver/${token}`}">← Back</a>` : ''}
    <h1 style="flex:1;margin:0">${title}</h1>
  </div>
  ${body}
  <div class="tabbar">
    ${tab('home',    'Home',    '🏠', `/driver/${token}`)}
    ${tab('loads',   'Loads',   '📋', `/driver/${token}/loads`)}
    ${tab('pay',     'Pay',     '💰', `/my-pay/${token}`)}
    ${tab('profile', 'Profile', '👤', `/driver/${token}/profile`)}
  </div>
</body></html>`;
}

function fmtMoney(n: number) { return `$${(n || 0).toFixed(2)}`; }
function escapeHtml(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
function loadStatusBadge(load: any): string {
  const sop: any = load.sopProgress || {};
  if (load.deliveredAt) return '<span class="badge green">Delivered</span>';
  if (sop.unloadedAt) return '<span class="badge green">Unloaded</span>';
  if (sop.atDeliveryAt) return '<span class="badge blue">At Delivery</span>';
  if (sop.loadedAt) return '<span class="badge blue">En Route</span>';
  if (sop.atPickupAt) return '<span class="badge amber">At Pickup</span>';
  if (load.driverId) return '<span class="badge amber">Dispatched</span>';
  return '<span class="badge gray">Assigned</span>';
}

// ---------------------------------------------------------------------------
// Page: Home
// ---------------------------------------------------------------------------
export async function renderHome(token: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'home', body: '<p>Invalid driver link.</p>' });

  // Active load(s) — assigned + not delivered
  const active = await db
    .select()
    .from(loads)
    .where(and(eq(loads.driverId, driver.id), isNull(loads.deliveredAt)))
    .orderBy(desc(loads.createdAt))
    .limit(3);

  // This week pay
  const settlement = await computeSettlementForDriver(driver.id, fmtYMD(new Date()));
  const net = settlement?.netPay ?? -((driver.weeklyFuelCost || 0) + (driver.weeklyInsuranceCost || 0));
  const { start } = weekRange(fmtYMD(new Date()));

  const activeCards = active.length ? active.map((l: any) => `
    <a class="card" href="/driver/${token}/loads/${l.id}">
      <div class="row">
        <div>
          <div class="muted">Load ${escapeHtml(l.loadNumber)}</div>
          <div style="font-weight:600;margin-top:2px">${escapeHtml(l.originCity || l.pickupAddress || '?')} → ${escapeHtml(l.destCity || l.deliveryAddress || '?')}</div>
          <div class="muted" style="margin-top:4px">${l.miles ? `${l.miles} mi · ` : ''}${l.rate ? fmtMoney(l.rate) : ''}</div>
        </div>
        ${loadStatusBadge(l)}
      </div>
    </a>
  `).join('') : `<div class="card"><div class="muted">No active load. You'll see it here when dispatched.</div></div>`;

  const body = `
    <div class="muted" style="margin-bottom:16px">Hey ${escapeHtml(driver.name)} 👋</div>

    <a class="card emph" href="/my-pay/${token}">
      <div class="muted" style="color:#bae6fd">This week's take-home</div>
      <div class="big" style="color:#fff">${fmtMoney(net)}</div>
      <div class="muted" style="color:#bae6fd">Week of ${fmtYMD(start)} · tap for details</div>
    </a>

    <h2>Active Loads</h2>
    ${activeCards}

    <h2>Quick Actions</h2>
    <a class="btn block secondary" href="/driver/${token}/loads">📋 All My Loads</a>
    <a class="btn block secondary" href="/driver/${token}/profile">👤 Edit Profile & Preferences</a>
    <a class="btn block secondary" href="/sop">📖 LAMP SOP</a>
  `;
  return layout({ title: 'My Dashboard', token, active: 'home', body });
}

// ---------------------------------------------------------------------------
// Page: Loads list
// ---------------------------------------------------------------------------
export async function renderLoadsList(token: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'loads', body: '<p>Invalid link.</p>' });

  const rows = await db
    .select()
    .from(loads)
    .where(eq(loads.driverId, driver.id))
    .orderBy(desc(loads.createdAt))
    .limit(50);

  const active = rows.filter((r: any) => !r.deliveredAt);
  const past = rows.filter((r: any) => r.deliveredAt);

  const renderItem = (l: any): string => `
    <a class="list-item" href="/driver/${token}/loads/${l.id}">
      <div>
        <div style="font-weight:600">${escapeHtml(l.originCity || l.pickupAddress || '?')} → ${escapeHtml(l.destCity || l.deliveryAddress || '?')}</div>
        <div class="muted" style="margin-top:3px">Load ${escapeHtml(l.loadNumber)} · ${l.miles || '?'} mi · ${l.rate ? fmtMoney(l.rate) : 'TBD'}</div>
      </div>
      ${loadStatusBadge(l)}
    </a>`;

  const body = `
    ${active.length ? `<h2>Active (${active.length})</h2>${active.map(renderItem).join('')}` : ''}
    ${past.length ? `<h2>Past (${past.length})</h2>${past.map(renderItem).join('')}` : ''}
    ${rows.length === 0 ? '<div class="card"><div class="muted">No loads yet.</div></div>' : ''}
  `;
  return layout({ title: 'My Loads', token, active: 'loads', body });
}

// ---------------------------------------------------------------------------
// Page: Load detail
// ---------------------------------------------------------------------------
export async function renderLoadDetail(token: string, loadId: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'loads', body: '<p>Invalid link.</p>' });

  const [load] = await db
    .select()
    .from(loads)
    .where(and(eq(loads.id, loadId), eq(loads.driverId, driver.id)));

  if (!load) {
    return layout({ title: 'Not Found', token, active: 'loads', showBack: true, backHref: `/driver/${token}/loads`,
      body: '<div class="card">Load not found or not assigned to you.</div>' });
  }

  const docs = await db
    .select()
    .from(loadDocuments)
    .where(eq(loadDocuments.loadId, loadId))
    .orderBy(desc(loadDocuments.createdAt as any));

  const byStage: Record<string, any[]> = {};
  for (const d of docs) { (byStage[d.documentType || 'other'] = byStage[d.documentType || 'other'] || []).push(d); }

  const stageSummary = (Object.keys(STAGE_LABELS) as Array<keyof typeof STAGE_LABELS>)
    .map((s) => {
      const n = (byStage[s] || []).length;
      return `<div class="row" style="padding:6px 0;border-bottom:1px solid #334155">
        <span>${STAGE_LABELS[s]}</span>
        <span class="badge ${n > 0 ? 'green' : 'gray'}">${n > 0 ? `${n} ✓` : 'pending'}</span>
      </div>`;
    }).join('');

  const sop: any = load.sopProgress || {};
  const checkIns = [
    { key: 'atPickupAt',   label: '🚚 At Pickup' },
    { key: 'loadedAt',     label: '📦 Loaded' },
    { key: 'atDeliveryAt', label: '🏁 At Delivery' },
    { key: 'unloadedAt',   label: '✅ Unloaded' },
  ].map((c) => `<div class="row" style="padding:4px 0;font-size:14px">
    <span>${c.label}</span>
    <span class="muted">${sop[c.key] ? new Date(sop[c.key]).toLocaleString() : '—'}</span>
  </div>`).join('');

  const body = `
    <div class="card emph">
      <div class="row">
        <div>
          <div class="muted" style="color:#bae6fd">Load</div>
          <div style="font-weight:700;font-size:18px">${escapeHtml(load.loadNumber)}</div>
        </div>
        ${loadStatusBadge(load)}
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">📍 Pickup</h2>
      <div>${escapeHtml(load.pickupAddress || [load.originCity, load.originState].filter(Boolean).join(', ') || 'TBD')}</div>
      <div class="muted" style="margin-top:4px">${load.pickupDate ? new Date(load.pickupDate).toLocaleString() : 'Time TBD'}</div>
      <h2>📍 Delivery</h2>
      <div>${escapeHtml(load.deliveryAddress || [load.destCity, load.destState].filter(Boolean).join(', ') || 'TBD')}</div>
      <div class="muted" style="margin-top:4px">${load.deliveryDate ? new Date(load.deliveryDate).toLocaleString() : 'Time TBD'}</div>
    </div>

    <div class="card">
      <div class="row"><span class="muted">Rate</span><span><b>${load.rate ? fmtMoney(load.rate) : 'TBD'}</b></span></div>
      <div class="row"><span class="muted">Miles</span><span>${load.miles || '—'}</span></div>
      <div class="row"><span class="muted">Broker</span><span>${escapeHtml(load.brokerName || '—')}</span></div>
      ${load.brokerPhone ? `<div class="row"><span class="muted">Broker phone</span><a href="tel:${escapeHtml(load.brokerPhone)}">${escapeHtml(load.brokerPhone)}</a></div>` : ''}
      ${load.specialInstructions ? `<div style="margin-top:8px;color:#fde68a"><b>Notes:</b> ${escapeHtml(load.specialInstructions)}</div>` : ''}
    </div>

    <h2>Check-Ins</h2>
    <div class="card">${checkIns}</div>

    <h2>Photos</h2>
    <div class="card">${stageSummary}</div>

    <a class="btn block" href="/u/${load.id}?stages=pickup_bol,pickup_securement,delivery_pod,delivery_signed_bol">
      📷 Upload Photos / Check In
    </a>
  `;
  return layout({ title: `Load ${load.loadNumber}`, token, active: 'loads', showBack: true, backHref: `/driver/${token}/loads`, body });
}

// ---------------------------------------------------------------------------
// Page: Profile + preferences
// ---------------------------------------------------------------------------
export async function renderProfile(token: string, flash?: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'profile', body: '<p>Invalid link.</p>' });

  const d: any = driver;
  const curVehicle = d.vehicleType || 'pickup_gooseneck';
  const curDeadhead = d.maxDeadheadMiles ?? 150;
  const preferredCsv = Array.isArray(d.preferredDestinations) ? d.preferredDestinations.join(', ') : '';

  const vehicleOpts = VEHICLE_TYPES.map((v) => {
    const sel = v.value === curVehicle ? 'selected' : '';
    return `<option value="${v.value}" ${sel}>${v.label}</option>`;
  }).join('');

  // group for readability
  const optgroup = (label: string, cat: string) =>
    `<optgroup label="${label}">${VEHICLE_TYPES.filter((v) => v.category === cat)
      .map((v) => `<option value="${v.value}" ${v.value === curVehicle ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup>`;

  const deadheadPills = DEADHEAD_PRESETS.map((m) => `
    <div class="pill-opt ${m === curDeadhead ? 'on' : ''}" data-val="${m}">${m} mi</div>
  `).join('');

  const body = `
    ${flash ? `<div class="card" style="border-color:#22c55e;background:#14532d33;color:#86efac">${escapeHtml(flash)}</div>` : ''}

    <form id="pf" class="card">
      <h2 style="margin-top:0">Contact</h2>
      <label>Phone</label>
      <input name="phone" value="${escapeHtml(d.phone)}" type="tel">
      <label>Address</label>
      <input name="address" value="${escapeHtml(d.address)}">
      <div class="grid2">
        <div><label>City</label><input name="city" value="${escapeHtml(d.city)}"></div>
        <div><label>State</label><input name="state" value="${escapeHtml(d.state)}" maxlength="2" style="text-transform:uppercase"></div>
      </div>
      <label>ZIP</label>
      <input name="zipCode" value="${escapeHtml(d.zipCode)}">
      <label>Emergency contact</label>
      <input name="emergencyContact" value="${escapeHtml(d.emergencyContact)}" placeholder="Name / 555-123-4567">

      <h2>License</h2>
      <div class="grid2">
        <div><label>State</label><input name="licenseState" value="${escapeHtml(d.licenseState)}" maxlength="2" style="text-transform:uppercase"></div>
        <div><label>Expires</label><input name="licenseExpiry" value="${escapeHtml(d.licenseExpiry)}" placeholder="YYYY-MM-DD"></div>
      </div>

      <h2>My Truck</h2>
      <label>Vehicle / Trailer Type</label>
      <select name="vehicleType">
        ${optgroup('Pickup / Hotshot', 'pickup')}
        ${optgroup('Box / Sprinter',   'box')}
        ${optgroup('Semi / CDL',       'semi')}
      </select>
      <div class="grid2">
        <div><label>Year</label><input name="vehicleYear" value="${escapeHtml(d.vehicleYear)}"></div>
        <div><label>Make</label><input name="vehicleMake" value="${escapeHtml(d.vehicleMake)}"></div>
      </div>
      <div class="grid2">
        <div><label>Model</label><input name="vehicleModel" value="${escapeHtml(d.vehicleModel)}"></div>
        <div><label>Plate</label><input name="vehiclePlate" value="${escapeHtml(d.vehiclePlate)}"></div>
      </div>
      <label>VIN</label>
      <input name="vehicleVin" value="${escapeHtml(d.vehicleVin)}">
      <label>Trailer length (ft, optional)</label>
      <input name="trailerLength" value="${d.trailerLength ?? ''}" type="number" inputmode="numeric">

      <h2>Load Preferences</h2>
      <label>Max deadhead you'll drive (miles)</label>
      <div class="grid4" id="dh-pills">${deadheadPills}</div>
      <input name="maxDeadheadMiles" id="dh-input" type="number" inputmode="numeric" value="${curDeadhead}" style="margin-top:8px">

      <label>Preferred destination states (comma-separated)</label>
      <input name="preferredDestinations" value="${escapeHtml(preferredCsv)}" placeholder="GA, FL, TN — leave blank for anywhere" style="text-transform:uppercase">

      <label>Home base (where you want to end up)</label>
      <input name="homeBase" value="${escapeHtml(d.homeBase)}" placeholder="Atlanta, GA">

      <button type="submit" class="btn block success" style="margin-top:16px">Save Changes</button>
      <div class="status" id="pf-status"></div>
    </form>

    <h2>View-Only</h2>
    <div class="card">
      <div class="row"><span class="muted">Name</span><span>${escapeHtml(d.name)}</span></div>
      <div class="row"><span class="muted">CDL #</span><span>${escapeHtml(d.licenseNumber || '—')}</span></div>
      <div class="row"><span class="muted">Pay rule</span><span>${escapeHtml(d.payType || 'percent')} @ ${d.payRate ?? 80}${(d.payType || 'percent') === 'percent' ? '%' : '$'}</span></div>
      <div class="row"><span class="muted">Weekly fuel</span><span>${fmtMoney(d.weeklyFuelCost || 0)}</span></div>
      <div class="row"><span class="muted">Weekly insurance</span><span>${fmtMoney(d.weeklyInsuranceCost || 0)}</span></div>
    </div>

<script>
const TOKEN = ${JSON.stringify(token)};
const form = document.getElementById('pf');
const status = document.getElementById('pf-status');
const dhInput = document.getElementById('dh-input');
const dhPills = document.getElementById('dh-pills');

dhPills.addEventListener('click', (e) => {
  const pill = e.target.closest('.pill-opt'); if (!pill) return;
  dhPills.querySelectorAll('.pill-opt').forEach(p => p.classList.remove('on'));
  pill.classList.add('on');
  dhInput.value = pill.dataset.val;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.className = 'status';
  status.textContent = 'Saving…';
  const fd = new FormData(form);
  const obj = Object.fromEntries(fd.entries());
  // normalize
  if (obj.preferredDestinations) {
    obj.preferredDestinations = String(obj.preferredDestinations)
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  } else { obj.preferredDestinations = []; }
  if (obj.state) obj.state = String(obj.state).toUpperCase();
  if (obj.licenseState) obj.licenseState = String(obj.licenseState).toUpperCase();
  if (obj.maxDeadheadMiles) obj.maxDeadheadMiles = Number(obj.maxDeadheadMiles);
  if (obj.trailerLength) obj.trailerLength = Number(obj.trailerLength); else delete obj.trailerLength;

  try {
    const res = await fetch('/api/drivers/self/' + TOKEN, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ('HTTP ' + res.status));
    }
    status.className = 'status ok';
    status.textContent = 'Saved ✓';
  } catch (err) {
    status.className = 'status err';
    status.textContent = 'Save failed: ' + err.message;
  }
});
</script>
  `;
  return layout({ title: 'My Profile', token, active: 'profile', body });
}
