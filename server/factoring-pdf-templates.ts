/**
 * PDF templates for factoring submissions to Love's Financial.
 *
 * Two LAMP-generated documents per packet:
 *   1. Bill of Sale — assignment of invoice to Love's
 *   2. Invoice — what brokers see, with the Notice of Assignment block
 *
 * Both built with pdf-lib (pure JS, no native deps). Signature is the
 * pre-extracted PNG from server/assets/signatures/annex.png.
 *
 * See docs/factoring/loves-financial.md for the full spec.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import { getAnnexSignaturePngBytes } from "./factoring-signature";

// LAMP entity constants — pulled out so they're easy to update if anything
// changes (e.g. address change, new MC number). Source: NOA + dispatcher.
export const LAMP = {
  legalName: "Lamp, PLLC",
  dba: "LAMP Logistics",
  clientCode: "LAMP01",
  address: "3300 Wilcox Blvd",
  cityStateZip: "Chattanooga, TN 37411",
  mc: "MC-1725755",
  dot: "US DOT 4397421",
  phone: "(205) 861-4115",
  email: "dispatch@traqiq.app",
} as const;

export const LOVES = {
  legalName: "Love's Solutions, LLC",
  dba: "Love's Financial",
  noaDate: "6/4/2025",
  remitMail: ["Love's Solutions, LLC", "PO BOX 96-0479", "Oklahoma City, OK 73196-0479"],
  remitWire: ["Bank of Oklahoma", "ABA: 103900036", "ACCT: 308773140"],
  disputeEmail: "cashdeptls@loves.com",
  disputePhone: "405-463-8888",
} as const;

const NOA_BLOCK = [
  `NOTICE OF ASSIGNMENT — Per Notice of Sale and Assignment of Accounts dated ${LOVES.noaDate},`,
  `${LAMP.legalName} has assigned this and all present/future accounts receivable to`,
  `${LOVES.legalName} d/b/a ${LOVES.dba}. Payment must be made SOLELY to Love's.`,
  `Payment to any party other than Love's will not discharge your obligation.`,
  ``,
  `REMIT BY MAIL:                  REMIT BY WIRE/ACH:`,
  `${LOVES.remitMail[0]}            ${LOVES.remitWire[0]}`,
  `${LOVES.remitMail[1]}                ${LOVES.remitWire[1]}`,
  `${LOVES.remitMail[2]}      ${LOVES.remitWire[2]}`,
  ``,
  `Disputes: ${LOVES.disputeEmail} · ${LOVES.disputePhone}`,
];

interface LoadInputs {
  loadNumber: string;
  brokerName: string | null;
  brokerMc?: string | null;
  pickupAddress: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  pickupDate: Date | string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  deliveryDate: Date | string | null;
  rate: number;
  loadId: string;
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// Signature is inlined as base64 in factoring-signature.ts so the bundled
// production server (esbuild only bundles JS, not assets) has the signature
// available without filesystem access. Returns null only if the inlined data
// is missing — caller treats that as best-effort and renders without sig.
async function loadSignaturePng(): Promise<Buffer | null> {
  return getAnnexSignaturePngBytes();
}

// Helper: draw a left-aligned wrapped text block. Returns the y-coordinate
// after the last line so callers can stack blocks.
function drawTextBlock(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  lineHeight = 14,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let currentY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const w = font.widthOfTextAtSize(test, size);
    if (w > maxWidth && line) {
      page.drawText(line, { x, y: currentY, size, font, color: rgb(0, 0, 0) });
      currentY -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: currentY, size, font, color: rgb(0, 0, 0) });
    currentY -= lineHeight;
  }
  return currentY;
}

/**
 * Bill of Sale — assignment-of-invoice document. Identifies the load + amount,
 * states LAMP is selling the receivable to Love's, signed by Annex.
 */
export async function generateBillOfSale(load: LoadInputs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 50; // margin
  let y = 750;

  // Header — LAMP letterhead
  page.drawText(LAMP.dba.toUpperCase(), { x: M, y, size: 18, font: helvBold });
  y -= 18;
  page.drawText(`${LAMP.address}, ${LAMP.cityStateZip}`, { x: M, y, size: 10, font: helv });
  y -= 12;
  page.drawText(`${LAMP.mc} · ${LAMP.dot} · ${LAMP.phone}`, { x: M, y, size: 10, font: helv });
  y -= 30;

  // Title
  page.drawText("BILL OF SALE / ASSIGNMENT OF INVOICE", {
    x: M,
    y,
    size: 14,
    font: helvBold,
  });
  y -= 25;

  // Body
  y = drawTextBlock(
    page,
    helv,
    `For value received, ${LAMP.legalName} (the "Seller") hereby sells, assigns, and transfers to ${LOVES.legalName} d/b/a ${LOVES.dba} (the "Buyer") the invoice described below and all rights to collect payment from the listed debtor.`,
    M,
    y,
    512,
    11,
  );
  y -= 12;

  // Field table
  const labelX = M;
  const valueX = M + 140;
  const drawField = (label: string, value: string) => {
    page.drawText(label, { x: labelX, y, size: 11, font: helvBold });
    page.drawText(value, { x: valueX, y, size: 11, font: helv });
    y -= 18;
  };
  drawField("Invoice #:", `LAMP-${load.loadNumber}`);
  drawField("Load #:", load.loadNumber);
  drawField("Debtor (Broker):", load.brokerName ?? "Unknown");
  drawField("Pickup:", `${load.pickupCity ?? ""}, ${load.pickupState ?? ""} — ${fmtDate(load.pickupDate)}`);
  drawField("Delivery:", `${load.deliveryCity ?? ""}, ${load.deliveryState ?? ""} — ${fmtDate(load.deliveryDate)}`);
  drawField("Amount:", fmtMoney(load.rate));
  drawField("Date of Sale:", fmtDate(new Date()));

  y -= 30;

  // Signature line
  page.drawText("Authorized Signature:", { x: M, y, size: 11, font: helvBold });
  y -= 50;

  // Signature image
  const sigBytes = await loadSignaturePng();
  if (sigBytes) {
    const sigImg = await doc.embedPng(sigBytes);
    const sigDims = sigImg.scale(0.30);
    page.drawImage(sigImg, {
      x: M,
      y: y + 10,
      width: sigDims.width,
      height: sigDims.height,
    });
  }

  page.drawLine({
    start: { x: M, y: y + 5 },
    end: { x: M + 250, y: y + 5 },
    thickness: 0.5,
  });
  y -= 5;
  page.drawText("Annex Luberisse, LAMP Logistics", { x: M, y, size: 10, font: helv });
  y -= 12;
  page.drawText(`Date: ${fmtDate(new Date())}`, { x: M, y, size: 10, font: helv });

  return await doc.save();
}

/**
 * Invoice — billed to the broker, shows Notice of Assignment. Same template
 * the broker would receive (also included in the Love's packet).
 */
export async function generateInvoice(load: LoadInputs): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const M = 50;
  let y = 750;

  // Letterhead
  page.drawText(LAMP.dba.toUpperCase(), { x: M, y, size: 20, font: helvBold });
  y -= 18;
  page.drawText(LAMP.legalName, { x: M, y, size: 11, font: helv });
  y -= 12;
  page.drawText(`${LAMP.address}, ${LAMP.cityStateZip}`, { x: M, y, size: 10, font: helv });
  y -= 12;
  page.drawText(`${LAMP.mc} · ${LAMP.dot}`, { x: M, y, size: 10, font: helv });
  y -= 12;
  page.drawText(`${LAMP.phone} · ${LAMP.email}`, { x: M, y, size: 10, font: helv });
  y -= 25;

  // Invoice header (right-aligned)
  page.drawText("INVOICE", { x: M, y, size: 22, font: helvBold });
  y -= 25;

  const drawField = (label: string, value: string, currentY: number) => {
    page.drawText(label, { x: M, y: currentY, size: 11, font: helvBold });
    page.drawText(value, { x: M + 130, y: currentY, size: 11, font: helv });
    return currentY - 18;
  };

  y = drawField("Invoice #:", `LAMP-${load.loadNumber}`, y);
  y = drawField("Invoice Date:", fmtDate(new Date()), y);
  y = drawField("Load #:", load.loadNumber, y);

  y -= 10;
  page.drawText("Bill To:", { x: M, y, size: 11, font: helvBold });
  y -= 14;
  page.drawText(load.brokerName ?? "Broker (see Rate Confirmation)", {
    x: M,
    y,
    size: 11,
    font: helv,
  });
  y -= 14;
  if (load.brokerMc) {
    page.drawText(`MC: ${load.brokerMc}`, { x: M, y, size: 10, font: helv });
    y -= 14;
  }

  y -= 14;
  page.drawText("Description of Service", { x: M, y, size: 11, font: helvBold });
  y -= 16;
  y = drawTextBlock(
    page,
    helv,
    `Transportation services per Rate Confirmation: ${load.pickupCity ?? ""}, ${load.pickupState ?? ""} (pickup ${fmtDate(load.pickupDate)}) → ${load.deliveryCity ?? ""}, ${load.deliveryState ?? ""} (delivery ${fmtDate(load.deliveryDate)}).`,
    M,
    y,
    512,
    11,
  );
  y -= 10;

  // Amount
  page.drawText("Amount Due:", { x: M, y, size: 13, font: helvBold });
  page.drawText(fmtMoney(load.rate), { x: M + 130, y, size: 13, font: helvBold });
  y -= 30;

  // NOA block — required on every invoice
  page.drawLine({
    start: { x: M, y },
    end: { x: M + 512, y },
    thickness: 0.5,
  });
  y -= 14;
  for (const line of NOA_BLOCK) {
    page.drawText(line, { x: M, y, size: 9, font: helv });
    y -= 11;
  }

  return await doc.save();
}

/**
 * Merge multiple PDF byte arrays into a single packet PDF in the order
 * Love's requires:  Bill of Sale → Invoice → Rate Confirmation → BOL/POD →
 * (accompanying pages) → (accessorials).
 *
 * Sources can be Uint8Array (generated PDFs) or Buffer (loaded from disk/storage).
 * Image inputs (BOL/POD photos as JPG/PNG) are first wrapped into single-page PDFs.
 */
export async function mergePacketPdfs(
  parts: Array<{ label: string; bytes: Uint8Array | Buffer; kind: "pdf" | "image" }>,
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const part of parts) {
    if (part.kind === "pdf") {
      try {
        const src = await PDFDocument.load(part.bytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        for (const p of pages) merged.addPage(p);
      } catch (err: any) {
        console.error(`[factoring-merge] failed to embed ${part.label}: ${err.message}`);
      }
    } else if (part.kind === "image") {
      // Wrap an image into a single-page PDF sized to fit US Letter.
      try {
        const isJpg =
          part.bytes[0] === 0xff && part.bytes[1] === 0xd8 && part.bytes[2] === 0xff;
        const img = isJpg
          ? await merged.embedJpg(part.bytes)
          : await merged.embedPng(part.bytes);
        const page = merged.addPage([612, 792]);
        // Scale to fit with 36pt margin all around
        const maxW = 612 - 72;
        const maxH = 792 - 72;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: (612 - w) / 2,
          y: (792 - h) / 2,
          width: w,
          height: h,
        });
      } catch (err: any) {
        console.error(`[factoring-merge] failed to embed image ${part.label}: ${err.message}`);
      }
    }
  }

  return await merged.save();
}
