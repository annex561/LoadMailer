# TRAQ-IQ — Carrier Defense Kit (feature spec)

Status: spec / not built. Author: owner + Claude. Date: 2026-06-16.

## Why

Every carrier on TRAQ-IQ faces the same threat that just hit LAMP PLLC: a broker files a
Carrier411 **FreightGuard** report (often false, often retaliatory), a **72-hour clock** starts, and
if the carrier doesn't respond in time it locks onto a near-permanent record and dries up their
loads. The defense is a known, repeatable drill — detect fast, draft the rebuttal + demand,
escalate. We just ran that drill by hand for LAMP. Productize it.

This also rides on what we already built: the **FMCSA monitor** (`server/fmcsa-service.ts`,
`server/fmcsa-monitor-cron.ts`, `fmcsa_carrier_snapshots`) already watches authority / OOS /
MCS-150 per DOT. The Defense Kit adds the FreightGuard half + the response tooling on top.

## Components

1. **Reputation Monitor** (have: FMCSA half; add: FreightGuard half)
   - FMCSA: daily SAFER check per carrier DOT (built).
   - FreightGuard: ingest Carrier411 notification emails (`no-reply@carrier411.com`). Parse MC,
     broker, allegation, 10-digit response code, and the 72-hour deadline into a `freightguard_cases`
     row. A dedicated inbox + IMAP/Gmail-watch, or a per-carrier forwarding rule.

2. **72-hour war room** — a case page per FreightGuard with a live countdown, the parsed allegation,
   and a one-tap "Defend this."

3. **Auto-draft engine** — generates (a) the `carrierresponse.com` text (≤500 chars) and (b) a
   formal demand letter PDF on the carrier's letterhead, pre-filled from the load: ratecon #, pickup
   time/zone, the broker's own words, and the carrier's call log. Same template we hand-built for
   LAMP. Human-review before it's surfaced.

4. **Evidence binder** — auto-pulls the load's ratecon, BOL/POD, detention in/out times, and call
   logs into one packet attached to the case. TRAQ-IQ already stores most of this.

5. **Escalation** — if the broker refuses inside 72h: route to a vetted flat-fee transport attorney
   / LegalShield-type partner (see Move 2 research). Referral + the prebuilt evidence binder.

## 8-point system-thinking checklist

1. **Customer experience.** Carrier gets an instant alert (SMS + in-app) the moment a FreightGuard
   hits their MC or their FMCSA status changes. One tap → a case page with the countdown and a
   pre-drafted response. The hard moment (panic + a ticking clock) is met with the answer already
   written.
2. **How they find it.** A "Reputation" card on the carrier dashboard; an onboarding step that
   connects monitoring; and the alert itself is the entry point.
3. **Where it lives.** New "Reputation / Defense" section in the carrier portal. Not a floating
   orphan — it sits beside Loads and Compliance.
4. **How the owner/admin finds it later.** Admin "Reputation Monitor" overview lists every carrier's
   MC status and any open FreightGuard cases, with age + countdown.
5. **Where admin edits/manages.** `/admin/reputation`: per-carrier monitor on/off, the case queue,
   and a template editor for the rebuttal + demand letter. Env flags documented in `.env.example`.
6. **Customer-facing workflow.** Alert → 72h countdown → guided respond (file at carrierresponse.com
   + send demand letter) → mark outcome (removed / rebutted / locked). Outcome feeds a case-study log.
7. **Internal workflow.** Admin notified of any FreightGuard on a platform carrier. Human-review
   queue gates every auto-drafted letter before the carrier sees it (no auto-send of legal text).
   Escalation hand-off to the attorney partner.
8. **How it connects.** Reuses loads / ratecon / BOL / call-log data, the `fmcsa_carrier_snapshots`
   table, the SMS service, the DocuSeal hub for letter delivery/signature, and audit logs. Schema
   FK from `freightguard_cases` → `carriers` and → `loads`.

## Financial-impact guardrails (CLAUDE.md)

Every new alert path is a new outbound path → default OFF, per-case dedup, boot watermark, rate
ceiling, kill switch, log every send-or-suppress. Same pattern the FMCSA monitor already follows.
Auto-draft NEVER auto-sends legal text — human review is mandatory.

## Phased build

- **Phase 1 (have):** FMCSA monitor live for the operator's own DOT. Prove the alert path.
- **Phase 2:** FreightGuard email ingestion + `freightguard_cases` + the war-room case page +
  countdown. This is the piece that just proved its value.
- **Phase 3:** Auto-draft engine (response text + letterhead PDF from load data) + evidence binder.
- **Phase 4:** Multi-carrier + admin overview + attorney-referral escalation. Turn it into a paid
  feature / retention hook.

## Monetization

Bundle into a paid tier or per-MC monitoring add-on. The wedge: "we caught the report and had your
rebuttal written before the 72-hour clock ran out." Cross-sells the attorney referral and the
DocuSeal contract hub. Sticky — a carrier won't leave the platform that guards their authority.
