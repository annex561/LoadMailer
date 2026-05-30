/**
 * Hot-lead owner notification — Stage 1.5 (+ Slack add-on).
 *
 * When a new lead submits the public landing form, the owner gets:
 *   1. An email via the existing nodemailer + SMTP transport (Gmail / SES / etc.)
 *   2. A Slack message via Incoming Webhook (mobile push notifications)
 *
 * Both fire in parallel. Either or both can be disabled via env without code
 * changes. Neither blocks the lead-creation transaction — failures are logged
 * + recorded as activity rows, never thrown.
 *
 * Kill switches:
 *   HOT_LEAD_EMAIL_ENABLED=false   → disable email
 *   HOT_LEAD_SLACK_ENABLED=false   → disable Slack
 *
 * Recipients:
 *   Email: HOT_LEAD_NOTIFY_TO (comma-separated) → NOTIFY_EMAIL → OWNER_EMAIL
 *   Slack: SLACK_WEBHOOK_URL (single Incoming Webhook URL)
 *
 * If neither vendor is configured, the notifier no-ops with logged warning.
 *
 * Per the project financial-blast-radius rule, both paths include:
 *   - Default-on kill switches per channel
 *   - One notification per lead (deduped via recruitmentLeads.hotLeadNotifiedAt)
 *   - Graceful degradation: any failure never fails the lead submission
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

// =====================================================================
// Slack
// =====================================================================

function isSlackEnabled(): boolean {
  const flag = (process.env.HOT_LEAD_SLACK_ENABLED || "true").toLowerCase();
  return flag !== "false" && flag !== "0" && flag !== "no";
}

function slackWebhookUrl(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  // Defensive: only accept https://hooks.slack.com/* URLs so a typo doesn't
  // POST lead PII to an arbitrary host.
  if (!/^https:\/\/hooks\.slack\.com\//.test(url)) return null;
  return url;
}

/**
 * Build the Slack message payload. Pure function — exported for tests.
 * Uses Block Kit so the message looks good in Slack desktop + mobile,
 * with a clickable tel: link that opens the phone dialer on mobile.
 */
export function buildHotLeadSlackPayload(
  lead: Pick<
    RecruitmentLead,
    "id" | "firstName" | "lastName" | "phone" | "email" | "currentCarrier" | "source" | "createdAt"
  >,
  appBaseUrl: string
): Record<string, unknown> {
  const fullName = `${lead.firstName}${lead.lastName ? " " + lead.lastName : ""}`;
  const submittedAt = lead.createdAt
    ? new Date(lead.createdAt).toLocaleString()
    : "just now";
  const leadUrl = `${appBaseUrl.replace(/\/+$/, "")}/admin/recruitment`;
  const callHref = `tel:${lead.phone}`;
  return {
    // Fallback text — what shows up in the mobile push notification preview
    // BEFORE the user taps in. Make it scannable.
    text: `🚨 HOT LEAD — call ${fullName} now (${lead.phone})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `🚨 HOT LEAD — call ${fullName} now` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Name:*\n${fullName}` },
          { type: "mrkdwn", text: `*Phone:*\n<${callHref}|${lead.phone}>` },
          { type: "mrkdwn", text: `*Current carrier:*\n${lead.currentCarrier || "_not provided_"}` },
          { type: "mrkdwn", text: `*Email:*\n${lead.email || "_not provided_"}` },
          { type: "mrkdwn", text: `*Source:*\n${lead.source}` },
          { type: "mrkdwn", text: `*Submitted:*\n${submittedAt}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            style: "danger",
            text: { type: "plain_text", text: `📞 Call ${lead.phone}` },
            url: callHref,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Open dashboard" },
            url: leadUrl,
          },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Lead ID: \`${lead.id}\` · Call within 15 min during business hours for best conversion.` },
        ],
      },
    ],
  };
}

/**
 * Post the Slack message via the Incoming Webhook. NEVER throws.
 */
export async function notifySlackOfHotLead(
  lead: Pick<
    RecruitmentLead,
    "id" | "firstName" | "lastName" | "phone" | "email" | "currentCarrier" | "source" | "createdAt"
  >,
  appBaseUrl: string
): Promise<NotifyResult> {
  if (!isSlackEnabled()) {
    return { ok: false, reason: "kill_switch_HOT_LEAD_SLACK_ENABLED" };
  }
  const url = slackWebhookUrl();
  if (!url) {
    return { ok: false, reason: "no_slack_webhook_configured" };
  }
  const payload = buildHotLeadSlackPayload(lead, appBaseUrl);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `slack_http_${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true, sentTo: ["slack"] };
  } catch (err: any) {
    console.error("[recruitment] Slack notify failed:", err?.message || err);
    return { ok: false, reason: `slack_error: ${err?.message || "unknown"}` };
  }
}

/**
 * Fan-out notification: fire email + Slack in parallel, return both results.
 */
export async function notifyHotLead(
  lead: Pick<
    RecruitmentLead,
    "id" | "firstName" | "lastName" | "phone" | "email" | "currentCarrier" | "source" | "createdAt"
  >,
  appBaseUrl: string
): Promise<{ email: NotifyResult; slack: NotifyResult }> {
  const [email, slack] = await Promise.all([
    notifyOwnerOfHotLead(lead, appBaseUrl),
    notifySlackOfHotLead(lead, appBaseUrl),
  ]);
  return { email, slack };
}

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
