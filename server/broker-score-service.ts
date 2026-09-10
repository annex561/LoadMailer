// Broker score — how a broker has actually behaved toward THIS carrier.
//
// WHY THIS IS THE THING A COMPETITOR CANNOT COPY
//
// Hey Bubba vets counterparties by hand: the founder takes a call with each carrier and forms a
// judgement. That is his growth ceiling and it is also all he can do, because his product holds
// no receivables ledger and no filing history — he sits on top of DAT, an ELD and an inbox.
//
// TRAQ-IQ already holds both signals, from its own operating history:
//
//   1. freightguard_cases — every Carrier411 FreightGuard report filed against this carrier,
//      with the broker who filed it. A broker who has filed once will file again.
//   2. ar_invoices — days-to-pay and open balance per load, which is the only honest measure of
//      whether a broker pays. Nobody's credit report tells you how they treat YOU.
//
// A score built on these is not a market opinion. It is arithmetic on what already happened,
// and no competitor without the carrier's books can reproduce it.
//
// WHAT THIS DOES NOT DO
//
// It is not a credit check and does not pretend to be. A broker with no history here scores
// UNKNOWN, not "good" — absence of evidence is reported as absence, never as a pass. And the
// score never blocks anything on its own; it is shown next to the offered rate on the review
// queue so a human decides.
//
// The scoring itself is pure and pinned by server/__tests__/broker-score.test.ts.

export interface FreightGuardFiling {
  filedAt: Date | null;
  itemsReported: string[];
}

export interface InvoiceRecord {
  totalAmountCents: number;
  balanceDueCents: number;
  dueDate: Date;
  paidAt: Date | null;
}

export interface BrokerSignals {
  brokerName: string;
  filings: FreightGuardFiling[];
  invoices: InvoiceRecord[];
}

export type BrokerGrade = 'GOOD' | 'WATCH' | 'CAUTION' | 'UNKNOWN';

export interface BrokerScore {
  brokerName: string;
  grade: BrokerGrade;
  /** 0-100, higher is better. Null when there is no history to score. */
  score: number | null;
  flags: string[];
  stats: {
    loadsInvoiced: number;
    paidInvoices: number;
    avgDaysToPay: number | null;
    latePayments: number;
    openPastDueCents: number;
    freightGuardFilings: number;
    daysSinceLastFiling: number | null;
  };
}

/** Anything past this many days beyond terms counts as late. */
export const LATE_GRACE_DAYS = 5;
/** A filing older than this is aged out of the recency flag, though it still counts. */
export const FILING_RECENCY_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

/**
 * Score a broker from this carrier's own history.
 *
 * Starts at 100 and deducts. A FreightGuard filing is the heaviest signal by far: it means the
 * broker went on record against this carrier, and it is the thing that costs the most to be
 * wrong about. Payment behaviour is weighted next. No history at all returns UNKNOWN with a
 * null score rather than a default pass.
 */
export function scoreBroker(signals: BrokerSignals, now: Date = new Date()): BrokerScore {
  const flags: string[] = [];

  const invoices = signals.invoices ?? [];
  const filings = signals.filings ?? [];

  const paid = invoices.filter((i) => i.paidAt !== null);
  const daysToPay = paid.map((i) => daysBetween(i.paidAt as Date, i.dueDate));
  const late = daysToPay.filter((d) => d > LATE_GRACE_DAYS);

  const avgDaysToPay = daysToPay.length > 0
    ? Math.round((daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) * 10) / 10
    : null;

  const openPastDueCents = invoices
    .filter((i) => i.paidAt === null && i.balanceDueCents > 0 && daysBetween(now, i.dueDate) > LATE_GRACE_DAYS)
    .reduce((sum, i) => sum + i.balanceDueCents, 0);

  const filingDates = filings.map((f) => f.filedAt).filter((d): d is Date => d instanceof Date);
  const lastFiling = filingDates.length > 0
    ? new Date(Math.max(...filingDates.map((d) => d.getTime())))
    : null;
  const daysSinceLastFiling = lastFiling ? Math.round(daysBetween(now, lastFiling)) : null;

  const stats: BrokerScore['stats'] = {
    loadsInvoiced: invoices.length,
    paidInvoices: paid.length,
    avgDaysToPay,
    latePayments: late.length,
    openPastDueCents,
    freightGuardFilings: filings.length,
    daysSinceLastFiling,
  };

  // No history at all. Say so; do not imply a pass.
  if (invoices.length === 0 && filings.length === 0) {
    return {
      brokerName: signals.brokerName,
      grade: 'UNKNOWN',
      score: null,
      flags: ['No history with this broker — nothing to score.'],
      stats,
    };
  }

  let score = 100;

  // FreightGuard filings. The heaviest signal: a broker who has gone on record against this
  // carrier once is the one most likely to do it again, and the cost of that is a 72-hour
  // scramble plus a permanent mark other brokers can see.
  if (filings.length > 0) {
    score -= 40 + Math.min(30, (filings.length - 1) * 15);
    const items = filings.flatMap((f) => f.itemsReported).filter(Boolean);
    const itemText = items.length > 0 ? ` (${Array.from(new Set(items)).join('; ')})` : '';
    flags.push(
      `${filings.length} FreightGuard report${filings.length === 1 ? '' : 's'} filed against this carrier by this broker${itemText}.`,
    );
    if (daysSinceLastFiling !== null && daysSinceLastFiling <= FILING_RECENCY_DAYS) {
      flags.push(`Most recent filing was ${daysSinceLastFiling} days ago.`);
    }
  }

  // Payment behaviour.
  if (paid.length > 0) {
    const lateRate = late.length / paid.length;
    if (lateRate >= 0.5) {
      score -= 25;
      flags.push(`Paid late on ${late.length} of ${paid.length} invoices.`);
    } else if (late.length > 0) {
      score -= 10;
      flags.push(`Paid late on ${late.length} of ${paid.length} invoices.`);
    }
    if (avgDaysToPay !== null && avgDaysToPay > 15) {
      score -= 10;
      flags.push(`Averages ${avgDaysToPay} days past terms.`);
    }
  }

  if (openPastDueCents > 0) {
    score -= 20;
    flags.push(`$${(openPastDueCents / 100).toFixed(2)} currently past due.`);
  }

  // Thin history is worth saying out loud — a 100 off one invoice is not a track record.
  if (invoices.length < 3 && filings.length === 0) {
    flags.push(`Only ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} of history — thin sample.`);
  }

  score = Math.max(0, Math.min(100, score));

  const grade: BrokerGrade = filings.length > 0 || score < 50
    ? 'CAUTION'
    : score < 80
      ? 'WATCH'
      : 'GOOD';

  if (flags.length === 0) {
    flags.push(`Paid ${paid.length} of ${invoices.length} invoices on time, no reports filed.`);
  }

  return { brokerName: signals.brokerName, grade, score, flags, stats };
}

/**
 * Broker names arrive spelled differently on every rate confirmation ("TQL", "TQL Logistics",
 * "Total Quality Logistics, Inc."). Normalize before matching so history is not fragmented
 * across three spellings of the same company.
 */
export function normalizeBrokerName(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|l l c|ltd|co|corp|corporation|company|logistics|transport|transportation|freight|group)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Do two broker names refer to the same company? */
export function brokerNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBrokerName(a);
  const nb = normalizeBrokerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One being a prefix of the other covers "tql" vs "tql total quality".
  return na.startsWith(nb + ' ') || nb.startsWith(na + ' ');
}

// ─── I/O half — pull the signals this carrier already holds ──────────────────

/**
 * Gather a broker's history from the carrier's own books and score it.
 *
 * Name matching happens in JS rather than SQL because brokerNamesMatch has to normalize
 * corporate suffixes, and the row counts here are small (one carrier's own history).
 *
 * Never throws: a failure returns an UNKNOWN score with the error flagged, because this is
 * decoration on a review screen and must never take the screen down.
 */
export async function resolveBrokerScore(brokerName: string, now: Date = new Date()): Promise<BrokerScore> {
  const empty = (flag: string): BrokerScore => ({
    brokerName,
    grade: 'UNKNOWN',
    score: null,
    flags: [flag],
    stats: {
      loadsInvoiced: 0, paidInvoices: 0, avgDaysToPay: null, latePayments: 0,
      openPastDueCents: 0, freightGuardFilings: 0, daysSinceLastFiling: null,
    },
  });

  if (!normalizeBrokerName(brokerName)) return empty('No broker name supplied.');

  try {
    const { db } = await import('./db');
    const { arInvoices, loads, customers } = await import('@shared/schema');
    const { eq, sql } = await import('drizzle-orm');

    // FreightGuard filings. The table is created in ensure-schema.ts, not in the Drizzle
    // schema, so it is queried raw the same way freightguard-monitor-cron.ts does.
    let filings: FreightGuardFiling[] = [];
    try {
      const fg: any = await db.execute(
        sql`SELECT broker_company, items_reported, filed_at FROM freightguard_cases`,
      );
      const rows: any[] = fg?.rows ?? fg ?? [];
      filings = rows
        .filter((r) => brokerNamesMatch(r.broker_company, brokerName))
        .map((r) => ({
          filedAt: r.filed_at ? new Date(r.filed_at) : null,
          itemsReported: Array.isArray(r.items_reported) ? r.items_reported : [],
        }));
    } catch {
      // Table may not exist yet on a fresh database. No filings is the correct reading.
    }

    const invoiceRows = await db
      .select({
        totalAmountCents: arInvoices.totalAmountCents,
        balanceDueCents: arInvoices.balanceDueCents,
        dueDate: arInvoices.dueDate,
        paidAt: arInvoices.paidAt,
        loadBroker: loads.brokerName,
        customerName: customers.name,
      })
      .from(arInvoices)
      .innerJoin(loads, eq(arInvoices.loadId, loads.id))
      .leftJoin(customers, eq(loads.customerId, customers.id))
      .limit(2000);

    const invoices: InvoiceRecord[] = invoiceRows
      .filter((r: typeof invoiceRows[number]) =>
        brokerNamesMatch(r.loadBroker, brokerName) || brokerNamesMatch(r.customerName, brokerName))
      .map((r: typeof invoiceRows[number]) => ({
        totalAmountCents: r.totalAmountCents,
        balanceDueCents: r.balanceDueCents,
        dueDate: new Date(r.dueDate),
        paidAt: r.paidAt ? new Date(r.paidAt) : null,
      }));

    return scoreBroker({ brokerName, filings, invoices }, now);
  } catch (err: any) {
    return empty(`Could not read broker history: ${err?.message || err}`);
  }
}
