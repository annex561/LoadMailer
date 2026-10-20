# TRAQ-IQ Fix Ledger

Read this before debugging. Grep it for your error string, status code, or symptom —
entries are written to be greppable on purpose.

Append after every non-trivial fix. Never delete an entry; supersede it with a new one and
say so. The **Do NOT** line is the point: anyone can read a diff, but what does not survive
a session is knowing which *plausible* explanation was wrong.

Format:

```
### <short title>
- **Symptom** — what you would actually SEE. Real error text.
- **Root cause** — what was actually wrong, not the first theory.
- **Fix** — what changed, and where.
- **Guard** — the test that fails if it regresses. If none, say why.
- **Do NOT** — the wrong turn someone will take next time.
- `<date> · <commit>`
```

---

### DocuSeal API returns 404 on every template-creation endpoint

- **Symptom** — `POST /api/templates`, `/api/templates/pdf`, `/api/templates/docx`, and
  `/api/templates/html` all return
  `{"status":404,"message":"This feature is available in Pro Edition: https://www.docuseal.com/pricing"}`.
  Meanwhile `GET /api/templates` returns 200 with data, and `POST /api/submissions` returns
  422 on an empty body.
- **Root cause** — template creation is Pro-gated in the DocuSeal open-source edition. The
  self-hosted instance at `docuseal-production-ca61.up.railway.app` runs OSS. This is a
  licensing gate, not an auth failure and not a missing endpoint.
- **Fix** — no code fix. Templates get created through the DocuSeal **web UI** (upload the
  tag-embedded PDFs in `docs/docuseal-templates/pdf/`; DocuSeal parses the
  `{{Field;role=Role;type=type}}` text tags out of the PDF text layer and builds every
  field on import). Creating them over the API requires a Pro licence.
- **Guard** — none possible; it is a remote licence check, not our code. The tripwire that
  matters is `docs/docuseal-templates/build/build.py --check`, which validates the field
  tags before a PDF is ever uploaded.
- **Do NOT** — do not read the 404 as "the API key is wrong" and go hunting for
  credentials. `DOCUSEAL_API_KEY` is set on the Railway **LoadMailer** service and
  authenticates correctly — verify with
  `curl -H "X-Auth-Token: $KEY" $DOCUSEAL_URL/api/templates`, which returns 200. A 401 means
  a bad key; **404 with the Pro Edition message means the licence tier**. Also do not
  conclude the whole API is unusable — `/api/submissions` works, so sending an existing
  template out for signature is available today.
- `2026-08-12 · uncommitted`

### DocuSeal upload creates documents with ZERO fields — text tags are Pro-only

- **Symptom** — a PDF containing `{{Field Name;role=Driver;type=text}}` text tags uploads
  fine and the template is created, but `GET /api/templates/<id>` reports `fields: 0` and
  the tags appear as literal grey text on the document. No error anywhere.
- **Root cause** — DocuSeal's text-tag parser is a **Pro** feature. It is not in the
  open-source tree at all: `grep -rniE "text_tag|field_tag" lib/ app/` on
  github.com/docusealco/docuseal returns nothing. The on-premises pricing page lists
  "PDF or DOCX and field tags API" under Pro Features — that clause gates the *field tags*,
  not merely the API.
- **Fix** — embed real PDF **AcroForm** fields instead of tags.
  `docs/docuseal-templates/build/tags_to_acroform.py` converts every tag into a genuine
  form widget at the tag's own coordinates and whites out the tag text. DocuSeal OSS
  imports these: `lib/templates/find_acro_fields.rb` is called from
  `lib/templates/process_document.rb` on every upload with **no licence check**.
  Type mapping, taken from that file: `/Sig` → signature (→ initials if the name contains
  "initials"), `/Tx` → text, `/Btn` check_box → checkbox, `/Ch` combo_box with `/Opt` →
  select.
- **Guard** — the verification step after conversion: read every output PDF back with
  pypdf and assert 110 fields, 13 of type `/Sig`, and **zero** remaining `{{` in the text
  layer. A leftover `{{` means a tag was not converted and will ship as visible junk.
- **Do NOT** — do not assume a tagged PDF worked because the upload succeeded and the
  documents look right. The template is created either way; only the field count reveals
  it. **Check `fields` on the API response, not the screen.** Also do not name a field with
  anything outside letters, digits, spaces, and hyphens — `FIELD_NAME_REGEXP` in
  `find_acro_fields.rb` silently drops the name, leaving an unnamed field.
- `2026-08-12 · uncommitted`

### Railway variable changes do not reach the running process until it restarts

- **Symptom** — `railway variables --set FOO=bar` succeeds, `railway variables --json`
  reads the new value back, and the application still behaves as if the old value were set.
  Concretely: `DOCUSEAL_WEBHOOK_SECRET` was set, yet the webhook endpoint kept returning
  `200` to requests carrying **no** secret and to requests carrying a **wrong** secret,
  because `process.env.DOCUSEAL_WEBHOOK_SECRET` was still `""` in the live process and the
  `if (secret)` auth block was therefore skipped entirely.
- **Root cause** — setting a variable updates Railway's stored config. The running Node
  process keeps the environment it booted with. A restart or redeploy is what moves the
  value into `process.env`.
- **Fix** — `railway redeploy -s <service> -y`, then re-test. The new value was live about
  20 seconds later.
- **Guard** — test the *behaviour*, never the config read-back. For a secret, the passing
  test is a request with a deliberately wrong secret returning **401**. For a template id,
  exercise the path that uses it.
- **Do NOT** — do not treat `railway variables --json` echoing the new value as proof the
  change is in effect; it only proves Railway stored it. This bit twice in one session:
  `DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID=11` and `=13` were both reported as live on the
  strength of a config read-back, while the process was very likely still holding the old
  demo id `8`. Verify with a behavioural probe against the deployed surface.
- `2026-08-12 · uncommitted`

### Creating DocuSeal templates without Pro — build them in Rails on the container

- **Symptom** — you need to create a template with fields and signing roles, but
  `POST /api/templates*` is Pro-gated (404), text tags are Pro, the browser file-upload
  tool fails, and the AcroForm importer carries no role data. Every documented path is
  blocked.
- **Root cause** — the gates are on the API surface and the tag parser, not on the models.
  DocuSeal is a Rails app on Railway that the operator controls, and `railway ssh` reaches
  it.
- **Fix** — `docs/docuseal-templates/build/build_templates.rb`, run on the container with
  `cd /app && RAILS_ENV=production bundle exec rails runner /tmp/build_templates.rb`. It
  calls DocuSeal's own `Templates::CreateAttachments.handle_pdf_or_image(..., extract_fields: true)`
  so documents are processed exactly as an upload would, then assembles `template.fields`,
  `template.submitters`, and `template.schema` directly — which is what makes **roles**
  possible, since the AcroForm importer has none. Getting the PDFs onto the container:
  `railway ssh` does **not** forward stdin (it hangs), so stage the files in the instance's
  own R2 bucket with `boto3`, hand the container short-lived presigned URLs, `wget` them
  to `/tmp`, and delete the staging prefix afterwards.
- **Guard** — verify from the API, never the screen:
  `GET /api/templates/<id>` must report the expected field count, a types breakdown, a
  Driver/Carrier split, and `unnamed fields: 0`.
- **Do NOT** — do not run `rails runner` from `/data/docuseal`; that is the data volume and
  the app root is `/app`, and running it from the wrong directory prints the `rails new`
  help text rather than any error explaining itself. Do not pipe file bytes through
  `railway ssh` stdin. Do not reach for a paid licence before checking whether the block is
  on the API surface or on the model layer — here it was only the surface.
- `2026-08-12 · uncommitted`

### Recruiting Stage 7 points both driver types at a DocuSeal demo template

- **Symptom** — a driver sent an agreement through recruiting Stage 7 receives a document
  titled "Independent Contractor Agreement (DEMO)" containing three unnamed fields
  (signature, text, date) and a single submitter called "First Party". None of the real
  agreement terms appear.
- **Root cause** — `DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID` and `DOCUSEAL_OWNER_OP_TEMPLATE_ID`
  are **both** set to `8` on the Railway LoadMailer service. Template 8 is the sample
  template that ships with a fresh DocuSeal install. The two driver types also collapse to
  the same document, so an owner-operator and a company driver would receive identical
  paperwork even once the ID is corrected.
- **Fix** — done 2026-08-12. Both variables now point at real, distinct templates built by
  `build/build_templates.rb`:
  `DOCUSEAL_COMPANY_DRIVER_TEMPLATE_ID=11` (9 documents, 97 fields, Driver/Carrier) and
  `DOCUSEAL_OWNER_OP_TEMPLATE_ID=13` (10 documents, 123 fields, Owner-Operator/Carrier).
  The two packets are deliberately different: the owner-operator one carries the 49 CFR
  Part 376 leasing documents instead of the IC agreement, because a lease-on driver is
  governed by the Truth-in-Leasing rules and §376.12 mandates specific lease provisions.
  Both share the same Part 391 DQ file, since a lessor driving under our authority is
  subject to it identically.
- **Guard** — still pending: a boot-time assertion that refuses to send when the configured
  template name matches `/DEMO/i`, plus a unit test that the two template-ID variables are
  not equal. Until that exists, this ledger entry is the only tripwire.
- **Do NOT** — do not assume the recruiting DocuSeal path is unconfigured because signing
  looks broken. It IS configured, `vendors.ts` will happily reach live DocuSeal, and it will
  send a real driver a demo document. The mock fallback in `vendors.ts` only engages when
  the URL, key, or template ID is missing — all three are present, so the live path runs.
- `2026-08-12 · uncommitted`

### Split-authority driver SMS must never blast a backlog (preventive entry)
- **Symptom** — none yet. This entry exists so the next agent does not have to
  rediscover why `truck_free_notifications` and `coi_alert_state` look over-engineered
  for what they store.
- **Root cause** — the shape of the PR #62 incident: a code change that turns dead code
  into live code is a NEW outbound path, and processing a backlog on first boot is how
  1,000+ Twilio messages went out. Any monitor that reads existing rows and sends is
  one deploy away from repeating it.
- **Fix** — every monitor in this feature set carries the same five-part shape:
  default-OFF env flag, a first-sight baseline that records silently and never sends,
  a per-entity dedup row (`coi_alert_state.last_alerted_threshold` is a monotonic
  ratchet; `truck_free_notifications.load_id` is a PRIMARY KEY), a per-tick ceiling,
  and — for `truck-free-notify-cron.ts` only — a SQL-level recency bound so a stale
  backlog cannot even be read into memory.
- **Guard** — `server/__tests__/coi-monitor.test.ts` walks one certificate from 45 days
  out to 40 days expired and asserts exactly 5 messages ever leave.
  `server/__tests__/truck-free-notify.test.ts` runs 40 ticks against one freeing load
  and asserts exactly 1. Both fail if the baseline or the dedup is loosened.
- **Do NOT** — do not "simplify" the baseline branch away because it looks like it does
  nothing. It does nothing *on purpose*, exactly once per entity, and that is the only
  thing standing between a deploy and everyone's phone. Also do not widen
  `TRUCK_FREE_LOOKBACK_MINUTES` to "catch up on missed notifications" — the narrow
  window IS the blast-radius cap, and a missed notification is cheaper than a blast.
- `2026-09-10 · uncommitted`

---

### Duplicate `driverId` (and 4 more) keys in the `recruitingApplications` pgTable

- **Symptom** — every `npx vitest run` printed
  `[vite] warning: Duplicate key "driverId" in object literal`, plus the same warning for
  `addressHistory`, `employmentHistory`, `accidents3yr`, `violations3yr`. `tsc --noEmit`
  emitted 5 matching errors on `shared/schema.ts`. No runtime failure — this was a silent
  latent bug, not a crash.
- **Root cause** — `8b7bda0` ("fix massive Drizzle schema drift on recruiting_applications")
  swept 30+ production columns into the `recruitingApplications` table definition without
  checking which ones were already declared at the top of the table. Five were. In a JS
  object literal the **last** key wins, so drizzle silently used the sweep's versions.
  For the four jsonb fields the two declarations were byte-identical, so nothing changed.
  For `driverId` they were not: the original at the top of the table is
  `varchar("driver_id").references(() => drivers.id, { onDelete: "set null" })`, and the
  sweep's shadowing copy was a bare `text("driver_id")` with **no foreign key**. The live
  column is the FK version — `server/ensure-schema.ts` creates
  `driver_id VARCHAR REFERENCES drivers(id) ON DELETE SET NULL` in its `CREATE TABLE`
  (`eb5518d`), and the `["driver_id", "TEXT"]` entry the same sweep added to `stageColumns`
  is an `ADD COLUMN IF NOT EXISTS` that no-ops against it. So the schema drizzle built was
  the one nobody intended, and `drizzle-kit push` against it would have proposed dropping
  the FK constraint.
- **Fix** — deleted the five shadowing declarations from `shared/schema.ts`
  (`recruitingApplications`), keeping the FK-bearing `driverId` at the top of the table and
  the single copy of each jsonb field in the Stage 2 / 49 CFR 391.21 block. Left a NOTE
  comment where the `driverId` duplicate was so the next sweep does not re-add it.
  `server/ensure-schema.ts` was deliberately left alone: its `["driver_id", "TEXT"]` ALTER
  is a harmless no-op on any DB whose table came from the `CREATE TABLE`, and it is the
  only rescue path for a stale deploy whose table predates the column.
- **Guard** — none added. The condition is a compile-time warning, not a code path a unit
  test can exercise; `tsc --noEmit` and the vite transform both already flag it, and
  `server/__tests__/schema-completeness.test.ts` (the existing schema guard) only parses
  the `drivers` and `loads` tables. The greppable check is
  `npx vitest run 2>&1 | grep -i "duplicate key"` returning nothing.
- **Do NOT** — do **not** "fix" this by deleting the top-of-table declaration and keeping
  the Stage 10 one. It reads like the newer, more deliberate line (it sits under a
  `// Stage 10 — ACTIVE` header next to the other activation fields, and it matches the
  `["driver_id", "TEXT"]` entry in `ensure-schema.ts`), but it is the accident, and keeping
  it silently drops the FK to `drivers.id` that the activate endpoint at
  `server/recruiting/routes.ts` (`/api/recruiting/applications/:id/activate`) depends on.
  Also do not assume the `stageColumns` ALTER in `ensure-schema.ts` describes the live
  column type — `ADD COLUMN IF NOT EXISTS` tells you nothing when the column already
  exists. Read the `CREATE TABLE` block, not the ALTER list.
- `2026-09-09 · (this commit)`

### `/api/coverage/*` served driver PII and accepted edits with no login
- **Symptom** — `curl -s -o /dev/null -w "%{http_code}" https://traqiq.app/api/coverage/drivers` returns `200` while `/api/drivers` and `/api/loads` return `401`. The body lists every driver's name, phone, own MC/DOT and COI file paths. `PATCH /api/coverage/drivers/:id` and `DELETE /api/coverage/documents/:id` also ran for anonymous callers.
- **Root cause** — `server/routes.ts` mounted the router bare: `app.use('/api/coverage', coverageRoutes)`. PR #124 gated `/api/ga` two lines above it but the coverage router landed later without the guard.
- **Fix** — `app.use('/api/coverage', isAuthenticated, coverageRoutes)`. Every route in `server/coverage-routes.ts` is admin CRUD, and its only caller is the logged-in `/driver-coverage` page.
- **Guard** — `server/__tests__/loads-drivers-auth.test.ts` → "mounts /api/coverage behind isAuthenticated".
- **Do NOT** — do not copy this prefix guard onto `/api/drivers`. That prefix holds the public tokenized portal route `PATCH /api/drivers/self/:token`, and the test file header explains why it uses per-route guards there. Also note `GET /api/drivers/:id` is still unauthenticated as of this entry (a fake id returns 404, not 401); `client/src/pages/driver-dashboard.tsx` calls it, so gating it needs the driver-dashboard login path checked first.
- `2026-10-19 · (this commit)`

### Driver SMS linked the legacy `?driverId=` page instead of the token portal
- **Symptom** — a driver taps the "driver portal" SMS and lands on `/mobile-driver-dashboard?driverId=<uuid>` (or `/driver-dashboard?driverId=`). With no staff session its `/api/drivers/:id` calls return `401`, so the page is empty or errors. `grep -n "driver-dashboard?driverId" server/routes.ts` found four senders: the TRIP template in `POST /api/sms/send-template`, the welcome SMS in `POST /api/drivers`, `POST /api/drivers/:id/send-dashboard-link` and `POST /api/drivers/send-dashboard-links`.
- **Root cause** — those senders predate the tokenized portal `/driver/:token` (`server/driver-portal.ts`) and kept linking the old React page, whose only credential is the raw driver UUID. PR #128 gates `/api/drivers/:id`, which ends that page for drivers.
- **Fix** — all four build the link with `driverPortalUrl(getBaseUrl(), driver, storage)` (`server/driver-portal-link.ts`), which returns `/driver/<trackingToken>` and mints a token only when the driver has none. The three that ran the link through `urlShortener` (is.gd) no longer do: is.gd codes are public and enumerable, and the token is the driver's credential. `client/src/pages/mobile-driver-dashboard.tsx` now shows "This link has moved. Text dispatch for your new link." when there is no session, instead of firing the failing calls.
- **Guard** — `server/__tests__/driver-portal-link.test.ts`: pins each sender to `driverPortalUrl`, bans `driver-dashboard?driverId=` in `routes.ts`, bans `urlShortener` in the three dashboard-link senders, and pins that an existing token is reused (never re-minted), including the `tracking_token` key on raw-SQL fallback rows.
- **Do NOT** — do not redirect `?driverId=` to `/driver/<token>` server- or client-side: that turns a leaked UUID back into portal access. Do not call `storage.generateTrackingToken` unconditionally to "refresh" a link: it overwrites the token and kills every portal link the driver already has. (The GPS tracking SMS in `sendGPSTrackingSMS` (`server/routes.ts`) and `server/gps-health-monitor.ts` still do this, and still send tokens through is.gd; not fixed here.) Do not shorten a `/driver/<token>` URL with a public shortener. Do not read only `driver.trackingToken`: when the Drizzle select fails, `storage.getDriver`/`getAllDrivers` return raw `SELECT *` rows with `tracking_token`, and a camelCase-only check would re-mint the token for every driver in a bulk send.
- `2026-10-20 · (this commit)`

### GPS tracking SMS rotated the driver's token on every send
- **Symptom** — after a "Start GPS tracking" or "🚨 GPS Tracking Stopped" SMS, every `/driver/<token>` portal link the driver already had stops working, and an open `/driver-tracker` tab starts getting `401` `Unauthorized: Invalid tracking token` ("Please restart tracking from your dashboard.") on `POST /api/driver-location/update`. Logs show `🔐 Generated tracking token for driver <id>` on each GPS SMS. GPS goes stale, so `gps-health-monitor` sends another reminder (and another token) 15 minutes later. The SMS link was `https://is.gd/...`.
- **Root cause** — `sendGPSTrackingSMS` (`server/routes.ts`) and `GPSHealthMonitorService.sendGPSReminder` (`server/gps-health-monitor.ts`) called `storage.generateTrackingToken(driverId)` unconditionally. That function overwrites `drivers.trackingToken` (`server/db-storage.ts`), the one credential behind the portal, the tracker's GPS posts and the HOS/ratecon links. Both paths also ran the token URL through `urlShortener` (is.gd), whose codes are public and enumerable, and `sendGPSTrackingSMS` logged the full token URL.
- **Fix** — both call `ensureTrackingToken(driver, storage)` (`server/driver-portal-link.ts`, next to `driverPortalUrl`, which now uses it): reuse `trackingToken || tracking_token`, mint only when both are empty, throw (no SMS) if minting fails. Both send the full `/driver-tracker?driver=&token=` URL, unshortened. Dropped the token-URL log line. Supersedes the "not fixed here" note in the entry above.
- **Guard** — `server/__tests__/gps-sms-token-reuse.test.ts`: runs `sendGPSReminder` with storage/SMS mocked and pins reuse (camelCase and snake_case rows), mint-once-when-null, no shortener, no SMS on mint failure; source tripwire pins `sendGPSTrackingSMS` to `ensureTrackingToken(driver, storage)` with no `generateTrackingToken` and no `urlShortener`.
- **Do NOT** — do not "fix" a dead tracker link by re-minting: that kills the driver's other live links and feeds the stale-GPS reminder loop. Rotate a token only to revoke it (leaked credential), and tell the driver. Do not put the shortener back to save segments: the full URL costs +2 UCS-2 segments per GPS SMS (4 to 6, with the dashboard footer). If segment cost matters, link `/driver/<token>#tracking` instead (the footer then skips itself, back to 3-4 segments). That changes which page the driver lands on, so it is a product call. Do not read only `driver.trackingToken`: raw-SQL fallback rows carry `tracking_token`.
- `2026-10-20 · (this commit)`

### Session DAT scraper burned 1-3 vCPU and ~half the Railway bill
- **Symptom** — Railway usage: LoadMailer averaged ~1.9 vCPU and ~2.9 GB around the clock (~$67 of the $130 Sep 10–Oct 10 usage, invoice $143.85). Metrics climb in steps of ~1.07 vCPU, memory spikes to 23-24 GB, and only a deploy resets them. `railway ssh -s LoadMailer -- <anything>` returns `sh: 1: Cannot fork`. Logs every 15s: `🔄 Performing session-based DAT scrape...` then `✅ Successfully extracted 0 real DAT loads from authenticated session`. At boot: `📍 Current URL: https://www.dat.com/home-1?s=loads` then `✅ Authenticated DAT session detected!`. Sometimes: `❌ Failed to scrape authenticated session: TimeoutError: Navigation timeout of 20000 ms exceeded`.
- **Root cause** — `server/index.ts` starts `sessionBasedDATScraper` at boot when `checkAuthenticatedSession()` says yes. A fresh headless Chrome on Railway has no DAT cookies. DAT redirects it to the marketing page, whose URL has no "login" and whose markup matches the search-input selector, so the check is a false positive on every boot. The 15s `setInterval` then launches a new Chrome per run for 0 loads, and `scrapeAuthenticatedSession` closed the browser only on success: every navigation timeout leaked a Chrome. Leaked Chromes pinned a core each, filled memory, and exhausted the container's pid limit.
- **Fix** — the boot block returns early unless `DAT_SESSION_SCRAPER_ENABLED=true` (`isDatSessionScraperEnabled`, `server/session-based-dat-scraper.ts`, default off, logs `[dat-session] disabled`). `scrapeAuthenticatedSession` closes the browser in `finally`. `.env.example` documents the flag.
- **Guard** — `server/__tests__/dat-session-scraper-gate.test.ts`: the flag defaults off, `index.ts` checks it (and returns) before `checkAuthenticatedSession()`, and Chrome closes when navigation throws. All 4 fail on the pre-fix code.
- **Do NOT** — do not turn the flag on to "get DAT loads": this path has never scraped a load (no session cookies exist in the container). Real DAT data goes through `server/dat-loads-direct.ts` (`DAT_DIRECT_ENABLED`) or the TaskMagic webhook. Do not judge a puppeteer login by "URL lacks login": DAT's marketing redirect passes that test. Any `puppeteer.launch` must close in `finally`, not only on the happy path. When Railway cost jumps, pull `usage(groupBy: [PROJECT_ID, SERVICE_ID])` and `metrics(sampleRateSeconds: 120)` before guessing: the step shape (whole cores, reset on deploy) points at leaked child processes.
- `2026-10-20 · (this commit)`

### `POST /api/gps/send-tracking-link` sent Twilio SMS for anonymous callers
- **Symptom** — `curl -s -X POST https://traqiq.app/api/gps/send-tracking-link -H 'Content-Type: application/json' -d '{"driverId":"<uuid>"}'` with no session returned `200 {"success":true}` and texted the driver. Repeat it and every call sends another SMS (and, before PR #134, rotates the driver's tracking token, which 401s their open tracker tab). With a fake id it returns `400`, not `401`.
- **Root cause** — the route in `server/routes.ts` was registered with no middleware. `sendGPSTrackingSMS` throttles only when a `loadId` is passed (30 min, via `loads.gpsTrackingSmsLastSentAt`); the no-`loadId` "general tracking" path had no throttle at all. Driver UUIDs leak through other anonymous routes until #128/#130 land.
- **Fix** — `app.post("/api/gps/send-tracking-link", isAuthenticated, gpsTrackingLinkRateLimiter, ...)`. The limiter (`express-rate-limit`, defined next to `bulkSmsRateLimiter`) caps each driverId at 5 sends per hour, in memory. The only caller is the logged-in `/gps-tracking` page (`client/src/pages/gps-tracking.tsx`, `apiRequest`). It is the only server route under `/api/gps`; the page's `GET /api/gps/devices` query has no server route at all.
- **Guard** — `server/__tests__/gps-send-tracking-link-auth.test.ts`: pins `isAuthenticated` first, the limiter second, the limiter's 5/hour driverId key, and that `POST /api/driver-location/update` stays session-free. 3 of 4 fail on main.
- **Do NOT** — do not swap this for `app.use('/api/gps', isAuthenticated)` without re-checking every route under the prefix: driver devices authenticate GPS posts with a tracking token and have no session (`/api/driver-location/update` is the live one today). Do not move the per-driver ceiling into `sendGPSTrackingSMS`: that function also serves the automatic in_transit send in the load PATCH (`updates.status === 'in_transit'`), and a shared per-driver counter would let manual clicks block it. The ceiling belongs on the manual route. Do not read the 30-minute throttle as covering this route: it only runs with a `loadId`.
- `2026-10-20 · (this commit)`

### Seven guard tests red on main for months: stale source pins, not broken sends
- **Symptom** — `npx vitest run` on main fails 7 tests in 4 files:
  `driver-stage-messages.test.ts` (3 snapshot mismatches + `expected 'Load #LD29505831 CONFIRMED…' to contain 'Upload a clear photo of the signed BO…'`),
  `dry-run-mode.test.ts` ("submitToLoves gates BEFORE the SMTP sendMail call": `expected -1 to be greater than 0`),
  `factoring-test-redirect.test.ts` ("test-mode branch skips the production factoring_submissions insert": `not to match /\.insert\(factoringSubmissions\)/`),
  `upload-direct-cloudinary.test.ts` (`expected '// Driver photo upload page…' to match /cloudinaryUrl/`).
- **Root cause** — each pin went stale when the code moved on purpose, and nothing ran the suite (the repo has no `.github/workflows`), so nobody saw it go red. Breaking commits found by `git bisect run`:
  - driver-stage-messages: `2b6e269` (2026-05-31, owner request) changed the pickup prompt to "Upload the BOL + tie-down photos (both required):", the delivery prompt to "Upload the signed BOL + POD:", and added `?stages=pickup_bol,pickup_securement` / `?stages=delivery_pod,delivery_signed_bol` to the `/u/` links. Its own guard (`upload-stage-phasing.test.ts`) was added; these snapshots were not updated.
  - upload-direct-cloudinary: `fcee3e2` (#93, merged 2026-05-27) replaced the #97 save-back (`POST /api/loads/:id/photos` with `cloudinaryUrl`) with `GET /photos/sign` → Cloudinary → `POST /photos/record` with `fileUrl`. The client and route agree on `fileUrl`.
  - factoring-test-redirect: `e099872` (#111, Resend swap) made the test-mode branch shorter, so the test's fixed 4000-char window ran past the branch's `return` into the production `.insert(factoringSubmissions)`. The branch itself still returns on every path before the insert.
  - dry-run-mode: went red at `d9227de` (#109), see the next entry. `e099872` (#111) then removed `factoringMailer.sendMail` entirely, so the anchor matched nothing.
- **Fix** — tests only, no production code: updated the 3 inline snapshots and the flag-OFF wording; pinned the `/photos/record` + `fileUrl` contract on both client and route; bounded the test-mode block by the dedup comment instead of 4000 chars; re-anchored the dry-run pin on the one `sendViaResend({…})` call whose `to:` is `SCHEDULES_LS`.
- **Guard** — the four files above. Each new pin was mutation-checked: removing the dry-run gate, routing the test branch to `SCHEDULES_LS`, adding an insert inside the test branch, and renaming `fileUrl` on either the client or the route each turn a test red.
- **Do NOT** — do not "fix" a red source pin by deleting the assertion or widening it until it passes. Bisect it first (`git bisect run npx vitest run <file> -t "<name>"`) and read the breaking commit: the dry-run pin looked stale too, and it was the one catching a real gap. Do not anchor a pin on "the first send in the file" or a fixed character window; anchor on the specific call and bound the slice by text.
- `2026-10-19 · (this commit)`

### DRY_RUN_OUTBOUND does not stop the FACTORING_TEST_TO_EMAIL send (OPEN, approval-gated)
- **Symptom** — with `DRY_RUN_OUTBOUND=true`, `LOVES_FACTORING_ENABLED=true` and `FACTORING_TEST_TO_EMAIL` set, Submit on `/factoring` still sends a real email through `api.resend.com` to the test inbox. Logs show `[factoring-loves] ✅ TEST sent loadId=…` and no `[DRY-RUN] loves-factoring.sendPacket` line.
- **Root cause** — `d9227de` (#109) put the test-redirect branch at the top of `submitToLoves`, before the dry-run gate, and gave it its own send. The dry-run pin went red that day. Love's is never contacted: the only send to `SCHEDULES_LS` is still behind `if (isDryRunOutbound())`.
- **Fix** — not applied. Moving the dry-run check above the test branch changes send behaviour on a paid vendor (Resend), so it waits for Annex's approval under the financial-impact rule.
- **Guard** — `dry-run-mode.test.ts` holds an `it.todo` for it. Turn that into a real pin in the same PR that moves the gate.
- **Do NOT** — do not assume `DRY_RUN_OUTBOUND=true` means zero outbound from `/factoring` while the test redirect is set. Unset `FACTORING_TEST_TO_EMAIL` first if you need a true no-send run.
- `2026-10-19 · (open)`

### DRY_RUN_OUTBOUND now stops the FACTORING_TEST_TO_EMAIL send (supersedes the OPEN entry above)
- **Symptom** — same as "DRY_RUN_OUTBOUND does not stop the FACTORING_TEST_TO_EMAIL send": with `DRY_RUN_OUTBOUND=true` and `FACTORING_TEST_TO_EMAIL` set, `/factoring` Submit sent a real Resend email to the test inbox and logged `[factoring-loves] ✅ TEST sent loadId=…`.
- **Root cause** — the test-redirect branch (`d9227de`, #109) returns before the production dry-run gate and had no gate of its own.
- **Fix** — `server/factoring-loves.ts` `submitToLoves`: the test-redirect branch now checks `isDryRunOutbound()` after it builds the packet and before `sendViaResend`. Under dry-run it logs `[DRY-RUN] loves-factoring.sendTestPacket`, returns `{ ok: true, emailMessageId: "dry-loves-test-…" }`, and still writes nothing to the DB (same as the live test path). Behaviour with `DRY_RUN_OUTBOUND` unset is unchanged. Approved by Annex 2026-10-20.
- **Guard** — `server/__tests__/factoring-dry-run-test-redirect.test.ts` runs `submitToLoves` with the DB, PDF templates and `fetch` mocked, and asserts zero calls to `api.resend.com` under dry-run. A control case asserts exactly one send, to the test inbox, when dry-run is off. `dry-run-mode.test.ts` adds a source pin for the gate's position. It also re-checks that the gate nearest the Love's send sits after the dedup check, so the new test-branch gate cannot stand in for the production one.
- **Do NOT** — do not move the production dry-run gate up to the top of `submitToLoves` to cover both paths. The production gate mirrors the live DB writes (`factoring_submissions` → `submitted`, `loads.factoringStatus`), and the test path must never write. They need separate gates. Do not anchor a dry-run pin on the first `isDryRunOutbound()` in the file: there are two now.
- `2026-10-20 · (this commit)`
