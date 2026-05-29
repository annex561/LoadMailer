import { db } from "./db";
import { rateconIntake, type InsertRateconIntake } from "@shared/schema";
import { parseRatecon, type ParsedRateconV2 } from "./ratecon-confidence-parser";
import { eq, and, sql } from "drizzle-orm";
import { runValidators, summarizeFailures } from "./ratecon-validators";
import { matchDriverByName } from "./driver-name-matcher";
import { drivers } from "@shared/schema";
import { v2 as cloudinary } from "cloudinary";

/**
 * Upload a PDF buffer to Cloudinary as a raw resource and return the secure URL.
 * Returns null (with a console warning) if Cloudinary is not configured or the
 * upload fails — the intake row is still created, just without a pdfPath.
 */
async function uploadRateconPdf(
  pdfBuffer: Buffer,
  loadNumberHint: string,
): Promise<string | null> {
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "traqiq/ratecons",
          public_id: `ratecon_${loadNumberHint.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`,
          resource_type: "raw",           // PDFs must use resource_type: raw
          overwrite: false,
          tags: ["traqiq", "ratecon"],
        },
        (err, result) => {
          if (err || !result) return reject(err ?? new Error("Cloudinary upload returned no result"));
          resolve(result.secure_url);
        },
      );
      stream.end(pdfBuffer);
    });
    console.log(`[ratecon-intake] PDF stored to Cloudinary: ${url}`);
    return url;
  } catch (err: any) {
    console.warn(`[ratecon-intake] PDF upload to Cloudinary failed (intake will have no pdfPath): ${err?.message}`);
    return null;
  }
}

export interface IntakeInput {
  sourceType: "email" | "upload" | "manual";
  companyId: string | null;
  pdfBuffer?: Buffer;
  rawEmailText?: string;
  sourceEmailMessageId?: string;
  sourceFilename?: string;
  sourceUploadedBy?: string;
}

export async function enqueueRatecon(input: IntakeInput) {
  // Upload the PDF to Cloudinary immediately so factoring-loves.ts can
  // retrieve it later via rateconIntake.pdfPath. Without this the PDF
  // bytes were parsed for data and then discarded — pdfPath was always
  // null and every factoring packet failed with "No Rate Confirmation PDF".
  let pdfPath: string | null = null;
  if (input.pdfBuffer && input.pdfBuffer.length > 0) {
    const hint = input.sourceFilename?.replace(/\.pdf$/i, "") ?? "unknown";
    pdfPath = await uploadRateconPdf(input.pdfBuffer, hint);
  }

  const row: InsertRateconIntake = {
    sourceType: input.sourceType,
    companyId: input.companyId,
    sourceEmailMessageId: input.sourceEmailMessageId,
    sourceFilename: input.sourceFilename,
    sourceUploadedBy: input.sourceUploadedBy,
    rawEmailText: input.rawEmailText,
    status: "pending",
    pdfPath,
  };
  const [created] = await db.insert(rateconIntake).values(row).returning();
  return created;
}

/**
 * Recursively merge two parsed-ratecon JSON blobs. Used when a broker
 * sends multiple PDFs for the same load (e.g. TQL: Rate Confirmation +
 * Driver Information Sheet) — we want to fill in fields the other PDF
 * was missing rather than create duplicate rows.
 *
 * Rules:
 *   - existing wins when both have a value (rate con typically arrives
 *     first and has the canonical broker/rate; driver sheet enriches
 *     missing details)
 *   - incoming wins when existing field is null/undefined/empty
 *   - longer string wins for shipper/consignee addresses (driver sheet
 *     usually has the full street, rate con only has city/state)
 */
function mergeParsed(existing: any, incoming: any): any {
  if (existing == null) return incoming;
  if (incoming == null) return existing;

  // Primitives — pick the better one
  if (typeof existing !== "object" || typeof incoming !== "object") {
    if (typeof existing === "string" && typeof incoming === "string") {
      // Use the longer string (typically more detailed — e.g. street address vs city only)
      return incoming.length > existing.length ? incoming : existing;
    }
    // Numbers / booleans — keep existing if both present
    return existing;
  }

  // Arrays — keep existing if non-empty, else incoming
  if (Array.isArray(existing) || Array.isArray(incoming)) {
    if (Array.isArray(existing) && existing.length > 0) return existing;
    return incoming;
  }

  // Object — recursive merge per key
  const result: Record<string, any> = {};
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const k of keys) {
    result[k] = mergeParsed(existing[k], incoming[k]);
  }
  return result;
}

/**
 * Find an existing non-rejected intake row for the same broker + load number,
 * so a second PDF (e.g. driver sheet) can merge into the first (rate con).
 */
async function findExistingIntakeForLoad(
  loadNumber: string,
  companyId: string | null,
  excludeIntakeId: string,
): Promise<{ id: string; parsedJson: any; sourceFilename: string | null } | null> {
  if (!loadNumber) return null;
  // JSONB query: find rows where parsed_json->'loadNumber'->>'value' = loadNumber
  // Companies match (or both null), and not the row we just inserted, and not rejected/merged.
  const rows = await db.execute<{
    id: string;
    parsed_json: any;
    source_filename: string | null;
  }>(sql`
    SELECT id, parsed_json, source_filename
    FROM ratecon_intake
    WHERE
      parsed_json IS NOT NULL
      AND parsed_json->'loadNumber'->>'value' = ${loadNumber}
      AND id != ${excludeIntakeId}
      AND (company_id IS NOT DISTINCT FROM ${companyId})
      AND status NOT IN ('rejected', 'merged_into_other')
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const list = (rows as any).rows ?? rows;
  if (!Array.isArray(list) || list.length === 0) return null;
  const r = list[0];
  return { id: r.id, parsedJson: r.parsed_json, sourceFilename: r.source_filename };
}

export async function parseIntake(intakeId: string, pdfBuffer: Buffer) {
  try {
    const parsed = await parseRatecon(pdfBuffer);

    // Strip rawText — has binary garbage from scanned PDFs that breaks JSONB writes.
    const { rawText: _rawText, ...parsedForDb } = parsed;

    // ---- Auto-merge by load number ----
    // If the parser extracted a load number, see if an earlier PDF for the
    // same load already exists. If yes, merge into it instead of creating
    // a duplicate review-queue row.
    let workingIntakeId = intakeId;
    let mergedFrom: string | null = null;
    let mergedParsed: any = parsedForDb;

    const loadNum = parsed.loadNumber?.value;
    if (loadNum) {
      const [thisRow] = await db
        .select({ companyId: rateconIntake.companyId, sourceFilename: rateconIntake.sourceFilename })
        .from(rateconIntake)
        .where(eq(rateconIntake.id, intakeId));
      const existing = await findExistingIntakeForLoad(
        loadNum,
        thisRow?.companyId ?? null,
        intakeId,
      );

      if (existing) {
        // Merge incoming (this PDF's parse) into existing (earlier PDF's parse)
        const merged = mergeParsed(existing.parsedJson, parsedForDb);
        mergedParsed = merged;
        workingIntakeId = existing.id;
        mergedFrom = thisRow?.sourceFilename ?? "second PDF";

        console.log(
          `[parseIntake] merging intake ${intakeId.slice(0, 8)} (${mergedFrom}) ` +
          `into existing intake ${existing.id.slice(0, 8)} (${existing.sourceFilename ?? "first PDF"}) ` +
          `for load ${loadNum}`,
        );

        // Mark this intake as merged so it disappears from the review queue
        await db
          .update(rateconIntake)
          .set({
            status: "merged_into_other",
            reviewReason: `Merged into intake ${existing.id} (load ${loadNum})`,
            updatedAt: new Date(),
          })
          .where(eq(rateconIntake.id, intakeId));
      }
    }

    // Re-run validators on the (possibly merged) parsed data
    const mergedAsParsed = mergedParsed as ParsedRateconV2;
    const validation = runValidators(mergedAsParsed);

    // Fuzzy-match driver name from the merged data
    let matchedDriverId: string | null = null;
    let matchedConfidence = 0;
    if (mergedAsParsed.driverName?.value) {
      const allDrivers = await db.select({ id: drivers.id, name: drivers.name }).from(drivers);
      const match = matchDriverByName(mergedAsParsed.driverName.value, allDrivers);
      if (match) {
        matchedDriverId = match.driverId;
        matchedConfidence = match.confidence;
      }
    }

    const hasErrors = validation.failures.some((f) => f.severity === "error");
    const hasWarnings = validation.failures.some((f) => f.severity === "warning");
    const needsDriverAssignment = !matchedDriverId || matchedConfidence < 0.85;

    let status: string;
    let reviewReason: string | null = null;
    if (hasErrors) {
      status = "in_review";
      reviewReason = `Errors: ${summarizeFailures(validation.failures.filter((f) => f.severity === "error"))}`;
    } else if (hasWarnings || needsDriverAssignment) {
      status = "in_review";
      const parts: string[] = [];
      if (hasWarnings) parts.push(summarizeFailures(validation.failures));
      if (needsDriverAssignment) parts.push("Driver needs manual assignment");
      reviewReason = parts.join(" | ");
    } else {
      status = "parsed";
    }
    if (mergedFrom) {
      reviewReason = `${reviewReason ? reviewReason + " | " : ""}Merged data from "${mergedFrom}"`;
    }

    // Update whichever row holds the merged data (the existing one if we merged,
    // otherwise the row we were called on)
    await db
      .update(rateconIntake)
      .set({
        parsedJson: mergedParsed as unknown as Record<string, unknown>,
        parsedAt: new Date(),
        parserModel: parsed.model,
        validatorFailures: validation.failures as unknown as Record<string, unknown>[],
        validatorsPassedAt: validation.passed ? new Date() : null,
        matchedDriverId,
        matchedDriverConfidence: matchedConfidence,
        status,
        reviewReason,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, workingIntakeId));

    if (status === "in_review") {
      const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
      const [intakeRow] = await db
        .select({ companyId: rateconIntake.companyId })
        .from(rateconIntake)
        .where(eq(rateconIntake.id, workingIntakeId));
      notifyAdminReviewNeeded({
        companyId: intakeRow?.companyId ?? null,
        intakeId: workingIntakeId,
        broker: mergedAsParsed.broker?.value ?? "Unknown",
        reason: reviewReason ?? "unknown",
      }).catch((e) => console.error("[parseIntake] alert failed:", e.message));
    }

    if (status === "parsed") {
      const { dispatchFromIntake, sendDispatchSms } = await import("./ratecon-dispatch-service");
      const outcome = await dispatchFromIntake(workingIntakeId);
      if (outcome.ok && outcome.loadId) {
        await sendDispatchSms(outcome.loadId);
        await db
          .update(rateconIntake)
          .set({ status: "auto_dispatched", updatedAt: new Date() })
          .where(eq(rateconIntake.id, workingIntakeId));
      } else {
        await db
          .update(rateconIntake)
          .set({
            status: "in_review",
            reviewReason: `Auto-dispatch failed: ${outcome.error}`,
            updatedAt: new Date(),
          })
          .where(eq(rateconIntake.id, workingIntakeId));
      }
    }

    return { ok: true as const, parsed: mergedAsParsed, status, validation, mergedInto: mergedFrom ? workingIntakeId : null };
  } catch (err: any) {
    await db
      .update(rateconIntake)
      .set({
        parseError: err.message,
        status: "in_review",
        reviewReason: `Parser error: ${err.message}`,
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
    return { ok: false as const, error: err.message };
  }
}
