import { db } from "./db";
import { rateconIntake, loads, drivers, customers } from "@shared/schema";
import { eq } from "drizzle-orm";
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

  const [load] = await db
    .insert(loads)
    .values({
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
      miles: parsed.miles?.value ?? null,
      weight: parsed.weightLbs?.value ?? null,
      brokerName: parsed.broker?.value ?? null,
      assignedDriverName: driver.name,
      sourceBoard: intake.sourceType === "email" ? "email" : "manual",
      originCity: parsed.pickup.city,
      originState: parsed.pickup.state,
      destCity: parsed.drop.city,
      destState: parsed.drop.state,
      offeredRate: parsed.rate?.value ?? 0,
      confirmationToken,
      confirmationStatus: "pending",
    })
    .returning();

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

const SMS_ENABLED = process.env.SMS_ENABLED === "true";

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

  const url = `https://traqiqs.io/l/${load.confirmationToken}`;
  const pickupDateStr = load.pickupDate instanceof Date
    ? load.pickupDate.toLocaleDateString()
    : new Date(load.pickupDate).toLocaleDateString();
  const deliveryDateStr = load.deliveryDate instanceof Date
    ? load.deliveryDate.toLocaleDateString()
    : new Date(load.deliveryDate).toLocaleDateString();

  const body =
    `TRAQ-IQ Dispatch\n` +
    `New load #${load.loadNumber}\n\n` +
    `📍 PICKUP\n${load.originCity}, ${load.originState}\n` +
    `${pickupDateStr} @ ${load.pickupTime}\n\n` +
    `📍 DROP\n${load.destCity}, ${load.destState}\n` +
    `${deliveryDateStr} @ ${load.deliveryTime}\n\n` +
    `💰 NET PAY: $${pay.netPay.toFixed(2)}\n\n` +
    `Details & confirm: ${url}\n\n` +
    `Reply YES to accept · NO to decline`;

  if (!SMS_ENABLED) {
    console.log(`[dispatch-sms:DRY-RUN] would SMS ${phone} for load ${load.loadNumber}:\n${body}`);
    return { ok: true };
  }

  const { smsService } = await import("./sms-service");
  await smsService.sendSMS(phone, body);
  return { ok: true };
}
