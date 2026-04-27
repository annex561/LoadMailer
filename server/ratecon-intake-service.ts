import { db } from "./db";
import { rateconIntake, type InsertRateconIntake } from "@shared/schema";
import { parseRatecon } from "./ratecon-confidence-parser";
import { eq } from "drizzle-orm";
import { runValidators, summarizeFailures } from "./ratecon-validators";
import { matchDriverByName } from "./driver-name-matcher";
import { drivers } from "@shared/schema";

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
  const row: InsertRateconIntake = {
    sourceType: input.sourceType,
    companyId: input.companyId,
    sourceEmailMessageId: input.sourceEmailMessageId,
    sourceFilename: input.sourceFilename,
    sourceUploadedBy: input.sourceUploadedBy,
    rawEmailText: input.rawEmailText,
    status: "pending",
  };
  const [created] = await db.insert(rateconIntake).values(row).returning();
  return created;
}

export async function parseIntake(intakeId: string, pdfBuffer: Buffer) {
  try {
    const parsed = await parseRatecon(pdfBuffer);

    // Run validators
    const validation = runValidators(parsed);

    // Fuzzy-match driver name if present
    let matchedDriverId: string | null = null;
    let matchedConfidence = 0;
    if (parsed.driverName.value) {
      const allDrivers = await db.select({ id: drivers.id, name: drivers.name }).from(drivers);
      const match = matchDriverByName(parsed.driverName.value, allDrivers);
      if (match) {
        matchedDriverId = match.driverId;
        matchedConfidence = match.confidence;
      }
    }

    // Decide status
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
      status = "parsed"; // ready for auto-dispatch (Milestone 4 picks this up)
    }

    // Strip rawText before persisting — it can contain non-UTF8 control chars
    // from scanned/corrupt PDFs that break Postgres JSONB writes. The parser
    // returns it for in-memory diagnostics only.
    const { rawText: _rawText, ...parsedForDb } = parsed;

    await db
      .update(rateconIntake)
      .set({
        parsedJson: parsedForDb as unknown as Record<string, unknown>,
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
      .where(eq(rateconIntake.id, intakeId));

    if (status === "in_review") {
      const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
      const [intakeRow] = await db
        .select({ companyId: rateconIntake.companyId })
        .from(rateconIntake)
        .where(eq(rateconIntake.id, intakeId));
      notifyAdminReviewNeeded({
        companyId: intakeRow?.companyId ?? null,
        intakeId,
        broker: parsed.broker.value,
        reason: reviewReason ?? "unknown",
      }).catch((e) => console.error("[parseIntake] alert failed:", e.message));
    }

    if (status === "parsed") {
      const { dispatchFromIntake, sendDispatchSms } = await import("./ratecon-dispatch-service");
      const outcome = await dispatchFromIntake(intakeId);
      if (outcome.ok && outcome.loadId) {
        await sendDispatchSms(outcome.loadId);
        await db
          .update(rateconIntake)
          .set({ status: "auto_dispatched", updatedAt: new Date() })
          .where(eq(rateconIntake.id, intakeId));
      } else {
        // fallback: bump to review
        await db
          .update(rateconIntake)
          .set({
            status: "in_review",
            reviewReason: `Auto-dispatch failed: ${outcome.error}`,
            updatedAt: new Date(),
          })
          .where(eq(rateconIntake.id, intakeId));
      }
    }

    return { ok: true as const, parsed, status, validation };
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
