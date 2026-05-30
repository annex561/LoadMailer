/**
 * DocuSeal API client — universal e-signature integration.
 *
 * Works against EITHER:
 *   - DocuSeal Cloud:    DOCUSEAL_BASE_URL=https://api.docuseal.co
 *   - Self-hosted:       DOCUSEAL_BASE_URL=https://docuseal.your-domain.com
 *
 * Auth: X-Auth-Token header. Generate the token in DocuSeal admin →
 * Settings → API. Set DOCUSEAL_API_TOKEN in Railway environment.
 *
 * Dry-run mode: set DOCUSEAL_DRY_RUN=true and the service returns synthetic
 * submission IDs without actually calling the API. Useful for staging /
 * development / testing without burning DocuSeal quota.
 *
 * Kill switch: set DOCUSEAL_ENABLED=false and EVERY send returns
 * { ok: false, reason: "kill_switch" } — no API calls, no DB writes.
 *
 * Failure handling: NEVER throws. All errors are returned as
 * { ok: false, reason } so callers can record the failure and surface
 * to the admin without rolling back the envelope record.
 */
import { randomUUID } from "node:crypto";

// --------- Config (read at call time, NOT at module load) ---------

function baseUrl(): string {
  return (process.env.DOCUSEAL_BASE_URL || "https://api.docuseal.co").replace(/\/+$/, "");
}
function apiToken(): string | null {
  return process.env.DOCUSEAL_API_TOKEN || null;
}
function isEnabled(): boolean {
  const flag = (process.env.DOCUSEAL_ENABLED || "true").toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "no";
}
function isDryRun(): boolean {
  const flag = (process.env.DOCUSEAL_DRY_RUN || "false").toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

// --------- Types ---------

export type DocusealSigner = {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string;            // e.g. "Driver", "Carrier", "Witness"
  // Pre-filled field values keyed by the template field name in DocuSeal.
  values?: Record<string, string | number | boolean | null>;
};

export type CreateSubmissionInput = {
  templateId: string | number;      // DocuSeal template ID
  signers: DocusealSigner[];        // 1+ signers (multi-party supported)
  sendEmail?: boolean;              // DocuSeal sends its own email (default true)
  sendSms?: boolean;                // DocuSeal sends its own SMS (default false; we control SMS)
  metadata?: Record<string, unknown>; // arbitrary; surfaces back in webhooks
  redirectUrl?: string;             // where to send the signer after they sign
};

export type CreateSubmissionResult =
  | { ok: true; submissionId: string; signers: { id: string; url: string; email?: string | null; phone?: string | null }[] }
  | { ok: false; reason: string; status?: number };

export type SubmissionStatus =
  | { ok: true; submissionId: string; status: string; raw: unknown }
  | { ok: false; reason: string; status?: number };

// --------- HTTP helper ---------

async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ ok: true; data: any; status: number } | { ok: false; reason: string; status?: number }> {
  const token = apiToken();
  if (!token) return { ok: false, reason: "no_api_token_configured" };
  const url = `${baseUrl()}${path.startsWith("/") ? path : "/" + path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "X-Auth-Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep as null */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || text.slice(0, 200) || res.statusText;
      return { ok: false, reason: `docuseal_http_${res.status}: ${msg}`, status: res.status };
    }
    return { ok: true, data, status: res.status };
  } catch (err: any) {
    return { ok: false, reason: `docuseal_network_error: ${err?.message || "unknown"}` };
  }
}

// --------- Public API ---------

/**
 * Create a submission (send a document for signature).
 *
 * DocuSeal API shape (api.docuseal.co):
 *   POST /submissions
 *   { template_id, send_email, submitters: [{ name, email, phone, role, values }] }
 *
 * Returns the submission ID + per-signer URLs.
 */
export async function createSubmission(
  input: CreateSubmissionInput
): Promise<CreateSubmissionResult> {
  if (!isEnabled()) return { ok: false, reason: "kill_switch_DOCUSEAL_ENABLED" };

  if (isDryRun()) {
    return {
      ok: true,
      submissionId: `dry_${randomUUID()}`,
      signers: input.signers.map((s) => ({
        id: `dry_${randomUUID()}`,
        url: `https://example.com/dry-run-sign/${randomUUID()}`,
        email: s.email ?? null,
        phone: s.phone ?? null,
      })),
    };
  }

  const payload = {
    template_id: input.templateId,
    send_email: input.sendEmail ?? true,
    send_sms: input.sendSms ?? false,
    metadata: input.metadata ?? undefined,
    redirect_url: input.redirectUrl ?? undefined,
    submitters: input.signers.map((s) => ({
      name: s.name,
      email: s.email ?? undefined,
      phone: s.phone ?? undefined,
      role: s.role ?? "Signer",
      values: s.values ?? undefined,
    })),
  };

  const res = await call("POST", "/submissions", payload);
  if (!res.ok) return res;

  // DocuSeal returns an array of submitter rows OR a submission wrapper depending
  // on plan. Normalize both shapes.
  const submitters: any[] = Array.isArray(res.data)
    ? res.data
    : res.data?.submitters || res.data?.submissions?.[0]?.submitters || [];

  if (submitters.length === 0) {
    return { ok: false, reason: "docuseal_unexpected_response_shape", status: res.status };
  }
  const submissionId =
    res.data?.submission_id?.toString() ||
    res.data?.id?.toString() ||
    submitters[0]?.submission_id?.toString() ||
    "";

  return {
    ok: true,
    submissionId: submissionId || `unknown_${randomUUID()}`,
    signers: submitters.map((s: any) => ({
      id: s.id?.toString() || s.uuid || "",
      url: s.embed_src || s.url || s.signing_url || "",
      email: s.email ?? null,
      phone: s.phone ?? null,
    })),
  };
}

/**
 * Get the latest status of a submission.
 */
export async function getSubmission(submissionId: string): Promise<SubmissionStatus> {
  if (!isEnabled()) return { ok: false, reason: "kill_switch_DOCUSEAL_ENABLED" };
  if (isDryRun()) {
    return { ok: true, submissionId, status: "sent", raw: { dryRun: true } };
  }
  const res = await call("GET", `/submissions/${encodeURIComponent(submissionId)}`);
  if (!res.ok) return res;
  return {
    ok: true,
    submissionId,
    status: res.data?.status || res.data?.state || "unknown",
    raw: res.data,
  };
}

/**
 * Void / cancel a submission.
 */
export async function voidSubmission(submissionId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isEnabled()) return { ok: false, reason: "kill_switch_DOCUSEAL_ENABLED" };
  if (isDryRun()) return { ok: true };
  const res = await call("DELETE", `/submissions/${encodeURIComponent(submissionId)}`);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true };
}

// --------- Webhook normalizer (pure, exported for tests) ---------

export type NormalizedWebhook = {
  eventType: string;              // 'submission.completed', 'submission.viewed', etc.
  submissionId: string | null;
  signerEmail: string | null;
  signedPdfUrl: string | null;
  // Map provider lifecycle to our internal envelope status enum.
  envelopeStatus:
    | "sent"
    | "viewed"
    | "partially_signed"
    | "completed"
    | "declined"
    | "expired"
    | "voided"
    | "failed"
    | null;
  raw: unknown;
};

/**
 * Normalize a DocuSeal webhook payload into a shape our DB cares about.
 * Pure — exported for tests. NEVER throws.
 */
export function normalizeWebhook(payload: unknown): NormalizedWebhook {
  const p: any = payload || {};
  const eventType: string = p.event_type || p.event || p.type || "unknown";

  // DocuSeal payload shapes (Cloud + self-hosted):
  //   { event_type: 'submission.completed', data: { id, status, audit_log_url, documents: [{url}] } }
  //   { event_type: 'form.viewed',          data: { submission_id, email, ... } }
  const data: any = p.data || p.submission || p;
  const submissionId =
    (data?.submission_id ?? data?.id ?? p.submission_id ?? p.id)?.toString() || null;
  const signerEmail = (data?.email ?? p.email) || null;
  const signedPdfUrl =
    data?.audit_log_url ||
    data?.combined_document_url ||
    data?.documents?.[0]?.url ||
    null;

  let envelopeStatus: NormalizedWebhook["envelopeStatus"] = null;
  const et = eventType.toLowerCase();
  if (et.includes("completed") || et === "submission.completed" || et === "form.completed") {
    envelopeStatus = "completed";
  } else if (et.includes("viewed") || et === "form.viewed") {
    envelopeStatus = "viewed";
  } else if (et.includes("declined") || et === "form.declined") {
    envelopeStatus = "declined";
  } else if (et.includes("expired")) {
    envelopeStatus = "expired";
  } else if (et.includes("voided") || et.includes("cancelled") || et.includes("archived")) {
    envelopeStatus = "voided";
  } else if (et.includes("started") || et === "form.started") {
    envelopeStatus = "viewed";
  }

  return {
    eventType,
    submissionId,
    signerEmail,
    signedPdfUrl,
    envelopeStatus,
    raw: payload,
  };
}
