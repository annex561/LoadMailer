/**
 * S13 — Driver load text sequence.
 *
 * Text 1: offer + confirm request (city/state only, no broker data).
 * Text 2: full addresses, sent only after driver confirms.
 *
 * Gated by DRIVER_LOAD_TEXTS_ENABLED (default OFF). All sends route
 * through smsService (messagingServiceSid from S12-C), never from 7969.
 *
 * Broker data (name, phone) is NEVER included in driver-facing output
 * per spec 14a-1.
 */

// ponytail: trailing spaces in the template array values are load-bearing
// (exact bytes required by the golden test). Prettier-ignore prevents them
// being stripped by the formatter. Do NOT reformat this constant.
// prettier-ignore
const TEXT1_LINES = [
  "LAMP Logistics",
  "Please remember, you are ",
  "working with LAMP Logistics: ",
  "============================ ",
  "PU: {pickupDate} {pickupApptType} {pickupWindowStart} to {pickupWindowEnd}",
  "{pickupCity}, {pickupState}",
  "============================",
  "DROP: {dropDate} {dropApptType} {dropWindowStart} to {dropWindowEnd}",
  "{dropCity}, {dropState}",
  "============================",
  "Weight: {weightLbs}",
  "============================ ",
  "24/7 support:(855) 599-9983 ",
  "Stay safe on the road and have a good trip!",
  " ============================ ",
  "For tracking purposes, please accept ",
  "Macropoint. This is a strict requirement. ",
  "============================ ",
  "Rate $ {driverRate}",
  "============================ ",
  "Please confirm and provide ETA",
];
const TEXT1_TEMPLATE = TEXT1_LINES.join("\n");

export interface Text1Fields {
  pickupDate: string;        // e.g. "6/2"
  pickupApptType: string;    // "FCFS" or "Appt"
  pickupWindowStart: string; // "08:00"
  pickupWindowEnd: string;   // "12:00"
  pickupCity: string;
  pickupState: string;
  pickupIsAsap?: boolean;
  dropDate: string;
  dropApptType: string;
  dropWindowStart: string;
  dropWindowEnd: string;
  dropCity: string;
  dropState: string;
  weightLbs: number | string;
  driverRate: number | string;
}

/** Render Text 1 with exact template bytes; pickupIsAsap prefixes city line. */
export function renderText1(f: Text1Fields): string {
  const cityLine = f.pickupIsAsap
    ? `ASAP ${f.pickupCity}, ${f.pickupState}`
    : `${f.pickupCity}, ${f.pickupState}`;
  return TEXT1_TEMPLATE
    .replace("{pickupDate}", String(f.pickupDate))
    .replace("{pickupApptType}", String(f.pickupApptType))
    .replace("{pickupWindowStart}", String(f.pickupWindowStart))
    .replace("{pickupWindowEnd}", String(f.pickupWindowEnd))
    .replace("{pickupCity}, {pickupState}", cityLine)
    .replace("{dropDate}", String(f.dropDate))
    .replace("{dropApptType}", String(f.dropApptType))
    .replace("{dropWindowStart}", String(f.dropWindowStart))
    .replace("{dropWindowEnd}", String(f.dropWindowEnd))
    .replace("{dropCity}, {dropState}", `${f.dropCity}, ${f.dropState}`)
    .replace("{weightLbs}", String(f.weightLbs))
    .replace("{driverRate}", String(f.driverRate));
}

/** Render Text 2: same structure with full addresses, no confirmation ask. */
export function renderText2(opts: {
  fields: Text1Fields;
  pickupFullAddress: string;
  dropFullAddress: string;
}): string {
  const { fields: f, pickupFullAddress, dropFullAddress } = opts;
  // Re-use the same template builder but swap address lines.
  const rendered = TEXT1_TEMPLATE
    .replace("{pickupDate}", String(f.pickupDate))
    .replace("{pickupApptType}", String(f.pickupApptType))
    .replace("{pickupWindowStart}", String(f.pickupWindowStart))
    .replace("{pickupWindowEnd}", String(f.pickupWindowEnd))
    .replace("{pickupCity}, {pickupState}", pickupFullAddress)
    .replace("{dropDate}", String(f.dropDate))
    .replace("{dropApptType}", String(f.dropApptType))
    .replace("{dropWindowStart}", String(f.dropWindowStart))
    .replace("{dropWindowEnd}", String(f.dropWindowEnd))
    .replace("{dropCity}, {dropState}", dropFullAddress)
    .replace("{weightLbs}", String(f.weightLbs))
    .replace("{driverRate}", String(f.driverRate));
  // Drop the final divider + "Please confirm..." — already confirmed.
  const idx = rendered.lastIndexOf("\n============================ \nPlease confirm and provide ETA");
  return idx !== -1 ? rendered.slice(0, idx) : rendered;
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

const AFFIRMATIVE_EXACT = new Set(["YES", "Y", "CONFIRM", "CONFIRMED", "OK", "OKAY", "👍"]);
const ETA_PATTERNS = [
  /\beta\b/i,
  /\bbe\s+there\b/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\barriving?\b/i,
  /\b\d{1,2}\s*(?:hours?|hrs?|minutes?|mins?)\b/i,
];

/** Returns true if the raw reply counts as a driver confirmation. */
export function isAffirmative(body: string): boolean {
  const normalized = body.trim().toUpperCase();
  if (AFFIRMATIVE_EXACT.has(normalized)) return true;
  return ETA_PATTERNS.some((p) => p.test(body));
}

/** Extract an ETA string from the reply, or null if none detected. */
export function parseEta(body: string): string | null {
  const trimmed = body.trim();
  // If ETA keyword present, return the whole message (best effort).
  if (/\beta\b/i.test(trimmed)) return trimmed;
  // Time patterns like "be there 9am", "arriving at 2:30pm"
  const m = trimmed.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (m) return m[1];
  // Relative: "2 hours", "30 min"
  const rel = trimmed.match(/\b(\d{1,2}\s*(?:hours?|hrs?|minutes?|mins?))\b/i);
  if (rel) return rel[1];
  return null;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getLoadWithDriver(loadId: string) {
  const { db } = await import("./db");
  const { loads, drivers } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId)).limit(1);
  if (!load || !load.driverId) return null;
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, load.driverId)).limit(1);
  if (!driver) return null;
  return { load, driver };
}

function buildText1Fields(load: Record<string, any>): Text1Fields {
  // pickupDate: format timestamp as M/D
  const pu = load.pickupDate ? new Date(load.pickupDate) : null;
  const dr = load.deliveryDate ? new Date(load.deliveryDate) : null;
  const fmt = (d: Date | null) =>
    d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : "TBD";

  return {
    pickupDate: (load as any).pickupApptDate ?? fmt(pu),
    pickupApptType: (load as any).pickupApptType ?? "FCFS",
    pickupWindowStart: (load as any).pickupWindowStart ?? (load.pickupTime as string | undefined) ?? "08:00",
    pickupWindowEnd: (load as any).pickupWindowEnd ?? "TBD",
    pickupCity: (load.originCity as string | undefined) ?? "TBD",
    pickupState: (load.originState as string | undefined) ?? "",
    pickupIsAsap: !!(load as any).pickupIsAsap,
    dropDate: (load as any).dropApptDate ?? fmt(dr),
    dropApptType: (load as any).dropApptType ?? "FCFS",
    dropWindowStart: (load as any).dropWindowStart ?? (load.deliveryTime as string | undefined) ?? "08:00",
    dropWindowEnd: (load as any).dropWindowEnd ?? "TBD",
    dropCity: (load.destCity as string | undefined) ?? "TBD",
    dropState: (load.destState as string | undefined) ?? "",
    weightLbs: (load.weight as number | undefined) ?? "TBD",
    driverRate: (load as any).driverRate ?? (load.rate as number | undefined) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// No-confirm timeout alert
// ---------------------------------------------------------------------------

// ponytail: in-process Map; resets on restart — acceptable for a single-dyno
// alert channel where a missed alert on redeploy is not data-loss.
const _pendingAlerts = new Map<string, ReturnType<typeof setTimeout>>();

export function _cancelNoConfirmAlert(loadId: string): void {
  const t = _pendingAlerts.get(loadId);
  if (t) { clearTimeout(t); _pendingAlerts.delete(loadId); }
}

function scheduleNoConfirmAlert(loadId: string, loadNumber: string, driverName: string): void {
  _cancelNoConfirmAlert(loadId);
  const ms = Number(process.env.DRIVER_TEXT1_CONFIRM_TIMEOUT_MS) || 60 * 60 * 1000; // default 60 min
  const timer = setTimeout(async () => {
    _pendingAlerts.delete(loadId);
    try {
      // Re-check: may have confirmed while timer ran.
      const { db } = await import("./db");
      const { loads } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [load] = await db.select().from(loads).where(eq(loads.id, loadId)).limit(1);
      if (!load || (load as any).driverTextConfirmedAt) return; // already confirmed
      const alertPhone = (process.env.OWNER_ALERT_PHONE || "").trim();
      if (!alertPhone) {
        console.warn("[driver-load-texts] OWNER_ALERT_PHONE not set — cannot send no-confirm alert");
        return;
      }
      const { smsService } = await import("./sms-service");
      await smsService.sendSMS({
        to: alertPhone,
        body: `LAMP #${loadNumber}: driver ${driverName} has not confirmed Text 1 within ${Math.round(ms / 60000)} min. Follow up.`,
        skipFooter: true,
      });
    } catch (err: any) {
      console.error("[driver-load-texts] no-confirm alert failed:", err?.message || err);
    }
  }, ms);
  _pendingAlerts.set(loadId, timer);
}

// ---------------------------------------------------------------------------
// Send Text 1
// ---------------------------------------------------------------------------

export async function sendDriverLoadText1(
  loadId: string,
): Promise<{ ok: boolean; error?: string; messageSid?: string }> {
  if (process.env.DRIVER_LOAD_TEXTS_ENABLED !== "true") {
    return { ok: false, error: "DRIVER_LOAD_TEXTS_ENABLED is off" };
  }
  const pair = await getLoadWithDriver(loadId);
  if (!pair) return { ok: false, error: "Load or driver not found" };
  const { load, driver } = pair;
  const phone: string = (driver as any).phoneNumber ?? (driver as any).phone ?? "";
  if (!phone) return { ok: false, error: "Driver has no phone" };

  const fields = buildText1Fields(load);
  const body = renderText1(fields);

  // ONE audio for the whole Text 1 body. Attached to the first (and only, until
  // PR #164 lands) SMS part. If #164 merges after this PR and splits the body
  // into N parts, its send loop must pass mediaUrls only on the first iteration
  // and omit it on subsequent parts — see PR body for the merge note.
  let mediaUrls: string[] | undefined;
  if (process.env.DRIVER_TEXT_AUDIO_ENABLED === 'true') {
    const { audioUrlForText } = await import("./driver-text-audio");
    const url = await audioUrlForText(body, `text1_${loadId}`);
    if (url) mediaUrls = [url];
    else console.warn("[driver-load-texts] Text 1 audio generation failed — sending text-only");
  }

  const { smsService } = await import("./sms-service");
  const result = await smsService.sendSMS({ to: phone, body, skipFooter: true, mediaUrls, kind: 'driver_text' });

  // Voice fallback: if MMS failed (likely due to mediaUrl) and fallback is enabled, call.
  if (!result.success && mediaUrls && process.env.DRIVER_TEXT_VOICE_FALLBACK_ENABLED === 'true') {
    console.log("[driver-load-texts] MMS failed — trying voice fallback");
    await smsService.callWithSay(phone, body).catch((err: any) =>
      console.error("[driver-load-texts] voice fallback failed:", err?.message || err),
    );
  }

  if (!result.success && !mediaUrls) return { ok: false, error: result.error };
  // If MMS failed but audio was attached, still treat as sent so Text 1 flow continues.
  // (The driver may still receive the text body; the audio is best-effort.)
  if (!result.success && mediaUrls) return { ok: false, error: result.error };

  // Persist text1SentAt on the load.
  try {
    const { db } = await import("./db");
    const { loads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(loads)
      .set({ text1SentAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(loads.id, loadId));
  } catch (err: any) {
    console.warn("[driver-load-texts] could not persist text1SentAt:", err?.message || err);
  }

  scheduleNoConfirmAlert(loadId, load.loadNumber, (driver as any).name ?? "driver");
  return { ok: true, messageSid: result.messageSid };
}

// ---------------------------------------------------------------------------
// Handle Text 1 confirmation reply
// ---------------------------------------------------------------------------

/**
 * Called from sms-communication-service.handleDispatchKeyword BEFORE the
 * existing YES/load-offer logic, so a confirm never accepts a load offer.
 *
 * Returns true if the reply was handled as a Text 1 confirm (caller should
 * return true and skip load-offer YES routing). Returns false if there is no
 * pending Text 1 for this driver (fall through to existing behavior).
 */
export async function handleText1ConfirmIfPending(
  driverId: string,
  rawBody: string,
  fromPhone: string,
): Promise<boolean> {
  if (!isAffirmative(rawBody)) return false;

  const { db } = await import("./db");
  const { loads } = await import("@shared/schema");
  const { eq, and, isNotNull, isNull, desc } = await import("drizzle-orm");

  // Find the most-recent Text 1 sent to this driver that has not been confirmed yet.
  // Newest first and never a delivered load, so a stale unanswered Text 1 can't
  // swallow a YES meant for the current load. Pinned by driver-load-texts.test.ts.
  const [pending] = await db
    .select()
    .from(loads)
    .where(
      and(
        eq(loads.driverId, driverId),
        isNotNull((loads as any).text1SentAt),
        isNull((loads as any).driverTextConfirmedAt),
        isNull(loads.deliveredAt),
      ),
    )
    .orderBy(desc((loads as any).text1SentAt))
    .limit(1);

  if (!pending) return false;

  const eta = parseEta(rawBody);

  // Persist confirmation on the load.
  await db
    .update(loads)
    .set({
      driverTextConfirmedAt: new Date(),
      driverTextConfirmReply: rawBody,
      ...(eta ? { driverTextConfirmEta: eta } : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(loads.id, pending.id));

  // Cancel the no-confirm alert timer.
  _cancelNoConfirmAlert(pending.id);

  // Alert dispatch (OWNER_ALERT_PHONE).
  (async () => {
    try {
      const alertPhone = (process.env.OWNER_ALERT_PHONE || "").trim();
      if (alertPhone) {
        const { smsService } = await import("./sms-service");
        const etaPart = eta ? ` ETA: ${eta}` : "";
        const alertBody = `LAMP #${pending.loadNumber}: driver confirmed Text 1.${etaPart} Reply: "${rawBody.slice(0, 80)}"`;
        let alertMediaUrls: string[] | undefined;
        if (process.env.OWNER_RELAY_AUDIO_ENABLED === 'true') {
          const { audioUrlForText } = await import("./driver-text-audio");
          const url = await audioUrlForText(alertBody, `confirm_${pending.id}`);
          if (url) alertMediaUrls = [url];
        }
        await smsService.sendSMS({
          to: alertPhone,
          body: alertBody,
          skipFooter: true,
          mediaUrls: alertMediaUrls,
          kind: 'owner_alert',
        });
      }
    } catch (err: any) {
      console.error("[driver-load-texts] dispatch alert failed:", err?.message || err);
    }
  })();

  // Send Text 2.
  await sendDriverLoadText2(pending.id).catch((err: any) =>
    console.error("[driver-load-texts] Text 2 failed:", err?.message || err),
  );

  return true;
}

// ---------------------------------------------------------------------------
// Send Text 2
// ---------------------------------------------------------------------------

export async function sendDriverLoadText2(
  loadId: string,
): Promise<{ ok: boolean; error?: string; messageSid?: string }> {
  const pair = await getLoadWithDriver(loadId);
  if (!pair) return { ok: false, error: "Load or driver not found" };
  const { load, driver } = pair;
  const phone: string = (driver as any).phoneNumber ?? (driver as any).phone ?? "";
  if (!phone) return { ok: false, error: "Driver has no phone" };

  const fields = buildText1Fields(load);
  const body = renderText2({
    fields,
    pickupFullAddress: (load.pickupAddress as string | undefined) ?? `${fields.pickupCity}, ${fields.pickupState}`,
    dropFullAddress: (load.deliveryAddress as string | undefined) ?? `${fields.dropCity}, ${fields.dropState}`,
  });

  let mediaUrls: string[] | undefined;
  if (process.env.DRIVER_TEXT_AUDIO_ENABLED === 'true') {
    const { audioUrlForText } = await import("./driver-text-audio");
    const url = await audioUrlForText(body, `text2_${loadId}`);
    if (url) mediaUrls = [url];
    else console.warn("[driver-load-texts] Text 2 audio generation failed — sending text-only");
  }

  const { smsService } = await import("./sms-service");
  const result = await smsService.sendSMS({ to: phone, body, skipFooter: true, mediaUrls, kind: 'driver_text' });

  if (!result.success && mediaUrls && process.env.DRIVER_TEXT_VOICE_FALLBACK_ENABLED === 'true') {
    console.log("[driver-load-texts] Text 2 MMS failed — trying voice fallback");
    await smsService.callWithSay(phone, body).catch((err: any) =>
      console.error("[driver-load-texts] Text 2 voice fallback failed:", err?.message || err),
    );
  }

  if (!result.success) return { ok: false, error: result.error };

  // Persist text2SentAt.
  try {
    const { db } = await import("./db");
    const { loads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(loads)
      .set({ text2SentAt: new Date(), updatedAt: new Date() } as any)
      .where(eq(loads.id, loadId));
  } catch (err: any) {
    console.warn("[driver-load-texts] could not persist text2SentAt:", err?.message || err);
  }

  return { ok: true, messageSid: result.messageSid };
}
