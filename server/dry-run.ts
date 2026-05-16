/**
 * Dry-run mode for outbound vendor calls.
 *
 * Purpose: let the user validate the entire workflow end-to-end in
 * production WITHOUT burning a single dollar on Twilio / OpenAI /
 * Love's. When DRY_RUN_OUTBOUND=true, every vendor wrapper logs the
 * exact payload it WOULD have sent and returns a success-shaped
 * response so the downstream chain continues as if the vendor call
 * succeeded.
 *
 * This is DIFFERENT from SMS_DISABLED:
 *   - SMS_DISABLED returns success:false → halts the chain
 *   - DRY_RUN_OUTBOUND returns success:true → chain continues as if sent
 * Both can coexist; SMS_DISABLED wins if both are on (defense in depth).
 *
 * Why this exists: the user has spent real money this session being my
 * QA when fixes introduced regressions. Dry-run mode means a future
 * "test this in production before flipping the live flag" exercise
 * costs $0 instead of $0.01 per SMS × who-knows-how-many retries.
 *
 * Default: OFF. Production should NEVER run with DRY_RUN_OUTBOUND=true
 * for any extended period — drivers would silently receive no SMS.
 * Pair with a wall-clock timeout in ops procedure (flip on, test, flip
 * off within minutes).
 *
 * What's gated by this:
 *   - Twilio SMS (server/sms-service.ts smsService.sendSMS)
 *   - Telnyx SMS (server/telnyx-service.ts sendTelnyxSms)
 *   - OpenAI vision address extraction (factoring-bol-address-verify)
 *   - OpenAI vision BOL signature check (factoring-bol-verify)
 *   - Love's factoring email submission (factoring-loves)
 *
 * What's NOT gated:
 *   - Twilio media DOWNLOAD (inbound, not billed per-call)
 *   - Cloudinary uploads (already part of the photo persist flow;
 *     no per-photo billing in our tier)
 *   - Any DB write
 *
 * Each gate also logs prominently with [DRY-RUN] prefix so Railway log
 * search is one-command to verify the exercise hit every vendor.
 */

export function isDryRunOutbound(): boolean {
  return process.env.DRY_RUN_OUTBOUND === "true";
}

export interface DryRunLog {
  vendor: string;
  action: string;
  payload: Record<string, unknown>;
}

export function logDryRun(entry: DryRunLog): void {
  // Pretty-printed for human reading in Railway logs. Single-line
  // would be friendlier for log search but harder for the user to
  // verify "yes that's the SMS body I expected".
  console.log(
    `[DRY-RUN] ${entry.vendor}.${entry.action}\n${JSON.stringify(entry.payload, null, 2)}`,
  );
}

// Stable fake IDs so test/log readers can spot dry-run artifacts at a
// glance. Format: dry-<vendor>-<unixms>-<rand6>.
export function dryRunFakeId(vendor: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `dry-${vendor}-${Date.now()}-${rand}`;
}
