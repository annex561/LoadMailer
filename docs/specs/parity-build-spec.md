# TRAQ-IQ Parity Build Spec

**Target:** close every capability gap against Hey Bubba (bubba.ai) that is worth closing, then pass them.
**Audience:** an autonomous coding agent (Grok Build) working unattended.
**Author context:** written 2026-09-02 after tracing the live code paths. The architecture notes in
§1 are load-bearing. They contradict what the code *looks* like at first read. Do not skip them.

---

## 0. Ground rules — read before writing any code

These come from `CLAUDE.md` at the repo root and `~/.claude/CLAUDE.md`. They are not suggestions.

### 0.1 Financial-impact gate

This project sends real SMS (Twilio + Telnyx), real email (Resend), and calls paid APIs (OpenAI).
**Any change that adds outbound traffic to a paid vendor is approval-gated and must NOT be merged
without the operator's explicit go.** Build it, push the branch, and stop.

Every new outbound path must ship with all six of these, no exceptions:

| Guard | Requirement |
|---|---|
| Default OFF | Opt-in via env var. The module imports cleanly and schedules nothing when unset. |
| Boot watermark | On startup process at most 3 most-recent backlog items, then only items newer than the watermark. A deploy must never re-blast a backlog. |
| Per-entity dedup | One alert per load/driver/intake, ever, tracked in the DB. |
| Rate ceiling | Hard max-per-hour cap as defense in depth. |
| Kill switch | A single env var that halts the path instantly without removing credentials. |
| Visibility | Log every send-or-suppress decision so a runaway is visible in 60 seconds, not 1,000 messages later. |

The canonical implementation of all six is `server/fmcsa-monitor-cron.ts` (its header comment
enumerates them). **Copy that pattern.** Phases 1, 2, 4 and 5 of this spec have zero outbound
spend and need no approval. Phase 3 does and must stop at the branch.

Existing kill switches, do not break them:

| Env var | Effect |
|---|---|
| `SMS_DISABLED=true` | Halts every outbound SMS instantly (Twilio + Telnyx). |
| `FACTORING_DISABLED=true` | Halts all outbound factoring email. |
| `HOS_CHECK_DISABLED=true` | Halts the daily HOS prompt. |
| `FMCSA_MONITOR_DISABLED=true` | Halts the SAFER monitor. |

### 0.2 Regression guard, mandatory

Every fix or feature touching a critical workflow ships a **vitest regression test in
`server/__tests__/`** that fails on the old code and passes on the new. Critical workflows:
driver dispatch SMS, reply keyword routing, BOL/POD upload, Love's factoring, driver onboarding,
HOS cron, geofence cron, login, RateCon intake → review → dispatch.

"I'll add the test later" and "the fix is one line" are both rejected. Same PR.

Prefer a pure, dependency-free predicate + a unit test over an integration test. That is the
house style: see `server/__tests__/fmcsa-monitor.test.ts`, `freightguard-parse.test.ts`,
`portal-dialer-predicates.test.ts`.

### 0.3 No collateral damage

Before changing a shared function, grep every caller. After changing it, re-verify the other
callers still work and say so. A fix that breaks a previously-working feature is a failure, not
a fix. If a change would break something else, find another way. Additive and guarded beats
mutating shared behavior.

### 0.4 Fix Ledger

Read `docs/FIX-LEDGER.md` before debugging anything. Grep it for your error string first.
Append an entry after every non-trivial fix, with the `Do NOT` line filled in. Never delete
an entry.

### 0.5 Branch and land

- Work on `feat/<phase-slug>` off the latest `origin/main`. Never commit to `main` directly.
- `git add <explicit paths>` only. Never `git add .` or `-A`. Other agents may share this tree.
- Never run `git stash`, `git reset --hard`, `git checkout .`, or `git clean`.
- One phase per branch and per PR. Do not stack phases into one giant PR.

### 0.6 Commit attribution

End every commit message with:

```
Co-Authored-By: Grok Build <noreply@x.ai>
```

---

## 1. Architecture facts you must know first

These were verified by reading the code on 2026-09-02. Several are counter-intuitive and cost
real time to rediscover.

### 1.1 There are TWO location systems and only one of them is live

**Live path (the one that matters):**

```
driver's browser  →  POST /api/driver-location/update   (server/routes.ts:3464)
                  →  validates trackingToken via storage.validateTrackingToken
                  →  gpsLocationRateLimiter (120/hr)
                  →  reverseGeocode(lat, lon)           (server/geocoding-service.ts)
                  →  storage.createDriverLocation({ ..., source: 'gps' })
                  →  deactivates older rows whose source !== 'gps'
```

**Dead path (looks live, is not):**

`GPSTrackingService.updateDriverLocation()` at `server/gps-tracking-service.ts:91` calls
`checkGeofences()`, `updateRouteProgress()` and `checkLocationAlerts()`. **Nothing on the live
request path calls it.** Consequently:

- The `geofences` and `geofence_events` tables are **not populated in production**.
- `geofence_events.dwellTime` is **never written**. Do not build detention on top of it.
- `updateDriverLocation()` also never passes `source`, so anything it did write would land as
  `'simulated'`.

**Do NOT** "fix" this by rewiring the live route through `GPSTrackingService`. That is a large
blast-radius refactor of a working path. Leave it alone.

### 1.2 The live geofencing is a cron, and it does not compute dwell

`server/geofence-cron.ts`, every 2 minutes:

- Selects loads where `driverId IS NOT NULL AND deliveredAt IS NULL`.
- Reads the single latest `driver_locations` row for that driver.
- Ignores fixes older than `MAX_LOCATION_AGE_MIN = 30`.
- `haversineDistance()` (exported from `server/auto-load-matcher.ts:207`, returns **miles**)
  against the geocoded pickup and delivery address.
- Inside `MILES_THRESHOLD` (default **5**, override with env `GEOFENCE_MILES`) it fires the
  photo-upload SMS via `sendUploadLink()` in `server/load-photos-service.ts`.
- Dedupes on `load.sopProgress` so each (loadId, phase) fires once.

It writes no events and stores no arrival or departure timestamp.

### 1.3 Phone tracking is fragile by construction, and there is already a band-aid

Browser geolocation only runs while the page is open:

- `client/src/pages/driver-tracker.tsx:299` — `watchPosition` at high accuracy, plus a 30s
  `getCurrentPosition` fallback, plus a screen Wake Lock.
- `server/driver-portal.ts:200` — background script POSTs every 60s **while the page is open**,
  throttled to 1/min, state mirrored in `localStorage`.

`server/gps-health-monitor.ts` exists because that feed dies constantly. Every 3 minutes it
checks loads with status `in_transit`; if the driver's newest fix is older than
`GPS_STALE_THRESHOLD_MINUTES = 5` it SMSes the driver a tracking link, with
`REMINDER_COOLDOWN_MINUTES = 15`. It no-ops entirely when `smsService.isServiceConfigured()`
is false.

### 1.4 "HOS" today is a duty flag, not hours of service

`server/hos-check-cron.ts` texts each rostered driver every morning
("reply ON if on duty, OFF if off duty") and sets `drivers.is_on_duty`. It cannot produce drive
time remaining, the 11/14-hour clocks, or the 70-hour cycle. Guards already present:
`HOS_CHECK_ENABLED` (default off), per-driver-per-day dedup in `hos_check_log`,
`HOS_MAX_SENDS_PER_TICK`, `HOS_CHECK_DISABLED`.

### 1.5 Schema changes need TWO edits

`shared/schema.ts` declares the Drizzle schema. `server/ensure-schema.ts` additively applies
columns to the live database with `pool.query()`. **A column added to one but not the other
breaks production `SELECT *`.** There is a `server/__tests__/schema-completeness.test.ts` that
enforces this for the `drivers` table specifically. Add to both, always.

### 1.6 The RateCon parser

`server/ratecon-confidence-parser.ts`:

- `SYSTEM_PROMPT` holds a strict JSON schema the model must return.
- Model `gpt-4o`, `response_format: { type: "json_object" }`.
- Few-shot examples pulled from the `ratecon_corrections` table via `fetchLearningExamples(3)`,
  disabled by `RATECON_DISABLE_FEW_SHOT=true`.
- Output type `ParsedRateconV2`; scalar fields are `FieldWithConfidence<T>` = `{ value, confidence }`.
- Guarded by `server/__tests__/ratecon-confidence-parser.test.ts`. Adding a field means updating
  the type, the prompt schema, the fallback/example object near line 221, and that test.

### 1.7 Useful things that already exist. Reuse, do not rewrite

| Thing | Where |
|---|---|
| `haversineDistance(lat1, lon1, lat2, lon2)` → miles | `server/auto-load-matcher.ts:207` |
| `geocode(address)` | `server/geocoder.ts` |
| `reverseGeocode(lat, lon)` | `server/geocoding-service.ts` |
| `storage.createDriverLocation`, `getDriverLocations(driverId, limit)`, `getDriverCurrentLocation` | `server/storage.ts` |
| SMS with kill switch | `server/sms-service.ts` |
| Six-guard cron template | `server/fmcsa-monitor-cron.ts` |
| Pure-parser + unit-test template | `server/freightguard-service.ts` + its test |
| Background service boot | `server/index.ts`, `initializeBackgroundServicesAsync()` ~line 353 |

---

## 2. Phase 1 — Telematics ingest (TruckX)

**Goal:** truck position that does not depend on a driver keeping a browser tab open.
**Outbound spend:** none. No approval needed.
**Estimate:** half a day.

### 2.1 What it is for

Not to replace phone tracking. Phone tracking stays primary and stays more accurate. The ELD is
the **fallback that needs no driver cooperation**, which is what makes geofence arrival, dwell
time, and detention (Phase 2) trustworthy.

### 2.2 Files

| File | Action |
|---|---|
| `shared/schema.ts` | add `drivers.telematicsVehicleId` (text, nullable) |
| `server/ensure-schema.ts` | add `['telematics_vehicle_id', 'TEXT']` to the drivers column array |
| `server/telematics-service.ts` | NEW — interface, TruckX client, pure predicates |
| `server/telematics-cron.ts` | NEW — poller |
| `server/index.ts` | ONE line in `initializeBackgroundServicesAsync()` |
| `server/__tests__/telematics-predicates.test.ts` | NEW |

### 2.3 `server/telematics-service.ts`

Split strictly into a pure half and an I/O half. Only the pure half is unit-tested.

```ts
export interface TelematicsFix {
  vehicleId: string;        // provider's vehicle id
  latitude: number;
  longitude: number;
  speedMph: number | null;
  headingDeg: number | null;
  recordedAt: Date;         // provider timestamp, NOT ingest time
}

export interface TelematicsSource {
  readonly name: string;                     // 'truckx'
  fetchFixes(): Promise<TelematicsFix[]>;    // all vehicles, one call
}
```

**Pure predicates (export these, they are what the tests pin):**

```ts
// Phone wins while it is fresh. Only ingest an ELD fix when the phone has gone quiet.
export function shouldIngestTelematicsFix(args: {
  lastPhoneFixAt: Date | null;   // newest driver_locations row with source 'gps'
  telematicsFixAt: Date;
  now: Date;
  phoneStaleAfterMin: number;    // default 5, matches GPS_STALE_THRESHOLD_MINUTES
  maxFixAgeMin: number;          // default 30, matches geofence-cron MAX_LOCATION_AGE_MIN
}): boolean;

// Guard against a provider replaying the same fix forever.
export function isDuplicateFix(
  previous: { latitude: number; longitude: number; recordedAt: Date } | null,
  next: TelematicsFix,
): boolean;
```

Rules the tests must pin:

1. No phone fix ever → ingest.
2. Phone fix newer than `phoneStaleAfterMin` → **do not** ingest.
3. Phone fix older than `phoneStaleAfterMin` → ingest.
4. Telematics fix itself older than `maxFixAgeMin` → **do not** ingest (a stale ELD fix is worse
   than none, it silently poisons geofence-cron which trusts the newest row).
5. Identical coordinates and identical `recordedAt` as the previous stored telematics fix →
   duplicate, skip.
6. Clock skew: a `recordedAt` in the future by more than 2 minutes → treat as invalid, skip.

**TruckX client (I/O half):**

- Base URL from `TRUCKX_API_BASE`, key from `TRUCKX_API_KEY`.
- If either is unset, `fetchFixes()` returns `[]` and logs once. Never throw on boot.
- Timeout every request at 10s. Never let a hung provider stall the cron.
- Map provider fields into `TelematicsFix`. If the exact TruckX response shape is unknown at
  build time, isolate it in a single `mapTruckXPayload(raw): TelematicsFix[]` function with a
  fixture-based test, so swapping the shape is a one-function change.
- Build the provider behind `TelematicsSource` so a different vendor is a new file, not a
  refactor. Select with `TELEMATICS_PROVIDER` (default `truckx`).

### 2.4 `server/telematics-cron.ts`

- Schedule `*/5 * * * *`. Not faster; the ELD is a fallback, not a live tracker.
- **Default OFF:** only schedules when `TELEMATICS_ENABLED=true`.
- Kill switch: `TELEMATICS_DISABLED=true` halts ticks immediately.
- Per tick:
  1. `source.fetchFixes()`.
  2. Load the driver map: `drivers` where `telematicsVehicleId IS NOT NULL`. Skip unmapped
     vehicles and log the count once per tick, not once per vehicle.
  3. For each mapped driver, read the newest `driver_locations` row and apply
     `shouldIngestTelematicsFix` and `isDuplicateFix`.
  4. When ingesting, call `storage.createDriverLocation({ ..., source: 'truckx', isActive: true })`
     and reverse-geocode the same way the phone route does.
  5. **Deactivate rule:** deactivate older rows only where `source !== 'gps'`. Never deactivate a
     real phone fix. This mirrors `routes.ts:3530`.
  6. Log one summary line per tick: `fetched / mapped / ingested / skipped-fresh-phone /
     skipped-stale / skipped-dup`.
- Cap ingests per tick at `TELEMATICS_MAX_PER_TICK` (default 200) as defense in depth.

### 2.5 Boot

One line inside `initializeBackgroundServicesAsync()` in `server/index.ts`, wrapped in the same
try/catch + `log()` pattern the neighbouring services use. It must not be able to crash boot.

### 2.6 Verify

```bash
npx vitest run server/__tests__/telematics-predicates.test.ts
```

```bash
TELEMATICS_ENABLED=true npm run dev
```
Confirm the tick summary line appears and that `driver_locations` gains rows with
`source = 'truckx'` only while the phone feed is quiet.

### 2.7 Regression guard

`server/__tests__/telematics-predicates.test.ts` asserts all six rules in §2.3. Rule 2 (fresh
phone wins) is the one that matters most: if it inverts, the ELD overwrites better phone data
and accuracy silently drops.

### 2.8 Do NOT

- Do not rewire the phone route through `GPSTrackingService`.
- Do not write to `geofence_events`. That table is dead; Phase 2 does not use it.
- Do not remove or weaken `gps-health-monitor`. Phase 1 makes it fire less often, which is the
  point, but it stays as the last resort when **both** feeds are quiet.

---

## 3. Phase 2 — Detention

**Goal:** turn dock time into a billable claim with evidence.
**Outbound spend:** none, provided the claim is generated for a human to send. **Do not add
auto-send to the broker.**
**Estimate:** ~1 day. Depends on Phase 1 for reliable data but can be built in parallel.

### 3.1 Files

| File | Action |
|---|---|
| `shared/schema.ts` | add `loads.detentionFreeMinutes` (integer), `loads.detentionRatePerHour` (real) |
| `server/ensure-schema.ts` | matching additive columns on the `loads` table |
| `server/ratecon-confidence-parser.ts` | extract the two fields |
| `server/detention-service.ts` | NEW — pure math |
| `server/routes/detention-routes.ts` | NEW — one GET route |
| `client/src/pages/load-details.tsx` | a claim panel |
| `server/__tests__/detention-math.test.ts` | NEW |
| `server/__tests__/ratecon-confidence-parser.test.ts` | extend for the new fields |

### 3.2 Parser changes

Add to `SYSTEM_PROMPT`'s schema block:

```
"detentionFreeMinutes": { "value": <number or null>, "confidence": 0.0-1.0 },
"detentionRatePerHour": { "value": <number or null>, "confidence": 0.0-1.0 },
```

Add to the prompt's rules:

> Detention terms usually read like "2 hours free time, then $50/hour" or "Free time: 120
> minutes. Detention: $75/hr after." Convert free time to MINUTES. If the rate confirmation
> states no detention terms, return null for both with confidence 1.0. Never invent a rate.

Add the fields to the `ParsedRateconV2` interface and to the example object near line 221.
Extend the existing parser test.

### 3.3 `server/detention-service.ts` — pure, no DB, no clock

```ts
export interface Fix { latitude: number; longitude: number; timestamp: Date }

export interface DwellWindow {
  arrivedAt: Date;
  departedAt: Date | null;   // null = still inside as of the newest fix
  dwellMinutes: number;
  fixCount: number;          // how many fixes support the window
  gapMinutes: number;        // largest gap between consecutive fixes inside the window
}

// Newest-first or oldest-first input must both work: sort internally.
export function computeDwellWindow(
  fixes: Fix[],
  stopLat: number,
  stopLon: number,
  radiusMiles: number,
  now: Date,
): DwellWindow | null;

export interface DetentionClaim {
  dwellMinutes: number;
  freeMinutes: number;
  billableMinutes: number;
  billableHours: number;     // rounded per the rule below
  ratePerHour: number;
  amount: number;
  confidence: 'high' | 'low';
  reasons: string[];         // why low, e.g. "42 min gap in tracking"
}

export function computeDetentionClaim(
  window: DwellWindow,
  freeMinutes: number | null,
  ratePerHour: number | null,
): DetentionClaim | null;
```

Rules the tests must pin:

1. Arrival = the **first** fix inside `radiusMiles`. Departure = the **first** fix after arrival
   that is outside. Use `haversineDistance` from `auto-load-matcher.ts`.
2. Default radius **0.5 miles**, env `DETENTION_RADIUS_MILES`. This is deliberately much tighter
   than geofence-cron's 5 miles, which exists to give SMS lead time, not to measure dock time.
   **Do not reuse the 5-mile constant.**
3. A single fix inside the radius with no later fix outside → `departedAt: null`, dwell measured
   to `now`. Still returned, marked `confidence: 'low'`.
4. Re-entry after leaving does not extend the first window. Return the first window only. A
   second visit is a separate claim and is out of scope for v1.
5. `billableMinutes = max(0, dwellMinutes - freeMinutes)`.
6. Billing rounds **up to the nearest 15 minutes**, then converts to hours. Industry norm and it
   favors the carrier. Put the rounding behind a named constant so it is one edit to change.
7. `freeMinutes` null → treat as 0 free time but force `confidence: 'low'` with the reason
   "no free-time term parsed from the rate confirmation".
8. `ratePerHour` null → return `null` from `computeDetentionClaim`. No rate, no claim. Never
   guess a market rate.
9. `confidence: 'low'` whenever any of: `gapMinutes > 30`, `fixCount < 3`, `departedAt === null`,
   free time or rate missing. Every reason appended to `reasons`.
10. Zero or negative billable minutes → return a claim with `amount: 0`, not null. The dispatcher
    should see "you were inside free time" rather than an empty panel.

### 3.4 Route

`GET /api/loads/:id/detention?stop=pickup|delivery` (default `delivery`).

- Auth the same way neighbouring load routes do.
- Geocode the load's `pickupAddress` / `deliveryAddress` with `geocode()`.
- Pull the driver's fixes across the load window with
  `storage.getDriverLocations(driverId, 2000)` and filter by timestamp.
- Return `{ window, claim, fixes: [...] }` where `fixes` are only those inside the window, so the
  UI can show the evidence.
- Read-only. It computes nothing into the DB and sends nothing.

Register it in `server/routes.ts` next to the other `server/routes/*` registrations.

### 3.5 UI

A panel on `client/src/pages/load-details.tsx`:

- Arrived / departed timestamps, dwell, free time, billable, rate, **amount** as the big number.
- The confidence chip and every `reasons` entry, plainly. A dispatcher must never send a claim
  without seeing that tracking was patchy.
- A "Copy claim" button that copies a plain-text claim block: load number, stop address, arrival,
  departure, dwell, free time, rate, amount. **No send button in v1.**

### 3.6 Verify

```bash
npx vitest run server/__tests__/detention-math.test.ts server/__tests__/ratecon-confidence-parser.test.ts
```

```bash
curl -s "http://localhost:5000/api/loads/<realLoadId>/detention?stop=delivery" | jq
```

### 3.7 Do NOT

- Do not read `geofence_events.dwellTime`. It is never written. See §1.1.
- Do not auto-send the claim to the broker. That is a new outbound path and needs its own
  approval cycle.
- Do not widen geofence-cron's 5-mile threshold to serve detention. Two different jobs.

---

## 4. Phase 3 — Broker check-call auto-answer  ⚠ APPROVAL-GATED

**Build the branch. Do not merge. Stop and report.**

**Outbound spend:** Twilio voice minutes, OpenAI transcription. This is the largest new paid
surface in the spec.

### 4.1 Scope

An inbound broker call to the office line resolves the load (caller ID against
`customers`/`loads`, else the spoken load number) and answers with the newest position and the
geofence ETA. Reuses `server/call-intake-service.ts`, `server/voice-intake-routes.ts` and the
per-driver lines in `server/driver-line-service.ts`.

### 4.2 Required guards

| Guard | Value |
|---|---|
| Default OFF | `CHECKCALL_AUTOANSWER_ENABLED` unset → the TwiML route is not registered at all |
| Kill switch | `CHECKCALL_AUTOANSWER_DISABLED=true` |
| Rate ceiling | `CHECKCALL_MAX_PER_HOUR`, default 30 |
| Per-caller dedup | Max 1 auto-answer per (caller, load) per hour; beyond that, forward to a human |
| Max duration | Hard 90-second cap per call |
| Visibility | Log answer-or-forward with the reason for every call |

Unresolvable load, stale position (older than `maxFixAgeMin`), or ceiling hit → **forward to the
dispatcher**, never improvise.

### 4.3 Regression guard

Pure predicates in `server/call-intake-service.ts` style, tested in
`server/__tests__/checkcall-guards.test.ts`: resolution, staleness refusal, ceiling, dedup,
disabled-flag short-circuit.

---

## 5. Phase 4 — Load board consolidation

**Outbound spend:** none.

There are **eleven** DAT scraper implementations in `server/` (`dat-scraper.ts`,
`dat-puppeteer-scraper.ts`, `real-dat-scraper.ts`, `proven-dat-scraper.ts`,
`simplified-dat-scraper.ts`, `session-based-dat-scraper.ts`, `dat-website-scraper.ts`,
`dat-loads-direct.ts`, `dat-api-service.ts`, `simple-dat-connector.ts`, `dat-scraper-service.ts`).

1. Determine which one actually runs in production. Trace from `server/routes.ts` and
   `server/scraper-management` usage, and check `scraper_configs` / `scraper_logs` rows.
2. Define `LoadSource { name, search(criteria): Promise<ScrapedLoad[]> }`.
3. Move the surviving implementation behind it.
4. **Delete the other ten in a separate commit** so the deletion is reviewable on its own.
5. Add a Truckstop adapter behind the same interface **only if** `TRUCKSTOP_API_KEY` is present.
   Credentials are a business agreement and may not exist yet; the adapter must no-op cleanly
   without them.

Guard: `server/__tests__/load-source-registry.test.ts` asserts the registry resolves the
configured provider and that an unconfigured provider returns `[]` rather than throwing.

---

## 6. Phase 5 — Surpass

Only after Phases 1 and 2 are green. These are the things Hey Bubba structurally cannot copy,
because each depends on data only the carrier's own system of record holds.

### 6.1 Cost-based price floor

Their negotiation floor is a lane-average guess. Yours can be arithmetic. Compute a per-truck,
per-lane break-even from `cost_calculations`, `pay_calculator`, `driver_advances` and settlement
history, and expose `computeFloorRate(loadId | lane, truckId)` as a pure function with tests.
Surface it on the load review screen next to the offered rate.

### 6.2 Broker score before you accept

`server/freightguard-service.ts` already parses Carrier411 FreightGuard filings and
`server/fmcsa-service.ts` already monitors SAFER. Combine into
`scoreBroker(brokerName | mcNumber)` returning `{ score, flags[] }`, and show it on the RateCon
review queue. Chaudhari does this by hand, one phone call at a time. Automate it.

### 6.3 Dispatch Gate in the booking decision

`server/dispatch-gate-service.ts` already grades each truck GREEN / YELLOW / RED on expired
compliance docs, overdue PM and open work orders. Nothing consults it before a load is accepted.
Wire `getTruckGateStatus()` into the review queue so a RED truck cannot be dispatched without an
explicit override, and log every override.

---

## 7. Out of scope — do not build

**Outbound AI voice negotiation with brokers.** Not a resourcing question. The receiving end is
actively refusing AI callers, brokers are flagging the numbers, and the channel degrades as
adoption rises. If a rate needs negotiating, TRAQ-IQ briefs the dispatcher and hands them a
one-tap dial through the portal dialer that already ships.

Also out of scope: appointment booking with shippers, multilingual broker translation, native
iOS/Android apps, and public marketing calculators.

---

## 8. Definition of done, per phase

1. `npx tsc --noEmit` clean.
2. `npx vitest run` fully green, including the phase's new tests.
3. The new tests demonstrably fail when the change is reverted.
4. Blast-radius note in the PR body: which shared functions were touched, which callers were
   re-checked, and the result.
5. A `## Regression guard` section in the PR body naming the test and the failure mode it pins.
6. A `docs/FIX-LEDGER.md` entry for anything non-trivial that was diagnosed along the way,
   including the wrong turn.
7. Branch pushed. **Not merged.** The operator lands it.

---

## 9. Suggested order

| # | Phase | Approval | Depends on |
|---|---|---|---|
| 1 | Telematics ingest | none | nothing |
| 2 | Detention | none | Phase 1 for data quality, buildable in parallel |
| 3 | Load board consolidation | none | nothing |
| 4 | Surpass: broker score + dispatch gate | none | nothing |
| 5 | Surpass: cost-based floor | none | nothing |
| 6 | Check-call auto-answer | **REQUIRED, stop at branch** | Phase 1 |

Phases 1 through 5 can all be completed unattended. Phase 6 stops at a pushed branch and waits
for the operator.
