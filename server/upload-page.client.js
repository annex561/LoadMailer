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

    // Direct-to-Cloudinary upload. PRs #83-#96 patched the server-side
    // multer path and it still hung on rural-LTE iPhones. The byte path
    // now goes phone -> Cloudinary edge directly, never through our
    // Railway service. After Cloudinary accepts the file we POST just
    // the resulting secure_url back to /api/loads/:id/photos so the
    // load_documents row gets written tied to this load_id.
    var file = rawFile;

    status.textContent = 'Preparing upload…';
    var startedAt = Date.now();

    try {
      // Step 1: get signed upload params from our server.
      var sigRes = await fetch('/api/loads/' + LOAD_ID + '/photos/cloudinary-signature?stage=' + encodeURIComponent(stage), {
        method: 'GET',
        headers: TOKEN ? { 'X-Upload-Token': TOKEN } : {},
      });
      if (!sigRes.ok) {
        var sigErrMsg = 'HTTP ' + sigRes.status;
        try { sigErrMsg = (await sigRes.json()).error || sigErrMsg; } catch (_) {}
        throw new Error('Signature failed: ' + sigErrMsg);
      }
      var sig = await sigRes.json();
      if (!sig.cloudName || !sig.signature) {
        throw new Error('Bad signature payload from server');
      }

      status.textContent = 'Uploading 0%';
      barFill.style.width = '5%';

      // Step 2: POST file to Cloudinary directly. Cloudinary's HTTPS
      // endpoint sends proper Content-Length and fires lengthComputable
      // progress events reliably on iOS Safari.
      var cloudUrl = 'https://api.cloudinary.com/v1_1/' + sig.cloudName + '/image/upload';
      var cldFd = new FormData();
      cldFd.append('file', file);
      cldFd.append('api_key', sig.apiKey);
      cldFd.append('timestamp', String(sig.timestamp));
      cldFd.append('signature', sig.signature);
      cldFd.append('folder', sig.folder);
      cldFd.append('public_id', sig.publicId);
      cldFd.append('tags', sig.tags);

      var cldResult = await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', cloudUrl);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var pct = Math.min(95, Math.round((e.loaded / e.total) * 95));
            barFill.style.width = pct + '%';
            status.textContent = 'Uploading ' + pct + '%';
          }
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var json = JSON.parse(xhr.responseText);
              resolve(json);
            } catch (e) {
              reject(new Error('Cloudinary returned non-JSON response'));
            }
          } else {
            var msg = 'Cloudinary HTTP ' + xhr.status;
            try { msg = JSON.parse(xhr.responseText).error.message || msg; } catch (_) {}
            reject(new Error(msg));
          }
        };
        xhr.onerror = function () { reject(new Error('Network error reaching Cloudinary')); };
        xhr.ontimeout = function () { reject(new Error('Cloudinary upload timed out')); };
        xhr.timeout = 180000;
        xhr.send(cldFd);
      });

      status.textContent = 'Saving to dispatch…';
      barFill.style.width = '97%';

      // Step 3: tell our server "this photo at this URL belongs to this
      // load + stage." JSON, no multer.
      var saveRes = await fetch('/api/loads/' + LOAD_ID + '/photos', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          TOKEN ? { 'X-Upload-Token': TOKEN } : {},
        ),
        body: JSON.stringify({
          stage: stage,
          cloudinaryUrl: cldResult.secure_url,
          cloudinaryPublicId: cldResult.public_id,
          fileSize: cldResult.bytes,
          mimeType: cldResult.resource_type === 'image' ? ('image/' + (cldResult.format || 'jpeg')) : 'image/jpeg',
          originalName: file.name || (stage + '.jpg'),
        }),
      });
      if (!saveRes.ok) {
        var saveErrMsg = 'HTTP ' + saveRes.status;
        try { saveErrMsg = (await saveRes.json()).error || saveErrMsg; } catch (_) {}
        throw new Error('Save failed: ' + saveErrMsg);
      }
      barFill.style.width = '100%';
      // Stash the actual Cloudinary URL on the preview so tap-to-preview
      // opens the saved image, not the local FileReader copy.
      preview.dataset.cloudinaryUrl = cldResult.secure_url;

      slot.classList.add('done');
      status.className = 'status ok';
      var elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      status.textContent = '✅ Uploaded in ' + elapsed + 's — saved to dispatch. Tap photo to verify.';
      label.textContent = '📷 Replace Photo';
      label.style.background = '#14532d';
      label.style.pointerEvents = '';
      label.style.opacity = '';
      // Tap-to-preview. After the direct upload, we know the real
      // Cloudinary URL — prefer that over the local FileReader copy so
      // tapping opens the saved image (matches what dispatch sees).
      var previewUrl = preview.dataset.cloudinaryUrl || preview.src;
      if (previewUrl) {
        preview.style.cursor = 'zoom-in';
        preview.onclick = function () {
          var w = window.open('', '_blank');
          if (w) {
            w.document.title = 'Uploaded photo';
            w.document.body.style.margin = '0';
            w.document.body.style.background = '#000';
            var img = w.document.createElement('img');
            img.src = previewUrl;
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            w.document.body.appendChild(img);
          }
        };
      }
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
