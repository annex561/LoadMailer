// Pure, unit-tested predicates for SP3. Token minting is added in Task 2.

export function normalizeNanp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  d = d.startsWith("+") ? d.slice(1) : d;
  if (d.length === 10) d = "1" + d;
  if (d.length !== 11 || !d.startsWith("1")) return null;
  const area = d.slice(1, 4);
  if (!/^[2-9]\d\d$/.test(area)) return null;
  if (area === "900" || area === "976") return null; // premium
  return "+" + d;
}

export function isDialableDestination(raw: string | null | undefined): boolean {
  return normalizeNanp(raw) !== null;
}

export function buildPortalOutboundTwiml(args: { to: string; callerId: string; recordingCallbackUrl: string; noticeUrl?: string }): string {
  const numUrl = args.noticeUrl ? ` url="${args.noticeUrl}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial callerId="${args.callerId}" record="record-from-answer" answerOnBridge="true"` +
    ` recordingStatusCallback="${args.recordingCallbackUrl}" recordingStatusCallbackEvent="completed">` +
    `<Number${numUrl}>${args.to}</Number></Dial></Response>`;
}

export function buildCalleeNoticeTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="Polly.Joanna">This call is recorded for quality and training purposes.</Say></Response>`;
}

// Per-driver hourly rate ceiling — pure core (state wrapper added below).
export function rateCheck(times: number[], now: number, max: number): { ok: boolean; next: number[] } {
  const recent = times.filter((t) => t > now - 3_600_000);
  if (recent.length >= max) return { ok: false, next: recent };
  return { ok: true, next: [...recent, now] };
}

const _callTimes = new Map<string, number[]>();
export function withinDriverCallCeiling(driverId: string, max = Number(process.env.PORTAL_DIALER_MAX_PER_HOUR) || 20, now = Date.now()): boolean {
  const r = rateCheck(_callTimes.get(driverId) || [], now, max);
  _callTimes.set(driverId, r.next);
  return r.ok;
}

// Poller must skip OUTBOUND recordings (owned by the recordingStatusCallback,
// which passes job.direction explicitly). When job.direction is undefined (the
// poller path) and the call is outbound, skip it.
export function isPollerOutboundSkip(jobDirection: string | undefined, callDirection: string | null | undefined): boolean {
  return jobDirection === undefined && !!callDirection && callDirection.startsWith("outbound");
}
