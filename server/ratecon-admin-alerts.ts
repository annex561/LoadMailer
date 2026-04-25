import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const SMS_ENABLED = process.env.SMS_ENABLED === "true";

export async function notifyAdminReviewNeeded(params: {
  companyId: string | null;
  intakeId: string;
  broker: string;
  reason: string;
}) {
  try {
    const admins = await db
      .select()
      .from(users)
      .where(eq(users.role, "admin"));

    const body =
      `[TRAQ-IQ] Ratecon needs review\n` +
      `Broker: ${params.broker}\n` +
      `Reason: ${params.reason}\n` +
      `Open: https://traqiqs.io/review-queue`;

    for (const admin of admins) {
      // users table has no phone column — skip SMS for this admin
      const phone = (admin as any).phone ?? (admin as any).phoneNumber ?? null;
      if (!phone) {
        console.log(
          `[admin-alerts] admin ${admin.id} (${admin.email}) has no phone — skipping SMS`
        );
        continue;
      }

      if (!SMS_ENABLED) {
        console.log(`[admin-alerts:DRY-RUN] would SMS ${phone}:\n${body}`);
        continue;
      }

      const { smsService } = await import("./sms-service");
      await smsService.sendSMS(phone, body);
    }
  } catch (err: any) {
    console.error("[admin-alerts] send failed:", err.message);
  }
}
