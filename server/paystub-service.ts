// Paystub Service
//
// Generates a driver's weekly paystub: renders an HTML statement (pure, tested
// in server/__tests__/paystub-render.test.ts), converts to PDF via puppeteer,
// persists a snapshot to the paystubs table, and on finalize decrements any
// advance balances that were recouped this week.
//
// This module does NOT send anything. The SMS-link send path is separate and
// gated behind PAYSTUB_SMS_ENABLED (Phase 3).

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { db } from './db';
import { paystubs, drivers } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import {
  computeSettlementForDriver,
  weekRange,
  fmtYMD,
  type DriverSettlement,
} from './settlements-service';
import { settleScheduledRepayments } from './advances-service';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string),
  );
}

export interface PaystubRenderOpts {
  driverName: string;
  companyName?: string;
}

/** Pure HTML render of a weekly paystub. No I/O — unit-tested. */
export function renderPaystubHTML(s: DriverSettlement, opts: PaystubRenderOpts): string {
  const company = esc(opts.companyName || 'LAMP');
  const driverName = esc(opts.driverName || s.driverName);

  const loadRows = s.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px">${esc(l.loadNumber)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">${esc(l.origin)} → ${esc(l.destination)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-size:12px">${l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString('en-US') : '—'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${money(l.rate)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${l.miles || '—'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${money(l.pay)}</td>
      </tr>`,
    )
    .join('');

  // Build the full deduction list shown on the stub.
  const deductionLines: Array<{ label: string; amount: number }> = [
    ...s.perLoadDeductions,
    ...s.recurringDeductions,
    ...s.miscDeductions,
  ];
  if (s.fuelCost > 0) deductionLines.push({ label: 'Fuel', amount: -s.fuelCost });
  if (s.advanceDeduction > 0) deductionLines.push({ label: 'Advance repayment', amount: -s.advanceDeduction });

  const deductionRows = deductionLines.length
    ? deductionLines
        .map(
          (d) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9">${esc(d.label)}</td>
          <td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#dc2626">${money(d.amount)}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="2" style="padding:8px;color:#6b7280">No deductions this week.</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1f2937; padding:40px; }
    .muted { color:#6b7280; font-size:13px; }
    h1 { font-size:26px; font-weight:800; }
    table { width:100%; border-collapse:collapse; }
    th { text-align:left; font-size:12px; color:#6b7280; text-transform:uppercase; letter-spacing:.5px; padding:8px; border-bottom:2px solid #e5e7eb; }
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
    <div>
      <h1>${company} — Driver Settlement</h1>
      <div class="muted" style="margin-top:4px">Pay statement</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:700;font-size:18px">${driverName}</div>
      <div class="muted">Week ${esc(s.weekStart)} → ${esc(s.weekEnd)}</div>
      <div class="muted">${s.loadCount} load${s.loadCount === 1 ? '' : 's'} delivered</div>
    </div>
  </div>

  <div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:12px;padding:24px;margin:20px 0;text-align:center;color:#fff">
    <div style="text-transform:uppercase;letter-spacing:.5px;font-size:12px;color:#d1fae5">Net take-home this week</div>
    <div style="font-size:44px;font-weight:800;letter-spacing:-1px;margin:4px 0">${money(s.netPay)}</div>
    <div style="color:#d1fae5;font-size:13px">${money(s.grossPay)} earned − ${money(s.totalDeductions)} deductions</div>
  </div>

  <h3 style="font-size:16px;font-weight:700;margin:20px 0 10px">Loads</h3>
  <table>
    <thead>
      <tr><th>Load</th><th>Route</th><th>Delivered</th><th style="text-align:right">Rate</th><th style="text-align:right">Miles</th><th style="text-align:right">Your pay</th></tr>
    </thead>
    <tbody>${loadRows}</tbody>
  </table>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px">
    <div>
      <h3 style="font-size:16px;font-weight:700;margin-bottom:10px">Earnings</h3>
      <table>
        <tbody>
          <tr><td style="padding:8px;border-bottom:1px solid #f1f5f9">Gross (your share)</td><td style="padding:8px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">${money(s.grossPay)}</td></tr>
          <tr><td style="padding:8px">Pay rule</td><td style="padding:8px;text-align:right">${s.payType === 'percent' ? `${s.payRate}% of rate` : s.payType === 'per_mile' ? `$${s.payRate}/mi` : `$${s.payRate}/load`}</td></tr>
        </tbody>
      </table>
    </div>
    <div>
      <h3 style="font-size:16px;font-weight:700;margin-bottom:10px">Deductions</h3>
      <table><tbody>${deductionRows}</tbody></table>
    </div>
  </div>

  <div style="margin-top:28px;border-top:2px solid #e5e7eb;padding-top:16px;display:flex;justify-content:space-between;align-items:center">
    <div class="muted">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    <div style="font-size:20px;font-weight:800">Net: ${money(s.netPay)}</div>
  </div>
</body>
</html>`;
}

async function htmlToPdf(html: string): Promise<Buffer> {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' } });
    return Buffer.from(buf);
  } finally {
    if (browser) await browser.close();
  }
}

export interface PaystubResult {
  paystubId: string;
  settlement: DriverSettlement;
  pdfPath: string;
  pdfUrl: string;
  status: string;
}

/**
 * Compute, render, and persist a paystub for (driver, week). Upserts on
 * (driverId, weekStart). Does NOT finalize or send — status stays 'draft'
 * unless finalize=true, which locks numbers and recoups advances.
 */
export async function generatePaystub(
  driverId: string,
  weekRef: string,
  opts: { finalize?: boolean } = {},
): Promise<PaystubResult | null> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) return null;

  const settlement = await computeSettlementForDriver(driverId, weekRef);
  if (!settlement) return null;

  const { start } = weekRange(weekRef);
  const weekStart = fmtYMD(start);

  const html = renderPaystubHTML(settlement, { driverName: driver.name });
  const pdfBuffer = await htmlToPdf(html);

  const fileName = `paystub_${driver.name.replace(/\W+/g, '_')}_${weekStart}_${Date.now()}.pdf`;
  const pdfPath = path.join('/tmp', fileName);
  try { await mkdir('/tmp', { recursive: true }); } catch {}
  await writeFile(pdfPath, pdfBuffer);
  const pdfUrl = `/api/paystubs/${driverId}/pdf-file/${fileName}`;

  // Upsert by (driverId, weekStart)
  const existing = await db
    .select()
    .from(paystubs)
    .where(and(eq(paystubs.driverId, driverId), eq(paystubs.weekStart, weekStart)));

  const willFinalize = !!opts.finalize && existing[0]?.status !== 'finalized' && existing[0]?.status !== 'sent';

  const rowValues = {
    driverId,
    companyId: (driver as any).companyId ?? null,
    weekStart,
    weekEnd: settlement.weekEnd,
    loadCount: settlement.loadCount,
    grossPay: settlement.grossPay,
    totalDeductions: settlement.totalDeductions,
    fuelCost: settlement.fuelCost,
    advanceDeduction: settlement.advanceDeduction,
    netPay: settlement.netPay,
    breakdown: settlement as any,
    pdfPath,
    pdfUrl,
    status: opts.finalize ? 'finalized' : (existing[0]?.status ?? 'draft'),
    finalizedAt: opts.finalize ? new Date() : (existing[0]?.finalizedAt ?? null),
    updatedAt: new Date(),
  };

  let paystubId: string;
  if (existing[0]) {
    await db.update(paystubs).set(rowValues).where(eq(paystubs.id, existing[0].id));
    paystubId = existing[0].id;
  } else {
    const [row] = await db.insert(paystubs).values(rowValues).returning();
    paystubId = row.id;
  }

  // Recoup advances exactly once, when this week first transitions to finalized.
  if (willFinalize && settlement.advanceDeduction > 0) {
    await settleScheduledRepayments(driverId);
  }

  return { paystubId, settlement, pdfPath, pdfUrl, status: rowValues.status };
}

export async function listPaystubs(driverId: string) {
  return db.select().from(paystubs).where(eq(paystubs.driverId, driverId));
}
