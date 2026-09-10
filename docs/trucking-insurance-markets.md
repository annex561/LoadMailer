# Trucking insurance call sheet — trip-lease coverage for LAMP

For MC-1725755 / DOT 4397421. The ask is a **motor carrier fleet policy with a
trip-lease or non-owned auto endorsement**, rated on trip-leased gross receipts, so
owner-operators can be leased per load without scheduling each unit year-round.

> Appetites change constantly and this list reflects general market positioning, not a
> current quote. Verify every one of these directly.

---

## Read this before you call anyone

**Do not cancel GEICO yourself.** When you move carriers, the new insurer files a
BMC-91X on your MC and the old one files a BMC-35 cancellation. If the cancellation
lands before the new filing posts, you have a gap in your federal financial
responsibility and FMCSA can move to revoke your authority. Let the new filing
supersede the old one and let the agent manage the sequence. Confirm on FMCSA L&I that
the new filing shows active **before** anything is cancelled.

**Call an agency, not a carrier.** A trucking-specialty agency shops eight or ten
markets in one conversation. Calling an underwriter direct gets you one quote and no
read on who actually writes trip-lease exposure this quarter.

**GEICO is fine for the driver, wrong for you.** They write commercial auto and market
at owner-operators, so let your driver quote them for his own authority. A motor
carrier fleet policy with FMCSA filings and trip-lease exposure is specialty trucking
risk and not their lane.

---

## Agencies — start here

| Agency | Why |
|---|---|
| **Reliance Partners** | **Headquartered in Chattanooga.** Trucking-only, places with every specialty market, knows leased-operator and trip-lease structures. Local. Call this one first. |
| Marquee Insurance Group | Atlanta, trucking-only, strong small-fleet book |
| Western Truck Insurance Services | Trucking specialist, wide market access |
| Tabak Insurance | Trucking agency, owner-operator heavy |
| Strong Tie Insurance | Trucking, small fleet focus |
| Simplex Group / InsureMyRig | Owner-operator focused, also does authority and compliance filings |

## Underwriters they place with

| Carrier | Notes |
|---|---|
| **Progressive Commercial** | Largest small-fleet trucking writer in the US. Writes leased-operator structures. Absorbed Protective (Baldwin & Lyons), historically the trip-lease specialist. Most likely home for a 1-5 truck box fleet. |
| **Northland** (Travelers) | Long-standing trucking specialist, owner-operator and trip-lease appetite |
| **Canal Insurance** | Specialty trucking, takes complex and non-standard motor carrier risk |
| Acuity | Good small-fleet appetite, genuinely strong on straight trucks |
| Great West Casualty | Deep trucking specialist, generally wants established fleets with clean loss runs |
| Sentry | Trucking program, tends larger |
| Lancer Insurance | Commercial auto and transportation specialist |
| Berkshire Hathaway GUARD | Small commercial with some trucking appetite |
| Nationwide / Scottsdale E&S | Specialty arm for harder placements |

## Telematics-priced markets — your edge

| Carrier | Why it matters here |
|---|---|
| **Cover Whale** | Prices off driver safety telematics. Small fleets and owner-operators are the whole book. |
| **Nirvana Insurance** | Same model, telematics-based pricing, targets small fleets |

You run ELD data through TRAQ-IQ. These markets discount for exactly that, and almost
nobody at your size shows up to a quote with clean telematics. Bring it up unprompted.

---

## The script

> "I'm a Chattanooga box truck carrier, MC-1725755. I'm trip-leasing owner-operators
> who hold their own authority. Do you write trip-lease or non-owned auto for units I
> lease per trip, and is it rated on gross receipts or per unit per day?"

Then, before they quote:

> "The owner-operators carry their own liability with me named additional insured on a
> CA 20 48, primary and non-contributory, with waiver of subrogation. How does that
> affect my rate?"

Most carriers at this size never mention they have that and pay the full rate anyway.

## Have this ready before the first call

Quote cycles run two weeks when you're gathering documents mid-conversation and two
days when you're not.

- MC and DOT numbers, years in operation
- Current declarations page and **three years of loss runs** from GEICO
- Vehicle schedule: year, make, VIN, stated value, radius of operation
- Driver list with dates of birth, license numbers, and MVRs
- Annual mileage and annual gross revenue, split between your own freight and
  trip-leased
- Commodities hauled and your primary lanes
- The monthly trip-leased gross figure from
  `GET /api/coverage/trip-lease-report?year=&month=&format=csv`

That last one is the number the endorsement is rated on. Handing an underwriter a clean
CSV instead of an estimate is the difference between a loaded rate and a real one.
