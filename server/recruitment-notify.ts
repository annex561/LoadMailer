/**
 * Hot-lead owner notification — Stage 1.5.
 *
 * When a new owner-operator or driver lead submits the public landing form,
 * the owner gets an immediate email saying "HOT LEAD — call now." This is the
 * ONLY automated outbound on the recruitment path. It is internal-facing
 * (admin notification, never to the lead) and uses the same nodemailer
 * transport that the factoring service already uses, so no new vendor or
 * credential is introduced.
 *
 * Per the project financial-blast-radius rule, this path includes:
 *   - Default-on kill switch HOT_LEAD_EMAIL_ENABLED (set 'false' to halt)
 *   - One email per lead submission (form endpoint is naturally rate-limited)
 *   - Graceful degradation: email failure NEVER fails the lead submission;
 *     the row is saved regardless. Errors are logged + recorded as an activity.
 *   - Per-lead dedup: tracked via recruitmentLeads.hotLeadNotifiedAt so a
 *     duplicate form submit cannot trigger a second email for the same lead.
 *
 * Recipients are pulled from env var HOT_LEAD_NOTIFY_TO (comma-separated).
 * If unset, falls back to NOTIFY_EMAIL, then OWNER_EMAIL. If none set, the
 * notifier no-ops with a logged warning — never crashes.
 */
import nodemailer from "nodemailer";
import type { RecruitmentLead } from "@shared/schema";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "",
  },
});

function isEnabled(): boolean {
  // Default ON (this is internal admin alert, not lead-facing). Set
  // HOT_LEAD_EMAIL_ENABLED=false to disable instantly without redeploy.
  const flag = (process.env.HOT_LEAD_EMAIL_ENABLED || "true").toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "no";
}

function recipients(): string[] {
  const raw =
    process.env.HOT_LEAD_NOTIFY_TO ||
    process.env.NOTIFY_EMAIL ||
    process.env.OWNER_EMAIL ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function fromAddress(): string {
  return (
    process.env.HOT_LEAD_FROM ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    "no-reply@traq-iq.com"
  );
}

/**
 * Build the email body. Pure function — exported for tests.
 */
export function buildHotLeadEmail(
  lead: Pick<
    RecruitmentLead,
    "id" | "firstName" | "lastName" | "phone" | "email" | "currentCarrier" | "source" | "createdAt"
  >,
  appBaseUrl: string
): { subject: string; text: string; html: string } {
  const fullName = `${lead.firstName}${lead.lastName ? " " + lead.lastName : ""}`;
  const subject = `🚨 HOT LEAD — call ${fullName} now (${lead.phone})`;
  const submittedAt = lead.createdAt
    ? new Date(lead.createdAt).toLocaleString()
    : "just now";
  const leadUrl = `${appBaseUrl.replace(/\/+$/, "")}/admin/recruitment`;
  const callHref = `tel:${lead.phone}`;
  const text = [
    `HOT LEAD — call now.`,
    ``,
    `Name:           ${fullName}`,
    `Phone:          ${lead.phone}`,
    `Email:          ${lead.email || "(not provided)"}`,
    `Current carrier:${lead.currentCarrier || "(not provided)"}`,
    `Source:         ${lead.source}`,
    `Submitted:      ${submittedAt}`,
    ``,
    `Tap to call:    ${callHref}`,
    `Dashboard:      ${leadUrl}`,
    ``,
    `Lead ID: ${lead.id}`,
  ].join("\n");
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h1 style="color: #e53e3e; margin: 0 0 8px 0;">🚨 HOT LEAD — call now</h1>
      <p style="color: #4a5568; font-size: 14px; margin: 0 0 24px 0;">
        Submitted ${submittedAt}. Call within 15 minutes during business hours for best conversion.
      </p>
      <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
        <tr><td style="padding: 8px 0; color: #718096; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${fullName}</td></tr>
        <tr><td style="padding: 8px 0; color: #718096;">Phone</td><td style="padding: 8px 0; font-weight: 600;"><a href="${callHref}" style="color: #2b6cb0;">${lead.phone}</a></td></tr>
        <tr><td style="padding: 8px 0; color: #718096;">Email</td><td style="padding: 8px 0;">${lead.email || "<em>not provided</em>"}</td></tr>
        <tr><td style="padding: 8px 0; color: #718096;">Current carrier</td><td style="padding: 8px 0;">${lead.currentCarrier || "<em>not provided</em>"}</td></tr>
        <tr><td style="padding: 8px 0; color: #718096;">Source</td><td style="padding: 8px 0;">${lead.source}</td></tr>
      </table>
      <p>
        <a href="${callHref}" style="display: inline-block; background: #e53e3e; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-right: 8px;">
          📞 Call ${lead.phone}
        </a>
        <a href="${leadUrl}" style="display: inline-block; background: #4a5568; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Open dashboard
        </a>
      </p>
      <p style="color: #a0aec0; font-size: 12px; margin-top: 32px;">
        Lead ID: ${lead.id} · TRAQ-IQ recruitment pipeline · This notification fires once per lead.
        To disable: set HOT_LEAD_EMAIL_ENABLED=false in Railway environment.
      </p>
    </div>
  `;
  return { subject, text, html };
}

export type NotifyResult =
  | { ok: true; sentTo: string[]; messageId?: string }
  | { ok: false; reason: string };

/**
 * Send the hot-lead alert email. Returns a result object — caller decides
 * what to record. NEVER throws; failure is reported via the result so the
 * lead-creation transaction is never rolled back due to email trouble.
 */
export async function notifyOwnerOfHotLead(
  lead: Pick<
    RecruitmentLead,
    "id" | "firstName" | "lastName" | "phone" | "email" | "currentCarrier" | "source" | "createdAt"
  >,
  appBaseUrl: string
): Promise<NotifyResult> {
  if (!isEnabled()) {
    return { ok: false, reason: "kill_switch_HOT_LEAD_EMAIL_ENABLED" };
  }
  const to = recipients();
  if (to.length === 0) {
    return { ok: false, reason: "no_recipients_configured" };
  }
  const { subject, text, html } = buildHotLeadEmail(lead, appBaseUrl);
  try {
    const info = await transporter.sendMail({
      from: fromAddress(),
      to: to.join(", "),
      subject,
      text,
      html,
    });
    return { ok: true, sentTo: to, messageId: info.messageId };
  } catch (err: any) {
    console.error("[recruitment] hot-lead email failed:", err?.message || err);
    return { ok: false, reason: `smtp_error: ${err?.message || "unknown"}` };
  }
}
