// FMCSA carrier monitor — fetches the public FMCSA SAFER company snapshot,
// normalizes the four monitorable status signals, and detects changes so the
// cron (server/fmcsa-monitor-cron.ts) can alert the operator when their federal
// standing moves (authority pulled, OOS order, registration deactivated, MCS-150
// gone stale).
//
// Data source: the public SAFER snapshot. No API key required — verified that a
// plain server-side GET (Railway-style IP, default UA) returns the full data
// table at:
//   https://safer.fmcsa.dot.gov/query.asp?...&query_string=<DOT>
//
// The pure predicates below (parseSaferSnapshot / normalizeSnapshot /
// detectFmcsaChanges / decideFmcsaAlert / isMcs150Stale) are the alert tripwire.
// They are exercised by server/__tests__/fmcsa-monitor.test.ts — DO NOT change
// their shape without updating that test. They are what keeps the alert from
// (a) blasting on a fresh deploy (baseline watermark) and (b) re-firing on an
// unchanged status (dedup). This is the same financial-impact discipline the
// HOS cron follows (see server/hos-check-cron.ts).

import { createHash } from 'crypto';

export interface SaferRawSnapshot {
  legalName: string;
  usdotNumber: string;
  mcMxFf: string;
  usdotStatus: string; // "ACTIVE" | "INACTIVE"
  outOfServiceDate: string; // "None" | "MM/DD/YYYY"
  mcs150FormDate: string; // "MM/DD/YYYY" | ""
  operatingAuthorityStatus: string; // "AUTHORIZED FOR: ..." | "NOT AUTHORIZED"
}

export type MonitoredField = 'usdotStatus' | 'authorityStatus' | 'outOfService' | 'mcs150';

export interface MonitoredState {
  usdotStatus: string; // 'ACTIVE' | 'INACTIVE' | 'UNKNOWN'
  authorityStatus: string; // 'AUTHORIZED' | 'NOT AUTHORIZED' | 'UNKNOWN'
  outOfService: string; // 'NO' | 'YES'
  mcs150: string; // 'CURRENT' | 'STALE' | 'UNKNOWN'
}

export interface FmcsaChange {
  field: MonitoredField;
  label: string;
  from: string;
  to: string;
}

export const FIELD_LABELS: Record<MonitoredField, string> = {
  usdotStatus: 'USDOT status',
  authorityStatus: 'Operating authority',
  outOfService: 'Out-of-service',
  mcs150: 'MCS-150 filing',
};

const SAFER_LABELS: Array<[keyof SaferRawSnapshot, string]> = [
  ['legalName', 'Legal Name'],
  ['usdotNumber', 'USDOT Number'],
  ['mcMxFf', 'MC/MX/FF Number(s)'],
  ['usdotStatus', 'USDOT Status'],
  ['outOfServiceDate', 'Out of Service Date'],
  ['mcs150FormDate', 'MCS-150 Form Date'],
  ['operatingAuthorityStatus', 'Operating Authority Status'],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// SAFER renders each data field as:
//   <th ...><a class="querylabel" ...>Label:</a></th>
//   <td class="queryfield" ...>VALUE&nbsp;</td>
function extractField(collapsedHtml: string, label: string): string {
  const re = new RegExp(
    'querylabel[^>]*>\\s*' +
      escapeRegex(label) +
      '\\s*:?\\s*</a>\\s*</th>\\s*<td[^>]*class="queryfield"[^>]*>([\\s\\S]*?)</td>',
    'i',
  );
  const m = collapsedHtml.match(re);
  if (!m) return '';
  return m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse the SAFER company-snapshot HTML into raw fields. Returns null when the
// page isn't a valid snapshot (record-not-found, error page, IP blocked) so the
// caller treats it as a fetch failure and never overwrites stored state with junk.
export function parseSaferSnapshot(html: string): SaferRawSnapshot | null {
  const collapsed = html.replace(/\s+/g, ' ');
  const out: Record<string, string> = {};
  for (const [key, label] of SAFER_LABELS) out[key] = extractField(collapsed, label as string);
  // A valid snapshot always has a USDOT status and a legal name. If either is
  // missing, the fetch didn't return real data — bail rather than record garbage.
  if (!out.usdotStatus || !out.legalName) return null;
  return out as unknown as SaferRawSnapshot;
}

// MCS-150 must be refiled biennially (every 24 months) or FMCSA deactivates the
// registration. Flag STALE once it crosses 22 months so the operator gets a
// heads-up with runway. `now` is injected for testability.
export function isMcs150Stale(mcs150FormDate: string, now: Date): boolean {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((mcs150FormDate || '').trim());
  if (!m) return false; // unknown / unparseable — never false-alarm
  const filed = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const ageMonths = (now.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return ageMonths >= 22;
}

export function normalizeSnapshot(raw: SaferRawSnapshot, now: Date): MonitoredState {
  const us = (raw.usdotStatus || '').trim().toUpperCase();
  const auth = (raw.operatingAuthorityStatus || '').trim().toUpperCase();
  const oos = (raw.outOfServiceDate || '').trim().toLowerCase();
  return {
    usdotStatus: us || 'UNKNOWN',
    authorityStatus: auth.includes('NOT AUTHORIZED')
      ? 'NOT AUTHORIZED'
      : auth.startsWith('AUTHORIZED')
        ? 'AUTHORIZED'
        : 'UNKNOWN',
    outOfService: oos && oos !== 'none' ? 'YES' : 'NO',
    mcs150: !raw.mcs150FormDate
      ? 'UNKNOWN'
      : isMcs150Stale(raw.mcs150FormDate, now)
        ? 'STALE'
        : 'CURRENT',
  };
}

export function detectFmcsaChanges(prev: MonitoredState, curr: MonitoredState): FmcsaChange[] {
  const fields: MonitoredField[] = ['usdotStatus', 'authorityStatus', 'outOfService', 'mcs150'];
  const out: FmcsaChange[] = [];
  for (const f of fields) {
    const from = prev[f];
    const to = curr[f];
    if (from === to) continue;
    // Ignore transitions into/out of UNKNOWN — a transient parse gap must never
    // fire an alert. Only real moves between two KNOWN values count.
    if (from === 'UNKNOWN' || to === 'UNKNOWN') continue;
    out.push({ field: f, label: FIELD_LABELS[f], from, to });
  }
  return out;
}

export function hashMonitoredState(s: MonitoredState): string {
  return createHash('sha256')
    .update([s.usdotStatus, s.authorityStatus, s.outOfService, s.mcs150].join('|'))
    .digest('hex')
    .slice(0, 16);
}

export type FmcsaDecision =
  | { action: 'baseline'; changes: FmcsaChange[] }
  | { action: 'no-change'; changes: FmcsaChange[] }
  | { action: 'dedup'; changes: FmcsaChange[] }
  | { action: 'alert'; changes: FmcsaChange[] };

// The single decision point the cron delegates to. Pure + fully unit-tested.
//   - no prior snapshot  -> baseline  (record silently, NEVER alert: the watermark)
//   - no monitored change -> no-change (record, no SMS)
//   - change but already alerted for this exact state -> dedup (no SMS)
//   - change not yet alerted -> alert  (send one SMS)
export function decideFmcsaAlert(
  prev: MonitoredState | null,
  curr: MonitoredState,
  prevAlertedHash: string | null,
  currHash: string,
): FmcsaDecision {
  if (!prev) return { action: 'baseline', changes: [] };
  const changes = detectFmcsaChanges(prev, curr);
  if (changes.length === 0) return { action: 'no-change', changes: [] };
  if (prevAlertedHash && prevAlertedHash === currHash) return { action: 'dedup', changes };
  return { action: 'alert', changes };
}

export function buildFmcsaAlertSms(raw: SaferRawSnapshot, changes: FmcsaChange[]): string {
  // ASCII-only arrow ("->") keeps the SMS in GSM-7 (single segment); a unicode
  // arrow would flip it to UCS-2 and halve the per-segment length.
  const lines = changes.map((c) => `- ${c.label}: ${c.from} -> ${c.to}`);
  // ASCII-only throughout (hyphen, not em dash) so the whole body stays GSM-7 =
  // single segment. A unicode dash/arrow would flip it to UCS-2 and cost more.
  return (
    `LAMP Dispatch - FMCSA change on ${raw.legalName} (DOT ${raw.usdotNumber}):\n` +
    lines.join('\n') +
    `\nVerify: safer.fmcsa.dot.gov`
  );
}

const SAFER_URL = 'https://safer.fmcsa.dot.gov/query.asp';

export async function fetchSaferSnapshot(
  dotNumber: string,
): Promise<{ ok: true; raw: SaferRawSnapshot } | { ok: false; error: string }> {
  const url =
    `${SAFER_URL}?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT` +
    `&original_query_param=NAME&query_string=${encodeURIComponent(dotNumber)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TraqIQ-FMCSA-Monitor/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) return { ok: false, error: `SAFER HTTP ${resp.status}` };
    const html = await resp.text();
    const raw = parseSaferSnapshot(html);
    if (!raw) return { ok: false, error: 'SAFER snapshot not parseable (record not found / blocked)' };
    return { ok: true, raw };
  } catch (e: any) {
    return { ok: false, error: `SAFER fetch failed: ${e?.message || e}` };
  }
}
