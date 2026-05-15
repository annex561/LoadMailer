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

  it("handleUpload does NOT call navigator.geolocation (regression: PRs #88-#92)", () => {
    // History: the photo upload path used to call navigator.geolocation
    // (with a 2-second Promise.race "hard cap") to piggyback a
    // driver_locations row alongside each photo. iOS Safari pauses
    // setTimeout while a system permission prompt is on-screen, so the
    // 2s cap NEVER fires until the driver dismisses the prompt — which
    // they don't, because the geolocation prompt is buried behind the
    // photo picker. Result: BOL upload hung forever at "Starting upload
    // (X KB)…". Eight PRs (#83-#92) failed to fix it because each
    // tried to patch a different layer.
    //
    // Fix: rip geolocation out of the photo upload path entirely. The
    // optional GPS piggyback is a nice-to-have, not a load-bearing
    // feature, and not worth blocking the BOL on. Check-ins (the
    // separate buttons under "Manual check-in") MAY still call
    // geolocation because the driver tapped them deliberately and the
    // prompt is not buried under another modal.
    //
    // Scope this test to the handleUpload function body only.
    const m = clientJs.match(/async function handleUpload\([^)]*\)\s*\{([\s\S]*?)\n\s\s\}/);
    expect(m, "could not locate handleUpload body in client JS").toBeTruthy();
    const handleUploadBody = m![1];
    expect(handleUploadBody).not.toContain("navigator.geolocation");
    expect(handleUploadBody).not.toContain("getCurrentPosition");
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
    expect(html).toContain('<script src="/u-assets/upload.js"');
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
