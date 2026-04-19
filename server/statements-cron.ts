// Weekly Statement Cron
// Fridays at 5pm America/New_York, sends each driver (with a tracking token) an
// SMS link to their weekly statement at /statements/:token.
//
// Dedupes via in-memory set keyed on `${driverId}:${weekStart}` to survive
// cron re-triggers within the same week.

import cron from 'node-cron';
import { db } from './db';
import { drivers } from '@shared/schema';
import { isNotNull } from 'drizzle-orm';
import { smsLoadService } from './sms-service';
import { computeSettlements, fmtYMD, weekRange } from './settlements-service';

class StatementsCron {
  private job: any = null;
  private isRunning = false;
  private sent = new Set<string>();

  async initialize(): Promise<void> {
    if (this.isRunning) return;
    // Friday at 5:00 PM America/New_York
    this.job = cron.schedule(
      '0 17 * * 5',
      async () => {
        try {
          await this.runWeekly();
        } catch (err) {
          console.error('[statements-cron] error:', err);
        }
      },
      { timezone: 'America/New_York' } as any,
    );
    this.isRunning = true;
    console.log('✅ Weekly Statements cron running (Fri 5pm ET)');
  }

  async runWeekly(weekRef?: string): Promise<{ sent: number; skipped: number }> {
    const ref = weekRef || fmtYMD(new Date());
    const { start } = weekRange(ref);
    const weekStartYMD = fmtYMD(start);

    const baseUrl =
      process.env.PUBLIC_URL ||
      process.env.APP_URL ||
      'https://traqiq.app';

    const settlements = await computeSettlements(ref);

    let sent = 0;
    let skipped = 0;

    for (const s of settlements) {
      if (s.loadCount === 0) { skipped++; continue; }
      const dedupeKey = `${s.driverId}:${weekStartYMD}`;
      if (this.sent.has(dedupeKey)) { skipped++; continue; }

      const driver = await db.query.drivers.findFirst({
        where: (d, { eq }) => eq(d.id, s.driverId),
      });
      if (!driver?.phone) { skipped++; continue; }
      if (!driver.trackingToken) { skipped++; continue; }

      const link = `${baseUrl}/statements/${driver.trackingToken}?week=${weekStartYMD}`;
      const body = `💰 LAMP weekly statement: ${s.loadCount} loads, total pay $${s.totalPay.toFixed(2)}. View: ${link}`;

      try {
        const r = await smsLoadService.sendSMS(driver.phone, body);
        if (r.success) {
          this.sent.add(dedupeKey);
          sent++;
          console.log(`[statements-cron] ✉️  sent to ${driver.name}`);
        } else {
          console.warn(`[statements-cron] send failed for ${driver.name}: ${r.error}`);
        }
      } catch (err: any) {
        console.error(`[statements-cron] exception for ${driver.name}:`, err?.message || err);
      }
    }

    return { sent, skipped };
  }

  getStatus() {
    return { running: this.isRunning, dedupedKeys: Array.from(this.sent) };
  }

  // Expose for manual trigger
  async triggerNow(weekRef?: string) {
    return this.runWeekly(weekRef);
  }

  resetDedup() { this.sent.clear(); }
}

export const statementsCron = new StatementsCron();

// Suppress unused import warning — drivers is referenced indirectly via db.query
export const _schemaRef = { drivers, isNotNull };
