# Love's Financial — Factoring Submission Process

Source: Email from Joselin Villalobos (Love's Financial), Apr 23 2026, 12:04 PM
+ Notice of Sale and Assignment of Accounts (Docusign env 169688C4-877F-42D9-8CFC-16C277EB83D0, signed 6/4/2025)
+ Sample Schedule#204 confirmation document, 5/7/2026.

## LAMP entity details

- **Legal entity:** Lamp, PLLC
- **Address:** 3300 Wilcox Blvd, Chattanooga, TN 37411
- **MC#:** 1725755
- **US DOT#:** 4397421
- **Love's client code:** `LAMP01`
- **Authorized signatory:** Annex Luberisse (signature on file via Docusign — appears on the NOA)

## Notice of Assignment — REMIT-TO addresses brokers must use

Effective date of assignment: **6/4/2025**

Brokers (debtors of LAMP) must pay Love's, not LAMP. Notice of Assignment language for invoices:

> Per Notice of Sale and Assignment of Accounts dated 6/4/2025, Lamp, PLLC has assigned this and all present/future accounts receivable to Love's Solutions, LLC d/b/a Love's Financial. Payment must be made solely to Love's. Payment to any party other than Love's will not discharge your obligation.

### Mail remit
```
Love's Solutions, LLC
PO BOX 96-0479
Oklahoma City, OK 73196-0479
```

### Wire / ACH remit
```
Bank of Oklahoma
ABA: 103900036
ACCT: 308773140
```

### Dispute escalation
- Email: `cashdeptls@loves.com`
- Phone: 405-463-8888

This NOA block must be printed on every LAMP-generated invoice we send out (both to the broker and inside the factoring packet to Love's).


## Submission channel

- **Method:** Email only (no API, no portal)
- **To:** `schedulesLS@loves.com`
- **Format:** Single PDF per load (merged from multiple source documents — see required order below)
- **Subject line MUST include:**
  - Our client code: **`LAMP01`** — OR — our company name (`LAMP Logistics`)
  - Our preferred payment method
- Suggested subject format: `LAMP01 — <preferred_payment_method> — Load #<load_number>`

## Required document order INSIDE the PDF (Love's specifies this strictly)

The merged PDF must have pages in this exact sequence:

1. **Bill of Sale (signed)**
2. **Invoice** (only if we generate our own — Love's accepts our format)
3. **Rate Confirmation**
4. **BOL / POD** (Bill of Lading / Proof of Delivery)
5. **Any pages accompanying the BOL/PODs** (packing lists, inspection sheets, etc.)
6. **Any accessorials** (Lumper receipts, unloading receipts, etc.)

If a section doesn't apply for a given load, it gets skipped — do not insert a blank or placeholder page.

## Account contact

- **Joselin Villalobos** — Bilingual Account Representative II
- Email: `joselin.villalobos@loves.com`
- Phone: (405) 847-2199
- Fax: (405) 936-7147
- Website: https://Loves.com/freight-factoring

## Resources Love's recommends (for manual submission)

- Merge PDFs online: https://tinyurl.com/3wrdfm77
- iPhone scanning: https://support.apple.com/en-us/HT210336
- Android scanning: https://support.google.com/drive/answer/3145835
- Recommended app: GeniusScan

These are for manual flow only — our automated pipeline merges PDFs server-side.

## Funding terms (from sample Schedule#204 dated 5/7/2026)

- **Cutoff time:** **11:00 AM** — packets received before 11 AM CT are funded same-day. After 11 AM rolls to next business day. The submission pipeline MUST prioritize hitting this window.
- **Advance:** **100%** of invoice gross. The "Reserve / Escrow" column on Love's purchase document shows `0.00` — they don't hold a reserve.
- **Fees:** ~3.5% taken upfront. Sample packet: $5,425.00 invoiced → $189.88 fee → $5,235.12 advanced.
- **Recourse:** Implied recourse based on standard small-fleet Love's terms — Love's "Threat" ACH coding suggests an active chargeback path. Confirm against signed agreement when available.
- **Payout:** ACH to LAMP's account, line labeled `Bank Acct - Threat - ACH - SP / LAMP / Coded as Remaining`.
- **Invoice numbering:** Love's assigns its own invoice IDs (`LF1162`, `LF1163`, etc.) on receipt — we send our own internal invoice but they re-label.

## Confirmation document — what Love's sends back

Format: PDF attachment titled / footer-tagged as `*PurDoc07` (Purchase Document type 07 / Schedule). Sent via email to the same mailbox we submitted from (or a notification address — to confirm).

### Fields in the confirmation PDF (sample structure):

```
Love's Solutions, LLC                       Schedule#204
Client: Lamp, PLLC (LAMP01)                 Purchased: May 07, 2026

Invoice #   Debtor                                    PO#          Date        Amount     Reserve/Escrow
LF1162      Total Quality Logistics (TQL) (TOTA4020900) 36630889   5/7/2026    1,875.00   0.00
LF1163      Total Quality Logistics (TQL) (TOTA4020900) 36601457   5/7/2026    2,300.00   0.00
LF1199      MVP Worldwide Logistics LLC (MVPW1177201)   AIS13035940 5/7/2026   1,250.00   0.00
                                                                              5,425.00   0.00

Payouts other than to the default client account:
Bank Acct - Threat - ACH - SP   LAMP   Remaining   5,235.12

Total of Invoices Sold:   5,425.00
Fees Earned:              (189.88)
Amount Advanced:          5,235.12
Amount Owed/Paid to Client: 5,235.12

Printed: May 7, 2026, 4:59 PM (*PurDoc07)   Page 1 of 1
```

### Field mapping (confirmation → our DB)

| Love's field | Our field |
|---|---|
| `Schedule#` | New `factoring_submissions.schedule_id` (groups multiple invoices in one funding event) |
| `Invoice #` (LF####) | `factoring_submissions.loves_invoice_id` per load |
| `Debtor` | should match `loads.brokerName` (fuzzy: "Total Quality Logistics (TQL) (TOTA4020900)" vs "TQL" or "Total Quality Logistics") |
| **`PO#`** | **maps to our `loads.loadNumber`** — primary key for matching the funded invoice back to a load |
| `Date` | confirmation date / purchase date |
| `Amount` | gross factored amount |
| `Reserve/Escrow` | normally 0.00; non-zero would indicate a held-back portion |
| `Amount Advanced` | what actually hit our bank (gross minus fee) |
| `Fees Earned` | per-packet fee total |

### Parser logic for the inbound confirmation

1. Watch the SMTP/IMAP inbox for emails from Love's (sender domain TBD — likely `loves.com` or `lovesfinancial.com`).
2. Detect the PDF attachment with `*PurDoc07` in the print footer.
3. Extract the line items table.
4. For each line: look up our load by `PO# → loads.loadNumber` and update its `factoring_status = funded`, `factoring_funded_at`, `factoring_amount_advanced`, `factoring_loves_invoice_id`, `factoring_schedule_id`.
5. If a PO# can't be matched, log a warning and queue for manual review (but never block the rest).

## Implementation notes for future plan (not yet built)

- Build a `submitLoadToLoves(loadId)` function that:
  1. Pulls all docs attached to the load (signed RateCon, BOL, POD, lumper receipts, etc.) from object storage
  2. Generates a Bill of Sale and Invoice PDF for this load
  3. Merges into one PDF in the order Love's requires
  4. Sends via SMTP to `schedulesLS@loves.com` with the proper subject line
  5. Records the submission in a `factoring_submissions` table for audit + dedup
- Trigger options (decide in plan phase):
  - Auto-submit on `status = delivered` (per dispatcher request)
  - Manual queue-for-review with one-click submit (safer default)
- Required safety rails per the new approval rule:
  - Default OFF, opt-in via env var `LOVES_AUTO_SUBMIT=true`
  - One submission per load lifetime (dedup on `load_id` in `factoring_submissions`)
  - Rate ceiling (max N submissions per hour)
  - Kill switch env var `FACTORING_DISABLED=true`
