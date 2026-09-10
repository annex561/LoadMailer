> **STATUS: BUILT 2026-09-09 by Claude, not by Grok.** Grok Build was down, so this
> spec was executed in place. Phase 1 and Phase 2 are complete: `server/coi-service.ts`,
> `server/coi-monitor-cron.ts`, `coi_alert_state` in `server/ensure-schema.ts`, routes
> `/api/coi-monitor/status` and `/api/coi-monitor/run`, admin CRUD at
> `server/coverage-routes.ts` plus `client/src/pages/driver-coverage.tsx`, and 31 tests
> across `server/__tests__/coi-coverage.test.ts` and `server/__tests__/coi-monitor.test.ts`.
> **Phase 2 is APPROVAL-GATED and ships default OFF** — it fires nothing until
> `COI_MONITOR_ENABLED=true` is set. Kept for the architecture notes in section 2.

# Spec — COI lapse monitor (leased owner-operator insurance expiry)

Status: ready to build
Author: Claude (architecture traced 2026-09-09 against `feat/carrier-defense-kit`)
Repo: TRAQ-IQ
Target branch: `feat/coi-lapse-monitor` off latest `origin/main`

---

## 1. Why this exists

LAMP leases owner-operators who carry their own insurance. The carrier (LAMP) stays
liable to the public under `49 CFR 376.12(c)(1)` no matter whose policy pays. Two
separate failure modes follow from that:

1. **Per-unit lapse.** A leased O/O's policy expires or cancels. He is on the road
   uninsured under LAMP's MC. There is no federal feed for this — FMCSA does not
   track per-unit coverage. The only signal is the certificate's own expiration date
   and the insurer's cancellation notice.
2. **Federal filing lapse.** If the O/O's policy is the one carrying LAMP's BMC-91X
   filing and it cancels, the insurer files a BMC-35 and FMCSA revokes LAMP's
   operating authority 30 days later. Every truck under the MC parks.

Failure mode 2 is already covered by the existing FMCSA monitor
(`server/fmcsa-monitor-cron.ts`, watches `authorityStatus`). **This spec covers
failure mode 1 only.** Do not rebuild the SAFER scrape.

Business value: this is a sellable module for any small fleet running leased
owner-operators, and nothing in the 5–25 truck segment ships it.

---

## 2. Architecture already in the repo — read this before writing code

These are the facts that cost the reading time. Trust them, verify them, do not
re-derive them.

### 2.1 The table already exists and is nearly dead

`shared/schema.ts:617` defines `complianceDocuments` / `compliance_documents`:

```
id, companyId (FK companies, NOT NULL), truckId (FK trucks, nullable),
driverId (FK drivers, nullable), type (text, NOT NULL),
expiryDate (timestamp, NOT NULL), filePath (text), status (text, default 'active'),
createdAt, updatedAt
```

Indexed on `company_id`, `expiry_date`, `status`. The Zod insert schema already
exists at `shared/schema.ts:3313` (`insertComplianceDocumentSchema`) and the row
type at `:3328` (`ComplianceDocument`).

**Nothing in the codebase writes to this table.** The only reader is
`server/dispatch-gate-service.ts:17`. Do not create a parallel table for COIs —
reuse `compliance_documents` with `type = 'coi'`.

### 2.2 BLAST RADIUS — the dispatch gate reads this table and throws

`server/dispatch-gate-service.ts:17-26` selects `compliance_documents` **by
`truckId`** where `expiryDate <= now()` and returns `status: "RED"` with
`riskScore: 100`.

`validateBooking()` (`server/dispatch-gate-service.ts:59`) then **throws**
`"Booking Blocked: Truck is in RED status."` unless an override exists. It is called
from `server/ga-loads-router.ts:393` on the booking path.

**Consequence:** the moment a COI row carrying a `truckId` passes its expiry, that
truck is hard-blocked from booking. That may eventually be the behavior the operator
wants, but it is a live behavior change to a working workflow and it is NOT in scope
here.

**v1 rule: write COI rows with `truckId = null`. Always. Set `driverId` only.**
Flipping COI rows onto `truckId` is a separate, separately-approved change.

### 2.3 The template to copy — do not invent a new pattern

`server/fmcsa-monitor-cron.ts` + `server/fmcsa-service.ts` +
`server/__tests__/fmcsa-monitor.test.ts` are the reference implementation of a
guarded outbound monitor in this repo. Read all three first. Mirror them.

The split that matters:
- `*-service.ts` holds **pure, unit-testable predicates** with no I/O
  (`decideFmcsaAlert`, `detectFmcsaChanges`, `hashMonitoredState`,
  `buildFmcsaAlertSms`).
- `*-cron.ts` holds scheduling, DB, and the SMS call, and delegates every decision
  to those predicates.

The six guards are documented in the header comment of `server/fmcsa-monitor-cron.ts`
lines 7–29. Reproduce all six.

### 2.4 Wiring points

- **Schema creation:** `server/ensure-schema.ts` — `CREATE TABLE IF NOT EXISTS`
  inside `try/catch` with a `log()` warning on failure. Copy the
  `fmcsa_carrier_snapshots` block's shape and comment style.
- **Cron registration:** `server/routes.ts:789-797` — a
  `Promise.resolve().then(async () => { const { x } = await import('./x'); await x.initialize(); })`
  block with a `catch` that logs. Add the COI block adjacent to the FMCSA and
  FreightGuard ones.
- **Status + manual trigger routes:** `server/routes.ts:1134` (`GET
  /api/fmcsa-monitor/status`) and `:1148` (`POST /api/fmcsa-monitor/run`). Mirror as
  `/api/coi-monitor/status` and `/api/coi-monitor/run`.
- **SMS:** `smsService.sendSMS({ to, body, skipFooter: true })`, gated on
  `smsService.isServiceConfigured?.()`. Import from `./sms-service`.

### 2.5 The chargeback fields already exist

`shared/schema.ts` drivers table already carries `deductInsuranceEnabled`,
`deductInsuranceWeekly`, `deductOccAccEnabled`, `deductOccAccWeekly`,
`weeklyInsuranceCost`. Do not add new pay fields. This spec does not touch pay.

### 2.6 Do NOT extend `server/document-reminder-service.ts`

It looks adjacent. It is not usable. It keeps `reminderHistory` in an **in-memory
`Map`** (`server/document-reminder-service.ts:17`) that resets on every deploy, and
it ticks every 30 minutes. That is precisely the blast-on-deploy anti-pattern
CLAUDE.md forbids. Leave it alone; it serves per-load BOL/POD reminders and is a
different domain.

---

## 3. What to build

### Phase 1 — schema, predicates, tests, write path (NOT approval-gated)

No outbound traffic. Pure DB + pure functions + tests.

**1.1 New table `coi_alert_state`** in `server/ensure-schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS coi_alert_state (
  document_id TEXT PRIMARY KEY,
  driver_id TEXT,
  doc_type TEXT,
  expiry_date TIMESTAMP,
  last_alerted_threshold INTEGER,
  baseline_recorded_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  last_alert_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
```

One row per `compliance_documents.id`. `last_alerted_threshold` is the dedup guard.

**1.2 `server/coi-service.ts` ALREADY EXISTS — extend it, do not recreate it.**

Claude built the coverage half on 2026-09-09 to back the `Coverage Verified` interlock
on DocuSeal template 16. It already exports `REQUIRED_COI_TYPES`, `COI_LABELS`,
`coiLabel`, `daysUntil`, `evaluateCoverage`, `coverageFailureReason`,
`assertCoverageCurrentForTripLease`, `getDriverCoverageStatus`, and
`coverageVerifiedField`, guarded by `server/__tests__/coi-coverage.test.ts` (14 tests,
green). **Reuse `daysUntil` and the `CoverageDoc` shape. Do not redefine them.**

Add ONLY the alerting predicates the monitor needs:

```ts
export const COI_THRESHOLDS = [30, 14, 7, 1, 0] as const;

export function thresholdBucket(daysLeft: number): number | null
export function decideCoiAlert(
  prevThreshold: number | null,
  isFirstSight: boolean,
  currBucket: number | null,
): { action: 'baseline' | 'no-change' | 'dedup' | 'alert'; threshold: number | null }
export function buildCoiAlertSms(
  driverName: string, docType: string, daysLeft: number, expiry: Date,
): string
```

Rules the predicates must encode:

- `daysUntil` is already written and tested. Import it, do not rewrite it.
- `thresholdBucket` returns the most urgent crossed threshold, or `null` when
  `daysLeft > 30`. `daysLeft <= 0` returns `0` (expired).
- **Baseline watermark.** `isFirstSight === true` always returns `baseline` and never
  alerts, whatever the bucket. A deploy against 12 already-expired COIs must send
  zero SMS. The baseline write records the current bucket as
  `last_alerted_threshold`.
- **Monotonic ratchet dedup.** Alert only when `currBucket` is strictly more urgent
  than `prevThreshold` (`currBucket < prevThreshold`, treating `null` as
  `Infinity`). Equal or less urgent returns `dedup`. This is what makes a restart, a
  double tick, or a re-detect a no-op.
- `currBucket === null` returns `no-change`.
- **GSM-7 only** in `buildCoiAlertSms`: ASCII throughout. No em dash, no unicode
  arrow, no smart quotes. A single unicode character flips the message to UCS-2 and
  halves the segment length. Follow `buildFmcsaAlertSms` in
  `server/fmcsa-service.ts:178`.

**1.3 New test file `server/__tests__/coi-monitor.test.ts`** (vitest). Separate file
from the existing `coi-coverage.test.ts` — do not edit that one. Must pin, at
minimum:

- first sight of an already-expired doc returns `baseline`, not `alert`
- first sight of a doc 45 days out returns `baseline`
- same bucket seen twice returns `dedup`
- 30 -> 14 returns `alert`
- 14 -> 30 (clock moved backwards / data corrected) returns `dedup`, never `alert`
- `daysLeft > 30` returns `no-change`
- `buildCoiAlertSms` output matches `/^[\x00-\x7F]*$/` (GSM-7 guard)
- `buildCoiAlertSms` stays under 160 characters for a representative driver name

**1.4 Write path.** COI rows have no writer today, so the monitor would watch an
empty table. Add authenticated CRUD in `server/routes.ts` using the existing
`insertComplianceDocumentSchema`:

- `GET /api/compliance-documents?driverId=` — list
- `POST /api/compliance-documents` — create, **force `truckId` to null** (see 2.2)
- `PATCH /api/compliance-documents/:id` — update expiry / status
- `DELETE /api/compliance-documents/:id`

Follow the `isAuthenticated` middleware pattern used at `server/routes.ts:8137`.

### Phase 2 — cron and SMS (APPROVAL-GATED: build the branch, DO NOT MERGE)

**Stop and report after this phase. Do not open a merge. Do not run `scripts/land.sh`.**

**2.1 New file `server/coi-monitor-cron.ts`**, mirroring
`server/fmcsa-monitor-cron.ts`. Six guards, all six required:

| Guard | Implementation |
|---|---|
| Default OFF | `COI_MONITOR_ENABLED !== 'true'` -> never schedules, logs and returns |
| Boot watermark | first sight per document recorded silently (predicate 1.2) |
| Per-entity dedup | `last_alerted_threshold` monotonic ratchet, one alert per bucket per document, ever |
| Rate ceiling | `COI_MONITOR_MAX_PER_TICK`, default `5`. Stop sending at the cap, log the remainder |
| Kill switches | `COI_MONITOR_DISABLED=true` aborts the tick; universal `SMS_DISABLED=true` aborts **without touching stored state** so nothing is silently swallowed |
| Visibility | log every decision per document: baseline / no-change / dedup / alert / error |

**2.2 SMS failure must not advance state.** On `sendSMS` failure, update
`last_checked_at` only. Leave `last_alerted_threshold` where it was so the next tick
re-detects and retries. Copy `touchRawOnly` in `server/fmcsa-monitor-cron.ts:246`.

**2.3 Query the documents** with an index-friendly predicate:

```sql
SELECT cd.id, cd.driver_id, cd.type, cd.expiry_date, d.name AS driver_name
FROM compliance_documents cd
LEFT JOIN drivers d ON d.id = cd.driver_id
WHERE cd.status = 'active'
  AND cd.expiry_date <= NOW() + INTERVAL '31 days'
ORDER BY cd.expiry_date ASC
LIMIT 200
```

`drivers.name` is confirmed present (`text`, NOT NULL) at `shared/schema.ts:147`.

**2.4 Env vars** (append to `.env.example` following the FMCSA block's comment style):

| Var | Default | Effect |
|---|---|---|
| `COI_MONITOR_ENABLED` | unset (off) | must be `true` to schedule |
| `COI_MONITOR_DISABLED` | unset | `true` halts every tick instantly |
| `COI_MONITOR_CRON` | `0 13 * * *` | 13:00 UTC, ~8 AM CT. Deliberately not 08:00 — that is the FMCSA monitor's slot |
| `COI_MONITOR_MAX_PER_TICK` | `5` | hard ceiling on SMS per tick |
| `COI_ALERT_PHONE` | falls back to `DISPATCHER_PHONE_NUMBER` | recipient |

**2.5 Register** the cron in `server/routes.ts` next to the FMCSA block
(`:789-797`), and add `/api/coi-monitor/status` + `/api/coi-monitor/run` mirroring
`:1134` and `:1148`.

---

## 4. Safety rules — restated, they are not inherited

You are working in a repo that sends real SMS through Twilio. CLAUDE.md governs.

- **Financial-impact gate.** Phase 2 adds a new outbound Twilio path. Build the
  branch, push it, then **STOP** and report: what changes, blast radius, failure
  modes with worst-case N, the guards in the change, and the rollback env var.
  Wait for explicit approval. Do not merge on your own judgment.
- **Worst-case N to state in the report:** documents matching the 31-day window,
  capped by `COI_MONITOR_MAX_PER_TICK` per tick on a daily schedule.
- **Regression guard required.** The test file in 1.3 is not optional and ships in
  the same PR, under a `## Regression guard` heading in the PR description.
- **No collateral damage.** Before editing any shared function, grep its callers.
  After editing, confirm the dispatch gate, the FMCSA monitor, the FreightGuard
  monitor, and the document reminder service still behave identically. State what
  you checked.
- **Branch discipline.** Own branch off latest `origin/main`. `git add` explicit
  paths only — never `git add .` or `git add -A`. Never `git stash`,
  `git reset --hard`, `git checkout .`, or `git clean`; other agents share this tree.
- **Fix Ledger.** Append an entry to `docs/FIX-LEDGER.md` for anything non-trivial
  you debug along the way, including the wrong turn you took.

---

## 5. Verify

Each command must FAIL on `origin/main` today and PASS when the phase is done.

Phase 1:

```
npx vitest run server/__tests__/coi-monitor.test.ts
```

```
grep -n "coi_alert_state" server/ensure-schema.ts
```

```
grep -n "export function decideCoiAlert" server/coi-service.ts
```

Phase 2:

```
grep -n "COI_MONITOR_ENABLED\|COI_MONITOR_DISABLED\|COI_MONITOR_MAX_PER_TICK\|SMS_DISABLED" server/coi-monitor-cron.ts
```

```
npm test
```

Full suite must stay green. A pre-existing failure unrelated to this work gets
reported, not fixed silently.

---

## 6. Do NOT

- Do NOT set `truckId` on COI rows. It hard-blocks booking through
  `server/ga-loads-router.ts:393`. See 2.2.
- Do NOT create a new table for COIs. `compliance_documents` exists. See 2.1.
- Do NOT recreate `server/coi-service.ts` or redefine `daysUntil`, `evaluateCoverage`,
  or `CoverageDoc`. They exist and are under test. See 1.2.
- Do NOT extend `server/document-reminder-service.ts`. See 2.6.
- Do NOT alert on first sight of a document. That is the deploy blast.
- Do NOT advance `last_alerted_threshold` when the SMS send fails.
- Do NOT put non-ASCII characters in any SMS body.
- Do NOT scrape SAFER or FMCSA L&I for per-unit coverage. It does not exist there —
  FMCSA tracks filings per MC, not per truck. This is why the certificate's own
  expiry date is the source of truth.
- Do NOT merge Phase 2. Push the branch, report, wait.
- Do NOT modify the FMCSA or FreightGuard crons, their services, or their tests.
- Do NOT run `git add .` / `git add -A` / `git stash` / `git reset --hard`.

---

## 7. Out of scope (name them, do not build them)

- Parsing the ACORD certificate PDF to auto-extract dates. The repo already has an
  OpenAI document parser (`server/ai-document-processor.ts`) that could do it, but
  that adds paid-API traffic and needs its own approval. Later.
- Driver-facing renewal nudges. Any SMS to a driver rather than the operator is a
  separate outbound path with its own gate.
- Flipping COI rows onto `truckId` to drive the dispatch gate.
- Insurer cancellation-notice email ingestion (the `server/email-ingestion-service.ts`
  path). Later, and it pairs with the FreightGuard email parser.
