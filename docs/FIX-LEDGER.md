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
