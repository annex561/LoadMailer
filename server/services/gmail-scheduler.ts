import cron from 'node-cron';
import { gmailIngest } from './gmail';

let scheduledTask: cron.ScheduledTask | null = null;
let isRunning = false;

export const gmailScheduler = {
  start(intervalMinutes: number = 5) {
    if (scheduledTask) {
      console.log('📧 Gmail scheduler already running');
      return;
    }

    const hasDefaultAccount = gmailIngest.isConfigured();
    if (!hasDefaultAccount) {
      console.log('⚠️ No default Gmail credentials - scheduler will only poll database accounts');
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
        
        const totalFiles = results.reduce((sum, r) => sum + r.files.length, 0);
        const successfulAccounts = results.filter(r => !r.error).length;
        const errorAccounts = results.filter(r => r.error).length;

        if (totalFiles > 0) {
          console.log(`📧 [Scheduled] Found ${totalFiles} Rate Confirmation PDFs across ${successfulAccounts} accounts`);
          results.forEach(r => {
            if (r.files.length > 0) {
              console.log(`  📬 ${r.accountName}: ${r.files.length} files`);
              r.files.forEach(f => console.log(`    ✅ ${f.filename} (${f.size} bytes)`));
            }
          });
        } else {
          console.log(`📧 [Scheduled] No new Rate Confirmations found (${successfulAccounts} accounts scanned)`);
        }

        if (errorAccounts > 0) {
          console.log(`⚠️ [Scheduled] ${errorAccounts} account(s) had errors`);
          results.filter(r => r.error).forEach(r => {
            console.log(`  ❌ ${r.accountName}: ${r.error}`);
          });
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
    return gmailIngest.scanAllAccounts();
  }
};
