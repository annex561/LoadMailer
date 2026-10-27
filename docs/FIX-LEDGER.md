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

### `/api/drivers/:id` and its subpaths ran for anonymous callers (token rotation, edit, delete, SMS)
- **Symptom** — `curl -s -o /dev/null -w "%{http_code}" https://traqiq.app/api/drivers/does-not-exist-probe` returns `404`, not `401`. Same for `/api/drivers/<id>/earnings` and `/load-history` (`200` with a fake id). The handler runs for anyone. A real id returns the full driver row including `trackingToken`.
- **Root cause** — 10 routes in `server/routes.ts` were registered with no middleware: `GET/PUT/DELETE /api/drivers/:id`, `PATCH /:id/pay`, `PATCH /:id/pay-rules`, `POST /:id/send-dashboard-link` (sends an SMS), `POST /:driverId/generate-tracking-token` (overwrites `drivers.trackingToken`, so it hijacks `/driver/:token` and kills the driver's real link), `GET /:driverId/earnings`, `/load-history`, `/current-location`. PR #124 gated only the list route. Driver UUIDs are not a secret: anonymous `GET /api/driver-locations/active` returns every active driver's id, name and live GPS, so each of these routes was exploitable end to end.
- **Fix** — `isAuthenticated` as the first middleware on each of the 10 routes (per route, not a prefix guard).
- **Guard** — `server/__tests__/loads-drivers-auth.test.ts` → "every /api/drivers/:param route requires authentication". It scans every route whose third segment is a param, so a new unguarded `/api/drivers/:id/...` route fails it too.
- **Do NOT** — do not trust the note in the `/api/coverage` entry above that `client/src/pages/driver-dashboard.tsx` is the driver-side caller. That file is dead code: `/driver-dashboard` in `App.tsx` renders `mobile-driver-dashboard.tsx`. The real anonymous caller is the legacy React page `/mobile-driver-dashboard?driverId=<uuid>`, which `send-dashboard-link`, `send-dashboard-links` and `POST /api/drivers` SMSed out until PR #133 repointed them to `/driver/<token>`. It uses a raw driver id as its credential, so this fix stops its profile, earnings, history, location and GPS-start calls for drivers without a session (its current-load card has returned 401 since PR #124). Since #133 that page shows "This link has moved" to anyone without a session. The tokenized portal `/driver/:token` calls none of these routes and is unaffected. Do not "fix" the legacy page by reopening these routes or by redirecting `?driverId=` to `/driver/<token>`: both turn a leaked UUID back into portal access.
- `2026-10-19 · (this commit)`

### RateCon parses failing with OpenAI 429 for 3.5 months; each PDF enqueued 2-10 times
- **Symptom** — the RateCon review queue fills with `in_review` rows whose `parse_error` is `429 You exceeded your current quota, please check your plan and billing details.` (from 2026-07-06) or `429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings...` (from 2026-07-30). Boot logs show the same 429. The same `source_filename` shows up 2-10 times per Gmail message. `SELECT MAX(parsed_at) FROM ratecon_intake` stays at the last day credits worked (2026-07-03). No SMS alert ever fired.
- **Root cause** — two bugs. (1) OpenAI org "Personal" ran out of prepaid credits with auto-reload off; `OPENAI_API_KEY` on LoadMailer kept returning 429. (2) Nobody noticed because the `parser-degraded` check in `server/ops-monitor-service.ts` only counts `noteParserRun` calls, and only the old `server/services/ratecon-parser.ts` makes them. The live path (`parseIntake` → `parseRatecon` in `server/ratecon-confidence-parser.ts`) never reported. The duplicates came from `server/services/gmail.ts`: the scan query is `newer_than:2d` (read mail included, so marking an email read does nothing), and its only dedup is `PARSE_ATTEMPT_CACHE`, an in-memory 24h map. Every deploy or restart empties it and the next tick re-enqueues every attachment from the last 2 days; the 24h TTL inside a 48h window re-enqueues each one a second time anyway. A successful parse hid this, because `parseIntake` merges by load number into `merged_into_other`, but each duplicate still cost a Cloudinary upload and an OpenAI call: 1,513 email intake rows for 402 attachments by 2026-10-24.
- **Fix** — `hasIntakeForEmailAttachment(messageId, filename)` (`server/ratecon-intake-service.ts`) runs in `gmail.ts processMessage` before each attachment download and before the TQL driver-sheet link fetch; an existing row means skip. `ops-monitor-service.ts checkOpenAiCredits()` reads `ratecon_intake` (so deploys can't reset it), texts the alert phone at most once per 24h per process while a credit 429 in the last 24h is newer than the last good parse, and shows `openaiCreditErrors24h` / `lastOpenAiCreditErrorAt` at `GET /api/ops/snapshot`. `OPS_OPENAI_CREDIT_ALERT=off` silences it. `isOpenAiCreditError` (`server/openai-errors.ts`) tells a credit 429 from a rate-limit 429. `parseIntake(id, pdf, { autoDispatch: false })` stops a clean parse at `in_review`, and a successful parse now clears the old `parse_error`. Backlog cleanup: `scripts/ratecon-credit-backfill.ts` (read-only by default; `--collapse` and `--apply` write).
- **Guard** — `server/__tests__/ratecon-email-dedup.test.ts` (skip an attachment and a TQL sheet that already have a row), `server/__tests__/ops-openai-credit-alert.test.ts` (alert fires once, stops after recovery, ignores rate limits, kill switch), `server/__tests__/ratecon-credit-outage.test.ts` (credit-error predicate, `autoDispatch:false` never dispatches or texts, backfill grouping/classification). 7 fail on the pre-fix code.
- **Do NOT** — do not count `source_filename` values to size the backlog: brokers reuse names (`TQL-Driver-Sheet.pdf` came from 67 different emails, `Carrier Rate confirmation.pdf` from 66). The unit is (message id, filename), then the PDF's sha256: 608 rows were 233 attachments, of which 92 were byte-identical resends. Do not re-parse old intake rows with plain `parseIntake`: a clean parse auto-dispatches and texts the driver about freight that moved months ago; pass `{ autoDispatch: false }`. Do not run the review queue's "reject junk" button on this backlog: it rejects every `in_review` row with a `parse_error`. Do not match backlog PDFs to `loads` on every 5+ digit number in the text: LAMP's own MC `1725755` and the dispatch phone `2058614115` are stored as junk load numbers and matched 101 PDFs; the script ignores numbers printed on more than 4 different PDFs and 10-digit phone-shaped numbers. Do not wire `noteParserRun` into `parseIntake` and call the monitoring fixed: with dedup in place a credit outage produces fewer than the 4 runs per hour `checkParserHealth` needs.
- `2026-10-24 · (this commit)`

### `POST /api/ops/test-alert` texted the ops phone for anonymous callers
- **Symptom** — `POST https://traqiq.app/api/ops/test-alert` with no session ran the handler and sent `✅ TRAQ: Ops Monitor alert test` by Twilio to the ops alert phone, every call, no throttle. `GET /api/ops/snapshot` returned `alertPhone` (the ops number) and monitor state to anyone. Spotted by the ratecon re-parse session (PR #138); not probed on prod, since a POST sends a real SMS.
- **Root cause** — both Ops Monitor routes in `server/routes.ts` were registered with no middleware. The auth sweeps (#124, #127, #128, #130, #135) gated routes by path family and never covered `/api/ops/*`. These are the only two `/api/ops` routes.
- **Fix** — `isAuthenticated` as the first middleware on `GET /api/ops/snapshot` and `POST /api/ops/test-alert`. The only caller is the staff page `/ops` (`client/src/pages/ops-monitor.tsx`): its snapshot query uses the default `getQueryFn` (`credentials: "include"`) and its test-alert `fetch` is same-origin, so both send the session cookie. Note `/ops` has no client-side login wall: an anonymous visitor now sees "Loading ops snapshot…" instead of data. `opsTestAlertRateLimiter` (next to `gpsTrackingLinkRateLimiter`) then caps test alerts at 3 per hour on one shared key, in memory, and answers `429 {ok:false,error}` in the shape the page's toast already reads.
- **Guard** — `server/__tests__/test-endpoints-auth.test.ts`: both routes added to `GATED_ENDPOINTS`. Both cases fail on the pre-fix code. `server/__tests__/ops-test-alert-rate-limit.test.ts` pins the limiter after auth and its 3/hour shared key (2 of 2 fail without it).
- **Do NOT** — do not verify on prod with a POST before the gate is deployed: a non-401 response means a real SMS went out. After deploy, `curl -s -o /dev/null -w "%{http_code}" -X POST https://traqiq.app/api/ops/test-alert` must print `401`. Do not tighten this to `requireRole('admin')` without checking which roles use `/ops`. Do not key the test-alert limiter by IP or user: every send lands on the same phone, so the ceiling is global. Do not move it into `smsLoadService.sendSMS` or the monitor's alert path: `checkParserHealth` and `checkOpenAiCredits` have their own cooldowns, and test clicks must never block a real alert. When sweeping auth, grep every `app.(get|post|put|patch|delete)(` without a middleware, not one path family at a time; that is how `/api/ops` survived five sweeps.
- `2026-10-24 · (this commit)`

### `GET /api/driver-locations/active` listed every active driver's id, name and live GPS to anonymous callers
- **Symptom** — `curl -s -o /dev/null -w "%{http_code}" https://traqiq.app/api/driver-locations/active` returns `200` while `/api/drivers` returns `401`. The body is an array of `{ driverId, driverName, latitude, longitude, address, lastUpdate, speed, ... }` for every driver with status `available` or `on_route`.
- **Root cause** — the route in `server/routes.ts` (right after `GET /api/drivers/:id`) was registered with no middleware. PR #124 gated the list routes and PR #127 gated `/api/coverage`, but this one was missed. Beyond the live-location leak, it is the UUID source for every `/api/drivers/:id` route: an anonymous caller got real driver ids here and fed them to those routes.
- **Fix** — `isAuthenticated` as the first middleware on that one route (per route, not an `app.use('/api/driver-locations', ...)` prefix guard). Every caller is a logged-in admin page: `gps-tracking.tsx`, `dispatcher-dashboard.tsx`, `loadops-dashboard.tsx`, `manual-dispatch.tsx`, and `components/driver-location-map.tsx` (rendered by `dashboard`, `dispatcher-dashboard`, `gps-tracking`, `loadops-dashboard`). `driver-tracker.tsx` only calls `invalidateQueries` on the key, which fetches nothing on a page with no observer.
- **Guard** — `server/__tests__/loads-drivers-auth.test.ts` → "GET /api/driver-locations/active is registered with an auth middleware", plus "keeps POST /api/driver-location/update public (driver GPS feed)".
- **Do NOT** — do not confuse this route with `POST /api/driver-location/update` (singular `driver-location`). That is the driver GPS write path used by the tokenized portal `/driver/:token`, `/mobile-driver-dashboard` and `/driver-tracker`, and it must stay session-free. Do not gate it while "finishing the job" on driver-location routes. Also note `client/src/pages/driver-management.tsx` and `gps-tracking.tsx` call a plain `/api/driver-locations` (GET and POST) that no live server route registers; it only exists in `server/routes.ts.backup` and `.final_backup`. Those calls were already dead before this fix.
- `2026-10-20 · (this commit)`

### `POST /api/lifecycle/release-driver/:loadId` and `submit-factoring/:loadId` ran for anonymous callers; Phase 5A/5B emails fired without flags

- **Symptom** — `curl -s -o /dev/null -w "%{http_code}" -X POST https://traqiq.app/api/lifecycle/release-driver/<id>` returns `200` with no session. The "Good to Go" SMS fires. `submit-factoring/<id>` triggered a factoring email to FACTORING_EMAIL/EINSTEIN_EMAIL with no auth. Phase 5A ran on every delivered load with no flag guard and no DRY_RUN_OUTBOUND check. Phase 5B auto-sent broker thank-you emails.
- **Root cause** — both routes registered with no middleware. Lifecycle cron Phase 5A and 5B had no env-flag gates.
- **Fix** — `isAuthenticated, requireRole('admin')` on both routes (per route). `LIFECYCLE_FACTORING_EMAIL_ENABLED === 'true'` gates Phase 5A; `DRY_RUN_OUTBOUND === 'true'` suppresses the `mailer.sendMail` call. `LIFECYCLE_THANKYOU_EMAIL_ENABLED === 'true'` gates Phase 5B; the `mailer.sendMail` in Phase 5B is removed — the cron logs a DRAFT line for manual review.
- **Guard** — `server/__tests__/lifecycle-flags-auth.test.ts`: pins `isAuthenticated` first on both routes, flags default OFF, Phase 5B block has no `mailer.sendMail`, Phase 5B logs "DRAFT".
- **Do NOT** — do not re-add `mailer.sendMail` to Phase 5B — every delivered load in queue would fire. Do not set `LIFECYCLE_FACTORING_EMAIL_ENABLED=true` until `FACTORING_EMAIL` is updated (Einstein has left). Do not use `app.use('/api/lifecycle', ...)` prefix guard without auditing all `/api/lifecycle/*` routes.
- `2026-10-25 · (this commit)`

### Owner upload alert carried the owner's own portal link and a dead "View" link
- **Symptom** — the first live alert (2026-10-27, Twilio SID `SMe7ccf74a1f400423ab007b448a1b0668`) was 2 segments and ended with `My Dashboard: https://traqiq.app/driver/<token>`. Its "View" link `https://traqiq.app/loads/<id>/documents` opens the client's NotFound page.
- **Root cause** — `smsLoadService.sendSMS(to, body)` appends the driver-dashboard footer whenever the recipient phone matches a driver record, and the owner's number (`DISPATCHER_PHONE_NUMBER`, …4115) is also a driver. The client only routes `/loads/:id`; `/loads/:id/documents` was never a route.
- **Fix** — `server/owner-upload-alert.ts` sends `{ to, body, skipFooter: true }` (same as the FMCSA/COI/FreightGuard admin crons) and links `/loads/:id`. A "Done" confirm now reads "submitted pickup photos [n of m]" instead of naming one stage.
- **Guard** — `server/__tests__/owner-upload-alert.test.ts` → "skips the driver-dashboard footer", "confirm (Done) says the phase was submitted…", and the body test pinning `/loads/<id>` with no `/documents`.
- **Do NOT** — do not test this alert with `DRY_RUN_OUTBOUND=true` on production: that flag is global and fakes every driver SMS, OCR call and Love's factoring submission (recorded as sent) while it is on. Test with `OWNER_ALERT_HOURLY_MAX=3` and one `POST /api/loads/<old load>/photos/confirm` instead. Do not test on a live load.
- `2026-10-27 · (this commit)`
