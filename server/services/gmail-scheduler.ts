import cron from 'node-cron';
import { gmailIngest } from './gmail';

let scheduledTask: cron.ScheduledTask | null = null;
let isRunning = false;

export const gmailScheduler = {
  start(intervalMinutes: number = 1) {
    if (scheduledTask) {
      console.log('📧 Gmail scheduler already running');
      return;
    }

    if (!gmailIngest.isConfigured()) {
      console.log('⚠️ Gmail OAuth credentials not configured - scheduler not started');
      return;
    }

    const cronExpression = `*/${intervalMinutes} * * * *`;
    
    scheduledTask = cron.schedule(cronExpression, async () => {
      if (isRunning) {
        console.log('📧 Gmail scan already in progress, skipping...');
        return;
      }

      try {
        isRunning = true;
        console.log('📧 [Scheduled] Starting multi-account Gmail scan...');
        
        const results = await gmailIngest.scanAllAccounts();
        
        const totalFiles = results.reduce((r: any, acc: any) => acc + (r.filesProcessed || 0), 0);
        const totalLoads = results.reduce((r: any, acc: any) => acc + (r.loadsCreated || 0), 0);
        const errorCount = results.filter((r: any) => r.error).length;

        if (totalFiles > 0 || totalLoads > 0) {
          console.log(`📧 [Scheduled] Processed ${totalFiles} PDFs, created ${totalLoads} loads`);
        } else {
          console.log(`📧 [Scheduled] No new Rate Confirmations found`);
        }

        if (errorCount > 0) {
          console.log(`⚠️ [Scheduled] ${errorCount} account(s) had errors`);
        }

      } catch (error) {
        console.error('❌ [Scheduled] Gmail scan error:', error);
      } finally {
        isRunning = false;
      }
    });

    console.log(`📧 Gmail auto-polling started - checking every ${intervalMinutes} minutes`);
  },

  stop() {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
      console.log('📧 Gmail scheduler stopped');
    }
  },

  isActive(): boolean {
    return scheduledTask !== null;
  },

  async runNow() {
    if (isRunning) {
      return { error: 'Scan already in progress' };
    }
    return gmailIngest.scanAllAccounts();
  }
};
