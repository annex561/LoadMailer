/**
 * OpenAI Vision BOL address extractor.
 *
 * Phase 2 of the wrong-load-attachment fix. After a driver's MMS BOL
 * photo is saved, we send it to gpt-4o and ask for the SHIP FROM and
 * SHIP TO addresses printed on the document. The result feeds into
 * address-match.ts to decide whether to auto-approve the photo,
 * prompt the driver for OVERRIDE, or send to dispatcher review.
 *
 * Cost: ~$0.005 per call (gpt-4o vision pricing). Mirrors the existing
 * factoring-bol-verify.ts shape so ops familiarity carries over.
 *
 * Env vars:
 *   ADDRESS_VERIFY_ENABLED=true   — turns this code path on (default OFF)
 *   OPENAI_API_KEY                — required
 *
 * Financial guards live HERE (per CLAUDE.md ABSOLUTE RULE), not in the
 * caller, so adding a new caller can't accidentally bypass them:
 *   - hard 5-second timeout via Promise.race (don't hang the inbound
 *     webhook → Twilio retries → another OpenAI call → another retry...)
 *   - returns { ok: false } on any error rather than throwing — caller
 *     falls back to dispatcher review (the safe default), no SMS error
 *     to the driver
 *
 * The per-driver hourly cap (defense in depth against a runaway loop
 * spending budget) lives in mms-upload-service.ts where the driver
 * phone is available.
 */

import OpenAI from "openai";
import type { ParsedAddress } from "./address-match";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

// Hard ceiling on a single OpenAI vision call. Above this, we bail and
// the caller treats it as ocr_status='error' → dispatcher review. We do
// NOT retry — retries would multiply cost and the user's experience
// of a slow webhook would only get worse.
const OPENAI_TIMEOUT_MS = 5000;

export interface ExtractResult {
  ok: boolean;
  shipFrom?: ParsedAddress;
  shipTo?: ParsedAddress;
  /** Raw model output, for debugging. */
  raw?: string;
  /** When ok=false, why. */
  error?: string;
}

export function isAddressVerifyEnabled(): boolean {
  return process.env.ADDRESS_VERIFY_ENABLED === "true";
}

export async function extractBolAddresses(imageUrl: string): Promise<ExtractResult> {
  // DRY-RUN MODE — skip the OpenAI call entirely. Returns ok:false so
  // the caller treats it as "OCR couldn't run" → falls back to
  // dispatcher review (Phase 1 gate). This lets the user exercise the
  // full inbound MMS chain without spending OpenAI dollars per photo.
  // See server/dry-run.ts.
  const { isDryRunOutbound, logDryRun } = await import("./dry-run");
  if (isDryRunOutbound()) {
    logDryRun({
      vendor: "openai",
      action: "extractBolAddresses",
      payload: { imageUrl },
    });
    return { ok: false, error: "dry-run mode: OCR skipped (falls back to dispatcher review)" };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY not set" };
  }

  const openaiCall = openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content:
          "You extract structured address data from Bill of Lading (BOL) / Proof of Delivery (POD) photos. " +
          "Look for the SHIP FROM (shipper / origin / pickup) and SHIP TO (consignee / destination / delivery) sections. " +
          "Return ONLY valid JSON in this exact shape: " +
          '{"shipFrom":{"street":"","city":"","state":"","zip":""},"shipTo":{"street":"","city":"","state":"","zip":""}}. ' +
          'If a field is unreadable or absent on the document, use "" (empty string) — do NOT guess. ' +
          'If the photo is not a BOL/POD at all, return {"shipFrom":{},"shipTo":{}}. ' +
          'Use the 2-letter postal abbreviation for state (e.g., "GA" not "Georgia"). ' +
          'Use only the 5-digit zip (drop any +4 suffix). ' +
          "Use exactly the street address as printed — do not normalize abbreviations.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the SHIP FROM and SHIP TO addresses from this BOL.",
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ] as any,
      },
    ],
    response_format: { type: "json_object" },
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`OpenAI vision call exceeded ${OPENAI_TIMEOUT_MS}ms`)),
      OPENAI_TIMEOUT_MS,
    ),
  );

  try {
    const resp = await Promise.race([openaiCall, timeoutPromise]);
    const content = resp.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "Empty response from OpenAI" };
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e: any) {
      return { ok: false, error: `OpenAI returned non-JSON: ${e.message}`, raw: content };
    }
    const norm = (a: any): ParsedAddress | undefined => {
      if (!a || typeof a !== "object") return undefined;
      const trim = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const out: ParsedAddress = {
        street: trim(a.street),
        city: trim(a.city),
        state: trim(a.state),
        zip: trim(a.zip),
      };
      if (!out.street && !out.city && !out.state && !out.zip) return undefined;
      return out;
    };
    return {
      ok: true,
      shipFrom: norm(parsed.shipFrom),
      shipTo: norm(parsed.shipTo),
      raw: content,
    };
  } catch (err: any) {
    // Includes both OpenAI errors AND the timeout.
    console.error("[bol-address-verify] extraction failed:", err.message);
    return { ok: false, error: err.message };
  }
}
