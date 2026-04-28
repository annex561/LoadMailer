// Daily HOS (Hours of Service) check
// Every morning at 6 AM local server time, SMS each driver:
//   "TRAQ IQ — reply ON if on duty, OFF if off duty."
// Drivers reply ON/OFF (handled in sms-communication-service.ts) which sets
// drivers.is_on_duty. The geofence cron only triggers photo-upload SMS for
// drivers currently on duty, so off-duty drivers don't get pinged.

import cron from 'node-cron';
import { db } from './db';
import { drivers } from '@shared/schema';
import { isNotNull } from 'drizzle-orm';
import { smsService } from './sms-service';

const HOS_PROMPT =
  "TRAQ IQ — reply ON if you are on duty today, OFF if you are off duty. " +
  "On-duty drivers will receive load updates and pickup/delivery photo prompts.";

export interface HosTickResult {
  drivers: number;
  sent: number;
  failed: number;
  errors: string[];
}

class HosCheckCron {
  private job: any = null;
  private running = false;

  async initialize(): Promise<void> {
    if (this.running) return;
    // 6:00 AM every day, server local time. Railway runs UTC so this fires at
    // 6 AM UTC by default; user can override with HOS_CHECK_CRON env if needed.
    const schedule = process.env.HOS_CHECK_CRON || '0 6 * * *';
    this.job = cron.schedule(schedule, async () => {
      try {
        await this.tick();
      } catch (e) {
        console.error('[hos-cron] tick error:', e);
      }
    });
    this.running = true;
    console.log(`🌅 HOS check cron running (schedule: ${schedule})`);
  }

  async tick(): Promise<HosTickResult> {
    const result: HosTickResult = { drivers: 0, sent: 0, failed: 0, errors: [] };

    if (!smsService.isServiceConfigured?.()) {
      console.log('[hos-cron] SMS not configured — skipping');
      return result;
    }

    const allDrivers = await db
      .select()
      .from(drivers)
      .where(isNotNull(drivers.phone));

    for (const drv of allDrivers) {
      const phone = drv.phone || drv.phoneNumber;
      if (!phone) continue;
      result.drivers++;
      try {
        const r = await smsService.sendSMS({
          to: phone,
          body: HOS_PROMPT,
          skipFooter: true,
        });
        if (r.success) {
          result.sent++;
        } else {
          result.failed++;
          result.errors.push(`${drv.name}: ${r.error}`);
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push(`${drv.name}: ${e?.message || e}`);
      }
    }

    console.log(
      `[hos-cron] tick done — ${result.drivers} drivers, ${result.sent} sent, ${result.failed} failed`,
    );
    return result;
  }

  getStatus() {
    return { running: this.running, schedule: process.env.HOS_CHECK_CRON || '0 6 * * *' };
  }

  async triggerNow() {
    return this.tick();
  }
}

export const hosCheckCron = new HosCheckCron();
