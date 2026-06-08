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
