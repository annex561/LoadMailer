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
import { renderUploadPage, PICKUP_STAGES } from "../load-photos-service";

function extractScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("No <script> block in renderUploadPage output");
  return m[1];
}

describe("renderUploadPage — inline <script> integrity", () => {
  const html = renderUploadPage(
    "abc-load-id",
    [...PICKUP_STAGES] as any,
    "LD12345",
  );
  const script = extractScript(html);

  it("parses as valid JavaScript", () => {
    // new Function(...) runs the JS parser in 'function body' mode without
    // executing. Catches every kind of syntax error: unterminated regex,
    // missing brace, busted template literal, lost backslash, etc.
    expect(() => new Function(script)).not.toThrow();
  });

  it("contains the slot-rendering loop (sanity)", () => {
    // If somebody refactors the page and accidentally removes the STAGES
    // loop, drivers will see an empty upload page even with valid JS. Catch
    // that here too.
    expect(script).toContain("STAGES.forEach");
    expect(script).toContain("handleUpload");
  });
});
