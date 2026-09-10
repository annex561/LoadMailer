# LAMP split-authority program — the MC-aging lease

**What it is.** A leased owner-operator who holds his own active MC runs part of his
weeks under LAMP's authority and part under his own. He earns while his authority
ages into something brokers will book.

**Who it's for.** New-entrant MC holders, roughly 0 to 12 months from authority
grant, who cannot get booked because brokers gate on tenure, whose insurance is
priced at new-entrant rates, and who are burning cash waiting.

**Why the driver takes it.** He keeps his MC active and, more importantly, keeps
building real operating history under it. An MC that sits at zero loads does not age
into anything a broker respects. Running some loads under his own authority with his
own rate confirmations, his own invoices, and his own loss runs is what actually
seasons it.

**Why LAMP wants it.** Access to a seasoned MC is the one thing this driver cannot
buy at any price. It is a recruiting lever no rate increase can match, and it puts
trucks on LAMP's loads without LAMP financing equipment.

---

## 1. What already exists in this repo

| Asset | Path | Use it for |
|---|---|---|
| Driver IC agreement | `docs/docuseal-templates/01-traqiq-driver-ic-agreement.md` | base terms |
| DOT driver application | `docs/docuseal-templates/02-dot-driver-application.md` | DQ file |
| Drug/alcohol consent | `docs/docuseal-templates/03-drug-alcohol-consent.md` | DQ file |
| Clearinghouse consent | `docs/docuseal-templates/04-clearinghouse-consent.md` | DQ file |
| PSP disclosure | `docs/docuseal-templates/05-psp-disclosure-authorization.md` | DQ file |
| Previous employer release | `docs/docuseal-templates/06-previous-employer-safety-release.md` | DQ file |
| Certificate of violations | `docs/docuseal-templates/07-certificate-of-violations.md` | DQ file |
| Road test / CDL in lieu | `docs/docuseal-templates/08-road-test-or-cdl-in-lieu.md` | DQ file |
| Settlement + direct deposit | `docs/docuseal-templates/09-settlement-and-direct-deposit.md` | pay setup |
| W-9 field map | `docs/docuseal-templates/10-w9-field-map.md` | pay setup |
| Occ/acc acknowledgment | `docs/docuseal-templates/11-occupational-accident-acknowledgment.md` | insurance |
| Equipment receipt / return | `docs/agreements/equipment-lease-truckllc-to-lamp.md` Exhibits A and B | **per-trip receipts, reuse as-is** |
| New-entrant target list | `docs/fmcsa-new-entrant-call-sheet.csv` | 200 carriers with authority dates and phones |

## 2. The one thing that is missing, and it is structural

`docs/agreements/equipment-lease-truckllc-to-lamp.md` **cannot be used for this
program as written.**

Section 3 grants LAMP "exclusive possession, control, and use" for the **entire
24-month term** (`376.12(c)(1)`). That is correct drafting for a full-time lease and
it is exactly what forecloses the driver from running his own authority. Sign that
document and the 50/50 is a breach of your own lease on day one.

Section 5 also puts **all** operating costs including insurance on LAMP for the whole
term, which is the wrong economics here.

**What to build instead: a Master Trip Lease Agreement.**

- Master agreement signed once. Sets compensation, chargebacks, insurance
  requirements, safety obligations, non-circumvention, termination.
- **The lease term is the individual trip, not a span of months.** Exclusive
  possession attaches when the trip lease is executed and releases when the equipment
  return receipt is signed.
- Each load gets a one-page trip addendum: load number, origin, destination, dates,
  agreed compensation, and both receipts.
- Between trips the driver is released and runs his own authority. No conflict,
  because exclusive possession never spanned that window.

Exhibits A and B in the existing equipment lease are already drafted as possession
and return receipts. Lift them into the trip addendum unchanged.

> **Counsel check on the existing document.** The `376.12` subsection citations in
> `equipment-lease-truckllc-to-lamp.md` look scrambled against the regulation as
> published. Insurance is `376.12(j)`, chargebacks are `(h)`, copies of the rated
> freight bill are `(g)`, the 15-day payment period is `(f)`, escrow is `(k)`, and
> the receipt requirement lives in `376.11(b)` rather than in `376.12` at all. Have
> counsel map every heading before either document is signed.

---

## 3. Step-by-step: onboarding a split-authority owner-operator

**Step 1 — verify his authority is real and active.**
Pull his DOT on SAFER. Confirm: operating authority ACTIVE, no out-of-service order,
MCS-150 current, and a BMC-91X on file under his own MC. If his own filing is not
active, he does not have an authority to age and this program does not apply.

**Step 2 — confirm the plate.**
Ask whose IRP apportioned account the truck is registered under. For a split it must
be **his**, not LAMP's. If LAMP plated the truck, he cannot legally run his own
authority on it and the whole structure collapses. Fix this before anything else.

**Step 3 — collect the insurance package.** See section 4. Do not proceed on a
certificate alone.

**Step 4 — build the DQ file.** Templates 02 through 08 above. He is operating under
LAMP's authority half the time, so LAMP owns a complete driver qualification file on
him exactly as it would for any leased driver. There is no exemption because he has
his own MC.

**Step 5 — sign the Master Trip Lease.** Not the 24-month equipment lease.

**Step 6 — set up the ELD for two carriers.**
Motive and Samsara both support multi-carrier profiles. He switches the operating
carrier in the app per trip. His hours-of-service clock does **not** reset when he
switches authority. It follows the driver.

**Step 7 — issue removable markings.**
`390.21` requires the CMV to display the name and USDOT number of the carrier
operating it. Magnetic panels or a slide-in placard frame. LAMP's panel goes on when
the trip lease is executed and comes off when the return receipt is signed. Buy him
two sets and keep a spare in the truck.

**Step 8 — split the IFTA reporting.**
Miles run under LAMP's authority report on LAMP's IFTA account. Miles under his
authority report on his. Agree in the Master how the trip odometer readings get
captured and to whom, or this becomes an audit problem in a year.

**Step 9 — set the graduation date.** See section 7.

---

## 4. Insurance: exactly what to require

He pays for and owns his policy. LAMP pays for and owns LAMP's. Neither policy
carries the other's federal filing. That separation is what makes the split legal and
clean.

### LAMP maintains, regardless

| Coverage | Limit | Filing |
|---|---|---|
| Primary auto liability | `$1M` CSL | BMC-91X under MC-1725755 |
| Cargo | `$100K` | BMC-34 |
| General liability | `$1M` | broker requirement |

His unit is scheduled on LAMP's policy for the periods it runs under LAMP's
authority. Tell your agent it is a trip-lease arrangement, in writing, before the
first load.

### He maintains, and proves before the first dispatch

| Coverage | Limit | Note |
|---|---|---|
| Primary auto liability on his own MC | `$1M` CSL | his filing, his authority |
| Physical damage on the tractor | stated value | **LAMP as loss payee** |
| Non-trucking liability / bobtail | `$1M` | |
| Occ/acc or work comp | `$1M` accident medical, `$500K` AD&D | template 11 |
| Cargo on his own authority | `$100K` | his loads, his problem, but verify |

### The four asks on HIS policy — demand the endorsement form, not the certificate

1. **LAMP as additional insured.** ISO `CA 20 48` (Designated Insured) or the
   insurer's proprietary equivalent on Progressive or Northland paper.
2. **Primary and non-contributory.** Without this wording the two policies share a
   loss pro-rata, LAMP's policy takes a hit, and LAMP's loss runs get damaged at
   renewal. This is the clause that protects your pricing.
3. **Waiver of subrogation.** Stops his insurer from paying a claim and then coming
   back at LAMP to recover.
4. **30-day notice of cancellation**, mailed **and** emailed direct to LAMP, not to
   his agent.

A certificate of insurance proves coverage existed on the day it printed. It is
evidence, not coverage. The endorsement form is the coverage. Most agents will send
the certificate with LAMP in box 22, which is the certificate holder line, and that
buys nothing.

### What additional insured status does NOT cover

It typically reaches liability "arising out of the named insured's operations."
Negligent hiring, negligent supervision, and negligent entrustment are pled against
the motor carrier in every serious case and may fall outside it. That exposure is
LAMP's own policy's job. Do not let the AI endorsement talk you into thinning your
own coverage.

### The screening value

The whole package usually costs him between `$0` and `$250`. A real owner-operator
with a real agent turns it around in a day. An agent who stalls, sends a certificate
instead of the endorsement, or says "we don't do that" is telling you something about
the driver. **Make it a standard requirement and let it sort the applicants.**

---

## 5. Per-load sequence

1. LAMP offers the load.
2. Driver accepts. Trip addendum generated with load number and dates.
3. Both sign. Equipment receipt (Exhibit A) executed. **Possession transfers to LAMP
   at this timestamp.**
4. LAMP's placards go on. Driver switches ELD to LAMP's carrier profile.
5. Load runs under LAMP's authority, LAMP's insurance, LAMP's BOL.
6. Delivery. POD in. Return receipt (Exhibit B) executed. **Possession returns to the
   driver at this timestamp.**
7. Placards off. ELD back to his own carrier profile.
8. He runs his own loads until the next offer.

**The receipts are the most important documents in this program.** If there is a
crash, the receipt timestamps are what prove whose authority was operative. Without
them, both carriers get pulled into the same lawsuit and neither can prove it was the
other one. Never let a load run without both.

---

## 6. Pricing

Do not give away access to a seasoned MC. It is the thing he cannot buy.

**Option 1 — margin on the load.** LAMP books, LAMP pays the driver a percentage.
Standard leased-O/O splits run 70 to 88 percent to the driver depending on who
carries what. Your margin is the fee.

**Option 2 — no flat weekly insurance deduction.** This is the pitch. Most carriers
deduct `$175` to `$260` a week whether the truck moved or not. Bake your insurance
cost into the load split instead, so he pays only in weeks he earns. That is the
line that closes drivers who got burned somewhere else.

**Be honest with him about the math.** Two authorities means two policies. That does
not go away. What goes away is paying a flat weekly deduction during a week he sat.
Do not sell it as eliminating a premium, because it does not, and he will find out.

---

## 7. The graduation funnel — decide this on day one

At 6 to 12 months his MC becomes bookable and he leaves. Plan for it or lose him.

| Stage | Months | What he runs | What LAMP earns |
|---|---|---|---|
| Intake | 0 to 3 | mostly LAMP's authority | load margin |
| Split | 3 to 9 | roughly 50/50 | load margin on your half |
| Graduation | 9 to 12+ | mostly his own | **dispatch fee, 6 to 8 percent** |

Convert him at graduation instead of losing him. He already trusts your load sourcing
and he has no back office. Dispatching him under his own authority carries zero
insurance exposure and zero CSA exposure for LAMP, and the margin is clean.

Build it into the pitch from day one so graduation reads as a promotion, not a
defection.

## 8. Protect the book

He has his own MC and he will see your brokers, your lanes, and your rates. `376.12`
even entitles him to a copy of the rated freight bill on request.

- Non-circumvention on named customers, 18 months post-termination, in the Master.
- Keep broker identity out of the dispatch payload where the load economics allow it.
- Track which of your customers he has touched.

## 9. Recruiting

`docs/fmcsa-new-entrant-call-sheet.csv` already holds 200 carriers with the officer
name, phone, email, truck count, authority grant date, and DOT number. Sort by
authority date. The ones granted in the last 90 days are the exact profile: an active
MC, a truck, and no way to book it.

The opening line writes itself. They are sitting on an authority they cannot use.

---

## 10. Watch-outs

| Item | Why it bites |
|---|---|
| IRP plate in LAMP's name | he cannot run his own authority on it, structure collapses |
| HOS clock | shared across both authorities, a 50/50 driver is half a truck to you |
| MCS-150 | if his lapses, his authority deactivates and the program stops |
| IFTA | miles split across two accounts, agree the capture method up front |
| Decal swap | an inspector watching a mid-trip swap is a red flag, do it at the receipt |
| His own filing lapses | his authority dies, he becomes a normal leased O/O overnight |

The COI lapse monitor spec'd in `docs/specs/coi-lapse-monitor-spec.md` covers the
last one and the insurance expirations. The existing FMCSA monitor
(`server/fmcsa-monitor-cron.ts`) already watches authority status and MCS-150
staleness and takes a DOT number from config, so pointing a second instance at a
leased driver's DOT is a small extension rather than a new build.
