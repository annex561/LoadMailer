/**
 * OpenAI Vision BOL/POD sanity check.
 *
 * Sends the inbound MMS image URL to gpt-4o and asks "is this a Bill of Lading
 * with a visible signature?" Returns a pass/fail decision plus a short reason.
 *
 * Cost: ~$0.005 per call (gpt-4o vision pricing as of 2025).
 *
 * Env vars:
 *   BOL_VERIFY_ENABLED=true  — turns this code path on (default off)
 *   OPENAI_API_KEY           — required
 *
 * The caller is responsible for the per-load attempt cap (loads.bol_verify_attempts).
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

interface VerifyResult {
  ok: boolean;
  message: string;
}

export async function verifyBolPhoto(imageUrl: string): Promise<VerifyResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, message: "OPENAI_API_KEY not set" };
  }

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content:
            "You verify Bill of Lading (BOL) / Proof of Delivery (POD) photos for a trucking dispatch system. " +
            "A valid BOL has: (1) clearly readable text fields like shipper, consignee, commodity, weight, etc., " +
            "(2) a HUMAN signature on the receiver/consignee signature line (not just a stamp). " +
            'Respond ONLY with valid JSON: {"valid": boolean, "reason": "<short reason>"}. ' +
            "If the photo is too blurry, has no signature, or is clearly not a shipping document, set valid=false.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Is this a valid signed Bill of Lading or Proof of Delivery?",
            },
            {
              type: "image_url",
              image_url: { url: imageUrl },
            },
          ] as any,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) {
      return { ok: false, message: "Empty response from verifier" };
    }
    const parsed = JSON.parse(content) as { valid?: boolean; reason?: string };
    return {
      ok: !!parsed.valid,
      message: parsed.reason ?? (parsed.valid ? "Valid BOL detected" : "BOL check failed"),
    };
  } catch (err: any) {
    console.error("[bol-verify] OpenAI call failed:", err.message);
    return { ok: false, message: `Verifier error: ${err.message}` };
  }
}
