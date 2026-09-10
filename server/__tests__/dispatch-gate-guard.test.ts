// Guard for server/dispatch-gate-guard.ts.
//
// dispatchFromIntake is a critical workflow: it creates the load and texts the driver. A
// blocking check that misfires here does not produce a wrong number, it produces NO DISPATCH,
// and the operator loses the load. So the assertions that matter most are the ones proving this
// guard stays out of the way:
//
//   - a driver with no truck linked is never blocked
//   - nothing is blocked while DISPATCH_GATE_ENFORCE is off
//   - only an explicit RED, with enforcement on and no override, blocks
//
// If any of those invert, dispatch silently stops for a class of drivers.

import { describe, it, expect } from 'vitest';
import { decideDispatchGate, type GateDecisionInput } from '../dispatch-gate-guard';

function decide(over: Partial<GateDecisionInput> = {}) {
  return decideDispatchGate({
    gateStatus: 'GREEN',
    reasons: [],
    hasActiveOverride: false,
    overrideReason: null,
    enforce: true,
    ...over,
  });
}

describe('decideDispatchGate — stays out of the way', () => {
  it('allows when no truck is linked to the driver, even with enforcement on', () => {
    // trucks.assignedDriverId is unset for many drivers. Blocking here would break dispatch
    // for every one of them at once.
    const d = decide({ gateStatus: null });
    expect(d.allow).toBe(true);
    expect(d.logLine).toMatch(/no truck linked/i);
  });

  it('allows a RED truck while enforcement is OFF, and says so in the log', () => {
    const d = decide({ gateStatus: 'RED', reasons: ['Annual inspection expired'], enforce: false });
    expect(d.allow).toBe(true);
    expect(d.logLine).toMatch(/NOT ENFORCED/);
    expect(d.logLine).toMatch(/Annual inspection expired/);
  });

  it('allows GREEN and YELLOW even with enforcement on', () => {
    expect(decide({ gateStatus: 'GREEN' }).allow).toBe(true);
    expect(decide({ gateStatus: 'YELLOW', reasons: ['PM due in 400 mi'] }).allow).toBe(true);
  });

  it('never sets blockReason on an allowed dispatch', () => {
    for (const status of ['GREEN', 'YELLOW'] as const) {
      expect(decide({ gateStatus: status }).blockReason).toBeUndefined();
    }
    expect(decide({ gateStatus: null }).blockReason).toBeUndefined();
    expect(decide({ gateStatus: 'RED', enforce: false }).blockReason).toBeUndefined();
  });
});

describe('decideDispatchGate — blocks only the one case it should', () => {
  it('blocks a RED truck when enforcement is on and there is no override', () => {
    const d = decide({ gateStatus: 'RED', reasons: ['Annual inspection expired', 'PM 3,000 mi overdue'] });
    expect(d.allow).toBe(false);
    expect(d.blockReason).toMatch(/RED on the dispatch gate/);
    expect(d.blockReason).toMatch(/Annual inspection expired/);
    expect(d.blockReason).toMatch(/PM 3,000 mi overdue/);
  });

  it('allows a RED truck when the dispatcher supplies an override reason', () => {
    const d = decide({ gateStatus: 'RED', reasons: ['Insurance lapsed'], overrideReason: 'COI renewed, portal not synced' });
    expect(d.allow).toBe(true);
    expect(d.logLine).toMatch(/OVERRIDDEN by dispatcher: COI renewed/);
  });

  it('ignores a blank or whitespace-only override reason', () => {
    expect(decide({ gateStatus: 'RED', overrideReason: '   ' }).allow).toBe(false);
    expect(decide({ gateStatus: 'RED', overrideReason: '' }).allow).toBe(false);
  });

  it('allows a RED truck carrying a standing 24h override', () => {
    const d = decide({ gateStatus: 'RED', reasons: ['Open work order'], hasActiveOverride: true });
    expect(d.allow).toBe(true);
    expect(d.logLine).toMatch(/standing 24h override/);
  });
});

describe('decideDispatchGate — logging', () => {
  it('always produces a log line, allowed or blocked', () => {
    for (const status of [null, 'GREEN', 'YELLOW', 'RED'] as const) {
      for (const enforce of [true, false]) {
        const d = decide({ gateStatus: status, enforce });
        expect(d.logLine.length).toBeGreaterThan(0);
      }
    }
  });

  it('carries the gate reasons into the log so the operator can act on them', () => {
    const d = decide({ gateStatus: 'YELLOW', reasons: ['DOT physical expires in 12 days'] });
    expect(d.logLine).toMatch(/DOT physical expires in 12 days/);
  });
});
