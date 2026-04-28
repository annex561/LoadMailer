/**
 * TQL Driver/Carrier Information Sheet — link follower.
 *
 * TQL doesn't attach the driver sheet PDF to emails. Instead they send a
 * tokenized link like:
 *   https://post.tql.com/?qs=...
 *   https://...tql.com/portal/.../driver-info/<token>
 * which leads to a page where the carrier downloads the PDF.
 *
 * This module:
 *   1. Walks a Gmail MIME payload to find the email body (HTML or plain text)
 *   2. Extracts the TQL driver-sheet link from the body
 *   3. Fetches the PDF (direct GET first, Puppeteer fallback for JS-heavy pages)
 */

/** Walk a Gmail message payload to extract the HTML or plain-text body. */
export function extractEmailBody(payload: any): { html?: string; text?: string } {
  const out: { html?: string; text?: string } = {};
  function walk(p: any) {
    if (!p) return;
    const mime = p.mimeType || "";
    if (mime === "text/html" && p.body?.data && !out.html) {
      out.html = Buffer.from(p.body.data, "base64").toString("utf-8");
    }
    if (mime === "text/plain" && p.body?.data && !out.text) {
      out.text = Buffer.from(p.body.data, "base64").toString("utf-8");
    }
    if (Array.isArray(p.parts)) {
      for (const part of p.parts) walk(part);
    }
  }
  walk(payload);
  return out;
}

/**
 * Extract the TQL driver-sheet link from email body. Recognizes common patterns:
 *  - Anchor with text containing "driver" or "carrier information"
 *  - Direct URLs to *.tql.com or post.tql.com
 *  - Sendgrid-style click-tracking wrappers around tql.com URLs
 */
export function extractTqlDriverSheetLink(body: { html?: string; text?: string }): string | null {
  const html = body.html ?? "";
  const text = body.text ?? "";

  // Strategy 1: Look for anchor tags whose visible text mentions Driver/Carrier
  // Information Sheet — handles the typical HTML email format.
  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const url = m[1];
    const visibleText = m[2].replace(/<[^>]+>/g, "").toLowerCase();
    if (
      /driver.*(sheet|info|information)|carrier.*(sheet|info|information)|view your tql/.test(
        visibleText,
      )
    ) {
      return decodeHtmlEntities(url);
    }
  }

  // Strategy 2: Any URL pointing at *.tql.com / post.tql.com / *.totalqualitylogistics.com
  // (sendgrid-wrapped links also typically resolve back to tql.com)
  const urlRe =
    /https?:\/\/(?:[a-z0-9-]+\.)*(?:tql\.com|totalqualitylogistics\.com|post\.tql\.com|sendgrid\.net|tql\.app)\/[^\s"'<>)]+/gi;
  const fromHtml = html.match(urlRe);
  const fromText = text.match(urlRe);
  const candidates = [...(fromHtml ?? []), ...(fromText ?? [])].map(decodeHtmlEntities);
  if (candidates.length > 0) return candidates[0];

  return null;
}

/** Decode HTML entities (&amp; → &) so URLs work after extraction from HTML. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Fetch the PDF from a TQL driver-sheet URL.
 * - First tries a direct HTTP GET (fast path; works if the URL serves the PDF directly)
 * - Falls back to Puppeteer headless browser (for tokenized links that render an
 *   intermediate HTML page with a JS-triggered download)
 *
 * Returns the PDF buffer or null if the fetch failed. Logs verbosely so dispatcher
 * can debug when the driver-sheet automation breaks.
 */
export async function fetchPdfFromTqlLink(url: string): Promise<Buffer | null> {
  console.log(`[tql-link] fetching ${url.slice(0, 100)}…`);
  // Step 1: direct GET with browser-like User-Agent. Many TQL secure links
  // 302-redirect to a CDN that serves the PDF directly with the right Accept.
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") || "";
    console.log(`[tql-link] direct GET → ${res.status} ${contentType}`);
    if (res.ok && contentType.toLowerCase().includes("application/pdf")) {
      const arr = await res.arrayBuffer();
      console.log(`[tql-link] ✅ direct PDF (${arr.byteLength} bytes)`);
      return Buffer.from(arr);
    }
    // Some servers return PDF but mislabel it as octet-stream
    if (res.ok && contentType.toLowerCase().includes("octet-stream")) {
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      // PDF magic: %PDF
      if (buf.slice(0, 4).toString() === "%PDF") {
        console.log(`[tql-link] ✅ octet-stream PDF (${buf.length} bytes)`);
        return buf;
      }
    }
  } catch (err: any) {
    console.warn(`[tql-link] direct GET failed: ${err.message}`);
  }

  // Step 2: Puppeteer fallback for JS-rendered pages that gate the PDF behind
  // a button click or post-load redirect.
  try {
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
    try {
      const page = await browser.newPage();
      // Capture any PDF response that loads — covers both direct PDF page and
      // download triggered after a click.
      let pdfBuffer: Buffer | null = null;
      page.on("response", async (resp) => {
        try {
          const ct = (resp.headers()["content-type"] || "").toLowerCase();
          if (ct.includes("application/pdf")) {
            const buf = Buffer.from(await resp.buffer());
            if (buf.slice(0, 4).toString() === "%PDF" && !pdfBuffer) {
              pdfBuffer = buf;
              console.log(`[tql-link:puppeteer] captured PDF response (${buf.length} bytes)`);
            }
          }
        } catch (_) {
          // ignore individual response errors — keep listening for others
        }
      });

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      // Give async-loaded download iframes a chance to fire
      await new Promise((r) => setTimeout(r, 2_000));

      // If still no PDF, try common download buttons
      if (!pdfBuffer) {
        const downloadSelectors = [
          'a[href*=".pdf"]',
          'a[download]',
          'button:has-text("Download")',
          'a:has-text("Download")',
          '[data-action="download"]',
        ];
        for (const sel of downloadSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              await el.click();
              await new Promise((r) => setTimeout(r, 3_000));
              if (pdfBuffer) break;
            }
          } catch (_) {
            /* try next selector */
          }
        }
      }

      return pdfBuffer;
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    console.error(`[tql-link:puppeteer] failed: ${err.message}`);
    return null;
  }
}
