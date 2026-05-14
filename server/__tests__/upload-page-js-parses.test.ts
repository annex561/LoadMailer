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

describe("upload page — client script integrity", () => {
  const clientJsPath = path.join(__dirname, "..", "upload-page.client.js");
  const clientJs = fs.readFileSync(clientJsPath, "utf8");

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
