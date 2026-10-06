// See server/__tests__/unknown-sender-reply-loop.test.ts (2026-10-05 Option Pit reply loop).
const UNKNOWN_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const lastUnknownReply = new Map<string, number>();

/** True at most once per number per 24h. Pure aside from the map; exported for the loop guard test. */
export function shouldReplyToUnknownSender(phone: string, now: number = Date.now()): boolean {
  const key = (phone || "").replace(/\D/g, "").slice(-10);
  const last = lastUnknownReply.get(key);
  if (last !== undefined && now - last < UNKNOWN_REPLY_WINDOW_MS) return false;
  lastUnknownReply.set(key, now);
  if (lastUnknownReply.size > 5000) lastUnknownReply.clear();   // ponytail: bounded memory, resets on deploy
  return true;
}
