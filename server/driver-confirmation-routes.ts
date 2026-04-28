import type { Express } from "express";
import multer from "multer";
import { db } from "./db";
import { loads, drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { calculatePay } from "./pay-calculator";
import {
  driverProfileToPayInput,
  computeLoadPayInput,
  sendDriverNextStepSms,
} from "./ratecon-dispatch-service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max for BOL/POD photos
});

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

      // Driver-facing view — hide gross linehaul. Includes status/lifecycle so
      // the page can render the right action button (Accept → Picked Up →
      // Delivered → Settlement).
      res.json({
        loadId: load.id,
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
        loadStatus: load.status,
        bolPath: (load as any).bolPath ?? null,
        podPath: load.podPath ?? null,
        deliveredAt: load.deliveredAt,
        driverTrackingToken: driver.trackingToken ?? null,
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

      // Fire follow-up SMS with link to upload BOL when driver picks up
      sendDriverNextStepSms(updated.id, "accepted").catch((e) =>
        console.error("[accept] next-step SMS failed:", e.message),
      );

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

  // Mark as picked up — driver clicks button in dashboard at pickup
  app.post("/api/confirm/:token/picked-up", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          status: "in_transit",
          updatedAt: new Date(),
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      sendDriverNextStepSms(updated.id, "picked-up").catch((e) =>
        console.error("[picked-up] next-step SMS failed:", e.message),
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark as delivered — driver clicks button in dashboard at delivery
  app.post("/api/confirm/:token/delivered", async (req, res) => {
    try {
      const [updated] = await db
        .update(loads)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(loads.confirmationToken, req.params.token))
        .returning();
      if (!updated) return res.status(404).json({ error: "not found" });
      sendDriverNextStepSms(updated.id, "delivered").catch((e) =>
        console.error("[delivered] next-step SMS failed:", e.message),
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload BOL or POD — multer single-file upload from driver's phone
  app.post(
    "/api/confirm/:token/upload-doc",
    upload.single("doc"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "doc file required" });
        const docType = (req.body?.docType ?? "bol").toLowerCase();
        if (!["bol", "pod"].includes(docType)) {
          return res.status(400).json({ error: "docType must be 'bol' or 'pod'" });
        }

        const [load] = await db
          .select()
          .from(loads)
          .where(eq(loads.confirmationToken, req.params.token));
        if (!load) return res.status(404).json({ error: "not found" });

        // Save the uploaded file as a base64 data URL on the load record.
        // For small mobile-camera photos (<15MB enforced by multer) this is
        // fine; future improvement is to push to object storage and store URL.
        const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (docType === "pod") {
          updates.podPath = dataUrl;
          updates.podUploadedAt = new Date();
          updates.deliveredAt = new Date();
          updates.status = "delivered";
        } else {
          updates.bolPath = dataUrl;
          updates.bolUploadedAt = new Date();
          if (load.status === "assigned") updates.status = "in_transit";
        }

        const [updated] = await db
          .update(loads)
          .set(updates as any)
          .where(eq(loads.id, load.id))
          .returning();

        // Auto-fire next-step SMS depending on which doc came in
        if (docType === "bol" && load.status !== "in_transit") {
          sendDriverNextStepSms(updated.id, "picked-up").catch(() => {});
        } else if (docType === "pod") {
          sendDriverNextStepSms(updated.id, "delivered").catch(() => {});
        }

        res.json({
          ok: true,
          docType,
          loadStatus: updated.status,
          fileSizeBytes: req.file.size,
        });
      } catch (err: any) {
        const pgDetail = err?.cause?.detail || err?.detail || err?.cause?.message;
        res.status(500).json({ error: pgDetail ? `${err.message} — ${pgDetail}` : err.message });
      }
    },
  );
}
