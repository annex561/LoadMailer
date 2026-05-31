// Driver photo upload page — client script.
//
// IMPORTANT: this file is loaded BYTE-FOR-BYTE via fs.readFileSync and served
// at /u-assets/upload.js. It is NOT wrapped in a server-side template literal,
// so regex literals, backslashes, and template literals inside this file are
// SAFE — the browser sees them exactly as written. This is the fix for the
// PR #87 SyntaxError class of bugs.
//
// Configuration is injected by the page via a JSON island:
//   <script id="upload-config" type="application/json">{"loadId":"...","stages":[...],"token":"..."}</script>
// Read it here, then bootstrap.
//
// Upload architecture (PR #93 — Cloudinary direct upload):
// Previous approach: XHR → POST /api/loads/:id/photos (multer) → Cloudinary.
// Problem: custom header X-Upload-Token triggered CORS preflight on some iOS
// Safari WebKit builds, causing the request to hang indefinitely.
// New approach: file goes DIRECTLY from browser to Cloudinary. No file bytes
// touch our server. Steps:
//   1. GET /api/loads/:id/photos/sign?stage=...&token=... (token in query string, no custom header)
//   2. XHR POST directly to https://api.cloudinary.com/v1_1/<cloud>/image/upload
//   3. POST /api/loads/:id/photos/record (JSON body, same-origin, no custom header)

(function () {
  'use strict';

  // Lightweight breadcrumb logger — console only. The on-screen overlay
  // version found the iOS-Messages FileReader crash; we keep the console
  // breadcrumbs (cheap) so the next device-specific issue is one screen
  // share away instead of a blind guess. Append ?debug=1 to surface them
  // on-screen again if needed.
  var _showDbg = /[?&]debug=1/.test(location.search);
  var _dbgEl = null;
  function dbg(msg) {
    try { console.log('[upload] ' + msg); } catch (_) {}
    if (!_showDbg) return;
    if (!_dbgEl) {
      _dbgEl = document.createElement('div');
      _dbgEl.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,.85);color:#0f0;font-size:11px;font-family:monospace;padding:6px;z-index:9999;max-height:40vh;overflow-y:auto;word-break:break-all';
      document.body.appendChild(_dbgEl);
    }
    var line = document.createElement('div');
    line.textContent = msg;
    _dbgEl.appendChild(line);
    _dbgEl.scrollTop = _dbgEl.scrollHeight;
  }
  window.onerror = function (m, s, l) { dbg('ERR: ' + m + ' (line ' + l + ')'); };
  window.onunhandledrejection = function (e) { dbg('UNHANDLED: ' + (e.reason || e)); };

  function readConfig() {
    var el = document.getElementById('upload-config');
    if (!el) throw new Error('upload-config missing');
    try { return JSON.parse(el.textContent || el.innerText || '{}'); }
    catch (e) { throw new Error('upload-config invalid JSON: ' + e.message); }
  }

  var cfg = readConfig();
  var LOAD_ID = cfg.loadId;
  var STAGES = cfg.stages || [];
  dbg('config OK — load=' + LOAD_ID + ' stages=' + STAGES.length);
  // Optional signed token. Passed in query string / JSON body (NOT as a
  // custom header) so no CORS preflight fires on iOS Safari.
  var TOKEN = cfg.token || null;

  var root = document.getElementById('slots');

  // ---------- Manual check-in buttons (collapsed by default) ----------
  var CHECKINS = [
    { stage: 'at_pickup',   label: '🚚 At Pickup' },
    { stage: 'loaded',      label: '📦 Loaded' },
    { stage: 'at_delivery', label: '🏁 At Delivery' },
    { stage: 'unloaded',    label: '✅ Unloaded' },
  ];
  var ciRoot = document.getElementById('checkin-buttons');
  var ciStatus = document.getElementById('checkin-status');
  CHECKINS.forEach(function (c) {
    var b = document.createElement('button');
    b.textContent = c.label;
    b.style.cssText = 'background:#334155;color:#f1f5f9;border:1px solid #475569;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer';
    b.onclick = async function () {
      b.disabled = true;
      ciStatus.className = 'status';
      ciStatus.textContent = 'Sending ' + c.label + '...';
      try {
        // Hard-cap GPS so the check-in proceeds even if the permission
        // prompt hangs (see comment in handleUpload — same gotcha).
        var coords = await Promise.race([
          new Promise(function (resolve) {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
              function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
              function () { resolve(null); },
              { timeout: 2000, maximumAge: 60000 }
            );
          }),
          new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 2000); }),
        ]);
        var body = Object.assign({ stage: c.stage }, coords || {});
        var res = await fetch('/api/loads/' + LOAD_ID + '/checkin', {
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

  // ---------- Photo slots ----------
  STAGES.forEach(function (s) {
    var el = document.createElement('div');
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
    var input = el.querySelector('input');
    input.addEventListener('change', function () { handleUpload(s.stage, input.files[0]); });
  });

  function fmtKB(n) {
    return n < 1024 * 1024
      ? Math.round(n / 1024) + ' KB'
      : (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // In-flight guard. Keyed by stage so re-tapping the same slot mid-upload
  // is a no-op while the previous attempt is still running.
  var _inflight = {};

  async function handleUpload(stage, rawFile) {
    if (!rawFile) return;
    if (_inflight[stage]) return;
    _inflight[stage] = true;

    var slot = document.getElementById('slot-' + stage);
    var status = slot.querySelector('.status');
    var bar = slot.querySelector('.progress');
    var barFill = bar.querySelector('div');
    var preview = slot.querySelector('img.preview');
    var label = slot.querySelector('label.btn');

    label.style.pointerEvents = 'none';
    label.style.opacity = '0.6';
    slot.classList.remove('done');
    bar.style.display = 'block';
    barFill.style.width = '2%';
    status.className = 'status';
    status.textContent = 'Starting upload (' + fmtKB(rawFile.size) + ')…';
    dbg('handleUpload start — stage=' + stage + ' size=' + rawFile.size + ' type=' + rawFile.type);

    // Show thumbnail preview — skip if FileReader is unavailable (iOS
    // in-app browser opened from Messages does not expose it).
    if (typeof FileReader !== 'undefined') {
      var reader = new FileReader();
      reader.onload = function () { preview.src = reader.result; preview.style.display = 'block'; };
      reader.readAsDataURL(rawFile);
    }

    // GPS removed from the upload path entirely. iOS Safari freezes the
    // entire JS event loop — including setTimeout — while a native system
    // permission dialog is on screen. Promise.race with a 2s cap does NOT
    // help because the timer never fires. Result: upload hangs at
    // "Starting upload…" until the driver dismisses the dialog (which
    // they never do because they don't know it's there). GPS is a
    // nice-to-have for driver_locations; it is not worth blocking the BOL.
    // Check-in buttons (which the driver taps intentionally) may still
    // request location because the prompt is expected in that context.
    var coords = null;

    try {
      // ── Step 1: get Cloudinary signing params from our server ────────
      // Token goes in query string (not as a custom header) so iOS Safari
      // WebKit does NOT issue a CORS preflight before the upload.
      status.textContent = 'Preparing upload…';
      barFill.style.width = '5%';
      dbg('fetching sign...');

      var signUrl = '/api/loads/' + LOAD_ID + '/photos/sign?stage=' + encodeURIComponent(stage);
      if (TOKEN) signUrl += '&token=' + encodeURIComponent(TOKEN);

      var signRes = await fetch(signUrl);
      if (!signRes.ok) {
        var signPayload = null;
        try { signPayload = await signRes.json(); } catch (_) {}
        throw new Error((signPayload && signPayload.error) || 'HTTP ' + signRes.status);
      }
      var p = await signRes.json();
      // p = { cloudName, apiKey, timestamp, folder, publicId, signature }
      dbg('sign OK — cloud=' + p.cloudName);

      barFill.style.width = '10%';
      status.textContent = 'Uploading photo…';

      // ── Step 2: POST file directly to Cloudinary ─────────────────────
      // Standard multipart with no custom headers → no CORS preflight.
      // Cloudinary's endpoint handles mobile/weak-signal uploads natively.
      var cloudUrl = 'https://api.cloudinary.com/v1_1/' + p.cloudName + '/image/upload';
      var fd = new FormData();
      fd.append('file', rawFile);
      fd.append('api_key', p.apiKey);
      fd.append('timestamp', String(p.timestamp));
      fd.append('folder', p.folder);
      fd.append('public_id', p.publicId);
      fd.append('signature', p.signature);

      var cloudResult = await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', cloudUrl);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            // Map 0–100% of the raw upload to 10–90% of the progress bar.
            var pct = 10 + Math.min(80, Math.round((e.loaded / e.total) * 80));
            barFill.style.width = pct + '%';
            status.textContent = 'Uploading ' + pct + '%';
          }
        };
        dbg('xhr to cloudinary open — sending...');
        xhr.onload = function () {
          dbg('xhr onload status=' + xhr.status);
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (_) { resolve({}); }
          } else {
            var msg = 'Upload error (HTTP ' + xhr.status + ')';
            try { msg = JSON.parse(xhr.responseText).error.message || msg; } catch (_) {}
            reject(new Error(msg));
          }
        };
        xhr.onerror   = function () { dbg('xhr onerror'); reject(new Error('Network error')); };
        xhr.ontimeout = function () { reject(new Error('Upload timed out — tap to retry')); };
        // 180s — rural-LTE upload of 15 MB at 1 Mbps is ~120s; add slack.
        xhr.timeout = 180000;
        xhr.send(fd);
      });

      barFill.style.width = '95%';
      status.textContent = 'Saving to dispatch…';

      // ── Step 3: record the completed upload in our DB ─────────────────
      // JSON body to our server. No custom headers — Content-Type:
      // application/json is a standard header, no preflight on same-origin.
      var recordBody = {
        stage: stage,
        fileUrl: cloudResult.secure_url,
        fileName: rawFile.name || (stage + '.jpg'),
        fileSize: cloudResult.bytes || rawFile.size,
        mimeType: cloudResult.format ? ('image/' + cloudResult.format) : (rawFile.type || 'image/jpeg'),
      };
      if (TOKEN) recordBody.token = TOKEN;
      if (coords) { recordBody.lat = coords.lat; recordBody.lng = coords.lng; }

      var recRes = await fetch('/api/loads/' + LOAD_ID + '/photos/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordBody),
      });
      if (!recRes.ok) {
        var recPayload = null;
        try { recPayload = await recRes.json(); } catch (_) {}
        throw new Error((recPayload && recPayload.error) || 'Save failed: HTTP ' + recRes.status);
      }

      barFill.style.width = '100%';
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
    } finally {
      delete _inflight[stage];
    }
  }
})();
