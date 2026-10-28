import { db } from "./db";
import { rateconIntake, type InsertRateconIntake } from "@shared/schema";
import { parseRatecon, type ParsedRateconV2, extractPdfText } from "./ratecon-confidence-parser";
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

/**
 * Map the legacy regex-extractor output (ParsedRateConData) to ParsedRateconV2.
 * All confidences are capped at 0.5 so the row always goes to in_review and
 * never auto-dispatches. Tagged parserModel: "regex-fallback".
 * Behind RATECON_REGEX_FALLBACK_ENABLED (default OFF).
 */
function mapRegexToV2(data: import("./services/ratecon-parser").ParsedRateConData): ParsedRateconV2 {
  const LOW = 0.3 as const;
  // "Atlanta, GA" → ["Atlanta", "GA"]
  const splitCityState = (s: string): [string, string] => {
    const parts = s.split(",").map((p) => p.trim());
    return [parts[0] ?? "", parts[1] ?? ""];
  };
  const [originCity, originState] = splitCityState(data.origin ?? "");
  const [destCity, destState] = splitCityState(data.destination ?? "");
  return {
    broker: { value: data.brokerName ?? "", confidence: LOW },
    loadNumber: { value: data.loadNumber ?? "", confidence: LOW },
    rate: { value: data.rate ?? 0, confidence: LOW },
    equipmentType: { value: "dry_van", confidence: LOW },
    weightLbs: { value: data.weight || null, confidence: LOW },
    miles: { value: data.miles ?? null, confidence: LOW },
    pickup: {
      city: originCity,
      state: originState,
      date: data.pickupDate ?? "",
      time: data.pickupTime ?? "00:00",
      confidence: LOW,
    },
    drop: {
      city: destCity,
      state: destState,
      date: data.deliveryDate ?? "",
      time: data.deliveryTime ?? "00:00",
      confidence: LOW,
    },
    driverName: { value: null, confidence: LOW },
    commodity: { value: null, confidence: LOW },
    specialInstructions: { value: data.notes ?? null, confidence: LOW },
    detentionFreeMinutes: { value: null, confidence: LOW },
    detentionRatePerHour: { value: null, confidence: LOW },
    model: "regex-fallback",
  };
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
 * True when this Gmail attachment already has an intake row. The Gmail scan
 * query includes read mail (newer_than:2d) and its only other dedup is an
 * in-memory 24h map that every deploy wipes, so without this check each PDF
 * was enqueued, uploaded and sent to OpenAI 2-10 times (1,513 rows for 402
 * attachments by 2026-10-24).
 */
export async function hasIntakeForEmailAttachment(messageId: string, filename: string): Promise<boolean> {
  const [row] = await db
    .select({ id: rateconIntake.id })
    .from(rateconIntake)
    .where(and(eq(rateconIntake.sourceEmailMessageId, messageId), eq(rateconIntake.sourceFilename, filename)))
    .limit(1);
  return !!row;
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

// autoDispatch=false stops a clean parse at in_review instead of creating the
// load and texting the driver. The credit-outage backfill uses it: those
// RateCons are weeks old and the freight has already moved.
export async function parseIntake(intakeId: string, pdfBuffer: Buffer, opts: { autoDispatch?: boolean } = {}) {
  const autoDispatch = opts.autoDispatch !== false;
  try {
    let parsed: ParsedRateconV2;
    try {
      parsed = await parseRatecon(pdfBuffer);
    } catch (openAiErr: any) {
      // RATECON_REGEX_FALLBACK_ENABLED=true: use the local regex extractor when
      // OpenAI is unavailable (credit outage, network error). All confidences ≤0.5,
      // always in_review, never auto-dispatches. Default OFF.
      if (process.env.RATECON_REGEX_FALLBACK_ENABLED !== "true") throw openAiErr;
      console.warn(`[parseIntake] OpenAI failed (${openAiErr.message}), trying regex fallback`);
      const pdfText = await extractPdfText(pdfBuffer);
      const { rateconParser } = await import("./services/ratecon-parser");
      const regexData = rateconParser.regexExtract(pdfText);
      parsed = mapRegexToV2(regexData);
    }

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

    // Re-run validators on the (possibly merged) parsed data.
    // Pass the intake's created_at so a backfilled row whose pickup was valid at
    // email-arrival but is now past the wall clock gets a warning, not an error.
    const mergedAsParsed = mergedParsed as ParsedRateconV2;
    const [intakeRow] = await db
      .select({ createdAt: rateconIntake.createdAt })
      .from(rateconIntake)
      .where(eq(rateconIntake.id, workingIntakeId));
    const validation = runValidators(mergedAsParsed, {
      intakeCreatedAt: intakeRow?.createdAt ?? undefined,
    });

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
    } else if (!autoDispatch) {
      status = "in_review";
      reviewReason = "Backfill re-parse: auto-dispatch off, review before dispatching";
    } else if (mergedAsParsed.model === "regex-fallback") {
      // Regex fallback never auto-dispatches — data quality is too low (all confidence ≤0.5)
      status = "in_review";
      reviewReason = "Regex fallback parse — verify all fields before dispatching";
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
        parseError: null,
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
