// Carrier Defense Kit — Phase 2: FreightGuard (Carrier411) notification parser.
//
// When Carrier411 files a FreightGuard report against a carrier, it emails a
// notification from no-reply@carrier411.com with a fixed structure: the MC, the
// reported company, the items alleged, the broker's comments, a 72-hour deadline,
// a carrierresponse.com response code, and who filed it. This module turns that
// email into a structured case so the monitor can (a) alert the operator fast and
// (b) start the 72-hour countdown.
//
// Everything here is PURE (no I/O, no clock) and is the keystone the rest of
// Phase 2 builds on. It is pinned by server/__tests__/freightguard-parse.test.ts
// against the real email body — do not change field shapes without updating that
// test. The dedup key downstream is responseCode (one FreightGuard = one code).

export interface FreightGuardCase {
  mcNumber: string; // "MC1725755"
  reportedCompany: string; // "LAMP PLLC"
  brokerCompany: string; // "FEDERAL LOGISTICS, INC."
  brokerContact: string; // "BLAKE HIGH"
  brokerPhone: string; // "(972) 370-9838"
  itemsReported: string[]; // ["NO SHOW AND NO CALL"]
  additionalComments: string;
  responseCode: string; // "8476653821" — the dedup key
  windowHours: number; // 72
  filedAt: string | null; // ISO — "FROM <date>"
  deadlineAt: string | null; // ISO — filedAt + windowHours
}

// Is this email actually a Carrier411 FreightGuard notification? Gate ingestion
// so random inbox mail is never turned into a case.
export function isFreightGuardEmail(text: string): boolean {
  const t = (text || '').toUpperCase();
  return t.includes('FREIGHTGUARD REPORT') && /RESPONSE CODE:\s*\d+/i.test(text || '');
}

function section(text: string, start: RegExp, ends: RegExp[]): string {
  const m = start.exec(text);
  if (!m) return '';
  const from = m.index + m[0].length;
  let to = text.length;
  for (const e of ends) {
    e.lastIndex = 0;
    const em = e.exec(text.slice(from));
    if (em) to = Math.min(to, from + em.index);
  }
  return text.slice(from, to).trim();
}

const MONTHS: Record<string, number> = {
  JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
  JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

// Stated-zone offsets from UTC. Carrier411 commonly writes "EST" year-round, so
// we honor the literal abbreviation rather than guessing DST.
const TZ_OFFSET: Record<string, number> = {
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, UTC: 0, GMT: 0,
};

// Parse "JUNE 16, 2026 12:09 PM EST" -> Date (UTC). Returns null if unparseable.
export function parseStatedTimestamp(s: string): Date | null {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s*([A-Za-z]{2,4})?/.exec(
    (s || '').trim(),
  );
  if (!m) return null;
  const month = MONTHS[m[1].toUpperCase()];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const min = Number(m[5]);
  const ampm = (m[6] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const offset = m[7] ? (TZ_OFFSET[m[7].toUpperCase()] ?? 0) : 0;
  // local time at `offset` -> UTC: subtract the offset (EST=-5 => UTC = local + 5)
  return new Date(Date.UTC(year, month, day, hour - offset, min, 0));
}

export function parseFreightGuardEmail(text: string): FreightGuardCase | null {
  if (!isFreightGuardEmail(text)) return null;
  const t = text.replace(/\r/g, '');

  const mc = /\bMC\s*-?\s*(\d{4,8})\b/i.exec(t);
  const responseCode = /RESPONSE CODE:\s*(\d+)/i.exec(t);
  if (!mc || !responseCode) return null;

  const reportedCompany = section(t, /REPORTED COMPANY:/i, [/\n\s*\n/, /THE FOLLOWING ITEMS/i])
    .split('\n')[0]
    .trim();

  const itemsBlock = section(t, /THE FOLLOWING ITEMS WERE REPORTED:/i, [/ADDITIONAL COMMENTS:/i]);
  const itemsReported = itemsBlock
    .split('\n')
    .map((l) => l.replace(/^[•\-\*•]\s*/, '').trim())
    .filter(Boolean);

  const additionalComments = section(t, /ADDITIONAL COMMENTS:/i, [/YOU HAVE\s+\d+\s+HOURS/i]).trim();

  const submitted = section(t, /REPORT SUBMITTED BY:/i, [/$(?![\s\S])/]);
  const subLines = submitted.split('\n').map((l) => l.trim()).filter(Boolean);
  const brokerContact = subLines[0] || '';
  const brokerCompany =
    subLines[1] || (/^\s*([A-Z][A-Z0-9 .,&'\-]+?)\s+reported its experience/im.exec(t)?.[1] ?? '').trim();
  const brokerPhone = (/PHONE:\s*([+\d().\-\s]+)/i.exec(submitted)?.[1] || '').trim();

  const win = /YOU HAVE\s+(\d+)\s+HOURS FROM\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[A-Za-z]{0,4})/i.exec(
    t,
  );
  const windowHours = win ? Number(win[1]) : 72;
  const filed = win ? parseStatedTimestamp(win[2]) : null;
  const deadline = filed ? new Date(filed.getTime() + windowHours * 3600 * 1000) : null;

  return {
    mcNumber: 'MC' + mc[1],
    reportedCompany,
    brokerCompany: brokerCompany.trim(),
    brokerContact,
    brokerPhone,
    itemsReported,
    additionalComments,
    responseCode: responseCode[1],
    windowHours,
    filedAt: filed ? filed.toISOString() : null,
    deadlineAt: deadline ? deadline.toISOString() : null,
  };
}

// ---- Alert helpers (pure; tested in server/__tests__/freightguard-parse.test.ts) ----
// These are the outbound-SMS tripwire for the FreightGuard alert cron. They keep
// the alert from (a) re-firing on an already-alerted case and (b) blasting a
// backlog older than the response window on a fresh deploy (the watermark).

export function hoursUntil(deadlineIso: string | null, now: Date): number | null {
  if (!deadlineIso) return null;
  const d = new Date(deadlineIso).getTime();
  if (Number.isNaN(d)) return null;
  return (d - now.getTime()) / 3_600_000;
}

export interface FreightGuardAlertDecision {
  alert: boolean;
  reason: 'alert' | 'already-alerted' | 'not-open' | 'too-old';
}

export function shouldAlertCase(
  row: { status?: string | null; alertedAt?: string | Date | null; createdAt?: string | Date | null },
  now: Date,
  maxAgeHours: number,
): FreightGuardAlertDecision {
  if (row.alertedAt) return { alert: false, reason: 'already-alerted' };
  if (row.status && row.status !== 'open') return { alert: false, reason: 'not-open' };
  // Boot watermark: never blast cases older than maxAgeHours. Protects a fresh
  // deploy or a backlog from re-alerting historical reports.
  if (row.createdAt) {
    const ageH = (now.getTime() - new Date(row.createdAt).getTime()) / 3_600_000;
    if (ageH > maxAgeHours) return { alert: false, reason: 'too-old' };
  }
  return { alert: true, reason: 'alert' };
}

export function buildFreightGuardAlertSms(
  c: { mcNumber: string; brokerCompany: string; itemsReported: string[]; responseCode: string; deadlineAt: string | null },
  now: Date,
): string {
  const hrs = hoursUntil(c.deadlineAt, now);
  const left = hrs === null ? '' : ` ~${Math.max(0, Math.round(hrs))}h to respond.`;
  const items = (c.itemsReported || []).join('; ') || 'a report';
  const broker = c.brokerCompany || 'a broker';
  // ASCII-only (GSM-7) so the alert stays single-segment where possible.
  return (
    `LAMP Dispatch - FreightGuard filed on ${c.mcNumber} by ${broker}: ${items}.${left} ` +
    `File at carrierresponse.com, code ${c.responseCode}.`
  );
}
