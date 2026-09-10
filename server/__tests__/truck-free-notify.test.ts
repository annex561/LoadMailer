// Regression guard for the ONLY driver-facing SMS path in the split-authority feature
// set (server/truck-free-notify-service.ts).
//
// PR #62 fired 1,000+ Twilio messages by turning dead code live against a backlog. The
// four asserts that make that impossible here:
//
//   - first sight of a driver             -> NEVER sends (the deploy watermark)
//   - a load already notified             -> NEVER sends again (per-load dedup)
//   - a load that delivered long ago      -> NEVER sends (the recency bound)
//   - the middle of the night             -> NEVER sends (quiet hours)
//
// If any of these loosen, this file fails loudly before a driver's phone does.

import { describe, it, expect } from 'vitest';
import {
  decideTruckFreeNotify,
  withinSendWindow,
  buildTruckFreeSms,
  type FreeNotifyInput,
} from '../truck-free-notify-service';

const NOW = new Date('2026-09-10T14:00:00Z'); // 9 AM Central, inside the send window
const OPTS = { lookbackMinutes: 120, startHourUtc: 12, endHourUtc: 2 };

function input(over: Partial<FreeNotifyInput> = {}): FreeNotifyInput {
  return {
    state: 'first_look',
    availableFrom: new Date('2026-09-10T13:30:00Z'),
    firstLookExpiresAt: new Date('2026-09-10T17:30:00Z'),
    alreadyNotified: false,
    isFirstSight: false,
    driverPhone: '+14235551234',
    ...over,
  };
}

describe('decideTruckFreeNotify', () => {
  it('sends on a genuine, fresh first_look', () => {
    expect(decideTruckFreeNotify(input(), NOW, OPTS)).toEqual({ action: 'send' });
  });

  it('NEVER sends on first sight of a driver, whatever else is true', () => {
    expect(decideTruckFreeNotify(input({ isFirstSight: true }), NOW, OPTS)).toEqual({
      action: 'skip', reason: 'baseline',
    });
  });

  it('NEVER sends twice for the same freeing load', () => {
    expect(decideTruckFreeNotify(input({ alreadyNotified: true }), NOW, OPTS)).toEqual({
      action: 'skip', reason: 'already-notified',
    });
  });

  it('NEVER sends for a load that delivered outside the lookback window', () => {
    // Delivered 4 hours ago; lookback is 2. This is the redeploy blast-radius bound.
    const stale = input({ availableFrom: new Date('2026-09-10T10:00:00Z') });
    expect(decideTruckFreeNotify(stale, NOW, OPTS)).toEqual({ action: 'skip', reason: 'stale' });
  });

  it('NEVER sends in the middle of the night', () => {
    const threeAmCentral = new Date('2026-09-10T08:00:00Z');
    const fresh = input({ availableFrom: new Date('2026-09-10T07:30:00Z') });
    expect(decideTruckFreeNotify(fresh, threeAmCentral, OPTS)).toEqual({
      action: 'skip', reason: 'quiet-hours',
    });
  });

  it('does not send while the truck is still on a load', () => {
    expect(decideTruckFreeNotify(input({ state: 'committed' }), NOW, OPTS).action).toBe('skip');
  });

  it('does not send once the first look has already lapsed', () => {
    // Telling him about a window that closed is noise.
    expect(decideTruckFreeNotify(input({ state: 'open' }), NOW, OPTS)).toEqual({
      action: 'skip', reason: 'state:open',
    });
  });

  it('does not send into a window he blocked for himself', () => {
    expect(decideTruckFreeNotify(input({ state: 'blocked' }), NOW, OPTS).action).toBe('skip');
  });

  it('does not send without a phone number', () => {
    for (const phone of [null, undefined, '']) {
      expect(decideTruckFreeNotify(input({ driverPhone: phone }), NOW, OPTS)).toEqual({
        action: 'skip', reason: 'no-phone',
      });
    }
  });

  it('does not send before the truck is actually free', () => {
    const future = input({ availableFrom: new Date('2026-09-10T16:00:00Z') });
    expect(decideTruckFreeNotify(future, NOW, OPTS)).toEqual({ action: 'skip', reason: 'not-yet-free' });
  });

  it('one freeing load produces exactly one send across many ticks', () => {
    let notified = false;
    let sends = 0;
    for (let i = 0; i < 40; i++) {
      const d = decideTruckFreeNotify(input({ alreadyNotified: notified }), NOW, OPTS);
      if (d.action === 'send') { sends++; notified = true; }
    }
    expect(sends).toBe(1);
  });
});

describe('withinSendWindow', () => {
  it('handles a window that wraps midnight', () => {
    expect(withinSendWindow(new Date('2026-09-10T13:00:00Z'), 12, 2)).toBe(true);
    expect(withinSendWindow(new Date('2026-09-10T23:00:00Z'), 12, 2)).toBe(true);
    expect(withinSendWindow(new Date('2026-09-10T01:00:00Z'), 12, 2)).toBe(true);
    expect(withinSendWindow(new Date('2026-09-10T02:00:00Z'), 12, 2)).toBe(false);
    expect(withinSendWindow(new Date('2026-09-10T08:00:00Z'), 12, 2)).toBe(false);
  });

  it('treats equal bounds as always-on', () => {
    expect(withinSendWindow(new Date('2026-09-10T03:00:00Z'), 0, 0)).toBe(true);
  });
});

describe('buildTruckFreeSms', () => {
  const expires = new Date('2026-09-10T20:30:00Z');

  it('is GSM-7 safe — pure ASCII, or the segment length halves', () => {
    const body = buildTruckFreeSms('Atlanta, GA', expires);
    expect(body).toMatch(/^[\x20-\x7E\n]*$/);
  });

  it('stays inside one GSM-7 segment for a realistic city', () => {
    expect(buildTruckFreeSms('Atlanta, GA', expires).length).toBeLessThanOrEqual(160);
  });

  it('names the location and the deadline', () => {
    const body = buildTruckFreeSms('Atlanta, GA', expires);
    expect(body).toContain('Atlanta, GA');
    expect(body).toMatch(/3:30/);
  });

  it('reads cleanly with no location and no deadline', () => {
    const body = buildTruckFreeSms(null, null);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
    expect(body).toContain('book your own');
  });
});
