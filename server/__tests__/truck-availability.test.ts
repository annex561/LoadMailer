// Regression guard for the shared-truck double-booking interlock
// (server/truck-availability-service.ts).
//
// The failure this prevents: LAMP dispatch and the driver's own broker both commit the
// same truck to the same window, and one of them cancels on a broker. Two of those and
// LAMP is on a do-not-use list.
//
// The asserts that matter:
//   - a truck already on a load at that moment cannot be offered another
//   - a window the driver reserved for his own authority cannot be offered into
//   - "open" is NOT a lockout — an expired first look means either side may book
//   - the first look is measured from when the truck FREES UP, not from now

import { describe, it, expect } from 'vitest';
import {
  computeAvailability,
  canOffer,
  blockCovering,
  DEFAULT_FIRST_LOOK_HOURS,
  type CurrentCommitment,
  type AvailabilityBlock,
} from '../truck-availability-service';

const H = 3600_000;
const NOW = new Date('2026-09-10T12:00:00Z');

const onLoad = (deliverAt: string): CurrentCommitment => ({
  loadNumber: 'L-9042',
  availableFrom: new Date(deliverAt),
  availableAt: 'Atlanta, GA',
});

const block = (from: string, to: string): AvailabilityBlock => ({
  startsAt: new Date(from),
  endsAt: new Date(to),
});

describe('computeAvailability', () => {
  it('is committed while the truck is still on a load', () => {
    const a = computeAvailability(onLoad('2026-09-12T15:00:00Z'), [], NOW);
    expect(a.state).toBe('committed');
    expect(a.currentLoadNumber).toBe('L-9042');
    expect(a.availableAt).toBe('Atlanta, GA');
  });

  it('gives LAMP a first look measured from when the truck frees up', () => {
    // Delivered an hour ago; the 4-hour window has 3 hours left.
    const a = computeAvailability(onLoad('2026-09-10T11:00:00Z'), [], NOW, 4);
    expect(a.state).toBe('first_look');
    expect(a.firstLookExpiresAt).toEqual(new Date('2026-09-10T15:00:00Z'));
  });

  it('opens to both sides once the first look lapses — silence is a pass', () => {
    // Delivered five hours ago, window was four.
    const a = computeAvailability(onLoad('2026-09-10T07:00:00Z'), [], NOW, 4);
    expect(a.state).toBe('open');
    expect(a.firstLookExpiresAt).toBeNull();
  });

  it('defaults the window to four hours', () => {
    const a = computeAvailability(onLoad('2026-09-10T11:00:00Z'), [], NOW);
    expect(a.firstLookExpiresAt).toEqual(
      new Date(new Date('2026-09-10T11:00:00Z').getTime() + DEFAULT_FIRST_LOOK_HOURS * H),
    );
  });

  it('is blocked inside a window the driver reserved', () => {
    const a = computeAvailability(
      onLoad('2026-09-10T07:00:00Z'),
      [block('2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z')],
      NOW,
    );
    expect(a.state).toBe('blocked');
    expect(a.blockedUntil).toEqual(new Date('2026-09-11T10:00:00Z'));
  });

  it('keeps a load in progress committed even inside a blocked window', () => {
    // The load was agreed before he blocked. It finishes.
    const a = computeAvailability(
      onLoad('2026-09-12T15:00:00Z'),
      [block('2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z')],
      NOW,
    );
    expect(a.state).toBe('committed');
  });

  it('ignores a block that has not started or has ended', () => {
    const future = computeAvailability(
      onLoad('2026-09-10T07:00:00Z'),
      [block('2026-09-11T00:00:00Z', '2026-09-12T00:00:00Z')],
      NOW,
    );
    expect(future.state).toBe('open');

    const past = computeAvailability(
      onLoad('2026-09-10T07:00:00Z'),
      [block('2026-09-09T00:00:00Z', '2026-09-10T00:00:00Z')],
      NOW,
    );
    expect(past.state).toBe('open');
  });

  it('is open when there is no commitment on record to measure a window from', () => {
    expect(computeAvailability(null, [], NOW).state).toBe('open');
  });
});

describe('canOffer', () => {
  it('refuses a truck already on a load, and names the load and the release', () => {
    const r = canOffer(computeAvailability(onLoad('2026-09-12T15:00:00Z'), [], NOW));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('L-9042');
    expect(r.reason).toContain('Atlanta, GA');
  });

  it('refuses a window the driver reserved', () => {
    const r = canOffer(
      computeAvailability(
        onLoad('2026-09-10T07:00:00Z'),
        [block('2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z')],
        NOW,
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('own authority');
  });

  it('allows during the first look', () => {
    expect(canOffer(computeAvailability(onLoad('2026-09-10T11:00:00Z'), [], NOW, 4)).ok).toBe(true);
  });

  it('STILL allows once open — an expired first look is not a lockout', () => {
    expect(canOffer(computeAvailability(onLoad('2026-09-10T07:00:00Z'), [], NOW, 4)).ok).toBe(true);
  });
});

describe('blockCovering', () => {
  it('treats the block as half-open: start inclusive, end exclusive', () => {
    const b = [block('2026-09-10T12:00:00Z', '2026-09-10T18:00:00Z')];
    expect(blockCovering(b, new Date('2026-09-10T12:00:00Z'))).not.toBeNull();
    expect(blockCovering(b, new Date('2026-09-10T17:59:59Z'))).not.toBeNull();
    // Back-to-back blocks must not both match the boundary instant.
    expect(blockCovering(b, new Date('2026-09-10T18:00:00Z'))).toBeNull();
  });
});
