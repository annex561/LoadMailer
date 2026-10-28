// Driver photo upload page — client script.
//
// IMPORTANT: this file is loaded BYTE-FOR-BYTE via fs.readFileSync and served
// at /u-assets/upload.js. It is NOT wrapped in a server-side template literal,
// so regex literals, backslashes, and template literals inside this file are
// SAFE — the browser sees them exactly as written. This is the fix for the
// PR #87 SyntaxError class of bugs.
//
// Configuration is injected by the page via a JSON island:
//   <script id="upload-config" type="application/json">{"loadId":"...","stages":[...],"optionalStages":[...],"token":"..."}</script>
// Read it here, then bootstrap.
//
// Upload architecture (PR #93 — Cloudinary direct upload):
// Previous approach: XHR → POST /api/loads/:id/photos (multer) → Cloudinary.
// Problem: custom header X-Upload-Token triggered CORS preflight on some iOS
// Safari WebKit builds, causing the request to hang indefinitely.
// New approach: file goes DIRECTLY from browser to Cloudinary. No file bytes
// touch our server. Steps:
//   1. GET /api/loads/:id/photos/sign?stage=...&token=... (token in query string, no custom header)
//   2. XHR POST directly to https://api.cloudinary.com/v1_1/<cloud>/auto/upload  (resource_type auto — handles images AND PDFs)
//   3. POST /api/loads/:id/photos/record (JSON body, same-origin, no custom header)
//
// Item 9: each slot now accepts MULTIPLE files (camera capture + library chooser).
// Each file loops independently through steps 1-3 and creates its own load_documents row.
// PDFs are handled by using resource_type=auto on the Cloudinary endpoint.
//
// Item 8: optional doc types (lumper_receipt, scale_ticket, other) are shown under
// a collapsed "More documents" section. They are NOT required and do NOT gate Done.

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
  var OPTIONAL_STAGES = cfg.optionalStages || [];
  dbg('config OK — load=' + LOAD_ID + ' stages=' + STAGES.length + ' optional=' + OPTIONAL_STAGES.length);
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
        // prompt hangs (see comment in handleUpload — same gotcha)
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

  // ---------- Required banner ----------
  // Every shown slot is a required document for this phase. Make that
  // unmissable so a driver doesn't leave the dock with a photo missing.
  if (STAGES.length) {
    var banner = document.createElement('div');
    banner.id = 'required-banner';
    banner.style.cssText = 'background:#7c2d12;color:#fed7aa;border:1px solid #ea580c;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;font-weight:600';
    banner.innerHTML = '⚠️ Both photos below are <b>required</b> before you leave. <span id="req-count"></span>';
    root.parentNode.insertBefore(banner, root);
  }

  // Phase this page is for — drives the Done/confirm call.
  var PHASE = (STAGES[0] && STAGES[0].stage && STAGES[0].stage.indexOf('delivery') === 0)
    ? 'delivery' : 'pickup';

  // Required-slot count (optional slots never count).
  function allDone() {
    return document.querySelectorAll('.slot.done[data-required="1"]').length >= STAGES.length && STAGES.length > 0;
  }

  function updateReqCount() {
    var done = document.querySelectorAll('.slot.done[data-required="1"]').length;
    var el = document.getElementById('req-count');
    if (el) {
      if (done >= STAGES.length) {
        el.textContent = '✅ All ' + STAGES.length + ' photos uploaded.';
        var b = document.getElementById('required-banner');
        if (b) { b.style.background = '#14532d'; b.style.borderColor = '#22c55e'; b.style.color = '#bbf7d0'; b.innerHTML = '✅ All required photos uploaded — tap <b>Done</b> below to submit.'; }
      } else {
        el.textContent = '(' + done + ' of ' + STAGES.length + ' done)';
      }
    }
    // Enable/disable the Done button.
    var btn = document.getElementById('done-btn');
    if (btn) {
      if (allDone()) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        btn.textContent = '✅ Done — Submit to Dispatch';
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        btn.textContent = 'Upload all photos to submit';
      }
    }
  }

  // ---------- Build a photo slot element ----------
  // required=true → counts toward the gate and shows REQUIRED badge.
  // required=false → optional slot (lumper receipt, scale ticket, other).
  var _slotCounter = 0;
  function buildSlot(stageObj, required) {
    var stage = stageObj.stage;
    var label = stageObj.label;
    var uid = 'slot-' + stage;
    var camId = 'cam-' + stage + '-' + (++_slotCounter);
    var libId = 'lib-' + stage + '-' + _slotCounter;

    var el = document.createElement('div');
    el.className = 'slot';
    el.id = uid;
    el.dataset.required = required ? '1' : '0';

    var badge = required
      ? '<span class="req-badge">REQUIRED</span>'
      : '<span class="opt-badge">OPTIONAL</span>';

    // Notes field for 'other' type only.
    var notesHtml = (stage === 'other')
      ? '<textarea class="notes-input" id="notes-' + stage + '" placeholder="Brief description of document (optional)" rows="2"></textarea>'
      : '';

    // Two inputs: camera (capture) and library (no capture attribute).
    // Both accept images and PDFs. The library input allows multiple files.
    el.innerHTML =
      '<h2>' + label + ' ' + badge + '</h2>' +
      '<label class="btn" for="' + camId + '">📷 Take Photo</label>' +
      '<input type="file" id="' + camId + '" accept="image/*,application/pdf" capture="environment">' +
      '<label class="btn lib" for="' + libId + '">🖼 Choose from Library</label>' +
      '<input type="file" id="' + libId + '" accept="image/*,application/pdf" multiple>' +
      notesHtml +
      '<div class="progress" style="display:none"><div style="width:0%"></div></div>' +
      '<div class="status"></div>' +
      '<div class="previews"></div>';

    var camInput = el.querySelector('#' + camId);
    var libInput = el.querySelector('#' + libId);
    camInput.addEventListener('change', function () { handleFiles(stage, camInput.files, el, required); });
    libInput.addEventListener('change', function () { handleFiles(stage, libInput.files, el, required); });

    return el;
  }

  // ---------- Required photo slots ----------
  STAGES.forEach(function (s) { root.appendChild(buildSlot(s, true)); });

  // ---------- Optional "More documents" section ----------
  if (OPTIONAL_STAGES.length) {
    var moreDetails = document.createElement('details');
    moreDetails.className = 'more-docs';
    moreDetails.id = 'more-docs';
    moreDetails.innerHTML = '<summary>📎 More documents (optional)</summary>';
    var moreInner = document.createElement('div');
    moreInner.style.cssText = 'margin-top:12px';
    OPTIONAL_STAGES.forEach(function (s) { moreInner.appendChild(buildSlot(s, false)); });
    moreDetails.appendChild(moreInner);
    root.parentNode.insertBefore(moreDetails, root.nextSibling);
  }

  // ---------- Done / Submit button ----------
  var doneBtn = document.createElement('button');
  doneBtn.id = 'done-btn';
  doneBtn.type = 'button';
  doneBtn.style.cssText = 'display:block;width:100%;background:#16a34a;color:#fff;border:none;padding:16px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-top:4px';
  doneBtn.onclick = submitConfirm;
  // Insert after the optional section (or after #slots if no optional).
  var moreEl = document.getElementById('more-docs');
  var insertAfter = moreEl || root;
  insertAfter.parentNode.insertBefore(doneBtn, insertAfter.nextSibling);

  function submitConfirm() {
    if (!allDone()) return;
    doneBtn.disabled = true;
    doneBtn.style.pointerEvents = 'none';
    doneBtn.textContent = 'Submitting…';
    var body = { phase: PHASE };
    if (TOKEN) body.token = TOKEN;
    fetch('/api/loads/' + LOAD_ID + '/photos/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.ok) {
        throw new Error((res.j && res.j.error) || 'Submit failed');
      }
      showDoneOverlay();
      if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
    }).catch(function (err) {
      doneBtn.disabled = false;
      doneBtn.style.pointerEvents = '';
      doneBtn.textContent = '✅ Done — Submit to Dispatch';
      alert('Could not submit: ' + err.message);
    });
  }

  function showDoneOverlay() {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px;z-index:10000';
    ov.innerHTML =
      '<div style="font-size:64px;line-height:1">✅</div>' +
      '<h1 style="color:#4ade80;font-size:24px;margin:16px 0 8px">All saved!</h1>' +
      '<p style="color:#e2e8f0;font-size:16px;max-width:320px;margin:0 0 4px">Your ' +
      (PHASE === 'delivery' ? 'delivery' : 'pickup') +
      ' photos were sent to dispatch and recorded on this load.</p>' +
      '<p style="color:#94a3b8;font-size:14px;margin-top:16px">You can close this page now.</p>';
    document.body.appendChild(ov);
  }

  updateReqCount();

  function fmtKB(n) {
    return n < 1024 * 1024
      ? Math.round(n / 1024) + ' KB'
      : (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // In-flight guard keyed by "stage:fileIndex" so multiple files from the
  // same slot can run in parallel without trampling each other.
  var _inflight = {};

  // Upload a FileList (may have multiple files) for a given stage.
  // Each file becomes its own load_documents row.
  async function handleFiles(stage, files, slotEl, required) {
    if (!files || !files.length) return;
    var notes = null;
    if (stage === 'other') {
      var notesEl = slotEl.querySelector('.notes-input');
      if (notesEl) notes = notesEl.value.trim() || null;
    }
    // Upload all files; when ALL succeed, mark the slot done.
    var results = [];
    for (var i = 0; i < files.length; i++) {
      var key = stage + ':' + i;
      if (_inflight[key]) continue;
      _inflight[key] = true;
      try {
        var ok = await handleOneFile(stage, files[i], slotEl, i, files.length, notes);
        results.push(ok);
      } finally {
        delete _inflight[key];
      }
    }
    // If ALL files in this batch uploaded successfully, mark the slot done.
    if (results.length && results.every(Boolean)) {
      slotEl.classList.add('done');
      if (required) updateReqCount();
    }
  }

  // Upload one file, report progress in the slot UI.
  // Returns true on success, false on error.
  async function handleOneFile(stage, rawFile, slot, fileIdx, totalFiles, notes) {
    var status = slot.querySelector('.status');
    var bar = slot.querySelector('.progress');
    var barFill = bar.querySelector('div');
    var previews = slot.querySelector('.previews');

    bar.style.display = 'block';
    barFill.style.width = '2%';
    var prefix = totalFiles > 1 ? ('File ' + (fileIdx + 1) + '/' + totalFiles + ': ') : '';
    status.className = 'status';
    status.textContent = prefix + 'Starting upload (' + fmtKB(rawFile.size) + ')…';
    dbg('handleOneFile start — stage=' + stage + ' idx=' + fileIdx + ' size=' + rawFile.size + ' type=' + rawFile.type);

    // Thumbnail preview (images only; skip PDFs and environments without FileReader).
    if (typeof FileReader !== 'undefined' && rawFile.type && rawFile.type.indexOf('image') === 0) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = document.createElement('img');
        img.className = 'preview';
        img.src = reader.result;
        img.style.display = 'block';
        previews.appendChild(img);
      };
      reader.readAsDataURL(rawFile);
    }

    // GPS removed from the upload path entirely. iOS Safari freezes the
    // entire JS event loop — including setTimeout — while a native system
    // permission dialog is on screen. GPS is not worth blocking the BOL.
    var coords = null;

    try {
      // ── Step 1: get Cloudinary signing params from our server ────────
      status.textContent = prefix + 'Preparing upload…';
      barFill.style.width = '5%';
      dbg('fetching sign... stage=' + stage);

      var signUrl = '/api/loads/' + LOAD_ID + '/photos/sign?stage=' + encodeURIComponent(stage);
      if (TOKEN) signUrl += '&token=' + encodeURIComponent(TOKEN);

      var signRes = await fetch(signUrl);
      if (!signRes.ok) {
        var signPayload = null;
        try { signPayload = await signRes.json(); } catch (_) {}
        throw new Error((signPayload && signPayload.error) || 'HTTP ' + signRes.status);
      }
      var p = await signRes.json();
      dbg('sign OK — cloud=' + p.cloudName);

      barFill.style.width = '10%';
      status.textContent = prefix + 'Uploading…';

      // ── Step 2: POST file directly to Cloudinary ─────────────────────
      // Use resource_type=auto so both images and PDFs are accepted.
      var cloudUrl = 'https://api.cloudinary.com/v1_1/' + p.cloudName + '/auto/upload';
      var fd = new FormData();
      fd.append('file', rawFile);
      fd.append('api_key', p.apiKey);
      fd.append('timestamp', String(p.timestamp));
      fd.append('folder', p.folder);
      fd.append('public_id', p.publicId + (fileIdx > 0 ? '_' + fileIdx : ''));
      fd.append('signature', p.signature);
      if (p.tags) fd.append('tags', p.tags);

      var cloudResult = await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', cloudUrl);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var pct = 10 + Math.min(80, Math.round((e.loaded / e.total) * 80));
            barFill.style.width = pct + '%';
            status.textContent = prefix + 'Uploading ' + pct + '%';
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
        xhr.timeout = 180000;
        xhr.send(fd);
      });

      barFill.style.width = '95%';
      status.textContent = prefix + 'Saving to dispatch…';

      // ── Step 3: record the completed upload in our DB ─────────────────
      var recordBody = {
        stage: stage,
        fileUrl: cloudResult.secure_url,
        fileName: rawFile.name || (stage + (fileIdx > 0 ? '_' + fileIdx : '') + '.jpg'),
        fileSize: cloudResult.bytes || rawFile.size,
        mimeType: cloudResult.format
          ? (rawFile.type && rawFile.type.indexOf('pdf') >= 0 ? 'application/pdf' : 'image/' + cloudResult.format)
          : (rawFile.type || 'image/jpeg'),
        notes: notes || undefined,
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
      status.className = 'status ok';
      status.textContent = totalFiles > 1
        ? (totalFiles + ' files uploaded — saved to dispatch.')
        : '✅ Uploaded — saved to dispatch.';

      // Update the camera label to show "add more" for multi-file slots.
      var camLabel = slot.querySelector('label.btn:not(.lib)');
      if (camLabel) { camLabel.textContent = '📷 Take Another Photo'; }
      var libLabel = slot.querySelector('label.btn.lib');
      if (libLabel) { libLabel.textContent = '🖼 Add More from Library'; }

      if (navigator.vibrate) navigator.vibrate(80);
      return true;
    } catch (err) {
      status.className = 'status error';
      status.textContent = prefix + '❌ Failed: ' + err.message + ' — tap to retry';
      bar.style.display = 'none';
      return false;
    }
  }
})();
