# Unified Call-Data Layer (SP1) — Design

**Date:** 2026-06-08
**Status:** Draft for review
**Owner:** AL
**Project:** LAMP Logistics phone system → TRAQ-IQ

## Why

LAMP Logistics is moving from an unrecorded personal cell to a company phone system on Twilio. Phase 1 (DONE) stood up a recorded main inbound line (toll-free `+1 833-362-9813` → Studio Flow `FW60dbb0bed6eee003fbb3b10db1c8dd36` → records + forwards to owner cell + voicemail). This spec covers **SP1: the unified call-data layer** that ingests every recorded call into TRAQ-IQ, transcribes and classifies it, and auto-surfaces broker load offers into the existing review queue.

SP1 is the foundation that two later sub-projects plug into:
- **SP2** — per-driver inbound recorded Twilio numbers (record + forward-to-cell), feeding SP1 tagged by driver.
- **SP3** — in-portal Twilio Voice outbound dialer for drivers (recorded outbound), feeding SP1.

SP1 must therefore model **source**, **direction**, and **driver** from day one, even though only the main inbound line produces data initially.

## Scope

**In scope (SP1):**
- A `callRecord` table holding every call (any source, any direction).
- A Twilio recording-status webhook (`POST /api/voice/recording`) that ingests recordings as they complete.
- Transcription of every recording via OpenAI Whisper.
- Classification of every transcript via gpt-4o (category + structured load fields).
- Auto-surfacing AI-detected load offers into the existing `rateconIntake` review queue (forced `in_review`, never auto-dispatched).
- A "Calls" admin page listing all calls with playback, transcript, AI tag, and a manual "Convert to Load".
- An auth-proxied recording playback endpoint (Twilio token stays server-side).
- Financial safety guards and a regression test.

**Out of scope (later sub-projects / not now):**
- Per-driver number provisioning (SP2).
- Outbound WebRTC dialer in the driver portal (SP3).
- OpenPhone or any third-party carrier ingestion (not chosen — building owned stack).
- Real-time / live-call transcription.
- Editing or re-running classification from the UI (v2).

## Decisions (locked)

- **Hybrid model:** log every call AND auto-create a review-queue intake only when AI confidence ≥ 0.7 that it's a load offer.
- **Transcribe every call** (answered conversations + voicemails), not just voicemails.
- **Whisper** for transcription (reuses existing OpenAI key, ~$0.006/min), **gpt-4o** for classification (reuses existing parser pattern).
- **Calls can never auto-dispatch.** A call-sourced intake is always `in_review`. The Twilio SMS dispatch path is untouched.
- **Isolation:** voice call logic is additive — new table, new routes, new page. No edits to existing RateCon parse/validate/dispatch logic or the SMS webhook.
- Feature is **default OFF** behind `CALL_INTAKE_ENABLED`.

## Architecture

### Components
1. **`callRecord` table** (`shared/schema.ts`) — system of record for all calls.
2. **Recording webhook** `POST /api/voice/recording` (`server/voice-intake-routes.ts`, new file) — Twilio-signature-validated, dedup on `recordingSid`, enqueues processing.
3. **Call-processing service** (`server/call-intake-service.ts`, new file) — fetch audio → Whisper → gpt-4o classify → persist → conditionally create intake. Mirrors the fire-and-forget pattern of `ratecon-intake-service.ts`.
4. **Recording proxy** `GET /api/voice/recording/:recordingSid/audio` — streams Twilio media to an authenticated operator (server-side Twilio Basic auth).
5. **Calls UI** `/calls` page (`client/src/pages/calls.tsx`) + sidebar link + row component.
6. **Studio flow update** — add `recording_status_callback_url` to the dial + voicemail widgets in Flow `FW60dbb0…` so Twilio POSTs recordings to the webhook, and set the voicemail widget's `transcribe` to `false` so Twilio's built-in transcription doesn't double-bill against Whisper (Whisper is the single transcript source). (Twilio config change, re-publish; not app code.)

### Data flow
```
Caller → Twilio Studio Flow (records call/voicemail)
      → recording completes → Twilio POSTs recording-status callback
      → POST /api/voice/recording (validate signature; dedup on RecordingSid)
      → insert callRecord {status: 'transcribing'}
      → [async] fetch parent call details (From/To/duration via Calls API)
      → [async] download recording audio (server-side Twilio auth)
      → [async] Whisper transcript → update callRecord
      → [async] gpt-4o classify → update callRecord.aiClassification
      → if isLoadOffer && confidence ≥ 0.7:
            create rateconIntake {sourceType:'call', sourceCallId, status:'in_review'}
            link callRecord.linkedIntakeId
      → appears in /calls (all calls) and /review-queue (load offers only)
```

### Why callbacks, not polling
Recording-status callbacks fire only for **future** recordings, so enabling the feature cannot blast a backlog of historical recordings (the failure mode of PR #62). Dedup on `recordingSid` makes Twilio's callback retries idempotent. No backlog-scan job exists by design.

## Data Model

New table `callRecord`:

| Column | Type | Notes |
|---|---|---|
| `id` | varchar PK | `gen_random_uuid()` |
| `companyId` | varchar FK→companies | |
| `source` | text NOT NULL | `'twilio_main'` \| `'twilio_driver'` (SP2) \| `'twilio_portal'` (SP3) |
| `direction` | text NOT NULL | `'inbound'` \| `'outbound'` |
| `driverId` | varchar FK→drivers NULL | null for main line; set by SP2/SP3 |
| `callSid` | text | indexed |
| `recordingSid` | text UNIQUE NOT NULL | dedup key |
| `fromNumber` | text | original caller (resolved via Calls API) |
| `toNumber` | text | |
| `durationSec` | integer | |
| `recordingUrl` | text | Twilio media URL (fetched via proxy, never exposed raw) |
| `legType` | text | `'call'` \| `'voicemail'` |
| `transcript` | text | |
| `transcriptStatus` | text NOT NULL DEFAULT `'pending'` | `pending`\|`transcribing`\|`done`\|`failed`\|`skipped` |
| `aiClassification` | jsonb | see below |
| `linkedIntakeId` | varchar FK→ratecon_intake NULL | set if auto-surfaced/converted |
| `createdAt` | timestamp DEFAULT now | |
| `updatedAt` | timestamp DEFAULT now | |

Indexes: `recordingSid` (unique), `companyId`, `createdAt`, `driverId`.

`aiClassification` shape:
```json
{
  "category": "load_offer | driver | shipper | spam | other",
  "isLoadOffer": true,
  "confidence": 0.0,
  "broker": "...", "mc": "...", "rate": 0, "lane": "ORIG → DEST",
  "commodity": "...", "pickup": {...}, "drop": {...},
  "summary": "one-line gist"
}
```

`rateconIntake` change: `sourceType` already free text → use `'call'`. Add nullable `sourceCallId` column (idempotent ALTER via `ensureSchema()`), linking back to `callRecord.id`.

## Transcription & Classification

- **Whisper** (`whisper-1`): download recording (≤ duration cap), send audio, store transcript. Skip (status `skipped`) if `durationSec > 1200` (20 min) — recording still stored, just not transcribed (cost cap).
- **gpt-4o classify**: reuse the confidence-parser system-prompt approach (`ratecon-confidence-parser.ts`), adapted for conversational transcript input. Returns the `aiClassification` object. Free-text in, structured JSON out.

## Auto-surface logic

```
if aiClassification.isLoadOffer && aiClassification.confidence >= 0.7:
    create rateconIntake {
      companyId, sourceType: 'call', sourceCallId: callRecord.id,
      parsedJson: <mapped from aiClassification>, parserModel: 'gpt-4o',
      status: 'in_review',                 // HARD-CODED. never auto_dispatched.
      reviewReason: 'inbound call — AI-detected load offer'
    }
    callRecord.linkedIntakeId = intake.id
```
Threshold `0.7` is a config constant (`CALL_LOAD_OFFER_THRESHOLD`, default 0.7).

## UI — `/calls`

- Sidebar nav: **"Calls"**.
- List (auto-refresh 30s, matching review-queue): columns = time, caller (`fromNumber`), driver (if any), direction, legType, duration, AI tag badge (Load Offer / Driver / Shipper / Spam / Other), transcript-status.
- Row expand: full transcript + AI summary + audio player (`<audio src="/api/voice/recording/:sid/audio">`).
- Actions: **Convert to Load** (manual, for calls AI didn't auto-surface) → creates the same `rateconIntake` as auto-surface; link to the created intake if one exists.
- Filters: source, direction, driver, AI category.

## Financial guards (approval-gated path)

New paid path = **OpenAI only** (Whisper + gpt-4o). Twilio recording cost was approved in Phase 1; no new Twilio outbound here.

- `CALL_INTAKE_ENABLED` (default **OFF**) — when off, webhook returns 200 and logs receipt but does no transcription/classification/OpenAI spend.
- **Dedup** on `recordingSid` — idempotent against Twilio retries.
- **Duration cap** — skip transcription for recordings > 20 min (`CALL_TRANSCRIBE_MAX_SEC=1200`); recording still logged.
- **Hard rate ceiling** — max 30 transcriptions/hour (`CALL_TRANSCRIBE_MAX_PER_HOUR=30`); over ceiling → log + defer/skip.
- **Visibility** — log every decision (`ingested`/`dedup-hit`/`transcribe`/`skip-duration`/`skip-disabled`/`rate-limited`/`classified`/`intake-created`) so a runaway is visible in <60s.
- **No auto-dispatch** — call-sourced intakes are always `in_review`.
- **Rollback** — `CALL_INTAKE_ENABLED=false` (instant) + revert the Studio flow revision (removes the callback).

Worst-case spend reasoning: callback fires once per recording; dedup prevents reprocessing; ceiling caps to 30/hr. A pathological hour = 30 × (~$0.006/min × avg mins + ~$0.02 classify) ≈ a few dollars, not a runaway.

## No-regression / Testing

Critical-workflow touch = the intake → review → dispatch pipeline. Per project rule, ship regression tests in `server/__tests__/`:

1. **`call-intake-never-auto-dispatch.test.ts`** — asserts a `sourceType:'call'` intake is created with `status:'in_review'` and the auto-dispatch predicate excludes call-sourced intakes. Fails if someone lets a call auto-dispatch.
2. **`call-recording-webhook-dedup.test.ts`** — asserts a second callback with the same `recordingSid` is a no-op (no duplicate row, no second transcription).
3. **Smoke** — `POST /api/voice/recording` with a valid signature returns 200 and creates one `callRecord`.

A 1-line comment in the dedup + the in-review-forcing code points at these tests.

## Migrations

- Add `callRecord` to `shared/schema.ts`; generate Drizzle migration.
- Add `sourceCallId` (nullable) to `ratecon_intake` via `ensureSchema()` idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Both safe to run on deploy; existing data loads unchanged.

## Open questions (resolved)

- *New entity vs reuse intake?* → New `callRecord` (calls aren't RateCons), with conditional link into `rateconIntake`. ✔
- *Transcribe all or voicemail-only?* → All. ✔
- *Auto-dispatch from calls?* → Never. ✔
- *Confidence threshold?* → 0.7, configurable. ✔
- *Default on/off?* → Off, opt-in via `CALL_INTAKE_ENABLED`. ✔

## Success criteria

- A real call to `833-362-9813` produces a `callRecord` with a transcript and an AI classification within ~1 min of hang-up.
- A simulated broker load-offer transcript creates an `in_review` `rateconIntake` visible in `/review-queue` with a call marker.
- A duplicate recording callback creates no duplicate row.
- `CALL_INTAKE_ENABLED=false` fully halts OpenAI spend.
- Regression tests fail on naive code, pass on the implementation.
