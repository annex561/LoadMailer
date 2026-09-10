// Guards for server/broker-score-service.ts.
//
// The assertion that matters most: a broker with NO history must score UNKNOWN with a null
// score, never a passing grade. If absence of evidence ever renders as "GOOD", the dispatcher
// sees a green badge next to a broker nobody has ever dealt with and treats it as a clearance.
// That is worse than showing nothing at all.

import { describe, it, expect } from 'vitest';
import {
  scoreBroker,
  normalizeBrokerName,
  brokerNamesMatch,
  LATE_GRACE_DAYS,
  type BrokerSignals,
  type InvoiceRecord,
} from '../broker-score-service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    totalAmountCents: 250000,
    balanceDueCents: 0,
    dueDate: daysAgo(30),
    paidAt: daysAgo(29), // one day inside terms
    ...over,
  };
}

function signals(over: Partial<BrokerSignals> = {}): BrokerSignals {
  return { brokerName: 'TQL', filings: [], invoices: [], ...over };
}

describe('scoreBroker — absence of evidence is not a pass', () => {
  it('returns UNKNOWN with a null score when there is no history', () => {
    const s = scoreBroker(signals(), NOW);
    expect(s.grade).toBe('UNKNOWN');
    expect(s.score).toBeNull();
    expect(s.flags[0]).toMatch(/No history/i);
  });

  it('never grades an unknown broker GOOD', () => {
    expect(scoreBroker(signals(), NOW).grade).not.toBe('GOOD');
  });

  it('says the sample is thin when history is only one or two invoices', () => {
    const s = scoreBroker(signals({ invoices: [invoice()] }), NOW);
    expect(s.flags.join(' ')).toMatch(/thin sample/i);
  });
});

describe('scoreBroker — FreightGuard filings dominate', () => {
  it('grades CAUTION on a single filing regardless of a clean payment record', () => {
    const s = scoreBroker(
      signals({
        invoices: [invoice(), invoice(), invoice(), invoice()],
        filings: [{ filedAt: daysAgo(40), itemsReported: ['NO SHOW AND NO CALL'] }],
      }),
      NOW,
    );
    expect(s.grade).toBe('CAUTION');
    expect(s.flags.join(' ')).toMatch(/FreightGuard report/);
    expect(s.flags.join(' ')).toMatch(/NO SHOW AND NO CALL/);
  });

  it('deducts more for repeat filings', () => {
    const one = scoreBroker(signals({ filings: [{ filedAt: daysAgo(40), itemsReported: [] }] }), NOW);
    const three = scoreBroker(
      signals({
        filings: [
          { filedAt: daysAgo(40), itemsReported: [] },
          { filedAt: daysAgo(200), itemsReported: [] },
          { filedAt: daysAgo(300), itemsReported: [] },
        ],
      }),
      NOW,
    );
    expect(three.score!).toBeLessThan(one.score!);
    expect(three.stats.freightGuardFilings).toBe(3);
  });

  it('reports how long ago the most recent filing was', () => {
    const s = scoreBroker(signals({ filings: [{ filedAt: daysAgo(12), itemsReported: [] }] }), NOW);
    expect(s.stats.daysSinceLastFiling).toBe(12);
    expect(s.flags.join(' ')).toMatch(/12 days ago/);
  });

  it('does not crash on a filing with no date', () => {
    const s = scoreBroker(signals({ filings: [{ filedAt: null, itemsReported: [] }] }), NOW);
    expect(s.stats.freightGuardFilings).toBe(1);
    expect(s.stats.daysSinceLastFiling).toBeNull();
  });
});

describe('scoreBroker — payment behaviour', () => {
  it('grades GOOD for a broker who pays on time across a real sample', () => {
    const s = scoreBroker(signals({ invoices: [invoice(), invoice(), invoice(), invoice()] }), NOW);
    expect(s.grade).toBe('GOOD');
    expect(s.score).toBe(100);
    expect(s.stats.latePayments).toBe(0);
  });

  it('counts a payment inside the grace window as on time', () => {
    const s = scoreBroker(
      signals({ invoices: [invoice({ dueDate: daysAgo(30), paidAt: daysAgo(30 - LATE_GRACE_DAYS) })] }),
      NOW,
    );
    expect(s.stats.latePayments).toBe(0);
  });

  it('penalises a broker who pays late on most invoices', () => {
    const late = () => invoice({ dueDate: daysAgo(60), paidAt: daysAgo(20) }); // 40 days past terms
    const s = scoreBroker(signals({ invoices: [late(), late(), late(), invoice()] }), NOW);
    expect(s.stats.latePayments).toBe(3);
    expect(s.score!).toBeLessThan(80);
    expect(s.flags.join(' ')).toMatch(/Paid late on 3 of 4/);
  });

  it('flags money currently past due', () => {
    const s = scoreBroker(
      signals({
        invoices: [invoice(), invoice(), invoice({ balanceDueCents: 187500, paidAt: null, dueDate: daysAgo(45) })],
      }),
      NOW,
    );
    expect(s.stats.openPastDueCents).toBe(187500);
    expect(s.flags.join(' ')).toMatch(/\$1875\.00 currently past due/);
  });

  it('does not treat an unpaid invoice inside terms as past due', () => {
    const s = scoreBroker(
      signals({ invoices: [invoice({ balanceDueCents: 250000, paidAt: null, dueDate: daysAgo(1) })] }),
      NOW,
    );
    expect(s.stats.openPastDueCents).toBe(0);
  });

  it('reports average days past terms', () => {
    const s = scoreBroker(
      signals({
        invoices: [
          invoice({ dueDate: daysAgo(40), paidAt: daysAgo(30) }), // +10
          invoice({ dueDate: daysAgo(40), paidAt: daysAgo(20) }), // +20
        ],
      }),
      NOW,
    );
    expect(s.stats.avgDaysToPay).toBe(15);
  });

  it('keeps the score inside 0-100 no matter how bad the history', () => {
    const awful = () => invoice({ dueDate: daysAgo(200), paidAt: daysAgo(10), balanceDueCents: 999999 });
    const s = scoreBroker(
      signals({
        invoices: [awful(), awful(), awful(), invoice({ paidAt: null, balanceDueCents: 500000, dueDate: daysAgo(90) })],
        filings: [
          { filedAt: daysAgo(10), itemsReported: ['X'] },
          { filedAt: daysAgo(20), itemsReported: ['Y'] },
          { filedAt: daysAgo(30), itemsReported: ['Z'] },
        ],
      }),
      NOW,
    );
    expect(s.score!).toBeGreaterThanOrEqual(0);
    expect(s.score!).toBeLessThanOrEqual(100);
    expect(s.grade).toBe('CAUTION');
  });
});

describe('normalizeBrokerName / brokerNamesMatch', () => {
  it('collapses corporate suffixes so one broker is not three records', () => {
    expect(normalizeBrokerName('TQL Logistics, Inc.')).toBe('tql');
    expect(normalizeBrokerName('T.Q.L. LOGISTICS LLC')).toBe('t q l');
  });

  it('matches the same company written differently', () => {
    expect(brokerNamesMatch('TQL', 'TQL Logistics, Inc.')).toBe(true);
    expect(brokerNamesMatch('Federal Logistics, Inc.', 'FEDERAL LOGISTICS')).toBe(true);
    expect(brokerNamesMatch('TQL', 'TQL Total Quality')).toBe(true);
  });

  it('does not match different companies', () => {
    expect(brokerNamesMatch('TQL', 'CH Robinson')).toBe(false);
    // A shared generic word must not collapse two brokers into one.
    expect(brokerNamesMatch('Apex Logistics', 'Summit Logistics')).toBe(false);
  });

  it('never matches on an empty or missing name', () => {
    expect(brokerNamesMatch('', 'TQL')).toBe(false);
    expect(brokerNamesMatch(null, null)).toBe(false);
    expect(brokerNamesMatch('Logistics Inc', 'Transport LLC')).toBe(false);
  });
});
