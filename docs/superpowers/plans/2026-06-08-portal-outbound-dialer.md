# In-Portal Outbound Recorded Dialer (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a driver place recorded outbound calls from the TRAQ-IQ portal (Call buttons on a load + a dialpad), presenting the company `833` caller ID, flowing into the existing `/calls` layer tagged `outbound` / `twilio_portal` / driver.

**Architecture:** A vanilla-JS WebRTC softphone (Twilio Voice SDK from CDN) in the server-rendered portal gets a per-driver access token, places a call to a TwiML App handler that `<Dial>`s the destination with caller ID `833` + recording, and a recordingStatusCallback tags the recording and feeds it into the SP1 pipeline. The poller skips outbound calls so it can't mis-tag them.

**Tech Stack:** TypeScript, Express, Drizzle, `twilio` server SDK (`jwt.AccessToken`), `@twilio/voice-sdk` (browser, via CDN), Vitest.

---

## Routing & gotchas (read first)

- **Public, Twilio-signed (under `/api/twilio/*`, NOT auth-guarded):** `portal-outbound`, `portal-callee-notice`, `portal-recording`.
- **Token-gated (on the `/driver/:token` path, like the rest of the portal):** `GET /driver/:token/voice-token`.
- **TwiML MUST be sent via `res.end`, never `res.send`** — the global `/api` middleware (`server/index.ts:110`) force-sets `application/json` on `res.send`, which makes Twilio reject voice TwiML (error 12300). (This is the exact bug SP2 hit.)
- **No npm changes:** `twilio` already has `jwt.AccessToken`; the browser SDK loads from CDN.

## Financial guard (deploy + enable gate)

New paid path = outbound voice (~$0.03/min) + recording. **Default OFF** behind `PORTAL_DIALER_ENABLED`; the token endpoint returns 403 when off, so the SDK can't initialize and no call is possible. Building/merging spends nothing. Enabling requires creating the TwiML App + API key and setting env vars — an explicit owner step.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `server/portal-dialer-service.ts` | Create | Pure predicates (tested) + token minting |
| `server/portal-dialer-routes.ts` | Create | Token endpoint + outbound/notice/recording webhooks |
| `server/routes.ts` | Modify | Register portal-dialer routes |
| `server/call-intake-service.ts` | Modify | Poller skips outbound (resolveCallParties returns direction) |
| `server/driver-portal.ts` | Modify | Inject dialer JS/UI + Call buttons on load contacts |
| `server/__tests__/portal-dialer-predicates.test.ts` | Create | normalize/dialable/twiml/rate/skip predicates |
| `.env.example` | Modify | Document new env vars |

---

### Task 1: Pure predicates + tests (TDD)

**Files:** Create `server/portal-dialer-service.ts`; Create `server/__tests__/portal-dialer-predicates.test.ts`.

- [ ] **Step 1: Write `server/__tests__/portal-dialer-predicates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { normalizeNanp, isDialableDestination, buildPortalOutboundTwiml, buildCalleeNoticeTwiml, rateCheck, isPollerOutboundSkip } from "../portal-dialer-service";

describe("normalizeNanp / isDialableDestination", () => {
  it("normalizes 10-digit, 11-digit, and +1 forms", () => {
    expect(normalizeNanp("205-555-0148")).toBe("+12055550148");
    expect(normalizeNanp("12055550148")).toBe("+12055550148");
    expect(normalizeNanp("+1 (205) 555-0148")).toBe("+12055550148");
  });
  it("rejects short codes, premium, and non-NANP", () => {
    expect(normalizeNanp("411")).toBeNull();
    expect(normalizeNanp("+19005551234")).toBeNull();   // 900 premium
    expect(normalizeNanp("+449005551234")).toBeNull();  // non-NANP
    expect(normalizeNanp("")).toBeNull();
  });
  it("isDialableDestination mirrors normalizeNanp", () => {
    expect(isDialableDestination("205-555-0148")).toBe(true);
    expect(isDialableDestination("411")).toBe(false);
  });
});

describe("buildPortalOutboundTwiml", () => {
  it("always sets the company caller ID and records", () => {
    const x = buildPortalOutboundTwiml({ to: "+12055550148", callerId: "+18333629813", recordingCallbackUrl: "https://x/cb", noticeUrl: "https://x/notice" });
    expect(x).toContain('callerId="+18333629813"');
    expect(x).toContain('record="record-from-answer"');
    expect(x).toContain('recordingStatusCallback="https://x/cb"');
    expect(x).toContain('url="https://x/notice"');     // notice played to callee
    expect(x).toContain("+12055550148");
  });
  it("omits the callee notice when noticeUrl is absent", () => {
    const x = buildPortalOutboundTwiml({ to: "+12055550148", callerId: "+18333629813", recordingCallbackUrl: "https://x/cb" });
    expect(x).not.toContain("url=");
  });
});

describe("buildCalleeNoticeTwiml", () => {
  it("announces recording", () => {
    expect(buildCalleeNoticeTwiml()).toContain("recorded");
  });
});

describe("rateCheck (per-driver hourly ceiling)", () => {
  it("allows up to max within the last hour, then blocks", () => {
    const now = 1_000_000_000_000;
    let times: number[] = [];
    for (let i = 0; i < 20; i++) { const r = rateCheck(times, now, 20); expect(r.ok).toBe(true); times = r.next; }
    expect(rateCheck(times, now, 20).ok).toBe(false);
  });
  it("forgets calls older than an hour", () => {
    const now = 1_000_000_000_000;
    const old = [now - 3_600_001];
    expect(rateCheck(old, now, 1).ok).toBe(true);
  });
});

describe("isPollerOutboundSkip", () => {
  it("skips outbound only on the poller path (job.direction undefined)", () => {
    expect(isPollerOutboundSkip(undefined, "outbound-api")).toBe(true);
    expect(isPollerOutboundSkip(undefined, "outbound-dial")).toBe(true);
    expect(isPollerOutboundSkip(undefined, "inbound")).toBe(false);
    expect(isPollerOutboundSkip("outbound", "outbound-api")).toBe(false); // callback path proceeds
  });
});
```

- [ ] **Step 2: Run it — verify it FAILS** — Run: `npx vitest run server/__tests__/portal-dialer-predicates.test.ts` — Expected: FAIL (`Cannot find module '../portal-dialer-service'`).

- [ ] **Step 3: Create `server/portal-dialer-service.ts`**

```ts
// Pure, unit-tested predicates for SP3. Token minting is added in Task 2.

export function normalizeNanp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  d = d.startsWith("+") ? d.slice(1) : d;
  if (d.length === 10) d = "1" + d;
  if (d.length !== 11 || !d.startsWith("1")) return null;
  const area = d.slice(1, 4);
  if (!/^[2-9]\d\d$/.test(area)) return null;
  if (area === "900" || area === "976") return null; // premium
  return "+" + d;
}

export function isDialableDestination(raw: string | null | undefined): boolean {
  return normalizeNanp(raw) !== null;
}

export function buildPortalOutboundTwiml(args: { to: string; callerId: string; recordingCallbackUrl: string; noticeUrl?: string }): string {
  const numUrl = args.noticeUrl ? ` url="${args.noticeUrl}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial callerId="${args.callerId}" record="record-from-answer" answerOnBridge="true"` +
    ` recordingStatusCallback="${args.recordingCallbackUrl}" recordingStatusCallbackEvent="completed">` +
    `<Number${numUrl}>${args.to}</Number></Dial></Response>`;
}

export function buildCalleeNoticeTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say voice="Polly.Joanna">This call is recorded for quality and training purposes.</Say></Response>`;
}

// Per-driver hourly rate ceiling — pure core (state wrapper added below).
export function rateCheck(times: number[], now: number, max: number): { ok: boolean; next: number[] } {
  const recent = times.filter((t) => t > now - 3_600_000);
  if (recent.length >= max) return { ok: false, next: recent };
  return { ok: true, next: [...recent, now] };
}

const _callTimes = new Map<string, number[]>();
export function withinDriverCallCeiling(driverId: string, max = Number(process.env.PORTAL_DIALER_MAX_PER_HOUR) || 20, now = Date.now()): boolean {
  const r = rateCheck(_callTimes.get(driverId) || [], now, max);
  _callTimes.set(driverId, r.next);
  return r.ok;
}

// Poller must skip OUTBOUND recordings (owned by the recordingStatusCallback,
// which passes job.direction explicitly). When job.direction is undefined (the
// poller path) and the call is outbound, skip it.
export function isPollerOutboundSkip(jobDirection: string | undefined, callDirection: string | null | undefined): boolean {
  return jobDirection === undefined && !!callDirection && callDirection.startsWith("outbound");
}
```

- [ ] **Step 4: Run it — verify it PASSES** — Run: `npx vitest run server/__tests__/portal-dialer-predicates.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/portal-dialer-service.ts server/__tests__/portal-dialer-predicates.test.ts
git commit -m "feat(portal-dialer): tested predicates — NANP normalize, outbound TwiML, rate ceiling, poller-skip"
```

---

### Task 2: Voice access-token minting

**Files:** Modify `server/portal-dialer-service.ts` (append).

- [ ] **Step 1: Append `mintVoiceToken`**

```ts
import twilio from "twilio";

// Mints a short-TTL Twilio Voice access token scoped to a driver. The identity
// is server-set (driver-<id>), never client-supplied. outgoingApplicationSid
// points the SDK at our portal-outbound TwiML handler.
export function mintVoiceToken(driver: { id: string }): { token: string; identity: string } {
  const AccessToken = (twilio as any).jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const identity = `driver-${driver.id}`;
  const at = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID as string,
    process.env.TWILIO_API_KEY as string,
    process.env.TWILIO_API_SECRET as string,
    { identity, ttl: 3600 },
  );
  at.addGrant(new VoiceGrant({ outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID, incomingAllow: false }));
  return { token: at.toJwt(), identity };
}
```

- [ ] **Step 2: Type-check** — Run: `npx tsc --noEmit 2>&1 | grep portal-dialer-service` — Expected: nothing.

- [ ] **Step 3: Commit**

```bash
git add server/portal-dialer-service.ts
git commit -m "feat(portal-dialer): mint per-driver Twilio Voice access token"
```

---

### Task 3: Routes — token endpoint + Twilio webhooks

**Files:** Create `server/portal-dialer-routes.ts`; Modify `server/routes.ts`.

- [ ] **Step 1: Create `server/portal-dialer-routes.ts`**

```ts
import type { Express } from "express";
import twilio from "twilio";
import { db } from "./db";
import { drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { driverFromToken } from "./driver-portal";
import { mintVoiceToken, normalizeNanp, buildPortalOutboundTwiml, buildCalleeNoticeTwiml, withinDriverCallCeiling } from "./portal-dialer-service";
import { processRecording } from "./call-intake-service";

const CALLER_ID = process.env.PORTAL_CALLER_ID || "+18333629813";
const dialerEnabled = () => process.env.PORTAL_DIALER_ENABLED === "true";

function validTwilioSig(req: any): boolean {
  if (process.env.NODE_ENV !== "production" || !process.env.TWILIO_AUTH_TOKEN) return true; // dev/test bypass
  const sig = req.headers["x-twilio-signature"] as string;
  if (!sig) return false;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body);
}

// TwiML must go through res.end — res.send is force-jsoned by the global /api middleware.
function sendTwiml(res: any, xml: string): void { res.status(200); res.setHeader("Content-Type", "text/xml"); res.end(xml); }
const HANGUP = (msg: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${msg}</Say><Hangup/></Response>`;

export function registerPortalDialerRoutes(app: Express) {
  // Token-gated: mint a Voice access token for the driver behind this portal token.
  app.get("/driver/:token/voice-token", async (req, res) => {
    if (!dialerEnabled()) return res.status(403).json({ error: "dialer disabled" });
    const driver = await driverFromToken(req.params.token);
    if (!driver) return res.status(404).json({ error: "invalid token" });
    res.json(mintVoiceToken({ id: driver.id }));
  });

  // TwiML App Voice URL — places the outbound leg.
  app.post("/api/twilio/voice/portal-outbound", async (req, res) => {
    if (!validTwilioSig(req)) return res.status(403).send("Forbidden");
    const driverId = (req.body?.driverId as string) || "";
    const to = normalizeNanp(req.body?.To as string);
    if (!to) return sendTwiml(res, HANGUP("Sorry, that number can not be dialed."));
    if (driverId && !withinDriverCallCeiling(driverId)) return sendTwiml(res, HANGUP("Call limit reached. Please try again later."));
    const base = `${req.protocol}://${req.get("host")}`;
    const recCb = `${base}/api/twilio/voice/portal-recording?driverId=${encodeURIComponent(driverId)}`;
    const noticeUrl = process.env.PORTAL_DIALER_RECORDING_NOTICE === "false" ? undefined : `${base}/api/twilio/voice/portal-callee-notice`;
    return sendTwiml(res, buildPortalOutboundTwiml({ to, callerId: CALLER_ID, recordingCallbackUrl: recCb, noticeUrl }));
  });

  // Plays the recorded-line notice to the CALLED party before bridging.
  app.post("/api/twilio/voice/portal-callee-notice", async (req, res) => {
    if (!validTwilioSig(req)) return res.status(403).send("Forbidden");
    return sendTwiml(res, buildCalleeNoticeTwiml());
  });

  // recordingStatusCallback — attribute + feed into the call-data pipeline.
  app.post("/api/twilio/voice/portal-recording", async (req, res) => {
    if (!validTwilioSig(req)) return res.status(403).send("Forbidden");
    res.status(200).end(); // ack immediately; process async
    try {
      const driverId = (req.query?.driverId as string) || (req.body?.driverId as string) || null;
      const recordingSid = req.body?.RecordingSid as string;
      const recordingUrl = req.body?.RecordingUrl as string;
      const callSid = req.body?.CallSid as string;
      const dur = Number(req.body?.RecordingDuration) || 0;
      if (!recordingSid || !recordingUrl) return;
      let companyId: string | null = null;
      if (driverId) {
        const [d] = await db.select({ c: drivers.companyId }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
        companyId = d?.c ?? null;
      }
      await processRecording({ recordingSid, recordingUrl, callSid, durationSec: dur, legType: "call", source: "twilio_portal", direction: "outbound", driverId, companyId });
    } catch (e: any) {
      console.error("[portal-dialer] recording cb failed:", e.message);
    }
  });
}
```

- [ ] **Step 2: Register in `server/routes.ts`** — import near line 52:
```ts
import { registerPortalDialerRoutes } from "./portal-dialer-routes";
```
and call after `registerDriverLineRoutes(app);` (~line 875):
```ts
  registerPortalDialerRoutes(app);
```

- [ ] **Step 3: Build + suite** — Run: `npm run build && npx vitest run server/__tests__/` — Expected: build OK; no new failures beyond the known pre-existing set. Also `npx tsc --noEmit 2>&1 | grep portal-dialer-routes` → nothing.

- [ ] **Step 4: Commit**

```bash
git add server/portal-dialer-routes.ts server/routes.ts
git commit -m "feat(portal-dialer): voice-token endpoint + outbound/notice/recording webhooks (default-off, res.end TwiML)"
```

---

### Task 4: Poller skips outbound

**Files:** Modify `server/call-intake-service.ts`.

- [ ] **Step 1: Make `resolveCallParties` return the call direction** — change its return type + body:

```ts
async function resolveCallParties(callSid: string): Promise<{ from: string | null; to: string | null; direction: string | null }> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
    const r = await fetch(url, { headers: { Authorization: twilioBasicAuthHeader() } });
    if (!r.ok) return { from: null, to: null, direction: null };
    const j: any = await r.json();
    return { from: j.from ?? null, to: j.to ?? null, direction: j.direction ?? null };
  } catch { return { from: null, to: null, direction: null }; }
}
```

- [ ] **Step 2: Skip outbound on the poller path in `processRecording`** — add the import at the top:
```ts
import { isPollerOutboundSkip } from "./portal-dialer-service";
```
and in `processRecording`, change the resolve line + add the skip, right after the dedup check:
```ts
  const { from, to, direction: callDir } = await resolveCallParties(job.callSid);

  // Outbound portal calls are owned by the recordingStatusCallback (it passes
  // job.direction explicitly). When the poller (job.direction undefined) hits an
  // outbound call, skip — the callback handles attribution. (test: isPollerOutboundSkip)
  if (isPollerOutboundSkip(job.direction, callDir)) {
    console.log(`[call-intake] skip-outbound (poller) ${job.recordingSid}`);
    return;
  }
```
(Keep the rest of `processRecording` — the driver lookup, insert, etc. — unchanged. Note: the driver-by-`to` lookup below still runs for inbound, harmless for the callback's outbound path since the callback passes driverId.)

- [ ] **Step 3: Tests + build** — Run: `npx vitest run server/__tests__/portal-dialer-predicates.test.ts server/__tests__/call-intake-never-auto-dispatch.test.ts && npm run build` — Expected: PASS / OK. `npx tsc --noEmit 2>&1 | grep call-intake-service` → nothing new.

- [ ] **Step 4: Commit**

```bash
git add server/call-intake-service.ts
git commit -m "feat(portal-dialer): poller skips outbound calls (owned by the recording callback)"
```

---

### Task 5: Dialer UI in the portal

**Files:** Modify `server/driver-portal.ts`.

- [ ] **Step 1: Add a `dialerWidget(token)` function** in `server/driver-portal.ts` (near the other render helpers) that returns the SDK script + dialer markup + JS. It exposes `window.lampCall(number, label)`.

```ts
export function dialerWidget(token: string): string {
  return `
<link rel="stylesheet" href="data:text/css,">
<style>
  #lampDial{position:fixed;right:16px;bottom:16px;z-index:9000}
  #lampFab{width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:none;font-size:24px;box-shadow:0 6px 16px rgba(37,99,235,.5)}
  #lampPad,#lampCallUI{position:fixed;inset:0;background:#0b1220;color:#e2e8f0;z-index:9001;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif}
  #lampPadNum{font-size:30px;font-weight:700;min-height:40px;margin:10px}
  .lampKeys{display:grid;grid-template-columns:repeat(3,72px);gap:14px}
  .lampKey{height:62px;border-radius:50%;background:#111a2e;border:1px solid #1e2c47;color:#e2e8f0;font-size:22px}
  .lampGreen{width:64px;height:64px;border-radius:50%;background:#16a34a;border:none;color:#fff;font-size:26px;margin-top:16px}
  .lampRed{width:64px;height:64px;border-radius:50%;background:#dc2626;border:none;color:#fff;font-size:26px}
  #lampClose{position:absolute;top:18px;right:20px;background:none;border:none;color:#94a3b8;font-size:26px}
  .lampRec{background:#7f1d1d;color:#fecaca;font-size:11px;font-weight:700;padding:4px 11px;border-radius:999px}
  .lampCallee{font-size:23px;font-weight:800;margin:18px 0 4px}
  .lampVia{font-size:12px;color:#7c8aa5}
  .lampTimer{font-size:16px;margin:14px 0 26px;font-variant-numeric:tabular-nums}
</style>
<div id="lampDial"><button id="lampFab" onclick="lampOpenPad()">⌨</button></div>
<div id="lampPad">
  <button id="lampClose" onclick="lampHide()">×</button>
  <div id="lampPadNum"></div>
  <div class="lampKeys">
    ${"123456789*0#".split("").map((k)=>`<button class="lampKey" onclick="lampPadPress('${k}')">${k}</button>`).join("")}
  </div>
  <button class="lampGreen" onclick="lampDialPad()">📞</button>
</div>
<div id="lampCallUI">
  <span class="lampRec">● REC</span>
  <div class="lampCallee" id="lampCallee">—</div>
  <div class="lampVia">via your company line · 833-362-9813</div>
  <div class="lampTimer" id="lampTimer">00:00</div>
  <button class="lampRed" onclick="lampHangup()">📞</button>
</div>
<script src="https://sdk.twilio.com/js/voice/releases/2.12.3/twilio.min.js"></script>
<script>
(function(){
  var device=null, conn=null, t0=0, tick=null, padNum="";
  var TOKEN_URL="/driver/${token}/voice-token", DRIVER_ID="";
  async function ensureDevice(){
    if(device) return device;
    var r=await fetch(TOKEN_URL); if(!r.ok){ alert("Calling is not enabled."); throw new Error("disabled"); }
    var j=await r.json(); DRIVER_ID=(j.identity||"").replace("driver-","");
    device=new Twilio.Device(j.token,{codecPreferences:["opus","pcmu"]});
    return device;
  }
  function show(id){ document.getElementById(id).style.display="flex"; }
  function hideAll(){ ["lampPad","lampCallUI"].forEach(function(i){document.getElementById(i).style.display="none";}); }
  window.lampHide=hideAll;
  window.lampOpenPad=function(){ padNum=""; document.getElementById("lampPadNum").textContent=""; show("lampPad"); };
  window.lampPadPress=function(k){ padNum+=k; document.getElementById("lampPadNum").textContent=padNum; };
  window.lampDialPad=function(){ if(padNum) window.lampCall(padNum, padNum); };
  function fmt(s){ var m=Math.floor(s/60),x=s%60; return (m<10?"0":"")+m+":"+(x<10?"0":"")+x; }
  window.lampCall=async function(number,label){
    try{
      var d=await ensureDevice();
      conn=await d.connect({ params:{ To:number, driverId:DRIVER_ID } });
      document.getElementById("lampCallee").textContent=label||number;
      document.getElementById("lampTimer").textContent="00:00"; hideAll(); show("lampCallUI");
      t0=Date.now(); tick=setInterval(function(){ document.getElementById("lampTimer").textContent=fmt(Math.floor((Date.now()-t0)/1000)); },1000);
      conn.on("disconnect",function(){ clearInterval(tick); hideAll(); });
    }catch(e){ console.error(e); }
  };
  window.lampHangup=function(){ if(conn) conn.disconnect(); clearInterval(tick); hideAll(); };
})();
</script>`;
}
```

- [ ] **Step 2: Inject the widget into portal pages.** Find each render function's closing `</body>` (or the returned HTML tail) in `server/driver-portal.ts` and insert `${dialerWidget(token)}` before it. At minimum the **load detail** render and the **home** render. (Each render already has the driver `token` in scope.)

- [ ] **Step 3: Turn the broker phone into a Call button** in the load-detail render. Find the `brokerPhone` line (the `<a href="tel:...">` near line 612-651) and replace it with a Call button:
```ts
${load.brokerPhone ? `<div class="row"><span class="muted">Broker</span><button onclick="lampCall('${escapeHtml(load.brokerPhone)}','${escapeHtml(load.brokerName||"Broker")}')" style="background:#16a34a;color:#fff;border:none;border-radius:999px;padding:6px 13px;font-weight:700">📞 Call</button></div>` : ""}
```

- [ ] **Step 4: Build the client + server** — Run: `npm run build` — Expected: succeeds. (The widget is server-rendered string injection — no client bundle change.)

- [ ] **Step 5: Commit**

```bash
git add server/driver-portal.ts
git commit -m "feat(portal-dialer): in-portal WebRTC dialer UI (Call buttons + dialpad + in-call overlay)"
```

---

### Task 6: Env docs

**Files:** Modify `.env.example`.

- [ ] **Step 1: Document the env vars** (under the SP2 block):

```bash
# --- In-portal outbound dialer (SP3) ---
# Master switch. Default OFF — the voice-token endpoint refuses when off, so the
# dialer can't initialize and no outbound call is possible.
PORTAL_DIALER_ENABLED=false
# Created in Twilio (see the enablement steps): a TwiML App + a standalone API key.
TWILIO_TWIML_APP_SID=AP...
TWILIO_API_KEY=SK...
TWILIO_API_SECRET=...
# Caller ID for all outbound driver calls (the company toll-free). Optional; defaults to +18333629813.
PORTAL_CALLER_ID=+18333629813
# Play a "this call is recorded" notice to the called party. Default on.
PORTAL_DIALER_RECORDING_NOTICE=true
# Per-driver hourly call ceiling (abuse/runaway guard). Default 20.
PORTAL_DIALER_MAX_PER_HOUR=20
```

- [ ] **Step 2: Full suite + build** — Run: `npx vitest run server/__tests__/ && npm run build` — Expected: green (minus known pre-existing failures), build OK.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(portal-dialer): document SP3 env vars"
```

---

## Production enablement (SEPARATE, owner-gated — NOT part of merge)

After merge + deploy, to turn it on (this is the OpenAI/voice spend gate):
1. **Create a TwiML App** pointing at the outbound handler:
   `curl -u $SID:$TOK -X POST https://api.twilio.com/2010-04-01/Accounts/$SID/Applications.json --data-urlencode "FriendlyName=LAMP Portal Dialer" --data-urlencode "VoiceUrl=https://traqiq.app/api/twilio/voice/portal-outbound" --data-urlencode "VoiceMethod=POST"` → save the `sid` (AP…) as `TWILIO_TWIML_APP_SID`.
2. **Create a standalone API key:**
   `curl -u $SID:$TOK -X POST https://api.twilio.com/2010-04-01/Accounts/$SID/Keys.json --data-urlencode "FriendlyName=LAMP Portal Dialer"` → save `sid` (SK…) as `TWILIO_API_KEY` and `secret` as `TWILIO_API_SECRET` (the secret is shown ONCE).
3. Set those three + `PORTAL_DIALER_ENABLED=true` in Railway.
4. Open the driver portal on a phone, grant mic, tap Call on a load → connects, called party hears the notice, caller ID shows 833.
5. Within ~2 min the call appears in `/calls` tagged outbound/twilio_portal/driver.
6. Kill switch: `PORTAL_DIALER_ENABLED=false`.

## Self-Review (completed)

- **Spec coverage:** access-token endpoint ✔ (T2/T3), outbound TwiML handler + caller-ID 833 + record ✔ (T1/T3), callee notice ✔ (T1/T3), recording callback attribution ✔ (T3), poller skip-outbound ✔ (T1/T4), dialer UI Call buttons + dialpad + overlay ✔ (T5), gating/rate/destination guards ✔ (T1/T3), TwiML App + keys ✔ (enablement), env docs ✔ (T6), res.end TwiML ✔ (T3, carries SP2 fix), no schema change ✔.
- **Placeholder scan:** none — all steps have real code/commands.
- **Type consistency:** `normalizeNanp`/`isDialableDestination`/`buildPortalOutboundTwiml`/`buildCalleeNoticeTwiml`/`rateCheck`/`withinDriverCallCeiling`/`isPollerOutboundSkip`/`mintVoiceToken` consistent across tasks + tests; `resolveCallParties` return shape updated in T4 and its new `direction` field consumed there; `processRecording`'s existing `RecordingJob` (source/direction/driverId/companyId) used by T3's callback.
