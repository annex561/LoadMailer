/**
 * Regression test for the upload page (renderUploadPage) JS parse bug.
 *
 * History: renderUploadPage returns one big template literal containing the
 * upload-page HTML and inline <script>. Backslashes inside that template
 * literal are consumed by the JS template-literal parser BEFORE the script
 * reaches the browser, so `\.` in a regex becomes `.` and `\/` becomes `/`.
 *
 * The compressImage() function used `/^image\//` and `/\.[^.]+$/`, which
 * after template-literal processing became `/^image//` (unterminated /
 * malformed regex) — a SyntaxError that took down the ENTIRE script and
 * left the upload page rendering as an empty body. Drivers tapped the
 * SMS upload link and saw only the "Manual check-in (optional)" pill;
 * no photo upload slots ever appeared.
 *
 * This test extracts the <script> from renderUploadPage() and verifies it
 * parses as valid JavaScript. If somebody adds a regex literal to the
 * upload page script and forgets to double-escape, this test fails before
 * the next driver loses 30 minutes trying to figure out why upload is
 * broken.
 *
 * DO NOT delete this test. If you change the upload page, run it.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renderUploadPage, PICKUP_STAGES } from "../load-photos-service";
import { UPLOAD_PAGE_CLIENT_JS } from "../upload-page-client-source";

describe("upload page — client script integrity", () => {
  const clientJsPath = path.join(__dirname, "..", "upload-page.client.js");
  const clientJsFromFile = fs.readFileSync(clientJsPath, "utf8");
  const clientJs = UPLOAD_PAGE_CLIENT_JS;

  it("inlined string is in sync with the .js source", () => {
    // The inlined TS module is generated from the .js file. If they
    // drift, regenerate with the embed script. This test fails loudly
    // so production never serves a stale bundled copy.
    expect(clientJs).toBe(clientJsFromFile);
  });

  it("client script parses as valid JavaScript", () => {
    // The script is loaded byte-for-byte from disk by the server and
    // served at /u-assets/upload.js. If it has a syntax error, the
    // upload page renders blank for every driver. new Function() catches
    // any syntax error in this file before deploy.
    expect(() => new Function(clientJs)).not.toThrow();
  });

  it("client script contains the slot-rendering loop (sanity)", () => {
    expect(clientJs).toContain("STAGES.forEach");
    expect(clientJs).toContain("handleUpload");
  });

  it("client script reads config from the JSON island", () => {
    // The page provides config via a <script type=application/json>
    // element. If somebody refactors to a different mechanism, this
    // test will surface the mismatch.
    expect(clientJs).toContain("upload-config");
  });

  // ── Regression: PR #93 — Cloudinary direct upload ──────────────────────
  // Previous approach: XHR with custom X-Upload-Token header → multer →
  // Cloudinary. A custom header triggers a CORS preflight on iOS Safari
  // WebKit builds; the preflight hung and the upload never fired.
  //
  // New approach: token in query string / JSON body; file goes directly from
  // browser to Cloudinary; our server only signs and records. If someone
  // accidentally re-introduces the custom header pattern, these tests catch it.

  it("does NOT set X-Upload-Token as a custom request header (PR #93 regression)", () => {
    // The old pattern that triggered iOS CORS preflight was:
    //   xhr.setRequestHeader('X-Upload-Token', TOKEN)
    // Checking for setRequestHeader + X-Upload-Token together catches the
    // dangerous code pattern while allowing comments that mention the header.
    expect(clientJs).not.toMatch(/setRequestHeader\s*\([^)]*X-Upload-Token/);
  });

  it("uses Cloudinary direct upload path (photos/sign + photos/record)", () => {
    expect(clientJs).toContain("photos/sign");
    expect(clientJs).toContain("photos/record");
  });

  it("sends token as query param for sign, not as custom header", () => {
    // Token must be appended to the query string, not set via setRequestHeader.
    expect(clientJs).toContain("token=' + encodeURIComponent(TOKEN)");
  });

  it("uploads file directly to cloudinary.com (not to our server)", () => {
    expect(clientJs).toContain("api.cloudinary.com");
  });

  // ── Regression: FileReader crash in iOS Messages in-app browser ─────────
  // The in-app WebKit browser launched from iOS Messages does NOT expose
  // FileReader. `new FileReader()` threw an uncaught ReferenceError that
  // crashed handleUpload() before any upload request fired — driver was
  // stuck at "Starting upload..." forever. FileReader is only used for the
  // cosmetic thumbnail preview, so it MUST be feature-detected.
  it("guards FileReader with a typeof check (iOS Messages in-app browser)", () => {
    // If FileReader is used, it must be behind a typeof guard. We assert
    // that any `new FileReader()` is preceded somewhere by the guard.
    if (clientJs.includes("new FileReader()")) {
      expect(clientJs).toMatch(/typeof\s+FileReader\s*!==\s*['"]undefined['"]/);
    }
  });

  it("has a global error handler so device-specific crashes are visible", () => {
    // window.onerror + onunhandledrejection are what surfaced the
    // FileReader bug. Keep them so the next device quirk isn't a blind guess.
    expect(clientJs).toContain("window.onerror");
    expect(clientJs).toContain("window.onunhandledrejection");
  });

  // ── Done / Submit confirmation (driver needs to know it saved) ──────────
  it("has a Done/Submit button that confirms to /photos/confirm", () => {
    expect(clientJs).toContain("done-btn");
    expect(clientJs).toContain("photos/confirm");
  });

  it("shows a full-screen success confirmation after submit", () => {
    // The driver must get unmistakable feedback the photos reached the system.
    expect(clientJs).toContain("showDoneOverlay");
    expect(clientJs).toMatch(/All saved/i);
  });

  it("derives the confirm phase from the visible stages", () => {
    // pickup page → phase 'pickup', delivery page → phase 'delivery'.
    expect(clientJs).toContain("PHASE");
    expect(clientJs).toContain("'delivery'");
  });
});

describe("renderUploadPage — html shell", () => {
  const html = renderUploadPage(
    "abc-load-id",
    [...PICKUP_STAGES] as any,
    "LD12345",
    "token-here",
  );

  it("embeds the upload-config JSON island", () => {
    expect(html).toContain('<script id="upload-config"');
    expect(html).toContain('"loadId":"abc-load-id"');
    expect(html).toContain('"token":"token-here"');
  });

  it("references the external script asset", () => {
    // URL may include ?v=HASH cache-busting suffix (added by remote commit).
    expect(html).toMatch(/\/u-assets\/upload\.js/);
  });

  it("does NOT contain an inline <script> block with raw JS", () => {
    // Guards against regression: previously inline <script> blocks
    // here suffered template-literal escape eating. The page should
    // contain ONLY the JSON island script and the external asset.
    const scriptOpens = html.match(/<script(\s[^>]*)?>/gi) || [];
    // Expect exactly 2: the JSON island (with id=upload-config) and the
    // external src. Both have explicit attributes — no bare <script>.
    expect(scriptOpens.length).toBe(2);
    expect(scriptOpens.every((t) => /id=|src=/.test(t))).toBe(true);
  });
});
