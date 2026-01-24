import { db } from "./db";
import { loads, companies, customers, activityLog } from "@shared/schema";
import { eq } from "drizzle-orm";

export class RateConService {
  async generateRateCon(loadId: string, actorId: string) {
    const loadData = await db
      .select()
      .from(loads)
      .where(eq(loads.id, loadId))
      .leftJoin(companies, eq(loads.companyId, companies.id))
      .leftJoin(customers, eq(loads.customerId, customers.id))
      .then(rows => rows[0]);

    if (!loadData || !loadData.loads.bookedAt) {
      throw new Error("Cannot generate RateCon: Load must be in 'booked' status.");
    }

    const fileName = `ratecon_${loadData.loads.loadNumber}_v1.pdf`;
    const storagePath = `/storage/company_${loadData.loads.companyId}/ratecons/${fileName}`;

    const updatedLoad = await db.update(loads)
      .set({
        rateconPath: storagePath,
        lifecycleStatus: "scheduled"
      })
      .where(eq(loads.id, loadId))
      .returning();

    await db.insert(activityLog).values({
      companyId: loadData.loads.companyId!,
      entityType: "LOAD",
      entityId: loadId,
      action: "RATECON_GENERATED",
      actor: actorId,
      details: { 
        rate: loadData.loads.rate, 
        path: storagePath,
        version: 1 
      }
    });

    return {
      message: "Rate Confirmation generated successfully",
      path: storagePath,
      load: updatedLoad[0]
    };
  }
}

export const rateConService = new RateConService();
