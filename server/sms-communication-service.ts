import { storage } from "./storage";
import { smsService } from "./sms-service";
import type { 
  LoadWithRelations, 
  Driver, 
  LoadCommunicationThread, 
  LoadMessage, 
  InsertLoadMessage,
  InsertCommunicationLog
} from "@shared/schema";

export class SMSCommunicationService {
  private isRunning = false;

  constructor() {}

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing SMS Communication Service...');
      
      if (!smsService.isServiceConfigured()) {
        console.log('⚠️ SMS communication disabled - Twilio not configured');
        return;
      }

      this.isRunning = true;
      console.log('✅ SMS Communication Service initialized');
    } catch (error) {
      console.error('Failed to initialize SMS communication service:', error);
    }
  }

  // Handle incoming SMS messages from drivers (will be called by webhook)
  async handleIncomingSMS(fromPhone: string, message: string, smsId: string): Promise<void> {
    try {
      console.log(`📱 Incoming SMS from ${fromPhone}: ${message.substring(0, 50)}...`);
      
      // Find driver by phone number
      const driver = await this.findDriverByPhone(fromPhone);
      if (!driver) {
        await this.sendSMS(fromPhone, 
          "I don't recognize you as a registered driver. Please contact dispatch for assistance.");
        return;
      }

      // Check if this is a command or status update
      if (message.toLowerCase().startsWith('/') || this.isStatusUpdate(message)) {
        await this.handleStatusUpdate(driver, message, fromPhone, smsId);
        return;
      }

      // Find or create active communication thread for this driver
      const activeThread = await this.findOrCreateActiveThread(driver);
      if (!activeThread) {
        await this.sendSMS(fromPhone, 
          "No active load found. Your message has been forwarded to dispatch.");
        // Create a general message thread or forward to dispatch
        return;
      }

      // Create message record in database
      await this.createMessageRecord({
        threadId: activeThread.id,
        loadId: activeThread.loadId,
        senderId: driver.id,
        senderRole: 'driver',
        senderName: driver.name,
        messageType: 'text',
        textContent: message,
        telegramMessageId: smsId, // Reusing field for SMS ID
        telegramChatId: fromPhone, // Reusing field for phone number
        metadata: {
          smsId: smsId,
          fromPhone: fromPhone
        }
      });

      // Send acknowledgment to driver
      await this.sendSMS(fromPhone, "✅ Message received. Dispatch has been notified.");
      
      // Log communication activity
      await this.logCommunication(activeThread.loadId, activeThread.id, 'message_sent', driver.id, 'driver', {
        messageType: 'text',
        messageLength: message.length,
        fromPhone: fromPhone
      });

      console.log(`✅ SMS message processed for driver ${driver.name}`);
    } catch (error) {
      console.error('Error handling incoming SMS:', error);
    }
  }

  private async handleStatusUpdate(driver: Driver, message: string, fromPhone: string, smsId: string): Promise<void> {
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendSMS(fromPhone, "No active load found for status update.");
      return;
    }

    let statusMessage = message;
    let statusType = 'general_update';

    // Parse common status updates
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('pickup') || lowerMsg.includes('picked up')) {
      statusType = 'pickup_complete';
      statusMessage = "Load picked up successfully";
    } else if (lowerMsg.includes('deliver') || lowerMsg.includes('delivered')) {
      statusType = 'delivery_complete';
      statusMessage = "Load delivered successfully";
    } else if (lowerMsg.includes('delayed') || lowerMsg.includes('late')) {
      statusType = 'delay_report';
    } else if (lowerMsg.includes('arrived') || lowerMsg.includes('on site')) {
      statusType = 'arrival_update';
    }

    // Create status update message record
    await this.createMessageRecord({
      threadId: activeThread.id,
      loadId: activeThread.loadId,
      senderId: driver.id,
      senderRole: 'driver',
      senderName: driver.name,
      messageType: 'status_update',
      textContent: statusMessage,
      telegramMessageId: smsId,
      telegramChatId: fromPhone,
      metadata: {
        statusType: statusType,
        originalMessage: message,
        smsId: smsId,
        fromPhone: fromPhone
      }
    });

    await this.sendSMS(fromPhone, `✅ Status updated: ${statusMessage}`);
    
    await this.logCommunication(activeThread.loadId, activeThread.id, 'status_updated', driver.id, 'driver', {
      statusType: statusType,
      statusMessage: statusMessage,
      fromPhone: fromPhone
    });
  }

  private isStatusUpdate(message: string): boolean {
    const statusKeywords = ['pickup', 'picked up', 'deliver', 'delivered', 'arrived', 'delayed', 'late', 'on site', 'eta', 'status'];
    const lowerMsg = message.toLowerCase();
    return statusKeywords.some(keyword => lowerMsg.includes(keyword));
  }

  private async findDriverByPhone(phone: string): Promise<Driver | null> {
    try {
      // Normalize phone number format for matching
      const normalizedPhone = this.normalizePhoneNumber(phone);
      const drivers = await storage.getAllDrivers();
      
      return drivers.find(driver => {
        if (!driver.phone) return false;
        const driverPhone = this.normalizePhoneNumber(driver.phone);
        return driverPhone === normalizedPhone;
      }) || null;
    } catch (error) {
      console.error('Error finding driver by phone:', error);
      return null;
    }
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters and add country code if missing
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `1${digits}`; // Add US country code
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits;
    }
    return digits;
  }

  private async findOrCreateActiveThread(driver: Driver): Promise<LoadCommunicationThread | null> {
    // Get driver's active loads
    const activeLoads = await storage.getLoadsByStatus('assigned');
    const driverLoad = activeLoads.find(load => load.driverId === driver.id);
    
    if (!driverLoad) return null;

    // Check if thread exists
    let thread = await storage.getLoadCommunicationThreadByLoad(driverLoad.id);
    
    if (!thread) {
      // Create new thread
      thread = await storage.createLoadCommunicationThread({
        loadId: driverLoad.id,
        driverId: driver.id,
        status: 'active',
        lastMessageAt: new Date(),
        messageCount: 0,
        unreadDriverMessages: 0,
        unreadDispatchMessages: 0
      });
      
      await this.logCommunication(driverLoad.id, thread.id, 'thread_created', driver.id, 'driver', {
        loadNumber: driverLoad.loadNumber,
        communicationType: 'sms'
      });
    }

    return thread;
  }

  private async createMessageRecord(messageData: InsertLoadMessage): Promise<LoadMessage> {
    const message = await storage.createLoadMessage(messageData);
    
    // Update thread stats
    const thread = await storage.getLoadCommunicationThread(messageData.threadId);
    if (thread) {
      await storage.updateLoadCommunicationThread(thread.id, {
        lastMessageAt: new Date(),
        messageCount: thread.messageCount + 1,
        unreadDispatchMessages: messageData.senderRole === 'driver' 
          ? thread.unreadDispatchMessages + 1 
          : thread.unreadDispatchMessages
      });
    }

    return message;
  }

  private async logCommunication(
    loadId: string, 
    threadId: string, 
    action: string, 
    actorId: string, 
    actorRole: string, 
    details: any
  ): Promise<void> {
    await storage.createCommunicationLog({
      loadId,
      threadId,
      action,
      actorId,
      actorRole,
      details: { ...details, communicationType: 'sms' },
      timestamp: new Date()
    });
  }

  // Methods for sending SMS messages to drivers

  async sendMessageToDriver(driverId: string, message: string): Promise<void> {
    try {
      const driver = await storage.getDriver(driverId);
      if (!driver?.phone) {
        console.log(`⚠️ Driver ${driverId} has no phone number - cannot send SMS`);
        return;
      }

      const result = await this.sendSMS(driver.phone, message);
      if (result.success) {
        console.log(`✅ SMS sent to driver ${driver.name} (${driverId})`);
      } else {
        console.error(`❌ Failed to send SMS to driver ${driverId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ Failed to send SMS to driver ${driverId}:`, error);
    }
  }

  async sendLoadUpdateToDriver(loadId: string, message: string): Promise<boolean> {
    try {
      // Get the load to find the assigned driver
      const load = await storage.getLoad(loadId);
      if (!load?.driverId) {
        console.log(`⚠️ Load ${loadId} has no assigned driver - cannot send SMS`);
        return false;
      }

      const driver = await storage.getDriver(load.driverId);
      if (!driver?.phone) {
        console.log(`⚠️ Driver ${load.driverId} has no phone number - cannot send SMS`);
        return false;
      }

      const formattedMessage = `📦 Load ${load.loadNumber}\n\n💬 Dispatch:\n${message}\n\nReply to respond or send status updates.`;
      
      const result = await this.sendSMS(driver.phone, formattedMessage);
      if (result.success) {
        console.log(`✅ Load update SMS sent to driver ${driver.name} for load ${load.loadNumber}`);
        return true;
      } else {
        console.error(`❌ Failed to send load update SMS: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to send load update SMS for ${loadId}:`, error);
      return false;
    }
  }

  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // If it starts with 1 and is 11 digits, format as +1
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    
    // If it's 10 digits, assume US and add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // If already formatted correctly, return as is
    if (phone.startsWith('+')) {
      return phone;
    }
    
    // Default fallback - add +1 prefix
    return `+1${digits}`;
  }

  private async sendSMS(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isRunning) {
      console.log('⚠️ SMS communication service not running - message not sent');
      return { success: false, error: 'Service not running' };
    }
    
    try {
      // Normalize phone number to E.164 format for Twilio
      const normalizedPhone = this.normalizePhoneNumber(phone);
      console.log(`📱 Sending SMS to ${normalizedPhone} (original: ${phone})`);
      
      const result = await smsService.sendSMS({
        to: normalizedPhone,
        body: message
      });
      
      if (result.success) {
        console.log('📱 SMS sent successfully via SMS communication service');
        return { success: true };
      } else {
        console.log(`⚠️ SMS sending failed: ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Failed to send SMS:', error);
      return { success: false, error: 'SMS sending failed' };
    }
  }

  async shutdown(): Promise<void> {
    this.isRunning = false;
    console.log('✅ SMS Communication Service shutdown complete');
  }

  get serviceRunning(): boolean {
    return this.isRunning;
  }
}

export const smsCommunicationService = new SMSCommunicationService();