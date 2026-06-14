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

  // Dial-out bridge (reliable, no WebRTC): rings the driver's OWN cell from the
  // company line, and when they answer, bridges them to the destination — recorded,
  // company caller ID — via the same buildPortalOutboundTwiml + recording callback.
  // Token-gated; no browser mic needed, so it works on every phone.
  app.post("/driver/:token/bridge-call", async (req, res) => {
    if (!dialerEnabled()) return res.status(403).json({ error: "dialer disabled" });
    const driver = await driverFromToken(req.params.token);
    if (!driver) return res.status(404).json({ error: "invalid token" });
    if (!driver.phone) return res.status(400).json({ error: "no driver phone on file" });
    const to = normalizeNanp(req.body?.to);
    if (!to) return res.status(400).json({ error: "that number can not be dialed" });
    if (!withinDriverCallCeiling(driver.id)) return res.status(429).json({ error: "call limit reached, try again later" });
    try {
      const base = `${req.protocol}://${req.get("host")}`;
      const recCb = `${base}/api/twilio/voice/portal-recording?driverId=${encodeURIComponent(driver.id)}`;
      const noticeUrl = process.env.PORTAL_DIALER_RECORDING_NOTICE === "false" ? undefined : `${base}/api/twilio/voice/portal-callee-notice`;
      const twiml = buildPortalOutboundTwiml({ to, callerId: CALLER_ID, recordingCallbackUrl: recCb, noticeUrl });
      const sid = process.env.TWILIO_ACCOUNT_SID as string;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: driver.phone, From: CALLER_ID, Twiml: twiml }),
      });
      if (!r.ok) { console.error("[portal-bridge] create failed", r.status, await r.text()); return res.status(502).json({ error: "could not place the call" }); }
      const j: any = await r.json();
      res.json({ ok: true, callSid: j.sid, ringingLast4: (driver.phone || "").slice(-4) });
    } catch (e: any) {
      console.error("[portal-bridge]", e.message);
      res.status(500).json({ error: e.message });
    }
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
