import { db } from "./db";
import { rateconIntake, type InsertRateconIntake } from "@shared/schema";
import { parseRatecon } from "./ratecon-confidence-parser";
import { eq } from "drizzle-orm";

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
    await db
      .update(rateconIntake)
      .set({
        parsedJson: parsed as unknown as Record<string, unknown>,
        parsedAt: new Date(),
        parserModel: parsed.model,
        status: "parsed",
        updatedAt: new Date(),
      })
      .where(eq(rateconIntake.id, intakeId));
    return { ok: true as const, parsed };
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
