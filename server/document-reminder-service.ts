import cron from 'node-cron';
import { storage } from './storage';
import { smsCommunicationService } from './sms-communication-service';
import type { Load, LoadDocument } from '@shared/schema';

interface ReminderHistory {
  loadId: string;
  documentType: string;
  lastReminderSent: Date;
  reminderCount: number;
}

export class DocumentReminderService {
  private isRunning = false;
  private cronJob: cron.ScheduledTask | null = null;
  private reminderHistory: Map<string, ReminderHistory> = new Map();
  private readonly MAX_REMINDERS_PER_DOC = 3;
  private readonly REMINDER_COOLDOWN_HOURS = 2;
  private readonly DISPATCHER_PHONE = process.env.DISPATCHER_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  constructor() {}

  async initialize(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Document Reminder Service already running');
      return;
    }

    try {
      console.log('🔔 Starting Document Reminder Service...');
      
      // Schedule cron job to run every 30 minutes
      this.cronJob = cron.schedule('*/30 * * * *', async () => {
        await this.checkDocumentReminders();
      });

      this.isRunning = true;
      console.log('✅ Document Reminder Service initialized - checking every 30 minutes');
      
      // Run initial check immediately
      setTimeout(() => this.checkDocumentReminders(), 5000);
    } catch (error) {
      console.error('❌ Failed to initialize Document Reminder Service:', error);
    }
  }

  async checkDocumentReminders(): Promise<void> {
    try {
      console.log('🔍 Document Reminder: Starting scheduled check...');
      
      const allLoads = await storage.getAllLoads();
      const now = new Date();
      
      for (const load of allLoads) {
        if (!load.driverId) continue; // Skip loads without assigned driver
        
        // Check different scenarios based on load status
        await this.checkBOLReminders(load, now);
        await this.checkPODReminders(load, now);
      }
      
      console.log('✅ Document reminder check complete');
    } catch (error) {
      console.error('❌ Error in document reminder check:', error);
    }
  }

  private async checkBOLReminders(load: Load, now: Date): Promise<void> {
    try {
      // Check if load needs BOL reminder
      // Scenario 1: 2 hours after load status="assigned" (pickup scheduled)
      // Scenario 2: 1 hour after load status="in_transit" (still no BOL)
      
      if (load.status !== 'assigned' && load.status !== 'in_transit') {
        return; // Only check for active loads
      }

      // Get all documents for this load
      const documents = await storage.getLoadDocumentsByLoad(load.id);
      const bolDocuments = documents.filter(doc => doc.documentType === 'bol');
      const hasApprovedBOL = bolDocuments.some(doc => doc.approvalStatus === 'approved');

      if (hasApprovedBOL) {
        return; // BOL already approved, no reminder needed
      }

      // Calculate time elapsed since status change
      const statusChangeTime = load.updatedAt || load.createdAt;
      const hoursElapsed = (now.getTime() - new Date(statusChangeTime).getTime()) / (1000 * 60 * 60);

      let shouldSendReminder = false;
      let reminderType: 'initial' | 'urgent' | 'escalation' = 'initial';

      if (load.status === 'assigned' && hoursElapsed >= 2) {
        shouldSendReminder = true;
        reminderType = 'initial';
      } else if (load.status === 'in_transit' && hoursElapsed >= 1) {
        shouldSendReminder = true;
        reminderType = 'urgent';
      }

      if (shouldSendReminder) {
        const canSend = await this.canSendReminder(load.id, 'bol');
        if (canSend) {
          await this.sendBOLReminder(load, reminderType);
        }
      }
    } catch (error) {
      console.error(`Error checking BOL reminder for load ${load.loadNumber}:`, error);
    }
  }

  private async checkPODReminders(load: Load, now: Date): Promise<void> {
    try {
      // Check if load needs POD reminder
      // Scenario 1: 30 minutes after load status="delivered"
      // Scenario 2: 4 hours after delivery (escalation)
      
      if (load.status !== 'delivered') {
        return; // Only check delivered loads
      }

      // Get all documents for this load
      const documents = await storage.getLoadDocumentsByLoad(load.id);
      const podDocuments = documents.filter(doc => doc.documentType === 'pod');
      const hasApprovedPOD = podDocuments.some(doc => doc.approvalStatus === 'approved');

      if (hasApprovedPOD) {
        return; // POD already approved, no reminder needed
      }

      // Calculate time elapsed since delivery
      const deliveryTime = load.updatedAt || load.createdAt;
      const hoursElapsed = (now.getTime() - new Date(deliveryTime).getTime()) / (1000 * 60 * 60);
      const minutesElapsed = hoursElapsed * 60;

      let shouldSendReminder = false;
      let reminderType: 'initial' | 'urgent' | 'escalation' = 'initial';

      if (minutesElapsed >= 30 && hoursElapsed < 4) {
        shouldSendReminder = true;
        reminderType = 'initial';
      } else if (hoursElapsed >= 4) {
        shouldSendReminder = true;
        reminderType = 'escalation';
      }

      if (shouldSendReminder) {
        const canSend = await this.canSendReminder(load.id, 'pod');
        if (canSend) {
          await this.sendPODReminder(load, reminderType);
          
          // Send escalation to dispatcher if 4+ hours
          if (reminderType === 'escalation') {
            await this.escalateToDispatcher(load, 'pod');
          }
        }
      }
    } catch (error) {
      console.error(`Error checking POD reminder for load ${load.loadNumber}:`, error);
    }
  }

  private async canSendReminder(loadId: string, documentType: string): Promise<boolean> {
    const key = `${loadId}-${documentType}`;
    const history = this.reminderHistory.get(key);

    if (!history) {
      return true; // No history, can send
    }

    // Check if we've hit max reminders
    if (history.reminderCount >= this.MAX_REMINDERS_PER_DOC) {
      return false;
    }

    // Check cooldown period (2 hours between reminders)
    const hoursSinceLastReminder = 
      (Date.now() - history.lastReminderSent.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceLastReminder >= this.REMINDER_COOLDOWN_HOURS;
  }

  private async sendBOLReminder(
    load: Load, 
    reminderType: 'initial' | 'urgent' | 'escalation'
  ): Promise<void> {
    try {
      const driver = await storage.getDriver(load.driverId!);
      if (!driver?.phone) {
        console.log(`⚠️  Cannot send BOL reminder - driver has no phone number`);
        return;
      }

      let message = '';
      switch (reminderType) {
        case 'initial':
          message = `📋 REMINDER: Missing BOL for Load ${load.loadNumber}.\n\n` +
                   `Pickup: ${load.pickupAddress}\n\n` +
                   `Please upload the signed Bill of Lading via text message (photo) or use the driver app.`;
          break;
        case 'urgent':
          message = `⚠️  URGENT: BOL still missing for Load ${load.loadNumber}.\n\n` +
                   `You are currently in transit. Please upload BOL immediately to avoid delays.\n\n` +
                   `Text a photo of the signed BOL to this number.`;
          break;
        case 'escalation':
          message = `🚨 CRITICAL: BOL required for Load ${load.loadNumber}.\n\n` +
                   `This is your final reminder. Upload BOL within 1 hour or dispatch will be notified.\n\n` +
                   `Text a photo of the signed BOL now.`;
          break;
      }

      // Send SMS using communication service
      await smsCommunicationService.sendMessageToDriver(driver.id, message);
      
      // Track reminder
      this.trackReminder(load.id, 'bol');
      
      console.log(`📨 Sent ${reminderType} BOL reminder to ${driver.name} for load ${load.loadNumber}`);
    } catch (error) {
      console.error(`Error sending BOL reminder for load ${load.loadNumber}:`, error);
    }
  }

  private async sendPODReminder(
    load: Load, 
    reminderType: 'initial' | 'urgent' | 'escalation'
  ): Promise<void> {
    try {
      const driver = await storage.getDriver(load.driverId!);
      if (!driver?.phone) {
        console.log(`⚠️  Cannot send POD reminder - driver has no phone number`);
        return;
      }

      let message = '';
      switch (reminderType) {
        case 'initial':
          message = `📦 REMINDER: POD required for Load ${load.loadNumber}.\n\n` +
                   `Delivery: ${load.deliveryAddress}\n\n` +
                   `Please upload Proof of Delivery (signed POD or delivery photo) within 2 hours.\n\n` +
                   `Text a photo to this number or use the driver app.`;
          break;
        case 'urgent':
          message = `⚠️  URGENT: POD still missing for Load ${load.loadNumber}.\n\n` +
                   `Upload POD within 1 hour to complete delivery and ensure payment.\n\n` +
                   `Text a photo of the signed POD now.`;
          break;
        case 'escalation':
          message = `🚨 CRITICAL: POD overdue for Load ${load.loadNumber}.\n\n` +
                   `Delivery was completed 4+ hours ago. Upload POD immediately to avoid payment delays.\n\n` +
                   `Dispatch has been notified. Text POD photo now.`;
          break;
      }

      // Send SMS using communication service
      await smsCommunicationService.sendMessageToDriver(driver.id, message);
      
      // Track reminder
      this.trackReminder(load.id, 'pod');
      
      console.log(`📨 Sent ${reminderType} POD reminder to ${driver.name} for load ${load.loadNumber}`);
    } catch (error) {
      console.error(`Error sending POD reminder for load ${load.loadNumber}:`, error);
    }
  }

  private async escalateToDispatcher(load: Load, documentType: string): Promise<void> {
    try {
      if (!this.DISPATCHER_PHONE) {
        console.log('⚠️  No dispatcher phone configured - cannot send escalation');
        return;
      }

      const driver = await storage.getDriver(load.driverId!);
      const docTypeLabel = documentType.toUpperCase();
      
      const message = `🚨 ESCALATION ALERT\n\n` +
                     `Load: ${load.loadNumber}\n` +
                     `Driver: ${driver?.name || 'Unknown'}\n` +
                     `Missing: ${docTypeLabel}\n` +
                     `Status: ${load.status}\n\n` +
                     `Driver has not uploaded ${docTypeLabel} after multiple reminders. Immediate action required.`;

      // Send SMS to dispatcher
      await smsCommunicationService.sendMessageToDriver('dispatcher', message);
      
      // Log escalation in database
      await storage.createCommunicationLog({
        loadId: load.id,
        threadId: null,
        action: 'document_escalation',
        actorId: 'system',
        actorRole: 'system',
        details: {
          documentType,
          escalationReason: 'Missing critical document after multiple reminders',
          reminderCount: this.reminderHistory.get(`${load.id}-${documentType}`)?.reminderCount || 0,
          loadStatus: load.status,
          driverName: driver?.name
        },
        timestamp: new Date()
      });
      
      console.log(`🚨 Escalated missing ${docTypeLabel} for load ${load.loadNumber} to dispatcher`);
    } catch (error) {
      console.error(`Error escalating to dispatcher for load ${load.loadNumber}:`, error);
    }
  }

  private trackReminder(loadId: string, documentType: string): void {
    const key = `${loadId}-${documentType}`;
    const existing = this.reminderHistory.get(key);

    if (existing) {
      existing.lastReminderSent = new Date();
      existing.reminderCount += 1;
    } else {
      this.reminderHistory.set(key, {
        loadId,
        documentType,
        lastReminderSent: new Date(),
        reminderCount: 1
      });
    }
  }

  async shutdown(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    this.isRunning = false;
    console.log('✅ Document Reminder Service stopped');
  }

  getServiceStatus(): { isRunning: boolean; reminderHistorySize: number } {
    return {
      isRunning: this.isRunning,
      reminderHistorySize: this.reminderHistory.size
    };
  }
}

export const documentReminderService = new DocumentReminderService();
