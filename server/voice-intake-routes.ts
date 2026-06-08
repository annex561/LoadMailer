import type { Express } from "express";
import { db } from "./db";
import { callRecord, rateconIntake } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { buildCallIntakeRow, type CallClassification } from "./call-intake-service";

export function registerVoiceIntakeRoutes(app: Express) {
  // List recent calls for the /calls page
  app.get("/api/voice/calls", async (_req, res) => {
    try {
      const rows = await db.select().from(callRecord).orderBy(desc(callRecord.createdAt)).limit(200);
      res.json(rows);
    } catch (err: any) {
      console.error("[voice-calls]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Auth-proxied recording playback — keeps the Twilio token server-side
  app.get("/api/voice/recording/:recordingSid/audio", async (req, res) => {
    try {
      const sid = req.params.recordingSid;
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
      const upstream = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!upstream.ok) return res.status(upstream.status).send("recording unavailable");
      res.setHeader("Content-Type", "audio/mpeg");
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err: any) {
      console.error("[voice-audio]", err);
      res.status(500).send("error");
    }
  });

  // Manual convert-to-load
  app.post("/api/voice/calls/:id/convert", async (req, res) => {
    try {
      const [row] = await db.select().from(callRecord).where(eq(callRecord.id, req.params.id)).limit(1);
      if (!row) return res.status(404).json({ error: "not found" });
      const classification = (row.aiClassification as CallClassification) ?? { category: "other", isLoadOffer: true, confidence: 1 };
      const intakeRow = buildCallIntakeRow({ companyId: row.companyId, callRecordId: row.id, classification });
      const [intake] = await db.insert(rateconIntake).values(intakeRow).returning();
      await db.update(callRecord).set({ linkedIntakeId: intake.id, updatedAt: new Date() }).where(eq(callRecord.id, row.id));
      res.json({ intakeId: intake.id });
    } catch (err: any) {
      console.error("[voice-convert]", err);
      res.status(500).json({ error: err.message });
    }
  });
}
