/**
 * Telnyx SMS adapter — drop-in alternative to Twilio for outbound messaging.
 *
 * Activated by setting SMS_PROVIDER=telnyx in env. Required env vars:
 *   TELNYX_API_KEY                — from Portal → Account → API Keys
 *   TELNYX_MESSAGING_PROFILE_ID   — Messaging Profile that owns the registered
 *                                   campaign + sender numbers
 *   TELNYX_PHONE_NUMBER           — fallback if the messaging profile has
 *                                   multiple numbers and you want a specific one
 *
 * Surface mirrors smsService.sendSMS() so the dispatch service can swap
 * providers without rewriting call sites:
 *   sendTelnyxSms({ to, body }) → { success, error?, messageSid? }
 *
 * Telnyx response shape (relevant bits):
 *   {
 *     "data": {
 *       "id": "40288...",            ← we map this to messageSid
 *       "to": [{ "phone_number": "+15551234567", "status": "queued", ... }],
 *       "errors": [...],             ← present on failure
 *     }
 *   }
 */

interface TelnyxSendResult {
  success: boolean;
  error?: string;
  messageSid?: string;
}

interface TelnyxApiResponse {
  data?: {
    id?: string;
    to?: Array<{ phone_number: string; status: string }>;
    errors?: Array<{ code: string; title: string; detail?: string }>;
  };
  errors?: Array<{ code: string; title: string; detail?: string }>;
}

const TELNYX_API_URL = "https://api.telnyx.com/v2/messages";

function isConfigured(): boolean {
  return !!(process.env.TELNYX_API_KEY && process.env.TELNYX_MESSAGING_PROFILE_ID);
}

export async function sendTelnyxSms(params: { to: string; body: string }): Promise<TelnyxSendResult> {
  const { to, body } = params;

  // Honor the same kill switch as the Twilio path so SMS_DISABLED=true halts
  // every outbound SMS regardless of which provider is configured.
  if (process.env.SMS_DISABLED === "true") {
    console.log(`🚫 [SMS_DISABLED] (telnyx) would have sent to ${to}: "${body.slice(0, 60).replace(/\n/g, " ")}..."`);
    return { success: false, error: "SMS_DISABLED=true — outbound SMS halted" };
  }

  const apiKey = process.env.TELNYX_API_KEY;
  const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
  const fromNumber = process.env.TELNYX_PHONE_NUMBER || "";

  if (!apiKey || !profileId) {
    return {
      success: false,
      error: "Telnyx not configured — set TELNYX_API_KEY and TELNYX_MESSAGING_PROFILE_ID",
    };
  }
  if (!to) return { success: false, error: "Missing recipient phone" };
  if (!body) return { success: false, error: "Missing message body" };

  // Telnyx expects E.164. Normalize the same way Twilio's SDK does.
  const e164 = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;

  // Prefer messaging_profile_id (lets Telnyx pick a sender from the profile's
  // pool, same as Twilio Messaging Service). Fall back to explicit "from" only
  // if the profile isn't set up — should be rare in production.
  const payload: Record<string, unknown> = {
    messaging_profile_id: profileId,
    to: e164,
    text: body,
  };
  if (fromNumber) payload.from = fromNumber;

  console.log(`[telnyx] sending to ${e164} (profile=${profileId})`);

  let resp: Response;
  try {
    resp = await fetch(TELNYX_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    console.error(`[telnyx] ❌ network error: ${err.message}`);
    return { success: false, error: `Telnyx network error: ${err.message}` };
  }

  let json: TelnyxApiResponse;
  try {
    json = (await resp.json()) as TelnyxApiResponse;
  } catch (err: any) {
    return { success: false, error: `Telnyx returned non-JSON (HTTP ${resp.status})` };
  }

  // 4xx/5xx — surface Telnyx's structured errors.
  if (!resp.ok) {
    const errs = json.errors ?? json.data?.errors ?? [];
    const detail = errs.length
      ? errs.map((e) => `${e.code}: ${e.title}${e.detail ? ` (${e.detail})` : ""}`).join("; ")
      : `HTTP ${resp.status}`;
    console.error(`[telnyx] ❌ API error: ${detail}`);
    return { success: false, error: `Telnyx: ${detail}` };
  }

  const messageId = json.data?.id;
  if (!messageId) {
    return { success: false, error: "Telnyx returned 200 but no message id" };
  }

  console.log(`[telnyx] ✅ accepted (id: ${messageId})`);
  return { success: true, messageSid: messageId };
}

export const telnyxService = {
  isConfigured,
  sendSMS: sendTelnyxSms,
};
