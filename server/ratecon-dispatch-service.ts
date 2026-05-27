import { db } from "./db";
import { rateconIntake, loads, drivers, customers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import nodemailer from "nodemailer";
import type { PayDriverInput, PayLoadInput } from "./pay-calculator";
import { calculatePay } from "./pay-calculator";

// Reuse the same SMTP transport as load-lifecycle-service / bidding-service.
// Defaults align with the existing wiring (Gmail SMTP via SMTP_USER/SMTP_PASS).
const dispatchMailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "",
  },
});

export interface DispatchOutcome {
  ok: boolean;
  loadId?: string;
  loadNumber?: string;
  confirmationToken?: string;
  error?: string;
}

export async function dispatchFromIntake(intakeId: string): Promise<DispatchOutcome> {
  const [intake] = await db.select().from(rateconIntake).where(eq(rateconIntake.id, intakeId));
  if (!intake) return { ok: false, error: "Intake not found" };
  if (!intake.matchedDriverId) return { ok: false, error: "No driver assigned" };
  if (!intake.parsedJson) return { ok: false, error: "No parsed data" };

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, intake.matchedDriverId));
  if (!driver) return { ok: false, error: "Driver not found" };

  // FK consistency: loads table has a composite FK (driver_id, company_id) →
  // drivers (id, company_id). If the driver was created without a companyId,
  // back-fill it from the intake so the FK is valid. Use the driver's
  // companyId (or back-filled) as the canonical company for this load.
  let canonicalCompanyId: string | null = driver.companyId ?? null;
  if (!canonicalCompanyId && intake.companyId) {
    await db
      .update(drivers)
      .set({ companyId: intake.companyId })
      .where(eq(drivers.id, driver.id));
    canonicalCompanyId = intake.companyId;
    console.log(`[dispatch] back-filled driver ${driver.id} companyId → ${intake.companyId}`);
  }

  const parsed = intake.parsedJson as any;
  const confirmationToken = nanoid(24);

  // Resolve or auto-create customer from broker name (loads.customerId is required)
  const brokerName = parsed.broker?.value ?? "Unknown Broker";
  let customerId: string;
  const [existingCustomer] = await db
    .select()
    .from(customers)
    .where(eq(customers.name, brokerName))
    .limit(1);
  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const [newCustomer] = await db
      .insert(customers)
      .values({
        companyId: intake.companyId,
        name: brokerName,
        contactPerson: "",
        email: "",
        phone: "",
        address: "",
        status: "active",
      })
      .returning();
    customerId = newCustomer.id;
  }

  // Create the load
  const loadNumber = parsed.loadNumber?.value ?? `RC-${Date.now()}`;
  const pickupDate = new Date(`${parsed.pickup.date}T${parsed.pickup.time}:00`);
  const deliveryDate = new Date(`${parsed.drop.date}T${parsed.drop.time}:00`);

  // Idempotent insert: if a load with this loadNumber already exists (e.g. the
  // legacy email scanner created it before the universal intake pipeline took
  // over), UPDATE it with the new dispatch metadata instead of failing on the
  // unique constraint.
  // Build address string without duplicating city/state if the parsed street
  // address already contains them (e.g. "8040 N. Virginia St Ste 102, Reno, NV
  // 89506" should not become "...Reno, NV 89506, Reno, NV").
  const buildAddress = (a: { address?: string | null; city?: string | null; state?: string | null }) => {
    const street = (a.address ?? "").trim();
    const city = (a.city ?? "").trim();
    const state = (a.state ?? "").trim();
    const cityState = [city, state].filter(Boolean).join(", ");
    if (!street) return cityState;
    const lower = street.toLowerCase();
    const cityIn = !city || lower.includes(city.toLowerCase());
    const stateIn = !state || lower.includes(state.toLowerCase());
    if (cityIn && stateIn) return street;
    return cityState ? `${street}, ${cityState}` : street;
  };

  const loadValues = {
    // Use the canonical companyId (driver's, possibly back-filled) so the
    // loads → drivers FK is satisfied. Fall back to intake's companyId.
    companyId: canonicalCompanyId ?? intake.companyId,
    loadNumber,
    customerId,
    driverId: driver.id,
    description: parsed.commodity?.value ?? "General freight",
    pickupAddress: buildAddress(parsed.pickup ?? {}),
    pickupDate,
    pickupTime: parsed.pickup.time,
    deliveryAddress: buildAddress(parsed.drop ?? {}),
    deliveryDate,
    deliveryTime: parsed.drop.time,
    specialInstructions: parsed.specialInstructions?.value ?? null,
    status: "assigned",
    equipmentType: (parsed.equipmentType?.value ?? "dry_van").replace(/\s+/g, "_").toLowerCase(),
    rate: parsed.rate?.value ?? 0,
    miles: typeof parsed.miles?.value === "number" ? parsed.miles.value : undefined,
    weight: typeof parsed.weightLbs?.value === "number" ? parsed.weightLbs.value : undefined,
    brokerName: parsed.broker?.value ?? null,
    assignedDriverName: driver.name,
    sourceBoard: intake.sourceType === "email" ? "email" : "manual",
    originCity: parsed.pickup.city,
    originState: parsed.pickup.state,
    destCity: parsed.drop.city,
    destState: parsed.drop.state,
    offeredRate: parsed.rate?.value ?? 0,
    confirmationToken,
    confirmationStatus: "pending" as const,
    // Persist the RateCon PDF path on the load itself so downstream code
    // (factoring packet builder, audit views) can find it without going
    // back through rateconIntake. Pinned by
    // server/__tests__/ratecon-dispatch-rateconPath.test.ts
    rateconPath: intake.pdfPath ?? null,
  };

  const [existing] = await db
    .select()
    .from(loads)
    .where(eq(loads.loadNumber, loadNumber))
    .limit(1);

  let load: typeof loads.$inferSelect;
  if (existing) {
    // Update the legacy/duplicate load with the new dispatch info
    const [updated] = await db
      .update(loads)
      .set({
        ...loadValues,
        updatedAt: new Date(),
      })
      .where(eq(loads.id, existing.id))
      .returning();
    load = updated;
  } else {
    const [inserted] = await db.insert(loads).values(loadValues).returning();
    load = inserted;
  }

  // Update intake
  await db
    .update(rateconIntake)
    .set({
      status: "dispatched",
      loadId: load.id,
      updatedAt: new Date(),
    })
    .where(eq(rateconIntake.id, intakeId));

  return { ok: true, loadId: load.id, loadNumber: load.loadNumber, confirmationToken };
}

export function driverProfileToPayInput(driver: any): PayDriverInput {
  return {
    payType: (driver.payType ?? "percent") as PayDriverInput["payType"],
    payRate: driver.payRate ?? 0,
    payRateDeadhead: driver.payRateDeadhead ?? 0,
    deductFactoringEnabled: driver.deductFactoringEnabled ?? false,
    deductFactoringPct: driver.deductFactoringPct ?? 0,
    deductDispatchEnabled: driver.deductDispatchEnabled ?? false,
    deductDispatchPct: driver.deductDispatchPct ?? 0,
    deductFuelAdvanceEnabled: driver.deductFuelAdvanceEnabled ?? false,
    deductFuelAdvanceAmount: driver.deductFuelAdvanceAmount ?? 0,
    deductTrailerRentEnabled: driver.deductTrailerRentEnabled ?? false,
    deductTrailerRentWeekly: driver.deductTrailerRentWeekly ?? 0,
    deductInsuranceEnabled: driver.deductInsuranceEnabled ?? false,
    deductInsuranceWeekly: driver.deductInsuranceWeekly ?? 0,
    deductEldEnabled: driver.deductEldEnabled ?? false,
    deductEldMonthly: driver.deductEldMonthly ?? 0,
    deductOccAccEnabled: driver.deductOccAccEnabled ?? false,
    deductOccAccWeekly: driver.deductOccAccWeekly ?? 0,
  };
}

export function computeLoadPayInput(parsed: any): PayLoadInput {
  const totalMiles = parsed.miles?.value ?? 0;
  // If deadhead unknown, treat all miles as loaded
  return {
    rate: parsed.rate?.value ?? 0,
    loadedMiles: totalMiles,
    deadheadMiles: 0,
  };
}

/**
 * Send a short follow-up SMS to the driver at a load lifecycle transition.
 * Used after Accept (web or SMS) → tells driver next step + link to dashboard.
 * Carrier-friendly: minimal text + single short URL only.
 */
/**
 * Pure builder for per-stage driver reply messages. Single source of truth
 * for the text of every "after the driver accepted / picked-up / delivered"
 * SMS — whether triggered by the web confirmation link OR by the inbound SMS
 * keyword handler.
 *
 * Returns an array of message strings (1 or 2). PICKED UP returns 2 messages
 * (transition confirmation + dropoff details w/ upload URL) so the dropoff
 * address is the driver's most-recent SMS when they arrive at the receiver.
 *
 * No DB access. No SMS sending. No side effects. Pure function → trivial to
 * unit-test with vitest snapshots, and the same output can be rendered in the
 * admin preview/test pages without touching Twilio.
 *
 * Section divider style: 18-char "===...==" — matches the dispatch SMS body.
 */
const DRIVER_SMS_DIVIDER = "==================";

export interface DriverStageInputs {
  loadId: string;
  loadNumber: string;
  deliveryAddress?: string | null;
  deliveryDate?: Date | string | null;
  deliveryTime?: string | null;
  destCity?: string | null;
  destState?: string | null;
  trackingToken?: string | null;
  baseUrl?: string;
  /** Pre-computed pay summary lines for the "delivered" message. Caller is
   *  responsible for running calculatePay() and formatting; we just stitch
   *  them into the reply. */
  payLines?: string[];
  /** Optional HMAC-signed upload token. When present the upload-page URL
   *  embeds it instead of the bare loadId, so anyone scraping the URL
   *  out of an SMS gateway log can't POST photos against the load. The
   *  server route accepts both forms during rollout. */
  uploadToken?: string | null;
  /** When true, the SMS swaps the "Upload a clear photo: <link>" line for
   *  a "reply to this text with a photo" prompt — the link is omitted
   *  entirely. The caller must have written pending_uploads rows for the
   *  expected (driverPhone, loadId, stage) BEFORE sending so the inbound
   *  MMS webhook can route the reply to the right slot. Gated upstream
   *  by MMS_UPLOAD_ENABLED. */
  mmsReplyMode?: boolean;
}

function fmtDayShort(d: Date | string | null | undefined): string {
  if (!d) return "TBD";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "TBD";
  const dow = date.toLocaleDateString("en-US", { weekday: "short" });
  return `${dow} ${date.getMonth() + 1}/${date.getDate()}`;
}

function fmtTime12h(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${period}`;
}

export function buildDriverStageMessages(
  inputs: DriverStageInputs,
  step: "accepted" | "picked-up" | "delivered",
): string[] {
  const base =
    inputs.baseUrl ||
    process.env.PUBLIC_BASE_URL ||
    process.env.CUSTOM_DOMAIN ||
    "https://traqiq.app";
  // Prefer the signed token if the caller minted one. Falls back to the
  // bare loadId so existing test fixtures and ad-hoc calls keep working.
  const uploadUrl = `${base}/u/${inputs.uploadToken || inputs.loadId}`;
  // Anchor to #tracking so the page scrolls to the toggle widget — driver
  // can tap "Turn ON" with no scrolling needed.
  const trackerLink = inputs.trackingToken
    ? `${base}/driver/${inputs.trackingToken}#tracking`
    : null;

  if (step === "accepted") {
    // mmsReplyMode wording: do NOT promise the driver they can reply with
    // a photo immediately — there's no pending_uploads row yet. Geofence-cron
    // writes the row when the driver arrives, and at that point sends a
    // second SMS with the reply prompt. Pre-arrival photos here would bind
    // to the wrong load if the driver is on >1 load. (Phase 1 fix.)
    const bolLines = inputs.mmsReplyMode
      ? [
          `We'll text you when you arrive at the pickup so you can send the signed BOL.`,
        ]
      : [
          `Upload a clear photo of the signed BOL:`,
          uploadUrl,
        ];
    return [
      [
        `Load #${inputs.loadNumber} CONFIRMED`,
        DRIVER_SMS_DIVIDER,
        `AT PICKUP`,
        ...bolLines,
        ``,
        `Or reply PICKED UP when loaded.`,
        DRIVER_SMS_DIVIDER,
        trackerLink
          ? `GPS tracking is now ON.\nKeep your phone tracker open:\n${trackerLink}`
          : `GPS tracking is now ON. Drive safe.`,
      ].join("\n"),
    ];
  }

  if (step === "picked-up") {
    const dropAddr =
      inputs.deliveryAddress && inputs.deliveryAddress.trim()
        ? inputs.deliveryAddress
        : `${inputs.destCity ?? ""}, ${inputs.destState ?? ""}`
            .replace(/^,\s*/, "")
            .trim();
    const deliveryWhen =
      fmtDayShort(inputs.deliveryDate) +
      (inputs.deliveryTime ? `  ${fmtTime12h(inputs.deliveryTime)}` : "");
    return [
      // Msg 1 — transition confirmation
      [
        `Load #${inputs.loadNumber} PICKED UP`,
        DRIVER_SMS_DIVIDER,
        `Drive safe.`,
        `GPS tracking continues — no action needed.`,
      ].join("\n"),
      // Msg 2 — dropoff details + upload URL (driver's most-recent SMS)
      [
        `DELIVER TO:`,
        dropAddr,
        deliveryWhen,
        DRIVER_SMS_DIVIDER,
        `AT DELIVERY`,
        ...(inputs.mmsReplyMode
          ? [
              // Same Phase 1 fix as "accepted" step: no pending_uploads row
              // exists yet at pickup-time, so we defer the photo prompt to
              // geofence-arrival at the delivery dock.
              `We'll text you when you arrive at the delivery so you can send the signed BOL.`,
            ]
          : [
              `Upload the signed BOL:`,
              uploadUrl,
              ``,
              `Or text the BOL photo to this number.`,
            ]),
        `Reply DELIVERED when offloaded.`,
      ].join("\n"),
    ];
  }

  // step === "delivered"
  // Short Good-to-Go acknowledgement. NO pay summary — the driver can see
  // full pay breakdown on their dashboard, and stuffing it into an SMS
  // gives the driver a wall of dollar amounts on their phone right after
  // the most stressful part of the job (delivery). Plus per-load deductions
  // sometimes shift on settlement day; the SMS would lock in a number that
  // could be wrong by Friday.
  //
  // Factoring auto-push: the load is already eligible to appear in the
  // /factoring queue once status=delivered AND bolPath is populated. This
  // is handled by the factoring queue route (no extra side-effect needed
  // from this builder).
  return [
    [
      `Load #${inputs.loadNumber} DELIVERED`,
      DRIVER_SMS_DIVIDER,
      `Good to go. Paperwork is being processed and your factoring submission is queued.`,
      ``,
      `Full pay breakdown is on your dashboard.`,
      ``,
      `Thank you — drive safe.`,
    ].join("\n"),
  ];
}

/**
 * Send the appropriate stage reply SMS(s) for a load that has just
 * transitioned to `step`. Wraps buildDriverStageMessages with the actual
 * DB lookup + Twilio dispatch. Used by:
 *   - driver-confirmation-routes.ts (when driver clicks the web link)
 *   - sms-communication-service.ts handleDispatchKeyword (when driver
 *     replies via SMS)
 *
 * Caller is responsible for any state changes (load.status update, driver
 * tracking flag, factoring queue entry, etc.) BEFORE invoking this. This
 * function only owns the OUTGOING text — not the side effects.
 */
export async function sendDriverNextStepSms(
  loadId: string,
  step: "accepted" | "picked-up" | "delivered",
): Promise<{ ok: boolean; error?: string; messageSids: string[] }> {
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load || !load.driverId) return { ok: false, error: "Load or driver missing", messageSids: [] };
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
  if (!driver) return { ok: false, error: "Driver not found", messageSids: [] };
  const phone = (driver as any).phoneNumber ?? (driver as any).phone;
  if (!phone) return { ok: false, error: "Driver has no phone", messageSids: [] };

  // Pay breakdown is no longer sent via SMS — the driver sees it on the
  // dashboard. Per-load dollar amounts shift on weekly settlement (recurring
  // deductions, fuel advances, etc.) so locking a number in an SMS at delivery
  // time can be misleading by Friday. payLines parameter on the builder is
  // kept for back-compat / future override but no caller populates it now.

  // Mint a signed upload token bound to this load. Embedded in the
  // upload-page URL so the page POSTs can be verified server-side.
  const { signUploadToken } = await import("./upload-token");
  const uploadToken = signUploadToken(load.id);

  // MMS-reply mode: when MMS_UPLOAD_ENABLED=true the driver replies to
  // the SMS with the BOL photo instead of clicking the /u/<token> link.
  //
  // Phase 1 of the wrong-load-attachment fix (after user caught the bug
  // while driving): we do NOT pre-create a pending_uploads row at
  // acceptance or pick-up. Pending rows are only written by geofence-cron
  // at the moment the driver physically arrives at the shipper/receiver
  // — that is the only moment we know which load the next photo belongs
  // to, because a driver can only be at one pickup address at a time.
  //
  // Pre-creating rows here was the wrong-load source: a driver on two
  // loads got two pending rows and the inbound photo bound to whichever
  // was created last (findPendingForPhone orders DESC createdAt).
  //
  // The SMS wording also changes downstream in buildDriverStageMessages
  // when mmsReplyMode=true: we tell the driver "we'll text you when you
  // arrive at the pickup" instead of "reply with a photo now" — to match
  // the new flow.
  const { isMMSUploadEnabled } = await import("./mms-upload-service");
  const mmsReplyMode = isMMSUploadEnabled();

  const messages = buildDriverStageMessages(
    {
      loadId: load.id,
      loadNumber: load.loadNumber,
      deliveryAddress: load.deliveryAddress,
      deliveryDate: load.deliveryDate,
      deliveryTime: load.deliveryTime,
      destCity: load.destCity,
      destState: load.destState,
      trackingToken: (driver as any).trackingToken,
      baseUrl: process.env.PUBLIC_BASE_URL || process.env.CUSTOM_DOMAIN || undefined,
      uploadToken,
      mmsReplyMode,
    },
    step,
  );

  const { smsService, withBrandAndOptOut } = await import("./sms-service");
  const sids: string[] = [];
  for (const raw of messages) {
    // Brand prefix + STOP suffix (idempotent) — required for 10DLC compliance.
    const body = withBrandAndOptOut(raw);
    const result = await smsService.sendSMS({ to: phone, body, skipFooter: true });
    if (!result.success) {
      console.error(`[next-step-sms] ❌ ${step} failed: ${result.error}`);
      return { ok: false, error: result.error, messageSids: sids };
    }
    if (result.messageSid) sids.push(result.messageSid);
  }
  console.log(`[next-step-sms] ✅ ${step} sent to ${phone} (${sids.length} message${sids.length === 1 ? "" : "s"}, sids: ${sids.join(",")})`);
  return { ok: true, messageSids: sids };
}

/**
 * Build the dispatch SMS body for a given load + driver. Pure function
 * (no DB, no SMS send) so it can be exercised by the admin "Test Dispatch"
 * page to preview the exact message a driver will receive.
 *
 * Matches the body that sendDispatchSms() sends. SMS_MINIMAL=true env var
 * flips to the legacy keyword-only template.
 */
// Format a Date as "Tue 5/7" — short day-of-week + numeric date so a driver
// glancing at the screen instantly knows WHEN without parsing 5/7/2026.
function formatDispatchDate(d: Date | string | null | undefined): string {
  if (!d) return "TBD";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "TBD";
  const dow = date.toLocaleDateString("en-US", { weekday: "short" });
  return `${dow} ${date.getMonth() + 1}/${date.getDate()}`;
}

// Format "08:00" → "8:00 AM" for at-a-glance readability.
function formatDispatchTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${period}`;
}

// Render a multi-line address. The pickupAddress field is often a single
// concatenated string ("ACME CORP 123 Main St City, ST 12345"). We split on
// the city-state-zip suffix so that pattern lands on its own line, which is
// what a driver scans first when navigating.
function formatAddressBlock(addr: string): string {
  const trimmed = addr.trim();
  // Match a trailing "<city>, <ST> <zip>" — push it to its own line.
  const m = trimmed.match(/^(.*?)[\s,]+([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) {
    const head = m[1].replace(/,\s*$/, "").trim();
    const cityStateZip = `${m[2].trim()}, ${m[3]} ${m[4]}`;
    return `${head}\n${cityStateZip}`;
  }
  return trimmed;
}

// Standard divider for visually separating SMS sections. 18 chars fits on
// a single line in iMessage / standard Android SMS bubbles without wrapping.
// Longer dividers (28+) wrap to a second line on most phones, breaking the
// visual block separation we're trying to create.
const DIVIDER = "==================";

// Format currency with thousands separators: 1080 → "$1,080.00"
function formatMoney(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function buildDispatchSmsBody(load: any, driver: any): { body: string; url: string } {
  const baseUrl = process.env.CUSTOM_DOMAIN || "https://traqiq.app";
  const url = `${baseUrl}/l/${load.confirmationToken ?? "test-token"}`;

  const pickupDate = formatDispatchDate(load.pickupDate);
  const deliveryDate = formatDispatchDate(load.deliveryDate);
  const pickupTime = formatDispatchTime(load.pickupTime);
  const deliveryTime = formatDispatchTime(load.deliveryTime);

  const pickupRaw =
    load.pickupAddress && load.pickupAddress.trim().length > 0
      ? load.pickupAddress
      : `${load.originCity ?? ""}, ${load.originState ?? ""}`.trim().replace(/^,\s*/, "");
  const dropRaw =
    load.deliveryAddress && load.deliveryAddress.trim().length > 0
      ? load.deliveryAddress
      : `${load.destCity ?? ""}, ${load.destState ?? ""}`.trim().replace(/^,\s*/, "");

  const pickupBlock = formatAddressBlock(pickupRaw);
  const dropBlock = formatAddressBlock(dropRaw);

  const useFullBody = process.env.SMS_MINIMAL !== "true";

  // Workaround for Twilio T&S ticket #26735656 — see SMS_OMIT_URL handling.
  const omitUrl = process.env.SMS_OMIT_URL === "true";

  // Format inspired by the broker-style SMS truckers are used to: each
  // section is a discrete block separated by a ===== divider so drivers
  // can scan it at a glance. Content here is OUR data only — header,
  // support footer, and Macropoint copy are not standard inclusions.

  const sections: string[] = [];

  // Header — load identifier.
  sections.push(
    `Load #${load.loadNumber}` +
    (load.brokerName ? ` · ${load.brokerName}` : ""),
  );

  // Pickup block.
  sections.push(
    `PU: ${pickupDate} ${pickupTime}\n` +
    `${pickupBlock}`,
  );

  // Drop block.
  sections.push(
    `DROP: ${deliveryDate} ${deliveryTime}\n` +
    `${dropBlock}`,
  );

  // Commodity + weight (only if we have either).
  const cargoLines: string[] = [];
  if (load.description && load.description !== "General freight") {
    cargoLines.push(`Commodity: ${load.description}`);
  }
  if (load.weight && Number(load.weight) > 0) {
    cargoLines.push(`Weight: ${Number(load.weight).toLocaleString()} lbs`);
  }
  if (cargoLines.length > 0) {
    sections.push(cargoLines.join("\n"));
  }

  // Special instructions (when present in the load).
  if (load.specialInstructions && load.specialInstructions.trim()) {
    sections.push(`Note: ${load.specialInstructions.slice(0, 160)}`);
  }

  // Rate (gross broker rate — what the load pays, before any deductions).
  // This is the number drivers care about for the YES/NO decision.
  if (load.rate && Number(load.rate) > 0) {
    sections.push(`Rate: ${formatMoney(Number(load.rate))}`);
  }

  // Details URL — only when SMS_OMIT_URL is not set.
  if (!omitUrl) {
    sections.push(`Details: ${url}`);
  } else {
    sections.push(`Reply DETAILS for full info, HELP for commands.`);
  }

  // Action prompt.
  sections.push(`Reply YES to accept or NO to decline.`);

  // Join sections with the divider on its own line, surrounded by blank
  // lines so each block stands alone.
  const body = useFullBody
    ? sections.join(`\n${DIVIDER}\n`)
    : `Load ${load.loadNumber}` +
      (load.brokerName ? ` from ${load.brokerName}` : "") +
      `\n\n` +
      `PU: ${pickupDate} ${pickupTime}\n${pickupBlock}\n\n` +
      `DROP: ${deliveryDate} ${deliveryTime}\n${dropBlock}\n\n` +
      `Reply YES to accept or NO to decline.`;

  return { body, url };
}

// Driver dispatch SMS always fires when called — "Approve & Dispatch" is an
// explicit user action, so there's no point gating it behind an env var.
// (Admin alerts and YES/NO replies remain gated by SMS_ENABLED to prevent
// noise during testing — only the explicit dispatch action sends real SMS.)
/**
 * Email dispatch — fallback channel for when SMS is blocked at the carrier.
 *
 * Renders the SAME body the SMS would carry (so drivers see consistent info
 * across channels) plus a clearer subject line and a prominent "View Load"
 * button. Returns shape mirrors sendDispatchSms for easy interop.
 */
export async function sendDispatchEmail(loadId: string): Promise<{ ok: boolean; error?: string; email?: string; messageId?: string }> {
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load || !load.driverId) return { ok: false, error: "Load or driver missing" };
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
  if (!driver) return { ok: false, error: "Driver not found" };
  const email = (driver as any).email;
  if (!email) return { ok: false, error: "Driver has no email" };

  const { body, url } = buildDispatchSmsBody(load, driver);
  const baseUrl = process.env.CUSTOM_DOMAIN || "https://traqiq.app";
  const dashboardUrl = (driver as any).trackingToken
    ? `${baseUrl}/driver/${(driver as any).trackingToken}`
    : null;

  const subject = `New Load Offer: #${load.loadNumber}${load.brokerName ? ` — ${load.brokerName}` : ""}`;
  const text =
    `Hi ${driver.name ?? "Driver"},\n\n` +
    `${body}\n\n` +
    (dashboardUrl ? `Your dashboard: ${dashboardUrl}\n\n` : "") +
    `— LAMP Logistics Dispatch\n` +
    `dispatch@traqiq.app`;

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#111;">` +
    `<h2 style="color:#0d9488;margin-bottom:8px;">New Load Offer #${load.loadNumber}</h2>` +
    (load.brokerName ? `<p style="color:#6b7280;margin-top:0;">${load.brokerName}</p>` : "") +
    `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.55;">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>` +
    `<p style="margin-top:24px;"><a href="${url}" style="background:#0d9488;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View Load Details</a></p>` +
    (dashboardUrl ? `<p style="font-size:13px;color:#6b7280;">Driver Dashboard: <a href="${dashboardUrl}">${dashboardUrl}</a></p>` : "") +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />` +
    `<p style="font-size:12px;color:#9ca3af;">LAMP Logistics Dispatch · operating the TRAQ-IQ platform · dispatch@traqiq.app</p>` +
    `</div>`;

  const fromAddr = process.env.DISPATCH_FROM_EMAIL || process.env.SMTP_USER || process.env.EMAIL_USER || "dispatch@traqiq.app";

  console.log(`[dispatch-email] sending to ${email} for load ${load.loadNumber}`);
  try {
    const info = await dispatchMailer.sendMail({
      from: `"LAMP Logistics Dispatch" <${fromAddr}>`,
      to: email,
      subject,
      text,
      html,
    });
    console.log(`[dispatch-email] ✅ sent to ${email} (msgId: ${info.messageId})`);
    return { ok: true, messageId: info.messageId, email };
  } catch (err: any) {
    console.error(`[dispatch-email] ❌ SMTP send failed: ${err.message}`);
    return { ok: false, error: `SMTP: ${err.message}`, email };
  }
}

/**
 * Send dispatch via the configured channel. Behavior controlled by
 * DISPATCH_CHANNEL env var:
 *
 *   "sms"            (default) — SMS only
 *   "email"          — email only
 *   "both"           — SMS AND email (best-effort each)
 *   "email_fallback" — try SMS; if it fails, fire email
 *
 * Use "email_fallback" while Twilio carrier filtering is unresolved — drivers
 * still get the offer, and once SMS recovers no env-var change is needed.
 *
 * The function name keeps "Sms" for backward compatibility with all call sites
 * (load-lifecycle-service, ratecon-intake, routes.ts admin actions).
 */
export async function sendDispatchSms(loadId: string): Promise<{ ok: boolean; error?: string; messageSid?: string; phone?: string; email?: string; channel?: string }> {
  const channel = (process.env.DISPATCH_CHANNEL || "sms").toLowerCase();

  // Email-only mode: never call Twilio.
  if (channel === "email") {
    const r = await sendDispatchEmail(loadId);
    return { ok: r.ok, error: r.error, email: r.email, channel: "email" };
  }

  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load || !load.driverId) return { ok: false, error: "Load or driver missing" };
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
  if (!driver) return { ok: false, error: "Driver not found" };
  const phone = (driver as any).phoneNumber ?? (driver as any).phone;
  if (!phone) {
    // No phone — try email if we have a path for it, otherwise fail as before.
    if (channel === "both" || channel === "email_fallback") {
      const r = await sendDispatchEmail(loadId);
      return { ok: r.ok, error: r.error, email: r.email, channel: "email" };
    }
    return { ok: false, error: "Driver has no phone" };
  }

  const { body } = buildDispatchSmsBody(load, driver);

  // SMS provider routing. Default is twilio (existing behavior). Set
  // SMS_PROVIDER=telnyx in env to route through Telnyx instead — the
  // body builder, brand prefix, and STOP suffix are provider-agnostic
  // so this is a true drop-in.
  const provider = (process.env.SMS_PROVIDER || "twilio").toLowerCase();
  console.log(`[dispatch-sms] sending to ${phone} for load ${load.loadNumber} (channel=${channel}, provider=${provider})`);

  const { withBrandAndOptOut } = await import("./sms-service");
  const finalBody = withBrandAndOptOut(body);

  let smsOk = false;
  let smsErr: string | undefined;
  let messageSid: string | undefined;
  try {
    if (provider === "telnyx") {
      const { sendTelnyxSms } = await import("./telnyx-service");
      const result = await sendTelnyxSms({ to: phone, body: finalBody });
      smsOk = result.success;
      smsErr = result.error;
      messageSid = result.messageSid;
    } else {
      const { smsService } = await import("./sms-service");
      const result = await smsService.sendSMS({ to: phone, body: finalBody, skipFooter: true });
      smsOk = result.success;
      smsErr = result.error;
      messageSid = result.messageSid;
    }
    if (smsOk) {
      console.log(`[dispatch-sms] ✅ sent via ${provider} to ${phone} (id: ${messageSid})`);
    } else {
      console.error(`[dispatch-sms] ❌ ${provider}: ${smsErr || "unknown SMS failure"}`);
    }
  } catch (err: any) {
    smsErr = `${provider}: ${err.message}`;
    console.error(`[dispatch-sms] ❌ ${provider} send threw: ${err.message}`);
  }

  // "both" → fire email regardless of SMS result.
  // "email_fallback" → fire email only if SMS failed.
  const shouldEmail =
    channel === "both" || (channel === "email_fallback" && !smsOk);

  if (shouldEmail) {
    const r = await sendDispatchEmail(loadId);
    if (smsOk && r.ok) return { ok: true, messageSid, phone, email: r.email, channel: "both" };
    if (smsOk && !r.ok) return { ok: true, messageSid, phone, channel: "sms+email_failed", error: `email error: ${r.error}` };
    if (!smsOk && r.ok) return { ok: true, email: r.email, phone, channel: "email_fallback", error: `sms error: ${smsErr}` };
    return { ok: false, error: `sms error: ${smsErr}; email error: ${r.error}`, phone, channel };
  }

  return smsOk
    ? { ok: true, messageSid, phone, channel: "sms" }
    : { ok: false, error: smsErr || "SMS send failed", phone, channel: "sms" };
}
