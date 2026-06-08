import { db } from "./db";
import { callRecord, rateconIntake } from "@shared/schema";
import type { InsertRateconIntake } from "@shared/schema";
import { and, eq, gt } from "drizzle-orm";
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
//
// parsedJson is written in the SAME ParsedRateconV2 wrapper shape the rest of
// the intake pipeline expects (dispatchFromIntake, the /review-queue UI), so a
// dispatcher can review/edit a call-sourced intake with the exact same fields
// as an email/upload one. Scalars become { value, confidence }; pickup/drop
// become { city, state, address?, date, time, confidence }. The classification
// confidence is reused for each field (a phone transcript has one overall
// confidence, not per-field). Values are null when the classification field is
// null. See server/ratecon-confidence-parser.ts for the interface.
export function buildCallIntakeRow(args: { companyId: string | null; callRecordId: string; classification: CallClassification }): InsertRateconIntake {
  const c = args.classification;
  const conf = typeof c.confidence === "number" ? c.confidence : 0;
  const loc = (l: any) => ({
    city: l?.city ?? null,
    state: l?.state ?? null,
    address: l?.address ?? null,
    date: l?.date ?? null,
    time: l?.time ?? null,
    confidence: conf,
  });
  return {
    companyId: args.companyId,
    sourceType: "call",
    sourceCallId: args.callRecordId,
    parsedJson: {
      broker: { value: c.broker ?? null, confidence: conf },
      mc: { value: c.mc ?? null, confidence: conf },
      rate: { value: c.rate ?? null, confidence: conf },
      lane: { value: c.lane ?? null, confidence: conf },
      commodity: { value: c.commodity ?? null, confidence: conf },
      summary: { value: c.summary ?? null, confidence: conf },
      pickup: loc(c.pickup),
      drop: loc(c.drop),
      _source: "inbound_call",
    },
    parserModel: "gpt-4o",
    parsedAt: new Date(),
    status: "in_review",
    reviewReason: "inbound call — AI-detected load offer",
  };
}

function twilioBasicAuthHeader(): string {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  return `Basic ${auth}`;
}

// recordingUrl is the Twilio media base URL (no extension). Fetch the mp3 with Basic auth and send to Whisper.
export async function transcribeRecordingAudio(recordingUrl: string): Promise<string> {
  const resp = await fetch(`${recordingUrl}.mp3`, { headers: { Authorization: twilioBasicAuthHeader() } });
  if (!resp.ok) throw new Error(`fetch recording failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const file = new File([buf], "recording.mp3", { type: "audio/mpeg" });
  const tr = await openai.audio.transcriptions.create({ model: "whisper-1", file });
  return tr.text;
}

const CALL_CLASSIFY_SYSTEM = `You are an assistant for a trucking carrier (LAMP Logistics). You receive a transcript of a phone call to the company line. Classify the call and, if a freight broker or shipper is offering a specific load to haul, extract the load details. Respond as STRICT JSON with these keys:
category: one of "load_offer","driver","shipper","spam","other"
isLoadOffer: boolean (true ONLY if someone is offering a specific load to haul)
confidence: number 0..1 (your confidence in isLoadOffer)
broker: string or null
mc: string or null (MC/DOT number if stated)
rate: number (USD) or null
lane: string like "Atlanta, GA -> Dallas, TX" or null
commodity: string or null
pickup: {city,state,date,time} or null
drop: {city,state,date,time} or null
summary: one sentence
Use null for anything not clearly stated. Do not invent values.`;

export async function classifyTranscript(transcript: string): Promise<CallClassification> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: CALL_CLASSIFY_SYSTEM },
      { role: "user", content: `--- CALL TRANSCRIPT ---\n${transcript}\n--- END TRANSCRIPT ---` },
    ],
    response_format: { type: "json_object" },
  });
  const content = resp.choices[0]?.message?.content;
  if (!content) throw new Error("classifier returned empty response");
  return JSON.parse(content) as CallClassification;
}

export interface RecordingJob {
  recordingSid: string;
  recordingUrl: string;   // Twilio media base URL (no extension)
  callSid: string;
  durationSec: number;
  legType: "call" | "voicemail";
  source?: string;        // default 'twilio_main'
  direction?: "inbound" | "outbound";
  companyId?: string | null;
  driverId?: string | null;
}

async function resolveCallParties(callSid: string): Promise<{ from: string | null; to: string | null }> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
    const r = await fetch(url, { headers: { Authorization: twilioBasicAuthHeader() } });
    if (!r.ok) return { from: null, to: null };
    const j: any = await r.json();
    return { from: j.from ?? null, to: j.to ?? null };
  } catch { return { from: null, to: null }; }
}

export async function processRecording(job: RecordingJob): Promise<void> {
  const enabled = isCallIntakeEnabled();

  // Dedup on recordingSid (idempotent against re-poll / retries)
  const existingRows = await db.select({ id: callRecord.id }).from(callRecord)
    .where(eq(callRecord.recordingSid, job.recordingSid)).limit(1);
  if (!shouldIngestRecording(existingRows[0])) {
    console.log(`[call-intake] dedup-hit ${job.recordingSid}`);
    return;
  }

  const { from, to } = await resolveCallParties(job.callSid);

  const [row] = await db.insert(callRecord).values({
    companyId: job.companyId ?? null,
    source: job.source ?? "twilio_main",
    direction: job.direction ?? "inbound",
    driverId: job.driverId ?? null,
    callSid: job.callSid,
    recordingSid: job.recordingSid,
    fromNumber: from,
    toNumber: to,
    durationSec: job.durationSec,
    recordingUrl: job.recordingUrl,
    legType: job.legType,
    transcriptStatus: enabled ? "transcribing" : "skipped",
  }).onConflictDoNothing().returning();
  // A concurrent worker won the unique-recordingSid race between our dedup
  // check above and this insert — onConflictDoNothing returns no row. Bail
  // so we never double-process (double-transcribe / double-intake) the call.
  if (!row) {
    console.log(`[call-intake] insert-conflict (already ingested) ${job.recordingSid}`);
    return;
  }
  console.log(`[call-intake] ingested rec=${job.recordingSid} call=${job.callSid} enabled=${enabled}`);

  const decision = shouldTranscribe(job.durationSec, enabled);
  if (!decision.transcribe) {
    console.log(`[call-intake] skip-transcribe ${job.recordingSid} reason=${decision.reason}`);
    await db.update(callRecord).set({ transcriptStatus: "skipped", updatedAt: new Date() }).where(eq(callRecord.id, row.id));
    return;
  }

  // Rate ceiling: count rows transcribed in the last hour
  const since = new Date(Date.now() - 3_600_000);
  const recent = await db.select({ id: callRecord.id }).from(callRecord)
    .where(and(eq(callRecord.transcriptStatus, "done"), gt(callRecord.updatedAt, since)));
  if (!withinRateCeiling(recent.length)) {
    console.log(`[call-intake] rate-limited ${job.recordingSid} (${recent.length}/${CALL_TRANSCRIBE_MAX_PER_HOUR} last hr)`);
    await db.update(callRecord).set({ transcriptStatus: "failed", updatedAt: new Date() }).where(eq(callRecord.id, row.id));
    return;
  }

  try {
    const transcript = await transcribeRecordingAudio(job.recordingUrl);
    const classification = await classifyTranscript(transcript);
    await db.update(callRecord).set({
      transcript, aiClassification: classification as any, transcriptStatus: "done", updatedAt: new Date(),
    }).where(eq(callRecord.id, row.id));
    console.log(`[call-intake] classified ${job.recordingSid} category=${classification.category} conf=${classification.confidence}`);

    if (shouldAutoSurfaceLoadOffer(classification)) {
      const intakeRow = buildCallIntakeRow({ companyId: row.companyId, callRecordId: row.id, classification });
      const [intake] = await db.insert(rateconIntake).values(intakeRow).returning();
      await db.update(callRecord).set({ linkedIntakeId: intake.id, updatedAt: new Date() }).where(eq(callRecord.id, row.id));
      console.log(`[call-intake] intake-created ${intake.id} from ${job.recordingSid}`);
    }
  } catch (e: any) {
    console.error(`[call-intake] processing failed ${job.recordingSid}: ${e.message}`);
    await db.update(callRecord).set({ transcriptStatus: "failed", updatedAt: new Date() }).where(eq(callRecord.id, row.id));
  }
}

// Poll Twilio for new recordings created at/after CALL_INTAKE_START_AT. Watermark + dedup prevent backlog blast.
export async function pollNewRecordings(): Promise<void> {
  if (!isCallIntakeEnabled()) return;
  const startAt = process.env.CALL_INTAKE_START_AT; // ISO8601; recordings before this are ignored
  if (!startAt) { console.log("[call-intake] poll skipped — CALL_INTAKE_START_AT unset"); return; }
  const startMs = Date.parse(startAt);
  if (Number.isNaN(startMs)) { console.log("[call-intake] poll skipped — CALL_INTAKE_START_AT not a valid date"); return; }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings.json?PageSize=20`;
    const r = await fetch(url, { headers: { Authorization: twilioBasicAuthHeader() } });
    if (!r.ok) { console.error(`[call-intake] poll list failed: ${r.status}`); return; }
    const j: any = await r.json();
    const recs: any[] = j.recordings ?? [];
    for (const rec of recs) {
      // Per-recording try/catch so one bad recording (transcription error,
      // malformed Twilio row, transient DB hiccup) can't abort the whole batch
      // and strand every newer recording behind it.
      try {
        const created = Date.parse(rec.date_created);
        if (Number.isNaN(created) || created < startMs) continue;       // before watermark → ignore
        const base = `https://api.twilio.com${rec.uri.replace(/\.json$/, "")}`; // media base (no extension)
        await processRecording({
          recordingSid: rec.sid,
          recordingUrl: base,
          callSid: rec.call_sid,
          durationSec: Number(rec.duration) || 0,
          legType: rec.source === "RecordVerb" ? "voicemail" : "call",
        });
      } catch (e: any) {
        console.error(`[call-intake] recording failed ${rec.sid}: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.error(`[call-intake] poll error: ${e.message}`);
  }
}

let _pollTimer: NodeJS.Timeout | null = null;
export function startCallIntakePoller(): void {
  if (_pollTimer) return;
  if (!isCallIntakeEnabled()) { console.log("[call-intake] poller not started — CALL_INTAKE_ENABLED is off"); return; }
  console.log("[call-intake] poller started (every 120s)");
  _pollTimer = setInterval(() => { pollNewRecordings().catch(() => {}); }, 120_000);
}
