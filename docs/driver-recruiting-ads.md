# Driver Recruiting — Ad Campaign Setup
**LAMP Logistics lease-to-own owner-operator program.** Traffic → `recruiting/index.html` → form → `/thanks` (Lead fires) → dispatch follows up.

> Tracking is wired: Meta Pixel on the landing page (PageView) and the thanks page (Lead). Swap `YOUR_PIXEL_ID` in both `index.html` and `thanks.html` for your real Pixel ID before launch.

## Funnel
1. Ad (Meta / Google) → landing page
2. Form submit → Netlify captures + emails dispatch@lampslogistics.com → redirect to `/thanks`
3. `/thanks` fires the **Lead** pixel event (this is what Meta optimizes toward)
4. Dispatch calls/texts the applicant → seats qualified drivers

## Channels (priority order)
1. **Meta (FB/IG) — primary.** Your wheelhouse. Run it through Echo IQ. Cheapest qualified driver leads, best targeting, retargeting + lookalikes off the Lead event.
2. **Google Search — high intent.** Catches people actively searching "box truck owner operator," "lease to own box truck." Lower volume, higher intent.
3. **Facebook Groups — organic, free.** Owner-operator / box-truck / trucking groups. Post the offer + landing link. Highest ROI for $0.
4. **Indeed / ZipRecruiter — job-seeker intent.** Post as a driver opportunity; link to the page.
5. **Craigslist gigs + TikTok/Reels** — cheap top-of-funnel, trucker content.

---

## Meta campaign structure
- **Objective:** Leads (or Sales) optimizing for the **Lead** conversion event (not link clicks). Let the pixel learn off real applications.
- **Geo:** your operating footprint where drivers live — start tight: 50mi around **Memphis, Nashville, Atlanta**, then expand to TN/GA/AL/MS/AR/KY metros. Don't run national.
- **Audience:** broad + Advantage+ first (creative-led, let Meta find them). Layer a detailed-targeting test set as a separate ad set: interests like *owner-operator, truck driver, commercial driver's license, Amazon Relay, box truck, FreightWaves, trucking*.
- **Lookalikes:** once you have 50+ Leads, build a 1-3% LLA off the Lead event and off applicant emails.
- **Retargeting ad set:** landing-page visitors who didn't submit (now trackable via the pixel) → a "still thinking about it?" creative.
- **Budget:** test at $30-50/day across 3-4 creatives, kill losers at the 3-day mark, scale the winner. You know the drill.

## Ready-to-run Meta ad copy

**Variant A — the death valley (pain-led)**
- Primary text:
  > New owner-operators don't go broke because of the truck payment. They go broke because brokers won't load a new authority for six months. We took the empty months out. Run on our established authority and start earning week one. $5,000 down, no credit check, own your truck in 3 years.
- Headline: **Own Your Truck in 3 Years**
- Description: Real freight, week one. No CDL required.
- CTA: Apply Now

**Variant B — own your truck (aspiration-led)**
- Primary text:
  > Stop building someone else's company on your back. $5,000 down puts you in a 26ft box truck that becomes yours in 36 months. We bring the authority, the freight, the insurance, and the factoring. You bring the work ethic.
- Headline: **$5,000 Down. No Credit Check.**
- Description: Lease-to-own. Paid weekly. Own it in 3 years.
- CTA: Apply Now

**Variant C — non-CDL (audience-expander)**
- Primary text:
  > No CDL? You can still own a truck and run a real freight business. Our 26ft box trucks are non-CDL. $5,000 down, steady routes from day one, and the title is yours in 3 years. We handle the dispatch, insurance, and factoring.
- Headline: **No CDL Needed**
- Description: Own a box truck. Earn week one.
- CTA: Apply Now

**Variant D — no credit (objection-killer)**
- Primary text:
  > Bank said no? We don't run credit. $5,000 down and a clean driving record puts you in a truck this month. Run on our authority, get paid weekly, and own the truck in 36 months. This is how new drivers actually make it.
- Headline: **Bad Credit Doesn't Matter Here**
- Description: $5,000 down. No credit check. Own it in 3 years.
- CTA: Apply Now

*Creative: short vertical video beats static. A driver walking up to a clean 26ft box truck, or you talking straight to camera about the death valley, outperforms stock photos. Captions on. First 2 seconds carry it.*

---

## Google Search — Responsive Search Ad
**Keywords (phrase/exact):** box truck owner operator, lease to own box truck, owner operator box truck jobs, non cdl box truck business, become an owner operator, box truck business start, owner operator jobs [Memphis/Nashville/Atlanta]

**Headlines (mix 8-10):**
- Own Your Truck in 3 Years
- $5,000 Down, No Credit Check
- Lease-To-Own Box Truck Program
- No CDL Required
- Run On Our Authority Day One
- Get Paid Weekly
- Real Freight, Week One
- Box Truck Owner Operator
- Skip The 6-Month Startup Wait
- Apply Online In 2 Minutes

**Descriptions:**
- Lease-to-own a 26ft box truck. $5,000 down, no credit check, own it in 3 years. Apply now.
- We bring the authority, freight, insurance and factoring. You drive. Paid weekly. Non-CDL OK.

---

## Echo IQ tie-in
Run the Meta side through Echo IQ. You dogfood your own SaaS on a live offer, you get the campaign data inside a tool you control, and any creative/audience playbook that wins here is a case study you can use to sell Echo IQ.

## The gate
Launching ads spends money, so that's yours to approve. Setup is done and free (pixel + tracking + copy). To go live you need: (1) your **Pixel ID** dropped into both pages, (2) the page deployed on Netlify, (3) your go on budget. Say the word with the Pixel ID and budget and I'll help stand up the campaign in Echo IQ / Ads Manager.
