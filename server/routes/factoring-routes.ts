/**
 * Factoring admin routes — queue, submit, history.
 *
 * Phase 1: manual click-to-submit. No auto-send.
 *
 * - GET  /api/factoring/queue       — loads ready for factoring
 * - GET  /api/factoring/submissions — sent / funded / rejected history
 * - POST /api/factoring/submit/:loadId — fire packet (admin only)
 * - GET  /api/factoring/preview/:loadId — render packet PDF without sending
 */

import type { Express } from "express";
import { db } from "../db";
import { loads, factoringSubmissions, rateconIntake } from "@shared/schema";
import { and, desc, eq, isNotNull, isNull, ne, inArray } from "drizzle-orm";
import { requireRole } from "../auth";
import { buildFactoringPacket, submitToLoves, pastTodayCutoff } from "../factoring-loves";

export function registerFactoringRoutes(app: Express) {
  // Queue: delivered loads with all required docs and no submission yet
  app.get("/api/factoring/queue", requireRole("admin"), async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(loads)
        .where(
          and(
            eq(loads.status, "delivered"),
            isNotNull(loads.deliveredAt),
            // not yet submitted
            ne(loads.factoringStatus, "submitted"),
            ne(loads.factoringStatus, "funded"),
          ),
        )
        .orderBy(desc(loads.deliveredAt))
        .limit(100);

      // Existing submissions to know which ones already have a row
      const subs = rows.length
        ? await db.select().from(factoringSubmissions)
        : [];
      const subByLoad = new Map(subs.map((s: any) => [s.loadId, s]));

      // Look up intake rows for these loads to surface RateCon source
      // (handles legacy bug where rateconPath got overwritten with BOL).
      const intakes = rows.length
        ? await db
            .select()
            .from(rateconIntake)
            .where(inArray(rateconIntake.loadId, rows.map((r: any) => r.id)))
        : [];
      const intakeByLoad = new Map<string, any>(intakes.map((i: any) => [i.loadId, i]));

      const queue = rows.map((l: any) => {
        const intake: any = intakeByLoad.get(l.id);
        // Where will the packet builder actually pull each doc from?
        // Mirror the resolution logic in factoring-loves.ts so the UI
        // shows the same answer the builder will use.
        const rateconPathLooksLikeImage = !!(
          l.rateconPath &&
          (l.rateconPath.toLowerCase().endsWith(".jpg") ||
            l.rateconPath.toLowerCase().endsWith(".jpeg") ||
            l.rateconPath.toLowerCase().endsWith(".png"))
        );

        let rateconSource: string | null = null;
        if (l.rateconPath && !rateconPathLooksLikeImage) {
          rateconSource = "loads.ratecon_path (PDF)";
        } else if (intake?.pdfPath) {
          rateconSource = "ratecon_intake.pdf_path (intake fallback)";
        }

        let bolSource: string | null = null;
        if (l.bolPath) bolSource = "loads.bol_path (driver MMS)";
        else if (l.podPath) bolSource = "loads.pod_path";
        else if (rateconPathLooksLikeImage && l.rateconPath) {
          bolSource = "loads.ratecon_path (legacy BOL overwrite)";
        }

        const issues: string[] = [];
        if (!rateconSource) issues.push("no Rate Confirmation found");
        if (!bolSource) issues.push("no BOL/POD on file");
        if (!l.rate || l.rate <= 0) issues.push("no rate amount");

        const ready = !!rateconSource && !!bolSource && !!l.rate;

        return {
          loadId: l.id,
          loadNumber: l.loadNumber,
          brokerName: l.brokerName,
          deliveredAt: l.deliveredAt,
          rate: l.rate,
          ready,
          issues,
          rateconSource,
          bolSource,
          factoringStatus: l.factoringStatus,
          existingSubmission: subByLoad.get(l.id) ?? null,
        };
      });

      res.json({ queue, pastCutoff: pastTodayCutoff() });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "queue fetch failed" });
    }
  });

  // Submission history (sent/funded/rejected)
  app.get("/api/factoring/submissions", requireRole("admin"), async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(factoringSubmissions)
        .orderBy(desc(factoringSubmissions.createdAt))
        .limit(100);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "history fetch failed" });
    }
  });

  // Manual submit — admin click. This is the ONLY path that sends a packet
  // to Love's in phase 1. No background workers, no scheduled jobs.
  app.post("/api/factoring/submit/:loadId", requireRole("admin"), async (req, res) => {
    try {
      const userId = (req as any).user?.id ?? null;
      const result = await submitToLoves(req.params.loadId, userId);
      if (!result.ok) {
        return res.status(400).json({
          ok: false,
          error: result.error,
          blocked: result.blocked,
        });
      }
      res.json(result);
    } catch (err: any) {
      console.error("[factoring:submit]", err);
      res.status(500).json({ error: err?.message ?? "submit failed" });
    }
  });

  // Preview: render the merged packet PDF inline without sending. Lets the
  // admin eyeball the packet before clicking submit.
  app.get("/api/factoring/preview/:loadId", requireRole("admin"), async (req, res) => {
    try {
      const result = await buildFactoringPacket(req.params.loadId);
      if (!result.ok || !result.pdfBytes) {
        return res.status(400).json({
          error: result.error,
          warnings: result.warnings,
        });
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="packet-${req.params.loadId}.pdf"`);
      res.send(Buffer.from(result.pdfBytes));
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "preview failed" });
    }
  });
}
