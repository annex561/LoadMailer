// Regression guard for the driver-facing My Truck page (server/driver-portal.ts).
//
// This page is read on a phone at a dock by someone who is not going to parse a state
// machine. availabilityHeadline is the translation layer, and the assert that matters is
// that a BLOCKED window reads as the driver's, not as a restriction on him — he set it.
// Getting that voice backwards is how a driver stops using the feature and starts
// calling dispatch again, which is the exact thing this replaces.

import { describe, it, expect } from 'vitest';
import { availabilityHeadline } from '../driver-portal';

const base = {
  availableFrom: null as Date | null,
  availableAt: null as string | null,
  firstLookExpiresAt: null as Date | null,
  blockedUntil: null as Date | null,
  currentLoadNumber: null as string | null,
};

describe('availabilityHeadline', () => {
  it('names the load and where the truck frees up when committed', () => {
    const h = availabilityHeadline({
      ...base,
      state: 'committed',
      currentLoadNumber: 'L-9042',
      availableFrom: new Date('2026-09-12T15:00:00Z'),
      availableAt: 'Atlanta, GA',
    });
    expect(h.tone).toBe('busy');
    expect(h.title).toContain('L-9042');
    expect(h.detail).toContain('Atlanta, GA');
  });

  it('tells him when the first look ends and that the truck is his after', () => {
    const h = availabilityHeadline({
      ...base,
      state: 'first_look',
      firstLookExpiresAt: new Date('2026-09-10T15:00:00Z'),
    });
    expect(h.tone).toBe('wait');
    expect(h.detail).toMatch(/yours to book/i);
  });

  it('frames a held window as HIS, not as a restriction on him', () => {
    const h = availabilityHeadline({
      ...base,
      state: 'blocked',
      blockedUntil: new Date('2026-09-13T18:00:00Z'),
    });
    expect(h.tone).toBe('yours');
    expect(h.title).toMatch(/yours/i);
    expect(h.detail).toMatch(/LAMP cannot dispatch/i);
  });

  it('says first to book it wins once open', () => {
    const h = availabilityHeadline({ ...base, state: 'open' });
    expect(h.tone).toBe('free');
    expect(h.title).toMatch(/first to book/i);
  });

  it('never prints a raw state name or an undefined at the driver', () => {
    for (const state of ['committed', 'first_look', 'open', 'blocked']) {
      const h = availabilityHeadline({ ...base, state });
      for (const text of [h.title, h.detail]) {
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('null');
        expect(text).not.toContain('_');
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
