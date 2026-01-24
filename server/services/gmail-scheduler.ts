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

    if (!gmailIngest.isConfigured()) {
      console.log('⚠️ Gmail credentials not configured - scheduler not started');
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
        console.log('📧 [Scheduled] Starting Gmail scan for Rate Confirmations...');
        const files = await gmailIngest.scanInbox();
        
        if (files.length > 0) {
          console.log(`📧 [Scheduled] Found ${files.length} Rate Confirmation PDFs`);
          files.forEach(f => console.log(`  ✅ ${f.filename} (${f.size} bytes)`));
        } else {
          console.log('📧 [Scheduled] No new Rate Confirmations found');
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
    if (!gmailIngest.isConfigured()) {
      throw new Error('Gmail credentials not configured');
    }
    return gmailIngest.scanInbox();
  }
};
