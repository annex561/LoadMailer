// Recruiting funnel HTTP routes.
// Wires Lead Capture (Stage 1) → Application (Stage 2) → Pre-Screen (Stage 3) → Status (driver-facing).

import { type Express } from "express";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  recruitingApplications,
  recruitingStatusEvents,
  insertRecruitingLeadSchema,
  insertRecruitingApplicationSchema,
} from "@shared/schema";
import { screenApplication } from "./screening";

const LAMP_COMPANY_ID_ENV = process.env.LAMP_DEFAULT_COMPANY_ID; // optional override

async function logStage(opts: {
  applicationId: string;
  fromStage?: string | null;
  toStage: string;
  reason?: string;
  triggeredBy?: string;
}) {
  // Cast: enum types are validated at the schema layer
  await db.insert(recruitingStatusEvents).values({
    applicationId: opts.applicationId,
    fromStage: (opts.fromStage ?? null) as any,
    toStage: opts.toStage as any,
    reason: opts.reason,
    triggeredBy: opts.triggeredBy ?? "SYSTEM",
  });
}

async function transitionStage(applicationId: string, toStage: string, reason?: string, triggeredBy?: string) {
  const [existing] = await db
    .select({ currentStage: recruitingApplications.currentStage })
    .from(recruitingApplications)
    .where(eq(recruitingApplications.id, applicationId));
  if (!existing) throw new Error("Application not found");

  await db
    .update(recruitingApplications)
    .set({ currentStage: toStage as any, updatedAt: new Date() })
    .where(eq(recruitingApplications.id, applicationId));

  await logStage({
    applicationId,
    fromStage: existing.currentStage,
    toStage,
    reason,
    triggeredBy,
  });
}

export function registerRecruitingRoutes(app: Express) {
  // -----------------------------------------------------------------------
  // POST /api/recruiting/leads — STAGE 1: Lead capture (public, no auth)
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/leads", async (req, res) => {
    try {
      const parsed = insertRecruitingLeadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
      const { firstName, lastName, phone, email, hasCdl, yearsExperience, leadSource, companyId } =
        parsed.data;

      const targetCompanyId = companyId || LAMP_COMPANY_ID_ENV || null;

      // Check existing application by email + company
      const existing = await db
        .select({ id: recruitingApplications.id, stage: recruitingApplications.currentStage })
        .from(recruitingApplications)
        .where(
          targetCompanyId
            ? and(
                eq(recruitingApplications.email, email),
                eq(recruitingApplications.companyId, targetCompanyId)
              )
            : eq(recruitingApplications.email, email)
        )
        .limit(1);

      if (existing.length > 0) {
        return res.json({
          id: existing[0].id,
          status: "RESUMED",
          message: "Welcome back — continue your application",
        });
      }

      const [created] = await db
        .insert(recruitingApplications)
        .values({
          companyId: targetCompanyId,
          firstName,
          lastName,
          phone,
          email,
          hasCdl: hasCdl ?? null,
          yearsExperience: yearsExperience ?? null,
          leadSource: leadSource ?? null,
          consentSmsAt: new Date(),
          currentStage: "LEAD",
        })
        .returning({ id: recruitingApplications.id });

      await logStage({
        applicationId: created.id,
        toStage: "LEAD",
        reason: "Lead captured from landing page",
      });

      // TODO (next-session): queue welcome SMS via existing smsCommunicationService + welcome email via SendGrid
      // (Both require explicit live-vendor approval per financial-impact policy.)

      res.json({ id: created.id, status: "LEAD_CREATED" });
    } catch (err) {
      console.error("[recruiting/leads] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/recruiting/applications/:id — fetch driver-facing status
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/applications/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      const events = await db
        .select()
        .from(recruitingStatusEvents)
        .where(eq(recruitingStatusEvents.applicationId, id))
        .orderBy(recruitingStatusEvents.createdAt);

      // Sanitize sensitive fields before returning to driver
      const { ssn: _ssn, ...safe } = appRow;
      res.json({
        application: safe,
        events: events.map((e: typeof recruitingStatusEvents.$inferSelect) => ({
          fromStage: e.fromStage,
          toStage: e.toStage,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
      });
    } catch (err) {
      console.error("[recruiting/applications/:id GET] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/recruiting/applications/:id — STAGE 2: Submit full application + Stage 3 pre-screen
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id", async (req, res) => {
    try {
      const { id } = req.params;

      const [existing] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Application not found" });

      const parsed = insertRecruitingApplicationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      }
      const app = parsed.data;

      await db
        .update(recruitingApplications)
        .set({
          dob: new Date(app.dob),
          ssn: app.ssn,
          currentAddress: app.currentAddress,
          currentCity: app.currentCity,
          currentState: app.currentState,
          currentZip: app.currentZip,
          driverLicenseNumber: app.driverLicenseNumber,
          driverLicenseState: app.driverLicenseState,
          driverLicenseClass: app.driverLicenseClass,
          driverLicenseExpiration: new Date(app.driverLicenseExpiration),
          employmentHistory: app.employmentHistory as any,
          accidents3yr: app.accidents3yr as any,
          violations3yr: app.violations3yr as any,
          licenseSuspensionRevocation: app.licenseSuspensionRevocation,
          licenseDenialEver: app.licenseDenialEver,
          felonyConviction: app.felonyConviction,
          felonyExplanation: app.felonyExplanation,
          failedDotDrugTestEver: app.failedDotDrugTestEver,
          failedDotAlcoholTestEver: app.failedDotAlcoholTestEver,
          authorizedToWorkInUs: app.authorizedToWorkInUs,
          isOwnerOperator: app.isOwnerOperator,
          consentMvr: app.consentMvr,
          consentDrugTest: app.consentDrugTest,
          consentBackground: app.consentBackground,
          consentClearinghouse: app.consentClearinghouse,
          consentPriorEmployerContact: app.consentPriorEmployerContact,
          applicantSignature: app.applicantSignature,
          applicationSignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      await transitionStage(id, "APPLIED", "Application submitted");

      // Stage 3 — Pre-screening
      const screen = screenApplication({
        yearsExperience: existing.yearsExperience ?? 0,
        accidents3yrCount: app.accidents3yr.length,
        violations3yrCount: app.violations3yr.length,
        licenseSuspensionRevocation: app.licenseSuspensionRevocation,
        licenseDenialEver: app.licenseDenialEver,
        felonyConviction: app.felonyConviction,
        failedDotDrugTestEver: app.failedDotDrugTestEver,
        failedDotAlcoholTestEver: app.failedDotAlcoholTestEver,
        authorizedToWorkInUs: app.authorizedToWorkInUs,
      });

      await db
        .update(recruitingApplications)
        .set({
          prescreenStatus: screen.status,
          prescreenReasons: screen.reasons as any,
          prescreenCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      if (screen.status === "PASS") {
        await transitionStage(id, "PRESCREENED_PASS", "Pre-screening passed");
        await transitionStage(id, "DOCS_REQUESTED", "Documents requested");
      } else if (screen.status === "FAIL") {
        await transitionStage(
          id,
          "PRESCREENED_FAIL",
          `Pre-screening failed: ${screen.reasons.join("; ")}`
        );
      } else {
        await logStage({
          applicationId: id,
          fromStage: "APPLIED",
          toStage: "APPLIED",
          reason: `Manual review required: ${screen.reasons.join("; ")}`,
        });
      }

      res.json({ success: true, prescreen: screen });
    } catch (err) {
      console.error("[recruiting/applications/:id POST] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });
}
