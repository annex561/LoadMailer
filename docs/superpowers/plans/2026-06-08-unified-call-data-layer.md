# Unified Call-Data Layer (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest every recorded call from the LAMP Logistics Twilio line into TRAQ-IQ — transcribe it (Whisper), classify it (gpt-4o), and auto-surface AI-detected broker load offers into the existing review queue as `in_review` items that can never auto-dispatch.

**Architecture:** A new `callRecord` table is the system of record. A watermarked poller lists Twilio Recordings (no change to the working Phase 1 Studio flow), dedups on `recordingSid`, and runs each new recording through transcribe → classify → conditional-intake. A small `/calls` admin page lists everything with playback (auth-proxied), transcript, AI tag, and a manual Convert-to-Load. The whole OpenAI path is gated default-OFF behind `CALL_INTAKE_ENABLED`.

**Tech Stack:** TypeScript, Express (routes attach directly to `app`), Drizzle ORM (direct `db.insert/update`, runtime `ensure-schema.ts` DDL), OpenAI v5 (`whisper-1` + `gpt-4o`), Twilio REST (recordings), React + wouter + TanStack Query (frontend), Vitest (tests).

---

## Deviation from spec (intentional)

The spec (`docs/superpowers/specs/2026-06-08-unified-call-data-layer-design.md`) described a **Studio recording-status webhook**. This plan instead uses a **watermarked poll of the Twilio Recordings API**, because:
- It requires **zero edits to the working Phase 1 flow** (no re-publish, no regression risk to the live recorded line).
- It removes a dependency on an unverified Studio `recording_status_callback_url` widget property.
- The no-backlog-blast guarantee is preserved by `CALL_INTAKE_START_AT` (only process recordings created at/after this ISO timestamp) plus the `recordingSid` unique constraint (idempotent against re-polls).

Net behavior is identical to the spec's intent; only the trigger mechanism differs. Update the spec's "Data flow" section to match after implementation.

## Financial guard (deploy gate)

This feature adds an OpenAI paid path (Whisper ~$0.006/min + gpt-4o classify ~$0.01–0.03/call). It is **default OFF** (`CALL_INTAKE_ENABLED` unset/`false`). Building and merging the code spends nothing. **Do not set `CALL_INTAKE_ENABLED=true` in production without explicit owner approval** ("ship it"). Rollback = unset the var.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `shared/schema.ts` | Modify | Add `callRecord` table + types; add `sourceCallId` column to `rateconIntake` |
| `server/ensure-schema.ts` | Modify | Idempotent `CREATE TABLE call_record` + `ALTER ratecon_intake ADD source_call_id` |
| `server/call-intake-service.ts` | Create | Pure predicates (tested) + transcribe/classify/processRecording/poller |
| `server/voice-intake-routes.ts` | Create | `GET /api/voice/calls`, recording audio proxy, `POST /api/voice/calls/:id/convert` |
| `server/routes.ts` | Modify | Register voice routes (one line near 870) |
| `server/index.ts` | Modify | Start the poller after `ensureSchema()` |
| `server/__tests__/call-intake-never-auto-dispatch.test.ts` | Create | Regression: call intake forced `in_review` |
| `server/__tests__/call-recording-webhook-dedup.test.ts` | Create | Regression: dedup predicate |
| `server/__tests__/call-intake-guards.test.ts` | Create | `shouldTranscribe` / `withinRateCeiling` / `shouldAutoSurfaceLoadOffer` |
| `client/src/pages/calls.tsx` | Create | Calls list page |
| `client/src/App.tsx` | Modify | Lazy import + `/calls` route |
| `client/src/components/sidebar.tsx` | Modify | "Calls" nav link |

---

### Task 1: Schema — `callRecord` table + `sourceCallId`

**Files:**
- Modify: `shared/schema.ts` (add after the `rateconIntake` type exports, ~line 457)
- Modify: `shared/schema.ts` (add one column inside `rateconIntake`, near the source-tracking block ~line 419)
- Modify: `server/ensure-schema.ts` (add a `CREATE TABLE` block mirroring the `ratecon_intake` block ~line 223, and an `ALTER` for the new column)

- [ ] **Step 1: Add `sourceCallId` to the `rateconIntake` table definition**

In `shared/schema.ts`, inside `rateconIntake`, add below `sourceUploadedBy`:

```ts
  sourceCallId: varchar("source_call_id"), // FK-ish link to call_record.id when sourceType === 'call'
```

- [ ] **Step 2: Add the `callRecord` table + types** (after line 457, `InsertRateconIntake` export)

```ts
// ---- Unified call-data layer (SP1) ----
// Holds every recorded call (any source/direction). Driver calls (SP2/SP3) set companyId + driverId.
export const callRecord = pgTable("call_record", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  source: text("source").notNull(),        // 'twilio_main' | 'twilio_driver' | 'twilio_portal'
  direction: text("direction").notNull(),  // 'inbound' | 'outbound'
  driverId: varchar("driver_id"),          // nullable; set by SP2/SP3
  callSid: text("call_sid"),
  recordingSid: text("recording_sid").notNull(),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  durationSec: integer("duration_sec"),
  recordingUrl: text("recording_url"),
  legType: text("leg_type"),               // 'call' | 'voicemail'
  transcript: text("transcript"),
  transcriptStatus: text("transcript_status").notNull().default("pending"), // pending|transcribing|done|failed|skipped
  aiClassification: jsonb("ai_classification"),
  linkedIntakeId: varchar("linked_intake_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_call_record_company").on(table.companyId),
  index("idx_call_record_created").on(table.createdAt),
  index("idx_call_record_driver").on(table.driverId),
  unique("call_record_recording_sid_unique").on(table.recordingSid),
]);
export type CallRecord = typeof callRecord.$inferSelect;
export type InsertCallRecord = typeof callRecord.$inferInsert;
```

- [ ] **Step 3: Add runtime DDL in `server/ensure-schema.ts`** (after the `ratecon_intake` block, ~line 223)

```ts
    // call_record table (Unified Call-Data Layer SP1)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS call_record (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
          company_id VARCHAR,
          source TEXT NOT NULL,
          direction TEXT NOT NULL,
          driver_id VARCHAR,
          call_sid TEXT,
          recording_sid TEXT NOT NULL,
          from_number TEXT,
          to_number TEXT,
          duration_sec INTEGER,
          recording_url TEXT,
          leg_type TEXT,
          transcript TEXT,
          transcript_status TEXT NOT NULL DEFAULT 'pending',
          ai_classification JSONB,
          linked_intake_id VARCHAR,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS call_record_recording_sid_unique ON call_record(recording_sid)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_record_company ON call_record(company_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_record_created ON call_record(created_at)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_record_driver ON call_record(driver_id)`);
      await pool.query(`ALTER TABLE ratecon_intake ADD COLUMN IF NOT EXISTS source_call_id VARCHAR`);
    } catch (e: any) {
      log(`⚠️ call_record table: ${e.message}`);
    }
```

- [ ] **Step 4: Check the schema-completeness test still passes**

Run: `npx vitest run server/__tests__/schema-completeness.test.ts`
Expected: PASS. If it fails because it diffs `schema.ts` against `ensure-schema.ts`, reconcile column names/types until green.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts server/ensure-schema.ts
git commit -m "feat(call-data): add call_record table + ratecon_intake.source_call_id"
```

---

### Task 2: Pure predicates + regression tests (TDD)

**Files:**
- Create: `server/call-intake-service.ts`
- Test: `server/__tests__/call-intake-never-auto-dispatch.test.ts`
- Test: `server/__tests__/call-recording-webhook-dedup.test.ts`
- Test: `server/__tests__/call-intake-guards.test.ts`

- [ ] **Step 1: Write the failing regression test — never auto-dispatch**

`server/__tests__/call-intake-never-auto-dispatch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCallIntakeRow, shouldAutoSurfaceLoadOffer } from "../call-intake-service";

describe("call intake never auto-dispatches (regression)", () => {
  it("forces status 'in_review' even for a 0.99-confidence load offer", () => {
    const row = buildCallIntakeRow({
      companyId: "c1", callRecordId: "cr1",
      classification: { category: "load_offer", isLoadOffer: true, confidence: 0.99 },
    });
    expect(row.status).toBe("in_review");
    expect(row.sourceType).toBe("call");
    expect(row.sourceCallId).toBe("cr1");
  });

  it("never yields an auto_dispatched status at any confidence", () => {
    for (const confidence of [0, 0.5, 0.7, 0.95, 1]) {
      const row = buildCallIntakeRow({
        companyId: "c1", callRecordId: "cr1",
        classification: { category: "load_offer", isLoadOffer: true, confidence },
      });
      expect(row.status).toBe("in_review");
      expect(row.status).not.toBe("auto_dispatched");
    }
  });
});

describe("shouldAutoSurfaceLoadOffer", () => {
  it("surfaces only load offers at/above the 0.7 threshold", () => {
    expect(shouldAutoSurfaceLoadOffer({ category: "load_offer", isLoadOffer: true, confidence: 0.7 })).toBe(true);
    expect(shouldAutoSurfaceLoadOffer({ category: "load_offer", isLoadOffer: true, confidence: 0.69 })).toBe(false);
    expect(shouldAutoSurfaceLoadOffer({ category: "driver", isLoadOffer: false, confidence: 0.99 })).toBe(false);
    expect(shouldAutoSurfaceLoadOffer(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing dedup test**

`server/__tests__/call-recording-webhook-dedup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldIngestRecording } from "../call-intake-service";

describe("recording dedup (regression)", () => {
  it("ingests when no existing row for the recordingSid", () => {
    expect(shouldIngestRecording(undefined)).toBe(true);
  });
  it("skips when a row already exists (idempotent on re-poll / Twilio retry)", () => {
    expect(shouldIngestRecording({ id: "existing" })).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing guards test**

`server/__tests__/call-intake-guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldTranscribe, withinRateCeiling } from "../call-intake-service";

describe("shouldTranscribe", () => {
  it("skips when feature disabled", () => {
    expect(shouldTranscribe(30, false).transcribe).toBe(false);
  });
  it("skips zero-duration and over-cap recordings", () => {
    expect(shouldTranscribe(0, true).transcribe).toBe(false);
    expect(shouldTranscribe(99999, true, 1200).transcribe).toBe(false);
  });
  it("transcribes a normal enabled call", () => {
    expect(shouldTranscribe(45, true, 1200).transcribe).toBe(true);
  });
});

describe("withinRateCeiling", () => {
  it("allows below the ceiling and blocks at/above it", () => {
    expect(withinRateCeiling(29, 30)).toBe(true);
    expect(withinRateCeiling(30, 30)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the three test files — verify they FAIL**

Run: `npx vitest run server/__tests__/call-intake-never-auto-dispatch.test.ts server/__tests__/call-recording-webhook-dedup.test.ts server/__tests__/call-intake-guards.test.ts`
Expected: FAIL — `Cannot find module '../call-intake-service'`.

- [ ] **Step 5: Create `server/call-intake-service.ts` with the predicates + config**

```ts
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
```

- [ ] **Step 6: Run the three test files — verify they PASS**

Run: `npx vitest run server/__tests__/call-intake-never-auto-dispatch.test.ts server/__tests__/call-recording-webhook-dedup.test.ts server/__tests__/call-intake-guards.test.ts`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add server/call-intake-service.ts server/__tests__/call-intake-never-auto-dispatch.test.ts server/__tests__/call-recording-webhook-dedup.test.ts server/__tests__/call-intake-guards.test.ts
git commit -m "feat(call-data): tested predicates — dedup, auto-surface, in-review-forcing, guards"
```

---

### Task 3: Transcription + classification

**Files:**
- Modify: `server/call-intake-service.ts` (append)

- [ ] **Step 1: Add the Whisper transcriber** (append to `call-intake-service.ts`)

```ts
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
```

- [ ] **Step 2: Add the gpt-4o classifier** (append)

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json` (or `npm run check` if defined)
Expected: no new type errors in `call-intake-service.ts`. (If `File`/`fetch` are flagged, confirm `tsconfig` lib includes DOM or `@types/node` ≥ 20; the repo runs Node ≥ 20 where both are global.)

- [ ] **Step 4: Commit**

```bash
git add server/call-intake-service.ts
git commit -m "feat(call-data): Whisper transcription + gpt-4o call classifier"
```

---

### Task 4: `processRecording` orchestrator

**Files:**
- Modify: `server/call-intake-service.ts` (append)

- [ ] **Step 1: Add the orchestrator** (append)

```ts
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
  }).returning();
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
```

- [ ] **Step 2: Type-check + run the full test suite (no regressions)**

Run: `npx vitest run server/__tests__/`
Expected: all existing + new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/call-intake-service.ts
git commit -m "feat(call-data): processRecording orchestrator (dedup, guards, transcribe, classify, auto-surface)"
```

---

### Task 5: Watermarked poller

**Files:**
- Modify: `server/call-intake-service.ts` (append)
- Modify: `server/index.ts` (start the poller after `ensureSchema()`)

- [ ] **Step 1: Add the poller** (append to `call-intake-service.ts`)

```ts
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
```

- [ ] **Step 2: Start the poller from `server/index.ts`**

Find where `ensureSchema()` is awaited (lines ~176-179) and add, after route registration completes (after the `registerRoutes` await, ~line 224):

```ts
      const { startCallIntakePoller } = await import("./call-intake-service");
      startCallIntakePoller();
```

- [ ] **Step 3: Build to verify it boots clean**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/call-intake-service.ts server/index.ts
git commit -m "feat(call-data): watermarked Twilio recordings poller (default-off, CALL_INTAKE_START_AT gated)"
```

---

### Task 6: Voice routes (list, audio proxy, convert)

**Files:**
- Create: `server/voice-intake-routes.ts`
- Modify: `server/routes.ts` (import + register near line 870)

- [ ] **Step 1: Create `server/voice-intake-routes.ts`**

```ts
import type { Express } from "express";
import { db } from "./db";
import { callRecord, rateconIntake } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { buildCallIntakeRow, type CallClassification } from "./call-intake-service";

export function registerVoiceIntakeRoutes(app: Express) {
  // List recent calls for the /calls page
  app.get("/api/voice/calls", async (_req, res) => {
    try {
      const rows = await db.select().from(callRecord).orderBy(desc(callRecord.createdAt)).limit(200);
      res.json(rows);
    } catch (err: any) {
      console.error("[voice-calls]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Auth-proxied recording playback — keeps the Twilio token server-side
  app.get("/api/voice/recording/:recordingSid/audio", async (req, res) => {
    try {
      const sid = req.params.recordingSid;
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      const upstream = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!upstream.ok) return res.status(upstream.status).send("recording unavailable");
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err: any) {
      console.error("[voice-audio]", err);
      res.status(500).send("error");
    }
  });

  // Manual convert-to-load
  app.post("/api/voice/calls/:id/convert", async (req, res) => {
    try {
      const [row] = await db.select().from(callRecord).where(eq(callRecord.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      const classification = (row.aiClassification as CallClassification) ?? { category: "other", isLoadOffer: true, confidence: 1 };
      const intakeRow = buildCallIntakeRow({ companyId: row.companyId, callRecordId: row.id, classification });
      const [intake] = await db.insert(rateconIntake).values(intakeRow).returning();
      await db.update(callRecord).set({ linkedIntakeId: intake.id, updatedAt: new Date() }).where(eq(callRecord.id, row.id));
      res.json({ intakeId: intake.id });
    } catch (err: any) {
      console.error("[voice-convert]", err);
      res.status(500).json({ error: err.message });
    }
  });
}
```

- [ ] **Step 2: Register in `server/routes.ts`**

Add near the other route imports (top, ~line 52):
```ts
import { registerVoiceIntakeRoutes } from "./voice-intake-routes";
```
Add near `registerRateconIntakeRoutes(app);` (~line 870):
```ts
  registerVoiceIntakeRoutes(app);
```

- [ ] **Step 3: Build + run full test suite**

Run: `npm run build && npx vitest run server/__tests__/`
Expected: build OK, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/voice-intake-routes.ts server/routes.ts
git commit -m "feat(call-data): voice routes — list calls, audio proxy, convert-to-load"
```

---

### Task 7: Calls page + nav

**Files:**
- Create: `client/src/pages/calls.tsx`
- Modify: `client/src/App.tsx` (lazy import + route)
- Modify: `client/src/components/sidebar.tsx` (nav link)

- [ ] **Step 1: Create `client/src/pages/calls.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

type CallRow = {
  id: string; createdAt: string; fromNumber: string | null; toNumber: string | null;
  direction: string; legType: string | null; durationSec: number | null;
  recordingSid: string; transcript: string | null; transcriptStatus: string;
  aiClassification: { category?: string; isLoadOffer?: boolean; confidence?: number; summary?: string } | null;
  linkedIntakeId: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  load_offer: "bg-green-100 text-green-800", driver: "bg-blue-100 text-blue-800",
  shipper: "bg-purple-100 text-purple-800", spam: "bg-gray-200 text-gray-600",
  other: "bg-gray-100 text-gray-700",
};

export default function CallsPage() {
  const { data: calls, isLoading, refetch } = useQuery<CallRow[]>({
    queryKey: ["/api/voice/calls"], refetchInterval: 30_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  async function convert(id: string) {
    const r = await fetch(`/api/voice/calls/${id}/convert`, { method: "POST", credentials: "include" });
    if (r.ok) refetch();
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Inbound Calls</h1>
      {isLoading && <p>Loading…</p>}
      <div className="space-y-2">
        {(calls ?? []).map((c) => {
          const cat = c.aiClassification?.category ?? "—";
          const isOpen = openId === c.id;
          return (
            <div key={c.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between cursor-pointer" onClick={() => setOpenId(isOpen ? null : c.id)}>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${CATEGORY_COLORS[cat] ?? "bg-gray-100"}`}>{cat}</span>
                  <span className="font-medium">{c.fromNumber ?? "unknown"}</span>
                  <span className="text-sm text-gray-500">{c.direction} · {c.legType ?? "call"} · {c.durationSec ?? 0}s</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              {isOpen && (
                <div className="mt-3 space-y-2">
                  <audio controls className="w-full" src={`/api/voice/recording/${c.recordingSid}/audio`} />
                  {c.aiClassification?.summary && <p className="text-sm italic text-gray-700">{c.aiClassification.summary}</p>}
                  <pre className="text-sm whitespace-pre-wrap bg-gray-50 p-2 rounded max-h-60 overflow-auto">
                    {c.transcript ?? `(${c.transcriptStatus})`}
                  </pre>
                  {c.linkedIntakeId
                    ? <a className="text-blue-600 text-sm underline" href={`/review-queue?intake=${c.linkedIntakeId}`}>View linked load in review queue →</a>
                    : <button className="text-sm px-3 py-1 rounded bg-green-600 text-white" onClick={() => convert(c.id)}>Convert to Load</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `client/src/App.tsx`**

Add a lazy import near line 61:
```tsx
const CallsPage = lazy(() => import("@/pages/calls"));
```
Add a route inside the `<Switch>` near the review-queue route (~line 142):
```tsx
      <Route path="/calls" component={CallsPage} />
```

- [ ] **Step 3: Add the nav link in `client/src/components/sidebar.tsx`**

In the "Load Management" group `items` array (after the Review Queue line, ~line 41):
```tsx
      { name: "Calls", href: "/calls" },
```

- [ ] **Step 4: Build the client**

Run: `npm run build`
Expected: build succeeds; `/calls` chunk emitted.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/calls.tsx client/src/App.tsx client/src/components/sidebar.tsx
git commit -m "feat(call-data): Calls page + nav + route"
```

---

### Task 8: Integration verification + env docs

**Files:**
- Modify: `.env.example` (document the new vars)

- [ ] **Step 1: Document env vars in `.env.example`**

```bash
# --- Unified Call-Data Layer (SP1) ---
# Master switch for call transcription + classification. Default OFF. Turn on ONLY with owner approval.
CALL_INTAKE_ENABLED=false
# Only recordings created at/after this ISO timestamp are processed (prevents backlog blast on enable).
CALL_INTAKE_START_AT=
# Cost guards (optional; defaults shown)
CALL_TRANSCRIBE_MAX_SEC=1200
CALL_TRANSCRIBE_MAX_PER_HOUR=30
```

- [ ] **Step 2: Full suite + build**

Run: `npx vitest run server/__tests__/ && npm run build`
Expected: all green, build OK.

- [ ] **Step 3: Local smoke (feature OFF — proves zero spend path)**

Start the app locally (`npm run dev`), then:
Run: `curl -s localhost:5000/api/voice/calls | jq 'length'`
Expected: `0` (empty list, 200 OK). No OpenAI calls made (poller logs "not started — CALL_INTAKE_ENABLED is off").

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(call-data): document CALL_INTAKE_* env vars"
```

---

## Production enablement (SEPARATE, owner-gated — NOT part of merge)

After merge + deploy, to actually turn it on (this is the moment OpenAI spend starts — requires explicit "ship it"):
1. Set `CALL_INTAKE_START_AT` to the current ISO time in Railway (watermark — ignores all prior recordings).
2. Set `CALL_INTAKE_ENABLED=true` in Railway.
3. Place one real test call to `833-362-9813` from a different phone, talk briefly, hang up.
4. Within ~2 min, `GET /api/voice/calls` (or the `/calls` page) shows the call with a transcript + AI tag.
5. Kill switch if anything misbehaves: set `CALL_INTAKE_ENABLED=false`.

## Self-Review (completed)

- **Spec coverage:** callRecord table ✔ (T1), webhook→poll ingestion ✔ (T5, deviation noted), Whisper ✔ (T3), gpt-4o classify ✔ (T3), auto-surface in_review ✔ (T2/T4), never-auto-dispatch ✔ (T2 test), dedup ✔ (T2 test), guards/default-off/cap/ceiling ✔ (T2/T4/T5), Calls UI + playback proxy + convert ✔ (T6/T7), migrations via ensure-schema ✔ (T1), regression tests ✔ (T2). Voicemail Twilio-transcription-off: N/A under the poll approach (we never enabled per-call Twilio transcription on the dial; voicemail widget's `transcribe:true` from Phase 1 is harmless/free-ish but can be turned off later — not required for SP1 and avoids touching the working flow).
- **Placeholder scan:** none — all steps contain real code/commands.
- **Type consistency:** `CallClassification`, `buildCallIntakeRow`, `shouldIngestRecording`, `shouldAutoSurfaceLoadOffer`, `shouldTranscribe`, `withinRateCeiling`, `processRecording`, `RecordingJob`, `pollNewRecordings`, `startCallIntakePoller` names consistent across tasks and tests. `sourceCallId` added in T1 is used in T2's `buildCallIntakeRow`.
