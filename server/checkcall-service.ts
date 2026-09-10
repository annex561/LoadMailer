// Broker check-call auto-answer.
//
// WHAT IT DOES
//
// A broker calls the 833 office line to ask "where's my truck". Today that call is greeted,
// recorded, and bridged to the owner's cell (server/driver-line-routes.ts, office-inbound).
// With this enabled, the caller ID is matched against the broker phone on the active loads; when
// exactly one load matches, the position is spoken BEFORE the bridge, then the call continues to
// the human exactly as it does today.
//
// THE ANSWER IS ADDITIVE, NEVER A REPLACEMENT
//
// The <Dial> is not removed. The broker hears the position and still reaches a person. That
// removes the worst failure mode of an AI phone agent — a caller trapped talking to a machine
// with no way through — and it means a wrong or unhelpful answer costs a few seconds, not a
// relationship. It also means this feature can never cause a missed call.
//
// SPEND, HONESTLY
//
// Close to zero marginal cost. The call is inbound and already answered, already recorded, and
// already bridged. This adds a few seconds of Twilio's built-in <Say> to a call that is already
// connected. There is NO outbound dial, NO SMS, and NO model call: resolution is a deterministic
// caller-ID match against loads.brokerPhone / loads.contactPhone / customers.phone. Speech
// recognition and an LLM were both deliberately left out — they would add real per-call cost and
// two new failure modes to buy nothing the caller ID does not already give us.
//
// GUARDS (CLAUDE.md financial-impact rule)
//
//   1. Default OFF — CHECKCALL_AUTOANSWER_ENABLED. Unset, office-inbound behaves byte for byte
//      as it does today.
//   2. Kill switch — CHECKCALL_AUTOANSWER_DISABLED=true, read per call, no restart needed.
//   3. Rate ceiling — CHECKCALL_MAX_PER_HOUR (default 30) auto-answers per rolling hour.
//   4. Per-caller dedup — one auto-answer per (caller, load) per hour; a repeat caller inside
//      that window is forwarded to a person instead.
//   5. Staleness refusal — a position older than CHECKCALL_MAX_FIX_AGE_MIN (default 30) is never
//      spoken. A confidently stated 4-hour-old location is worse than saying nothing.
//   6. Visibility — every call logs answer-or-forward with the reason.
//
// Ambiguity always forwards. Zero matching loads, more than one matching load, no driver
// position, a stale position, a hit ceiling: all forward to the human, silently and unchanged.
//
// Everything above the I/O banner is pure and pinned by server/__tests__/checkcall-guards.test.ts.

import { normalizeNanp } from './portal-dialer-service';

export const DEFAULT_MAX_PER_HOUR = 30;
export const DEFAULT_MAX_FIX_AGE_MIN = 30;
const HOUR_MS = 60 * 60 * 1000;

export interface CheckCallLoad {
  id: string;
  loadNumber: string;
  brokerPhone: string | null;
  contactPhone: string | null;
  customerPhone: string | null;
  destCity: string | null;
  destState: string | null;
}

export interface DriverPosition {
  address: string | null;
  latitude: number;
  longitude: number;
  timestamp: Date;
}

export type ForwardReason =
  | 'disabled'
  | 'kill-switch'
  | 'no-caller-id'
  | 'no-match'
  | 'ambiguous'
  | 'no-position'
  | 'stale-position'
  | 'rate-ceiling'
  | 'recently-answered';

export interface CheckCallDecision {
  answer: boolean;
  reason: ForwardReason | 'answered';
  loadId?: string;
  speech?: string;
  logLine: string;
}

// ─── Pure predicates ─────────────────────────────────────────────────────────

/**
 * Which active load does this caller belong to?
 *
 * Matches the caller's number against the broker phone, the contact phone, and the customer
 * phone on each load, all normalized to E.164 so formatting differences do not cause a miss.
 * A broker phone on a rate confirmation frequently carries an extension ("555-1234 x203");
 * normalizeNanp rejects those, so the raw digits are compared as a fallback.
 *
 * Returns every match. The caller decides what to do with 0, 1, or many — this function does
 * not guess.
 */
export function matchLoadsByCallerId(loads: CheckCallLoad[], callerNumber: string): CheckCallLoad[] {
  const caller = normalizeNanp(callerNumber);
  if (!caller) return [];
  const callerDigits = caller.replace(/\D/g, '').slice(-10);

  return loads.filter((l) => {
    for (const candidate of [l.brokerPhone, l.contactPhone, l.customerPhone]) {
      if (!candidate) continue;
      const normalized = normalizeNanp(candidate);
      if (normalized && normalized === caller) return true;
      // Extension-bearing numbers ("+1 555 555 1234 x203") fail normalizeNanp; fall back to
      // the last ten digits, which is still an exact NANP subscriber match.
      const digits = String(candidate).replace(/\D/g, '');
      if (digits.length >= 10 && digits.slice(0, 10) === callerDigits) return true;
      if (digits.length >= 11 && digits.slice(1, 11) === callerDigits) return true;
    }
    return false;
  });
}

/** Is a position recent enough to state out loud to a broker? */
export function isPositionFresh(position: DriverPosition | null, now: Date, maxAgeMin: number): boolean {
  if (!position) return false;
  const ageMin = (now.getTime() - position.timestamp.getTime()) / 60_000;
  return ageMin >= 0 && ageMin <= maxAgeMin;
}

/**
 * What the caller hears. Deliberately plain and hedged with the timestamp, because a broker
 * writes this down: an unqualified location implies a precision GPS does not have.
 */
export function buildPositionSpeech(load: CheckCallLoad, position: DriverPosition, now: Date): string {
  const ageMin = Math.max(0, Math.round((now.getTime() - position.timestamp.getTime()) / 60_000));
  const whenPhrase = ageMin <= 1 ? 'as of just now' : `as of ${ageMin} minutes ago`;

  const where = (position.address && position.address.trim())
    || `${position.latitude.toFixed(2)} degrees north, ${Math.abs(position.longitude).toFixed(2)} degrees west`;

  const dest = [load.destCity, load.destState].filter(Boolean).join(', ');
  const destPhrase = dest ? ` Destination ${dest}.` : '';

  return `Checking load ${load.loadNumber}. The driver was near ${where} ${whenPhrase}.${destPhrase} Connecting you now.`;
}

export interface DecisionInput {
  enabled: boolean;
  killed: boolean;
  callerNumber: string;
  matches: CheckCallLoad[];
  position: DriverPosition | null;
  now: Date;
  maxFixAgeMin: number;
  /** Auto-answers already served in the rolling hour. */
  answersThisHour: number;
  maxPerHour: number;
  /** When this exact (caller, load) pair was last auto-answered, if within the hour. */
  lastAnsweredAt: Date | null;
}

/**
 * The whole decision, in one pure function. Every path that is not a confident, fresh,
 * unambiguous match forwards to a person.
 */
export function decideCheckCall(input: DecisionInput): CheckCallDecision {
  const fwd = (reason: ForwardReason, detail = ''): CheckCallDecision => ({
    answer: false,
    reason,
    logLine: `forward (${reason})${detail ? ' ' + detail : ''}`,
  });

  if (!input.enabled) return fwd('disabled');
  if (input.killed) return fwd('kill-switch');
  if (!normalizeNanp(input.callerNumber)) return fwd('no-caller-id');

  if (input.matches.length === 0) return fwd('no-match');
  if (input.matches.length > 1) {
    // Never guess which load a broker is calling about. Two loads with the same broker on the
    // road at once is normal, and naming the wrong one is worse than naming none.
    return fwd('ambiguous', `${input.matches.length} active loads for this caller`);
  }

  const load = input.matches[0];

  if (input.answersThisHour >= input.maxPerHour) {
    return fwd('rate-ceiling', `${input.answersThisHour}/${input.maxPerHour} this hour`);
  }

  if (input.lastAnsweredAt && input.now.getTime() - input.lastAnsweredAt.getTime() < HOUR_MS) {
    // A broker calling twice inside an hour wants a person, not the same recording again.
    return fwd('recently-answered', `load ${load.loadNumber}`);
  }

  if (!input.position) return fwd('no-position', `load ${load.loadNumber}`);
  if (!isPositionFresh(input.position, input.now, input.maxFixAgeMin)) {
    const ageMin = Math.round((input.now.getTime() - input.position.timestamp.getTime()) / 60_000);
    return fwd('stale-position', `load ${load.loadNumber}, fix ${ageMin} min old`);
  }

  return {
    answer: true,
    reason: 'answered',
    loadId: load.id,
    speech: buildPositionSpeech(load, input.position, input.now),
    logLine: `answered load ${load.loadNumber}`,
  };
}

/**
 * Splice the spoken position into the TwiML the office line already returns.
 *
 * Composed rather than rebuilt on purpose: `baseTwiml` comes from buildInboundTwiml(), so the
 * <Dial>, the caller-id handling, the whisper URL and the /after action can never drift from
 * the working path. If buildInboundTwiml changes, this inherits the change.
 *
 * Returns baseTwiml untouched if the expected opening tag is missing, so a future change to the
 * builder degrades to current behavior instead of emitting malformed XML and dropping the call.
 */
export function spliceCheckCallSpeech(baseTwiml: string, speech: string): string {
  const open = '<Response>';
  const idx = baseTwiml.indexOf(open);
  if (idx === -1) return baseTwiml;
  const insertAt = idx + open.length;
  const say = `<Say voice="Polly.Joanna">${escapeXml(speech)}</Say>`;
  return baseTwiml.slice(0, insertAt) + say + baseTwiml.slice(insertAt);
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── I/O half — env, counters ────────────────────────────────────────────────

export function isCheckCallEnabled(): boolean {
  return process.env.CHECKCALL_AUTOANSWER_ENABLED === 'true';
}

export function isCheckCallKilled(): boolean {
  return process.env.CHECKCALL_AUTOANSWER_DISABLED === 'true';
}

export function checkCallMaxPerHour(): number {
  const n = Number(process.env.CHECKCALL_MAX_PER_HOUR);
  return n > 0 ? n : DEFAULT_MAX_PER_HOUR;
}

export function checkCallMaxFixAgeMin(): number {
  const n = Number(process.env.CHECKCALL_MAX_FIX_AGE_MIN);
  return n > 0 ? n : DEFAULT_MAX_FIX_AGE_MIN;
}

// Rolling-hour ceiling and per-pair dedup, held in memory. This matches the existing house
// pattern (gps-health-monitor.ts keeps lastReminderSent the same way).
// ponytail: in-memory counters reset on restart, so a crash loop could re-serve a few extra
// auto-answers. Acceptable because the marginal cost of one is a few seconds of TTS on an
// already-connected call, not a new outbound charge. Move to a DB table if this ever gates
// something that costs real money per event.
const answerTimestamps: Date[] = [];
const lastAnsweredByPair = new Map<string, Date>();

export function answersInLastHour(now: Date = new Date()): number {
  const cutoff = now.getTime() - HOUR_MS;
  while (answerTimestamps.length > 0 && answerTimestamps[0].getTime() < cutoff) {
    answerTimestamps.shift();
  }
  return answerTimestamps.length;
}

export function lastAnsweredFor(callerNumber: string, loadId: string): Date | null {
  return lastAnsweredByPair.get(pairKey(callerNumber, loadId)) ?? null;
}

export function recordAutoAnswer(callerNumber: string, loadId: string, now: Date = new Date()): void {
  answerTimestamps.push(now);
  lastAnsweredByPair.set(pairKey(callerNumber, loadId), now);
}

/** Test seam — the counters are module state and must be resettable between cases. */
export function __resetCheckCallCounters(): void {
  answerTimestamps.length = 0;
  lastAnsweredByPair.clear();
}

function pairKey(callerNumber: string, loadId: string): string {
  return `${normalizeNanp(callerNumber) ?? callerNumber}::${loadId}`;
}

/**
 * Resolve the caller against live loads and decide, hitting the DB.
 *
 * Never throws: any failure degrades to a forward, because a lookup error must never turn into
 * a dropped broker call. The office line's existing behavior is always the fallback.
 */
export async function resolveCheckCall(callerNumber: string, now: Date = new Date()): Promise<CheckCallDecision> {
  const enabled = isCheckCallEnabled();
  const killed = isCheckCallKilled();

  // Cheap exits before touching the database at all.
  if (!enabled || killed) {
    return decideCheckCall({
      enabled, killed, callerNumber, matches: [], position: null, now,
      maxFixAgeMin: checkCallMaxFixAgeMin(), answersThisHour: 0,
      maxPerHour: checkCallMaxPerHour(), lastAnsweredAt: null,
    });
  }

  try {
    const { db } = await import('./db');
    const { loads, customers, driverLocations } = await import('@shared/schema');
    const { and, desc, eq, isNotNull, isNull } = await import('drizzle-orm');

    // Active loads only: a driver is assigned and it has not been delivered. Mirrors the
    // selection geofence-cron uses, so "active" means the same thing in both places.
    const rows = await db
      .select({
        id: loads.id,
        loadNumber: loads.loadNumber,
        driverId: loads.driverId,
        brokerPhone: loads.brokerPhone,
        contactPhone: loads.contactPhone,
        destCity: loads.destCity,
        destState: loads.destState,
        customerPhone: customers.phone,
      })
      .from(loads)
      .leftJoin(customers, eq(loads.customerId, customers.id))
      .where(and(isNotNull(loads.driverId), isNull(loads.deliveredAt)))
      .limit(500);

    const matches = matchLoadsByCallerId(rows as unknown as CheckCallLoad[], callerNumber);

    // Only look up a position once the match is unambiguous — no point querying for a call
    // that is going to be forwarded anyway.
    let position: DriverPosition | null = null;
    if (matches.length === 1) {
      const matched = rows.find((r: typeof rows[number]) => r.id === matches[0].id);
      if (matched?.driverId) {
        const [fix] = await db
          .select({
            address: driverLocations.address,
            latitude: driverLocations.latitude,
            longitude: driverLocations.longitude,
            timestamp: driverLocations.timestamp,
          })
          .from(driverLocations)
          .where(and(eq(driverLocations.driverId, matched.driverId), isNotNull(driverLocations.timestamp)))
          .orderBy(desc(driverLocations.timestamp))
          .limit(1);
        if (fix) {
          position = { ...fix, timestamp: new Date(fix.timestamp) };
        }
      }
    }

    const loadId = matches.length === 1 ? matches[0].id : '';

    return decideCheckCall({
      enabled, killed, callerNumber, matches, position, now,
      maxFixAgeMin: checkCallMaxFixAgeMin(),
      answersThisHour: answersInLastHour(now),
      maxPerHour: checkCallMaxPerHour(),
      lastAnsweredAt: loadId ? lastAnsweredFor(callerNumber, loadId) : null,
    });
  } catch (err: any) {
    return {
      answer: false,
      reason: 'no-match',
      logLine: `forward (lookup-error) ${err?.message || err}`,
    };
  }
}
