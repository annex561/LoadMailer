/**
 * Recruitment / Owner-Operator Lead Pipeline — Stage 1.
 *
 * Stage 1 deliberately ships with ZERO automated outbound. The /api/recruitment/leads
 * endpoint accepts public form submissions, captures A2P 10DLC consent, and creates
 * a lead row. All follow-up is performed manually by the admin via the
 * /admin/recruitment dashboard. No cron, no Twilio send, no email send.
 *
 * Stage 2 (separate PR, approval-gated under the financial-blast-radius rule) will
 * add the opt-in SMS sequence with kill switches, watermark, dedup, and rate ceiling.
 *
 * Regression-critical predicate exported for testing:
 *   normalizePhoneE164(raw)      — single source of truth for phone normalization
 *   buildLeadInsertFromForm(...) — pure function: form payload + request context → DB row
 *
 * Test: server/__tests__/recruitment-routes.test.ts
 */
import type { Express, Request } from "express";
import { db } from "./db";
import {
  recruitmentLeads,
  recruitmentLeadActivities,
  recruitmentLandingFormSchema,
  type RecruitmentLandingForm,
  type InsertRecruitmentLead,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { notifyOwnerOfHotLead } from "./recruitment-notify";

// Static company programs surfaced on the welcome page. Edit this list to
// change what every new lead sees. Order matters — top items render first.
// `amazonRelay` is featured because most OOs want Amazon Relay access.
const COMPANY_PROGRAMS = [
  { id: "amazon_relay", icon: "🚚", title: "Amazon Relay access", body: "Owner-operators leased to us run Amazon Relay loads through our carrier account. Steady freight, predictable lanes, fast pay." },
  { id: "pay_88", icon: "💵", title: "88% of line haul, weekly", body: "Eighty-eight percent of line haul, paid every Friday by direct deposit. No reserve, no escrow." },
  { id: "fsc", icon: "⛽", title: "100% fuel surcharge passthrough", body: "Every dollar of fuel surcharge we collect from shippers passes through to you. We keep zero." },
  { id: "fuel_card", icon: "💳", title: "Fuel card with 30¢+ off retail", body: "Comdata or EFS, your pick. Network-wide discount, fuel-only at network stops." },
  { id: "detention", icon: "⏱️", title: "Detention pay from hour two", body: "$50/hour after the first free hour. We collect from the shipper, you collect from us." },
  { id: "hotline", icon: "📞", title: "Real human on the hotline 24/7", body: "Owner-Op Hotline answers, not a phone tree. Escalates to ownership for anything serious." },
  { id: "no_forced", icon: "🎯", title: "No forced dispatch", body: "Daily load board. Pick what you want to haul. Pass on what you do not." },
  { id: "sign_on", icon: "🎁", title: "$500 + $500 sign-on bonus", body: "$500 at day 30 clean, another $500 at day 90 retained. Paid out of revenue you generated for us." },
  { id: "plates", icon: "📋", title: "Plate program — we front, you reimburse", body: "We pay your plates and permits up front. You reimburse from settlements over 12 months. Zero out of pocket day one." },
  { id: "walk", icon: "🤝", title: "30-day mutual walk", body: "If we are not the right fit, no penalty either way. Walk in 30 days, no questions, no claw-back." },
  { id: "referral", icon: "👥", title: "$1,000 referral bonus", body: "Refer another owner-operator who signs and stays 90 days, we pay you a thousand dollars." },
];

// Quiz config — every new field added here surfaces on the welcome page
// without a code change to the React component (it reads this list).
const QUALIFICATION_QUIZ = {
  sections: [
    {
      id: "basics",
      title: "The basics",
      questions: [
        { id: "hasCdlA", kind: "bool", label: "Do you have a CDL-A?" },
        { id: "yearsExperience", kind: "number", label: "Years of OTR experience" },
        { id: "ownsOrLeasesTruck", kind: "choice", label: "Truck status", options: [
            { value: "own", label: "I own my truck" },
            { value: "lease", label: "I lease my truck" },
            { value: "no_truck", label: "I do not have a truck yet" },
        ]},
      ],
    },
    {
      id: "authority_equipment",
      title: "Authority & equipment",
      questions: [
        { id: "hasOwnAuthority", kind: "bool", label: "Do you currently have your own MC authority?" },
        { id: "mcNumber", kind: "text", label: "MC number (if you have one)" },
        { id: "usdotNumber", kind: "text", label: "USDOT number (if you have one)" },
        { id: "equipmentType", kind: "choice", label: "Equipment type", options: [
            { value: "dry_van", label: "Dry van" },
            { value: "refrigerated", label: "Refrigerated" },
            { value: "flatbed", label: "Flatbed" },
            { value: "step_deck", label: "Step deck" },
            { value: "power_only", label: "Power only" },
            { value: "hot_shot", label: "Hot shot" },
            { value: "other", label: "Other" },
        ]},
        { id: "truckYear", kind: "number", label: "Truck year (model year)" },
      ],
    },
    {
      id: "lanes_schedule",
      title: "Lanes & schedule",
      questions: [
        { id: "homeBase", kind: "text", label: "Home base (City, ST)" },
        { id: "daysOutPreference", kind: "choice", label: "How long are you comfortable out?", options: [
            { value: "1_week", label: "1 week out at a time" },
            { value: "2_weeks", label: "2 weeks out" },
            { value: "3_plus", label: "3+ weeks out" },
        ]},
        { id: "preferredCallTime", kind: "choice", label: "Best time to call you", options: [
            { value: "morning", label: "Morning (7am – 11am)" },
            { value: "afternoon", label: "Afternoon (12pm – 4pm)" },
            { value: "evening", label: "Evening (5pm – 9pm)" },
            { value: "anytime", label: "Anytime, just call" },
        ]},
      ],
    },
    {
      id: "compliance",
      title: "Compliance",
      questions: [
        { id: "recentViolations3y", kind: "bool", label: "Any moving violations in the past 3 years?" },
        { id: "dwiEver", kind: "bool", label: "Any DUI or DWI ever?" },
        { id: "hazmatEndorsement", kind: "bool", label: "Do you have a hazmat endorsement?" },
        { id: "twicCard", kind: "bool", label: "Do you have a TWIC card?" },
      ],
    },
    {
      id: "open",
      title: "One last thing",
      questions: [
        { id: "amazonRelayInterest", kind: "bool", label: "Are you specifically interested in running Amazon Relay loads?" },
        { id: "leaveReason", kind: "text", label: "Why are you looking to leave your current carrier? (optional)" },
      ],
    },
  ],
};

// Typed-column allowlist for the qualification PATCH endpoint. ANY future
// columns added to recruitmentLeads that should be PATCH-able from the public
// welcome page MUST be added here. This is the security gate that prevents
// the public endpoint from setting stage="lease_signed" or signedDriverId.
const QUALIFICATION_ALLOWED_FIELDS = new Set([
  "hasCdlA", "yearsExperience", "ownsOrLeasesTruck",
  "hasOwnAuthority", "mcNumber", "usdotNumber", "equipmentType", "truckYear",
  "homeBase", "daysOutPreference", "preferredCallTime",
  "recentViolations3y", "dwiEver", "hazmatEndorsement", "twicCard",
  "amazonRelayInterest", "leaveReason",
]);

function baseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers.host || "";
  return `${proto}://${host}`;
}

// --------- Pure helpers (exported for tests) ---------

/**
 * Normalize a user-entered phone to E.164 (+1XXXXXXXXXX for US).
 * Returns null if it can't produce a 10- or 11-digit US number.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length === 12 && digits.startsWith("01")) return "+" + digits.slice(1);
  return null;
}

/**
 * Build the row to insert from a validated landing form payload + request context.
 * Pure function — no DB, no SMS, no side effects. The single place where consent
 * fields are populated, so a future refactor can't accidentally drop them.
 */
export function buildLeadInsertFromForm(
  form: RecruitmentLandingForm,
  ctx: { companyId: string; ip: string | null; userAgent: string | null; now?: Date }
): InsertRecruitmentLead {
  const phone = normalizePhoneE164(form.phone);
  if (!phone) throw new Error("invalid_phone");
  if (!form.smsConsent) throw new Error("sms_consent_required");
  const now = ctx.now ?? new Date();
  return {
    companyId: ctx.companyId,
    kind: form.kind,
    stage: "new",
    source: form.source,
    firstName: form.firstName.trim(),
    lastName: form.lastName?.trim() || null,
    phone,
    email: form.email?.trim() || null,
    currentCarrier: form.currentCarrier?.trim() || null,
    smsConsentAt: now,
    smsConsentSource: "landing_page_form",
    smsConsentIp: ctx.ip,
    smsConsentUserAgent: ctx.userAgent,
    rawFormPayload: form as unknown as Record<string, unknown>,
  };
}

/**
 * Sanitize a qualification PATCH body coming from the public welcome page.
 * SECURITY-CRITICAL: prevents the public endpoint from setting stage,
 * signedDriverId, consent, or any other internal field. ONLY fields in
 * QUALIFICATION_ALLOWED_FIELDS are kept; everything else is dropped silently.
 *
 * Returns:
 *   typed — fields that map directly onto typed columns on recruitmentLeads
 *   blob  — fields meant for the qualificationAnswers JSONB (free-form questions)
 *
 * Exported for tests.
 */
export function sanitizeQualificationPatch(input: Record<string, unknown>): {
  typed: Record<string, unknown>;
  blob: Record<string, unknown>;
} {
  const typed: Record<string, unknown> = {};
  const blob: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input || {})) {
    if (key === "complete") continue; // handled separately
    if (!QUALIFICATION_ALLOWED_FIELDS.has(key)) continue;
    let val: unknown = raw;
    // Coerce strings → number for known number fields
    if (key === "yearsExperience" || key === "truckYear") {
      if (val === "" || val === null || val === undefined) {
        val = null;
      } else {
        const n = Number(val);
        val = Number.isFinite(n) ? Math.trunc(n) : null;
      }
    }
    // Booleans: accept true/false, "true"/"false", "yes"/"no"
    if ([
      "hasCdlA","hasOwnAuthority","recentViolations3y","dwiEver",
      "hazmatEndorsement","twicCard","amazonRelayInterest",
    ].includes(key)) {
      if (val === true || val === false) {
        // ok
      } else if (typeof val === "string") {
        const s = val.toLowerCase();
        if (["true","yes","y","1"].includes(s)) val = true;
        else if (["false","no","n","0"].includes(s)) val = false;
        else val = null;
      } else if (val == null) {
        val = null;
      } else {
        val = null;
      }
    }
    // Trim strings, treat empty string as null
    if (typeof val === "string") {
      val = val.trim();
      if (val === "") val = null;
    }
    typed[key] = val;
    blob[key] = val;
  }
  return { typed, blob };
}

// --------- Helpers ---------

function clientIp(req: Request): string | null {
  const fwd = (req.headers["x-forwarded-for"] || "") as string;
  const first = fwd.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || null;
}

function userAgent(req: Request): string | null {
  return (req.headers["user-agent"] as string) || null;
}

async function resolveCompanyIdForPublic(): Promise<string> {
  // Public landing form: in Stage 1, every lead belongs to the default company.
  // Stage 2+ will resolve via subdomain / referrer / explicit company slug.
  const [{ companies }] = [await import("@shared/schema")];
  const [c] = await db.select().from(companies).limit(1);
  if (!c) throw new Error("no_company_configured");
  return c.id;
}

function resolveCompanyIdForAdmin(req: Request): string | null {
  // Admin endpoints: pull from authenticated session. Pattern matches the rest of
  // the codebase (req.user / req.session). For Stage 1 we accept the X-Company-Id
  // header in dev and fall back to the first company in the DB if unset, so the
  // admin UI works before auth is fully wired.
  const hdr = req.headers["x-company-id"];
  if (typeof hdr === "string" && hdr.length > 0) return hdr;
  const u = (req as any).user;
  if (u?.companyId) return u.companyId;
  return null;
}

// --------- Route registration ---------

export function registerRecruitmentRoutes(app: Express) {
  // ---- PUBLIC: landing page form submission ----
  app.post("/api/recruitment/leads", async (req, res) => {
    try {
      const parsed = recruitmentLandingFormSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "validation_failed",
          issues: parsed.error.issues,
        });
      }
      const form = parsed.data;

      const companyId = await resolveCompanyIdForPublic();
      const insertRow = buildLeadInsertFromForm(form, {
        companyId,
        ip: clientIp(req),
        userAgent: userAgent(req),
      });

      // Upsert-by-phone: if the same phone already submitted, surface that lead
      // instead of erroring out (so a driver who fills the form twice doesn't see
      // a scary error). We DO NOT overwrite stage or consent fields on a re-submit.
      const existing = await db
        .select()
        .from(recruitmentLeads)
        .where(
          and(
            eq(recruitmentLeads.phone, insertRow.phone!),
            eq(recruitmentLeads.companyId, companyId)
          )
        )
        .limit(1);

      let leadId: string;
      let isNewLead = false;
      let leadRow: typeof recruitmentLeads.$inferSelect;
      if (existing[0]) {
        leadRow = existing[0];
        leadId = existing[0].id;
        await db.insert(recruitmentLeadActivities).values({
          leadId,
          companyId,
          kind: "form_submit",
          body: "Re-submission of landing page form (existing lead).",
          metadata: { duplicate: true, raw: form },
        });
      } else {
        const [created] = await db.insert(recruitmentLeads).values(insertRow).returning();
        leadRow = created;
        leadId = created.id;
        isNewLead = true;
        await db.insert(recruitmentLeadActivities).values({
          leadId,
          companyId,
          kind: "form_submit",
          body: "Initial landing page form submission.",
          metadata: { raw: form },
        });
      }

      // Fire the owner notification ONCE per lead (dedup via hotLeadNotifiedAt).
      // Email failure does NOT roll back the lead — the row is the source of truth.
      if (isNewLead && !leadRow.hotLeadNotifiedAt) {
        const result = await notifyOwnerOfHotLead(leadRow, baseUrl(req));
        if (result.ok) {
          await db
            .update(recruitmentLeads)
            .set({ hotLeadNotifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(recruitmentLeads.id, leadId));
          await db.insert(recruitmentLeadActivities).values({
            leadId,
            companyId,
            kind: "system",
            body: `Hot-lead email sent to ${result.sentTo.join(", ")}`,
            metadata: { messageId: result.messageId, sentTo: result.sentTo },
          });
        } else {
          await db.insert(recruitmentLeadActivities).values({
            leadId,
            companyId,
            kind: "system",
            body: `Hot-lead email NOT sent: ${result.reason}`,
            metadata: { reason: result.reason },
          });
        }
      }

      return res.status(201).json({
        ok: true,
        leadId,
        welcomeUrl: `/owner-operators/welcome/${leadId}`,
        message:
          "Thanks. The owner will call you shortly. While you wait, answer a few quick questions so the call moves faster.",
      });
    } catch (err: any) {
      console.error("[recruitment] POST /api/recruitment/leads failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: list leads ----
  app.get("/api/recruitment/leads", async (req, res) => {
    try {
      const companyId = resolveCompanyIdForAdmin(req);
      const baseQuery = db
        .select()
        .from(recruitmentLeads)
        .orderBy(desc(recruitmentLeads.createdAt))
        .limit(500);
      const rows = companyId
        ? await baseQuery.where(eq(recruitmentLeads.companyId, companyId))
        : await baseQuery;
      return res.json({ ok: true, leads: rows });
    } catch (err: any) {
      console.error("[recruitment] GET /api/recruitment/leads failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: single lead with activities ----
  app.get("/api/recruitment/leads/:id", async (req, res) => {
    try {
      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });

      const activities = await db
        .select()
        .from(recruitmentLeadActivities)
        .where(eq(recruitmentLeadActivities.leadId, lead.id))
        .orderBy(desc(recruitmentLeadActivities.createdAt))
        .limit(500);

      return res.json({ ok: true, lead, activities });
    } catch (err: any) {
      console.error("[recruitment] GET /api/recruitment/leads/:id failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: add a manual activity (note / call summary / manual SMS log) ----
  app.post("/api/recruitment/leads/:id/activities", async (req, res) => {
    try {
      const { kind, body, metadata } = req.body || {};
      const validKinds = [
        "sms_outbound", "sms_inbound", "email_outbound", "email_inbound",
        "call_outbound", "call_inbound", "voicemail", "note",
      ];
      if (!kind || !validKinds.includes(kind)) {
        return res.status(400).json({ error: "invalid_kind", validKinds });
      }
      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });

      const [activity] = await db
        .insert(recruitmentLeadActivities)
        .values({
          leadId: lead.id,
          companyId: lead.companyId,
          kind,
          body: body || null,
          metadata: metadata || null,
          actorUserId: (req as any).user?.id || null,
        })
        .returning();

      // Bump lastContactedAt on outbound contact kinds
      if (["sms_outbound", "email_outbound", "call_outbound", "voicemail"].includes(kind)) {
        await db
          .update(recruitmentLeads)
          .set({ lastContactedAt: new Date(), updatedAt: new Date() })
          .where(eq(recruitmentLeads.id, lead.id));
      }

      return res.status(201).json({ ok: true, activity });
    } catch (err: any) {
      console.error("[recruitment] POST activities failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- PUBLIC: welcome page payload (lead summary + quiz + programs) ----
  // The leadId acts as a one-time-use token — anyone with the link can view + answer.
  // We do NOT expose stage, owner notes, or anything internal. Only what the lead
  // already gave us plus the static company programs and quiz config.
  app.get("/api/recruitment/leads/:id/welcome", async (req, res) => {
    try {
      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });

      return res.json({
        ok: true,
        lead: {
          id: lead.id,
          firstName: lead.firstName,
          // Echo back ONLY safe fields. No phone, no internal stage.
          submittedAt: lead.createdAt,
          qualificationCompletedAt: lead.qualificationCompletedAt,
        },
        programs: COMPANY_PROGRAMS,
        quiz: QUALIFICATION_QUIZ,
        // Echo existing answers so the page can resume if the lead comes back later.
        answers: lead.qualificationAnswers || {},
        typedAnswers: {
          hasCdlA: lead.hasCdlA,
          yearsExperience: lead.yearsExperience,
          ownsOrLeasesTruck: lead.ownsOrLeasesTruck,
          hasOwnAuthority: lead.hasOwnAuthority,
          mcNumber: lead.mcNumber,
          usdotNumber: lead.usdotNumber,
          equipmentType: lead.equipmentType,
          truckYear: lead.truckYear,
          homeBase: lead.homeBase,
          daysOutPreference: lead.daysOutPreference,
          preferredCallTime: lead.preferredCallTime,
          recentViolations3y: lead.recentViolations3y,
          dwiEver: lead.dwiEver,
          hazmatEndorsement: lead.hazmatEndorsement,
          twicCard: lead.twicCard,
          amazonRelayInterest: lead.amazonRelayInterest,
          leaveReason: lead.leaveReason,
        },
      });
    } catch (err: any) {
      console.error("[recruitment] welcome failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- PUBLIC: incremental qualification save (lead answers a question) ----
  // Uses sanitizeQualificationPatch to allow ONLY the whitelisted fields through.
  // Cannot be used to change stage, signedDriverId, consent, or any other field.
  app.patch("/api/recruitment/leads/:id/qualification", async (req, res) => {
    try {
      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });

      const sanitized = sanitizeQualificationPatch(req.body || {});
      if (Object.keys(sanitized.typed).length === 0 && Object.keys(sanitized.blob).length === 0) {
        return res.status(400).json({ error: "no_valid_fields", allowed: Array.from(QUALIFICATION_ALLOWED_FIELDS) });
      }

      const mergedBlob = {
        ...(lead.qualificationAnswers as Record<string, unknown> || {}),
        ...sanitized.blob,
        _lastUpdated: new Date().toISOString(),
      };

      const update: Record<string, unknown> = {
        ...sanitized.typed,
        qualificationAnswers: mergedBlob,
        updatedAt: new Date(),
      };

      // Mark complete if the body says so OR if all 4 required-ish answers are present.
      if (req.body?.complete === true) {
        update.qualificationCompletedAt = new Date();
      }

      await db.update(recruitmentLeads).set(update).where(eq(recruitmentLeads.id, lead.id));

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[recruitment] qualification PATCH failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: acknowledge a hot lead ("Call Now" tapped) ----
  app.post("/api/recruitment/leads/:id/acknowledge", async (req, res) => {
    try {
      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });
      if (lead.hotLeadAcknowledgedAt) {
        return res.json({ ok: true, alreadyAcknowledged: true });
      }
      const actorUserId = (req as any).user?.id || null;
      const now = new Date();
      await db
        .update(recruitmentLeads)
        .set({
          hotLeadAcknowledgedAt: now,
          hotLeadAcknowledgedBy: actorUserId,
          lastContactedAt: now,
          updatedAt: now,
        })
        .where(eq(recruitmentLeads.id, lead.id));
      await db.insert(recruitmentLeadActivities).values({
        leadId: lead.id,
        companyId: lead.companyId,
        kind: "call_outbound",
        body: "Admin tapped 'Call Now' on hot-lead notification.",
        actorUserId,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[recruitment] acknowledge failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: move stage ----
  app.patch("/api/recruitment/leads/:id/stage", async (req, res) => {
    try {
      const { stage, lostReason } = req.body || {};
      const validStages = [
        "new", "settlement_sent", "conversation", "application_sent",
        "compliance_pending", "lease_signed", "first_load",
        "active_30d", "active_90d", "lost", "dormant",
      ];
      if (!stage || !validStages.includes(stage)) {
        return res.status(400).json({ error: "invalid_stage", validStages });
      }

      const [lead] = await db
        .select()
        .from(recruitmentLeads)
        .where(eq(recruitmentLeads.id, req.params.id))
        .limit(1);
      if (!lead) return res.status(404).json({ error: "not_found" });

      const fromStage = lead.stage;
      await db
        .update(recruitmentLeads)
        .set({
          stage,
          lostReason: stage === "lost" ? (lostReason || null) : lead.lostReason,
          updatedAt: new Date(),
        })
        .where(eq(recruitmentLeads.id, lead.id));

      await db.insert(recruitmentLeadActivities).values({
        leadId: lead.id,
        companyId: lead.companyId,
        kind: "stage_changed",
        fromStage,
        toStage: stage,
        body: stage === "lost" ? `Lost reason: ${lostReason || "(none)"}` : null,
        actorUserId: (req as any).user?.id || null,
      });

      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[recruitment] PATCH stage failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });
}
