# TASKS.md

Plain-text action tracker for TRAQ-IQ business + build work. Each section is dated and appended by the `captain` skill after a planning session. Do not overwrite past sections.

---

## 2026-06-07 — Lease-to-Own Owner-Operator Program

**Frame:** Launch a lease-to-own driver program. Put drivers in company-owned trucks on a 36-month lease-to-own, running on the company's seasoned MC authority (the moat: eliminates the 6-12 month new-authority "death valley"). Freight must lead trucks 1:1.

Artifacts: `docs/lease-to-own-term-sheet.md`, `docs/driver-offer-sheet.md`

### Ship this week
- [ ] **Finish SAM.gov registration** — free, mandatory for any government freight (UEI number). Unlocks USPS HCR routes, FEMA surge, GSA/military via 3PLs. Part of the freight floor.
- [ ] **OOIDA membership + free lease-purchase review** — call 816-229-5791, Business Assistance Unit. ~$45/yr membership, complimentary agreement review. Use their (hostile) scrutiny as a free stress test. Hand them the term sheet.
- [ ] **Fill the brackets in the term sheet** — company legal name, OTR-experience minimum, real insurance quote (the $1,500 = one month of actual quoted rate).
- [x] **Driver landing page built + branded (LAMP Logistics) + Netlify Forms wired** → `recruiting/index.html`. Verified rendering.
- [ ] **Deploy landing page to Netlify** (drag `recruiting/` to app.netlify.com/drop) → set Forms notification email to dispatch@lampslogistics.com → optional custom domain.
- [ ] **Post the landing page URL** to recruiting channels (trucking Facebook groups, CDL school job boards, truck stops). Expect more interest than trucks.

### Build soon (2-4 weeks)
- [ ] **Stand up separate LLC for the leasing arm** — isolate lease-to-own liability from the operating carrier. Few hundred dollars. Before first contract.
- [ ] **Attorney finalize** the binding Lease-Purchase + Independent Contractor Operating Agreement — after OOIDA review. ContractsCounsel ~$660 review, filter by operating state. Confirm Part 376 + state lease-purchase law + classification language.
- [ ] **Build the freight floor** — Amazon Relay (done ✓) + government (SAM.gov) + 1-2 dedicated lanes (Saia / direct shippers). Floor must cover truck fixed costs + 20% before adding spot.
- [x] **53' TL shipper target list** → `docs/shipper-target-list.md`. NOTE: tractor-trailer freight — for FUTURE scale into semis, NOT box trucks.
- [ ] **EQUIPMENT LOCKED: 26ft box truck w/ liftgate** (non-CDL). Freight strategy = final-mile big-and-bulky + expedite, NOT 53' TL.
- [ ] **Box-truck freight onboarding THIS month** → final-mile big-and-bulky (Home Depot/Lowe's/Wayfair/furniture last-mile via J.B. Hunt Final Mile, Ryder Last Mile, AIT, etc.) + Sylectus / expedite networks + maximize Amazon Relay box loads. See `docs/box-truck-freight-sources.md`.
- [ ] **DocuSeal templates** for the two agreements once attorney-finalized — e-sign + contract repo for every driver onboarded.

### Pilot / scale
- [ ] **90-day pilot** — one truck, one vetted driver, on the Tier-1 lease-to-own. Watch two numbers: does he maintain the truck now that he has equity, and real net per truck after insurance/costs.
- [ ] **Scale trucks 1:1 with committed freight** — never seat a driver ahead of the freight to keep that truck loaded.

### Waiting on someone else / blocked
- [ ] **Operating state + current lanes** (you) — needed to build the specific shipper target list and to find a state-licensed attorney.
- [ ] **Insurance quote** (insurer) — sets the real first-month down payment figure.
- [ ] **Government contract approval** (SAM.gov / agencies) — gates the government-freight portion of the floor.
