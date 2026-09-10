// Pure predicates for the "your truck is free" driver notification.
//
// This is the ONLY path in the split-authority feature set that texts a DRIVER rather
// than the operator, which makes it the highest-consequence one in the group. Every
// decision it makes lives here, with no I/O, so it can be tested exhaustively.
//
// Regression guard: server/__tests__/truck-free-notify.test.ts

export interface FreeNotifyInput {
  /** Availability state from server/truck-availability-service.ts. */
  state: string;
  /** When the truck became free (the freeing load's delivery). */
  availableFrom: Date | null;
  /** When LAMP's exclusive window closes. */
  firstLookExpiresAt: Date | null;
  /** True once a row exists in truck_free_notifications for the freeing load. */
  alreadyNotified: boolean;
  /** True the first time this monitor has ever seen this driver. */
  isFirstSight: boolean;
  driverPhone: string | null | undefined;
}

export type FreeNotifyDecision =
  | { action: 'send' }
  | { action: 'skip'; reason: string };

/** Half-open [startHourUtc, endHourUtc), wrapping across midnight. */
export function withinSendWindow(now: Date, startHourUtc: number, endHourUtc: number): boolean {
  const h = now.getUTCHours();
  if (startHourUtc === endHourUtc) return true; // configured off
  if (startHourUtc < endHourUtc) return h >= startHourUtc && h < endHourUtc;
  return h >= startHourUtc || h < endHourUtc; // wraps midnight
}

/**
 * Decide whether to text a driver that his truck is free.
 *
 * Every early return is a guard. In order:
 *   - first sight of a driver NEVER texts. That is the deploy watermark.
 *   - only during first_look. Telling him about a window that already closed is noise,
 *     and telling him while he is still on a load is wrong.
 *   - one text per freeing load, ever.
 *   - no phone, no send.
 *   - the freeing load must be RECENT. A load that delivered yesterday must not
 *     generate a notification today, which is what bounds a redeploy's blast radius.
 *   - not in the middle of the night.
 */
export function decideTruckFreeNotify(
  input: FreeNotifyInput,
  now: Date,
  opts: { lookbackMinutes: number; startHourUtc: number; endHourUtc: number },
): FreeNotifyDecision {
  if (input.isFirstSight) return { action: 'skip', reason: 'baseline' };
  if (input.alreadyNotified) return { action: 'skip', reason: 'already-notified' };
  if (input.state !== 'first_look') return { action: 'skip', reason: `state:${input.state}` };
  if (!input.driverPhone) return { action: 'skip', reason: 'no-phone' };
  if (!input.availableFrom) return { action: 'skip', reason: 'no-available-from' };

  const ageMinutes = (now.getTime() - input.availableFrom.getTime()) / 60000;
  if (ageMinutes < 0) return { action: 'skip', reason: 'not-yet-free' };
  if (ageMinutes > opts.lookbackMinutes) return { action: 'skip', reason: 'stale' };

  if (!withinSendWindow(now, opts.startHourUtc, opts.endHourUtc)) {
    return { action: 'skip', reason: 'quiet-hours' };
  }
  return { action: 'send' };
}

/**
 * GSM-7 only — ASCII throughout. One non-ASCII character flips the message to UCS-2 and
 * halves the segment length. Mirrors buildFmcsaAlertSms in server/fmcsa-service.ts.
 */
export function buildTruckFreeSms(
  location: string | null,
  firstLookExpiresAt: Date | null,
  timeZone = 'America/Chicago',
): string {
  const where = location ? ` in ${location}` : '';
  const until = firstLookExpiresAt
    ? firstLookExpiresAt.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone,
      })
    : null;
  const body =
    `LAMP Dispatch - your truck is free${where}.` +
    (until ? ` We have first look until ${until}.` : '') +
    ` After that, book your own.`;
  // Strip anything non-ASCII a locale format might have introduced (narrow no-break
  // space before AM/PM is the usual culprit) so the body stays single-segment GSM-7.
  return body.replace(/[^\x20-\x7E\n]/g, ' ').replace(/ {2,}/g, ' ');
}
