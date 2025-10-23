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
  async handleIncomingSMS(
    fromPhone: string, 
    message: string, 
    smsId: string, 
    mediaUrls: string[] = [], 
    mediaTypes: string[] = []
  ): Promise<void> {
    try {
      console.log(`📱 Incoming SMS from ${fromPhone}: ${message.substring(0, 50)}...`);
      if (mediaUrls.length > 0) {
        console.log(`📎 With ${mediaUrls.length} media attachment(s)`);
      }
      
      // Find driver by phone number
      const driver = await this.findDriverByPhone(fromPhone);
      if (!driver) {
        await this.sendSMS(fromPhone, 
          "I don't recognize you as a registered driver. Please contact dispatch for assistance.");
        return;
      }

      // Find or create unified communication thread for this driver (one thread per driver)
      const thread = await this.findOrCreateUnifiedThread(driver);
      
      // Detect if message is about a specific load
      const loadContext = await this.detectLoadContext(message, driver);
      
      // Create message record in database for each media attachment
      if (mediaUrls.length > 0) {
        for (let i = 0; i < mediaUrls.length; i++) {
          const mediaUrl = mediaUrls[i];
          const mediaType = mediaTypes[i] || 'unknown';
          
          console.log(`💾 Saving media message: ${mediaType} - ${mediaUrl}`);
          
          await this.createMessageRecord({
            threadId: thread.id,
            loadId: loadContext?.loadId || null,
            senderId: driver.id,
            senderRole: 'driver',
            senderName: driver.name,
            messageType: 'media',
            textContent: message || `[${mediaType.split('/')[0]} attachment]`,
            mediaUrl: mediaUrl,
            mediaType: mediaType,
            smsMessageId: smsId,
            metadata: {
              smsId: smsId,
              fromPhone: fromPhone,
              loadNumber: loadContext?.loadNumber,
              mediaIndex: i,
              totalMedia: mediaUrls.length
            }
          });
          
          // 📄 SMART MMS CATEGORIZATION: Auto-categorize documents based on load lifecycle
          if (loadContext?.loadId && mediaType.startsWith('image/')) {
            try {
              // Get load details to determine status
              const load = await storage.getLoad(loadContext.loadId);
              
              if (load) {
                // Smart categorization based on load status
                let documentType = 'other';
                let isRequired = false;
                
                if (load.status === 'scheduled' || load.status === 'assigned') {
                  // Before pickup - likely BOL
                  documentType = 'bol';
                  isRequired = true;
                  console.log(`📋 Auto-categorized as BOL (load status: ${load.status})`);
                } else if (load.status === 'in_transit' || load.status === 'at_pickup') {
                  // During transit - likely freight photo
                  documentType = 'freight_photo';
                  isRequired = false;
                  console.log(`📸 Auto-categorized as freight photo (load status: ${load.status})`);
                } else if (load.status === 'delivered' || load.status === 'at_delivery') {
                  // After delivery - likely POD
                  documentType = 'pod';
                  isRequired = true;
                  console.log(`📦 Auto-categorized as POD (load status: ${load.status})`);
                } else {
                  console.log(`📄 Auto-categorized as other (load status: ${load.status})`);
                }
                
                // Extract filename from URL
                const fileName = mediaUrl.split('/').pop()?.split('?')[0] || `mms_${Date.now()}.jpg`;
                
                // Create load document record with smart categorization
                const document = await storage.createLoadDocument({
                  loadId: load.id,
                  driverId: driver.id,
                  documentType,
                  fileName,
                  fileUrl: mediaUrl,
                  mimeType: mediaType,
                  uploadSource: 'mms',
                  isRequired,
                  approvalStatus: 'pending',
                  notes: message || `Sent via MMS at ${new Date().toLocaleString()}`
                });
                
                console.log(`✅ Created load document: ${documentType} for load ${load.loadNumber} (${document.id})`);
              }
            } catch (docError) {
              console.error('Error creating load document from MMS:', docError);
              // Continue processing - message is still saved even if document creation fails
            }
          }
        }
      }
      
      // Create text message record (even if there are media attachments)
      if (message && message.trim()) {
        await this.createMessageRecord({
          threadId: thread.id,
          loadId: loadContext?.loadId || null,
          senderId: driver.id,
          senderRole: 'driver',
          senderName: driver.name,
          messageType: this.isStatusUpdate(message) ? 'status_update' : 'text',
          textContent: message,
          smsMessageId: smsId,
          metadata: {
            smsId: smsId,
            fromPhone: fromPhone,
            loadNumber: loadContext?.loadNumber,
            isStatusUpdate: this.isStatusUpdate(message),
            hasMedia: mediaUrls.length > 0
          }
        });
      }

      // Send acknowledgment to driver
      await this.sendSMS(fromPhone, "✅ Message received. Dispatch has been notified.");
      
      // Log communication activity
      await this.logCommunication(loadContext?.loadId || null, thread.id, 'message_sent', driver.id, 'driver', {
        messageType: 'text',
        messageLength: message.length,
        fromPhone: fromPhone,
        loadContext: loadContext
      });

      console.log(`✅ SMS message processed for driver ${driver.name}${loadContext ? ` (Load: ${loadContext.loadNumber})` : ''}`);
    } catch (error) {
      console.error('Error handling incoming SMS:', error);
    }
  }

  // Detect load context from message content (optional load number references)
  private async detectLoadContext(message: string, driver: Driver): Promise<{ loadId: string; loadNumber: string } | null> {
    try {
      // Extract potential load numbers from message
      // Supports: LOAD-123, 603006, TN-789, etc.
      const loadNumberPattern = /(?:LOAD[-\s]?)?(\d{6})|(?:LOAD[-\s]?)(\d+)|([A-Z]{2,4}[-\s]?\d+)/gi;
      const matches = message.match(loadNumberPattern);
      
      // Cache loads for this detection to avoid multiple DB calls
      const allLoads = await storage.getAllLoads();
      
      if (!matches || matches.length === 0) {
        // No load number detected - check driver's current active load across all active statuses
        const driverLoad = allLoads.find(load => 
          load.driverId === driver.id && 
          (load.status === 'assigned' || load.status === 'in_transit' || load.status === 'at_pickup' || load.status === 'at_delivery')
        );
        
        if (driverLoad) {
          return {
            loadId: driverLoad.id,
            loadNumber: driverLoad.loadNumber
          };
        }
        
        return null;
      }
      
      // Try to find a matching load from the cached list
      for (const match of matches) {
        const normalizedMatch = match.replace(/[-\s]/g, '').toUpperCase();
        
        const load = allLoads.find(l => {
          const normalized = l.loadNumber.replace(/[-\s]/g, '').toUpperCase();
          return normalized.includes(normalizedMatch) || normalizedMatch.includes(normalized);
        });
        
        if (load) {
          return {
            loadId: load.id,
            loadNumber: load.loadNumber
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error detecting load context:', error);
      return null;
    }
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


  // Find or create a unified communication thread for the driver (one thread per driver)
  private async findOrCreateUnifiedThread(driver: Driver): Promise<LoadCommunicationThread> {
    try {
      // Look for existing thread for this driver
      const allThreads = await storage.getAllLoadCommunicationThreads();
      let thread = allThreads.find(t => t.driverId === driver.id && t.threadType === 'unified');
      
      if (thread) {
        return thread;
      }
      
      // Get driver's current active load for context (optional)
      const activeLoads = await storage.getLoadsByStatus('assigned');
      const driverLoad = activeLoads.find(load => load.driverId === driver.id);
      
      // Create new unified thread for this driver
      thread = await storage.createLoadCommunicationThread({
        threadType: 'unified',
        loadId: driverLoad?.id || null, // Optional current load context
        driverId: driver.id,
        status: 'active',
        lastMessageAt: new Date(),
        messageCount: 0,
        unreadDriverMessages: 0,
        unreadDispatchMessages: 0,
        driverName: driver.name,
        driverPhone: driver.phone || driver.phoneNumber || '',
        loadNumber: driverLoad?.loadNumber || null
      });
      
      await this.logCommunication(driverLoad?.id || null, thread.id, 'thread_created', driver.id, 'system', {
        threadType: 'unified',
        loadNumber: driverLoad?.loadNumber,
        communicationType: 'sms'
      });
      
      console.log(`✅ Created unified thread for driver ${driver.name}`);
      return thread;
    } catch (error) {
      console.error('Error finding/creating unified thread:', error);
      throw error;
    }
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
      console.log(`🔍 SMS DEBUG: sendLoadUpdateToDriver called for load ${loadId}`);
      console.log(`🔍 SMS DEBUG: Message content: ${message.substring(0, 50)}...`);
      
      // Get the load to find the assigned driver
      const load = await storage.getLoad(loadId);
      console.log(`🔍 SMS DEBUG: Load data:`, load ? `${load.loadNumber} (driver: ${load.driverId})` : 'NOT FOUND');
      
      if (!load?.driverId) {
        console.log(`⚠️ Load ${loadId} has no assigned driver - cannot send SMS`);
        return false;
      }

      const driver = await storage.getDriver(load.driverId);
      console.log(`🔍 SMS DEBUG: Driver data:`, driver ? `${driver.name} (phone: ${driver.phone})` : 'NOT FOUND');
      
      if (!driver?.phone) {
        console.log(`⚠️ Driver ${load.driverId} has no phone number - cannot send SMS`);
        return false;
      }

      const formattedMessage = `📦 Load ${load.loadNumber}\n\n💬 Dispatch:\n${message}\n\nReply to respond or send status updates.`;
      console.log(`🔍 SMS DEBUG: Formatted message: ${formattedMessage.substring(0, 100)}...`);
      console.log(`🔍 SMS DEBUG: About to call sendSMS to ${driver.phone}`);
      
      const result = await this.sendSMS(driver.phone, formattedMessage);
      console.log(`🔍 SMS DEBUG: sendSMS result:`, result);
      
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