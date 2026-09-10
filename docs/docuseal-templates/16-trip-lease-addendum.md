# 16 — Trip Lease Addendum, Box Truck (split-authority owner-operator)

Folder: Dispatch · Flow: Carrier prepares → Lessor signs Part B at pickup → Carrier
countersigns → Parts C signed at delivery
Trigger: **once per load**, fired at Approve & Dispatch. Not an onboarding form.

**This is the document that proves whose authority the truck was on.** It exists for
owner-operators who hold their own MC and run part of their weeks under LAMP and part
under their own. The Master Trip Lease
(`docs/agreements/master-trip-lease-lamp-to-owner-operator.md`) is signed once. This
Addendum is signed per load, and its two receipts are the timestamps that start and
stop LAMP's exclusive possession under 49 CFR 376.12(c)(1).

Without Part B executed, the truck moved under LAMP's authority with no record that
possession ever transferred. After a crash, both carriers get pulled into the same
suit and neither can prove it was the other one. The receipts are the whole point.

**Do not send this to a full-time leased driver.** A driver on the standard 24-month
equipment lease (`12-equipment-lease-376`) is already under continuous exclusive
possession; a per-trip receipt contradicts that lease and muddies which document
controls. Template 13 is the receipt for that arrangement. This one is only for
drivers on the Master Trip Lease.

---

## Field map

59 fields. Carrier prefills Part A and the identity fields before sending.

### Header

| Field | Role | Type | Required |
|---|---|---|---|
| Addendum Number | Carrier | text | yes |
| Master Agreement Date | Carrier | date | yes |
| Lessor Legal Name | Driver | text | yes |
| Lessor MC Number | Driver | text | yes |
| Lessor DOT Number | Driver | text | yes |

### Part A — the load

| Field | Role | Type | Required |
|---|---|---|---|
| Load Number | Carrier | text | yes |
| Broker Name | Carrier | text | yes |
| Origin City State | Carrier | text | yes |
| Pickup DateTime | Carrier | text | yes |
| Destination City State | Carrier | text | yes |
| Delivery DateTime | Carrier | text | yes |
| Commodity | Carrier | text | yes |
| Declared Cargo Value | Carrier | text | no |

### Box truck and driver

| Field | Role | Type | Required |
|---|---|---|---|
| Assigned Unit Number | Carrier | text | yes |
| Equipment VIN | Driver | text | yes |
| Equipment Plate | Driver | text | yes |
| Box Length | Driver | select (16/20/22/24/26 ft) | yes |
| Box GVWR | Driver | text | yes |
| Pallet Positions | Driver | text | no |
| Has Liftgate | Driver | checkbox | no |
| Has Ramp | Driver | checkbox | no |
| Has Etrack | Driver | checkbox | no |
| Dock Height | Driver | checkbox | no |
| Trip Driver Name | Driver | text | yes |
| Trip Driver CDL | Driver | text | yes |
| License Class | Driver | select (Non-CDL / Class B / Class A) | yes |
| Medical Card Current | Driver | checkbox | yes |
| RODS Method | Driver | select (ELD / Paper / 395.1(e)) | yes |

**Why the box-truck fields are on the lease.** Liftgate, ramp, box length and dock
height are what brokers ask for on box-truck freight, and they are what was quoted at
booking. Recording them on the Addendum means the signed instrument matches the load
that was sold.

**Non-CDL is not non-regulated.** A straight truck at or under 26,000 lbs GVWR needs no
CDL, but in interstate commerce over 10,001 lbs it is still a commercial motor vehicle:
driver qualification file under Part 391, records of duty status under Part 395, DOT
medical certification, and minimum age 21. `License Class`, `Medical Card Current` and
`RODS Method` exist so that is captured per trip rather than assumed.

### Compensation

| Field | Role | Type | Required |
|---|---|---|---|
| Trip Linehaul | Carrier | text | yes |
| Trip Fuel Surcharge | Carrier | text | no |
| Trip Accessorials | Carrier | text | no |
| Trip Advances | Carrier | text | no |
| Trip Chargebacks | Carrier | text | no |
| Trip Net Payable | Carrier | text | yes |

### Part B — possession to Carrier (signed at pickup)

| Field | Role | Type | Required |
|---|---|---|---|
| Possession In Date | Carrier | date | yes |
| Possession In Time | Carrier | text | yes |
| Possession In Location | Carrier | text | yes |
| Trip Odometer In | Carrier | text | yes |
| Placards On | Driver | checkbox | yes |
| ELD Switched In | Driver | checkbox | yes |
| Coverage Verified | Carrier | checkbox | yes |
| Trip Condition In | Carrier | text | no |
| Driver Signature | Driver | signature | yes |
| Driver Sign Date | Driver | date | yes |
| Carrier Signature | Carrier | signature | yes |
| Carrier Sign Date | Carrier | date | yes |

### Part C — possession to Lessor (signed at delivery)

| Field | Role | Type | Required |
|---|---|---|---|
| Possession Out Date | Carrier | date | yes |
| Possession Out Time | Carrier | text | yes |
| Possession Out Location | Carrier | text | yes |
| Trip Odometer Out | Carrier | text | yes |
| Trip Loaded Miles | Carrier | text | no |
| Placards Off | Driver | checkbox | yes |
| ELD Switched Out | Driver | checkbox | yes |
| Delivery Docs Submitted | Driver | checkbox | yes |
| Trip Condition Out | Carrier | text | no |
| Carrier Return Signature | Carrier | signature | yes |
| Carrier Return Date | Carrier | date | yes |
| Driver Return Signature | Driver | signature | yes |
| Driver Return Date | Driver | date | yes |

---

## Field names shared with other templates

These reuse the exact names in templates 12, 13, and 15, so DocuSeal prefills them
across the set and a driver never retypes them:

`Lessor Legal Name` · `Equipment VIN` · `Equipment Plate` · `Assigned Unit Number` ·
`Driver Signature` · `Driver Sign Date` · `Carrier Signature` · `Carrier Sign Date`

Do not rename them. The prefill breaks silently.

---

## Two signing moments, one document

Part B is signed at pickup. Part C is signed at delivery, usually days later. The
submission stays open in between. This mirrors template 13, which already ships with
the same Part A / Part B structure, so the flow is proven.

If DocuSeal's open-submission behavior proves awkward for dispatch in practice, the
fallback is to split Part C into its own template keyed on `Addendum Number`. Try the
single-document version first, because 49 CFR 376.11(b) wants the receipt pair filed
together and one document per load is easier to produce at audit.

---

## Wiring it to dispatch

Fires once per load at Approve & Dispatch, only for drivers flagged as split-authority
on the Master Trip Lease. Prefill sources:

| Addendum field | Source |
|---|---|
| Load Number, Broker Name, Origin, Destination, dates, Commodity | the load record |
| Trip Linehaul, Fuel Surcharge, Net Payable | the load's pay calculation |
| Lessor Legal Name, MC, DOT, Equipment VIN, Plate, Unit | the driver record |
| Coverage Verified | the COI check (`docs/specs/coi-lapse-monitor-spec.md`) |

`Coverage Verified` is the interlock worth building. Master Section 10.4 forbids
tendering an Addendum while any required coverage is lapsed. Wire that checkbox to
the COI monitor's state so dispatch cannot generate the Addendum against an expired
certificate, rather than relying on somebody remembering to look.

---

## Build

Source lives in `build/source.html` under `<!--DOC:16-trip-lease-addendum-->`.
Rebuild with:

```
python3 build.py
```

Output: `pdf/16-trip-lease-addendum.pdf`, 59 tags, verified with
`python3 build.py --check`. Upload to DocuSeal and every field, role, and type is
created from the text layer.


---

## Template 17 — the tractor-trailer variant

`17-trip-lease-addendum-tractor` is the same instrument with the equipment block swapped:
tractor plus `Trailer Furnished By`, `Trailer Number`, `Trailer VIN`, `Trailer Type`,
`Trailer Interchange On File`, and `CDL Endorsements` in place of the box-truck specs.
57 tags. Built from the same `build/source.html`.

They are **separate documents on purpose.** A liftgate field on a tractor lease, or a
trailer VIN on a box truck lease, is a drafting error on a signed instrument, and a
test in `server/__tests__/trip-addendum.test.ts` fails if either appears on the wrong
one. `templateIdForPowerUnit()` in `server/trip-addendum-service.ts` picks between them
from `drivers.power_unit_type`, defaulting to **box truck** — that is the fleet.
