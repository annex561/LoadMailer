// Regression guard for the FreightGuard email parser (server/freightguard-service.ts).
// Fixture is the real Carrier411 notification body (MC1725755 / Federal Logistics,
// 2026-06-16). If Carrier411 shifts its format or someone loosens the parser, these
// catch it — a mis-parsed MC, response code, or deadline would silently route a case
// to the wrong carrier or miscount the 72-hour clock.

import { describe, it, expect } from 'vitest';
import {
  isFreightGuardEmail,
  parseFreightGuardEmail,
  parseStatedTimestamp,
  shouldAlertCase,
  buildFreightGuardAlertSms,
  hoursUntil,
} from '../freightguard-service';

const REAL_EMAIL = `MC1725755 FREIGHTGUARD REPORT

FEDERAL LOGISTICS, INC. reported its experience with your company and may make its report available to other transportation intermediaries, depending on your response. If you do not act within 72 hours, the report will indicate your failure to respond and will be released automatically.

REPORTED COMPANY:
LAMP PLLC
CHATTANOOGA, TN 37411
MC1725755

THE FOLLOWING ITEMS WERE REPORTED:
• NO SHOW AND NO CALL

ADDITIONAL COMMENTS:
THIS WAS A BOX TRUCK LOAD AND WE WERE ADAMANT WITH THE CARRIER ABOUT TIMES PICKING UP AND DELIVERING AND WE HAD TO HAVE IT PICK UP BY NOON . THE CARRIER CALLED AT 10AM AND SAID THEY NEEDED MORE TIME AFTER I WENT OVER EVERYTHING WITH THEM SEVERAL TIMES THE DAY BEFORE AND HAD A SIGNED CONFIRMATION. THEY WANTED TO PICK IT UP THE NEXT DAY WHICH WAS UNACCTABLE. WE CANNOT USE THEM AGAIN AND HAVE THEM ON THE DO NOT USE LIST

YOU HAVE 72 HOURS FROM JUNE 16, 2026 12:09 PM EST TO RESPOND

VISIT CARRIERRESPONSE.COM TO RESPOND

ENTER THIS RESPONSE CODE: 8476653821

REPORT SUBMITTED BY:
BLAKE HIGH
FEDERAL LOGISTICS, INC.
6637 BRIAR RIDGE LANE
PLANO, TX 75024
PHONE: (972) 370-9838`;

describe('isFreightGuardEmail', () => {
  it('accepts a real FreightGuard notification', () => {
    expect(isFreightGuardEmail(REAL_EMAIL)).toBe(true);
  });
  it('rejects unrelated mail', () => {
    expect(isFreightGuardEmail('Your invoice is ready. Total $600.')).toBe(false);
  });
});

describe('parseStatedTimestamp', () => {
  it('parses "JUNE 16, 2026 12:09 PM EST" to the correct UTC instant', () => {
    // 12:09 PM EST (-5) === 17:09 UTC
    expect(parseStatedTimestamp('JUNE 16, 2026 12:09 PM EST')!.toISOString()).toBe(
      '2026-06-16T17:09:00.000Z',
    );
  });
  it('handles AM and midnight correctly', () => {
    expect(parseStatedTimestamp('JUNE 16, 2026 12:00 AM EST')!.toISOString()).toBe(
      '2026-06-16T05:00:00.000Z',
    );
  });
});

describe('parseFreightGuardEmail', () => {
  const c = parseFreightGuardEmail(REAL_EMAIL)!;

  it('extracts the carrier, broker, and response code', () => {
    expect(c.mcNumber).toBe('MC1725755');
    expect(c.reportedCompany).toBe('LAMP PLLC');
    expect(c.brokerCompany).toBe('FEDERAL LOGISTICS, INC.');
    expect(c.brokerContact).toBe('BLAKE HIGH');
    expect(c.brokerPhone).toBe('(972) 370-9838');
    expect(c.responseCode).toBe('8476653821');
  });

  it('extracts the alleged items and comments', () => {
    expect(c.itemsReported).toEqual(['NO SHOW AND NO CALL']);
    expect(c.additionalComments).toContain('CALLED AT 10AM');
    expect(c.additionalComments).toContain('SIGNED CONFIRMATION');
  });

  it('computes the 72-hour deadline from the filed time', () => {
    expect(c.windowHours).toBe(72);
    expect(c.filedAt).toBe('2026-06-16T17:09:00.000Z');
    // filed + 72h = 2026-06-19T17:09:00Z (= ~12:09 PM ET Friday)
    expect(c.deadlineAt).toBe('2026-06-19T17:09:00.000Z');
  });

  it('returns null for non-FreightGuard mail', () => {
    expect(parseFreightGuardEmail('random text with no report')).toBeNull();
  });
});

describe('shouldAlertCase — the FreightGuard outbound-SMS tripwire', () => {
  const NOW = new Date('2026-06-16T18:00:00Z');
  const fresh = new Date('2026-06-16T17:30:00Z'); // 30 min old

  it('ALERTS an open, un-alerted, recent case', () => {
    expect(shouldAlertCase({ status: 'open', alertedAt: null, createdAt: fresh }, NOW, 96)).toEqual({
      alert: true,
      reason: 'alert',
    });
  });

  it('never re-alerts a case already alerted (dedup)', () => {
    expect(
      shouldAlertCase({ status: 'open', alertedAt: NOW, createdAt: fresh }, NOW, 96).alert,
    ).toBe(false);
  });

  it('never alerts a non-open case', () => {
    expect(
      shouldAlertCase({ status: 'removed', alertedAt: null, createdAt: fresh }, NOW, 96).reason,
    ).toBe('not-open');
  });

  it('never blasts a case older than the watermark window', () => {
    const old = new Date('2026-06-10T00:00:00Z'); // ~6 days old
    expect(shouldAlertCase({ status: 'open', alertedAt: null, createdAt: old }, NOW, 96)).toEqual({
      alert: false,
      reason: 'too-old',
    });
  });
});

describe('buildFreightGuardAlertSms', () => {
  const NOW = new Date('2026-06-16T18:00:00Z');
  it('renders an ASCII alert with MC, broker, items, code, and hours left', () => {
    const body = buildFreightGuardAlertSms(
      {
        mcNumber: 'MC1725755',
        brokerCompany: 'FEDERAL LOGISTICS, INC.',
        itemsReported: ['NO SHOW AND NO CALL'],
        responseCode: '8476653821',
        deadlineAt: '2026-06-19T17:09:00.000Z',
      },
      NOW,
    );
    expect(body).toContain('MC1725755');
    expect(body).toContain('FEDERAL LOGISTICS, INC.');
    expect(body).toContain('NO SHOW AND NO CALL');
    expect(body).toContain('code 8476653821');
    expect(body).toContain('carrierresponse.com');
    expect(body).toMatch(/~\d+h to respond/);
    expect(body).not.toMatch(/[^\x00-\x7F]/); // GSM-7 safe
  });
});

describe('hoursUntil', () => {
  it('computes hours to the deadline', () => {
    expect(hoursUntil('2026-06-16T18:00:00.000Z', new Date('2026-06-16T12:00:00Z'))).toBe(6);
  });
  it('returns null for a missing deadline', () => {
    expect(hoursUntil(null, new Date())).toBeNull();
  });
});
