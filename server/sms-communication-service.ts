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
      // Do this BEFORE any early-return paths so every inbound message can be persisted.
      const thread = await this.findOrCreateUnifiedThread(driver);

      // 🔐 CHECK FOR LOAD CONFIRMATION RESPONSE
      const confirmationKeywords = ['yes', 'confirm', 'confirmed', 'accept', 'accepted', 'ok', 'okay'];
      const normalizedMessage = message.trim().toLowerCase();
      const isConfirmationResponse = confirmationKeywords.some(keyword => 
        normalizedMessage === keyword || normalizedMessage.startsWith(keyword + ' ') || normalizedMessage.startsWith(keyword + '!')
      );
      
      if (isConfirmationResponse) {
        // Persist the incoming confirmation message BEFORE acting on it
        if (message && message.trim()) {
          await this.createMessageRecord({
            threadId: thread.id,
            loadId: null,
            senderId: driver.id,
            senderRole: 'driver',
            senderName: driver.name,
            messageType: 'text',
            textContent: message,
            smsMessageId: smsId,
            metadata: { smsId, fromPhone, routingReason: 'confirmation_response' }
          }, true);
        }

        try {
          // Find driver's most recent dispatched load that hasn't been confirmed
          // Sort by createdAt descending to get the most recent one
          const allLoads = await storage.getAllLoads();
          const unconfirmedLoads = allLoads
            .filter(load => 
              load.driverId === driver.id && 
              load.status === 'dispatched' && 
              !load.driverConfirmedAt
            )
            .sort((a, b) => {
              const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return dateB - dateA; // Most recent first
            });
          
          const unconfirmedLoad = unconfirmedLoads[0]; // Get the most recent unconfirmed load
          
          if (unconfirmedLoad) {
            // Mark load as confirmed by driver and update SOP progress
            const currentSopProgress = unconfirmedLoad.sopProgress || {};
            await storage.updateLoad(unconfirmedLoad.id, {
              driverConfirmedAt: new Date(),
              sopProgress: { ...currentSopProgress, initialSms: true }
            });
            
            console.log(`✅ Driver ${driver.name} confirmed load #${unconfirmedLoad.loadNumber}`);
            
            // Send confirmation acknowledgment
            await this.sendSMS(fromPhone, 
              `✅ Load #${unconfirmedLoad.loadNumber} CONFIRMED!\n\n` +
              `${unconfirmedLoad.originCity || 'Origin'} → ${unconfirmedLoad.destCity || 'Destination'}\n\n` +
              `Drive safe! Contact dispatch if you need anything.`
            );
            return; // Exit early - confirmation handled (message already saved above)
          } else {
            // No pending load to confirm - let the driver know
            await this.sendSMS(fromPhone,
              `No pending load found to confirm. If you have a load number, please include it in your reply.`
            );
            return;
          }
        } catch (confirmErr) {
          console.error('Error processing load confirmation:', confirmErr);
        }
      }
      
      // Cache loads for both detection and dual-routing to avoid redundant queries
      const allLoads = await storage.getAllLoads();
      
      // Detect if message is about a specific load
      const loadContext = await this.detectLoadContextWithCache(message, driver, allLoads);
      
      // 🔄 DUAL-ROUTING LOGIC: Determine all load contexts where this message should appear
      const loadContexts: Array<{ loadId: string | null; loadNumber: string | null; reason: string }> = [];
      
      // 1. Always include the detected context (could be explicit load number or driver's current load)
      if (loadContext) {
        loadContexts.push({
          loadId: loadContext.loadId,
          loadNumber: loadContext.loadNumber,
          reason: 'detected_from_message'
        });
      } else {
        // No load detected - this is a general conversation
        loadContexts.push({
          loadId: null,
          loadNumber: null,
          reason: 'general_conversation'
        });
      }
      
      // 2. Additionally include driver's current active load if different from detected context
      const currentActiveLoad = allLoads.find(load => 
        load.driverId === driver.id && 
        (load.status === 'assigned' || load.status === 'in_transit' || load.status === 'at_pickup' || load.status === 'at_delivery')
      );
      
      if (currentActiveLoad && currentActiveLoad.id !== loadContext?.loadId) {
        loadContexts.push({
          loadId: currentActiveLoad.id,
          loadNumber: currentActiveLoad.loadNumber,
          reason: 'driver_current_load'
        });
        console.log(`🔄 Dual-routing enabled: Message will appear in both ${loadContext?.loadNumber || 'general'} and ${currentActiveLoad.loadNumber}`);
      }
      
      // Save messages to ALL relevant load contexts (implements dual-routing)
      for (let contextIndex = 0; contextIndex < loadContexts.length; contextIndex++) {
        const context = loadContexts[contextIndex];
        const isPrimaryContext = contextIndex === 0;
        
        console.log(`💾 Saving to ${context.reason}: ${context.loadNumber || 'general conversation'}${!isPrimaryContext ? ' (secondary, skip thread stats)' : ''}`);
        
        // Create message record in database for each media attachment
        if (mediaUrls.length > 0) {
          for (let i = 0; i < mediaUrls.length; i++) {
            const mediaUrl = mediaUrls[i];
            const mediaType = mediaTypes[i] || 'unknown';
            
            await this.createMessageRecord({
              threadId: thread.id,
              loadId: context.loadId,
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
                loadNumber: context.loadNumber,
                mediaIndex: i,
                totalMedia: mediaUrls.length,
                routingReason: context.reason
              }
            }, isPrimaryContext);
          
            // 📄 SMART MMS CATEGORIZATION: Auto-categorize documents based on load lifecycle
            // Only create document for the first (primary) load context to avoid duplicates
            if (context.loadId && mediaType.startsWith('image/') && context.reason !== 'driver_current_load') {
              try {
                // Get load details to determine status
                const load = await storage.getLoad(context.loadId);
              
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
            loadId: context.loadId,
            senderId: driver.id,
            senderRole: 'driver',
            senderName: driver.name,
            messageType: this.isStatusUpdate(message) ? 'status_update' : 'text',
            textContent: message,
            smsMessageId: smsId,
            metadata: {
              smsId: smsId,
              fromPhone: fromPhone,
              loadNumber: context.loadNumber,
              isStatusUpdate: this.isStatusUpdate(message),
              hasMedia: mediaUrls.length > 0,
              routingReason: context.reason
            }
          }, isPrimaryContext);
        }
      }

      // Send acknowledgment to driver
      await this.sendSMS(fromPhone, "✅ Message received. Dispatch has been notified.");
      
      // Log communication activity for primary load context (only when load is present)
      const primaryContext = loadContexts[0];
      if (primaryContext.loadId) {
        await this.logCommunication(primaryContext.loadId, thread.id, 'message_sent', driver.id, 'driver', {
          messageType: 'text',
          messageLength: message.length,
          fromPhone: fromPhone,
          loadContext: primaryContext,
          totalContexts: loadContexts.length
        });
      }

      console.log(`✅ SMS processed for ${driver.name}. Saved to ${loadContexts.length} context(s): ${loadContexts.map(c => c.loadNumber || 'general').join(', ')}`);
    } catch (error) {
      console.error('Error handling incoming SMS:', error);
    }
  }

  // Detect load context from message content using cached load list
  private async detectLoadContextWithCache(
    message: string, 
    driver: Driver, 
    allLoads: any[]
  ): Promise<{ loadId: string; loadNumber: string } | null> {
    try {
      // Extract potential load numbers from message
      // Supports: LOAD-123, 603006, TN-789, etc.
      const loadNumberPattern = /(?:LOAD[-\s]?)?(\d{6})|(?:LOAD[-\s]?)(\d+)|([A-Z]{2,4}[-\s]?\d+)/gi;
      const matches = message.match(loadNumberPattern);
      
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

  // Legacy method - kept for backward compatibility
  private async detectLoadContext(message: string, driver: Driver): Promise<{ loadId: string; loadNumber: string } | null> {
    const allLoads = await storage.getAllLoads();
    return this.detectLoadContextWithCache(message, driver, allLoads);
  }

  // Original detectLoadContext implementation removed - now using cached version
  private async detectLoadContext_OLD(message: string, driver: Driver): Promise<{ loadId: string; loadNumber: string } | null> {
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
  // Implements race condition protection and prevents duplicate threads
  private async findOrCreateUnifiedThread(driver: Driver): Promise<LoadCommunicationThread> {
    try {
      // STEP 1: Always query for existing thread first (handle race conditions)
      const existingThread = await storage.getUnifiedThreadByDriver(driver.id);
      
      if (existingThread) {
        console.log(`♻️ Reusing existing unified thread for driver ${driver.name}`);
        return existingThread;
      }
      
      // STEP 2: No thread exists - attempt to create one
      // The unique index will prevent duplicates even if multiple requests race
      try {
        // Get driver's current active load for context (optional)
        const activeLoads = await storage.getLoadsByStatus('assigned');
        const driverLoad = activeLoads.find(load => load.driverId === driver.id);
        
        // Create new unified thread for this driver
        const thread = await storage.createLoadCommunicationThread({
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
      } catch (createError: any) {
        // STEP 3: If creation failed due to race condition (duplicate key), retry query
        // This handles the case where another request created the thread milliseconds ago
        if (createError.message && createError.message.includes('duplicate')) {
          console.log(`⚡ Race condition detected for driver ${driver.name}, fetching existing thread`);
          const retryThread = await storage.getUnifiedThreadByDriver(driver.id);
          if (retryThread) {
            return retryThread;
          }
        }
        // If not a duplicate error or still can't find thread, propagate error
        throw createError;
      }
    } catch (error) {
      console.error('Error finding/creating unified thread:', error);
      throw error;
    }
  }

  private async createMessageRecord(
    messageData: InsertLoadMessage, 
    updateThreadStats: boolean = true
  ): Promise<LoadMessage> {
    const message = await storage.createLoadMessage(messageData);
    
    // Update thread stats only for primary messages (prevents duplicate increments in dual-routing)
    if (updateThreadStats) {
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
    }

    return message;
  }

  private async logCommunication(
    loadId: string | null, 
    threadId: string, 
    action: string, 
    actorId: string, 
    actorRole: string, 
    details: any
  ): Promise<void> {
    if (!loadId) return; // communication_logs requires a non-null load_id
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

  private normalizePhoneNumber(phone: string): string | null {
    // Trim whitespace
    const trimmed = phone.trim();
    if (!trimmed) return null;
    
    // If already in E.164 format (starts with +), validate and return
    if (trimmed.startsWith('+')) {
      // For E.164 numbers, only strip spaces and hyphens (not parentheses, extensions, etc.)
      const cleaned = trimmed.substring(1).replace(/[\s-]/g, '');
      
      // Strict validation: must be exactly 8-15 digits, no other characters
      if (/^\d{8,15}$/.test(cleaned)) {
        return `+${cleaned}`;
      } else {
        console.error(`❌ SMS Service - Invalid E.164 format: "${trimmed}" - must be + followed by 8-15 digits`);
        return null;
      }
    }
    
    // Strip all non-digit characters (spaces, dashes, parentheses, etc.)
    const digits = trimmed.replace(/\D/g, '');
    
    // Normalize US numbers only (10 or 11 digits)
    if (digits.length === 10) {
      // 10 digits: US number without country code → add +1
      return `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      // 11 digits starting with 1: US number with country code → add +
      return `+${digits}`;
    } else {
      // Not a US number and not already E.164 formatted - reject
      console.error(`❌ SMS Service - Cannot normalize phone: "${trimmed}" (${digits.length} digits)`);
      return null;
    }
  }

  private async sendSMS(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isRunning) {
      console.log('⚠️ SMS communication service not running - message not sent');
      return { success: false, error: 'Service not running' };
    }
    
    try {
      // Normalize phone number to E.164 format for Twilio
      const normalizedPhone = this.normalizePhoneNumber(phone);
      
      if (!normalizedPhone) {
        console.error(`❌ SMS Service - Failed to normalize phone number: ${phone}`);
        return { success: false, error: `Invalid phone number format: ${phone}` };
      }
      
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