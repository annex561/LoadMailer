import { db } from "./db";
import { rateconIntake, loads, drivers, customers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { PayDriverInput, PayLoadInput } from "./pay-calculator";
import { calculatePay } from "./pay-calculator";

export interface DispatchOutcome {
  ok: boolean;
  loadId?: string;
  confirmationToken?: string;
  error?: string;
}

export async function dispatchFromIntake(intakeId: string): Promise<DispatchOutcome> {
  const [intake] = await db.select().from(rateconIntake).where(eq(rateconIntake.id, intakeId));
  if (!intake) return { ok: false, error: "Intake not found" };
  if (!intake.matchedDriverId) return { ok: false, error: "No driver assigned" };
  if (!intake.parsedJson) return { ok: false, error: "No parsed data" };

  const [driver] = await db.select().from(drivers).where(eq(drivers.id, intake.matchedDriverId));
  if (!driver) return { ok: false, error: "Driver not found" };

  const parsed = intake.parsedJson as any;
  const confirmationToken = nanoid(24);

  // Resolve or auto-create customer from broker name (loads.customerId is required)
  const brokerName = parsed.broker?.value ?? "Unknown Broker";
  let customerId: string;
  const [existingCustomer] = await db
    .select()
    .from(customers)
    .where(eq(customers.name, brokerName))
    .limit(1);
  if (existingCustomer) {
    customerId = existingCustomer.id;
  } else {
    const [newCustomer] = await db
      .insert(customers)
      .values({
        companyId: intake.companyId,
        name: brokerName,
        contactPerson: "",
        email: "",
        phone: "",
        address: "",
        status: "active",
      })
      .returning();
    customerId = newCustomer.id;
  }

  // Create the load
  const loadNumber = parsed.loadNumber?.value ?? `RC-${Date.now()}`;
  const pickupDate = new Date(`${parsed.pickup.date}T${parsed.pickup.time}:00`);
  const deliveryDate = new Date(`${parsed.drop.date}T${parsed.drop.time}:00`);

  // Idempotent insert: if a load with this loadNumber already exists (e.g. the
  // legacy email scanner created it before the universal intake pipeline took
  // over), UPDATE it with the new dispatch metadata instead of failing on the
  // unique constraint.
  const loadValues = {
    companyId: intake.companyId,
    loadNumber,
    customerId,
    driverId: driver.id,
    description: parsed.commodity?.value ?? "General freight",
    pickupAddress: `${parsed.pickup.address ?? ""} ${parsed.pickup.city}, ${parsed.pickup.state}`.trim(),
    pickupDate,
    pickupTime: parsed.pickup.time,
    deliveryAddress: `${parsed.drop.address ?? ""} ${parsed.drop.city}, ${parsed.drop.state}`.trim(),
    deliveryDate,
    deliveryTime: parsed.drop.time,
    specialInstructions: parsed.specialInstructions?.value ?? null,
    status: "assigned",
    equipmentType: (parsed.equipmentType?.value ?? "dry_van").replace(/\s+/g, "_").toLowerCase(),
    rate: parsed.rate?.value ?? 0,
    miles: typeof parsed.miles?.value === "number" ? parsed.miles.value : undefined,
    weight: typeof parsed.weightLbs?.value === "number" ? parsed.weightLbs.value : undefined,
    brokerName: parsed.broker?.value ?? null,
    assignedDriverName: driver.name,
    sourceBoard: intake.sourceType === "email" ? "email" : "manual",
    originCity: parsed.pickup.city,
    originState: parsed.pickup.state,
    destCity: parsed.drop.city,
    destState: parsed.drop.state,
    offeredRate: parsed.rate?.value ?? 0,
    confirmationToken,
    confirmationStatus: "pending" as const,
  };

  const [existing] = await db
    .select()
    .from(loads)
    .where(eq(loads.loadNumber, loadNumber))
    .limit(1);

  let load: typeof loads.$inferSelect;
  if (existing) {
    // Update the legacy/duplicate load with the new dispatch info
    const [updated] = await db
      .update(loads)
      .set({
        ...loadValues,
        updatedAt: new Date(),
      })
      .where(eq(loads.id, existing.id))
      .returning();
    load = updated;
  } else {
    const [inserted] = await db.insert(loads).values(loadValues).returning();
    load = inserted;
  }

  // Update intake
  await db
    .update(rateconIntake)
    .set({
      status: "dispatched",
      loadId: load.id,
      updatedAt: new Date(),
    })
    .where(eq(rateconIntake.id, intakeId));

  return { ok: true, loadId: load.id, confirmationToken };
}

export function driverProfileToPayInput(driver: any): PayDriverInput {
  return {
    payType: (driver.payType ?? "percent") as PayDriverInput["payType"],
    payRate: driver.payRate ?? 0,
    payRateDeadhead: driver.payRateDeadhead ?? 0,
    deductFactoringEnabled: driver.deductFactoringEnabled ?? false,
    deductFactoringPct: driver.deductFactoringPct ?? 0,
    deductDispatchEnabled: driver.deductDispatchEnabled ?? false,
    deductDispatchPct: driver.deductDispatchPct ?? 0,
    deductFuelAdvanceEnabled: driver.deductFuelAdvanceEnabled ?? false,
    deductFuelAdvanceAmount: driver.deductFuelAdvanceAmount ?? 0,
    deductTrailerRentEnabled: driver.deductTrailerRentEnabled ?? false,
    deductTrailerRentWeekly: driver.deductTrailerRentWeekly ?? 0,
    deductInsuranceEnabled: driver.deductInsuranceEnabled ?? false,
    deductInsuranceWeekly: driver.deductInsuranceWeekly ?? 0,
    deductEldEnabled: driver.deductEldEnabled ?? false,
    deductEldMonthly: driver.deductEldMonthly ?? 0,
    deductOccAccEnabled: driver.deductOccAccEnabled ?? false,
    deductOccAccWeekly: driver.deductOccAccWeekly ?? 0,
  };
}

export function computeLoadPayInput(parsed: any): PayLoadInput {
  const totalMiles = parsed.miles?.value ?? 0;
  // If deadhead unknown, treat all miles as loaded
  return {
    rate: parsed.rate?.value ?? 0,
    loadedMiles: totalMiles,
    deadheadMiles: 0,
  };
}

// Driver dispatch SMS always fires when called — "Approve & Dispatch" is an
// explicit user action, so there's no point gating it behind an env var.
// (Admin alerts and YES/NO replies remain gated by SMS_ENABLED to prevent
// noise during testing — only the explicit dispatch action sends real SMS.)
export async function sendDispatchSms(loadId: string): Promise<{ ok: boolean; error?: string }> {
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load || !load.driverId) return { ok: false, error: "Load or driver missing" };
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId));
  if (!driver) return { ok: false, error: "Driver not found" };
  const phone = (driver as any).phoneNumber ?? (driver as any).phone;
  if (!phone) return { ok: false, error: "Driver has no phone" };

  const payInput = computeLoadPayInput({
    rate: { value: load.rate ?? 0 },
    miles: { value: load.miles ?? 0 },
  });
  const pay = calculatePay(payInput, driverProfileToPayInput(driver));

  const baseUrl = process.env.CUSTOM_DOMAIN || "https://traqiq.app";
  const url = `${baseUrl}/l/${load.confirmationToken}`;
  const pickupDateStr = load.pickupDate instanceof Date
    ? load.pickupDate.toLocaleDateString()
    : new Date(load.pickupDate).toLocaleDateString();
  const deliveryDateStr = load.deliveryDate instanceof Date
    ? load.deliveryDate.toLocaleDateString()
    : new Date(load.deliveryDate).toLocaleDateString();

  // Prefer the full street address (e.g. "8040 N. VIRGINIA ST Ste 102, Reno, NV 89506")
  // over just city/state. Fall back to city/state if address wasn't extracted.
  const pickupLine =
    load.pickupAddress && load.pickupAddress.trim().length > 0
      ? load.pickupAddress
      : `${load.originCity ?? ""}, ${load.originState ?? ""}`.trim().replace(/^,\s*/, "");
  const dropLine =
    load.deliveryAddress && load.deliveryAddress.trim().length > 0
      ? load.deliveryAddress
      : `${load.destCity ?? ""}, ${load.destState ?? ""}`.trim().replace(/^,\s*/, "");

  const commodityLine = load.description && load.description !== "General freight"
    ? `📦 ${load.description}\n`
    : "";
  const specialLine = load.specialInstructions
    ? `⚠️ ${load.specialInstructions}\n\n`
    : "";

  const body =
    `TRAQ-IQ Dispatch\n` +
    `New load #${load.loadNumber}` +
    (load.brokerName ? ` (${load.brokerName})` : "") +
    `\n\n` +
    `📍 PICKUP\n${pickupLine}\n` +
    `${pickupDateStr} @ ${load.pickupTime}\n\n` +
    `📍 DROP\n${dropLine}\n` +
    `${deliveryDateStr} @ ${load.deliveryTime}\n\n` +
    commodityLine +
    specialLine +
    `💰 NET PAY: $${pay.netPay.toFixed(2)}\n\n` +
    `Details & confirm: ${url}\n\n` +
    `Reply YES to accept · NO to decline`;

  console.log(`[dispatch-sms] sending to ${phone} for load ${load.loadNumber}`);
  const { smsService } = await import("./sms-service");
  try {
    await smsService.sendSMS(phone, body);
    console.log(`[dispatch-sms] ✅ sent to ${phone}`);
    return { ok: true };
  } catch (err: any) {
    console.error(`[dispatch-sms] ❌ Twilio send failed: ${err.message}`);
    return { ok: false, error: `Twilio: ${err.message}` };
  }
}
