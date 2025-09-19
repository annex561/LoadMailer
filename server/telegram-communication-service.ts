import { smsService } from './sms-service';
import { storage } from './storage';
import type { 
  LoadWithRelations, 
  Driver, 
  LoadCommunicationThread, 
  LoadMessage, 
  MessageAttachment,
  QuickReplyTemplate,
  CommunicationLog,
  InsertLoadMessage,
  InsertMessageAttachment,
  InsertCommunicationLog
} from '@shared/schema';
import { ObjectStorageService } from './objectStorage';

const TWILIO_WEBHOOK_URL = process.env.TWILIO_WEBHOOK_URL || '';

export class SmsCommunicationService {
  private isRunning = false;
  private objectStorageService: ObjectStorageService;
  private incomingMessageQueue: Array<{ from: string; body: string; timestamp: Date }> = [];

  constructor() {
    this.objectStorageService = new ObjectStorageService();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing SMS Communication Service...');
      
      if (!smsService.isServiceConfigured()) {
        console.log('⚠️ SMS communication disabled - Twilio not configured');
        return;
      }

      // Start processing incoming messages
      this.startMessageProcessor();
      
      this.isRunning = true;
      console.log('✅ SMS Communication Service initialized');
    } catch (error) {
      console.error('Failed to initialize SMS communication service:', error);
    }
  }

  private startMessageProcessor(): void {
    // Process incoming SMS messages queue
    setInterval(async () => {
      if (this.incomingMessageQueue.length > 0) {
        const message = this.incomingMessageQueue.shift();
        if (message) {
          try {
            await this.handleIncomingSMS(message);
          } catch (error) {
            console.error('Error processing SMS message:', error);
          }
        }
      }
    }, 1000); // Process every second
  }

  // Method to receive SMS messages (called by webhook)
  async receiveIncomingSMS(from: string, body: string): Promise<void> {
    this.incomingMessageQueue.push({
      from: from,
      body: body.trim(),
      timestamp: new Date()
    });
    console.log(`📱 SMS received from ${from}: ${body}`);
  }

  private async handleIncomingSMS(message: { from: string; body: string; timestamp: Date }): Promise<void> {
    const phoneNumber = message.from;
    const messageBody = message.body;

    const driver = await storage.getDriverByPhoneNumber(phoneNumber);
    
    if (!driver) {
      await this.sendSMS(phoneNumber, 
        "I don't recognize you as a registered driver. Please contact dispatch for assistance.");
      return;
    }

    // Check if this is a quick reply command
    const upperBody = messageBody.toUpperCase();
    if (this.isQuickReplyCommand(upperBody)) {
      await this.handleQuickReplyCommand(phoneNumber, driver, upperBody);
      return;
    }

    // Find active communication thread for this driver
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendSMS(phoneNumber, 
        "No active load found. Your message will be forwarded to dispatch.");
      // Handle general driver message without load context
      return;
    }

    // Create message record
    await this.createMessageRecord({
      threadId: activeThread.id,
      loadId: activeThread.loadId,
      senderId: driver.id,
      senderRole: 'driver',
      senderName: driver.name,
      messageType: 'text',
      textContent: messageBody,
      smsMessageId: '',
      metadata: {
        phoneNumber: phoneNumber,
        timestamp: message.timestamp.toISOString()
      }
    });

    // Send acknowledgment with quick reply options
    await this.sendQuickReplyOptions(phoneNumber, activeThread.loadId);
    
    // Log communication activity
    await this.logCommunication(activeThread.loadId, activeThread.id, 'message_sent', driver.id, 'driver', {
      messageType: 'text',
      messageLength: messageBody.length
    });
  }

  private isQuickReplyCommand(message: string): boolean {
    const commands = ['ARRIVED', 'LOADED', 'ENROUTE', 'DELIVERED', 'ISSUE', 'HELP', 'STATUS', 'LOCATION'];
    return commands.some(cmd => message.includes(cmd));
  }

  // Note: SMS doesn't support direct photo sending like Telegram
  // Photos would need to be handled via MMS or external upload links
  private async handlePhotoViaSMS(phoneNumber: string, driver: Driver): Promise<void> {
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    // For SMS, we'd need to send a link for photo upload
    const uploadLink = `${process.env.BASE_URL}/upload/${activeThread.loadId}/${driver.id}`;
    
    await this.sendSMS(phoneNumber, 
      `📸 To send photos for this load, please use this link: ${uploadLink}\n\nThis link will allow you to upload photos directly to the load documentation.`);
  }

  // Note: SMS doesn't support direct document sending
  // Documents would need to be handled via external upload links
  private async handleDocumentViaSMS(phoneNumber: string, driver: Driver): Promise<void> {
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    // For SMS, we'd need to send a link for document upload
    const uploadLink = `${process.env.BASE_URL}/upload/${activeThread.loadId}/${driver.id}`;
    
    await this.sendSMS(phoneNumber, 
      `📄 To send documents for this load, please use this link: ${uploadLink}\n\nThis link will allow you to upload documents directly to the load files.`);
  }

  private async handleLocationRequestViaSMS(phoneNumber: string, driver: Driver): Promise<void> {
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    // For SMS, request location via Google Maps link or coordinates
    const locationLink = `${process.env.BASE_URL}/location/${activeThread.loadId}/${driver.id}`;
    
    await this.sendSMS(phoneNumber, 
      `📍 Please share your location using this link: ${locationLink}\n\nOr reply with your current address or coordinates.`);
  }

  private async handleQuickReplyCommand(phoneNumber: string, driver: Driver, command: string): Promise<void> {
    let templateKey = '';
    let displayText = '';
    let messageTemplate = '';

    // Map SMS commands to status updates
    if (command.includes('ARRIVED')) {
      templateKey = 'arrived';
      displayText = 'Arrived at pickup location';
      messageTemplate = 'Driver has arrived at the pickup location';
    } else if (command.includes('LOADED')) {
      templateKey = 'loaded';
      displayText = 'Load picked up and secured';
      messageTemplate = 'Load has been picked up and is secured for transport';
    } else if (command.includes('ENROUTE')) {
      templateKey = 'enroute';
      displayText = 'En route to delivery';
      messageTemplate = 'Driver is en route to the delivery location';
    } else if (command.includes('DELIVERED')) {
      templateKey = 'delivered';
      displayText = 'Load delivered successfully';
      messageTemplate = 'Load has been delivered successfully';
    } else if (command.includes('ISSUE')) {
      templateKey = 'issue';
      displayText = 'Reporting an issue';
      messageTemplate = 'Driver is reporting an issue with the load';
    } else if (command.includes('HELP')) {
      await this.sendSMSHelp(phoneNumber, driver);
      return;
    } else if (command.includes('STATUS')) {
      await this.sendCurrentStatus(phoneNumber, driver);
      return;
    } else if (command.includes('LOCATION')) {
      await this.handleLocationRequestViaSMS(phoneNumber, driver);
      return;
    } else {
      await this.sendSMS(phoneNumber, "❓ Unknown command. Reply HELP for available commands.");
      return;
    }

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendSMS(phoneNumber, "No active load found for status update.");
      return;
    }

    // Create message record for the status update
    await this.createMessageRecord({
      threadId: activeThread.id,
      loadId: activeThread.loadId,
      senderId: driver.id,
      senderRole: 'driver',
      senderName: driver.name,
      messageType: 'status_update',
      textContent: messageTemplate,
      smsMessageId: '',
      metadata: {
        templateKey: templateKey,
        category: 'status_update',
        phoneNumber: phoneNumber
      }
    });

    await this.sendSMS(phoneNumber, `✅ Status updated: ${displayText}`);
    
    await this.logCommunication(activeThread.loadId, activeThread.id, 'status_updated', driver.id, 'driver', {
      statusType: templateKey,
      statusMessage: messageTemplate
    });
  }

  private async handleCallbackQuery(callbackQuery: TelegramBot.CallbackQuery): Promise<void> {
    if (!callbackQuery.data || !callbackQuery.from) return;

    const telegramId = callbackQuery.from.id.toString();
    const driver = await storage.getDriverByTelegramId(telegramId);
    
    if (!driver) return;

    // Parse callback data
    const [action, ...params] = callbackQuery.data.split('_');
    
    switch (action) {
      case 'quickreply':
        await this.handleQuickReplyCallback(callbackQuery, driver, params[0]);
        break;
      case 'sendlocation':
        await this.requestLocationFromDriver(callbackQuery.message?.chat.id, driver);
        break;
      default:
        console.log('Unknown callback action:', action);
    }

    // Answer the callback query to remove loading state
    await this.bot?.answerCallbackQuery(callbackQuery.id);
  }

  private async handleQuickReplyCallback(
    callbackQuery: TelegramBot.CallbackQuery, 
    driver: Driver, 
    templateKey: string
  ): Promise<void> {
    const template = await this.getQuickReplyTemplate(templateKey);
    if (!template || !callbackQuery.message) return;

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    // Create message record for the status update
    await this.createMessageRecord({
      threadId: activeThread.id,
      loadId: activeThread.loadId,
      senderId: driver.id,
      senderRole: 'driver',
      senderName: driver.name,
      messageType: 'status_update',
      textContent: template.messageTemplate,
      telegramMessageId: callbackQuery.message.message_id.toString(),
      telegramChatId: callbackQuery.message.chat.id.toString(),
      metadata: {
        templateKey: template.templateKey,
        category: template.category,
        triggeredBy: 'callback'
      }
    });

    await this.sendMessage(callbackQuery.message.chat.id, `✅ ${template.displayText}`);
    
    await this.logCommunication(activeThread.loadId, activeThread.id, 'status_updated', driver.id, 'driver', {
      statusType: template.templateKey,
      statusMessage: template.messageTemplate,
      triggeredBy: 'callback'
    });
  }

  private async findOrCreateActiveThread(driver: Driver): Promise<LoadCommunicationThread | null> {
    // Get driver's active load
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
        loadNumber: driverLoad.loadNumber
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

  private async downloadAndUploadFile(fileId: string, type: 'image' | 'document', caption?: string): Promise<string> {
    if (!this.bot) throw new Error('Bot not initialized');

    // Get file info from Telegram
    const file = await this.bot.getFile(fileId);
    const fileStream = this.bot.getFileStream(fileId);
    
    // Generate upload URL from object storage
    const uploadURL = await this.objectStorageService.getObjectEntityUploadURL();
    
    // Upload stream to object storage
    // Note: This is a simplified version - you'd need to implement actual stream upload
    const response = await fetch(uploadURL, {
      method: 'PUT',
      body: fileStream,
      headers: {
        'Content-Type': type === 'image' ? 'image/jpeg' : 'application/octet-stream'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to upload file to object storage');
    }

    return uploadURL.split('?')[0]; // Return URL without query params
  }

  private async sendQuickReplyOptions(phoneNumber: string, loadId: string): Promise<void> {
    const quickCommands = [
      '📍 Reply ARRIVED when you reach pickup',
      '📦 Reply LOADED when load is secured',
      '🚛 Reply ENROUTE when heading to delivery',
      '✅ Reply DELIVERED when complete',
      '⚠️ Reply ISSUE if there are problems',
      '📍 Reply LOCATION to share your location',
      '❓ Reply HELP for more commands'
    ];

    const message = `🔄 Quick commands available:\n\n${quickCommands.join('\n')}`;
    await this.sendSMS(phoneNumber, message);
  }

  private async sendSMSHelp(phoneNumber: string, driver: Driver): Promise<void> {
    const helpMessage = `📱 SMS Commands for ${driver.name}:\n\n` +
      `• ARRIVED - At pickup location\n` +
      `• LOADED - Load secured\n` +
      `• ENROUTE - Heading to delivery\n` +
      `• DELIVERED - Load delivered\n` +
      `• ISSUE - Report problems\n` +
      `• LOCATION - Share location\n` +
      `• STATUS - Check current load\n` +
      `• HELP - Show this message\n\n` +
      `Send any other message to contact dispatch directly.`;
    
    await this.sendSMS(phoneNumber, helpMessage);
  }

  private async sendCurrentStatus(phoneNumber: string, driver: Driver): Promise<void> {
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendSMS(phoneNumber, "No active load assigned.");
      return;
    }

    const load = await storage.getLoad(activeThread.loadId);
    if (!load) {
      await this.sendSMS(phoneNumber, "Load information not found.");
      return;
    }

    const statusMessage = `📦 Current Load: ${load.loadNumber}\n` +
      `📍 From: ${load.pickupAddress}\n` +
      `📍 To: ${load.deliveryAddress}\n` +
      `💰 Rate: $${(load.rate || 0) * 0.85}\n` +
      `📅 Status: ${load.status}`;
    
    await this.sendSMS(phoneNumber, statusMessage);
  }

  private async requestLocationFromDriver(chatId: number | undefined, driver: Driver): Promise<void> {
    if (!chatId) return;

    await this.sendMessage(chatId, '📍 Please share your current location:', {
      reply_markup: {
        keyboard: [[{
          text: '📍 Share Location',
          request_location: true
        }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    });
  }

  private async getQuickReplyTemplate(templateKey: string): Promise<QuickReplyTemplate | null> {
    const templates = await storage.getAllQuickReplyTemplates();
    return templates.find(t => t.templateKey === templateKey && t.isActive) || null;
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
      details,
      timestamp: new Date()
    });
  }

  // Dispatch methods for sending messages to drivers
  
  async sendMessageToDriver(driverId: string, message: string): Promise<void> {
    try {
      const driver = await storage.getDriver(driverId);
      if (!driver?.phoneNumber) {
        console.log(`⚠️ Driver ${driverId} has no phone number - cannot send message`);
        return;
      }

      await this.sendSMS(driver.phoneNumber, message);
      console.log(`✅ Message sent to driver ${driver.name} (${driverId})`);
    } catch (error) {
      console.error(`❌ Failed to send message to driver ${driverId}:`, error);
    }
  }

  async sendLoadUpdateToDriver(loadId: string, message: string): Promise<void> {
    try {
      // Get the load to find the assigned driver
      const load = await storage.getLoad(loadId);
      if (!load?.driverId) {
        console.log(`⚠️ Load ${loadId} has no assigned driver - cannot send message`);
        return;
      }

      const driver = await storage.getDriver(load.driverId);
      if (!driver?.phoneNumber) {
        console.log(`⚠️ Driver ${load.driverId} has no phone number - cannot send message`);
        return;
      }

      const formattedMessage = `📦 Load ${load.loadNumber}\n\n💬 Message from Dispatch:\n${message}`;
      
      await this.sendSMS(driver.phoneNumber, formattedMessage);
      console.log(`✅ Load update sent to driver ${driver.name} for load ${load.loadNumber}`);
    } catch (error) {
      console.error(`❌ Failed to send load update for ${loadId}:`, error);
    }
  }

  private async sendSMS(phoneNumber: string, text: string): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ Communication service not running - message not sent');
      return;
    }
    
    try {
      const result = await smsService.sendSMS({
        to: phoneNumber,
        body: text
      });
      
      if (result.success) {
        console.log(`📱 SMS sent to ${phoneNumber}`);
      } else {
        console.error(`❌ Failed to send SMS to ${phoneNumber}: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Failed to send SMS:', error);
    }
  }

  async shutdown(): Promise<void> {
    this.isRunning = false;
    this.incomingMessageQueue = [];
    console.log('✅ SMS Communication Service shutdown complete');
  }
}

export const smsCommunicationService = new SmsCommunicationService();

// For backward compatibility, export with old name
export const telegramCommunicationService = smsCommunicationService;