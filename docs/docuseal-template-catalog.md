# DocuSeal Template Catalog — Cross-Business Signing Hub

Hub: https://docuseal-production-ca61.up.railway.app · Owner account: ANEX Holdings
Status: OSS live on Railway volume. Brand teams + API push unlock on Pro. R2 storage pending 1 token.

Each template below lists: **fields** (what the signer/sender fills), **signing flow** (who signs in what order), and **trigger** (what event in the source app fires the send). Trigger column is the spiderweb — it's where DocuSeal wires back into each business.

---

## TEAM 1 — TRAQ-IQ (trucking)

| Template | Fields | Flow | Trigger |
|---|---|---|---|
| Independent Contractor Driver Agreement | driver legal name, address, DOB, CDL #, CDL state, MC/DOT, truck unit #, pay %/rate, effective date | Driver signs → Carrier countersigns | Driver onboarding start |
| W-9 (owner-operator) | name, business name, TIN/SSN, address, entity type, signature | Driver signs | Onboarding, before first settlement |
| Drug & Alcohol Consent (DOT 49 CFR Part 382) | driver name, CDL #, consent checkbox, signature, date | Driver signs | Onboarding |
| Advance / Repayment Agreement | driver name, advance amount, repayment schedule, deduction-per-settlement, signature | Driver signs → Carrier countersigns | When an advance is requested |
| Carrier–Broker Agreement | broker name, MC#, carrier name, MC#, commodity, rate, accessorials, signature | Carrier signs → Broker signs | New broker relationship at dispatch |
| Equipment Lease (lease-purchase drivers) | unit #, VIN, weekly lease, term, buyout, signature | Driver signs → Carrier countersigns | Lease-op onboarding |

**Driver onboarding set — written and ready to paste.** Template bodies with field tags live
in `docs/docuseal-templates/`, numbered 01–11. The DQ-file forms (application, drug &
alcohol, Clearinghouse, PSP, prior-employer release, certificate of violations, road test)
are federally required for **1099 contractors too** — FMCSA §390.5 counts a contractor as an
"employee" while operating a CMV under your authority.

| # | Template | File |
|---|---|---|
| 01 | Independent Contractor Driver Agreement | `01-traqiq-driver-ic-agreement.md` |
| 02 | Driver's Application for Employment (§391.21) | `02-dot-driver-application.md` |
| 03 | Drug & Alcohol Consent + Policy Receipt (Part 382) | `03-drug-alcohol-consent.md` |
| 04 | Clearinghouse Limited Query Consent | `04-clearinghouse-consent.md` |
| 05 | PSP Disclosure & Authorization (FCRA) | `05-psp-disclosure-authorization.md` |
| 06 | Previous Employer Safety Release (§391.23) | `06-previous-employer-safety-release.md` |
| 07 | Certificate of Violations (§391.27) | `07-certificate-of-violations.md` |
| 08 | Road Test, or CDL in Lieu (§391.31/.33) | `08-road-test-or-cdl-in-lieu.md` |
| 09 | Settlement Terms + Direct Deposit | `09-settlement-and-direct-deposit.md` |
| 10 | Form W-9 field map (over the official IRS PDF) | `10-w9-field-map.md` |
| 11 | Occupational Accident Acknowledgment (1099 only) | `11-occupational-accident-acknowledgment.md` |
| 12 | Equipment Lease Agreement (49 CFR Part 376) | `12-equipment-lease-376.md` |
| 13 | Receipt for Equipment (§376.11(b), in and out) | `13-equipment-receipt.md` |
| 14 | Owner-Operator Settlement + Direct Deposit | `14-oo-settlement.md` |
| 15 | Insurance Requirements + Certificates (§376.12(j)) | `15-oo-insurance.md` |
| 16 | Trip Lease Addendum — **Box Truck** (split-authority O/O, per load) | `16-trip-lease-addendum.md` |
| 17 | Trip Lease Addendum — Tractor-Trailer (same, semi variant) | see §Template 17 in `16-trip-lease-addendum.md` |
| 17 | Trip Lease Addendum — tractor-trailer, per load | *built, field map not written* |

**Two packets, not one.** 01–11 onboard a driver on the Independent Contractor Driver
Agreement. **12–15 are the owner-operator set** and replace 01 and 09: a lessor furnishing
equipment signs the Part 376 lease, its possession receipt, the owner-operator settlement,
and the insurance form. The DQ file (02–08) is identical on both paths, because the lessor
drives under LAMP's authority and 49 CFR Part 391 applies the same way. `build_templates.rb`
already encodes this split as `OWNER_OP`.

**Built and ready to upload.** `docs/docuseal-templates/pdf/` holds all sixteen as PDFs with
DocuSeal text tags baked into the text layer — 110 fields, each carrying its name, role,
and type. Upload and DocuSeal creates every field automatically; no drag-and-drop. Source
is `build/source.html`, rebuilt with `python3 build/build.py`. See `pdf/README.md` for the
upload steps and the env vars that connect it back to `server/recruiting/vendors.ts`.

Bundle 02–11 into **one** multi-document submission so the driver gets a single link.
Field names are shared across documents on purpose, so DocuSeal carries his name and CDL
across all nine instead of asking nine times. Restrict the folder: 09 holds bank details,
and 02/05/06/10 hold full SSNs.

**Paper fallback, live now.** `docs/driver-onboarding-packet/` holds the same forms as a
13-page signable PDF plus the copy-paste send sheet, for use before the DocuSeal templates
are built.

**Discovery / admin (system-thinking checklist):** sends fire from the driver record in TRAQ-IQ; signed PDF returns via webhook and attaches to that driver's profile. Admin finds them under the driver detail page → Documents tab. Editing a template = DocuSeal → TRAQ-IQ team → Templates.

---

## TEAM 2 — Echo IQ (Meta ads SaaS)

| Template | Fields | Flow | Trigger |
|---|---|---|---|
| Master Services Agreement (MSA) | client legal entity, signer name/title, fee, term, start date, signature | Client signs → Echo IQ countersigns | Lead converts to customer |
| Ad Account Access Authorization | client business name, Meta BM ID, ad account ID, authorized scope, signature | Client signs | Immediately after MSA — gates activation |
| Order Form / SOW | plan tier, monthly fee, ad-spend ceiling, add-ons, signature | Client signs → Echo IQ countersigns | Upsell / plan change |
| DPA (data processing addendum) | entity, data scope, sub-processors, signature | Client signs | EU/regulated clients at signup |

**Spiderweb:** the Ad Account Access Auth is the activation accelerator — embed the signing link directly in Echo IQ's onboarding so time-to-first-ad compresses. (Embedding needs Pro API.)

---

## TEAM 3 — ANEX Home Services (contractor)

| Template | Fields | Flow | Trigger |
|---|---|---|---|
| Estimate / Proposal Acceptance | customer name, address, scope, price, deposit, start window, signature | Customer signs | Estimate sent |
| Independent Subcontractor Agreement | sub name, trade, license #, insurance, rate, signature | Sub signs → ANEX countersigns | Onboarding a sub |
| Change Order | job ref, original price, change description, price delta, new total, signature | Customer signs | Mid-job scope change — the dispute shield |
| Lien Waiver (conditional/unconditional progress + final) | job, amount, through-date, claimant, signature | Sub/supplier signs | Each progress payment + final |
| Warranty / Completion Sign-Off | job, completion date, warranty terms, signature | Customer signs | Job close |

**Spiderweb:** Annicks' contractor network runs on paper today. A branded "tap to sign" link on a phone closes jobs faster and builds a defensible paper trail. Highest near-term signing volume after driver onboarding.

---

## TEAM 4 — Outbound / Sales Infra

| Template | Fields | Flow | Trigger |
|---|---|---|---|
| Mutual NDA | counterparty entity, signer, effective date, term, signature | Both sign | Before sharing scope/data |
| Client Services Agreement | client, services, fee, term, signature | Client signs → countersign | Deal close |
| Referral / Rev-Share Agreement | partner, % or flat, payout terms, signature | Both sign | New referral partner |

---

## Build order (once Pro is active)

1. **TRAQ-IQ driver onboarding packet** (rows 1–3 bundled into one multi-doc submission) — highest frequency, you control both sides.
2. **ANEX estimate acceptance + change order** — fastest revenue impact for Annicks' crew.
3. **Echo IQ MSA + Ad Account Auth** — embed in SaaS onboarding.
4. Everything else as volume warrants.

Each is one template built once, branded per team. Build once, reuse across the portfolio.

## Legal note
These are operational first-draft structures, not reviewed contracts. Run the actual clause language (especially driver IC classification, lien waivers, and the DPA) through the Legal Council / counsel before first real send.
