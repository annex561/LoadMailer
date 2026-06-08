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
