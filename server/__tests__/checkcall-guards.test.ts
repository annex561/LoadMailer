// Guards for server/checkcall-service.ts.
//
// This feature answers a live broker on the phone. The assertions that matter most are the ones
// proving it REFUSES to speak: an ambiguous caller, a stale fix, a hit ceiling, a repeat call.
// A wrong location stated confidently to a broker is worse than saying nothing, and unlike a bad
// number on a screen there is no undo — they have already written it down.
//
// The second group proves the <Dial> survives. If the splice ever drops it, a broker calling the
// office line hears a recording and never reaches a person.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchLoadsByCallerId,
  isPositionFresh,
  buildPositionSpeech,
  decideCheckCall,
  spliceCheckCallSpeech,
  answersInLastHour,
  lastAnsweredFor,
  recordAutoAnswer,
  __resetCheckCallCounters,
  DEFAULT_MAX_PER_HOUR,
  DEFAULT_MAX_FIX_AGE_MIN,
  type CheckCallLoad,
  type DriverPosition,
  type DecisionInput,
} from '../checkcall-service';
import { buildInboundTwiml } from '../driver-line-service';

const NOW = new Date('2026-09-10T15:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function load(over: Partial<CheckCallLoad> = {}): CheckCallLoad {
  return {
    id: 'L1',
    loadNumber: 'A847291',
    brokerPhone: '+14045551234',
    contactPhone: null,
    customerPhone: null,
    destCity: 'Dallas',
    destState: 'TX',
    ...over,
  };
}

function pos(over: Partial<DriverPosition> = {}): DriverPosition {
  return { address: 'Chattanooga, TN', latitude: 35.0457, longitude: -85.3097, timestamp: minsAgo(4), ...over };
}

function decide(over: Partial<DecisionInput> = {}) {
  return decideCheckCall({
    enabled: true,
    killed: false,
    callerNumber: '+14045551234',
    matches: [load()],
    position: pos(),
    now: NOW,
    maxFixAgeMin: DEFAULT_MAX_FIX_AGE_MIN,
    answersThisHour: 0,
    maxPerHour: DEFAULT_MAX_PER_HOUR,
    lastAnsweredAt: null,
    ...over,
  });
}

beforeEach(() => __resetCheckCallCounters());

describe('matchLoadsByCallerId', () => {
  it('matches on the broker phone regardless of formatting', () => {
    const loads = [load({ brokerPhone: '(404) 555-1234' })];
    expect(matchLoadsByCallerId(loads, '+14045551234')).toHaveLength(1);
  });

  it('matches a broker number carrying an extension', () => {
    // Rate confirmations routinely write "404-555-1234 x203", which is not valid E.164.
    const loads = [load({ brokerPhone: '404-555-1234 x203' })];
    expect(matchLoadsByCallerId(loads, '+14045551234')).toHaveLength(1);
  });

  it('falls back to the contact phone and the customer phone', () => {
    expect(matchLoadsByCallerId([load({ brokerPhone: null, contactPhone: '4045551234' })], '+14045551234')).toHaveLength(1);
    expect(matchLoadsByCallerId([load({ brokerPhone: null, customerPhone: '1-404-555-1234' })], '+14045551234')).toHaveLength(1);
  });

  it('returns nothing for an unknown caller', () => {
    expect(matchLoadsByCallerId([load()], '+12125559999')).toHaveLength(0);
  });

  it('returns nothing when the caller id is blocked or malformed', () => {
    for (const bad of ['', 'anonymous', '+1', 'unknown']) {
      expect(matchLoadsByCallerId([load()], bad)).toHaveLength(0);
    }
  });

  it('returns EVERY match rather than picking one', () => {
    const loads = [load({ id: 'L1' }), load({ id: 'L2', loadNumber: 'B99' })];
    expect(matchLoadsByCallerId(loads, '+14045551234')).toHaveLength(2);
  });
});

describe('decideCheckCall — refuses to speak', () => {
  it('forwards when the feature is disabled', () => {
    const d = decide({ enabled: false });
    expect(d.answer).toBe(false);
    expect(d.reason).toBe('disabled');
  });

  it('forwards when the kill switch is set, even while enabled', () => {
    expect(decide({ killed: true }).reason).toBe('kill-switch');
  });

  it('forwards a blocked caller id', () => {
    expect(decide({ callerNumber: '' }).reason).toBe('no-caller-id');
  });

  it('forwards an unknown caller', () => {
    expect(decide({ matches: [] }).reason).toBe('no-match');
  });

  it('forwards when the caller has MORE THAN ONE active load', () => {
    // Naming the wrong load is worse than naming none. Two loads with the same broker on the
    // road at once is completely normal.
    const d = decide({ matches: [load({ id: 'L1' }), load({ id: 'L2' })] });
    expect(d.answer).toBe(false);
    expect(d.reason).toBe('ambiguous');
  });

  it('forwards when there is no position at all', () => {
    expect(decide({ position: null }).reason).toBe('no-position');
  });

  it('REFUSES to state a stale position', () => {
    // A confidently stated 4-hour-old location is worse than saying nothing — the broker
    // writes it down and plans against it.
    const d = decide({ position: pos({ timestamp: minsAgo(240) }) });
    expect(d.answer).toBe(false);
    expect(d.reason).toBe('stale-position');
    expect(d.logLine).toMatch(/240 min old/);
  });

  it('treats the staleness threshold as inclusive at the boundary', () => {
    expect(decide({ position: pos({ timestamp: minsAgo(DEFAULT_MAX_FIX_AGE_MIN) }) }).answer).toBe(true);
    expect(decide({ position: pos({ timestamp: minsAgo(DEFAULT_MAX_FIX_AGE_MIN + 1) }) }).answer).toBe(false);
  });

  it('forwards once the hourly ceiling is reached', () => {
    const d = decide({ answersThisHour: DEFAULT_MAX_PER_HOUR });
    expect(d.answer).toBe(false);
    expect(d.reason).toBe('rate-ceiling');
  });

  it('forwards a repeat caller on the same load inside the hour', () => {
    // Someone calling back within the hour wants a person, not the same recording again.
    const d = decide({ lastAnsweredAt: minsAgo(20) });
    expect(d.answer).toBe(false);
    expect(d.reason).toBe('recently-answered');
  });

  it('answers again once the dedup window has passed', () => {
    expect(decide({ lastAnsweredAt: minsAgo(61) }).answer).toBe(true);
  });

  it('never returns speech on any forwarded decision', () => {
    const forwards: Partial<DecisionInput>[] = [
      { enabled: false }, { killed: true }, { callerNumber: '' }, { matches: [] },
      { matches: [load({ id: 'a' }), load({ id: 'b' })] }, { position: null },
      { position: pos({ timestamp: minsAgo(999) }) }, { answersThisHour: 99 },
      { lastAnsweredAt: minsAgo(1) },
    ];
    for (const over of forwards) {
      const d = decide(over);
      expect(d.answer).toBe(false);
      expect(d.speech).toBeUndefined();
    }
  });
});

describe('decideCheckCall — answers the clean case', () => {
  it('answers a single fresh match and names the load', () => {
    const d = decide();
    expect(d.answer).toBe(true);
    expect(d.reason).toBe('answered');
    expect(d.loadId).toBe('L1');
    expect(d.speech).toContain('A847291');
    expect(d.speech).toContain('Chattanooga, TN');
  });
});

describe('buildPositionSpeech', () => {
  it('hedges the location with how old the fix is', () => {
    const s = buildPositionSpeech(load(), pos({ timestamp: minsAgo(12) }), NOW);
    expect(s).toMatch(/12 minutes ago/);
  });

  it('says "just now" for a fresh fix instead of "0 minutes ago"', () => {
    expect(buildPositionSpeech(load(), pos({ timestamp: NOW }), NOW)).toMatch(/just now/);
  });

  it('falls back to coordinates when there is no reverse-geocoded address', () => {
    const s = buildPositionSpeech(load(), pos({ address: null }), NOW);
    expect(s).toMatch(/35\.05 degrees north/);
    expect(s).toMatch(/85\.31 degrees west/);
  });

  it('omits the destination clause when the load has no destination', () => {
    const s = buildPositionSpeech(load({ destCity: null, destState: null }), pos(), NOW);
    expect(s).not.toMatch(/Destination/);
  });
});

describe('spliceCheckCallSpeech — the bridge must survive', () => {
  const base = buildInboundTwiml({ phone: '+12058614115' }, '+14045551234', 'Office');

  it('keeps the Dial so the caller still reaches a person', () => {
    const out = spliceCheckCallSpeech(base, 'The driver was near Chattanooga.');
    expect(out).toContain('<Dial');
    expect(out).toContain('+12058614115');
    expect(out).toContain('The driver was near Chattanooga.');
  });

  it('puts the position BEFORE the existing greeting and the Dial', () => {
    const out = spliceCheckCallSpeech(base, 'POSITION');
    expect(out.indexOf('POSITION')).toBeLessThan(out.indexOf('Thank you for calling'));
    expect(out.indexOf('POSITION')).toBeLessThan(out.indexOf('<Dial'));
  });

  it('escapes XML so a broker name with an ampersand cannot break the TwiML', () => {
    const out = spliceCheckCallSpeech(base, 'Load A&B <test> "quoted"');
    expect(out).toContain('A&amp;B');
    expect(out).toContain('&lt;test&gt;');
    expect(out).not.toMatch(/<test>/);
  });

  it('returns the base TwiML untouched if the opening tag is ever missing', () => {
    // Degrade to current behavior rather than emit malformed XML and drop the call.
    expect(spliceCheckCallSpeech('not twiml at all', 'x')).toBe('not twiml at all');
  });

  it('still produces a single well-formed Response element', () => {
    const out = spliceCheckCallSpeech(base, 'hello');
    expect(out.match(/<Response>/g)).toHaveLength(1);
    expect(out.match(/<\/Response>/g)).toHaveLength(1);
  });
});

describe('rolling-hour counters', () => {
  it('counts only answers inside the last hour', () => {
    recordAutoAnswer('+14045551234', 'L1', new Date(NOW.getTime() - 90 * 60_000));
    recordAutoAnswer('+14045551234', 'L2', minsAgo(10));
    expect(answersInLastHour(NOW)).toBe(1);
  });

  it('tracks dedup per (caller, load) pair, not per caller', () => {
    recordAutoAnswer('+14045551234', 'L1', minsAgo(5));
    expect(lastAnsweredFor('+14045551234', 'L1')).not.toBeNull();
    expect(lastAnsweredFor('+14045551234', 'L2')).toBeNull();
    expect(lastAnsweredFor('+12125559999', 'L1')).toBeNull();
  });

  it('normalizes the caller number so formatting does not defeat dedup', () => {
    recordAutoAnswer('(404) 555-1234', 'L1', minsAgo(5));
    expect(lastAnsweredFor('+14045551234', 'L1')).not.toBeNull();
  });
});
