/**
 * Love's Financial — factoring submission service.
 *
 * Phase 1: manual click-to-submit only. Auto-submit on DELIVERED is intentionally
 * NOT implemented in this PR — the dispatcher reviews each packet before it goes.
 *
 * Required env vars:
 *   LOVES_FACTORING_ENABLED=true   — module-level kill switch (default off)
 *   FACTORING_DISABLED=true        — emergency halt for ALL outbound factoring email
 *   SMTP_USER / SMTP_PASS          — Gmail SMTP for outbound email (already wired)
 *
 * See docs/factoring/loves-financial.md for the full spec.
 */

import nodemailer from "nodemailer";
import { db } from "./db";
import { loads, factoringSubmissions, rateconIntake } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateBillOfSale, generateInvoice, mergePacketPdfs, LAMP } from "./factoring-pdf-templates";

const SCHEDULES_LS = "schedulesLS@loves.com";

// Hard rate ceiling — defense in depth. If the per-process counter exceeds
// this in an hour, we halt and log loudly. Stops a runaway loop from emailing
// Love's a thousand packets in a runaway scenario.
const MAX_SUBMISSIONS_PER_HOUR = 20;
const submissionTimestamps: number[] = [];

function isModuleEnabled(): { ok: boolean; reason?: string } {
  if (process.env.FACTORING_DISABLED === "true") {
    return { ok: false, reason: "FACTORING_DISABLED=true (emergency kill switch)" };
  }
  if (process.env.LOVES_FACTORING_ENABLED !== "true") {
    return { ok: false, reason: "LOVES_FACTORING_ENABLED is not set to true (module disabled by default)" };
  }
  return { ok: true };
}

function rateCheck(): { ok: boolean; reason?: string } {
  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  while (submissionTimestamps.length && submissionTimestamps[0] < oneHourAgo) {
    submissionTimestamps.shift();
  }
  if (submissionTimestamps.length >= MAX_SUBMISSIONS_PER_HOUR) {
    return {
      ok: false,
      reason: `Rate ceiling hit: ${submissionTimestamps.length}/${MAX_SUBMISSIONS_PER_HOUR} submissions in the last hour`,
    };
  }
  return { ok: true };
}

const factoringMailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "",
  },
});

interface PacketResult {
  ok: boolean;
  error?: string;
  loadId: string;
  pdfBytes?: Uint8Array;
  warnings: string[];
}

/**
 * Build the merged factoring packet for one load. Returns the PDF bytes plus
 * a warnings list (e.g. "no signed BOL on file"). Caller decides whether to
 * proceed with submission given the warnings.
 *
 * Document order per Love's spec:
 *   1. Bill of Sale (signed)
 *   2. Invoice
 *   3. Rate Confirmation
 *   4. BOL / POD
 *   (5. accompanying pages — TODO phase 2)
 *   (6. accessorials / lumper receipts — TODO phase 2)
 */
export async function buildFactoringPacket(loadId: string): Promise<PacketResult> {
  const warnings: string[] = [];
  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load) return { ok: false, error: "Load not found", loadId, warnings };

  if (!load.rate || load.rate <= 0) {
    return { ok: false, error: "Load has no rate — cannot factor", loadId, warnings };
  }

  // Generate Bill of Sale + Invoice
  const loadInputs = {
    loadNumber: load.loadNumber,
    brokerName: load.brokerName,
    brokerMc: null,
    pickupAddress: load.pickupAddress,
    pickupCity: load.originCity,
    pickupState: load.originState,
    pickupDate: load.pickupDate,
    deliveryAddress: load.deliveryAddress,
    deliveryCity: load.destCity,
    deliveryState: load.destState,
    deliveryDate: load.deliveryDate,
    rate: Number(load.rate),
    loadId: load.id,
  };

  const billOfSale = await generateBillOfSale(loadInputs);
  const invoice = await generateInvoice(loadInputs);

  const parts: Array<{ label: string; bytes: Uint8Array | Buffer; kind: "pdf" | "image" }> = [
    { label: "Bill of Sale", bytes: billOfSale, kind: "pdf" },
    { label: "Invoice", bytes: invoice, kind: "pdf" },
  ];

  // ---- Resolve Rate Confirmation source ----
  // Primary source: load.rateconPath. Two complications we handle:
  //  1. Legacy BOL bug (PR #67) overwrote rateconPath with a JPG/PNG photo.
  //     If we detect rateconPath is an image (not a PDF), we treat it as
  //     the BOL fallback and pull the original RateCon from rateconIntake
  //     instead.
  //  2. Some loads were dispatched before rateconPath was wired through —
  //     fall back to rateconIntake.pdfPath via the load_id linkage.
  let rateconBytes: Buffer | null = null;
  let rateconIsLegacyBolImage = false;

  if (load.rateconPath) {
    try {
      const buf = await loadFromObjectStorage(load.rateconPath);
      const isPdf = buf.length >= 4 && buf.subarray(0, 4).toString() === "%PDF";
      if (isPdf) {
        rateconBytes = buf;
        console.log(`[factoring] RateCon loaded from load.rateconPath (PDF, ${buf.length} bytes)`);
      } else {
        // Legacy bug: an image landed here. Use it as BOL fallback later.
        rateconIsLegacyBolImage = true;
        console.log(`[factoring] load.rateconPath is an image — legacy BOL overwrite detected; will use as BOL fallback`);
      }
    } catch (err: any) {
      warnings.push(`Could not load load.rateconPath: ${err.message}`);
    }
  }

  // Fall back to the intake row when rateconPath was missing or was the
  // legacy-bug image. The intake's pdfPath is the original parser-extracted
  // PDF and is the authoritative RateCon source.
  if (!rateconBytes) {
    try {
      const [intake] = await db
        .select()
        .from(rateconIntake)
        .where(eq(rateconIntake.loadId, loadId))
        .limit(1);
      if (intake?.pdfPath) {
        const buf = await loadFromObjectStorage(intake.pdfPath);
        const isPdf = buf.length >= 4 && buf.subarray(0, 4).toString() === "%PDF";
        if (isPdf) {
          rateconBytes = buf;
          console.log(`[factoring] RateCon loaded from rateconIntake.pdfPath (PDF, ${buf.length} bytes)`);
        }
      }
    } catch (err: any) {
      console.error(`[factoring] intake fallback failed: ${err.message}`);
    }
  }

  if (rateconBytes) {
    parts.push({ label: "Rate Confirmation", bytes: rateconBytes, kind: "pdf" });
  } else {
    warnings.push("No Rate Confirmation PDF found on this load (checked load.rateconPath and rateconIntake.pdfPath)");
  }

  // ---- Resolve BOL/POD source ----
  // Primary: load.bolPath (new field from this PR)
  // Fallback 1: load.podPath (older code path)
  // Fallback 2: load.rateconPath IF it's actually an image (legacy bug data)
  let bolPathToUse: string | null = null;
  let bolSource = "";
  if (load.bolPath) {
    bolPathToUse = load.bolPath;
    bolSource = "load.bolPath";
  } else if (load.podPath) {
    bolPathToUse = load.podPath;
    bolSource = "load.podPath";
  } else if (rateconIsLegacyBolImage && load.rateconPath) {
    bolPathToUse = load.rateconPath;
    bolSource = "load.rateconPath (legacy BOL overwrite)";
  }

  if (bolPathToUse) {
    try {
      const buf = await loadFromObjectStorage(bolPathToUse);
      const isPdf = buf.length >= 4 && buf.subarray(0, 4).toString() === "%PDF";
      parts.push({
        label: "BOL / POD",
        bytes: buf,
        kind: isPdf ? "pdf" : "image",
      });
      console.log(`[factoring] BOL loaded from ${bolSource} (${isPdf ? "PDF" : "image"}, ${buf.length} bytes)`);
    } catch (err: any) {
      warnings.push(`Could not load BOL/POD from ${bolSource}: ${err.message}`);
    }
  } else {
    warnings.push("No signed BOL on file — driver hasn't sent it via SMS yet");
  }

  // Sanity check: the bare minimum for a valid Love's packet is Bill of
  // Sale + Invoice + RateCon + BOL = 4 docs. If we don't have at least
  // 3, refuse — Love's will reject the packet anyway.
  const hasRatecon = !!rateconBytes;
  const hasBol = !!bolPathToUse;
  if (!hasRatecon || !hasBol) {
    const missing: string[] = [];
    if (!hasRatecon) missing.push("Rate Confirmation");
    if (!hasBol) missing.push("BOL/POD");
    return {
      ok: false,
      error: `Cannot build packet — missing: ${missing.join(", ")}`,
      loadId,
      warnings,
    };
  }

  const pdfBytes = await mergePacketPdfs(parts);
  console.log(`[factoring] packet built for load ${load.loadNumber}: ${parts.length} parts, ${pdfBytes.length} bytes`);
  return { ok: true, loadId, pdfBytes, warnings };
}

/**
 * Load a file (PDF or image) from wherever it's stored. Supports:
 *   - http(s):// URLs (Twilio MMS media URLs land here)
 *   - /objects/... paths (the existing ObjectStorageService convention)
 *   - local filesystem paths
 */
async function loadFromObjectStorage(pathOrUrl: string): Promise<Buffer> {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    const resp = await fetch(pathOrUrl);
    if (!resp.ok) throw new Error(`Fetch failed: HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  if (pathOrUrl.startsWith("/objects/")) {
    const { ObjectStorageService } = await import("./objectStorage");
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(pathOrUrl);
    const [buf] = await file.download();
    return buf;
  }
  // Local path (or anything else — try fs)
  const fs = await import("fs/promises");
  return await fs.readFile(pathOrUrl);
}

interface SubmitResult {
  ok: boolean;
  error?: string;
  submissionId?: string;
  emailMessageId?: string;
  blocked?: string; // populated when refused due to env / rate / dedup
}

/**
 * Submit a factoring packet to Love's via SMTP. Idempotent on load_id —
 * the unique constraint on factoring_submissions.load_id rejects double sends.
 *
 * NEVER sends without LOVES_FACTORING_ENABLED=true.
 * NEVER sends if FACTORING_DISABLED=true (kill switch).
 */
export async function submitToLoves(loadId: string, submittedBy: string | null = null): Promise<SubmitResult> {
  const enabled = isModuleEnabled();
  if (!enabled.ok) {
    console.log(`[factoring-loves] BLOCKED: ${enabled.reason}`);
    return { ok: false, blocked: enabled.reason };
  }

  // Dedup: if a submission row already exists for this load, refuse.
  const [existing] = await db
    .select()
    .from(factoringSubmissions)
    .where(eq(factoringSubmissions.loadId, loadId))
    .limit(1);
  if (existing && existing.status !== "rejected" && existing.status !== "bounced") {
    return {
      ok: false,
      blocked: `Load already submitted (${existing.status}) on ${existing.submittedAt?.toISOString() ?? "?"}`,
      submissionId: existing.id,
    };
  }

  const rate = rateCheck();
  if (!rate.ok) {
    console.error(`[factoring-loves] RATE LIMIT: ${rate.reason}`);
    return { ok: false, blocked: rate.reason };
  }

  // Build packet
  const packet = await buildFactoringPacket(loadId);
  if (!packet.ok || !packet.pdfBytes) {
    return { ok: false, error: packet.error ?? "packet build failed" };
  }

  const [load] = await db.select().from(loads).where(eq(loads.id, loadId));
  if (!load) return { ok: false, error: "Load disappeared between build and send" };

  // Insert submission row in 'queued' state BEFORE sending so we have a record
  // even if the send throws.
  const [submission] = await db
    .insert(factoringSubmissions)
    .values({
      loadId,
      factor: "loves",
      status: "queued",
      amountInvoiced: Number(load.rate ?? 0),
      submittedBy,
    })
    .returning();

  const subject = `${LAMP.clientCode} — ACH — Load #${load.loadNumber}`;
  const fromAddr =
    process.env.FACTORING_FROM_EMAIL ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER ||
    LAMP.email;

  const body =
    `Hi Love's Financial team,\n\n` +
    `Please find attached the factoring packet for ${LAMP.legalName} (${LAMP.clientCode}).\n\n` +
    `Load #: ${load.loadNumber}\n` +
    `Broker: ${load.brokerName ?? "see RateCon"}\n` +
    `Pickup: ${load.originCity ?? ""}, ${load.originState ?? ""}\n` +
    `Delivery: ${load.destCity ?? ""}, ${load.destState ?? ""}\n` +
    `Amount: $${Number(load.rate ?? 0).toFixed(2)}\n\n` +
    `Preferred payment: ACH\n\n` +
    `Documents in attached PDF (Love's required order):\n` +
    `  1. Bill of Sale (signed)\n` +
    `  2. Invoice\n` +
    `  3. Rate Confirmation\n` +
    `  4. BOL / POD\n\n` +
    `Thanks,\n${LAMP.dba} Dispatch\n${LAMP.phone}\n${LAMP.email}\n`;

  console.log(`[factoring-loves] sending packet for load ${load.loadNumber} to ${SCHEDULES_LS}`);

  try {
    const info = await factoringMailer.sendMail({
      from: `"${LAMP.dba}" <${fromAddr}>`,
      to: SCHEDULES_LS,
      subject,
      text: body,
      attachments: [
        {
          filename: `${LAMP.clientCode}_Load_${load.loadNumber}_packet.pdf`,
          content: Buffer.from(packet.pdfBytes),
          contentType: "application/pdf",
        },
      ],
    });

    submissionTimestamps.push(Date.now());

    // Mark submitted on success
    await db
      .update(factoringSubmissions)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        emailMessageId: info.messageId,
        updatedAt: new Date(),
      })
      .where(eq(factoringSubmissions.id, submission.id));

    await db
      .update(loads)
      .set({
        factoringStatus: "submitted",
        factoringSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(loads.id, loadId));

    console.log(`[factoring-loves] ✅ submitted load ${load.loadNumber} (msgId: ${info.messageId})`);
    return { ok: true, submissionId: submission.id, emailMessageId: info.messageId };
  } catch (err: any) {
    await db
      .update(factoringSubmissions)
      .set({
        status: "bounced",
        errorMessage: err.message,
        updatedAt: new Date(),
      })
      .where(eq(factoringSubmissions.id, submission.id));
    console.error(`[factoring-loves] ❌ submit failed: ${err.message}`);
    return { ok: false, error: `SMTP error: ${err.message}` };
  }
}

/**
 * Returns true if the cutoff for SAME-DAY funding has passed today.
 * Love's cutoff is 11:00 AM Central Time.
 */
export function pastTodayCutoff(now: Date = new Date()): boolean {
  // Compute current time in America/Chicago without depending on a tz lib.
  // toLocaleString gives us a string in CT we can re-parse.
  const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return ct.getHours() >= 11;
}
