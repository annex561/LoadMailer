/**
 * Loads audit + cleanup endpoints.
 *
 * Two-step pattern to make destructive actions safe:
 *
 *   1. GET  /api/admin/loads/audit          — preview. Returns counts +
 *                                              samples of each category,
 *                                              plus a one-shot confirmToken
 *                                              that the cleanup endpoint
 *                                              requires. No mutations.
 *
 *   2. POST /api/admin/loads/archive-bad    — destructive. Sets status =
 *                                              'archived' on every load
 *                                              matching the bad criteria.
 *                                              Body must include the
 *                                              confirmToken from the audit
 *                                              response (must be < 5 min
 *                                              old) — protects against
 *                                              accidental fire.
 *
 * We ARCHIVE rather than DELETE so the rows are recoverable. Restoring is a
 * one-line UPDATE: `status = <prior_status>`. The cleanup also writes the
 * prior status into `override_reason` so a recovery script can read it back.
 *
 * "Bad" criteria (a load is bad if ANY of these is true):
 *   - loadNumber starts with TEST- / URL-TEST- (created by test endpoints)
 *   - brokerName contains '(TEST)' / 'TEST' marker
 *   - Both origin and destination locations are empty
 *     (no pickupAddress AND no originCity AND no destinationAddress AND
 *      no destCity → not dispatchable)
 *   - rate is 0 AND no driver assigned AND status is in
 *     {pending, dispatched, draft} → orphaned junk row
 */

import type { Express } from "express";
import crypto from "crypto";
import { db } from "../db";
import { loads } from "@shared/schema";
import { sql, and, or, eq, like, isNull, ne, inArray } from "drizzle-orm";
import { requireRole } from "../auth";

// In-memory confirmation token store. Tokens expire 5 min after issue, are
// single-use, and are tied to a snapshot of "what would be archived" so the
// archive endpoint can refuse if the data changed between audit and archive.
interface PendingConfirm {
  token: string;
  issuedAt: number;
  expectedBadIds: string[];
  issuedBy: string | null;
}
const pendingConfirms = new Map<string, PendingConfirm>();
const CONFIRM_TTL_MS = 5 * 60 * 1000;

function isBadLoad(l: any): { bad: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const loadNum = String(l.loadNumber || "").trim();
  if (/^TEST-|^URL-TEST-/i.test(loadNum)) reasons.push("test load number");

  const broker = String(l.brokerName || "").trim();
  if (/\(TEST\)|^TEST\b/i.test(broker)) reasons.push("test broker name");

  const pickupOk =
    (l.pickupAddress && String(l.pickupAddress).trim().length > 5) ||
    (l.originCity && l.originState);
  const dropOk =
    (l.deliveryAddress && String(l.deliveryAddress).trim().length > 5) ||
    (l.destCity && l.destState);
  if (!pickupOk && !dropOk) reasons.push("no pickup or delivery address");
  else if (!pickupOk) reasons.push("missing pickup location");
  else if (!dropOk) reasons.push("missing delivery location");

  const status = String(l.status || "").toLowerCase();
  const noRate = !l.rate || Number(l.rate) <= 0;
  const noDriver = !l.driverId;
  const orphanStatus = ["pending", "dispatched", "draft", "new"].includes(status);
  if (noRate && noDriver && orphanStatus) {
    reasons.push("orphan with no rate, no driver, pending status");
  }

  return { bad: reasons.length > 0, reasons };
}

function summarize(rows: any[]) {
  const buckets = {
    testLoad: 0,
    missingAddresses: 0,
    orphans: 0,
    otherBad: 0,
  };
  const badIds: string[] = [];
  const sampleBad: any[] = [];
  const sampleGood: any[] = [];

  for (const r of rows) {
    const { bad, reasons } = isBadLoad(r);
    if (bad) {
      badIds.push(r.id);
      if (reasons.some((x) => x.startsWith("test"))) buckets.testLoad++;
      else if (reasons.some((x) => /address|location/i.test(x))) buckets.missingAddresses++;
      else if (reasons.some((x) => /orphan/.test(x))) buckets.orphans++;
      else buckets.otherBad++;
      if (sampleBad.length < 10) {
        sampleBad.push({
          id: r.id,
          loadNumber: r.loadNumber,
          brokerName: r.brokerName,
          origin: r.originCity ? `${r.originCity}, ${r.originState}` : r.pickupAddress,
          destination: r.destCity ? `${r.destCity}, ${r.destState}` : r.deliveryAddress,
          rate: r.rate,
          status: r.status,
          createdAt: r.createdAt,
          reasons,
        });
      }
    } else {
      if (sampleGood.length < 10) {
        sampleGood.push({
          id: r.id,
          loadNumber: r.loadNumber,
          brokerName: r.brokerName,
          origin: r.originCity ? `${r.originCity}, ${r.originState}` : r.pickupAddress,
          destination: r.destCity ? `${r.destCity}, ${r.destState}` : r.deliveryAddress,
          rate: r.rate,
          status: r.status,
        });
      }
    }
  }

  return {
    total: rows.length,
    badCount: badIds.length,
    goodCount: rows.length - badIds.length,
    buckets,
    sampleBad,
    sampleGood,
    badIds,
  };
}

export function registerLoadsAuditRoutes(app: Express) {
  // GET /api/admin/loads/all
  // Returns every load row (lightweight projection) so the cleanup UI can
  // render a checkbox table. Each row carries the bad-flag verdict so the UI
  // can color/sort accordingly. No pagination — we cap at 1000 for sanity.
  app.get("/api/admin/loads/all", requireRole("admin"), async (_req, res) => {
    try {
      const rows = await db.select().from(loads).limit(1000);
      const list = rows.map((r: any) => {
        const verdict = isBadLoad(r);
        return {
          id: r.id,
          loadNumber: r.loadNumber,
          brokerName: r.brokerName,
          origin: r.originCity && r.originState
            ? `${r.originCity}, ${r.originState}`
            : (r.pickupAddress || ""),
          destination: r.destCity && r.destState
            ? `${r.destCity}, ${r.destState}`
            : (r.deliveryAddress || ""),
          rate: r.rate,
          status: r.status,
          driverId: r.driverId,
          createdAt: r.createdAt,
          deliveredAt: r.deliveredAt,
          bad: verdict.bad,
          reasons: verdict.reasons,
        };
      });
      res.json({ ok: true, total: list.length, loads: list });
    } catch (err: any) {
      console.error("[loads-all] failed:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/admin/loads/archive-selected
  // Body: { loadIds: string[] }
  // Archives the explicitly-selected load IDs (status = 'archived',
  // override_reason captures the prior status for recovery).
  // No confirm-token gate here — the user explicitly checked each box in
  // the UI, so accidental fire is already impossible. Returns counts.
  app.post("/api/admin/loads/archive-selected", requireRole("admin"), async (req, res) => {
    try {
      const { loadIds } = (req.body ?? {}) as { loadIds?: string[] };
      if (!Array.isArray(loadIds) || loadIds.length === 0) {
        return res.status(400).json({ ok: false, error: "loadIds (array) is required" });
      }
      if (loadIds.length > 500) {
        return res.status(400).json({ ok: false, error: "Max 500 loads per request — split into batches" });
      }

      const rows = await db.select().from(loads).where(inArray(loads.id, loadIds));
      let archived = 0;
      const errors: string[] = [];
      for (const r of rows as any[]) {
        const reason = `manually-archived (was ${r.status || "?"}${r.overrideReason ? "; " + r.overrideReason : ""})`;
        try {
          await db
            .update(loads)
            .set({
              status: "archived",
              overrideReason: reason,
              updatedAt: new Date(),
            })
            .where(eq(loads.id, r.id));
          archived++;
        } catch (err: any) {
          errors.push(`${r.id}: ${err.message}`);
        }
      }

      console.log(`[loads-archive-selected] archived ${archived}/${loadIds.length}`);
      res.json({
        ok: true,
        archived,
        requested: loadIds.length,
        notFound: loadIds.length - rows.length,
        errors,
      });
    } catch (err: any) {
      console.error("[loads-archive-selected] failed:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET — preview, no mutations
  app.get("/api/admin/loads/audit", requireRole("admin"), async (req, res) => {
    try {
      const rows = await db.select().from(loads);
      const result = summarize(rows);

      // Issue a single-use confirmation token tied to this exact set of bad IDs.
      const token = crypto.randomBytes(16).toString("hex");
      const userId = (req as any).user?.id ?? null;
      pendingConfirms.set(token, {
        token,
        issuedAt: Date.now(),
        expectedBadIds: result.badIds,
        issuedBy: userId,
      });
      // Prune expired tokens opportunistically.
      const now = Date.now();
      for (const [k, v] of Array.from(pendingConfirms.entries())) {
        if (now - v.issuedAt > CONFIRM_TTL_MS) pendingConfirms.delete(k);
      }

      res.json({
        ok: true,
        total: result.total,
        good: result.goodCount,
        bad: result.badCount,
        buckets: result.buckets,
        sampleBad: result.sampleBad,
        sampleGood: result.sampleGood,
        confirmToken: token,
        confirmExpiresAt: new Date(now + CONFIRM_TTL_MS).toISOString(),
        howToCleanup: {
          method: "POST",
          url: "/api/admin/loads/archive-bad",
          body: { confirmToken: token },
          note: "This will set status=archived on the bad rows. Reversible — original status saved in override_reason.",
        },
      });
    } catch (err: any) {
      console.error("[loads-audit] failed:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST — archive (destructive but reversible). Requires confirm token.
  app.post("/api/admin/loads/archive-bad", requireRole("admin"), async (req, res) => {
    try {
      const { confirmToken } = (req.body ?? {}) as { confirmToken?: string };
      if (!confirmToken) {
        return res.status(400).json({ ok: false, error: "confirmToken required (get from GET /api/admin/loads/audit)" });
      }
      const pending = pendingConfirms.get(confirmToken);
      if (!pending) {
        return res.status(400).json({ ok: false, error: "Invalid or expired confirmToken — run audit again" });
      }
      if (Date.now() - pending.issuedAt > CONFIRM_TTL_MS) {
        pendingConfirms.delete(confirmToken);
        return res.status(400).json({ ok: false, error: "confirmToken expired — run audit again" });
      }

      // Re-verify: pull rows again, recompute bad list, refuse if it diverged
      // significantly (e.g. someone created new loads or fixed bad ones
      // between audit and archive).
      const rows = await db.select().from(loads);
      const fresh = summarize(rows);
      const freshSet = new Set(fresh.badIds);
      const expectedSet = new Set(pending.expectedBadIds);
      const intersection = pending.expectedBadIds.filter((id) => freshSet.has(id));
      const diverged = intersection.length !== pending.expectedBadIds.length || intersection.length !== fresh.badIds.length;
      if (diverged) {
        // Allow if the diff is small (< 5 rows) — otherwise force re-audit.
        const sym =
          pending.expectedBadIds.filter((id) => !freshSet.has(id)).length +
          fresh.badIds.filter((id) => !expectedSet.has(id)).length;
        if (sym > 5) {
          return res.status(409).json({
            ok: false,
            error: `Bad-load set changed since audit (delta=${sym}). Re-run audit and try again.`,
            expectedBad: pending.expectedBadIds.length,
            currentBad: fresh.badIds.length,
          });
        }
      }

      // Single-use: invalidate the token now so a double-post can't fire twice.
      pendingConfirms.delete(confirmToken);

      // Archive — set status=archived, stash prior status in override_reason
      // so a recovery script can read it back. Use the intersection of the
      // confirmed-bad set and the still-bad set so we only touch loads that
      // were bad at audit AND are still bad now.
      const toArchive = intersection;
      if (toArchive.length === 0) {
        return res.json({ ok: true, archived: 0, note: "Nothing to archive — all bad rows were already cleaned up." });
      }

      // Pull current rows so we can capture their old status into override_reason.
      const rowsToArchive = rows.filter((r: any) => toArchive.includes(r.id));
      let archived = 0;
      for (const r of rowsToArchive) {
        const reason = `auto-archived-bad-load (was ${r.status || "?"}, ${(r as any).overrideReason ? "; " + (r as any).overrideReason : ""})`;
        try {
          await db
            .update(loads)
            .set({
              status: "archived",
              overrideReason: reason,
              updatedAt: new Date(),
            })
            .where(eq(loads.id, r.id));
          archived++;
        } catch (err: any) {
          console.error(`[loads-archive] failed to archive ${r.id}: ${err.message}`);
        }
      }

      console.log(`[loads-archive] archived ${archived} / ${toArchive.length} bad loads`);
      res.json({
        ok: true,
        archived,
        attempted: toArchive.length,
        note: "Bad loads now have status=archived. Original status preserved in override_reason. To restore: UPDATE loads SET status = ... WHERE id = ...",
      });
    } catch (err: any) {
      console.error("[loads-archive] failed:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
