// Regression guard for the FMCSA monitor's alert decision (server/fmcsa-service.ts).
// This is a NEW outbound SMS path; per CLAUDE.md the guards must be tripwired.
//
// The four asserts that matter most for financial safety:
//   - baseline (first ever snapshot) -> NO alert  (the deploy watermark)
//   - identical status               -> NO alert
//   - change already alerted         -> NO alert  (per-state dedup)
//   - genuine new change             -> ALERT
// If anyone loosens decideFmcsaAlert / detectFmcsaChanges and reintroduces a
// blast-on-deploy or re-fire-on-restart, one of these fails loudly.

import { describe, it, expect } from 'vitest';
import {
  parseSaferSnapshot,
  normalizeSnapshot,
  isMcs150Stale,
  detectFmcsaChanges,
  hashMonitoredState,
  decideFmcsaAlert,
  buildFmcsaAlertSms,
  type MonitoredState,
  type SaferRawSnapshot,
} from '../fmcsa-service';

const NOW = new Date('2026-06-16T12:00:00Z');

function row(label: string, value: string): string {
  return (
    `<th scope="ROW" class="querylabelbkg" align="right">` +
    `<a class="querylabel" href="https://safer.fmcsa.dot.gov/saferhelp.aspx#">${label}:</a></th>\n` +
    `<td class="queryfield" valign="top">${value}&nbsp;</td>`
  );
}

const SAFER_HTML =
  `<html><body><table>\n` +
  row('Legal Name', 'LAMP PLLC') +
  row('USDOT Number', '4397421') +
  row('USDOT Status', 'ACTIVE') +
  row('Out of Service Date', 'None') +
  row('MCS-150 Form Date', '10/17/2025') +
  row(
    'Operating Authority Status',
    'AUTHORIZED FOR: Motor Carrier of Property (Except Household Goods)<br>' +
      'For Licensing and Insurance details <a href="x">click here.</a>',
  ) +
  row('MC/MX/FF Number(s)', '<a href="x">MC-1725755</a>') +
  `\n</table></body></html>`;

const BASE_RAW: SaferRawSnapshot = {
  legalName: 'LAMP PLLC',
  usdotNumber: '4397421',
  mcMxFf: 'MC-1725755',
  usdotStatus: 'ACTIVE',
  outOfServiceDate: 'None',
  mcs150FormDate: '10/17/2025',
  operatingAuthorityStatus: 'AUTHORIZED FOR: Motor Carrier of Property',
};

describe('parseSaferSnapshot', () => {
  it('extracts the monitored fields from real SAFER markup', () => {
    const raw = parseSaferSnapshot(SAFER_HTML);
    expect(raw).not.toBeNull();
    expect(raw!.legalName).toBe('LAMP PLLC');
    expect(raw!.usdotNumber).toBe('4397421');
    expect(raw!.usdotStatus).toBe('ACTIVE');
    expect(raw!.outOfServiceDate).toBe('None');
    expect(raw!.mcs150FormDate).toBe('10/17/2025');
    expect(raw!.operatingAuthorityStatus.startsWith('AUTHORIZED FOR')).toBe(true);
  });

  it('returns null on a page with no snapshot data (record-not-found / blocked)', () => {
    expect(parseSaferSnapshot('<html><body>Record Not Found</body></html>')).toBeNull();
  });
});

describe('normalizeSnapshot', () => {
  it('maps a clean active carrier to the monitored state', () => {
    const s = normalizeSnapshot(BASE_RAW, NOW);
    expect(s).toEqual({
      usdotStatus: 'ACTIVE',
      authorityStatus: 'AUTHORIZED',
      outOfService: 'NO',
      mcs150: 'CURRENT',
    });
  });

  it('flags NOT AUTHORIZED and an OOS date', () => {
    const s = normalizeSnapshot(
      { ...BASE_RAW, operatingAuthorityStatus: 'NOT AUTHORIZED', outOfServiceDate: '05/01/2026' },
      NOW,
    );
    expect(s.authorityStatus).toBe('NOT AUTHORIZED');
    expect(s.outOfService).toBe('YES');
  });
});

describe('isMcs150Stale', () => {
  it('is current for a recent filing', () => {
    expect(isMcs150Stale('10/17/2025', NOW)).toBe(false);
  });
  it('is stale past ~22 months', () => {
    expect(isMcs150Stale('01/01/2023', NOW)).toBe(true);
  });
  it('never false-alarms on an unparseable date', () => {
    expect(isMcs150Stale('', NOW)).toBe(false);
  });
});

describe('detectFmcsaChanges', () => {
  const clean: MonitoredState = {
    usdotStatus: 'ACTIVE',
    authorityStatus: 'AUTHORIZED',
    outOfService: 'NO',
    mcs150: 'CURRENT',
  };

  it('detects an authority revocation', () => {
    const changes = detectFmcsaChanges(clean, { ...clean, authorityStatus: 'NOT AUTHORIZED' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'authorityStatus', from: 'AUTHORIZED', to: 'NOT AUTHORIZED' });
  });

  it('reports no change when identical', () => {
    expect(detectFmcsaChanges(clean, { ...clean })).toHaveLength(0);
  });

  it('ignores transitions into/out of UNKNOWN (transient parse gap)', () => {
    expect(detectFmcsaChanges(clean, { ...clean, authorityStatus: 'UNKNOWN' })).toHaveLength(0);
  });
});

describe('decideFmcsaAlert — the outbound-SMS tripwire', () => {
  const prev: MonitoredState = {
    usdotStatus: 'ACTIVE',
    authorityStatus: 'AUTHORIZED',
    outOfService: 'NO',
    mcs150: 'CURRENT',
  };
  const changed: MonitoredState = { ...prev, outOfService: 'YES' };
  const changedHash = hashMonitoredState(changed);

  it('BASELINE: first-ever snapshot never alerts (deploy watermark)', () => {
    const d = decideFmcsaAlert(null, prev, null, hashMonitoredState(prev));
    expect(d.action).toBe('baseline');
  });

  it('NO-CHANGE: identical status never alerts', () => {
    const d = decideFmcsaAlert(prev, { ...prev }, null, hashMonitoredState(prev));
    expect(d.action).toBe('no-change');
  });

  it('DEDUP: a change already alerted for is suppressed', () => {
    const d = decideFmcsaAlert(prev, changed, changedHash, changedHash);
    expect(d.action).toBe('dedup');
  });

  it('ALERT: a genuine new change fires exactly one alert', () => {
    const d = decideFmcsaAlert(prev, changed, null, changedHash);
    expect(d.action).toBe('alert');
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0].field).toBe('outOfService');
  });
});

describe('buildFmcsaAlertSms', () => {
  it('renders an ASCII-only change line with the DOT and carrier name', () => {
    const body = buildFmcsaAlertSms(BASE_RAW, [
      { field: 'outOfService', label: 'Out-of-service', from: 'NO', to: 'YES' },
    ]);
    expect(body).toContain('DOT 4397421');
    expect(body).toContain('LAMP PLLC');
    expect(body).toContain('Out-of-service: NO -> YES');
    expect(body).not.toMatch(/[^\x00-\x7F]/); // GSM-7 safe: no unicode arrows or em dashes
  });
});
