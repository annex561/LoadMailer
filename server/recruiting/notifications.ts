/**
 * Recruiting funnel notification dispatcher.
 *
 * Reads from notification_queue and sends SMS via existing smsService + email via existing nodemailer.
 *
 * SAFETY GUARDS (per CLAUDE.md financial-impact rule):
 *   1. Kill switch: RECRUITING_NOTIFICATIONS_LIVE env var. Default off. No outbound traffic until flipped.
 *   2. Watermark on boot: only notifications queued in last 24 hours fire. Old queue items are auto-marked STALE.
 *   3. Per-applicant dedup: each (driverId, templateKey) tuple can only succeed ONCE.
 *   4. Rate ceiling: max 50 outbound notifications per hour, hard cap.
 *   5. Honor existing opt-outs via smsService (already A2P 10DLC compliant).
 *   6. Idempotent process loop: marks SENDING before send, SENT/FAILED after.
 */

import nodemailer from "nodemailer";
import { eq, and, gte, sql, lt, isNull } from "drizzle-orm";
import { db } from "../db";
import { smsLoadService } from "../sms-service";
import { log } from "../vite";
import { SMS_TEMPLATES, type TemplateRender } from "./sms-templates";

// Lazy import to avoid circular deps at load time
async function notificationQueueTable() {
  const schema = await import("@shared/schema");
  return (schema as any).notificationQueue ?? null;
}

const KILL_SWITCH = () => process.env.RECRUITING_NOTIFICATIONS_LIVE === "true";

// Watermark: 24 hours
const WATERMARK_HOURS = 24;

// Rate limit: max sends per rolling hour (hard cap to prevent runaway)
const HOURLY_RATE_CAP = 50;
let sendsThisHour: { count: number; windowStartMs: number } = {
  count: 0,
  windowStartMs: Date.now(),
};

function checkAndConsumeRateBudget(): boolean {
  const now = Date.now();
  const windowAgeMs = now - sendsThisHour.windowStartMs;
  if (windowAgeMs >= 60 * 60 * 1000) {
    sendsThisHour = { count: 0, windowStartMs: now };
  }
  if (sendsThisHour.count >= HOURLY_RATE_CAP) return false;
  sendsThisHour.count += 1;
  return true;
}

// SMS templates moved to ./sms-templates (pure + unit-tested). Email templates below.

// Branded HTML email frame — single source of truth for the LAMP look.
function brandedEmail(opts: {
  preview: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td>
        <a href="${opts.ctaUrl}" style="background:#059669;color:#ffffff;display:inline-block;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:10px">${opts.ctaLabel}</a>
       </td></tr></table>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAMP Logistics</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<span style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${opts.preview}</span>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 16px">
  <tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06)">
      <tr><td style="padding:24px 32px 16px 32px;border-bottom:1px solid #e2e8f0">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="width:48px;padding-right:14px"><div style="width:44px;height:44px;background:linear-gradient(135deg,#059669,#047857);border-radius:11px;color:#ffffff;font-weight:700;font-size:22px;line-height:44px;text-align:center">L</div></td>
          <td><div style="font-weight:700;font-size:18px;color:#0f172a">LAMP Logistics</div><div style="font-size:11px;color:#64748b;letter-spacing:0.5px">MC-1725755 · DOT 4397421</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px 0;font-size:24px;color:#0f172a;font-weight:700;line-height:1.3">${opts.heading}</h1>
        <div style="font-size:15px;line-height:1.6;color:#334155">${opts.bodyHtml}</div>
        ${cta}
        ${opts.footer ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b">${opts.footer}</div>` : ""}
      </td></tr>
      <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
        Questions? <a href="tel:+18333629813" style="color:#059669;text-decoration:none">📞 (833) 362-9813</a> · <a href="mailto:recruit@lampslogistics.com" style="color:#059669;text-decoration:none">recruit@lampslogistics.com</a><br>
        © ${new Date().getFullYear()} LAMP Logistics LLC · MC-1725755 · DOT 4397421
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

const EMAIL_TEMPLATES: Record<string, (p: Record<string, any>) => TemplateRender> = {
  LEAD_CAPTURE_EMAIL: (p) => {
    const heading = `${p.first_name ? p.first_name + ", w" : "W"}elcome to LAMP Logistics`;
    return {
      subject: "Welcome to LAMP Logistics — finish your application",
      text: `Hi ${p.first_name || "there"},\n\nThanks for your interest in driving with LAMP. Continue your application:\n${p.app_url}\n\nQuestions: (833) 362-9813.\n\nLAMP Logistics LLC · MC-1725755`,
      html: brandedEmail({
        preview: "Finish your LAMP application in under 10 minutes",
        heading,
        bodyHtml: `<p>Thanks for your interest in driving with LAMP. We're a box-truck carrier built by drivers, for drivers — weekly pay, real authority, exclusive dispatcher.</p><p><strong>Your application is started.</strong> Finish the DOT-required portion now and we'll text you the result within 24 hours.</p>`,
        ctaLabel: "Continue Application →",
        ctaUrl: p.app_url,
        footer: `Most drivers finish in 10–15 minutes. Progress is saved as you go.`,
      }),
    };
  },
  APPLICATION_RECEIVED_EMAIL: (p) => ({
    subject: "We received your LAMP application",
    text: `Hi ${p.first_name || "there"},\n\nWe have your DOT application. Pre-screening result within 24 hours.\n\nQuestions: (833) 362-9813.`,
    html: brandedEmail({
      preview: "Pre-screening result coming within 24 hours",
      heading: `${p.first_name || "Driver"}, we got your application`,
      bodyHtml: `<p>Your DOT-compliant driver application is in our system. We're running pre-screening now — most applicants hear back within 24 hours.</p><p>If you pass, you'll get a text with a link to upload your driver's license, SSN card, and voided check.</p>`,
      ctaLabel: "Check Status →",
      ctaUrl: p.status_url,
    }),
  }),
  DOCS_REQUESTED_EMAIL: (p) => ({
    subject: "You passed pre-screening — upload your documents",
    text: `Hi ${p.first_name || "there"},\n\nYou passed pre-screening. Upload your documents:\n${p.docs_url}\n\nQuestions: (833) 362-9813.`,
    html: brandedEmail({
      preview: "Snap photos of 4-6 documents to keep your application moving",
      heading: `${p.first_name || "Driver"}, you passed pre-screening 🎉`,
      bodyHtml: `<p>Great news — you cleared our initial review. The fastest way to start driving is to upload your documents now.</p><p>You'll need: driver's license (front + back), Social Security card, and a voided check (for direct deposit). Owner-operators also upload truck insurance + registration.</p><p>Phone camera works fine.</p>`,
      ctaLabel: "Upload Documents →",
      ctaUrl: p.docs_url,
      footer: `Most drivers finish uploading in under 5 minutes.`,
    }),
  }),
  ACTIVE_EMAIL: (p) => ({
    subject: "You're ACTIVE at LAMP — your driver portal is ready",
    text: `${p.first_name || "Driver"}, congratulations — you're ACTIVE at LAMP Logistics.\n\nYour driver portal is here:\n${p.portal_url}\n\nBookmark this URL. First settlement Friday.\n\nQuestions: (833) 362-9813.`,
    html: brandedEmail({
      preview: "Your driver portal is live — bookmark the URL",
      heading: `${p.first_name || "Driver"}, you're ACTIVE 🎉`,
      bodyHtml: `<p>Welcome to LAMP Logistics. You're officially an active driver in our system.</p><p><strong>Your driver portal is ready.</strong> Bookmark this URL — it's how you'll see your loads, settlements, and messages from dispatch.</p><p>First settlement hits your account Friday.</p>`,
      ctaLabel: "Open Driver Portal →",
      ctaUrl: p.portal_url,
      footer: `Don't share this link — it's your personal credential. If you lose it, call (833) 362-9813.`,
    }),
  }),
  DISQUALIFICATION_EMAIL: (p) => ({
    subject: "Your LAMP Logistics application",
    text: `Hi ${p.first_name || "there"},\n\nWe're unable to move forward with your application at this time. You may re-apply in 12 months.\n\nQuestions: recruit@lampslogistics.com.`,
    html: brandedEmail({
      preview: "Application not approved at this time",
      heading: `${p.first_name || "Driver"}, your application`,
      bodyHtml: `<p>Thank you for applying with LAMP Logistics. Based on the information you provided, we're unable to move forward with your application at this time.</p><p>You may re-apply in 12 months. If your situation changes before then, please reach out directly.</p>`,
      footer: `LAMP Logistics is an equal opportunity employer.`,
    }),
  }),
};

// Build email transporter once
let _transporter: nodemailer.Transporter | null = null;
function emailTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: smtpPort,
    // Port 465 uses SMTPS (implicit SSL); 587 uses STARTTLS. Auto-detect so config matches transport.
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_USER,
      pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
    },
  });
  return _transporter;
}

const FROM_EMAIL = process.env.RECRUITING_FROM_EMAIL || process.env.SMTP_USER || "recruit@lampslogistics.com";

/**
 * Queue a recruiting notification. Always safe to call — gated at processor.
 */
export async function queueRecruitingNotification(opts: {
  applicationId: string;
  driverId?: string;
  channel: "SMS" | "EMAIL";
  templateKey: string;
  payload: Record<string, any>;
}) {
  try {
    const nq = await notificationQueueTable();
    if (!nq) return;
    await db.insert(nq).values({
      driverId: opts.applicationId, // we reuse the column to hold the application ID for recruiting
      channel: opts.channel,
      templateKey: opts.templateKey,
      payload: JSON.stringify({ ...opts.payload, _applicationId: opts.applicationId }),
      status: "PENDING",
    });
  } catch (err: any) {
    log(`⚠️ queueRecruitingNotification failed: ${err.message}`);
  }
}

/**
 * Main processor loop. Runs every 60 seconds.
 *
 * Honors all safety guards. Returns counts for instrumentation.
 */
export async function processRecruitingNotificationQueue(): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const result = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  // KILL SWITCH
  if (!KILL_SWITCH()) {
    return result; // silent — default off
  }

  const nq = await notificationQueueTable();
  if (!nq) return result;

  // Watermark cutoff
  const watermark = new Date(Date.now() - WATERMARK_HOURS * 60 * 60 * 1000);

  // Pull PENDING items that are within the watermark, only recruiting templates
  const pending = await db
    .select()
    .from(nq)
    .where(
      and(
        eq(nq.status, "PENDING"),
        gte(nq.createdAt, watermark),
        sql`(${nq.templateKey} LIKE 'LEAD_%' OR ${nq.templateKey} LIKE 'APP_%' OR ${nq.templateKey} LIKE 'DOCS_%' OR ${nq.templateKey} LIKE 'BACKGROUND_%' OR ${nq.templateKey} LIKE 'MEDICAL_%' OR ${nq.templateKey} LIKE 'AGREEMENT_%' OR ${nq.templateKey} LIKE 'TRUCK_%' OR ${nq.templateKey} LIKE 'ACTIVE_%' OR ${nq.templateKey} LIKE 'DISQUAL%' OR ${nq.templateKey} LIKE 'APPLICATION_%' OR ${nq.templateKey} LIKE 'DOCS%')`
      )
    )
    .limit(100); // chunk

  // Auto-mark stale (older than watermark) as STALE
  await db
    .update(nq)
    .set({ status: "STALE", errorMsg: "Past 24h watermark" })
    .where(and(eq(nq.status, "PENDING"), lt(nq.createdAt, watermark)));

  for (const row of pending) {
    result.processed++;

    // Rate cap (per-process; resets hourly)
    if (!checkAndConsumeRateBudget()) {
      result.skipped++;
      continue;
    }

    // Dedup: skip if we already SENT same (driverId=applicationId, templateKey)
    const dedup = await db
      .select({ id: nq.id })
      .from(nq)
      .where(
        and(
          eq(nq.driverId, row.driverId),
          eq(nq.templateKey, row.templateKey),
          eq(nq.status, "SENT")
        )
      )
      .limit(1);
    if (dedup.length > 0) {
      await db
        .update(nq)
        .set({ status: "DEDUPED", errorMsg: "Duplicate template for driver" })
        .where(eq(nq.id, row.id));
      result.skipped++;
      continue;
    }

    // Mark SENDING
    await db.update(nq).set({ status: "SENDING" }).where(eq(nq.id, row.id));

    let payload: Record<string, any> = {};
    try { payload = JSON.parse(row.payload); } catch {}

    try {
      if (row.channel === "SMS") {
        await sendRecruitingSMS(payload, row.templateKey);
      } else if (row.channel === "EMAIL") {
        await sendRecruitingEmail(payload, row.templateKey);
      } else {
        throw new Error(`Unknown channel ${row.channel}`);
      }
      await db
        .update(nq)
        .set({ status: "SENT", sentAt: new Date() })
        .where(eq(nq.id, row.id));
      result.sent++;
    } catch (err: any) {
      await db
        .update(nq)
        .set({ status: "FAILED", errorMsg: err.message?.slice(0, 500) ?? "send failed" })
        .where(eq(nq.id, row.id));
      result.failed++;
      log(`⚠️ recruiting notif send failed (${row.id}): ${err.message}`);
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    log(
      `📬 recruiting notifs: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped (${result.processed} processed)`
    );
  }

  return result;
}

async function sendRecruitingSMS(payload: Record<string, any>, templateKey: string) {
  const renderer = SMS_TEMPLATES[templateKey];
  if (!renderer) throw new Error(`No SMS template for ${templateKey}`);
  const rendered = renderer(payload);

  // Look up the applicant phone from the recruiting application
  const applicationId = payload._applicationId;
  if (!applicationId) throw new Error("No applicationId in payload");
  const schema = await import("@shared/schema");
  const recruitingApplications = (schema as any).recruitingApplications;
  if (!recruitingApplications) throw new Error("recruitingApplications schema not found");

  const [app] = await db
    .select({ phone: recruitingApplications.phone })
    .from(recruitingApplications)
    .where(eq(recruitingApplications.id, applicationId))
    .limit(1);
  if (!app?.phone) throw new Error("No phone on application");

  // smsService already handles A2P 10DLC: brand prefix, STOP suffix, opt-out checks
  await smsLoadService.sendSMS(app.phone, rendered.text);
}

async function sendRecruitingEmail(payload: Record<string, any>, templateKey: string) {
  const renderer = EMAIL_TEMPLATES[templateKey];
  if (!renderer) throw new Error(`No email template for ${templateKey}`);
  const rendered = renderer(payload);

  const applicationId = payload._applicationId;
  if (!applicationId) throw new Error("No applicationId in payload");
  const schema = await import("@shared/schema");
  const recruitingApplications = (schema as any).recruitingApplications;
  if (!recruitingApplications) throw new Error("recruitingApplications schema not found");

  const [app] = await db
    .select({ email: recruitingApplications.email })
    .from(recruitingApplications)
    .where(eq(recruitingApplications.id, applicationId))
    .limit(1);
  if (!app?.email) throw new Error("No email on application");

  if (!process.env.SMTP_USER && !process.env.EMAIL_USER) {
    throw new Error("SMTP not configured");
  }

  await emailTransporter().sendMail({
    from: FROM_EMAIL,
    to: app.email,
    subject: rendered.subject || "LAMP Logistics",
    text: rendered.text,
    html: rendered.html ?? rendered.text,
  });
}

/**
 * Schedules the processor to run every 60 seconds.
 * Called once at server boot from server/index.ts.
 */
let processorTimer: ReturnType<typeof setInterval> | null = null;
export function startRecruitingNotificationProcessor() {
  if (processorTimer) return;
  log("📬 recruiting notification processor scheduled (every 60s, kill switch: " +
    (KILL_SWITCH() ? "LIVE 🟢" : "OFF 🔴") + ")");

  processorTimer = setInterval(async () => {
    try {
      await processRecruitingNotificationQueue();
    } catch (err: any) {
      log(`⚠️ notification processor error: ${err.message}`);
    }
  }, 60_000);
}

export function stopRecruitingNotificationProcessor() {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}
