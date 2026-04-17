import cron from 'node-cron';
import { gmailIngest } from './gmail';

let scheduledTask: cron.ScheduledTask | null = null;
let isRunning = false;

export const gmailScheduler = {
  start(intervalMinutes: number = 1) {
    if (scheduledTask) {
      // Already running — do nothing
      return;
    }

    // No isConfigured() guard — scheduler always runs.
    // If credentials aren't ready yet, the scan simply finds 0 accounts and logs quietly.
    const cronExpression = `*/${intervalMinutes} * * * *`;

    scheduledTask = cron.schedule(cronExpression, async () => {
      if (isRunning) return; // previous scan still in progress

      try {
        isRunning = true;
        const results = await gmailIngest.scanAllAccounts();

        const totalFiles = results.reduce((sum: number, r: any) => sum + (r.filesProcessed || 0), 0);
        const totalLoads = results.reduce((sum: number, r: any) => sum + (r.loadsCreated || 0), 0);

        if (totalFiles > 0 || totalLoads > 0) {
          console.log(`📧 [Gmail] Processed ${totalFiles} PDFs, created ${totalLoads} loads`);
        }
      } catch (error) {
        console.error('❌ [Gmail] Scan error:', error);
      } finally {
        isRunning = false;
      }
    });

    console.log(`📧 Gmail RateCon scanner running — every ${intervalMinutes} minute(s)`);
  },

  // stop() intentionally does nothing — scanner runs until the server process exits.
  // Removing the ability to stop it via API prevents accidental shutdowns.
  stop() {
    console.log('📧 [Gmail] stop() called but ignored — scanner runs continuously by design');
  },

  isActive(): boolean {
    return scheduledTask !== null;
  },

  async runNow() {
    if (isRunning) return { error: 'Scan already in progress' };
    return gmailIngest.scanAllAccounts();
  },
};
