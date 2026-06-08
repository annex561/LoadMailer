// Pure, unit-tested predicates for SP2 driver lines. Twilio API calls are added in Task 3.

export const DRIVER_INBOUND_PATH = "/api/twilio/voice/driver-inbound";

export function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = /^\+1(\d{3})\d{7}$/.exec(phone.trim());
  return m ? m[1] : null;
}

export function provisionDecision(args: { hasSpare: boolean; provisionEnabled: boolean }): "reuse" | "buy" | "buy-disabled" {
  if (args.hasSpare) return "reuse";
  return args.provisionEnabled ? "buy" : "buy-disabled";
}

function isDemoOrEmpty(url: string | null | undefined): boolean {
  return !url || url.trim() === "" || url.includes("demo.twilio.com");
}

// A number is "spare" ONLY if it can never be a dispatch SMS sender, the main
// number, the SP1 main voice line, or an already-assigned driver line.
export function isSpareNumber(
  num: { phoneNumber: string; smsUrl?: string | null; voiceUrl?: string | null },
  ctx: { mainNumber: string; assignedVoiceNumbers: Set<string>; ourWebhookUrl: string },
): boolean {
  if (num.phoneNumber === ctx.mainNumber) return false;
  if (ctx.assignedVoiceNumbers.has(num.phoneNumber)) return false;
  if (!isDemoOrEmpty(num.smsUrl)) return false;                       // active SMS sender → never touch
  if (!isDemoOrEmpty(num.voiceUrl) && num.voiceUrl !== ctx.ourWebhookUrl) return false; // points elsewhere
  return true;
}

export function buildInboundTwiml(driver: { phone: string } | null | undefined, fromNumber: string): string {
  if (!driver || !driver.phone) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Sorry, this number is not in service.</Say><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="Polly.Joanna">Thank you for calling. This call may be recorded for quality and training purposes.</Say>` +
    `<Dial record="record-from-answer" callerId="${fromNumber}" timeout="25" answerOnBridge="true" action="${DRIVER_INBOUND_PATH}/after" method="POST">` +
    `<Number>${driver.phone}</Number></Dial></Response>`;
}

export function buildAfterTwiml(dialCallStatus: string): string {
  const missed = dialCallStatus === "no-answer" || dialCallStatus === "busy" || dialCallStatus === "failed";
  if (missed) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Say voice="Polly.Joanna">Sorry we missed you. Please leave a message after the tone.</Say>` +
      `<Record maxLength="180" playBeep="true"/><Hangup/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
}

export function resolveCallSource(
  driver: { id: string; companyId: string | null } | null | undefined,
  job: { source?: string; driverId?: string | null; companyId?: string | null },
): { source: string; driverId: string | null; companyId: string | null } {
  if (driver) {
    return { source: "twilio_driver", driverId: driver.id, companyId: driver.companyId ?? null };
  }
  return { source: job.source ?? "twilio_main", driverId: job.driverId ?? null, companyId: job.companyId ?? null };
}

import { db } from "./db";
import { drivers } from "@shared/schema";
import { eq } from "drizzle-orm";

const VOICE_WEBHOOK_BASE = process.env.VOICE_WEBHOOK_BASE || "https://traqiq.app";
const OUR_VOICE_URL = `${VOICE_WEBHOOK_BASE}${DRIVER_INBOUND_PATH}`;

function tw(): { sid: string; auth: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  return { sid, auth };
}

async function listOwnedNumbers(): Promise<Array<{ phoneNumber: string; smsUrl: string; voiceUrl: string; sid: string }>> {
  const { sid, auth } = tw();
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`, { headers: { Authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`list numbers failed: ${r.status}`);
  const j: any = await r.json();
  return (j.incoming_phone_numbers ?? []).map((n: any) => ({ phoneNumber: n.phone_number, smsUrl: n.sms_url ?? "", voiceUrl: n.voice_url ?? "", sid: n.sid }));
}

export async function findSpareNumber(): Promise<{ phoneNumber: string; sid: string } | null> {
  const owned = await listOwnedNumbers();
  const assignedRows = await db.select({ v: drivers.voiceNumber }).from(drivers);
  const assigned = new Set(assignedRows.map((r: { v: string | null }) => r.v).filter(Boolean) as string[]);
  const ctx = { mainNumber: process.env.TWILIO_PHONE_NUMBER || "", assignedVoiceNumbers: assigned, ourWebhookUrl: OUR_VOICE_URL };
  const spare = owned.find((n) => isSpareNumber(n, ctx));
  return spare ? { phoneNumber: spare.phoneNumber, sid: spare.sid } : null;
}

async function wireVoiceWebhook(numberSid: string): Promise<void> {
  const { sid, auth } = tw();
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${numberSid}.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ VoiceUrl: OUR_VOICE_URL, VoiceMethod: "POST" }),
  });
  if (!r.ok) throw new Error(`wire webhook failed: ${r.status}`);
}

async function buyNumber(areaCode: string): Promise<{ phoneNumber: string; sid: string }> {
  const { sid, auth } = tw();
  const avail = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${encodeURIComponent(areaCode)}&VoiceEnabled=true&PageSize=1`, { headers: { Authorization: `Basic ${auth}` } });
  if (!avail.ok) throw new Error(`available-numbers lookup failed: ${avail.status}`);
  const aj: any = await avail.json();
  const candidate = aj.available_phone_numbers?.[0]?.phone_number;
  if (!candidate) throw new Error(`no available number in area code ${areaCode}`);
  const buy = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ PhoneNumber: candidate, VoiceUrl: OUR_VOICE_URL, VoiceMethod: "POST" }),
  });
  if (!buy.ok) throw new Error(`buy number failed: ${buy.status}`);
  const bj: any = await buy.json();
  return { phoneNumber: bj.phone_number, sid: bj.sid };
}

export interface ProvisionResult { ok: boolean; phoneNumber?: string; mode?: "reuse" | "buy"; error?: string; }

export async function assignLineToDriver(driverId: string, requestedAreaCode?: string): Promise<ProvisionResult> {
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  if (!driver) return { ok: false, error: "driver not found" };
  if (driver.voiceNumber) return { ok: true, phoneNumber: driver.voiceNumber, mode: "reuse" }; // idempotent

  const spare = await findSpareNumber();
  const decision = provisionDecision({ hasSpare: !!spare, provisionEnabled: process.env.DRIVER_LINE_PROVISION_ENABLED === "true" });

  let number: { phoneNumber: string; sid: string };
  let mode: "reuse" | "buy";
  if (decision === "reuse" && spare) { number = spare; mode = "reuse"; await wireVoiceWebhook(number.sid); }
  else if (decision === "buy") {
    const areaCode = requestedAreaCode || areaCodeOf(driver.phone) || "205";
    number = await buyNumber(areaCode); mode = "buy"; // webhook wired at buy time
  } else {
    return { ok: false, error: "no spare number available and buying is disabled (set DRIVER_LINE_PROVISION_ENABLED=true to buy)" };
  }

  await db.update(drivers).set({ voiceNumber: number.phoneNumber, voiceNumberSid: number.sid }).where(eq(drivers.id, driverId));
  console.log(`[driver-lines] assigned ${number.phoneNumber} to driver ${driverId} (${mode})`);
  return { ok: true, phoneNumber: number.phoneNumber, mode };
}
