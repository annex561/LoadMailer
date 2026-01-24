import { db } from "./db";
import { trucks, complianceDocuments, workOrders, pmSchedule } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { isAfter } from "date-fns";

export type GateStatus = "GREEN" | "YELLOW" | "RED";

export class DispatchGateService {
  async getTruckGateStatus(truckId: string): Promise<{ 
    status: GateStatus; 
    reasons: string[];
    riskScore: number;
  }> {
    const reasons: string[] = [];
    let riskScore = 0;

    const expiredDocs = await db.select().from(complianceDocuments).where(
      and(
        eq(complianceDocuments.truckId, truckId),
        lte(complianceDocuments.expiryDate, new Date())
      )
    );

    if (expiredDocs.length > 0) {
      reasons.push(`Expired Documents: ${expiredDocs.map(d => d.type).join(", ")}`);
      return { status: "RED", reasons, riskScore: 100 };
    }

    const criticalWorkOrders = await db.select().from(workOrders).where(
      and(
        eq(workOrders.truckId, truckId),
        eq(workOrders.status, "OPEN"),
        eq(workOrders.priority, "CRITICAL")
      )
    );

    if (criticalWorkOrders.length > 0) {
      reasons.push("Open Critical Work Orders");
      return { status: "RED", reasons, riskScore: 90 };
    }

    const overduePM = await db.select().from(pmSchedule).where(
      and(
        eq(pmSchedule.truckId, truckId),
        eq(pmSchedule.status, "OVERDUE")
      )
    );

    if (overduePM.length > 0) {
      reasons.push("Overdue Preventive Maintenance");
      riskScore += 40;
    }

    const status: GateStatus = riskScore >= 70 ? "RED" : riskScore >= 30 ? "YELLOW" : "GREEN";
    
    return { status, reasons, riskScore };
  }

  async validateBooking(truckId: string, overrideReason?: string): Promise<boolean> {
    const truck = await db.query.trucks.findFirst({ where: eq(trucks.id, truckId) });
    if (!truck) throw new Error("Truck not found");

    const gate = await this.getTruckGateStatus(truckId);

    if (gate.status === "RED") {
      const hasActiveOverride = truck.dispatchGateOverrideReason && 
        truck.dispatchGateOverrideAt && 
        isAfter(new Date(truck.dispatchGateOverrideAt), new Date(Date.now() - 24 * 60 * 60 * 1000));
      
      if (!overrideReason && !hasActiveOverride) {
        throw new Error(`Booking Blocked: Truck is in RED status. ${gate.reasons.join(". ")}`);
      }
    }

    return true;
  }

  async updateTruckGateStatus(truckId: string): Promise<void> {
    const gate = await this.getTruckGateStatus(truckId);
    
    await db.update(trucks)
      .set({
        dispatchGateStatus: gate.status,
        riskScore: gate.riskScore,
        riskScoreLastCalculatedAt: new Date(),
        dispatchGateReason: gate.reasons.join("; ") || null,
      })
      .where(eq(trucks.id, truckId));
  }
}

export const dispatchGate = new DispatchGateService();
