import cron from "node-cron";
import { db } from "./db";
import { loads } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";
import { notifyAdminReviewNeeded } from "./ratecon-admin-alerts";

const THIRTY_MIN_MS = 30 * 60 * 1000;
const EMITTED = new Set<string>(); // in-process dedupe

export function startRateconEscalationCron() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - THIRTY_MIN_MS);
      const stale = await db
        .select()
        .from(loads)
        .where(
          and(
            eq(loads.confirmationStatus, "pending"),
            lt(loads.createdAt, cutoff),
          ),
        );
      for (const l of stale) {
        if (EMITTED.has(l.id)) continue;
        EMITTED.add(l.id);
        await notifyAdminReviewNeeded({
          companyId: l.companyId,
          intakeId: l.id,
          broker: l.brokerName ?? "Unknown",
          reason: `Driver has not responded to load ${l.loadNumber} in 30+ min`,
        });
      }
    } catch (err: any) {
      console.error("[ratecon-escalation-cron]", err.message);
    }
  });
  console.log("[ratecon-escalation-cron] scheduled every 5 min");
}
