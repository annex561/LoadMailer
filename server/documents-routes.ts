/**
 * Documents / Signature routes.
 *
 * Public-ish:
 *   POST /api/documents/webhook       — DocuSeal posts here when an envelope event happens
 *
 * Admin:
 *   POST /api/documents/send          — send a template to a signer
 *   GET  /api/documents               — list envelopes (filterable)
 *   GET  /api/documents/:id           — single envelope detail
 *   POST /api/documents/:id/resend    — resend the signer URL (or re-trigger DocuSeal email)
 *   POST /api/documents/:id/void      — cancel an outstanding envelope
 *
 * The webhook endpoint is mounted BEFORE auth so DocuSeal can hit it. It is
 * defended by the webhook secret header (DOCUSEAL_WEBHOOK_SECRET); set this
 * in DocuSeal admin → Webhook Settings → Secret. If unset, the endpoint
 * accepts all callbacks (development-only — set the secret in production).
 */
import type { Express, Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  signatureEnvelopes,
  type InsertSignatureEnvelope,
} from "@shared/schema";
import {
  createSubmission,
  getSubmission,
  voidSubmission,
  normalizeWebhook,
} from "./docuseal-service";

function actorUserId(req: Request): string | null {
  return (req as any).user?.id || null;
}

function companyIdForAdmin(req: Request): string | null {
  const hdr = req.headers["x-company-id"];
  if (typeof hdr === "string" && hdr.length > 0) return hdr;
  const u = (req as any).user;
  if (u?.companyId) return u.companyId;
  return null;
}

/**
 * Validate the webhook secret. Pure — exported for tests.
 */
export function webhookSecretIsValid(headerValue: unknown): boolean {
  const expected = process.env.DOCUSEAL_WEBHOOK_SECRET;
  if (!expected) {
    // Development mode: no secret configured, accept all. Production MUST set this.
    return true;
  }
  if (typeof headerValue !== "string") return false;
  return headerValue === expected;
}

export function registerDocumentsRoutes(app: Express) {
  // ---- WEBHOOK: DocuSeal lifecycle events ----
  app.post("/api/documents/webhook", async (req, res) => {
    try {
      const secret = req.headers["x-docuseal-signature"] || req.headers["x-webhook-secret"];
      if (!webhookSecretIsValid(secret)) {
        return res.status(401).json({ error: "invalid_signature" });
      }
      const normalized = normalizeWebhook(req.body);
      if (!normalized.submissionId) {
        // Unknown payload shape — ack so DocuSeal does not retry forever, but log.
        console.warn("[documents] webhook with no submission_id:", JSON.stringify(req.body).slice(0, 500));
        return res.json({ ok: true, ignored: true, reason: "no_submission_id" });
      }

      const [envelope] = await db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.providerSubmissionId, normalized.submissionId))
        .limit(1);

      if (!envelope) {
        console.warn(`[documents] webhook for unknown submission ${normalized.submissionId}`);
        return res.json({ ok: true, ignored: true, reason: "envelope_not_found" });
      }

      const now = new Date();
      const update: Record<string, unknown> = {
        lastWebhookAt: now,
        lastWebhookKind: normalized.eventType,
        rawProviderPayload: normalized.raw as Record<string, unknown>,
        updatedAt: now,
      };
      if (normalized.envelopeStatus) update.status = normalized.envelopeStatus;
      if (normalized.envelopeStatus === "viewed" && !envelope.viewedAt) update.viewedAt = now;
      if (normalized.envelopeStatus === "completed") {
        update.completedAt = now;
        update.status = "completed";
      }
      if (normalized.envelopeStatus === "declined") {
        update.declinedAt = now;
      }
      if (normalized.signedPdfUrl) update.signedPdfPath = normalized.signedPdfUrl;

      await db
        .update(signatureEnvelopes)
        .set(update)
        .where(eq(signatureEnvelopes.id, envelope.id));

      return res.json({ ok: true, envelopeId: envelope.id, status: update.status || envelope.status });
    } catch (err: any) {
      console.error("[documents] webhook error:", err);
      // Always 200 to webhook so the provider does not retry indefinitely on a bug
      return res.json({ ok: false, error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: send a document for signature ----
  app.post("/api/documents/send", async (req, res) => {
    try {
      const {
        templateId,
        documentName,
        signerKind,
        signerId,
        signerName,
        signerEmail,
        signerPhone,
        prefillValues,
        sendEmail,
        sendSms,
        redirectUrl,
        notes,
      } = req.body || {};

      if (!templateId) return res.status(400).json({ error: "templateId_required" });
      if (!documentName) return res.status(400).json({ error: "documentName_required" });
      if (!signerName) return res.status(400).json({ error: "signerName_required" });
      if (!signerEmail && !signerPhone) {
        return res.status(400).json({ error: "signer_email_or_phone_required" });
      }

      const companyId = companyIdForAdmin(req);

      // 1. Insert a draft envelope so we have a row even if DocuSeal fails.
      const draftRow: InsertSignatureEnvelope = {
        companyId,
        signerKind: signerKind || "external",
        signerId: signerId || null,
        signerName,
        signerEmail: signerEmail || null,
        signerPhone: signerPhone || null,
        documentName,
        templateRef: String(templateId),
        provider: "docuseal",
        status: "draft",
        createdByUserId: actorUserId(req),
        notes: notes || null,
      };
      const [draft] = await db.insert(signatureEnvelopes).values(draftRow).returning();

      // 2. Call DocuSeal.
      const result = await createSubmission({
        templateId,
        signers: [{
          name: signerName,
          email: signerEmail || null,
          phone: signerPhone || null,
          values: prefillValues || undefined,
        }],
        sendEmail: sendEmail !== false,  // default true (DocuSeal emails the signer)
        sendSms: sendSms === true,       // default false (we control SMS via Twilio if needed)
        metadata: { envelopeId: draft.id, companyId },
        redirectUrl,
      });

      if (!result.ok) {
        await db
          .update(signatureEnvelopes)
          .set({ status: "failed", notes: `Send failed: ${result.reason}`, updatedAt: new Date() })
          .where(eq(signatureEnvelopes.id, draft.id));
        return res.status(502).json({ ok: false, error: result.reason, envelopeId: draft.id });
      }

      // 3. Update envelope with provider IDs + signer URL.
      const signer = result.signers[0];
      await db
        .update(signatureEnvelopes)
        .set({
          providerSubmissionId: result.submissionId,
          providerSignerUrl: signer?.url || null,
          status: "sent",
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(signatureEnvelopes.id, draft.id));

      return res.status(201).json({
        ok: true,
        envelopeId: draft.id,
        submissionId: result.submissionId,
        signerUrl: signer?.url || null,
      });
    } catch (err: any) {
      console.error("[documents] send failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: list envelopes ----
  app.get("/api/documents", async (req, res) => {
    try {
      const companyId = companyIdForAdmin(req);
      const baseQuery = db
        .select()
        .from(signatureEnvelopes)
        .orderBy(desc(signatureEnvelopes.createdAt))
        .limit(500);
      const rows = companyId
        ? await baseQuery.where(eq(signatureEnvelopes.companyId, companyId))
        : await baseQuery;
      return res.json({ ok: true, envelopes: rows });
    } catch (err: any) {
      console.error("[documents] list failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: single envelope ----
  app.get("/api/documents/:id", async (req, res) => {
    try {
      const [env] = await db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.id, req.params.id))
        .limit(1);
      if (!env) return res.status(404).json({ error: "not_found" });

      // Refresh from provider if outstanding
      if (env.providerSubmissionId && env.status !== "completed" && env.status !== "voided") {
        const status = await getSubmission(env.providerSubmissionId);
        if (status.ok) {
          // Best-effort status sync; webhook is the source of truth.
          // Do NOT block the response on this.
        }
      }
      return res.json({ ok: true, envelope: env });
    } catch (err: any) {
      console.error("[documents] get failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });

  // ---- ADMIN: void / cancel ----
  app.post("/api/documents/:id/void", async (req, res) => {
    try {
      const [env] = await db
        .select()
        .from(signatureEnvelopes)
        .where(eq(signatureEnvelopes.id, req.params.id))
        .limit(1);
      if (!env) return res.status(404).json({ error: "not_found" });
      if (env.providerSubmissionId) {
        await voidSubmission(env.providerSubmissionId);
      }
      await db
        .update(signatureEnvelopes)
        .set({ status: "voided", updatedAt: new Date() })
        .where(eq(signatureEnvelopes.id, env.id));
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("[documents] void failed:", err);
      return res.status(500).json({ error: err.message || "internal_error" });
    }
  });
}
