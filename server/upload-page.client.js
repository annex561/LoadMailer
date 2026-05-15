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

    // No geolocation here. Even with a Promise.race hard-cap, iOS Safari
    // pauses setTimeout while the geo permission prompt is on-screen, so
    // the "2-second cap" never fires until the driver dismisses the
    // prompt — which they don't, because the prompt is buried behind the
    // photo picker. That manifested as the photo upload being stuck on
    // "Starting upload (X KB)…" forever. The piggyback driver_locations
    // row is a nice-to-have, not worth keeping the upload hostage.
    var fd = new FormData();
    fd.append('photo', file);
    fd.append('stage', stage);

    // Show progress immediately so the driver knows the tap registered.
    status.textContent = 'Sending photo…';

    // Heartbeat so the driver sees SOMETHING moving even when the network
    // hasn't flushed any progress events yet. iOS Safari + HTTP/2 can
    // delay or coalesce `upload.onprogress` events (especially when
    // lengthComputable is false), leaving the bar frozen at the initial
    // 2% for many seconds — drivers tap repeatedly thinking it's broken.
    // The heartbeat ticks every 750ms during the first 8s, then stops.
    var lastProgressAt = Date.now();
    var hb = setInterval(function () {
      // If real progress events have fired in the last 1.5s, leave it.
      if (Date.now() - lastProgressAt < 1500) return;
      // Otherwise nudge the status so the driver knows we're alive.
      var t = Math.floor((Date.now() - startedAt) / 1000);
      status.textContent = 'Sending photo… (' + t + 's)';
    }, 750);
    var startedAt = Date.now();

    try {
      await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/loads/' + LOAD_ID + '/photos');
        if (TOKEN) xhr.setRequestHeader('X-Upload-Token', TOKEN);
        xhr.upload.onprogress = function (e) {
          lastProgressAt = Date.now();
          if (e.lengthComputable) {
            var pct = Math.min(95, Math.round((e.loaded / e.total) * 95));
            barFill.style.width = pct + '%';
            status.textContent = 'Uploading ' + pct + '%';
          } else {
            // No total — at least move the bar a bit and update text so
            // the driver knows bytes are flowing.
            var current = parseInt(barFill.style.width, 10) || 2;
            barFill.style.width = Math.min(90, current + 3) + '%';
            status.textContent = 'Uploading…';
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

      clearInterval(hb);
      slot.classList.add('done');
      status.className = 'status ok';
      status.textContent = '✅ Uploaded — saved to dispatch. Tap photo to verify.';
      label.textContent = '📷 Replace Photo';
      label.style.background = '#14532d';
      label.style.pointerEvents = '';
      label.style.opacity = '';
      // Tap-to-preview (CLAUDE.md user request). The local FileReader
      // preview was already rendered above; wrap it in a link so tapping
      // it opens the local image full-size for the driver to verify
      // which photo went to this load. Cloudinary URL would be ideal
      // but it isn't returned synchronously — the local preview is
      // good enough for verify-on-the-spot.
      if (preview && preview.src) {
        preview.style.cursor = 'zoom-in';
        preview.onclick = function () {
          var w = window.open('', '_blank');
          if (w) {
            w.document.title = 'Uploaded photo';
            w.document.body.style.margin = '0';
            w.document.body.style.background = '#000';
            var img = w.document.createElement('img');
            img.src = preview.src;
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            w.document.body.appendChild(img);
          }
        };
      }
      if (navigator.vibrate) navigator.vibrate(80);
    } catch (err) {
      clearInterval(hb);
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
