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
      if (existing[0]) {
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
        leadId = created.id;
        await db.insert(recruitmentLeadActivities).values({
          leadId,
          companyId,
          kind: "form_submit",
          body: "Initial landing page form submission.",
          metadata: { raw: form },
        });
      }

      return res.status(201).json({
        ok: true,
        leadId,
        message:
          "Thanks. Watch your phone — a real human will text you shortly. " +
          "Reply STOP at any time to opt out.",
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
