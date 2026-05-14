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

(function () {
  'use strict';

  function readConfig() {
    var el = document.getElementById('upload-config');
    if (!el) throw new Error('upload-config missing');
    try { return JSON.parse(el.textContent || el.innerText || '{}'); }
    catch (e) { throw new Error('upload-config invalid JSON: ' + e.message); }
  }

  var cfg = readConfig();
  var LOAD_ID = cfg.loadId;
  var STAGES = cfg.stages || [];
  // Optional signed token. If present, every POST includes it as an
  // Authorization header so the server can validate against tampering.
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
        var headers = { 'Content-Type': 'application/json' };
        if (TOKEN) headers['X-Upload-Token'] = TOKEN;
        var res = await fetch('/api/loads/' + LOAD_ID + '/checkin', {
          method: 'POST',
          headers: headers,
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

    var reader = new FileReader();
    reader.onload = function () { preview.src = reader.result; preview.style.display = 'block'; };
    reader.readAsDataURL(rawFile);

    // Cloudinary resizes + converts HEIC -> JPEG server-side. No client
    // canvas step that can hang on iOS.
    var file = rawFile;

    // GPS is best-effort. The `timeout` option on getCurrentPosition
    // only applies AFTER the iOS permission prompt is dismissed — if the
    // driver hasn't tapped Allow/Deny yet, the call hangs indefinitely
    // and the entire upload waits behind it. (This was the "stuck on
    // Starting upload…" bug.) Hard-cap with Promise.race so the upload
    // always proceeds within 2s, with or without coordinates.
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

    var fd = new FormData();
    fd.append('photo', file);
    fd.append('stage', stage);
    if (coords) { fd.append('lat', String(coords.lat)); fd.append('lng', String(coords.lng)); }

    try {
      await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/loads/' + LOAD_ID + '/photos');
        if (TOKEN) xhr.setRequestHeader('X-Upload-Token', TOKEN);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var pct = Math.min(95, Math.round((e.loaded / e.total) * 95));
            barFill.style.width = pct + '%';
            status.textContent = 'Uploading ' + pct + '%';
          }
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            barFill.style.width = '100%';
            resolve(null);
          } else {
            var msg = 'HTTP ' + xhr.status;
            try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
            reject(new Error(msg));
          }
        };
        xhr.onerror = function () { reject(new Error('Network error')); };
        xhr.ontimeout = function () { reject(new Error('Timed out')); };
        // 180s — rural-LTE upload of 15 MB at 1 Mbps is ~120s, so 120s
        // was right at the boundary. Drivers in weak coverage hit it.
        xhr.timeout = 180000;
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
    } finally {
      delete _inflight[stage];
    }
  }
})();
