// Regression guard for the COI lapse monitor's alert decision (server/coi-service.ts).
// This is a NEW outbound SMS path; per CLAUDE.md the guards must be tripwired.
//
// The four asserts that matter most for financial safety:
//   - first sight of a document          -> NO alert  (the deploy watermark)
//   - same bucket seen again             -> NO alert  (per-document dedup)
//   - a corrected date moving the wrong way -> NO alert
//   - a genuine new escalation           -> ALERT
//
// If anyone loosens decideCoiAlert and reintroduces a blast-on-deploy or a
// re-fire-on-restart, one of these fails loudly.

import { describe, it, expect } from 'vitest';
import {
  COI_THRESHOLDS,
  thresholdBucket,
  decideCoiAlert,
  buildCoiAlertSms,
} from '../coi-service';

describe('thresholdBucket', () => {
  it('returns null further out than the widest threshold', () => {
    expect(thresholdBucket(31)).toBeNull();
    expect(thresholdBucket(365)).toBeNull();
  });

  it('returns the most urgent crossed threshold', () => {
    expect(thresholdBucket(30)).toBe(30);
    expect(thresholdBucket(20)).toBe(30);
    expect(thresholdBucket(14)).toBe(14);
    expect(thresholdBucket(8)).toBe(14);
    expect(thresholdBucket(7)).toBe(7);
    expect(thresholdBucket(2)).toBe(7);
    expect(thresholdBucket(1)).toBe(1);
  });

  it('clamps expired to 0', () => {
    expect(thresholdBucket(0)).toBe(0);
    expect(thresholdBucket(-1)).toBe(0);
    expect(thresholdBucket(-400)).toBe(0);
  });

  it('every threshold maps to itself', () => {
    for (const t of COI_THRESHOLDS) expect(thresholdBucket(t)).toBe(t);
  });
});

describe('decideCoiAlert', () => {
  it('NEVER alerts on first sight, even for an already-expired certificate', () => {
    expect(decideCoiAlert(null, true, 0)).toEqual({ action: 'baseline', threshold: 0 });
    expect(decideCoiAlert(null, true, 7)).toEqual({ action: 'baseline', threshold: 7 });
    expect(decideCoiAlert(null, true, null)).toEqual({ action: 'baseline', threshold: null });
  });

  it('alerts on the first escalation after baseline', () => {
    expect(decideCoiAlert(null, false, 30)).toEqual({ action: 'alert', threshold: 30 });
  });

  it('alerts on each new, more urgent bucket', () => {
    expect(decideCoiAlert(30, false, 14)).toEqual({ action: 'alert', threshold: 14 });
    expect(decideCoiAlert(14, false, 7)).toEqual({ action: 'alert', threshold: 7 });
    expect(decideCoiAlert(7, false, 1)).toEqual({ action: 'alert', threshold: 1 });
    expect(decideCoiAlert(1, false, 0)).toEqual({ action: 'alert', threshold: 0 });
  });

  it('dedups the same bucket seen again — restart, double tick, re-detect', () => {
    for (const t of COI_THRESHOLDS) {
      expect(decideCoiAlert(t, false, t)).toEqual({ action: 'dedup', threshold: t });
    }
  });

  it('dedups when the date is corrected the wrong way', () => {
    // Already alerted at 7 days; a corrected expiry pushes it back to the 30 bucket.
    expect(decideCoiAlert(7, false, 30)).toEqual({ action: 'dedup', threshold: 30 });
  });

  it('never re-alerts once expired, however many ticks run', () => {
    expect(decideCoiAlert(0, false, 0)).toEqual({ action: 'dedup', threshold: 0 });
  });

  it('is a no-change further out than 30 days', () => {
    expect(decideCoiAlert(null, false, null)).toEqual({ action: 'no-change', threshold: null });
    expect(decideCoiAlert(30, false, null)).toEqual({ action: 'no-change', threshold: null });
  });

  it('one document escalating all the way sends exactly five messages', () => {
    let prev: number | null = null;
    let sent = 0;
    let first = true;
    for (const days of [45, 30, 22, 14, 9, 7, 3, 1, 0, -5, -40]) {
      const d = decideCoiAlert(prev, first, thresholdBucket(days));
      first = false;
      if (d.action === 'alert') sent++;
      if (d.action !== 'no-change') prev = d.threshold;
    }
    // Baseline at 45 (null), then alerts at 30, 14, 7, 1, 0. Never again after expiry.
    expect(sent).toBe(5);
  });
});

describe('buildCoiAlertSms', () => {
  const expiry = new Date('2026-09-19T00:00:00Z');

  it('is GSM-7 safe — pure ASCII, or the segment length halves', () => {
    const body = buildCoiAlertSms('Marcus Webb', 'coi_auto_liability', 7, expiry);
    expect(body).toMatch(/^[\x00-\x7F]*$/);
    expect(body).not.toMatch(/[–—‘’“”→]/);
  });

  it('names the driver, the coverage, and the date', () => {
    const body = buildCoiAlertSms('Marcus Webb', 'coi_bobtail', 7, expiry);
    expect(body).toContain('Marcus Webb');
    expect(body).toContain('bobtail');
    expect(body).toContain('2026-09-19');
  });

  it('says EXPIRED rather than a negative day count', () => {
    const body = buildCoiAlertSms('Marcus Webb', 'coi_cargo', -3, expiry);
    expect(body).toContain('EXPIRED');
    expect(body).not.toContain('-3');
  });

  it('singularises one day', () => {
    expect(buildCoiAlertSms('A', 'coi_cargo', 1, expiry)).toContain('1 day ');
    expect(buildCoiAlertSms('A', 'coi_cargo', 7, expiry)).toContain('7 days ');
  });

  it('stays inside two GSM-7 segments for a realistic name', () => {
    expect(buildCoiAlertSms('Marcus Webb', 'coi_occ_acc', 14, expiry).length).toBeLessThanOrEqual(306);
  });
});
