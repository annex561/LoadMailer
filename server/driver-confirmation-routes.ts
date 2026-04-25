import type { Express } from "express";
import { db } from "./db";
import { loads, drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { calculatePay } from "./pay-calculator";
import { driverProfileToPayInput, computeLoadPayInput } from "./ratecon-dispatch-service";

export function registerDriverConfirmationRoutes(app: Express) {
  app.get("/api/confirm/:token", async (req, res) => {
    try {
      const [load] = await db
        .select()
        .from(loads)
        .where(eq(loads.confirmationToken, req.params.token));
      if (!load) return res.status(404).json({ error: "not found" });
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId!));
      if (!driver) return res.status(404).json({ error: "driver missing" });

      const payInput = computeLoadPayInput({
        rate: { value: load.rate ?? 0 },
        miles: { value: load.miles ?? 0 },
      });
      const pay = calculatePay(payInput, driverProfileToPayInput(driver));

      // Driver-facing view — hide gross linehaul
      res.json({
        loadNumber: load.loadNumber,
        broker: load.brokerName,
        pickup: {
          city: load.originCity,
          state: load.originState,
          address: load.pickupAddress,
          date: load.pickupDate,
          time: load.pickupTime,
        },
        drop: {
          city: load.destCity,
          state: load.destState,
          address: load.deliveryAddress,
          date: load.deliveryDate,
          time: load.deliveryTime,
        },
        specialInstructions: load.specialInstructions,
        equipmentType: load.equipmentType,
        weight: load.weight,
        pay: {
          lineItems: pay.lineItems,
          deductions: pay.deductions,
          netPay: pay.netPay,
          recurringDeductions: pay.recurringDeductions,
        },
        confirmationStatus: load.confirmationStatus,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/confirm/:token/accept", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          confirmationStatus: "accepted",
          confirmationRespondedAt: new Date(),
          status: "assigned",
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/confirm/:token/decline", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          confirmationStatus: "declined",
          confirmationRespondedAt: new Date(),
          status: "cancelled",
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      const { notifyAdminReviewNeeded } = await import("./ratecon-admin-alerts");
      await notifyAdminReviewNeeded({
        companyId: updated.companyId,
        intakeId: updated.id,
        broker: updated.brokerName ?? "Unknown",
        reason: `Driver declined load ${updated.loadNumber} via web`,
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
