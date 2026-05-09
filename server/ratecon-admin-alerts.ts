import { db } from "./db";
import { users, rateconIntake } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Sends an SMS to dispatcher(s) when a RateCon needs review. The dispatcher
 * can read the most-likely-broken fields from the SMS and tap a link to open
 * the intake on their phone. Goes out to:
 *   1. DISPATCHER_PHONE_NUMBER env var (always, if set) — primary recipient
 *   2. Any admin user rows that have a phone column populated
 *
 * Unlike driver-bound dispatch SMS, these alerts are not gated by the
 * SMS_ENABLED flag (which is used to silence test-environment driver
 * traffic). DISPATCHER_REVIEW_SMS=false can be used to opt out specifically.
 */
export async function notifyAdminReviewNeeded(params: {
  companyId: string | null;
  intakeId: string;
  broker: string;
  reason: string;
}) {
  try {
    if (process.env.DISPATCHER_REVIEW_SMS === "false") {
      console.log("[admin-alerts] DISPATCHER_REVIEW_SMS=false — alerts disabled");
      return;
    }

    // Pull the intake row to enrich the SMS body with what we know about
    // the load (load number, broker, pickup/drop) so the dispatcher can
    // triage the issue without leaving their text thread until they tap in.
    const [intake] = await db
      .select()
      .from(rateconIntake)
      .where(eq(rateconIntake.id, params.intakeId))
      .limit(1);

    const parsed = (intake?.parsedJson ?? {}) as any;
    const loadNumber = parsed?.loadNumber?.value ?? "?";
    const pickupCity = parsed?.pickup?.city ?? "?";
    const pickupState = parsed?.pickup?.state ?? "?";
    const dropCity = parsed?.drop?.city ?? "?";
    const dropState = parsed?.drop?.state ?? "?";
    const rate = parsed?.rate?.value ?? null;

    // Top failures (max 3) — what specifically the dispatcher needs to fix
    const failures = (intake?.validatorFailures ?? []) as Array<{ field?: string; reason?: string; severity?: string }>;
    const topFailures = failures
      .filter((f) => f?.severity === "error" || f?.severity === "warning")
      .slice(0, 3)
      .map((f) => `· ${f.field ?? "?"}: ${f.reason ?? "needs review"}`)
      .join("\n");

    const baseUrl = process.env.CUSTOM_DOMAIN || "https://traqiq.app";
    const reviewLink = `${baseUrl}/review-queue?intake=${params.intakeId}`;

    const DIVIDER = "==================";
    const sections: string[] = [];
    sections.push(`Review needed · Load #${loadNumber}`);
    sections.push(`Broker: ${params.broker}`);
    sections.push(`PU: ${pickupCity}, ${pickupState}\nDROP: ${dropCity}, ${dropState}`);
    if (rate !== null) sections.push(`Rate: $${Number(rate).toLocaleString()}`);
    if (topFailures) sections.push(`Issues:\n${topFailures}`);
    sections.push(`Open: ${reviewLink}`);
    const body = sections.join(`\n${DIVIDER}\n`);

    // Recipient list: dispatcher phone (primary) + any admin user rows
    // that happen to have a phone number stored.
    const recipients = new Set<string>();
    const dispatcherPhone =
      process.env.DISPATCHER_PHONE_NUMBER ||
      process.env.DISPATCHER_PHONE ||
      "";
    if (dispatcherPhone) recipients.add(dispatcherPhone);

    try {
      const admins = await db.select().from(users).where(eq(users.role, "admin"));
      for (const admin of admins) {
        const phone = (admin as any).phone ?? (admin as any).phoneNumber ?? null;
        if (phone) recipients.add(phone);
      }
    } catch {
      // users table may not have a phone column; that's fine, dispatcher
      // env var is the canonical path.
    }

    if (recipients.size === 0) {
      console.log(
        "[admin-alerts] no recipients — set DISPATCHER_PHONE_NUMBER env var or give an admin user a phone to receive review alerts",
      );
      return;
    }

    const { smsService } = await import("./sms-service");
    for (const phone of Array.from(recipients)) {
      // skipFooter:true — admin alerts are not driver-bound, so the
      // auto-appended driver dashboard footer would be misleading.
      const result = await smsService.sendSMS({ to: phone, body, skipFooter: true });
      console.log(
        `[admin-alerts] sent to ${phone} ok=${result.success} sid=${result.messageSid ?? "-"}`,
      );
    }
  } catch (err: any) {
    console.error("[admin-alerts] send failed:", err.message);
  }
}
