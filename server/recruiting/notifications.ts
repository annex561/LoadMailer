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

// Templates — single source of truth for content
type TemplateRender = { subject?: string; html?: string; text: string };

const SMS_TEMPLATES: Record<string, (p: Record<string, any>) => TemplateRender> = {
  LEAD_CAPTURE_SMS: (p) => ({
    text: `Thanks ${p.first_name || "for applying"} to LAMP Logistics. Open your application: ${p.app_url || "https://traqiq.app"}. Reply STOP to opt out.`,
  }),
  APP_RECEIVED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, application received. We'll text you when pre-screening completes — usually within 24 hours.`,
  }),
  DOCS_REQUEST_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, you passed pre-screening. Upload your documents here: ${p.docs_url || "https://traqiq.app"}.`,
  }),
  DOCS_RECEIVED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, docs received. Background check starting. We'll text you the result in 24-72 hrs.`,
  }),
  BACKGROUND_PASS_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, background check cleared. Drug test + DOT physical next. Check your email for the appointment.`,
  }),
  MEDICAL_PASS_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, medical cleared. Your lease/W-2 paperwork is on the way for e-signature.`,
  }),
  AGREEMENT_SIGNED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, agreement signed. Orientation course unlocked: ${p.orientation_url || "https://traqiq.app"}.`,
  }),
  TRUCK_ASSIGNED_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, your truck is ready. First load coming through TraqIQ shortly.`,
  }),
  ACTIVE_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, you're ACTIVE. Welcome to LAMP. First settlement Friday.`,
  }),
  DISQUALIFICATION_SMS: (p) => ({
    text: `${p.first_name || "Driver"}, your LAMP application was not approved at this time. See your portal for details.`,
  }),
};

const EMAIL_TEMPLATES: Record<string, (p: Record<string, any>) => TemplateRender> = {
  LEAD_CAPTURE_EMAIL: (p) => ({
    subject: "Welcome to LAMP Logistics — finish your application",
    text: `Hi ${p.first_name || "there"},\n\nThanks for your interest in driving with LAMP Logistics. Continue your application here:\n${p.app_url}\n\nQuestions: recruit@lamplogistics.com or (833) 362-9813.\n\nLAMP Logistics LLC · MC-1725755`,
    html: `<p>Hi ${p.first_name || "there"},</p><p>Thanks for your interest in driving with LAMP Logistics. <a href="${p.app_url}">Continue your application</a>.</p><p>Questions: recruit@lamplogistics.com or (833) 362-9813.</p><p style="color:#888;font-size:12px">LAMP Logistics LLC · MC-1725755 · DOT 4397421</p>`,
  }),
  APPLICATION_RECEIVED_EMAIL: (p) => ({
    subject: "We received your LAMP application",
    text: `Hi ${p.first_name || "there"},\n\nYour DOT-compliant application is in our system. We're running pre-screening now. We'll text + email you the result within 24 hours.\n\nQuestions: (833) 362-9813.`,
    html: `<p>Hi ${p.first_name || "there"},</p><p>Your DOT-compliant application is in our system. Pre-screening result within 24 hours.</p><p>Questions: (833) 362-9813.</p>`,
  }),
  DOCS_REQUESTED_EMAIL: (p) => ({
    subject: "Next step: upload your documents",
    text: `Hi ${p.first_name || "there"},\n\nYou passed pre-screening. Please upload your driver's license, SSN card, and voided check here:\n${p.docs_url}\n\nQuestions: (833) 362-9813.`,
    html: `<p>Hi ${p.first_name || "there"},</p><p>You passed pre-screening. <a href="${p.docs_url}">Upload your documents</a>.</p><p>Questions: (833) 362-9813.</p>`,
  }),
  DISQUALIFICATION_EMAIL: (p) => ({
    subject: "Your LAMP Logistics application",
    text: `Hi ${p.first_name || "there"},\n\nWe regret to inform you that based on the information you provided, we are unable to move forward with your application at this time. You may re-apply in 12 months.\n\nQuestions: recruit@lamplogistics.com.`,
    html: `<p>Hi ${p.first_name || "there"},</p><p>We regret to inform you that based on the information you provided, we are unable to move forward with your application at this time. You may re-apply in 12 months.</p><p>Questions: recruit@lamplogistics.com.</p>`,
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

const FROM_EMAIL = process.env.RECRUITING_FROM_EMAIL || process.env.SMTP_USER || "recruit@lamplogistics.com";

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
