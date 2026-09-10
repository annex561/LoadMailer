// Per-load Trip Lease Addendum for split-authority owner-operators.
//
// A driver who holds his own MC and runs part of his weeks under LAMP's authority is
// on the Master Trip Lease (docs/agreements/master-trip-lease-lamp-to-owner-operator.md),
// which conveys NO possession by itself. Possession transfers per load, on an executed
// Trip Addendum, and 49 CFR 376.11(b) requires the receipt that records it. This module
// creates that document at Approve & Dispatch.
//
// SAFETY — read before changing anything here:
//
//   1. Default OFF twice over. Nothing happens unless TRIP_ADDENDUM_ENABLED=true AND
//      the driver row carries split_authority_enabled=true. Every existing driver
//      defaults FALSE, so dispatch behaves exactly as it did before this file existed.
//
//   2. No billable vendor traffic. DocuSeal is self-hosted on Railway and the
//      submission is created with send_email:false and send_sms:false, exactly like
//      server/recruiting/vendors.ts. No Twilio, no SMTP, no per-message cost. The
//      signing URL comes back in the dispatch response for the operator to relay.
//      Wiring that URL into the driver's dispatch SMS is a SEPARATE, approval-gated
//      change — do not add it here.
//
//   3. Best-effort AFTER dispatch. The coverage gate runs BEFORE dispatch (see
//      preflightTripAddendum) so a lapse fails fast with nothing mutated. Creation
//      runs after, and a DocuSeal outage must never strand a dispatched load: it
//      returns { ok:false } and the operator is told to send the addendum by hand.
//
//   4. One per load. The addendum number is derived from the load number, so a retried
//      dispatch produces the same identifier rather than a second lease on one trip.
//
// Regression guard: server/__tests__/trip-addendum.test.ts

import { sql } from 'drizzle-orm';
import { db } from './db';
import { isDemoTemplateName } from './recruiting/vendors';

export interface SplitAuthorityDriver {
  id: string;
  name: string | null;
  email: string | null;
  splitAuthorityEnabled: boolean;
  ownMcNumber: string | null;
  ownDotNumber: string | null;
  powerUnitType: string;
}

export interface AddendumLoad {
  id: string;
  loadNumber: string;
  brokerName: string | null;
  originCity: string | null;
  originState: string | null;
  pickupAddress: string | null;
  pickupDate: Date | null;
  pickupTime: string | null;
  deliveryAddress: string | null;
  deliveryDate: Date | null;
  deliveryTime: string | null;
  commodity: string | null;
  rate: number | null;
  driverId: string | null;
}

/**
 * Both switches must be on. The env var is the kill switch the operator controls; the
 * driver flag is the per-entity opt-in. A driver on the standard full-time lease has
 * split_authority_enabled=false and never reaches this path.
 */
export function shouldCreateTripAddendum(opts: {
  splitAuthorityEnabled: boolean;
  envEnabled: string | undefined;
}): boolean {
  return opts.envEnabled === 'true' && opts.splitAuthorityEnabled === true;
}

/**
 * Box truck and tractor-trailer are separate signed instruments — the box template
 * records liftgate, ramp, box length and dock height, the tractor template records the
 * trailer and interchange. Sending the wrong one puts dead fields on a signed lease.
 * Anything other than an explicit tractor value resolves to the box template, because
 * the fleet is box trucks.
 */
export function templateIdForPowerUnit(
  powerUnitType: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const isTractor = ['tractor', 'tractor_trailer', 'semi'].includes(
    String(powerUnitType ?? '').toLowerCase(),
  );
  const id = isTractor
    ? env.DOCUSEAL_TRIP_ADDENDUM_TRACTOR_TEMPLATE_ID
    : env.DOCUSEAL_TRIP_ADDENDUM_BOX_TEMPLATE_ID;
  return id && id.trim() ? id.trim() : null;
}

/** Stable per-load identifier, so a retried dispatch does not open a second lease. */
export function addendumNumberForLoad(loadNumber: string): string {
  return `TLA-${loadNumber}`;
}

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

function cityState(city: string | null, state: string | null, fallback: string | null): string {
  const cs = [city, state].filter(Boolean).join(', ');
  return cs || (fallback ?? '');
}

/** Field values pushed into DocuSeal template 16 or 17. Names must match the tags. */
export function buildAddendumPrefill(
  load: AddendumLoad,
  driver: SplitAuthorityDriver,
  coverageVerified: boolean,
  masterAgreementDate: Date | null,
): Record<string, string | boolean> {
  return {
    'Addendum Number': addendumNumberForLoad(load.loadNumber),
    'Master Agreement Date': fmtDate(masterAgreementDate),
    'Lessor Legal Name': driver.name ?? '',
    'Lessor MC Number': driver.ownMcNumber ?? '',
    'Lessor DOT Number': driver.ownDotNumber ?? '',
    'Load Number': load.loadNumber,
    'Broker Name': load.brokerName ?? '',
    'Origin City State': cityState(load.originCity, load.originState, load.pickupAddress),
    'Pickup DateTime': `${fmtDate(load.pickupDate)} ${load.pickupTime ?? ''}`.trim(),
    'Destination City State': load.deliveryAddress ?? '',
    'Delivery DateTime': `${fmtDate(load.deliveryDate)} ${load.deliveryTime ?? ''}`.trim(),
    Commodity: load.commodity ?? '',
    'Trip Driver Name': driver.name ?? '',
    // Master Section 10.4 — this is the interlock, computed from the COI check rather
    // than typed by whoever is dispatching.
    'Coverage Verified': coverageVerified,
  };
}

/** Read the driver's split-authority configuration. Raw SQL — see ensure-schema.ts. */
export async function getSplitAuthorityDriver(
  driverId: string,
): Promise<SplitAuthorityDriver | null> {
  const r = await db.execute(sql`
    SELECT id, name, email,
           COALESCE(split_authority_enabled, FALSE) AS split_authority_enabled,
           own_mc_number, own_dot_number,
           COALESCE(power_unit_type, 'box_truck') AS power_unit_type,
           trip_lease_signed_at
    FROM drivers
    WHERE id = ${driverId}
    LIMIT 1
  `);
  const row: any = (r as any).rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
    splitAuthorityEnabled: row.split_authority_enabled === true,
    ownMcNumber: row.own_mc_number ?? null,
    ownDotNumber: row.own_dot_number ?? null,
    powerUnitType: row.power_unit_type ?? 'box_truck',
  };
}

export interface PreflightResult {
  applies: boolean;
  ok: boolean;
  reason?: string;
}

/**
 * Coverage gate. Call this BEFORE dispatching, so a lapse fails with nothing mutated
 * rather than leaving a load dispatched with no addendum behind it.
 *
 * A driver who is not split-authority, or the feature being off, returns
 * { applies:false, ok:true } — ordinary dispatch is never blocked by this.
 */
export async function preflightTripAddendum(
  driverId: string,
  deliveryDate: Date,
): Promise<PreflightResult> {
  const driver = await getSplitAuthorityDriver(driverId);
  if (
    !driver ||
    !shouldCreateTripAddendum({
      splitAuthorityEnabled: driver.splitAuthorityEnabled,
      envEnabled: process.env.TRIP_ADDENDUM_ENABLED,
    })
  ) {
    return { applies: false, ok: true };
  }

  const { getDriverCoverageStatus, coverageFailureReason } = await import('./coi-service');
  const status = await getDriverCoverageStatus(driverId, deliveryDate);
  if (!status.ok) {
    return {
      applies: true,
      ok: false,
      reason:
        `Trip addendum blocked — Master Trip Lease Section 10.4: ` +
        coverageFailureReason(status),
    };
  }
  return { applies: true, ok: true };
}

export interface CreateAddendumResult {
  ok: boolean;
  skipped?: boolean;
  addendumNumber?: string;
  submissionId?: string;
  signingUrl?: string;
  error?: string;
}

/** Create the DocuSeal submission for one load. Best-effort; never throws. */
export async function createTripAddendum(load: AddendumLoad): Promise<CreateAddendumResult> {
  try {
    if (!load.driverId) return { ok: false, skipped: true, error: 'load has no driver' };

    const driver = await getSplitAuthorityDriver(load.driverId);
    if (
      !driver ||
      !shouldCreateTripAddendum({
        splitAuthorityEnabled: driver?.splitAuthorityEnabled ?? false,
        envEnabled: process.env.TRIP_ADDENDUM_ENABLED,
      })
    ) {
      return { ok: true, skipped: true };
    }

    const docusealUrl = (process.env.DOCUSEAL_URL || '').replace(/\/+$/, '');
    const apiKey = process.env.DOCUSEAL_API_KEY || '';
    const templateId = templateIdForPowerUnit(driver.powerUnitType);
    if (!docusealUrl || !apiKey || !templateId) {
      return { ok: false, error: 'DocuSeal not configured for trip addenda' };
    }

    // Same guard as the onboarding path: never send a driver DocuSeal's sample
    // template. See docs/FIX-LEDGER.md and server/recruiting/vendors.ts.
    const nameResp = await fetch(`${docusealUrl}/api/templates/${templateId}`, {
      headers: { 'X-Auth-Token': apiKey },
    }).catch(() => null);
    const templateName = nameResp?.ok ? ((await nameResp.json()) as any)?.name ?? null : null;
    if (isDemoTemplateName(templateName)) {
      return {
        ok: false,
        error: `DocuSeal template ${templateId} is named "${templateName}", which looks like a sample template. Refusing to send it.`,
      };
    }

    const { getDriverCoverageStatus } = await import('./coi-service');
    const deliveryDate = load.deliveryDate ?? new Date();
    const coverage = await getDriverCoverageStatus(driver.id, deliveryDate);

    const addendumNumber = addendumNumberForLoad(load.loadNumber);
    const values = buildAddendumPrefill(load, driver, coverage.ok, null);

    const resp = await fetch(`${docusealUrl}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': apiKey },
      body: JSON.stringify({
        template_id: Number(templateId),
        // No email, no SMS. The signing URL is returned to the operator instead.
        send_email: false,
        send_sms: false,
        submitters: [
          {
            role: 'Driver',
            name: driver.name ?? 'Driver',
            email: driver.email ?? undefined,
            external_id: addendumNumber,
            values,
            metadata: { load_id: load.id, addendum_number: addendumNumber },
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return { ok: false, error: `DocuSeal create submission failed: ${resp.status} ${txt}` };
    }

    const submitters = (await resp.json()) as Array<{
      submission_id: number;
      slug: string;
      embed_src?: string;
    }>;
    const s = submitters?.[0];
    if (!s?.slug) return { ok: false, error: 'DocuSeal returned submission without signing slug' };

    console.log(
      `[trip-addendum] created ${addendumNumber} for load ${load.loadNumber} ` +
        `(driver ${driver.id}, ${driver.powerUnitType}, coverage_verified=${coverage.ok})`,
    );

    const signingUrl = s.embed_src || `${docusealUrl}/s/${s.slug}`;

    // Persist for 376.11(b) retention and the monthly trip-leased gross report.
    // load_id is UNIQUE, so a retried dispatch refreshes this row rather than
    // recording a second lease on the same trip.
    try {
      await db.execute(sql`
        INSERT INTO trip_addenda
          (id, load_id, driver_id, addendum_number, submission_id, signing_url,
           coverage_verified, power_unit_type, gross_linehaul, load_number, delivery_date, created_at)
        VALUES
          (${addendumNumber}, ${load.id}, ${driver.id}, ${addendumNumber},
           ${String(s.submission_id)}, ${signingUrl}, ${coverage.ok}, ${driver.powerUnitType},
           ${load.rate ?? null}, ${load.loadNumber}, ${load.deliveryDate ?? null}, NOW())
        ON CONFLICT (load_id) DO UPDATE SET
          submission_id = EXCLUDED.submission_id,
          signing_url = EXCLUDED.signing_url,
          coverage_verified = EXCLUDED.coverage_verified,
          gross_linehaul = EXCLUDED.gross_linehaul,
          delivery_date = EXCLUDED.delivery_date
      `);
    } catch (e: any) {
      // The document exists in DocuSeal; failing to log it must not fail the dispatch.
      console.error('[trip-addendum] persist failed (submission still created):', e?.message || e);
    }

    return {
      ok: true,
      addendumNumber,
      submissionId: String(s.submission_id),
      signingUrl,
    };
  } catch (err: any) {
    // Never strand a dispatched load because DocuSeal is down.
    console.error('[trip-addendum] creation failed:', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Single entry point for the dispatch path: fetch the load, run the coverage gate, and
 * create the addendum if it passes.
 *
 * Returns `{ blocked: true }` ONLY for a split-authority driver whose coverage is
 * lapsed. The caller must not send the dispatch SMS in that case — a driver who does
 * not know about the load does not run it bare. Every other driver returns
 * `{ blocked: false, applies: false }` and dispatch proceeds untouched.
 */
export async function tripAddendumForDispatchedLoad(loadId: string): Promise<{
  applies: boolean;
  blocked: boolean;
  reason?: string;
  result?: CreateAddendumResult;
}> {
  try {
    const r = await db.execute(sql`
      SELECT id, load_number, broker_name, origin_city, origin_state, pickup_address,
             pickup_date, pickup_time, delivery_address, delivery_date, delivery_time,
             commodity, rate, driver_id
      FROM loads WHERE id = ${loadId} LIMIT 1
    `);
    const row: any = (r as any).rows?.[0];
    if (!row?.driver_id) return { applies: false, blocked: false };

    const load: AddendumLoad = {
      id: row.id,
      loadNumber: row.load_number,
      brokerName: row.broker_name ?? null,
      originCity: row.origin_city ?? null,
      originState: row.origin_state ?? null,
      pickupAddress: row.pickup_address ?? null,
      pickupDate: row.pickup_date ? new Date(row.pickup_date) : null,
      pickupTime: row.pickup_time ?? null,
      deliveryAddress: row.delivery_address ?? null,
      deliveryDate: row.delivery_date ? new Date(row.delivery_date) : null,
      deliveryTime: row.delivery_time ?? null,
      commodity: row.commodity ?? null,
      rate: row.rate ?? null,
      driverId: row.driver_id,
    };

    const pre = await preflightTripAddendum(load.driverId!, load.deliveryDate ?? new Date());
    if (!pre.applies) return { applies: false, blocked: false };
    if (!pre.ok) return { applies: true, blocked: true, reason: pre.reason };

    // Double-booking interlock. Asked at the load's PICKUP time, excluding this load
    // (it is already assigned to the driver by the time we get here). Refuses only when
    // the truck is on another load then, or the driver reserved that window for his own
    // authority. See server/truck-availability-service.ts.
    const { getDriverAvailability, canOffer } = await import('./truck-availability-service');
    const avail = await getDriverAvailability(
      load.driverId!,
      load.pickupDate ?? new Date(),
      load.id,
    );
    const offer = canOffer(avail);
    if (!offer.ok) {
      return { applies: true, blocked: true, reason: offer.reason };
    }

    return { applies: true, blocked: false, result: await createTripAddendum(load) };
  } catch (err: any) {
    // A failure to build the addendum must not block a load that passed the gate.
    console.error('[trip-addendum] dispatch hook failed:', err?.message || err);
    return { applies: false, blocked: false };
  }
}
