import type { Express } from "express";
import multer from "multer";
import { enqueueRatecon, parseIntake } from "./ratecon-intake-service";
import { db } from "./db";
import { rateconIntake } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

export function registerRateconIntakeRoutes(app: Express) {
  // POST /api/ratecon-intake/upload — PDF drag-and-drop
  app.post("/api/ratecon-intake/upload", upload.single("pdf"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "PDF required" });
      const companyId = (req as any).user?.companyId ?? null;
      const userId = (req as any).user?.id ?? null;
      const intake = await enqueueRatecon({
        sourceType: "upload",
        companyId,
        pdfBuffer: req.file.buffer,
        sourceFilename: req.file.originalname,
        sourceUploadedBy: userId,
      });
      // Fire-and-forget parse (don't block the request)
      parseIntake(intake.id, req.file.buffer).catch((e) =>
        console.error("[intake-upload] parse failed:", e.message),
      );
      res.json({ intakeId: intake.id, status: "queued" });
    } catch (err: any) {
      console.error("[intake-upload]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ratecon-intake/manual — typed-in manual entry
  app.post("/api/ratecon-intake/manual", async (req, res) => {
    try {
      const companyId = (req as any).user?.companyId ?? null;
      const userId = (req as any).user?.id ?? null;
      const intake = await enqueueRatecon({
        sourceType: "manual",
        companyId,
        sourceUploadedBy: userId,
      });
      // Manual entry skips parser, puts directly into in_review with user-provided fields
      await db
        .update(rateconIntake)
        .set({
          parsedJson: req.body,
          parsedAt: new Date(),
          parserModel: "manual",
          status: "in_review",
          reviewReason: "Manual entry — review before dispatch",
          updatedAt: new Date(),
        })
        .where(eq(rateconIntake.id, intake.id));
      res.json({ intakeId: intake.id, status: "in_review" });
    } catch (err: any) {
      console.error("[intake-manual]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ratecon-intake — list recent (for dashboard)
  app.get("/api/ratecon-intake", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const qb = db.select().from(rateconIntake);
      const rows = status
        ? await qb.where(eq(rateconIntake.status, status)).orderBy(desc(rateconIntake.createdAt)).limit(50)
        : await qb.orderBy(desc(rateconIntake.createdAt)).limit(50);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ratecon-intake/review-queue
  app.get("/api/ratecon-intake/review-queue", async (_req, res) => {
    const rows = await db
      .select()
      .from(rateconIntake)
      .where(eq(rateconIntake.status, "in_review"))
      .orderBy(desc(rateconIntake.createdAt))
      .limit(100);
    res.json(rows);
  });

  // GET /api/ratecon-intake/:id
  app.get("/api/ratecon-intake/:id", async (req, res) => {
    const [row] = await db.select().from(rateconIntake).where(eq(rateconIntake.id, req.params.id));
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  });

  // PATCH /api/ratecon-intake/:id — edit parsed fields (dispatcher inline edits)
  app.patch("/api/ratecon-intake/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { parsedJson, matchedDriverId } = req.body;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (parsedJson) updates.parsedJson = parsedJson;
      if (matchedDriverId !== undefined) {
        updates.matchedDriverId = matchedDriverId;
        updates.matchedDriverConfidence = 1.0; // human-assigned = certain
      }
      const [updated] = await db
        .update(rateconIntake)
        .set(updates)
        .where(eq(rateconIntake.id, id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ratecon-intake/:id/reject
  app.post("/api/ratecon-intake/:id/reject", async (req, res) => {
    const userId = (req as any).user?.id ?? null;
    const [updated] = await db
      .update(rateconIntake)
      .set({ status: "rejected", reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(rateconIntake.id, req.params.id))
      .returning();
    res.json(updated);
  });

  // POST /api/ratecon-intake/reject-duplicates
  // Smart-keep: finds all in_review rows for the given loadNumber, picks the
  // one with the most data filled in (full street addresses present), merges
  // any extra fields from the others into it, then rejects the rest.
  app.post("/api/ratecon-intake/reject-duplicates", async (req, res) => {
    try {
      const { loadNumber } = req.body || {};
      if (!loadNumber || typeof loadNumber !== "string") {
        return res.status(400).json({ error: "loadNumber is required" });
      }
      const userId = (req as any).user?.id ?? null;
      const { sql } = await import("drizzle-orm");

      // 1. Find all in_review rows for this load number
      const allRowsResult = await db.execute(sql`
        SELECT id, parsed_json, created_at
        FROM ratecon_intake
        WHERE
          status = 'in_review'
          AND parsed_json->'loadNumber'->>'value' = ${loadNumber}
        ORDER BY created_at ASC
      `);
      const allRows = (allRowsResult as any).rows ?? allRowsResult;
      if (!Array.isArray(allRows) || allRows.length === 0) {
        return res.json({ ok: true, rejectedCount: 0, keptIntakeId: null });
      }

      // 2. Score each row — more populated fields = higher score. Address
      //    fields count extra because they're the most valuable signal.
      const scoreRow = (pj: any): number => {
        if (!pj) return 0;
        let score = 0;
        if (pj.pickup?.address) score += 10;
        if (pj.drop?.address) score += 10;
        if (pj.pickup?.city) score += 1;
        if (pj.drop?.city) score += 1;
        if (pj.driverName?.value) score += 3;
        if (pj.commodity?.value) score += 1;
        if (pj.specialInstructions?.value) score += 2;
        if (pj.miles?.value) score += 1;
        if (pj.weightLbs?.value) score += 1;
        if (pj.broker?.value) score += 1;
        return score;
      };

      // 3. Pick the row with the highest score (ties → oldest, more stable)
      const ranked = [...allRows]
        .map((r: any) => ({ ...r, _score: scoreRow(r.parsed_json) }))
        .sort((a, b) => b._score - a._score);
      const kept = ranked[0];

      // 4. Deep-merge the OTHERS' parsed_json into kept's, so any unique
      //    data they had isn't lost (e.g. one had specialInstructions but
      //    another had the addresses).
      const mergeParsed = (existing: any, incoming: any): any => {
        if (existing == null) return incoming;
        if (incoming == null) return existing;
        if (typeof existing !== "object" || typeof incoming !== "object") {
          if (typeof existing === "string" && typeof incoming === "string") {
            return incoming.length > existing.length ? incoming : existing;
          }
          return existing;
        }
        if (Array.isArray(existing) || Array.isArray(incoming)) {
          if (Array.isArray(existing) && existing.length > 0) return existing;
          return incoming;
        }
        const result: Record<string, any> = {};
        const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
        for (const k of keys) result[k] = mergeParsed(existing[k], incoming[k]);
        return result;
      };

      let mergedJson = kept.parsed_json;
      for (const r of ranked.slice(1)) {
        mergedJson = mergeParsed(mergedJson, r.parsed_json);
      }

      // 5. Update the kept row with merged data
      await db.execute(sql`
        UPDATE ratecon_intake
        SET parsed_json = ${JSON.stringify(mergedJson)}::jsonb,
            review_reason = COALESCE(review_reason, '') || ' | Combined data from ' || ${ranked.length - 1}::text || ' duplicate row(s)',
            updated_at = NOW()
        WHERE id = ${kept.id}
      `);

      // 6. Reject every row except the kept one
      const rejectResult = await db.execute(sql`
        UPDATE ratecon_intake
        SET status = 'rejected',
            review_reason = COALESCE(review_reason, '') || ' | Bulk-rejected as duplicate of load ' || ${loadNumber}::text,
            reviewed_by = ${userId},
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE
          status = 'in_review'
          AND parsed_json->'loadNumber'->>'value' = ${loadNumber}
          AND id != ${kept.id}
        RETURNING id
      `);
      const rejected = (rejectResult as any).rows ?? rejectResult;
      const count = Array.isArray(rejected) ? rejected.length : 0;

      res.json({
        ok: true,
        rejectedCount: count,
        keptIntakeId: kept.id,
        keptScore: kept._score,
      });
    } catch (err: any) {
      console.error("[reject-duplicates]", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ratecon-intake/:id/approve-and-dispatch", async (req, res) => {
    try {
      const userId = (req as any).user?.id ?? null;
      // If client sent a driverId in the body, persist it first so that
      // the user doesn't need to click Save before clicking Approve & Dispatch.
      const driverIdFromBody: string | null | undefined = req.body?.driverId;
      if (driverIdFromBody !== undefined) {
        await db
          .update(rateconIntake)
          .set({
            matchedDriverId: driverIdFromBody || null,
            matchedDriverConfidence: driverIdFromBody ? 1.0 : 0,
            updatedAt: new Date(),
          })
          .where(eq(rateconIntake.id, req.params.id));
      }
      const { dispatchFromIntake, sendDispatchSms } = await import("./ratecon-dispatch-service");
      const outcome = await dispatchFromIntake(req.params.id);
      if (!outcome.ok) return res.status(400).json({ error: outcome.error });
      await db
        .update(rateconIntake)
        .set({ reviewedBy: userId, reviewedAt: new Date() })
        .where(eq(rateconIntake.id, req.params.id));
      const smsResult = await sendDispatchSms(outcome.loadId!);
      res.json({ ...outcome, sms: smsResult });
    } catch (err: any) {
      // Surface the Postgres detail (the underlying root cause that Drizzle
      // wraps but doesn't expose by default in `err.message`).
      const pgDetail = err?.cause?.detail || err?.detail || err?.cause?.message;
      const msg = pgDetail ? `${err.message} — ${pgDetail}` : err.message;
      console.error("[approve-and-dispatch]", err);
      console.error("[approve-and-dispatch] cause:", err?.cause);
      res.status(500).json({ error: msg });
    }
  });
}
