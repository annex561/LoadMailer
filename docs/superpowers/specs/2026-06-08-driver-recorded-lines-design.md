# Per-Driver Recorded Inbound Lines (SP2) — Design

**Date:** 2026-06-08
**Status:** Draft for review
**Owner:** AL
**Project:** LAMP Logistics phone system → TRAQ-IQ (SP2)

## Why

SP1 gave LAMP a recorded, AI-classified main line that feeds the review queue. SP2 extends that to **per-driver company numbers**: each driver gets a dedicated Twilio number; inbound calls to it are recorded and forwarded to the driver's personal cell; the recordings flow into the **same `callRecord` layer** SP1 already built, tagged by driver. This protects the driver's personal cell (publish the company number instead), and turns every broker/shipper/receiver call to a driver into a recorded, searchable record — dispute armor for detention/appointment disputes.

SP2 is inbound-only. Recorded **outbound** driver calls are SP3 (in-portal dialer).

## Scope

**In scope (SP2):**
- A `voiceNumber` (+ `voiceNumberSid`) column on the `drivers` table.
- A provisioning service: assign a spare owned number if one is free, else auto-buy one in a chosen area code, then wire its voice webhook.
- One shared inbound voice webhook (`POST /api/voice/driver-inbound`) that records + forwards to the matched driver's cell, with a voicemail fallback.
- Poller tagging: resolve a recording's called number → driver, so driver calls get `driverId` + `source='twilio_driver'` + the driver's `companyId`.
- A "Phone Line" section on the driver profile UI to provision/view the line.
- Financial guards + regression tests.

**Out of scope (later / not now):**
- Recorded outbound driver calls (SP3).
- Releasing/porting/reassigning numbers (manual in Twilio console for now; a "Release line" button can come later).
- Multiple numbers per driver, IVR menus, business-hours routing.
- Third-party carriers.

## Decisions (locked)

- **Provisioning = reuse-then-buy.** On "Add line", assign an owned-but-unassigned number first; only call the buy API when none are free. Buying is gated behind an explicit admin confirm AND a `DRIVER_LINE_PROVISION_ENABLED` env flag (default OFF) so the paid buy path cannot fire until enabled.
- **Number type = area code per driver**, defaulting to the area code of the driver's own cell (`drivers.phone`).
- **Routing = one shared app-hosted TwiML webhook**, not a Studio flow per driver. Scales to self-service provisioning.
- **Forward target = `drivers.phone`** (the existing personal-cell field used for SMS dispatch).
- **Recording = mono** (`record-from-answer`), consistent with SP1 — Whisper doesn't diarize, so dual-channel buys nothing.
- **Isolation:** new column, new route, new service, new UI section. No change to dispatch SMS, existing driver routes, or the SP1 main-line path.

## Architecture

### Components
1. **Schema** — `drivers.voiceNumber` (text, unique, nullable) + `drivers.voiceNumberSid` (text, nullable). Plus the matching `ensure-schema.ts` idempotent ALTER.
2. **Provisioning service** (`server/driver-line-service.ts`, new) — `findSpareNumber()`, `buyNumber(areaCode)`, `assignLineToDriver(driverId, areaCode)`, `wireVoiceWebhook(numberSid)`. Uses the Twilio REST API (AvailablePhoneNumbers + IncomingPhoneNumbers) with the existing account creds.
3. **Inbound webhook** (added to `server/voice-intake-routes.ts`) — `POST /api/voice/driver-inbound` (+ a `/after` action endpoint for the answered-vs-missed branch). Signature-validated.
4. **Poller tagging** (edit `server/call-intake-service.ts`) — in `processRecording`, after resolving the call's `To`, look up `drivers.voiceNumber == to`; if matched, set `source='twilio_driver'`, `driverId`, and the driver's `companyId`.
5. **Driver-line routes** (added to `server/voice-intake-routes.ts` or driver routes) — `POST /api/drivers/:id/provision-line` (admin, behind the same auth + provision flag), `GET /api/drivers/:id/calls` (driver's call records).
6. **UI** — a "Phone Line" section in `client/src/pages/driver-profile.tsx`.

### Data flow
```
Caller dials driver's company number
  → POST /api/voice/driver-inbound (validate sig; lookup driver by To = voiceNumber)
  → TwiML: recording disclaimer → <Dial record="record-from-answer" callerId="{From}"
            action="/api/voice/driver-inbound/after"> driver.phone </Dial>
  → /after: if DialCallStatus != completed → voicemail (<Record>) ; else <Hangup>
  → [SP1 poller, already running] picks up the recording
  → processRecording resolves To → driver → tags callRecord {source:'twilio_driver', driverId, companyId}
  → transcript + classify + auto-surface reuse SP1 unchanged
  → shows in /calls (filterable by driver)
```

### Why a shared webhook (not Studio-per-driver)
One handler serves every driver; provisioning a line is just "get a number + point its voice webhook here." Studio-flow-per-driver would mean creating/maintaining a flow per driver — unworkable for self-service. The webhook is isolated (returns TwiML, dials only the matched driver's own cell) and signature-validated, so it carries none of the dispatch-SMS regression risk that kept SP1's main line in Studio.

## Data Model

`drivers` additions (both nullable, additive):

| Column | Type | Notes |
|---|---|---|
| `voiceNumber` | text, unique | the driver's assigned company line, E.164 |
| `voiceNumberSid` | text | Twilio IncomingPhoneNumber SID (for rewiring/release) |

`ensure-schema.ts`: `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS voice_number TEXT` + `ADD COLUMN IF NOT EXISTS voice_number_sid TEXT` + a unique index on `voice_number`.

## Provisioning logic (`assignLineToDriver`)

```
1. If driver already has voiceNumber → return it (idempotent).
2. spare = findSpareNumber()  // SAFE definition below
3. if spare: number = spare
   else:
     require DRIVER_LINE_PROVISION_ENABLED === 'true'  // else 409 "buying disabled"
     areaCode = requested || areaCodeOf(driver.phone)
     candidate = AvailablePhoneNumbers(areaCode).first   // 404 if none available
     number = buy(candidate)   // POST IncomingPhoneNumbers  ($ spend)
4. wireVoiceWebhook(number.sid → VoiceUrl = `${BASE}/api/voice/driver-inbound`, method POST)
5. db.update(drivers).set({ voiceNumber: number.phone, voiceNumberSid: number.sid })
6. return number
```

**`findSpareNumber()` — SAFE definition (no-regression critical).** A number is "spare" ONLY if ALL hold: it is NOT `TWILIO_PHONE_NUMBER`; its E.164 is NOT in the Messaging Service sender pool; it has **no active `sms_url`** (unset or the Twilio demo URL — so we never touch a dispatch SMS sender like the `660` main number or the `423` senders); its `voice_url` is unset/demo or already points at our own `/api/voice/driver-inbound` (so we never steal the SP1 main voice line, the `833`, whose voice_url points at the SP1 Studio flow); and it is NOT already in any `drivers.voiceNumber`. Given the current account (numbers are mostly SMS-active), this will usually return none → the gated buy path. That is the intended, safe outcome: reuse only a genuinely idle number, otherwise buy. Reuse never spends; only step-3-else spends and is double-gated (admin confirm in UI + env flag).

## Inbound webhook

- **Signature validation** copies the SP1/SMS pattern (`twilio.validateRequest`, production-only).
- **Driver lookup:** `db.select().from(drivers).where(eq(drivers.voiceNumber, req.body.To))`. If no match → return a safe TwiML `<Say>Sorry, this number is not in service.</Say><Hangup/>` (never dial an arbitrary number).
- **Forward:** `<Dial>` to `driver.phone`, `record="record-from-answer"`, `callerId` = the inbound `From` (pass the real caller through), `timeout=25`, `answerOnBridge`, `action=/api/voice/driver-inbound/after`.
- **Voicemail:** the `/after` endpoint reads `DialCallStatus`; on `no-answer`/`busy`/`failed` → disclaimer + `<Record maxLength=180>`; on `completed` → `<Hangup>`.

## Poller tagging change

In `processRecording`, after `resolveCallParties`:
```
const driver = to ? (await db.select().from(drivers).where(eq(drivers.voiceNumber, to)).limit(1))[0] : undefined;
const source   = driver ? "twilio_driver" : (job.source ?? "twilio_main");
const driverId = driver?.id ?? job.driverId ?? null;
const companyId = driver?.companyId ?? job.companyId ?? null;
```
Main-line calls (to the 833) match no driver → stay `twilio_main`. This also fixes the SP1 `companyId=null` gap for driver calls (they inherit the driver's company).

## UI — driver "Phone Line" section

On `driver-profile.tsx`:
- If `voiceNumber` set: show it + a "View calls" link (to `/calls?driver=<id>`).
- Else: an **"Add recorded line"** button → confirm dialog that states whether it will **reuse a spare** (free) or **buy** (~$1.15/mo, only if the env flag is on) → calls `POST /api/drivers/:id/provision-line`.

## Financial guards

- **Provisioning buy** is the only new paid path. Double-gated: admin click + confirm in the UI, AND `DRIVER_LINE_PROVISION_ENABLED` (default OFF) — with the flag off, provisioning only ever reuses owned numbers and returns 409 if none are free. Reuse-first minimizes spend.
- **Per-call recording + transcription** reuse SP1's existing guards (already enabled, watermark, dedup, caps, kill switch).
- **No arbitrary-dial vector:** the inbound webhook dials only a number that exactly matches a known `driver.voiceNumber`; unmatched `To` → "not in service" hangup.
- **Rollback:** clear `driver.voiceNumber`/release the number to disable a line; `DRIVER_LINE_PROVISION_ENABLED=false` halts all buying.

## No-regression / Testing

Additive throughout. Regression tests in `server/__tests__/`:
1. **`driver-line-no-arbitrary-dial.test.ts`** — the predicate that turns an inbound `To` into a dial target returns null/"not in service" when `To` matches no driver, and the driver's `phone` only when `To` exactly equals a driver's `voiceNumber`. (Prevents the webhook from being abused to dial arbitrary numbers.)
2. **`driver-line-provision-gate.test.ts`** — the provisioning predicate refuses to buy (returns a "buying disabled" outcome) when `DRIVER_LINE_PROVISION_ENABLED` is off and no spare is available; reuses a spare without the flag.
3. **Poller tagging** — a unit test that the tag-resolution predicate returns `twilio_driver`/driverId for a matching number and `twilio_main`/null otherwise.

## Migrations

- `shared/schema.ts`: add the two columns + unique index on `voice_number`.
- `server/ensure-schema.ts`: idempotent `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS ...` + `CREATE UNIQUE INDEX IF NOT EXISTS`.
- Check `schema-completeness.test.ts` stays green.

## Open questions (resolved)

- *Provisioning model?* → reuse-then-buy, buy double-gated. ✔
- *Number type?* → area code per driver, default driver's own. ✔
- *Routing?* → one shared app webhook. ✔
- *Forward target?* → `drivers.phone`. ✔
- *Recording channels?* → mono (matches SP1). ✔

## Success criteria

- An admin can add a recorded line to a driver from the driver profile; it reuses a spare number (no spend) when one exists.
- A call to a driver's company number records, forwards to the driver's cell showing the real caller, and (if missed) takes a transcribed voicemail.
- That call appears in `/calls` tagged `twilio_driver` with the right `driverId` and the driver's `companyId`, and (if a load offer) auto-surfaces to the review queue.
- The inbound webhook never dials a number that isn't a known driver's `voiceNumber`.
- With `DRIVER_LINE_PROVISION_ENABLED` off and no spare free, provisioning refuses to buy.
