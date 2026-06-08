import { db } from "./db";
import { callRecord, rateconIntake } from "@shared/schema";
import type { InsertRateconIntake } from "@shared/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "not-configured" });

export const CALL_LOAD_OFFER_THRESHOLD = 0.7;
export const CALL_TRANSCRIBE_MAX_SEC = Number(process.env.CALL_TRANSCRIBE_MAX_SEC) || 1200;
export const CALL_TRANSCRIBE_MAX_PER_HOUR = Number(process.env.CALL_TRANSCRIBE_MAX_PER_HOUR) || 30;

export interface CallClassification {
  category: "load_offer" | "driver" | "shipper" | "spam" | "other";
  isLoadOffer: boolean;
  confidence: number;
  broker?: string | null; mc?: string | null; rate?: number | null; lane?: string | null;
  commodity?: string | null; pickup?: any; drop?: any; summary?: string | null;
}

export function isCallIntakeEnabled(): boolean {
  return process.env.CALL_INTAKE_ENABLED === "true";
}

// dedup predicate — true means "this recording is new, ingest it". (regression: call-recording-webhook-dedup.test.ts)
export function shouldIngestRecording(existing: { id: string } | null | undefined): boolean {
  return existing === undefined || existing === null;
}

export function shouldAutoSurfaceLoadOffer(c: CallClassification | null | undefined, threshold = CALL_LOAD_OFFER_THRESHOLD): boolean {
  if (!c) return false;
  return c.isLoadOffer === true && typeof c.confidence === "number" && c.confidence >= threshold;
}

export function shouldTranscribe(durationSec: number | null | undefined, enabled: boolean, maxSec = CALL_TRANSCRIBE_MAX_SEC): { transcribe: boolean; reason: string } {
  if (!enabled) return { transcribe: false, reason: "disabled" };
  const d = durationSec ?? 0;
  if (d <= 0) return { transcribe: false, reason: "zero-duration" };
  if (d > maxSec) return { transcribe: false, reason: "over-duration-cap" };
  return { transcribe: true, reason: "ok" };
}

export function withinRateCeiling(countLastHour: number, max = CALL_TRANSCRIBE_MAX_PER_HOUR): boolean {
  return countLastHour < max;
}

// Build a ratecon_intake row from a call. status is HARD-CODED 'in_review' — a call can NEVER auto-dispatch.
// (regression: call-intake-never-auto-dispatch.test.ts — do not change without updating that test)
export function buildCallIntakeRow(args: { companyId: string | null; callRecordId: string; classification: CallClassification }): InsertRateconIntake {
  const c = args.classification;
  return {
    companyId: args.companyId,
    sourceType: "call",
    sourceCallId: args.callRecordId,
    parsedJson: {
      broker: c.broker ?? null, mc: c.mc ?? null, rate: c.rate ?? null,
      lane: c.lane ?? null, commodity: c.commodity ?? null,
      pickup: c.pickup ?? null, drop: c.drop ?? null, summary: c.summary ?? null,
      _source: "inbound_call",
    },
    parserModel: "gpt-4o",
    parsedAt: new Date(),
    status: "in_review",
    reviewReason: "inbound call — AI-detected load offer",
  };
}
