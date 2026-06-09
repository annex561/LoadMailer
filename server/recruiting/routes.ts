// Recruiting funnel HTTP routes.
// Wires Lead Capture (Stage 1) → Application (Stage 2) → Pre-Screen (Stage 3) → Status (driver-facing).

import { type Express } from "express";
import { db } from "../db";
import { eq, and, gte } from "drizzle-orm";
import {
  recruitingApplications,
  recruitingStatusEvents,
  insertRecruitingLeadSchema,
  insertRecruitingApplicationSchema,
} from "@shared/schema";
import { screenApplication } from "./screening";
import { queueRecruitingNotification } from "./notifications";
import { pullMvr, queryClearinghouse, pullCriminal, scheduleDrugTest, scheduleDotPhysical, createSignatureRequest } from "./vendors";
import {
  recruitingDocuments,
  recruitingScreenings,
  recruitingMedical,
  drivers,
} from "@shared/schema";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { sql } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Configure cloudinary once if CLOUDINARY_URL is set
if (process.env.CLOUDINARY_URL && !cloudinary.config().cloud_name) {
  cloudinary.config({ secure: true });
}

const REQUIRED_DOCS_OWNER_OP = [
  "DRIVER_LICENSE_FRONT",
  "DRIVER_LICENSE_BACK",
  "SSN_CARD",
  "VOIDED_CHECK",
  "INSURANCE_CARD",
  "TRUCK_REGISTRATION",
];
const REQUIRED_DOCS_COMPANY = [
  "DRIVER_LICENSE_FRONT",
  "DRIVER_LICENSE_BACK",
  "SSN_CARD",
  "VOIDED_CHECK",
];

function requireAuth(req: any, res: any): boolean {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

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

      // Queue welcome SMS + welcome email (gated by RECRUITING_NOTIFICATIONS_LIVE env var).
      // If kill switch is off, these queue but never send — safe by default.
      try {
        const baseUrl = process.env.PUBLIC_APP_URL || "https://traqiq.app";
        await queueRecruitingNotification({
          applicationId: created.id,
          channel: "SMS",
          templateKey: "LEAD_CAPTURE_SMS",
          payload: { first_name: firstName, app_url: `${baseUrl}/apply/${created.id}` },
        });
        await queueRecruitingNotification({
          applicationId: created.id,
          channel: "EMAIL",
          templateKey: "LEAD_CAPTURE_EMAIL",
          payload: { first_name: firstName, app_url: `${baseUrl}/apply/${created.id}` },
        });
      } catch (notifyErr) {
        console.error("[recruiting/leads] notification queue err:", notifyErr);
      }

      res.json({ id: created.id, status: "LEAD_CREATED" });
    } catch (err) {
      console.error("[recruiting/leads] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/recruiting/applications — recruiter dashboard list (auth required)
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/applications", async (req: any, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const rows = await db
        .select({
          id: recruitingApplications.id,
          firstName: recruitingApplications.firstName,
          lastName: recruitingApplications.lastName,
          phone: recruitingApplications.phone,
          email: recruitingApplications.email,
          isOwnerOperator: recruitingApplications.isOwnerOperator,
          yearsExperience: recruitingApplications.yearsExperience,
          currentStage: recruitingApplications.currentStage,
          prescreenStatus: recruitingApplications.prescreenStatus,
          createdAt: recruitingApplications.createdAt,
          updatedAt: recruitingApplications.updatedAt,
        })
        .from(recruitingApplications)
        .orderBy(recruitingApplications.updatedAt);

      res.json({ applications: rows.reverse() });
    } catch (err) {
      console.error("[recruiting/applications GET list] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // PATCH /api/recruiting/applications/:id/stage — recruiter advances stage
  // -----------------------------------------------------------------------
  app.patch("/api/recruiting/applications/:id/stage", async (req: any, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { id } = req.params;
      const { toStage, reason } = req.body;
      if (!toStage) return res.status(400).json({ error: "toStage required" });

      const [existing] = await db
        .select({ id: recruitingApplications.id })
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Application not found" });

      await transitionStage(id, toStage, reason || "Recruiter stage transition", req.user?.id || "RECRUITER");
      res.json({ success: true });
    } catch (err) {
      console.error("[recruiting/applications/:id/stage PATCH] error:", err);
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

      // Queue acknowledgement notifications (gated by env)
      try {
        const baseUrl = process.env.PUBLIC_APP_URL || "https://traqiq.app";
        await queueRecruitingNotification({
          applicationId: id,
          channel: "SMS",
          templateKey: "APP_RECEIVED_SMS",
          payload: { first_name: existing.firstName },
        });
        await queueRecruitingNotification({
          applicationId: id,
          channel: "EMAIL",
          templateKey: "APPLICATION_RECEIVED_EMAIL",
          payload: { first_name: existing.firstName, status_url: `${baseUrl}/apply/${id}/status` },
        });
      } catch (e) { console.error("[recruiting] APPLIED notif err:", e); }

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

        try {
          const baseUrl = process.env.PUBLIC_APP_URL || "https://traqiq.app";
          await queueRecruitingNotification({
            applicationId: id,
            channel: "SMS",
            templateKey: "DOCS_REQUEST_SMS",
            payload: { first_name: existing.firstName, docs_url: `${baseUrl}/apply/${id}/documents` },
          });
          await queueRecruitingNotification({
            applicationId: id,
            channel: "EMAIL",
            templateKey: "DOCS_REQUESTED_EMAIL",
            payload: { first_name: existing.firstName, docs_url: `${baseUrl}/apply/${id}/documents` },
          });
        } catch (e) { console.error("[recruiting] PASS notif err:", e); }
      } else if (screen.status === "FAIL") {
        await transitionStage(
          id,
          "PRESCREENED_FAIL",
          `Pre-screening failed: ${screen.reasons.join("; ")}`
        );

        try {
          await queueRecruitingNotification({
            applicationId: id,
            channel: "SMS",
            templateKey: "DISQUALIFICATION_SMS",
            payload: { first_name: existing.firstName },
          });
          await queueRecruitingNotification({
            applicationId: id,
            channel: "EMAIL",
            templateKey: "DISQUALIFICATION_EMAIL",
            payload: { first_name: existing.firstName },
          });
        } catch (e) { console.error("[recruiting] FAIL notif err:", e); }
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

  // -----------------------------------------------------------------------
  // STAGE 4 — Document upload (PUBLIC — driver-facing)
  // -----------------------------------------------------------------------
  app.post(
    "/api/recruiting/applications/:id/documents",
    upload.single("file"),
    async (req: any, res) => {
      try {
        const { id } = req.params;
        const docType = String(req.body?.type || "").trim();
        if (!docType) return res.status(400).json({ error: "type required" });
        if (!req.file) return res.status(400).json({ error: "file required" });

        const [appRow] = await db
          .select()
          .from(recruitingApplications)
          .where(eq(recruitingApplications.id, id))
          .limit(1);
        if (!appRow) return res.status(404).json({ error: "Application not found" });

        // Upload to Cloudinary
        const folder = `traqiq/recruiting/${id}`;
        const publicId = `${docType}_${Date.now()}`;
        const isPdf = req.file.mimetype === "application/pdf";

        const uploadResult = await new Promise<any>((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder,
              public_id: publicId,
              resource_type: isPdf ? "raw" : "image",
              overwrite: false,
              tags: ["recruiting", id, docType],
              transformation: isPdf
                ? undefined
                : [{ width: 2400, height: 2400, crop: "limit" }, { quality: "auto:good" }],
            },
            (err, result) => (err ? reject(err) : resolve(result))
          );
          stream.end(req.file.buffer);
        });

        // Replace any existing doc of same type
        await db
          .delete(recruitingDocuments)
          .where(
            and(
              eq(recruitingDocuments.applicationId, id),
              eq(recruitingDocuments.type, docType)
            )
          );

        await db.insert(recruitingDocuments).values({
          applicationId: id,
          type: docType,
          filename: req.file.originalname,
          storagePath: uploadResult.secure_url,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          verified: false,
        });

        // Check if all required docs are uploaded → transition to DOCS_RECEIVED
        const uploaded = await db
          .select({ type: recruitingDocuments.type })
          .from(recruitingDocuments)
          .where(eq(recruitingDocuments.applicationId, id));
        const haveTypes = new Set(uploaded.map((d) => d.type));
        const required = appRow.isOwnerOperator
          ? REQUIRED_DOCS_OWNER_OP
          : REQUIRED_DOCS_COMPANY;
        const allReceived = required.every((t) => haveTypes.has(t));

        if (allReceived && appRow.currentStage === "DOCS_REQUESTED") {
          await transitionStage(id, "DOCS_RECEIVED", "All required documents received");
          try {
            await queueRecruitingNotification({
              applicationId: id,
              channel: "SMS",
              templateKey: "DOCS_RECEIVED_SMS",
              payload: { first_name: appRow.firstName },
            });
          } catch (e) {
            console.error("[recruiting] DOCS_RECEIVED notif err:", e);
          }
        }

        res.json({
          success: true,
          documentUrl: uploadResult.secure_url,
          allReceived,
        });
      } catch (err) {
        console.error("[recruiting/documents POST] error:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed" });
      }
    }
  );

  // List documents for an application (PUBLIC — driver checks own progress; recruiter via dashboard)
  app.get("/api/recruiting/applications/:id/documents", async (req, res) => {
    try {
      const { id } = req.params;
      const docs = await db
        .select({
          id: recruitingDocuments.id,
          type: recruitingDocuments.type,
          filename: recruitingDocuments.filename,
          mimeType: recruitingDocuments.mimeType,
          sizeBytes: recruitingDocuments.sizeBytes,
          verified: recruitingDocuments.verified,
          createdAt: recruitingDocuments.createdAt,
          // intentionally NOT exposing storagePath to public — only authenticated recruiter sees URLs
        })
        .from(recruitingDocuments)
        .where(eq(recruitingDocuments.applicationId, id));

      const [appRow] = await db
        .select({ isOwnerOperator: recruitingApplications.isOwnerOperator })
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);

      const required = appRow?.isOwnerOperator
        ? REQUIRED_DOCS_OWNER_OP
        : REQUIRED_DOCS_COMPANY;

      res.json({ documents: docs, required });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
    }
  });

  // -----------------------------------------------------------------------
  // RECRUITER: full applicant record (auth required)
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/applications/:id/full", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      const [events, documents, screenings, medical] = await Promise.all([
        db
          .select()
          .from(recruitingStatusEvents)
          .where(eq(recruitingStatusEvents.applicationId, id))
          .orderBy(recruitingStatusEvents.createdAt),
        db
          .select()
          .from(recruitingDocuments)
          .where(eq(recruitingDocuments.applicationId, id)),
        db
          .select()
          .from(recruitingScreenings)
          .where(eq(recruitingScreenings.applicationId, id)),
        db
          .select()
          .from(recruitingMedical)
          .where(eq(recruitingMedical.applicationId, id)),
      ]);

      // Mask SSN to last-4 for recruiter view
      const safeApp = { ...appRow, ssn: appRow.ssn ? `***-**-${appRow.ssn.slice(-4)}` : null };

      res.json({
        application: safeApp,
        events,
        documents,
        screenings,
        medical,
      });
    } catch (err) {
      console.error("[recruiting/applications/:id/full] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // RECRUITER notes
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/applications/:id/notes", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const rows = await db.execute(
        sql`SELECT id, author_id as "authorId", body, created_at as "createdAt"
            FROM recruiting_notes
            WHERE application_id = ${id}
            ORDER BY created_at DESC`
      );
      res.json({ notes: (rows as any).rows || rows });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
    }
  });

  app.post("/api/recruiting/applications/:id/notes", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const body = String(req.body?.body || "").trim();
      if (!body) return res.status(400).json({ error: "body required" });
      const authorId = req.user?.id || null;
      await db.execute(
        sql`INSERT INTO recruiting_notes (application_id, author_id, body)
            VALUES (${id}, ${authorId}, ${body})`
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 5 — Background / MVR / Clearinghouse (recruiter-triggered)
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/screenings/run", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      await transitionStage(id, "BACKGROUND_RUNNING", "Background screenings initiated", req.user?.id);

      const triggeredBy = req.user?.id || "RECRUITER";

      // Fire all three mock vendors in parallel
      const [mvr, clear, crim] = await Promise.all([
        pullMvr({
          licenseNumber: appRow.driverLicenseNumber || "",
          licenseState: appRow.driverLicenseState || "",
        }),
        queryClearinghouse({
          licenseNumber: appRow.driverLicenseNumber || "",
          licenseState: appRow.driverLicenseState || "",
          ssn: appRow.ssn || "",
          dob: appRow.dob?.toISOString?.() || "",
        }),
        pullCriminal({
          firstName: appRow.firstName,
          lastName: appRow.lastName,
          ssn: appRow.ssn || "",
          dob: appRow.dob?.toISOString?.() || "",
        }),
      ]);

      // Persist results
      await db.insert(recruitingScreenings).values([
        { applicationId: id, vendor: mvr.vendor, kind: "MVR", status: mvr.status, rawResult: mvr as any },
        { applicationId: id, vendor: clear.vendor, kind: "CLEARINGHOUSE", status: clear.status, rawResult: clear as any },
        { applicationId: id, vendor: crim.vendor, kind: "CRIMINAL", status: crim.status, rawResult: crim as any },
      ]);

      // Update applicant summary fields
      await db
        .update(recruitingApplications)
        .set({
          mvrPullStatus: mvr.status,
          mvrPullDate: new Date(),
          mvrPullVendor: mvr.vendor,
          clearinghouseStatus: clear.status,
          clearinghouseDate: new Date(),
          criminalBackgroundStatus: crim.status,
          criminalBackgroundDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      const allPass =
        mvr.status === "CLEAN" &&
        clear.status === "NOT_PROHIBITED" &&
        crim.status === "CLEAR";

      if (allPass) {
        await transitionStage(id, "BACKGROUND_PASS", "All background checks passed", triggeredBy);
        try {
          await queueRecruitingNotification({
            applicationId: id,
            channel: "SMS",
            templateKey: "BACKGROUND_PASS_SMS",
            payload: { first_name: appRow.firstName },
          });
        } catch (e) {
          console.error("[recruiting] BACKGROUND_PASS notif err:", e);
        }
      } else {
        const reasons: string[] = [];
        if (mvr.status !== "CLEAN") reasons.push("MVR violations");
        if (clear.status !== "NOT_PROHIBITED") reasons.push("Clearinghouse prohibited");
        if (crim.status !== "CLEAR") reasons.push("Criminal record");
        await transitionStage(
          id,
          "BACKGROUND_FAIL",
          `Background failed: ${reasons.join("; ")}`,
          triggeredBy
        );
      }

      res.json({ success: true, mvr, clearinghouse: clear, criminal: crim, passed: allPass });
    } catch (err) {
      console.error("[recruiting/screenings/run] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 6 — Schedule drug test + DOT physical
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/medical/schedule", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      const [drugTest, physical] = await Promise.all([
        scheduleDrugTest({
          applicationId: id,
          firstName: appRow.firstName,
          lastName: appRow.lastName,
        }),
        scheduleDotPhysical({
          applicationId: id,
          firstName: appRow.firstName,
          lastName: appRow.lastName,
        }),
      ]);

      await db.insert(recruitingMedical).values([
        {
          applicationId: id,
          kind: "DRUG_TEST",
          vendor: drugTest.vendor,
          status: "SCHEDULED",
          scheduledFor: new Date(drugTest.scheduledFor),
          rawResult: drugTest as any,
        },
        {
          applicationId: id,
          kind: "DOT_PHYSICAL",
          vendor: physical.vendor,
          status: "SCHEDULED",
          scheduledFor: new Date(physical.scheduledFor),
          rawResult: physical as any,
        },
      ]);

      await transitionStage(id, "MEDICAL_REQUESTED", "Drug test + DOT physical scheduled", req.user?.id);

      res.json({ success: true, drugTest, physical });
    } catch (err) {
      console.error("[recruiting/medical/schedule] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 6.5 — Mark medical complete (mock: auto-pass; live: webhook from Concentra)
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/medical/complete", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const passed = req.body?.passed !== false;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      await db
        .update(recruitingApplications)
        .set({
          drugTestStatus: passed ? "NEGATIVE" : "POSITIVE",
          drugTestDate: new Date(),
          dotPhysicalStatus: passed ? "PASSED" : "FAILED",
          dotPhysicalDate: new Date(),
          medicalCardNumber: passed ? `MC-${id.slice(0, 8).toUpperCase()}` : null,
          medicalCardExpiration: passed ? new Date(Date.now() + 24 * 30 * 24 * 60 * 60 * 1000) : null,
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      if (passed) {
        await transitionStage(id, "MEDICAL_PASS", "Drug test + DOT physical passed", req.user?.id);
        try {
          await queueRecruitingNotification({
            applicationId: id,
            channel: "SMS",
            templateKey: "MEDICAL_PASS_SMS",
            payload: { first_name: appRow.firstName },
          });
        } catch (e) {
          console.error("[recruiting] MEDICAL_PASS notif err:", e);
        }
      } else {
        await transitionStage(id, "MEDICAL_FAIL", "Medical screening failed", req.user?.id);
      }

      res.json({ success: true, passed });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 7 — Send lease/W-2 for e-signature
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/sign-request", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      const documentKey = appRow.isOwnerOperator
        ? "OWNER_OPERATOR_LEASE"
        : "COMPANY_DRIVER_W2";

      const sigReq = await createSignatureRequest({
        applicationId: id,
        documentKey,
        signerName: `${appRow.firstName} ${appRow.lastName}`,
        signerEmail: appRow.email,
      });

      await db
        .update(recruitingApplications)
        .set({
          agreementType: documentKey,
          agreementDocumentUrl: sigReq.signingUrl,
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      // For mock mode, auto-complete the signature for testing convenience
      // In live mode this comes from DocuSign webhook
      const autoComplete = process.env.RECRUITING_LIVE_VENDORS !== "true";
      if (autoComplete) {
        await db
          .update(recruitingApplications)
          .set({
            agreementSignedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(recruitingApplications.id, id));
        await transitionStage(id, "AGREEMENT_SIGNED", "Agreement signed (mock auto-complete)", req.user?.id);
      }

      res.json({ success: true, signingUrl: sigReq.signingUrl, autoCompleted: autoComplete });
    } catch (err) {
      console.error("[recruiting/sign-request] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 8 — Mark orientation complete
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/orientation/complete", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      await db
        .update(recruitingApplications)
        .set({ orientationCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(recruitingApplications.id, id));
      await transitionStage(id, "ORIENTATION_DONE", "Orientation completed", req.user?.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 9 — Assign truck
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/truck/assign", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const truckUnit = String(req.body?.truckUnit || "").trim() || `T-${Date.now()}`;
      await db
        .update(recruitingApplications)
        .set({
          assignedTruckUnit: truckUnit,
          truckAssignmentDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));
      await transitionStage(id, "TRUCK_ASSIGNED", `Truck ${truckUnit} assigned`, req.user?.id);
      res.json({ success: true, truckUnit });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // STAGE 10 — Promote to active driver. Creates row in existing drivers table.
  // -----------------------------------------------------------------------
  app.post("/api/recruiting/applications/:id/activate", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { id } = req.params;
      const [appRow] = await db
        .select()
        .from(recruitingApplications)
        .where(eq(recruitingApplications.id, id))
        .limit(1);
      if (!appRow) return res.status(404).json({ error: "Application not found" });

      if (appRow.driverId) {
        return res.json({ success: true, driverId: appRow.driverId, alreadyActive: true });
      }

      // Normalize phone to +1XXXXXXXXXX
      const digits = (appRow.phone || "").replace(/\D/g, "");
      const e164Phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : appRow.phone;

      const [created] = await db
        .insert(drivers)
        .values({
          companyId: appRow.companyId || null,
          name: `${appRow.firstName} ${appRow.lastName}`,
          email: appRow.email,
          phone: appRow.phone,
          phoneNumber: e164Phone,
          status: "available",
          licenseNumber: appRow.driverLicenseNumber || null,
          equipmentType: "straight_box_truck",
          isOnboarded: true,
          enableSmsNotifications: true,
          smsConsentAt: appRow.applicationSignedAt || appRow.consentSmsAt || new Date(),
          smsConsentSource: "recruiting_funnel",
          currentMood: "🙂",
        } as any)
        .returning({ id: drivers.id });

      // Backlink application → driver, mark ACTIVE
      await db
        .update(recruitingApplications)
        .set({
          driverId: created.id,
          activeFromDate: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(recruitingApplications.id, id));

      await transitionStage(id, "ACTIVE", `Activated as driver ${created.id}`, req.user?.id);

      try {
        await queueRecruitingNotification({
          applicationId: id,
          channel: "SMS",
          templateKey: "ACTIVE_SMS",
          payload: { first_name: appRow.firstName },
        });
      } catch (e) {
        console.error("[recruiting] ACTIVE notif err:", e);
      }

      res.json({ success: true, driverId: created.id });
    } catch (err) {
      console.error("[recruiting/activate] error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // Document verification (recruiter — toggle verified flag)
  // -----------------------------------------------------------------------
  app.patch("/api/recruiting/documents/:docId/verify", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      const { docId } = req.params;
      const verified = req.body?.verified !== false;
      await db
        .update(recruitingDocuments)
        .set({
          verified,
          verifiedAt: verified ? new Date() : null,
          verifiedBy: verified ? req.user?.id || "RECRUITER" : null,
        })
        .where(eq(recruitingDocuments.id, docId));
      res.json({ success: true, verified });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // FUNNEL ANALYTICS — conversion rates + time-in-stage
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/analytics", async (req: any, res) => {
    if (!requireAuth(req, res)) return;
    try {
      // Pull all status events for the trailing 90 days so we can compute conversions
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const events = await db
        .select()
        .from(recruitingStatusEvents)
        .where(gte(recruitingStatusEvents.createdAt, cutoff))
        .orderBy(recruitingStatusEvents.createdAt);

      // Count distinct applications that have EVER reached each stage
      const reachedByApp: Record<string, Set<string>> = {};
      const firstReachAt: Record<string, Record<string, Date>> = {};
      for (const e of events) {
        const aid = e.applicationId;
        const stage = e.toStage;
        if (!reachedByApp[aid]) reachedByApp[aid] = new Set();
        if (!firstReachAt[aid]) firstReachAt[aid] = {};
        if (!reachedByApp[aid].has(stage)) {
          reachedByApp[aid].add(stage);
          firstReachAt[aid][stage] = e.createdAt as any as Date;
        }
      }

      const totalApps = Object.keys(reachedByApp).length;
      const FUNNEL_ORDER = [
        "LEAD",
        "APPLIED",
        "PRESCREENED_PASS",
        "DOCS_RECEIVED",
        "BACKGROUND_PASS",
        "MEDICAL_PASS",
        "AGREEMENT_SIGNED",
        "ORIENTATION_DONE",
        "TRUCK_ASSIGNED",
        "ACTIVE",
      ];

      const stageStats = FUNNEL_ORDER.map((stage) => {
        let reached = 0;
        for (const aid in reachedByApp) {
          if (reachedByApp[aid].has(stage)) reached++;
        }
        return { stage, reached, pctOfLeads: totalApps > 0 ? Math.round((reached / totalApps) * 100) : 0 };
      });

      // Time-in-stage averages (between consecutive funnel stages)
      const transitions: Record<string, { totalMs: number; count: number }> = {};
      for (const aid in firstReachAt) {
        for (let i = 0; i < FUNNEL_ORDER.length - 1; i++) {
          const fromS = FUNNEL_ORDER[i];
          const toS = FUNNEL_ORDER[i + 1];
          const fromT = firstReachAt[aid][fromS];
          const toT = firstReachAt[aid][toS];
          if (fromT && toT) {
            const key = `${fromS}→${toS}`;
            if (!transitions[key]) transitions[key] = { totalMs: 0, count: 0 };
            transitions[key].totalMs += new Date(toT).getTime() - new Date(fromT).getTime();
            transitions[key].count += 1;
          }
        }
      }
      const avgTimeInStage = Object.entries(transitions).map(([key, v]) => {
        const avgHrs = v.count > 0 ? v.totalMs / v.count / (60 * 60 * 1000) : 0;
        return { transition: key, avgHours: Math.round(avgHrs * 10) / 10, samples: v.count };
      });

      res.json({
        windowDays: 90,
        totalApplications: totalApps,
        stageStats,
        avgTimeInStage,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // -----------------------------------------------------------------------
  // Mock signature completion page — for testing the lease/W-2 flow without
  // actually wiring DocuSign. Renders a simple e-sign UI; clicking "Sign"
  // transitions stage to AGREEMENT_SIGNED.
  // -----------------------------------------------------------------------
  app.get("/api/recruiting/applications/:id/mock-sign", async (req, res) => {
    const { id } = req.params;
    const doc = String(req.query?.doc || "AGREEMENT");
    const [appRow] = await db
      .select({ firstName: recruitingApplications.firstName, lastName: recruitingApplications.lastName })
      .from(recruitingApplications)
      .where(eq(recruitingApplications.id, id))
      .limit(1);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Mock Sign — LAMP Logistics</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#f1f5f9;margin:0;padding:40px}main{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 4px 16px rgba(0,0,0,0.08)}h1{margin:0 0 8px;font-size:22px}.muted{color:#64748b;font-size:13px}.sig{margin:24px 0;border:2px dashed #cbd5e1;border-radius:10px;padding:32px;text-align:center;color:#94a3b8}.sig.signed{border-color:#059669;background:#ecfdf5;color:#065f46}.btn{display:inline-block;background:#059669;color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;text-decoration:none;border:0;cursor:pointer;font-size:15px}.note{background:#fef3c7;border-radius:8px;padding:12px;font-size:12px;color:#78350f;margin-top:24px}</style></head>
<body><main><h1>Sign your ${doc.includes("LEASE") ? "Owner-Operator Lease" : "W-2 Employment Agreement"}</h1>
<div class="muted">Signer: ${appRow?.firstName || "Driver"} ${appRow?.lastName || ""} · MC-1725755</div>
<div class="sig" id="sigBox">Click to sign</div>
<button class="btn" onclick="document.getElementById('sigBox').textContent='✓ Signed';document.getElementById('sigBox').className='sig signed';this.disabled=true;this.textContent='Signed';setTimeout(()=>location.href='/apply/${id}/status',1000)">Sign Now</button>
<div class="note"><strong>Demo mode.</strong> When you wire real DocuSign, the live envelope replaces this page and the signature webhook fires.</div>
</main></body></html>`);
  });
}
