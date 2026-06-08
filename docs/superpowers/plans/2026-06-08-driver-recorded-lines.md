# Per-Driver Recorded Inbound Lines (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each driver a dedicated Twilio company number that records inbound calls, forwards them to the driver's personal cell, and feeds the recordings into the existing SP1 `callRecord` layer tagged by driver.

**Architecture:** A shared, signature-validated TwiML webhook (`/api/twilio/voice/driver-inbound`, public) looks up the driver by the called number and returns record+forward TwiML; an admin provisioning service (`/api/voice/drivers/:id/provision-line`, auth-guarded) reuses an idle owned number or buys one (double-gated); the SP1 poller tags driver calls by mapping `toNumber → drivers.voiceNumber`. Pure predicates carry the safety guarantees and are unit-tested.

**Tech Stack:** TypeScript, Express, Drizzle (direct `db`, runtime `ensure-schema.ts`), Twilio REST (AvailablePhoneNumbers/IncomingPhoneNumbers), React + TanStack Query, Vitest.

---

## Routing decision (important)

- **Public (Twilio-called, signature-validated, NOT auth-guarded):** `POST /api/twilio/voice/driver-inbound` and `POST /api/twilio/voice/driver-inbound/after`. The `/api/twilio/*` prefix is in NO auth-guard list, so Twilio can reach it. (`/api/voice/*` is auth-guarded by the SP1 security fix, so the webhook must NOT live there.)
- **Auth-guarded (admin/dispatcher, via the existing `adminOrDispatcherOrApiKey` prefix guard on `/api/voice`):** `POST /api/voice/drivers/:id/provision-line`.
- The driver "View calls" link reuses the existing `GET /api/voice/calls` and filters client-side by `?driver=<id>` — no new list route.

## Financial guard (deploy + enable gate)

The only new paid path is **buying a number** (~$1.15/mo each). It is double-gated: an admin click + confirm in the UI, AND `DRIVER_LINE_PROVISION_ENABLED` (default OFF). With the flag off, provisioning only ever reuses a genuinely idle owned number and returns 409 if none is free — **it cannot buy**. Building/merging spends nothing. Per-call recording/transcription reuses SP1's already-live guards.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `shared/schema.ts` | Modify | Add `voiceNumber` + `voiceNumberSid` to `drivers` |
| `server/ensure-schema.ts` | Modify | Idempotent `ALTER drivers ADD COLUMN` + unique index |
| `server/driver-line-service.ts` | Create | Pure predicates (tested) + Twilio provisioning calls |
| `server/driver-line-routes.ts` | Create | Public inbound webhook + guarded provision route |
| `server/routes.ts` | Modify | Register driver-line routes (after the prefix guards) |
| `server/call-intake-service.ts` | Modify | Tag driver calls by `toNumber → driver` |
| `server/__tests__/driver-line-predicates.test.ts` | Create | areaCodeOf / provisionDecision / isSpareNumber |
| `server/__tests__/driver-line-twiml.test.ts` | Create | no-arbitrary-dial + voicemail-branch TwiML |
| `server/__tests__/driver-line-tagging.test.ts` | Create | resolveCallSource |
| `client/src/components/DriverPhoneLine.tsx` | Create | Phone Line panel + provision button |
| `client/src/pages/driver-profile.tsx` | Modify | Mount `<DriverPhoneLine>` |
| `client/src/pages/calls.tsx` | Modify | Optional `?driver=` filter |
| `.env.example` | Modify | Document `DRIVER_LINE_PROVISION_ENABLED` + `VOICE_WEBHOOK_BASE` |

---

### Task 1: Schema — `drivers.voiceNumber` + `voiceNumberSid`

**Files:** Modify `shared/schema.ts` (inside the `drivers` table, after the `phoneNumber` column ~line 163); Modify `server/ensure-schema.ts` (drivers ALTER block).

- [ ] **Step 1: Add columns to the `drivers` pgTable** in `shared/schema.ts`, right after the `phoneNumber` column:

```ts
  voiceNumber: text("voice_number").unique(),     // SP2: driver's assigned recorded company line (E.164)
  voiceNumberSid: text("voice_number_sid"),        // Twilio IncomingPhoneNumber SID, for rewire/release
```

- [ ] **Step 2: Add idempotent DDL in `server/ensure-schema.ts`** (near the other `ALTER TABLE drivers` / drivers-related blocks; if none, add a new try block):

```ts
    // SP2: per-driver recorded voice line
    try {
      await pool.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS voice_number TEXT`);
      await pool.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS voice_number_sid TEXT`);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS drivers_voice_number_unique ON drivers(voice_number) WHERE voice_number IS NOT NULL`);
    } catch (e: any) {
      log(`⚠️ drivers voice_number columns: ${e.message}`);
    }
```

- [ ] **Step 3: Verify schema-completeness test** — Run: `npx vitest run server/__tests__/schema-completeness.test.ts` — Expected: no NEW failure vs baseline (the pre-existing loads-table failure may remain). If it diffs drivers columns, reconcile names.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts server/ensure-schema.ts
git commit -m "feat(driver-lines): add drivers.voice_number + voice_number_sid"
```

---

### Task 2: Pure predicates + tests (TDD)

**Files:** Create `server/driver-line-service.ts`; Create the three test files listed above.

- [ ] **Step 1: Write `server/__tests__/driver-line-predicates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { areaCodeOf, provisionDecision, isSpareNumber } from "../driver-line-service";

describe("areaCodeOf", () => {
  it("extracts the area code from a +1 E.164 number", () => {
    expect(areaCodeOf("+12058614115")).toBe("205");
  });
  it("returns null for malformed input", () => {
    expect(areaCodeOf("")).toBeNull();
    expect(areaCodeOf("12345")).toBeNull();
    expect(areaCodeOf(undefined as any)).toBeNull();
  });
});

describe("provisionDecision", () => {
  it("reuses when a spare exists", () => {
    expect(provisionDecision({ hasSpare: true, provisionEnabled: false })).toBe("reuse");
  });
  it("buys only when no spare AND enabled", () => {
    expect(provisionDecision({ hasSpare: false, provisionEnabled: true })).toBe("buy");
  });
  it("refuses to buy when disabled and no spare", () => {
    expect(provisionDecision({ hasSpare: false, provisionEnabled: false })).toBe("buy-disabled");
  });
});

describe("isSpareNumber (never grab an SMS/main/assigned number)", () => {
  const ctx = {
    mainNumber: "+16605572729",
    assignedVoiceNumbers: new Set(["+12055550142"]),
    ourWebhookUrl: "https://traqiq.app/api/twilio/voice/driver-inbound",
  };
  it("rejects the main SMS number", () => {
    expect(isSpareNumber({ phoneNumber: "+16605572729", smsUrl: "", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects a number with an active (non-demo) sms_url", () => {
    expect(isSpareNumber({ phoneNumber: "+14235295051", smsUrl: "https://traqiq.app/api/sms/webhook", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects an already-assigned driver number", () => {
    expect(isSpareNumber({ phoneNumber: "+12055550142", smsUrl: "", voiceUrl: "" }, ctx)).toBe(false);
  });
  it("rejects a number whose voice_url points elsewhere (e.g. the SP1 main line flow)", () => {
    expect(isSpareNumber({ phoneNumber: "+18333629813", smsUrl: "", voiceUrl: "https://webhooks.twilio.com/v1/Accounts/AC/Flows/FW" }, ctx)).toBe(false);
  });
  it("accepts a genuinely idle number (no sms, demo/empty voice)", () => {
    expect(isSpareNumber({ phoneNumber: "+19045550001", smsUrl: "https://demo.twilio.com/welcome/sms/reply/", voiceUrl: "https://demo.twilio.com/welcome/voice/" }, ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Write `server/__tests__/driver-line-twiml.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildInboundTwiml, buildAfterTwiml } from "../driver-line-service";

describe("buildInboundTwiml — no arbitrary dial (regression)", () => {
  it("when no driver matches, says 'not in service' and never dials", () => {
    const x = buildInboundTwiml(undefined, "+14045558821");
    expect(x).toContain("not in service");
    expect(x).not.toContain("<Dial");
  });
  it("when a driver matches, dials the DRIVER's cell (never the called number)", () => {
    const x = buildInboundTwiml({ phone: "+12058614115" }, "+14045558821");
    expect(x).toContain("<Dial");
    expect(x).toContain("+12058614115");          // driver's cell
    expect(x).toContain('callerId="+14045558821"'); // pass the real caller through
    expect(x).toContain("record-from-answer");
    expect(x).toContain("/api/twilio/voice/driver-inbound/after");
  });
});

describe("buildAfterTwiml — voicemail only on a missed call", () => {
  it("records voicemail on no-answer/busy/failed", () => {
    for (const s of ["no-answer", "busy", "failed"]) {
      expect(buildAfterTwiml(s)).toContain("<Record");
    }
  });
  it("just hangs up when the call completed (answered)", () => {
    const x = buildAfterTwiml("completed");
    expect(x).not.toContain("<Record");
    expect(x).toContain("<Hangup");
  });
});
```

- [ ] **Step 3: Write `server/__tests__/driver-line-tagging.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveCallSource } from "../driver-line-service";

describe("resolveCallSource", () => {
  it("tags a matched driver call as twilio_driver with the driver's id + company", () => {
    expect(resolveCallSource({ id: "drv1", companyId: "comp1" }, {})).toEqual({
      source: "twilio_driver", driverId: "drv1", companyId: "comp1",
    });
  });
  it("falls back to twilio_main / nulls when no driver matched", () => {
    expect(resolveCallSource(undefined, {})).toEqual({
      source: "twilio_main", driverId: null, companyId: null,
    });
  });
  it("honors explicit job overrides when no driver matched", () => {
    expect(resolveCallSource(null, { source: "twilio_portal", driverId: "d", companyId: "c" })).toEqual({
      source: "twilio_portal", driverId: "d", companyId: "c",
    });
  });
});
```

- [ ] **Step 4: Run the three test files — verify they FAIL** — Run: `npx vitest run server/__tests__/driver-line-predicates.test.ts server/__tests__/driver-line-twiml.test.ts server/__tests__/driver-line-tagging.test.ts` — Expected: FAIL (`Cannot find module '../driver-line-service'`).

- [ ] **Step 5: Create `server/driver-line-service.ts` with the predicates**

```ts
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
```

- [ ] **Step 6: Run the three test files — verify they PASS** — Run the same command from Step 4 — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/driver-line-service.ts server/__tests__/driver-line-predicates.test.ts server/__tests__/driver-line-twiml.test.ts server/__tests__/driver-line-tagging.test.ts
git commit -m "feat(driver-lines): tested predicates — spare-safety, no-arbitrary-dial TwiML, provision decision, tagging"
```

---

### Task 3: Twilio provisioning calls

**Files:** Modify `server/driver-line-service.ts` (append).

- [ ] **Step 1: Append the Twilio API helpers + `assignLineToDriver`**

```ts
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
  const assigned = new Set(assignedRows.map((r) => r.v).filter(Boolean) as string[]);
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
```

- [ ] **Step 2: Type-check** — Run: `npx tsc --noEmit 2>&1 | grep driver-line-service` — Expected: nothing (no new errors in this file).

- [ ] **Step 3: Run the predicate tests again (still green)** — Run: `npx vitest run server/__tests__/driver-line-predicates.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/driver-line-service.ts
git commit -m "feat(driver-lines): provisioning service (reuse-then-buy, webhook wiring, double-gated)"
```

---

### Task 4: Routes — inbound webhook (public) + provision (guarded)

**Files:** Create `server/driver-line-routes.ts`; Modify `server/routes.ts`.

- [ ] **Step 1: Create `server/driver-line-routes.ts`**

```ts
import type { Express } from "express";
import twilio from "twilio";
import { db } from "./db";
import { drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { buildInboundTwiml, buildAfterTwiml, assignLineToDriver } from "./driver-line-service";

function validTwilioSig(req: any): boolean {
  if (process.env.NODE_ENV !== "production" || !process.env.TWILIO_AUTH_TOKEN) return true; // dev/test bypass
  const sig = req.headers["x-twilio-signature"] as string;
  if (!sig) return false;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body);
}

export function registerDriverLineRoutes(app: Express) {
  // PUBLIC, signature-validated — Twilio calls this when a driver number rings.
  app.post("/api/twilio/voice/driver-inbound", async (req, res) => {
    res.set("Content-Type", "text/xml");
    if (!validTwilioSig(req)) return res.status(403).send("Forbidden");
    const to = req.body?.To as string;
    const from = (req.body?.From as string) || "";
    const [driver] = to ? await db.select().from(drivers).where(eq(drivers.voiceNumber, to)).limit(1) : [undefined as any];
    return res.send(buildInboundTwiml(driver ? { phone: driver.phone } : undefined, from));
  });

  app.post("/api/twilio/voice/driver-inbound/after", async (req, res) => {
    res.set("Content-Type", "text/xml");
    if (!validTwilioSig(req)) return res.status(403).send("Forbidden");
    return res.send(buildAfterTwiml((req.body?.DialCallStatus as string) || "completed"));
  });

  // AUTH-GUARDED (sits under the /api/voice adminOrDispatcherOrApiKey prefix guard).
  app.post("/api/voice/drivers/:id/provision-line", async (req, res) => {
    try {
      const result = await assignLineToDriver(req.params.id, (req.body?.areaCode as string) || undefined);
      if (!result.ok) return res.status(result.error?.includes("disabled") ? 409 : 400).json(result);
      res.json(result);
    } catch (err: any) {
      console.error("[driver-lines] provision error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
```

- [ ] **Step 2: Register in `server/routes.ts`** — add near the other route imports (~line 52):

```ts
import { registerDriverLineRoutes } from "./driver-line-routes";
```

and call it right after `registerVoiceIntakeRoutes(app);` (which is AFTER the prefix guards at ~line 870):

```ts
  registerDriverLineRoutes(app);
```

- [ ] **Step 3: Build + run full suite** — Run: `npm run build && npx vitest run server/__tests__/` — Expected: build OK; no NEW test failures beyond the known pre-existing set.

- [ ] **Step 4: Commit**

```bash
git add server/driver-line-routes.ts server/routes.ts
git commit -m "feat(driver-lines): inbound voice webhook (public, sig-validated) + guarded provision route"
```

---

### Task 5: Poller tagging — map driver calls

**Files:** Modify `server/call-intake-service.ts`.

- [ ] **Step 1: Add `drivers` to the schema import** (top of file) — change:

```ts
import { callRecord, rateconIntake } from "@shared/schema";
```
to:
```ts
import { callRecord, rateconIntake, drivers } from "@shared/schema";
```
and add at the top (after existing imports):
```ts
import { resolveCallSource } from "./driver-line-service";
```

- [ ] **Step 2: Use the driver lookup in `processRecording`** — in `server/call-intake-service.ts`, find the block that resolves parties + inserts the row:

```ts
  const { from, to } = await resolveCallParties(job.callSid);

  const [row] = await db.insert(callRecord).values({
    companyId: job.companyId ?? null,
    source: job.source ?? "twilio_main",
    direction: job.direction ?? "inbound",
    driverId: job.driverId ?? null,
```
and replace it with (resolve the driver by the called number, then tag):

```ts
  const { from, to } = await resolveCallParties(job.callSid);

  const driver = to
    ? (await db.select({ id: drivers.id, companyId: drivers.companyId }).from(drivers).where(eq(drivers.voiceNumber, to)).limit(1))[0]
    : undefined;
  const tag = resolveCallSource(driver, job);

  const [row] = await db.insert(callRecord).values({
    companyId: tag.companyId,
    source: tag.source,
    direction: job.direction ?? "inbound",
    driverId: tag.driverId,
```

(Leave the remaining `.values({...})` fields — callSid, recordingSid, fromNumber, toNumber, durationSec, recordingUrl, legType, transcriptStatus — unchanged.)

- [ ] **Step 3: Run the call-intake + driver-line tests** — Run: `npx vitest run server/__tests__/call-intake-never-auto-dispatch.test.ts server/__tests__/driver-line-tagging.test.ts` — Expected: PASS. Then `npm run build` — Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add server/call-intake-service.ts
git commit -m "feat(driver-lines): tag driver calls (twilio_driver + driverId + company) by toNumber lookup"
```

---

### Task 6: UI — Phone Line panel + driver filter

**Files:** Create `client/src/components/DriverPhoneLine.tsx`; Modify `client/src/pages/driver-profile.tsx`; Modify `client/src/pages/calls.tsx`.

- [ ] **Step 1: Create `client/src/components/DriverPhoneLine.tsx`**

```tsx
import { useState } from "react";

export default function DriverPhoneLine({ driverId, voiceNumber, onChanged }: {
  driverId: string;
  voiceNumber: string | null;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addLine() {
    if (!confirm("Add a recorded company line for this driver?\n\nReuses a spare number you already own (free). If none is free, it buys one (~$1.15/mo) — only when number-buying is enabled.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/voice/drivers/${driverId}/provision-line`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (r.ok && j.ok) { setMsg(`Line added: ${j.phoneNumber} (${j.mode})`); onChanged?.(); }
      else setMsg(j.error || "Could not add a line.");
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="border rounded-lg p-4 mt-4">
      <h3 className="font-semibold mb-2">Phone Line</h3>
      {voiceNumber ? (
        <div>
          <div className="text-lg font-bold">{voiceNumber} <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">● Recorded</span></div>
          <div className="text-sm text-gray-500 mt-1">Forwards to the driver's cell · voicemail if missed</div>
          <a className="text-blue-600 text-sm underline" href={`/calls?driver=${driverId}`}>View this driver's calls →</a>
        </div>
      ) : (
        <div>
          <button disabled={busy} onClick={addLine} className="px-4 py-2 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">
            {busy ? "Adding…" : "＋ Add recorded line"}
          </button>
          <p className="text-xs text-gray-500 mt-2">Reuses a spare number free, or buys one (~$1.15/mo) — you confirm first.</p>
        </div>
      )}
      {msg && <p className="text-sm mt-2">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `client/src/pages/driver-profile.tsx`** — import at top:

```tsx
import DriverPhoneLine from "@/components/DriverPhoneLine";
```
and render it inside the profile body where the driver object is available (e.g. just after the contact section). Use the loaded driver + the page's refetch:

```tsx
<DriverPhoneLine driverId={driver.id} voiceNumber={(driver as any).voiceNumber ?? null} onChanged={() => refetch?.()} />
```

(If the page uses a different variable than `driver` or a different refetch mechanism, match it — render the component with the driver's id and `voiceNumber`.)

- [ ] **Step 3: Add the `?driver=` filter in `client/src/pages/calls.tsx`** — after the `useQuery` that loads calls, filter rows by the query param:

```tsx
const driverFilter = new URLSearchParams(window.location.search).get("driver");
const shown = (calls ?? []).filter((c) => !driverFilter || c.driverId === driverFilter);
```
and map over `shown` instead of `calls ?? []` in the render. (The `CallRow` type gains `driverId: string | null` — add it to the type.)

- [ ] **Step 4: Build the client** — Run: `npm run build` — Expected: succeeds; a driver-profile/calls chunk emitted.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/DriverPhoneLine.tsx client/src/pages/driver-profile.tsx client/src/pages/calls.tsx
git commit -m "feat(driver-lines): Phone Line panel on driver profile + per-driver calls filter"
```

---

### Task 7: Env docs + integration verification

**Files:** Modify `.env.example`.

- [ ] **Step 1: Document env vars in `.env.example`** (under the call-data section):

```bash
# --- Per-driver recorded lines (SP2) ---
# Allows the provisioning flow to BUY a new Twilio number when no spare is free.
# Default OFF — with it off, provisioning only reuses idle owned numbers.
DRIVER_LINE_PROVISION_ENABLED=false
# Public base URL Twilio dials back for the driver inbound webhook.
VOICE_WEBHOOK_BASE=https://traqiq.app
```

- [ ] **Step 2: Full suite + build** — Run: `npx vitest run server/__tests__/ && npm run build` — Expected: all green except the known pre-existing failures; build OK.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(driver-lines): document DRIVER_LINE_PROVISION_ENABLED + VOICE_WEBHOOK_BASE"
```

---

## Production verification (after merge + deploy)

1. On a driver's profile, click **Add recorded line**. With `DRIVER_LINE_PROVISION_ENABLED` off: if a spare exists it assigns it; else it returns the "buying disabled" message (no spend).
2. To allow buying: set `DRIVER_LINE_PROVISION_ENABLED=true` (owner-gated "ship it" — it's the paid path), then add a line → confirm a number is assigned.
3. Call the driver's company number from another phone → it greets, records, rings the driver's cell showing the caller; miss it → voicemail.
4. Within ~2 min the call appears in `/calls` tagged `twilio_driver` with the right `driverId`; a broker offer auto-surfaces to `/review-queue`.
5. Kill: clear `drivers.voice_number` (or release the number in Twilio); `DRIVER_LINE_PROVISION_ENABLED=false` halts buying.

## Self-Review (completed)

- **Spec coverage:** schema cols ✔ (T1), provisioning reuse-then-buy + double-gate ✔ (T3/T2 predicate), shared inbound webhook + no-arbitrary-dial ✔ (T4/T2), voicemail branch ✔ (T4/T2), poller tagging + companyId fix ✔ (T5/T2), UI panel + filter ✔ (T6), spare-safety excludes SMS/main ✔ (T2 `isSpareNumber` test), migrations ✔ (T1), regression tests ✔ (T2). Public-vs-guarded routing resolved (webhook under `/api/twilio/*`, provision under guarded `/api/voice/*`).
- **Placeholder scan:** none — all steps have real code/commands.
- **Type consistency:** `assignLineToDriver`, `findSpareNumber`, `provisionDecision`, `isSpareNumber`, `buildInboundTwiml`, `buildAfterTwiml`, `resolveCallSource`, `areaCodeOf`, `DRIVER_INBOUND_PATH`, `ProvisionResult` consistent across tasks and tests. `drivers.voiceNumber` (T1) used by T3/T4/T5/T6.
