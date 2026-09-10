// Shared-truck availability for split-authority owner-operators.
//
// One truck, two people trying to load it: LAMP's dispatch and the driver booking his
// own authority. The failure this prevents is both sides committing the same truck to
// the same window and one of them having to cancel on a broker.
//
// THE MODEL — the unit of commitment is the LOAD, not the day. A calendar split
// ("Mon-Wed is mine") fails because a Monday pickup delivering Wednesday eats the
// driver's days, and an empty Monday burns his capacity for nothing. Instead:
//
//   committed   the truck is on a load. Nobody offers into this window.
//   first_look  LAMP has an exclusive window (default 4h) to offer the next load.
//   open        LAMP passed or the window expired. Either side may book it.
//   blocked     the driver reserved this window for his own authority. LAMP must not
//               offer into it.
//
// Silence is a pass: the first-look window expires on a clock, not on an action. A
// held truck that does not move costs the driver money and costs LAMP the relationship.
//
// Read-only and pure. No outbound traffic, nothing billable.
//
// Regression guard: server/__tests__/truck-availability.test.ts

import { sql } from 'drizzle-orm';
import { db } from './db';

export const DEFAULT_FIRST_LOOK_HOURS = 4;

export type AvailabilityState = 'committed' | 'first_look' | 'open' | 'blocked';

export interface AvailabilityBlock {
  id?: string;
  startsAt: Date;
  endsAt: Date;
  note?: string | null;
}

export interface CurrentCommitment {
  loadNumber: string;
  /** When the truck frees up — the scheduled delivery. */
  availableFrom: Date;
  /** Where it frees up. Whoever books next should book from here, not from home. */
  availableAt: string | null;
}

export interface Availability {
  state: AvailabilityState;
  availableFrom: Date | null;
  availableAt: string | null;
  /** Set only while state is first_look. */
  firstLookExpiresAt: Date | null;
  /** The block that caused a blocked state. */
  blockedUntil: Date | null;
  currentLoadNumber: string | null;
}

function firstLookHours(): number {
  const n = Number(process.env.TRIP_FIRST_LOOK_HOURS || DEFAULT_FIRST_LOOK_HOURS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FIRST_LOOK_HOURS;
}

/** A block covers `at` when it starts on or before it and ends strictly after it. */
export function blockCovering(blocks: AvailabilityBlock[], at: Date): AvailabilityBlock | null {
  for (const b of blocks) {
    if (b.startsAt <= at && b.endsAt > at) return b;
  }
  return null;
}

/**
 * Resolve the truck's state at `now`.
 *
 * Order matters. A block is checked against the moment the truck actually frees up,
 * not against `now` — a driver who blocked Thursday has not blocked the load running
 * today. And a committed truck stays committed even inside a blocked window, because
 * the load in progress was agreed before the block.
 */
export function computeAvailability(
  commitment: CurrentCommitment | null,
  blocks: AvailabilityBlock[],
  now: Date,
  hours: number = firstLookHours(),
): Availability {
  // On a load. Nothing to offer until it delivers.
  if (commitment && commitment.availableFrom > now) {
    return {
      state: 'committed',
      availableFrom: commitment.availableFrom,
      availableAt: commitment.availableAt,
      firstLookExpiresAt: null,
      blockedUntil: null,
      currentLoadNumber: commitment.loadNumber,
    };
  }

  const freeSince = commitment?.availableFrom ?? null;
  const availableAt = commitment?.availableAt ?? null;

  // The driver claimed this window for his own authority.
  const block = blockCovering(blocks, now);
  if (block) {
    return {
      state: 'blocked',
      availableFrom: freeSince,
      availableAt,
      firstLookExpiresAt: null,
      blockedUntil: block.endsAt,
      currentLoadNumber: null,
    };
  }

  // First look runs from the moment the truck became free. With no prior commitment on
  // record there is nothing to measure the window from, so it is open.
  if (freeSince) {
    const expires = new Date(freeSince.getTime() + hours * 3600_000);
    if (now < expires) {
      return {
        state: 'first_look',
        availableFrom: freeSince,
        availableAt,
        firstLookExpiresAt: expires,
        blockedUntil: null,
        currentLoadNumber: null,
      };
    }
  }

  return {
    state: 'open',
    availableFrom: freeSince,
    availableAt,
    firstLookExpiresAt: null,
    blockedUntil: null,
    currentLoadNumber: null,
  };
}

/**
 * May LAMP offer a load to this truck right now?
 *
 * Refused only when the truck is already committed to a load, or when the driver has
 * blocked the window for his own authority. `open` is NOT a lockout — it means the
 * exclusive window lapsed and either side may take it, first to commit wins.
 */
export function canOffer(a: Availability): { ok: boolean; reason?: string } {
  if (a.state === 'committed') {
    return {
      ok: false,
      reason:
        `Truck is on load ${a.currentLoadNumber} until ` +
        `${a.availableFrom?.toISOString().slice(0, 16).replace('T', ' ')}` +
        `${a.availableAt ? ` in ${a.availableAt}` : ''}.`,
    };
  }
  if (a.state === 'blocked') {
    return {
      ok: false,
      reason:
        `Driver reserved this window for his own authority until ` +
        `${a.blockedUntil?.toISOString().slice(0, 16).replace('T', ' ')}.`,
    };
  }
  return { ok: true };
}

/**
 * Read the driver's current commitment and blocks, then resolve state at `at`.
 *
 * `at` is the moment being asked about — pass a prospective load's PICKUP time to ask
 * "will this truck be free when this load picks up", not just "is it free now".
 *
 * `excludeLoadId` matters at Approve & Dispatch: the load being dispatched has already
 * been created and assigned to the driver by then, so without excluding it the truck
 * reads as committed to the very load we are checking and blocks itself.
 */
export async function getDriverAvailability(
  driverId: string,
  at = new Date(),
  excludeLoadId?: string,
): Promise<Availability> {
  const now = at;
  const c = await db.execute(sql`
    SELECT load_number, delivery_date, delivery_address
    FROM loads
    WHERE driver_id = ${driverId}
      AND status NOT IN ('delivered', 'cancelled', 'expired')
      AND delivery_date IS NOT NULL
      AND (${excludeLoadId ?? null}::text IS NULL OR id <> ${excludeLoadId ?? null})
    ORDER BY delivery_date DESC
    LIMIT 1
  `);
  const row: any = (c as any).rows?.[0];
  const commitment: CurrentCommitment | null = row
    ? {
        loadNumber: row.load_number,
        availableFrom: new Date(row.delivery_date),
        availableAt: row.delivery_address ?? null,
      }
    : null;

  const b = await db.execute(sql`
    SELECT id, starts_at, ends_at, note
    FROM driver_availability_blocks
    WHERE driver_id = ${driverId} AND ends_at > ${now}
    ORDER BY starts_at ASC
  `);
  const blocks: AvailabilityBlock[] = ((b as any).rows ?? []).map((x: any) => ({
    id: x.id,
    startsAt: new Date(x.starts_at),
    endsAt: new Date(x.ends_at),
    note: x.note ?? null,
  }));

  return computeAvailability(commitment, blocks, now);
}
