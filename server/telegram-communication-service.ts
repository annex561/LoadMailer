import TelegramBot from "node-telegram-bot-api";
import { storage } from "./storage";
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
} from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export class TelegramCommunicationService {
  private bot: TelegramBot | null = null;
  private isRunning = false;
  private objectStorageService: ObjectStorageService;

  constructor() {
    this.objectStorageService = new ObjectStorageService();
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing Telegram Communication Service...');
      
      if (!TELEGRAM_TOKEN) {
        console.log('⚠️ Telegram communication disabled - missing TELEGRAM_BOT_TOKEN');
        return;
      }

      // Use shared bot instance from TelegramLoadService to avoid conflicts
      console.log('📡 Accessing shared Telegram bot instance...');
      
      // Get shared bot instance from global singleton
      const sharedBot = (globalThis as any).__telegramBotSingleton?.bot;
      if (sharedBot) {
        this.bot = sharedBot;
        console.log('✅ Using shared Telegram bot instance for communication');
        
        // Set up communication-specific handlers
        this.setupCommunicationHandlers();
      } else {
        console.log('⚠️ No shared bot instance found - communication handlers will be added when bot is available');
      }
      
      this.isRunning = true;
      console.log('✅ Telegram Communication Service initialized');
    } catch (error) {
      console.error('Failed to initialize Telegram communication service:', error);
    }
  }

  private setupCommunicationHandlers(): void {
    if (!this.bot) return;

    // Handle text messages from drivers
    this.bot.on('message', async (msg) => {
      try {
        await this.handleIncomingMessage(msg);
      } catch (error) {
        console.error('Error handling incoming message:', error);
      }
    });

    // Handle photo messages
    this.bot.on('photo', async (msg) => {
      try {
        await this.handlePhotoMessage(msg);
      } catch (error) {
        console.error('Error handling photo message:', error);
      }
    });

    // Handle document messages
    this.bot.on('document', async (msg) => {
      try {
        await this.handleDocumentMessage(msg);
      } catch (error) {
        console.error('Error handling document message:', error);
      }
    });

    // Handle location messages
    this.bot.on('location', async (msg) => {
      try {
        await this.handleLocationMessage(msg);
      } catch (error) {
        console.error('Error handling location message:', error);
      }
    });

    // Handle callback queries from inline buttons
    this.bot.on('callback_query', async (callbackQuery) => {
      try {
        await this.handleCallbackQuery(callbackQuery);
      } catch (error) {
        console.error('Error handling callback query:', error);
      }
    });
  }

  private async handleIncomingMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from || !msg.text) return;

    const telegramId = msg.from.id.toString();
    const driver = await storage.getDriverByTelegramId(telegramId);
    
    if (!driver) {
      await this.sendMessage(msg.chat.id, 
        "I don't recognize you as a registered driver. Please contact dispatch for assistance.");
      return;
    }

    // Check if this is a quick reply command
    if (msg.text.startsWith('/')) {
      await this.handleQuickReplyCommand(msg, driver);
      return;
    }

    // Find active communication thread for this driver
    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendMessage(msg.chat.id, 
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
      textContent: msg.text,
      telegramMessageId: msg.message_id.toString(),
      telegramChatId: msg.chat.id.toString(),
      metadata: {}
    });

    // Send acknowledgment with quick reply options
    await this.sendQuickReplyOptions(msg.chat.id, activeThread.loadId);
    
    // Log communication activity
    await this.logCommunication(activeThread.loadId, activeThread.id, 'message_sent', driver.id, 'driver', {
      messageType: 'text',
      messageLength: msg.text.length
    });
  }

  private async handlePhotoMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from || !msg.photo) return;

    const telegramId = msg.from.id.toString();
    const driver = await storage.getDriverByTelegramId(telegramId);
    
    if (!driver) return;

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    try {
      // Get the highest resolution photo
      const photo = msg.photo[msg.photo.length - 1];
      
      // Download and upload to object storage
      const fileUrl = await this.downloadAndUploadFile(photo.file_id, 'image', msg.caption);
      
      // Create message record
      const message = await this.createMessageRecord({
        threadId: activeThread.id,
        loadId: activeThread.loadId,
        senderId: driver.id,
        senderRole: 'driver',
        senderName: driver.name,
        messageType: 'image',
        textContent: msg.caption || '',
        telegramMessageId: msg.message_id.toString(),
        telegramChatId: msg.chat.id.toString(),
        metadata: {
          fileId: photo.file_id,
          fileSize: photo.file_size,
          width: photo.width,
          height: photo.height
        }
      });

      // Create attachment record
      await storage.createMessageAttachment({
        messageId: message.id,
        loadId: activeThread.loadId,
        attachmentType: 'image',
        fileName: `photo_${Date.now()}.jpg`,
        fileUrl: fileUrl,
        fileSize: photo.file_size,
        mimeType: 'image/jpeg',
        telegramFileId: photo.file_id,
        telegramFileUniqueId: photo.file_unique_id,
        width: photo.width,
        height: photo.height,
        caption: msg.caption || ''
      });

      await this.sendMessage(msg.chat.id, "📸 Photo received and uploaded to load documentation.");
      
      await this.logCommunication(activeThread.loadId, activeThread.id, 'attachment_uploaded', driver.id, 'driver', {
        attachmentType: 'image',
        fileSize: photo.file_size
      });

    } catch (error) {
      console.error('Error handling photo:', error);
      await this.sendMessage(msg.chat.id, "❌ Failed to upload photo. Please try again.");
    }
  }

  private async handleDocumentMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from || !msg.document) return;

    const telegramId = msg.from.id.toString();
    const driver = await storage.getDriverByTelegramId(telegramId);
    
    if (!driver) return;

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    try {
      const document = msg.document;
      
      // Download and upload to object storage
      const fileUrl = await this.downloadAndUploadFile(document.file_id, 'document', document.file_name);
      
      // Create message record
      const message = await this.createMessageRecord({
        threadId: activeThread.id,
        loadId: activeThread.loadId,
        senderId: driver.id,
        senderRole: 'driver',
        senderName: driver.name,
        messageType: 'document',
        textContent: msg.caption || '',
        telegramMessageId: msg.message_id.toString(),
        telegramChatId: msg.chat.id.toString(),
        metadata: {
          fileId: document.file_id,
          fileName: document.file_name,
          fileSize: document.file_size,
          mimeType: document.mime_type
        }
      });

      // Create attachment record
      await storage.createMessageAttachment({
        messageId: message.id,
        loadId: activeThread.loadId,
        attachmentType: 'document',
        fileName: document.file_name || `document_${Date.now()}`,
        fileUrl: fileUrl,
        fileSize: document.file_size,
        mimeType: document.mime_type || 'application/octet-stream',
        telegramFileId: document.file_id,
        telegramFileUniqueId: document.file_unique_id,
        caption: msg.caption || ''
      });

      await this.sendMessage(msg.chat.id, `📄 Document "${document.file_name}" received and uploaded to load files.`);
      
      await this.logCommunication(activeThread.loadId, activeThread.id, 'attachment_uploaded', driver.id, 'driver', {
        attachmentType: 'document',
        fileName: document.file_name,
        fileSize: document.file_size
      });

    } catch (error) {
      console.error('Error handling document:', error);
      await this.sendMessage(msg.chat.id, "❌ Failed to upload document. Please try again.");
    }
  }

  private async handleLocationMessage(msg: TelegramBot.Message): Promise<void> {
    if (!msg.from || !msg.location) return;

    const telegramId = msg.from.id.toString();
    const driver = await storage.getDriverByTelegramId(telegramId);
    
    if (!driver) return;

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) return;

    // Create message record with location data
    await this.createMessageRecord({
      threadId: activeThread.id,
      loadId: activeThread.loadId,
      senderId: driver.id,
      senderRole: 'driver',
      senderName: driver.name,
      messageType: 'location',
      textContent: '📍 Driver location shared',
      telegramMessageId: msg.message_id.toString(),
      telegramChatId: msg.chat.id.toString(),
      metadata: {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        timestamp: new Date().toISOString()
      }
    });

    await this.sendMessage(msg.chat.id, "📍 Location shared with dispatch.");
    
    await this.logCommunication(activeThread.loadId, activeThread.id, 'message_sent', driver.id, 'driver', {
      messageType: 'location',
      coordinates: [msg.location.latitude, msg.location.longitude]
    });
  }

  private async handleQuickReplyCommand(msg: TelegramBot.Message, driver: Driver): Promise<void> {
    const command = msg.text?.replace('/', '');
    if (!command) return;

    const template = await this.getQuickReplyTemplate(command);
    if (!template) {
      await this.sendMessage(msg.chat.id, "❓ Unknown command. Use the buttons provided for quick updates.");
      return;
    }

    const activeThread = await this.findOrCreateActiveThread(driver);
    if (!activeThread) {
      await this.sendMessage(msg.chat.id, "No active load found for status update.");
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
      textContent: template.messageTemplate,
      telegramMessageId: msg.message_id.toString(),
      telegramChatId: msg.chat.id.toString(),
      metadata: {
        templateKey: template.templateKey,
        category: template.category
      }
    });

    await this.sendMessage(msg.chat.id, `✅ Status updated: ${template.displayText}`);
    
    await this.logCommunication(activeThread.loadId, activeThread.id, 'status_updated', driver.id, 'driver', {
      statusType: template.templateKey,
      statusMessage: template.messageTemplate
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

  private async sendQuickReplyOptions(chatId: number, loadId: string): Promise<void> {
    const templates = await storage.getQuickReplyTemplatesForDriver();
    
    if (templates.length === 0) return;

    const keyboard = templates.map(template => ({
      text: template.displayText,
      callback_data: `quickreply_${template.templateKey}`
    }));

    // Group buttons in rows of 2
    const inlineKeyboard = [];
    for (let i = 0; i < keyboard.length; i += 2) {
      inlineKeyboard.push(keyboard.slice(i, i + 2));
    }

    // Add location sharing button
    inlineKeyboard.push([{
      text: '📍 Share Location',
      callback_data: 'sendlocation'
    }]);

    await this.sendMessage(chatId, '🔄 Quick actions available:', {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
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
      if (!driver?.telegramId) {
        console.log(`⚠️ Driver ${driverId} has no Telegram ID - cannot send message`);
        return;
      }

      await this.sendMessage(parseInt(driver.telegramId), message);
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
      if (!driver?.telegramId) {
        console.log(`⚠️ Driver ${load.driverId} has no Telegram ID - cannot send message`);
        return;
      }

      const formattedMessage = `📦 **Load ${load.loadNumber}**\n\n💬 **Message from Dispatch:**\n${message}`;
      
      await this.sendMessage(parseInt(driver.telegramId), formattedMessage, { parse_mode: 'Markdown' });
      console.log(`✅ Load update sent to driver ${driver.name} for load ${load.loadNumber}`);
    } catch (error) {
      console.error(`❌ Failed to send load update for ${loadId}:`, error);
    }
  }

  private async sendMessage(chatId: number, text: string, options?: any): Promise<void> {
    // Delegate to main telegram service instead of using separate bot instance
    if (!this.isRunning) return;
    
    try {
      // Import and use the main telegram service
      const { telegramLoadService } = await import('./routes');
      if (telegramLoadService && telegramLoadService.isInitialized()) {
        const bot = telegramLoadService.getBot();
        if (bot) {
          await bot.sendMessage(chatId, text, options);
          console.log('📱 Message sent via main telegram service');
        } else {
          console.log('⚠️ Main telegram bot not available');
        }
      } else {
        console.log('⚠️ Main telegram service not initialized');
      }
    } catch (error) {
      console.error('Failed to send message via main telegram service:', error);
    }
  }

  async shutdown(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stopPolling();
        this.bot = null;
      } catch (error) {
        console.error('Error shutting down Telegram communication service:', error);
      }
    }
    this.isRunning = false;
    console.log('✅ Telegram Communication Service shutdown complete');
  }
}

export const telegramCommunicationService = new TelegramCommunicationService();