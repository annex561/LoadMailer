// Review-queue digest SMS. Replaces the former no-op that was burning Twilio credits
// on every individual RateCon arrival. Now: at most 1 SMS per 6 h, only to
// DISPATCHER_PHONE_NUMBER (Annex …4115), body = count + top-3 summary + review link.
//
// Guard: RATECON_REVIEW_DIGEST_ENABLED default OFF. Never texts drivers, brokers, or Paul.
// Regression-pinned: server/__tests__/ratecon-review-digest.test.ts

import { sql } from "drizzle-orm";

const DIGEST_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 h
let lastDigestAt = 0; // epoch ms; process-scoped throttle

export async function notifyAdminReviewNeeded(_params: {
  companyId: string | null;
  intakeId: string;
  broker: string;
  reason: string;
}) {
  if (process.env.RATECON_REVIEW_DIGEST_ENABLED !== "true") return;

  const phone = process.env.DISPATCHER_PHONE_NUMBER;
  if (!phone) {
    console.warn("[ratecon-admin-alerts] DISPATCHER_PHONE_NUMBER not set — digest suppressed");
    return;
  }

  const now = Date.now();
  if (now - lastDigestAt < DIGEST_INTERVAL_MS) return; // throttled

  try {
    const { db } = await import("./db");

    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM ratecon_intake WHERE status = 'in_review'
    `);
    const countRows = (countResult as any).rows ?? countResult;
    const count: number = parseInt(String(countRows[0]?.cnt ?? "0"), 10);
    if (count === 0) return;

    const topResult = await db.execute(sql`
      SELECT parsed_json
      FROM ratecon_intake
      WHERE status = 'in_review'
      ORDER BY created_at ASC
      LIMIT 3
    `);
    const topRows = (topResult as any).rows ?? topResult;

    const summary = Array.isArray(topRows)
      ? topRows
          .map((r: any) => {
            const pj = r.parsed_json ?? r.parsedJson ?? {};
            const loadNum = pj?.loadNumber?.value ?? "?";
            const broker = pj?.broker?.value ?? "?";
            const pickup = pj?.pickup?.date ?? "?";
            return `#${loadNum} ${broker} ${pickup}`;
          })
          .join(" | ")
      : "";

    const body =
      `${count} RateCon${count === 1 ? "" : "s"} waiting in TRAQ review: ` +
      (summary ? `${summary} ` : "") +
      `https://traqiq.app/review-queue`;

    const { smsLoadService } = await import("./sms-service");
    const result = await smsLoadService.sendSMS(phone, body);
    if (result.success) {
      lastDigestAt = now;
      console.log(`[ratecon-admin-alerts] digest sent to ${phone} (${count} in_review)`);
    } else {
      console.error(`[ratecon-admin-alerts] digest SMS failed: ${result.error}`);
    }
  } catch (err: any) {
    console.error("[ratecon-admin-alerts] digest error:", err.message);
  }
}

/** Reset throttle — test-only export. Never call this in production code. */
export function _resetDigestThrottleForTests() {
  lastDigestAt = 0;
}
