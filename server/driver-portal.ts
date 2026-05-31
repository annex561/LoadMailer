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
import { STAGE_LABELS, stagesForLoadStatus } from './load-photos-service';

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

export const DEADHEAD_PRESETS = [50, 75, 100, 125, 150];
export const MAX_DEADHEAD_MILES = 150;

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
  driverId,
}: {
  title: string;
  token: string;
  active: 'home' | 'loads' | 'pay' | 'profile';
  body: string;
  showBack?: boolean;
  backHref?: string;
  driverId?: string;
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
  .card{display:block;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;margin-bottom:10px;color:inherit;text-decoration:none}
  .card.emph{background:linear-gradient(135deg,#0c4a6e,#0369a1);border-color:#38bdf8}
  .card.success-emph{background:linear-gradient(135deg,#064e3b,#065f46);border-color:#22c55e}
  .topbar h1{font-size:22px;font-weight:700;color:#22d3ee;margin:0}
  .row{display:flex;justify-content:space-between;gap:12px;align-items:center}
  .muted{color:#94a3b8;font-size:13px}
  .big{font-size:26px;font-weight:800;color:#4ade80}
  .pay-breakdown{font-size:12px;color:#bae6fd;margin-top:6px;font-weight:500;letter-spacing:.2px}
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
  .qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}
  .qa-tile{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px 10px;text-align:center;color:#e2e8f0;text-decoration:none;display:block}
  .qa-tile:active{background:#334155;border-color:#475569}
  .qa-tile .qa-ico{font-size:26px;line-height:1;margin-bottom:6px}
  .qa-tile .qa-lbl{font-size:13px;font-weight:600;letter-spacing:.2px}
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
  .dot{width:10px;height:10px;border-radius:50%;background:#475569;display:inline-block;flex-shrink:0;box-shadow:0 0 0 0 rgba(74,222,128,0.6)}
  .dot.on{background:#4ade80;animation:pulse 2.4s infinite}
  .dot.stale{background:#fbbf24}
  .dot.off{background:#475569}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(74,222,128,0.5)}70%{box-shadow:0 0 0 8px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
  .trk-card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px}
  .trk-row{display:flex;align-items:center;gap:10px}
  .trk-meta{font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.4}
</style>
</head><body>
  <div class="topbar">
    ${showBack ? `<a class="back" href="${backHref || `/driver/${token}`}">← Back</a>` : ''}
    <h1 style="flex:1;margin:0">${title}</h1>
    ${driverId ? `<a href="/driver/${token}/profile" id="trk-dot" class="dot off" title="Tracking off — tap to enable" style="margin-right:2px"></a>` : ''}
  </div>
  ${body}
  <div class="tabbar">
    ${tab('home',    'Home',    '🏠', `/driver/${token}`)}
    ${tab('loads',   'Loads',   '📋', `/driver/${token}/loads`)}
    ${tab('pay',     'Pay',     '💰', `/my-pay/${token}`)}
    ${tab('profile', 'Profile', '👤', `/driver/${token}/profile`)}
  </div>
  ${driverId ? trackingScript(driverId, token) : ''}
</body></html>`;
}

// Background tracking — when driver enables it from Profile, this script keeps
// pushing GPS to /api/driver-location/update every ~60s while the page is open.
// Status is mirrored in localStorage so the dot indicator stays consistent across pages.
function trackingScript(driverId: string, token: string): string {
  return `<script>
(function(){
  var DRIVER_ID = ${JSON.stringify(driverId)};
  var TOKEN = ${JSON.stringify(token)};
  var MIN_INTERVAL = 60000; // throttle to 1/min (server allows 120/hr)
  var lastSent = 0;
  var watchId = null;
  var dot = document.getElementById('trk-dot');

  function refreshDot(){
    if (!dot) return;
    var on = localStorage.getItem('trk_on') === '1';
    var lastMs = parseInt(localStorage.getItem('trk_last_ms') || '0', 10);
    var ageS = lastMs ? Math.round((Date.now() - lastMs)/1000) : null;
    if (!on) { dot.className = 'dot off'; dot.title = 'Tracking off — tap to enable'; return; }
    if (ageS !== null && ageS < 90) { dot.className = 'dot on'; dot.title = 'Tracking · ping ' + ageS + 's ago'; }
    else { dot.className = 'dot stale'; dot.title = 'Tracking enabled but no recent ping' + (ageS !== null ? ' (' + ageS + 's)' : ''); }
  }

  function send(pos){
    if (Date.now() - lastSent < MIN_INTERVAL) return;
    lastSent = Date.now();
    var c = pos.coords;
    // NOTE: gpsLocationUpdateSchema requires timestamp as ISO string (or omit) — never a number.
    fetch('/api/driver-location/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driverId: DRIVER_ID, trackingToken: TOKEN,
        lat: c.latitude, lon: c.longitude,
        accuracy: c.accuracy, altitude: c.altitude,
        speed: c.speed, heading: c.heading,
        timestamp: new Date().toISOString(),
      }),
    }).then(function(r){
      if (r.ok) { localStorage.setItem('trk_last_ms', String(Date.now())); refreshDot(); }
      else { r.text().then(function(t){ console.warn('GPS push rejected', r.status, t); }); }
    }).catch(function(e){ console.warn('GPS push error', e); });
  }

  function start(){
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(send, function(){}, {
      enableHighAccuracy: true, maximumAge: 30000, timeout: 60000,
    });
  }
  function stop(){
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  }

  if (localStorage.getItem('trk_on') === '1') start();
  refreshDot();
  setInterval(refreshDot, 5000);

  // Expose so Profile page toggle can drive it
  window.__traqiqTracking = { start: start, stop: stop, refreshDot: refreshDot };
})();
</script>`;
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
  const fuel = +(driver.weeklyFuelCost || 0);
  const ins = +(driver.weeklyInsuranceCost || 0);
  const gross = settlement?.grossPay ?? 0;
  const net = settlement?.netPay ?? -(fuel + ins);
  const deductions = fuel + ins;
  const { start } = weekRange(fmtYMD(new Date()));

  // When net is negative or zero, show the breakdown so drivers see *why*
  const breakdown = net <= 0
    ? `<div class="pay-breakdown">${fmtMoney(gross)} earned − ${fmtMoney(deductions)} deductions</div>`
    : `<div class="pay-breakdown">${fmtMoney(gross)} earned − ${fmtMoney(deductions)} deductions = take-home</div>`;

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

    <!-- Tracking toggle — surfaced at the top of the home dashboard so drivers
         can flip on/off without navigating to Profile. Same widget, same JS as
         the Profile page. Server-side drivers.is_on_duty syncs through the
         /driver/:token/duty endpoint (added in PR #81). -->
    <h2 id="tracking" style="margin-top:0">Location Tracking</h2>
    <div class="trk-card">
      <div class="trk-row">
        <span id="trk-state-dot" class="dot off"></span>
        <div style="flex:1">
          <div id="trk-state-label" style="font-weight:600">Off</div>
          <div id="trk-state-meta" class="trk-meta">Dispatch can't see your location.</div>
        </div>
        <button type="button" id="trk-toggle" class="btn success" style="min-width:96px">Turn ON</button>
      </div>
      <div class="trk-meta" style="margin-top:10px">
        Sends your GPS to dispatch every minute while this page is open. Allow location when your browser asks. For best results, add this site to your home screen.
      </div>
    </div>

    <a class="card emph" href="/my-pay/${token}" style="margin-top:14px">
      <div class="muted" style="color:#bae6fd">This week's take-home</div>
      <div class="big" style="color:#fff">${fmtMoney(net)}</div>
      ${breakdown}
      <div class="muted" style="color:#bae6fd;margin-top:6px">Week of ${fmtYMD(start)} · tap for details</div>
    </a>

    <h2>Active Loads</h2>
    ${activeCards}

    <h2>Quick Actions</h2>
    <div class="qa-grid">
      <a class="qa-tile" href="/driver/${token}/loads">
        <div class="qa-ico">📋</div><div class="qa-lbl">All My Loads</div>
      </a>
      <a class="qa-tile" href="/driver/${token}/profile">
        <div class="qa-ico">👤</div><div class="qa-lbl">Profile</div>
      </a>
      <a class="qa-tile" href="/driver/${token}/sop">
        <div class="qa-ico">📖</div><div class="qa-lbl">LAMP SOP</div>
      </a>
      <a class="qa-tile" href="/driver/${token}#tracking">
        <div class="qa-ico">📍</div><div class="qa-lbl">Location</div>
      </a>
    </div>

    <!-- Tracking-toggle JS, identical pattern to the Profile page. Posts to
         /driver/:token/duty on every flip so the server isOnDuty flag stays
         in sync with the browser-side GPS state. -->
    <script>
    (function(){
      var TOKEN = ${JSON.stringify(token)};
      var DRIVER_ID = ${JSON.stringify(driver.id)};
      var btn = document.getElementById('trk-toggle');
      var dot = document.getElementById('trk-state-dot');
      var lbl = document.getElementById('trk-state-label');
      var meta = document.getElementById('trk-state-meta');

      function paint(){
        var on = localStorage.getItem('trk_on') === '1';
        var lastMs = parseInt(localStorage.getItem('trk_last_ms') || '0', 10);
        var ageS = lastMs ? Math.round((Date.now() - lastMs)/1000) : null;
        if (!on) {
          dot.className = 'dot off';
          lbl.textContent = 'Off';
          meta.textContent = "Dispatch can't see your location.";
          btn.textContent = 'Turn ON'; btn.className = 'btn success';
        } else if (ageS !== null && ageS < 90) {
          dot.className = 'dot on';
          lbl.textContent = 'Tracking';
          meta.textContent = 'Last ping ' + ageS + 's ago';
          btn.textContent = 'Pause'; btn.className = 'btn secondary';
        } else {
          dot.className = 'dot stale';
          lbl.textContent = 'Tracking (waiting for signal)';
          meta.textContent = ageS !== null ? 'Last ping ' + ageS + 's ago' : 'No ping yet — keep this page open';
          btn.textContent = 'Pause'; btn.className = 'btn secondary';
        }
      }

      function syncDuty(onDuty){
        fetch('/driver/' + TOKEN + '/duty', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onDuty: onDuty }),
        }).catch(function(){});
      }

      btn.addEventListener('click', function(){
        var on = localStorage.getItem('trk_on') === '1';
        if (on) {
          localStorage.setItem('trk_on', '0');
          if (window.__traqiqTracking) window.__traqiqTracking.stop();
          syncDuty(false);
          paint();
          if (window.__traqiqTracking) window.__traqiqTracking.refreshDot();
          return;
        }
        if (!navigator.geolocation) {
          alert('Your browser does not support GPS. Use a modern mobile browser (Safari, Chrome).');
          return;
        }
        navigator.geolocation.getCurrentPosition(function(pos){
          localStorage.setItem('trk_on', '1');
          var c = pos.coords;
          fetch('/api/driver-location/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              driverId: DRIVER_ID, trackingToken: TOKEN,
              lat: c.latitude, lon: c.longitude,
              accuracy: c.accuracy, altitude: c.altitude,
              speed: c.speed, heading: c.heading,
              timestamp: new Date().toISOString(),
            }),
          }).then(function(r){
            if (r.ok) localStorage.setItem('trk_last_ms', String(Date.now()));
            syncDuty(true);
            if (window.__traqiqTracking) { window.__traqiqTracking.start(); window.__traqiqTracking.refreshDot(); }
            paint();
          }).catch(function(){
            syncDuty(true);
            if (window.__traqiqTracking) { window.__traqiqTracking.start(); window.__traqiqTracking.refreshDot(); }
            paint();
          });
        }, function(err){
          alert('Location permission denied. Enable it in your browser settings to share your location with dispatch.');
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      });

      paint();
      setInterval(paint, 5000);
    })();
    </script>
  `;
  return layout({ title: 'My Dashboard', token, active: 'home', body, driverId: driver.id });
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
  return layout({ title: 'My Loads', token, active: 'loads', body, driverId: driver.id });
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

    <a class="btn block" href="/u/${load.id}?stages=${stagesForLoadStatus(load.status as any).join(',')}">
      📷 Upload Photos / Check In
    </a>
  `;
  return layout({ title: `Load ${load.loadNumber}`, token, active: 'loads', showBack: true, backHref: `/driver/${token}/loads`, body, driverId: driver.id });
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

    <h2 id="tracking" style="margin-top:0">Location Tracking</h2>
    <div class="trk-card">
      <div class="trk-row">
        <span id="trk-state-dot" class="dot off"></span>
        <div style="flex:1">
          <div id="trk-state-label" style="font-weight:600">Off</div>
          <div id="trk-state-meta" class="trk-meta">Dispatch can't see your location.</div>
        </div>
        <button type="button" id="trk-toggle" class="btn success" style="min-width:96px">Turn ON</button>
      </div>
      <div class="trk-meta" style="margin-top:10px">
        Sends your GPS to dispatch every minute while this page is open. Allow location when your browser asks. For best results, add this site to your home screen.
      </div>
    </div>

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

// --- Location tracking toggle ---
(function(){
  var btn = document.getElementById('trk-toggle');
  var dot = document.getElementById('trk-state-dot');
  var lbl = document.getElementById('trk-state-label');
  var meta = document.getElementById('trk-state-meta');

  function paint(){
    var on = localStorage.getItem('trk_on') === '1';
    var lastMs = parseInt(localStorage.getItem('trk_last_ms') || '0', 10);
    var ageS = lastMs ? Math.round((Date.now() - lastMs)/1000) : null;
    if (!on) {
      dot.className = 'dot off';
      lbl.textContent = 'Off';
      meta.textContent = "Dispatch can't see your location.";
      btn.textContent = 'Turn ON'; btn.className = 'btn success';
    } else if (ageS !== null && ageS < 90) {
      dot.className = 'dot on';
      lbl.textContent = 'Tracking';
      meta.textContent = 'Last ping ' + ageS + 's ago';
      btn.textContent = 'Pause'; btn.className = 'btn secondary';
    } else {
      dot.className = 'dot stale';
      lbl.textContent = 'Tracking (waiting for signal)';
      meta.textContent = ageS !== null ? 'Last ping ' + ageS + 's ago' : 'No ping yet — keep this page open';
      btn.textContent = 'Pause'; btn.className = 'btn secondary';
    }
  }

  // Notify server when the local toggle flips so the geofence cron and the
  // dispatch SMS pipeline (both gated by drivers.isOnDuty) stay in sync
  // with the driver's actual duty state.
  function syncDuty(onDuty){
    fetch('/driver/' + TOKEN + '/duty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onDuty: onDuty }),
    }).catch(function(){ /* best-effort; server has rate limiting */ });
  }

  btn.addEventListener('click', function(){
    var on = localStorage.getItem('trk_on') === '1';
    if (on) {
      localStorage.setItem('trk_on', '0');
      if (window.__traqiqTracking) window.__traqiqTracking.stop();
      syncDuty(false);
      paint();
      if (window.__traqiqTracking) window.__traqiqTracking.refreshDot();
      return;
    }
    if (!navigator.geolocation) {
      alert('Your browser does not support GPS. Use a modern mobile browser (Safari, Chrome).');
      return;
    }
    // Capture a position up-front so the user (a) sees the permission prompt immediately
    // and (b) gets a green dot right away — don't wait for watchPosition's first fire.
    navigator.geolocation.getCurrentPosition(function(pos){
      localStorage.setItem('trk_on', '1');
      var c = pos.coords;
      fetch('/api/driver-location/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: ${JSON.stringify(driver.id)}, trackingToken: TOKEN,
          lat: c.latitude, lon: c.longitude,
          accuracy: c.accuracy, altitude: c.altitude,
          speed: c.speed, heading: c.heading,
          timestamp: new Date().toISOString(),
        }),
      }).then(function(r){
        if (r.ok) localStorage.setItem('trk_last_ms', String(Date.now()));
        else r.text().then(function(t){ console.warn('Initial GPS push rejected', r.status, t); });
        syncDuty(true);
        if (window.__traqiqTracking) { window.__traqiqTracking.start(); window.__traqiqTracking.refreshDot(); }
        paint();
      }).catch(function(){
        // Even if the first POST fails, still start the watcher — it'll retry on next coord change
        syncDuty(true);
        if (window.__traqiqTracking) { window.__traqiqTracking.start(); window.__traqiqTracking.refreshDot(); }
        paint();
      });
    }, function(err){
      alert('Location permission denied. Enable it in your browser settings to share your location with dispatch.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  paint();
  setInterval(paint, 5000);
})();

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
  return layout({ title: 'My Profile', token, active: 'profile', body, driverId: driver.id });
}

// ---------------------------------------------------------------------------
// Page: Pay (token-authenticated, with bottom tab nav)
// ---------------------------------------------------------------------------
export async function renderPay(token: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'pay', body: '<p>Invalid driver link.</p>' });

  const now = new Date();
  const weeksBack = 4;
  const weekCards: Array<{ label: string; net: number; gross: number; loads: number; weekStart: string; deductions: number }> = [];
  for (let i = 0; i < weeksBack; i++) {
    const ref = new Date(now);
    ref.setUTCDate(now.getUTCDate() - i * 7);
    const s = await computeSettlementForDriver(driver.id, fmtYMD(ref));
    const { start } = weekRange(fmtYMD(ref));
    weekCards.push({
      label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `${i} weeks ago`,
      net: s?.netPay ?? 0,
      gross: s?.grossPay ?? 0,
      deductions: s?.totalDeductions ?? 0,
      loads: s?.loadCount ?? 0,
      weekStart: fmtYMD(start),
    });
  }
  const current = weekCards[0];

  const past = weekCards.slice(1).map((w) => `
    <a class="card" href="/statements/${token}?week=${w.weekStart}">
      <div class="row">
        <div>
          <div style="font-weight:600">${w.label}</div>
          <div class="muted" style="margin-top:2px">${w.loads} load${w.loads === 1 ? '' : 's'} · wk ${w.weekStart}</div>
        </div>
        <div style="font-size:18px;font-weight:700;color:${w.net >= 0 ? '#4ade80' : '#f87171'}">${fmtMoney(w.net)}</div>
      </div>
    </a>`).join('');

  const body = `
    <a class="card success-emph" href="/statements/${token}?week=${current.weekStart}" style="text-align:center;padding:22px 16px">
      <div class="muted" style="color:#a7f3d0;text-transform:uppercase;letter-spacing:.5px;font-size:12px">This week's take-home</div>
      <div style="font-size:46px;font-weight:800;color:#fff;letter-spacing:-1px;margin:6px 0">${fmtMoney(current.net)}</div>
      <div class="pay-breakdown" style="color:#a7f3d0">${fmtMoney(current.gross)} earned − ${fmtMoney(current.deductions)} deductions</div>
      <div class="muted" style="color:#a7f3d0;margin-top:6px">${current.loads} load${current.loads === 1 ? '' : 's'} delivered · wk ${current.weekStart}</div>
    </a>

    <a class="btn block" href="/statements/${token}?week=${current.weekStart}" style="margin-bottom:8px">See full breakdown →</a>
    <a class="btn block" href="/my-pay/${token}/pdf?week=${current.weekStart}" target="_blank" style="margin-bottom:12px">⬇️ Download paystub PDF</a>

    <h2>Past weeks</h2>
    ${past || '<div class="card"><div class="muted">No prior weeks yet.</div></div>'}

    <div class="muted" style="text-align:center;margin-top:18px;font-size:12px">Pay = (your share of each load) − fees, fuel, advances & weekly deductions</div>
  `;
  return layout({ title: 'My Pay', token, active: 'pay', body, driverId: driver.id });
}

// ---------------------------------------------------------------------------
// Page: SOP (token-authenticated wrapper around the static SOP body)
// ---------------------------------------------------------------------------
export async function renderSop(token: string): Promise<string> {
  const driver = await driverFromToken(token);
  if (!driver) return layout({ title: 'Not Found', token, active: 'home', body: '<p>Invalid driver link.</p>' });

  const body = `
    <div class="card">
      <h2 style="margin-top:0;color:#22d3ee;text-transform:none;letter-spacing:0;font-size:16px">L · A · M · P</h2>
      <p class="muted" style="margin:6px 0 0">Locate the load · Accept the dispatch · Move the freight · Prove delivery.</p>
    </div>

    <h2>1 — Locate</h2>
    <div class="card">
      Open <b>All My Loads</b> and tap your dispatched load. Read the rate, miles, pickup window, and any special instructions. If anything is unclear, text dispatch <b>before</b> you roll.
    </div>

    <h2>2 — Accept</h2>
    <div class="card">
      Reply <b>YES</b> to the dispatch SMS to confirm. We'll send you the broker's rate confirmation. Make sure your <b>Location Tracking</b> is ON so dispatch can see you in transit.
    </div>

    <h2>3 — Move</h2>
    <div class="card">
      <div class="row" style="padding:4px 0"><span>📍 At pickup</span><span class="muted">tap the load → "Upload Photos / Check In"</span></div>
      <div class="row" style="padding:4px 0;border-top:1px solid #334155"><span>📦 BOL signed</span><span class="muted">photo of signed BOL</span></div>
      <div class="row" style="padding:4px 0;border-top:1px solid #334155"><span>🔒 Securement</span><span class="muted">photo of straps / load locked</span></div>
      <div class="row" style="padding:4px 0;border-top:1px solid #334155"><span>🚚 In transit</span><span class="muted">tracking pings every 60 sec</span></div>
    </div>

    <h2>4 — Prove</h2>
    <div class="card">
      <div class="row" style="padding:4px 0"><span>🏁 At delivery</span><span class="muted">check in</span></div>
      <div class="row" style="padding:4px 0;border-top:1px solid #334155"><span>✅ Unloaded</span><span class="muted">POD photo (signed)</span></div>
      <div class="row" style="padding:4px 0;border-top:1px solid #334155"><span>💰 Pay</span><span class="muted">posts to your Pay tab next cycle</span></div>
    </div>

    <a class="btn block secondary" href="/sop" style="margin-top:14px">Open printable version</a>
  `;
  return layout({ title: 'LAMP SOP', token, active: 'home', showBack: true, backHref: `/driver/${token}`, body, driverId: driver.id });
}
