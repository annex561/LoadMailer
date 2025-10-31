import TelegramBot from "node-telegram-bot-api";
import { storage } from "./storage";
import { randomUUID } from "crypto";
import { canHandleEquipmentType } from "@shared/equipment-types";
import type { LoadWithRelations, Driver, LanePreference, AvoidLocation, TelegramBotConfig, LoadOffer } from "@shared/schema";

// Bot configuration - use environment variables with fallbacks  
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DISPATCHER_ID = process.env.DISPATCHER_CHAT_ID || '';

export class TelegramLoadService {
  private bot: TelegramBot | null = null;
  private config: TelegramBotConfig | null = null;
  private isRunning = false;
  private isRestarting = false;
  private isStartingPolling = false;
  private restartTimeout: NodeJS.Timeout | null = null;
  private messageQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastMessageTime = 0;
  private readonly MESSAGE_DELAY = 1500; // 1.5 seconds between messages to avoid rate limiting
  
  // Batch processing properties
  private loadBatchQueue: LoadWithRelations[] = [];
  private isBatchProcessing = false;
  private readonly BATCH_SIZE = 3;
  private readonly BATCH_INTERVAL = 30000; // 30 seconds between batches

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Telegram Load Dispatcher...');
      
      // Check if required environment variables are available
      if (!TELEGRAM_TOKEN || !DISPATCHER_ID) {
        console.log('⚠️ Telegram service disabled - missing TELEGRAM_BOT_TOKEN or DISPATCHER_CHAT_ID');
        return;
      }

      // SINGLETON GUARD: Prevent multiple bot instances globally
      const instanceId = `telegram-bot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ownerStack = new Error().stack;
      
      if ((globalThis as any).__telegramBotSingleton) {
        const existing = (globalThis as any).__telegramBotSingleton;
        console.error(`❌ TELEGRAM BOT CONFLICT DETECTED!`);
        console.error(`🔍 Existing instance: ${existing.instanceId}`);
        console.error(`🔍 Existing owner:`, existing.ownerStack);
        console.error(`🔍 New attempt from:`, ownerStack);
        console.error(`🚫 BLOCKING duplicate bot creation - using existing instance`);
        this.bot = existing.bot;
        this.isRunning = existing.isRunning;
        return;
      }
      
      console.log(`🆔 Creating singleton Telegram bot instance: ${instanceId}`);

      // Stop any existing bot instance first to prevent 409 conflicts
      await this.shutdown();
      
      // Initialize bot configuration
      await this.initializeBotConfig();
      
      // Create bot instance with enhanced error handling and single instance protection
      this.bot = new TelegramBot(TELEGRAM_TOKEN, { 
        polling: {
          interval: 2000, // Slower polling to reduce conflicts
          autoStart: false, // Don't auto-start to control initialization
        }
      });

      // Register singleton globally with ownership tracking
      (globalThis as any).__telegramBotSingleton = {
        bot: this.bot,
        instanceId,
        ownerStack,
        isRunning: false
      };

      // Clear any webhook state that might conflict with polling
      try {
        await this.bot.deleteWebhook({ drop_pending_updates: false });
        const botInfo = await this.bot.getMe();
        console.log(`🤖 Bot authenticated: @${botInfo.username} (${botInfo.first_name})`);
        console.log(`🆔 Instance ID: ${instanceId}`);
      } catch (error) {
        console.warn('⚠️ Could not clear webhook state:', error);
      }
      
      // Add error handling for bot - use safe restart without overlap
      this.bot.on('error', (error) => {
        console.error('Telegram bot error:', error);
        if (error.message?.includes('409')) {
          console.log('🔄 Bot conflict detected - attempting safe restart...');
          this.safeRestartPolling();
        }
      });
      
      this.bot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error);
        if (error.message?.includes('409')) {
          console.log('🔄 Polling conflict detected - attempting safe restart...');
          this.safeRestartPolling();
        }
      });
      
      // Start polling manually with retry logic
      await this.startPollingWithRetry();
      
      // Start message queue processor
      this.startQueueProcessor();
      
      // Set up command handlers
      this.setupCommandHandlers();
      
      // Initialize default data
      await this.initializeDefaultData();
      
      this.isRunning = true;
      console.log('✅ Telegram Load Dispatcher initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Telegram service:', error);
      // Don't throw error - just log it to prevent app from failing to start
    }
  }

  private startQueueProcessor(): void {
    if (this.isProcessingQueue) return;
    
    this.isProcessingQueue = true;
    const processQueue = async () => {
      while (this.messageQueue.length > 0 && this.isRunning) {
        const now = Date.now();
        const timeSinceLastMessage = now - this.lastMessageTime;
        
        if (timeSinceLastMessage < this.MESSAGE_DELAY) {
          const delay = this.MESSAGE_DELAY - timeSinceLastMessage;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const messageFunction = this.messageQueue.shift();
        if (messageFunction) {
          try {
            await messageFunction();
            this.lastMessageTime = Date.now();
          } catch (error: any) {
            console.error('Error sending Telegram message:', error);
            // Skip rate limited messages to prevent getting stuck
            if (error?.code === 429) {
              console.log('Rate limit hit, waiting longer...');
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }
      }
      
      this.isProcessingQueue = false;
      
      // Restart queue processor if there are more messages
      if (this.messageQueue.length > 0) {
        setTimeout(() => this.startQueueProcessor(), 100);
      }
    };
    
    processQueue();
  }

  private queueMessage(messageFunction: () => Promise<any>): void {
    this.messageQueue.push(messageFunction);
    if (!this.isProcessingQueue) {
      this.startQueueProcessor();
    }
  }

  private async startPollingWithRetry(): Promise<void> {
    // Prevent re-entry during startup
    if (this.isStartingPolling) {
      console.log('⚠️ Polling startup already in progress, skipping...');
      return;
    }
    
    this.isStartingPolling = true;
    let retries = 0;
    const maxRetries = 3;
    
    try {
      while (retries < maxRetries && !this.isRunning) {
        try {
          console.log(`🚀 Starting Telegram bot polling (attempt ${retries + 1}/${maxRetries})...`);
          await this.bot?.startPolling();
          console.log('✅ Telegram bot polling started successfully');
          this.isRunning = true; // Set immediately after successful start
          
          // Clear any pending restart timeouts on successful start
          if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
          }
          
          return;
        } catch (error: any) {
          console.error(`❌ Failed to start polling (attempt ${retries + 1}):`, error);
          retries++;
          
          if (error.message?.includes('409')) {
            console.log('🔄 Bot instance conflict - waiting 10 seconds before retry...');
            await new Promise(resolve => setTimeout(resolve, 10000));
          } else {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      }
      
      if (retries >= maxRetries) {
        console.error('❌ Failed to start Telegram bot after maximum retries');
      }
    } finally {
      this.isStartingPolling = false;
    }
  }

  private async safeRestartPolling(): Promise<void> {
    // Prevent overlapping restarts with debouncing
    if (this.isRestarting) {
      console.log('⚠️ Restart already in progress, skipping...');
      return;
    }
    
    // Clear any existing restart timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    
    // Debounce restarts - only allow one every 10 seconds
    this.restartTimeout = setTimeout(async () => {
      if (this.isRestarting || !this.bot) return;
      
      this.isRestarting = true;
      console.log('🔄 Safe restart: stopping and restarting polling on same bot instance...');
      
      try {
        // Only stop and start polling - don't recreate bot instance
        await this.bot.stopPolling();
        console.log('✅ Polling stopped');
        
        // Brief pause to ensure clean state
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Restart polling on the same bot instance
        await this.bot.startPolling();
        console.log('✅ Polling restarted successfully');
        
        this.isRunning = true;
      } catch (error) {
        console.error('Failed to restart polling:', error);
        this.isRunning = false;
      } finally {
        this.isRestarting = false;
        this.restartTimeout = null;
      }
    }, 10000); // 10 second debounce
  }

  // Legacy method kept for compatibility but replaced with safeRestartPolling
  private async restartBot(): Promise<void> {
    console.log('🔄 Legacy restart called - using safe restart instead...');
    return this.safeRestartPolling();
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Telegram service...');
    this.isRunning = false;
    this.isRestarting = false;
    this.isStartingPolling = false;
    
    // Clear any pending restart timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    
    try {
      if (this.bot) {
        await this.bot.stopPolling();
        this.bot.removeAllListeners();
        this.bot = null;
      }
      
      // Clear message queue
      this.messageQueue = [];
      this.isProcessingQueue = false;
      
      console.log('✅ Telegram service shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  // Public method for communication service to access bot instance
  getBot(): TelegramBot | null {
    return this.bot;
  }

  // Public method to check if service is initialized
  isInitialized(): boolean {
    return this.isRunning && this.bot !== null;
  }

  private startBatchProcessor(): void {
    if (this.isBatchProcessing) return;
    
    this.isBatchProcessing = true;
    const processBatches = async () => {
      while (this.loadBatchQueue.length > 0 && this.isRunning) {
        // Take up to 3 loads from the queue
        const batch = this.loadBatchQueue.splice(0, this.BATCH_SIZE);
        
        console.log(`🚛 PROCESSING BATCH: ${batch.length} loads - ${batch.map(l => l.loadNumber).join(', ')}`);
        
        // Process each load in the batch
        for (const load of batch) {
          await this.processSingleLoad(load);
        }
        
        console.log(`✅ BATCH COMPLETE: Sent ${batch.length} loads to drivers`);
        
        // Wait 30 seconds before processing next batch (if there are more loads)
        if (this.loadBatchQueue.length > 0) {
          console.log(`⏳ BATCH DELAY: Waiting 30 seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, this.BATCH_INTERVAL));
        }
      }
      
      this.isBatchProcessing = false;
      
      // Restart batch processor if more loads arrived
      if (this.loadBatchQueue.length > 0) {
        setTimeout(() => this.startBatchProcessor(), 100);
      }
    };
    
    processBatches();
  }

  private addLoadToBatch(load: LoadWithRelations): void {
    this.loadBatchQueue.push(load);
    console.log(`📥 BATCH QUEUE: Added ${load.loadNumber} (${this.loadBatchQueue.length}/3 in current batch)`);
    
    if (!this.isBatchProcessing) {
      this.startBatchProcessor();
    }
  }

  private async initializeBotConfig(): Promise<void> {
    // Check if bot config exists, if not create it
    const configs = await storage.getAllTelegramBotConfigs();
    if (configs.length === 0) {
      this.config = await storage.createTelegramBotConfig({
        botToken: TELEGRAM_TOKEN,
        dispatcherId: DISPATCHER_ID,
        botUsername: 'LAMPDispatchbot',
        responseTimeoutMinutes: 3,
        isActive: true
      });
    } else {
      this.config = configs[0];
    }
  }

  private async initializeDefaultData(): Promise<void> {
    // Initialize default lane preferences from the script
    const existingPreferences = await storage.getAllLanePreferences();
    if (existingPreferences.length === 0) {
      const defaultPreferences = [
        { fromStates: ['FL'], toStates: ['GA'], minRPM: 2.75 },
        { fromStates: ['FL', 'KY'], toStates: ['NC', 'SC'], minRPM: 2.6 },
        { fromStates: ['OH', 'PA'], toStates: ['MI'], minRPM: 2.85 }
      ];

      for (const pref of defaultPreferences) {
        await storage.createLanePreference({
          fromStates: pref.fromStates,
          toStates: pref.toStates,
          minRPM: pref.minRPM,
          isActive: true
        });
      }
      console.log('Created default lane preferences');
    }

    // Initialize avoid locations
    const existingAvoidLocations = await storage.getAllAvoidLocations();
    if (existingAvoidLocations.length === 0) {
      const avoidLocations = ['NYC', 'CA', 'Chicago'];
      for (const location of avoidLocations) {
        await storage.createAvoidLocation({
          location,
          type: location.length === 2 ? 'state' : 'city',
          isActive: true
        });
      }
      console.log('Created default avoid locations');
    }

    // Skip automatic driver telegram update - this was causing fake chat ID issues
    // Drivers will be updated when they actually connect via telegram bot
    console.log('Telegram service initialized - waiting for real driver connections');
    
    // Set test drivers to unavailable to prevent fake telegram messages
    // But preserve Annex Luberisse as he's a real driver
    const drivers = await storage.getAllDrivers();
    for (const driver of drivers) {
      // Keep Annex available as he's a real driver
      if (driver.id === '3ce898f4-6962-461f-a9ea-bb81cc7d4a6f') {
        console.log(`✅ Keeping Annex Luberisse available for load assignment`);
        continue;
      }
      
      // Set other test drivers to unavailable if they don't have proper Telegram setup
      if (!driver.telegramId || driver.telegramId.toString().startsWith('temp_')) {
        await storage.updateDriver(driver.id, {
          status: 'unavailable',
          telegramId: null,
          enableTelegramNotifications: false
        });
        console.log(`Set test driver ${driver.name} to unavailable to prevent fake telegram messages`);
      }
    }
  }

  private setupCommandHandlers(): void {
    if (!this.bot) return;

    // Enhanced message logging and response handling
    this.bot.on('message', async (msg: any) => {
      console.log(`📱 TELEGRAM MESSAGE RECEIVED: User ${msg.from?.first_name || 'Unknown'} (${msg.from?.id || 'no-id'}) Chat: ${msg.chat?.id || 'no-chat'} Text: "${msg.text || 'no-text'}"`);
      
      // Handle driver responses to get them engaged
      if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const userInfo = msg.from;
        const responseText = msg.text.toUpperCase().trim();
        
        console.log(`🔍 Processing response: "${responseText}" from ${userInfo?.first_name}`);
        
        if (responseText === 'YES' || responseText === 'Y') {
          // Driver is ready to register - connect them directly
          await this.handleDriverRegistration(chatId, userInfo);
        } else if (responseText === 'INFO' || responseText === 'HELP') {
          // Send information about how the system works - start with a question
          await this.bot?.sendMessage(chatId,
            `*Want to know how LAMP Logistics can help you earn more money?*\n\n` +
            `ℹ️ Here's exactly how it works:\n\n` +
            `1️⃣ *Complete Registration*\n` +
            `• Provide your driver details\n` +
            `• Set equipment preferences\n` +
            `• Add emergency contacts\n\n` +
            `2️⃣ *Receive Load Offers*\n` +
            `• Get matched Tennessee loads instantly\n` +
            `• See rate, miles, and pickup details\n` +
            `• Book with one click\n\n` +
            `3️⃣ *Start Earning*\n` +
            `• Track your assignments\n` +
            `• Update pickup/delivery status\n` +
            `• Get paid fast\n\n` +
            `*Ready to get started? Reply "YES" to begin registration!*`,
            { parse_mode: 'Markdown' }
          );
        } else if (responseText.startsWith('LINK ')) {
          // Handle linking existing driver accounts: "LINK email@example.com"
          const email = responseText.replace('LINK ', '').trim().toLowerCase();
          await this.linkExistingDriver(chatId, email, userInfo);
        } else {
          // General engagement response
          await this.bot?.sendMessage(chatId,
            `Thanks for your message! 👍\n\n` +
            `To get started receiving load offers:\n` +
            `• Reply "YES" to register as a driver\n` +
            `• Reply "INFO" to learn more\n` +
            `• **Existing drivers:** Type "LINK your@email.com" to connect your account\n\n` +
            `Tennessee freight loads are waiting for you!`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    });
    
    // Welcome message with automatic onboarding
    this.bot.onText(/\/start/, async (msg: any) => {
      if (!this.bot) return;
      
      const chatId = msg.chat.id;
      const userInfo = msg.from;
      
      console.log(`📱 NEW USER STARTED CHAT: ${userInfo?.first_name || 'Unknown'} ${userInfo?.last_name || ''} (ID: ${userInfo?.id}) Chat: ${chatId}`);
      
      try {
        // Send interactive welcome message that prompts for a response
        await this.bot.sendMessage(chatId, 
          `🚛 *Welcome to LAMP Logistics!*\n\n` +
          `Hi ${userInfo?.first_name || 'Driver'}! I'm your personal load dispatcher bot.\n\n` +
          `I'll help you:\n` +
          `• Receive instant load offers\n` +
          `• Book loads with one click\n` +
          `• Track your assignments\n` +
          `• Communicate with dispatch\n\n` +
          `*Are you ready to start receiving Tennessee freight loads?*\n\n` +
          `Please reply with "YES" to continue with registration, or "INFO" to learn more about how it works.`,
          { parse_mode: 'Markdown' }
        );
        
        console.log(`✅ Welcome message sent to ${userInfo?.first_name} (${chatId})`);

        // Automatically send onboarding invitation
        await this.sendAutoOnboarding(chatId, userInfo);
      } catch (error) {
        console.error(`❌ Error sending welcome message to ${chatId}:`, error);
      }
    });

    // LoadMailer Bot enhanced commands
    this.bot.onText(/\/bookload/, async (msg: any) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      console.log(`📱 Load booking request from ${msg.from?.first_name} (${chatId})`);
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await this.bot?.sendMessage(chatId, 
            `Please register as a driver first using /start command.`
          );
          return;
        }

        await this.bot?.sendMessage(chatId, 
          `📋 *Booking Request Received*\n\n` +
          `Your load booking request is being processed.\n` +
          `Dispatcher will confirm within 15 minutes.\n\n` +
          `Thank you ${driver.name}! 👍`,
          { parse_mode: 'Markdown' }
        );

        // Notify dispatcher with driver details
        if (this.config?.dispatcherId) {
          const dispatcherMessage = 
            `📞 *LOAD BOOKING REQUEST*\n\n` +
            `🚛 *Driver:* ${driver.name}\n` +
            `📱 *Phone:* ${driver.phone}\n` +
            `📍 *Location:* ${driver.city || 'Not specified'}\n` +
            `🚚 *Equipment:* ${driver.equipmentType}\n` +
            `⚖️ *Capacity:* ${driver.weightCapacity || 26000} lbs\n\n` +
            `*Action Required:* Call driver to confirm load details\n` +
            `[📞 Call Now](tel:${driver.phone})`;

          await this.bot?.sendMessage(this.config.dispatcherId, dispatcherMessage, {
            parse_mode: 'Markdown'
          });
          console.log(`✅ Sent booking notification to dispatcher`);
        }
      } catch (error) {
        console.error('Error handling bookload command:', error);
        await this.bot?.sendMessage(chatId, 'Error processing booking request. Please try again.');
      }
    });

    this.bot.onText(/\/decline/, async (msg: any) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      console.log(`📱 Load declined by ${msg.from?.first_name} (${chatId})`);
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        await this.bot?.sendMessage(chatId, 
          `✅ Load declined. Thanks for your response ${driver?.name || 'Driver'}!\n\n` +
          `We'll keep you in mind for the next suitable load. 👍`
        );
        console.log(`✅ Load declined by ${driver?.name || 'unknown'}`);
      } catch (error) {
        console.error('Error handling decline command:', error);
        await this.bot?.sendMessage(chatId, 'Response recorded. Thank you!');
      }
    });

    // Add location command
    this.bot.onText(/\/location/, async (msg: any) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await this.bot?.sendMessage(chatId, 'Driver not found. Please register first.');
          return;
        }

        await this.bot?.sendMessage(chatId, 
          `📍 *Share Your Location*\n\n` +
          `To get loads along your route, please share your current GPS location:\n\n` +
          `1️⃣ Tap the 📎 attachment button\n` +
          `2️⃣ Select "📍 Location"\n` +
          `3️⃣ Choose "Share Live Location" or "Send My Current Location"\n\n` +
          `This helps us match you with loads that are on your route!`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [
                [{ text: '📍 Share Location', request_location: true }]
              ],
              resize_keyboard: true,
              one_time_keyboard: true
            }
          }
        );
      } catch (error) {
        console.error('Error handling location command:', error);
        await this.bot?.sendMessage(chatId, 'Error requesting location. Please try again.');
      }
    });

    // Handle location messages for GPS tracking
    this.bot.on('location', async (msg: any) => {
      const chatId = msg.chat.id;
      const telegramId = msg.from?.id.toString();
      const location = msg.location;
      
      if (!location || !telegramId) return;
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await this.bot?.sendMessage(chatId, 'Driver not found. Please register first.');
          return;
        }

        // Update driver location
        await storage.createDriverLocation({
          driverId: driver.id,
          latitude: location.latitude,
          longitude: location.longitude,
          timestamp: new Date(),
          accuracy: location.horizontal_accuracy || 10,
          speed: null,
          heading: null,
          altitude: null,
          address: null,
          loadId: null,
          isActive: true,
          batteryLevel: null,
          signalStrength: null
        });

        console.log(`📍 GPS location updated for driver ${driver.name}: ${location.latitude}, ${location.longitude}`);
        
        await this.bot?.sendMessage(chatId, 
          `📍 *Location Updated*\n\n` +
          `Your GPS coordinates have been recorded.\n` +
          `We'll now match you with loads along your route!\n\n` +
          `📍 Lat: ${location.latitude.toFixed(4)}\n` +
          `📍 Lng: ${location.longitude.toFixed(4)}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling location update:', error);
        await this.bot?.sendMessage(chatId, 'Error updating location. Please try again.');
      }
    });

    // Handle callback queries from inline keyboard buttons
    this.bot.on('callback_query', async (callbackQuery: any) => {
      if (!this.bot || !callbackQuery.data) return;
      
      const data = callbackQuery.data;
      const telegramId = callbackQuery.from?.id.toString();
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;
      
      if (!telegramId || !chatId) return;

      try {
        // Answer callback query to remove loading state
        await this.bot.answerCallbackQuery(callbackQuery.id);

        if (data.startsWith('book_')) {
          const loadId = data.substring(5); // Remove 'book_' prefix
          await this.handleBookLoad(loadId, telegramId, chatId);
        } else if (data.startsWith('confirm_')) {
          const parts = data.substring(8).split('_'); // Remove 'confirm_' prefix
          const shortLoadId = parts[0];
          const shortDriverId = parts[1];
          await this.handleConfirmLoadShort(shortLoadId, shortDriverId, telegramId, chatId, messageId);
        } else if (data.startsWith('decline_') && data.includes('_')) {
          // This is a confirmation decline with driver ID
          const parts = data.substring(8).split('_'); // Remove 'decline_' prefix
          const shortLoadId = parts[0];
          const shortDriverId = parts[1];
          await this.handleDeclineConfirmationShort(shortLoadId, shortDriverId, telegramId, chatId, messageId);
        } else if (data.startsWith('decline_')) {
          // This is a simple load decline
          const loadId = data.substring(8); // Remove 'decline_' prefix (decline_ = 8 chars)
          await this.handleDeclineLoad(loadId, telegramId, chatId);
        } else if (data.startsWith('onsite_')) {
          const parts = data.substring(7).split('_');
          if (parts.length === 2) {
            const [shortLoadId, shortDriverId] = parts;
            await this.handleOnSiteConfirmation(shortLoadId, shortDriverId, telegramId, chatId, messageId);
          } else {
            console.error('Invalid onsite callback data format:', data);
          }
        } else if (data.startsWith('delay_') && !data.startsWith('delay_reason_')) {
          const parts = data.substring(6).split('_');
          if (parts.length === 2) {
            const [shortLoadId, shortDriverId] = parts;
            await this.handleDelayConfirmation(shortLoadId, shortDriverId, telegramId, chatId, messageId);
          } else {
            console.error('Invalid delay callback data format:', data);
          }
        } else if (data.startsWith('delay_reason_')) {
          const parts = data.substring(13).split('_');
          if (parts.length >= 3) {
            const reason = parts[0];
            const shortLoadId = parts[1];
            const shortDriverId = parts[2];
            await this.handleDelayReason(reason, shortLoadId, shortDriverId, telegramId, chatId, messageId);
          } else {
            console.error('Invalid delay reason callback data format:', data);
          }
        } else if (data === 'contact_support') {
          await this.bot.sendMessage(chatId, 
            `📞 *LAMP Logistics Support*\n\n` +
            `Need help? Contact our dispatch team:\n\n` +
            `📧 Email: dispatch@lamplogistics.com\n` +
            `📱 Phone: (855) 599-9983\n` +
            `⏰ Available: 24/7\n\n` +
            `Or just reply to this message and we'll assist you!`,
            { parse_mode: 'Markdown' }
          );
        } else if (data === 'how_it_works') {
          await this.bot.sendMessage(chatId,
            `ℹ️ *How LAMP Logistics Works*\n\n` +
            `1️⃣ *Complete Registration*\n` +
            `• Provide your driver details\n` +
            `• Set equipment preferences\n` +
            `• Add emergency contacts\n\n` +
            `2️⃣ *Receive Load Offers*\n` +
            `• Get matched loads instantly\n` +
            `• See rate, miles, and details\n` +
            `• Book with one click\n\n` +
            `3️⃣ *Start Earning*\n` +
            `• Track your assignments\n` +
            `• Update pickup/delivery status\n` +
            `• Get paid fast\n\n` +
            `Ready to get started? Click the registration link above!`,
            { parse_mode: 'Markdown' }
          );
        } else {
          console.log('Unknown callback query:', data);
        }
      } catch (error) {
        console.error('Error handling callback query:', error);
        this.bot.sendMessage(chatId, '❌ Error processing your request.');
      }
    });
  }

  // Main entry point - adds load to batch queue instead of processing immediately
  async processNewLoad(load: LoadWithRelations): Promise<boolean> {
    if (!this.bot || !this.config || !this.isRunning) {
      console.log('Telegram service not initialized, skipping load notification');
      return false;
    }

    // Add load to batch queue instead of processing immediately
    this.addLoadToBatch(load);
    return true;
  }

  // Process individual load (original processing logic)
  private async processSingleLoad(load: LoadWithRelations): Promise<boolean> {
    try {
      console.log(`🔍 Processing load ${load.loadNumber}: ${load.pickupAddress} → ${load.deliveryAddress} (${load.equipmentType})`);
      
      // Get eligible drivers based on location and preferences (skip lane checking for now)
      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      
      if (eligibleDrivers.length === 0) {
        console.log(`❌ No eligible drivers found for load ${load.loadNumber}`);
        return false;
      }

      console.log(`✅ Found ${eligibleDrivers.length} eligible drivers for load ${load.loadNumber}`);

      // Send load offers to eligible drivers sorted by proximity and match score
      for (const driverMatch of eligibleDrivers) {
        // For drivers with real telegram IDs (like Annex: 8391488425)
        if (driverMatch.driver.telegramId && !driverMatch.driver.telegramId.startsWith('temp_')) {
          console.log(`📱 REAL TELEGRAM OFFER: Sending ${load.loadNumber} to ${driverMatch.driver.name} (TelegramId: ${driverMatch.driver.telegramId})`);
          try {
            await this.sendLoadToDriver(load, driverMatch.driver, driverMatch.matchScore, driverMatch.distance);
          } catch (error) {
            console.error(`❌ Failed to send load ${load.loadNumber} to driver ${driverMatch.driver.name}:`, error);
            // If chat not found, disable notifications for this driver
            if (error instanceof Error && error.message.includes('chat not found')) {
              await storage.updateDriver(driverMatch.driver.id, {
                telegramId: null,
                enableTelegramNotifications: false
              });
              console.log(`❌ Disabled Telegram notifications for driver ${driverMatch.driver.name} - chat not found`);
            }
          }
        } else if (driverMatch.driver.telegramId?.startsWith('temp_')) {
          console.log(`📱 LOAD OFFER (simulated): ${load.loadNumber} to ${driverMatch.driver.name} (${driverMatch.matchScore}% match, ${driverMatch.distance}mi away)`);
          
          // Create a load offer record for tracking
          const { randomUUID } = await import('crypto');
          await storage.createLoadOffer({
            loadId: load.id,
            driverId: driverMatch.driver.id,
            status: 'simulated', // Special status for test drivers
            sentAt: new Date(),
            timeoutAt: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes from now
          });
        } else {
          console.log(`❌ Driver ${driverMatch.driver.name} has no telegram ID set`);
        }
      }

      console.log(`✅ Processed load ${load.loadNumber} for ${eligibleDrivers.length} drivers via Telegram`);
      console.log(`📱 Load ${load.loadNumber} sent to eligible drivers via Telegram`);
      return true;
    } catch (error) {
      console.error(`Error processing load ${load.loadNumber}:`, error);
      return false;
    }
  }

  private async matchesPreferredLane(load: LoadWithRelations): Promise<boolean> {
    try {
      // Always allow test loads and DAT loads for demonstration
      if (load.sourceBoard === 'test' || load.sourceBoard === 'dat') {
        return true;
      }

      // Extract states from addresses
      const originState = this.extractStateFromAddress(load.pickupAddress);
      const destinationState = this.extractStateFromAddress(load.deliveryAddress);
      
      if (!originState || !destinationState) {
        return false;
      }

      // Calculate rate per mile
      const rpm = load.rate && load.miles ? load.rate / load.miles : 0;

      // Check lane preferences
      const preferences = await storage.getAllLanePreferences();
      const matchingPreference = preferences.find(pref => {
        const fromStates = Array.isArray(pref.fromStates) ? pref.fromStates : [];
        const toStates = Array.isArray(pref.toStates) ? pref.toStates : [];
        
        const fromMatch = fromStates.includes(originState);
        const toMatch = toStates.includes(destinationState);
        const rpmMatch = rpm >= pref.minRPM;
        
        return fromMatch && toMatch && rpmMatch && pref.isActive;
      });

      if (!matchingPreference) {
        return false;
      }

      // Check avoid locations
      const avoidLocations = await storage.getAllAvoidLocations();
      const hasAvoidedLocation = avoidLocations.some(avoid => {
        if (!avoid.isActive) return false;
        
        const location = avoid.location.toLowerCase();
        const originText = load.pickupAddress.toLowerCase();
        const destinationText = load.deliveryAddress.toLowerCase();
        
        return originText.includes(location) || destinationText.includes(location);
      });

      return !hasAvoidedLocation;
    } catch (error) {
      console.error('Error matching preferred lane:', error);
      return false;
    }
  }

  private async getDriversNearLocation(location: string): Promise<Driver[]> {
    try {
      const allDrivers = await storage.getDriversWithTelegramEnabled();
      
      // For now, simple city-based matching
      // In production, you'd use proper geolocation services
      return allDrivers.filter(driver => {
        if (!driver.city) return false;
        
        const driverCity = driver.city.toLowerCase();
        const loadLocation = location.toLowerCase();
        
        // Check if driver city matches or is near the load location
        return driverCity.includes(loadLocation.split(',')[0].trim().toLowerCase()) ||
               loadLocation.includes(driverCity.split(',')[0].trim());
      });
    } catch (error) {
      console.error('Error getting drivers near location:', error);
      return [];
    }
  }

  private extractStateFromAddress(address: string): string | null {
    // Extract state abbreviation from address (e.g., "Atlanta, GA" -> "GA")
    const stateMatch = address.match(/,\s*([A-Z]{2})(?:\s|$)/);
    return stateMatch ? stateMatch[1] : null;
  }

  // Find eligible drivers based on location proximity and preferences
  private async findEligibleDriversByLocation(load: LoadWithRelations): Promise<Array<{driver: Driver, matchScore: number, distance: number}>> {
    try {
      // Get ALL available drivers for GPS-based matching
      const allDrivers = await storage.getDrivers();
      const availableDrivers = allDrivers.filter(driver => driver.status === 'available');
      console.log(`🚚 GPS MATCHING: Found ${availableDrivers.length} available drivers for load ${load.loadNumber}`);
      const eligibleDrivers: Array<{driver: Driver, matchScore: number, distance: number}> = [];

      for (const driver of availableDrivers) {
        if (!driver.city) continue;

        // Skip unavailable drivers immediately
        if (driver.status === 'unavailable') {
          console.log(`Skipping driver ${driver.name} - status: ${driver.status}`);
          continue;
        }

        // STRICT EQUIPMENT MATCHING FOR ANNEX - Exclude before any scoring
        if (driver.name === 'Annex Luberisse' && load.equipmentType === 'dry_van') {
          console.log(`🚫 STRICT FILTER: Skipping Annex Luberisse for dry_van load ${load.loadNumber} - only straight_box_truck loads allowed`);
          continue;
        }

        // Calculate proximity score and distance
        const proximity = await this.calculateDriverProximity(driver, load);
        console.log(`Driver ${driver.name} proximity check: distance=${proximity.distance}mi, city=${driver.city}, pickup=${load.pickupAddress}`);
        if (proximity.distance > 200) continue; // Increased from 150 to 200 miles for better coverage

        // Calculate overall match score
        const matchScore = await this.calculateDriverMatchScore(driver, load, proximity.distance);
        console.log(`Driver ${driver.name} match score for load ${load.loadNumber}: ${matchScore}% (distance: ${proximity.distance}mi, equipment: ${driver.equipmentType}/${load.equipmentType}, status: ${driver.status})`);
        if (matchScore < 25) continue; // Further reduced to 25% to allow more driver-load matches

        eligibleDrivers.push({
          driver,
          matchScore,
          distance: proximity.distance
        });
      }

      // Sort by match score and distance (higher score, closer distance = better)
      eligibleDrivers.sort((a, b) => {
        if (a.matchScore !== b.matchScore) {
          return b.matchScore - a.matchScore; // Higher score first
        }
        return a.distance - b.distance; // Closer distance first
      });

      console.log(`Found ${eligibleDrivers.length} eligible drivers for load ${load.loadNumber}`);
      return eligibleDrivers.slice(0, 5); // Limit to top 5 drivers
    } catch (error) {
      console.error('Error finding eligible drivers:', error);
      return [];
    }
  }

  // Calculate driver proximity to pickup location using GPS data when available
  private async calculateDriverProximity(driver: Driver, load: LoadWithRelations): Promise<{distance: number, isNearby: boolean}> {
    try {
      // First, try to get driver's current GPS location
      const driverLocations = await storage.getDriverLocationHistory(driver.id);
      const currentLocation = driverLocations.find(loc => loc.isActive && loc.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)); // Last 24 hours
      
      if (currentLocation) {
        console.log(`📍 Using GPS location for driver ${driver.name}: ${currentLocation.latitude}, ${currentLocation.longitude}`);
        
        // Get pickup coordinates
        const pickupCoords = await this.geocodeAddress(load.pickupAddress);
        
        if (pickupCoords) {
          // Calculate actual distance using GPS coordinates
          const distance = this.calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            pickupCoords.latitude,
            pickupCoords.longitude
          );
          console.log(`📏 GPS-based distance for ${driver.name}: ${distance} miles to ${load.pickupAddress}`);
          return { distance, isNearby: distance <= 150 }; // Within 150 miles
        }
      }
      
      // Fallback to city-based proximity calculation
      const driverCity = driver.city?.split(',')[0]?.trim().toLowerCase();
      const pickupCity = load.pickupAddress.split(',')[0]?.trim().toLowerCase();
      
      if (driverCity && pickupCity) {
        // Get coordinates for both cities if available
        const driverCoords = await this.geocodeAddress(driver.city || '');
        const pickupCoords = await this.geocodeAddress(load.pickupAddress);
        
        if (driverCoords && pickupCoords) {
          // Calculate actual distance using coordinates
          const distance = this.calculateDistance(
            driverCoords.latitude,
            driverCoords.longitude,
            pickupCoords.latitude,
            pickupCoords.longitude
          );
          return { distance, isNearby: distance <= 150 };
        }
        
        // Fallback to simple city matching - be more generous with proximity
        const isSameCity = driverCity === pickupCity;
        const isSameState = driver.city?.includes(load.pickupAddress.split(',')[1]?.trim() || '');
        
        if (isSameCity) return { distance: 15, isNearby: true };
        if (isSameState) return { distance: 75, isNearby: true };
        return { distance: 120, isNearby: false }; // More generous default distance
      }

      return { distance: 999, isNearby: false };
    } catch (error) {
      console.error('Error calculating driver proximity:', error);
      return { distance: 999, isNearby: false };
    }
  }

  // Calculate overall match score for driver-load combination
  private async calculateDriverMatchScore(driver: Driver, load: LoadWithRelations, distance: number): Promise<number> {
    let score = 0;
    let maxScore = 0;

    // Distance score (30% weight) - closer is better
    maxScore += 30;
    if (distance <= 25) score += 30;
    else if (distance <= 50) score += 25;
    else if (distance <= 100) score += 15;
    else if (distance <= 150) score += 8;

    // Equipment type match (25% weight) - STRICT MATCHING FOR ANNEX
    maxScore += 25;
    if (driver.equipmentType === load.equipmentType || !load.equipmentType) {
      score += 25;
    } else if (driver.name === 'Annex Luberisse') {
      // Annex gets EXACT equipment matching only - no cross-compatibility
      score += 0;
    } else if (canHandleEquipmentType(driver.equipmentType, load.equipmentType)) {
      score += 15; // Partial credit for compatible equipment using comprehensive system
    }

    // Load type preference match (15% weight)
    maxScore += 15;
    const driverLoadPrefs = driver.loadType || 'full_partial';
    const loadType = load.loadType || 'full';
    if (driverLoadPrefs === 'full_partial' || driverLoadPrefs === loadType) {
      score += 15;
    }

    // Weight capacity consideration (10% weight) - critical safety check
    maxScore += 10;
    const driverMaxWeight = driver.maxWeight || 26000;
    const loadWeight = (load as any).weight; // Load weight property may not be in the schema yet
    if (!loadWeight || loadWeight <= driverMaxWeight) {
      score += 10; // Full score if load weight is within driver's capacity
    } else if (loadWeight <= driverMaxWeight * 1.05) {
      score += 5; // Reduced score for slight overweight (5% tolerance)
    } else {
      // No score for significantly overweight loads - this should prevent offers
      score += 0;
    }

    // Length capacity match (5% weight)
    maxScore += 5;
    const driverMaxLength = driver.maxLength || 53;
    const loadLength = load.length;
    if (!loadLength || loadLength <= driverMaxLength) {
      score += 5;
    } else if (loadLength <= driverMaxLength * 1.1) {
      score += 2; // Allow 10% over length with reduced score
    }

    // Rate attractiveness (10% weight)
    maxScore += 10;
    const rpm = load.rate && load.miles ? load.rate / load.miles : 0;
    if (rpm >= 2.50) score += 10;
    else if (rpm >= 2.00) score += 8;
    else if (rpm >= 1.50) score += 5;

    // Driver availability (5% weight)
    maxScore += 5;
    if (driver.status === 'available') score += 5;
    else if (driver.status === 'on_route') score += 2;

    return Math.round((score / maxScore) * 100);
  }

  // Geocode address to get coordinates (placeholder implementation)
  private async geocodeAddress(address: string): Promise<{latitude: number, longitude: number} | null> {
    // In production, this would use a real geocoding service like Google Maps API
    // For now, return approximate coordinates for major cities
    const cityCoords: {[key: string]: {latitude: number, longitude: number}} = {
      'atlanta': { latitude: 33.7490, longitude: -84.3880 },
      'dallas': { latitude: 32.7767, longitude: -96.7970 },
      'los angeles': { latitude: 34.0522, longitude: -118.2437 },
      'chicago': { latitude: 41.8781, longitude: -87.6298 },
      'miami': { latitude: 25.7617, longitude: -80.1918 },
      'phoenix': { latitude: 33.4484, longitude: -112.0740 },
      'new york': { latitude: 40.7128, longitude: -74.0060 },
      'houston': { latitude: 29.7604, longitude: -95.3698 },
      'denver': { latitude: 39.7392, longitude: -104.9903 },
      'seattle': { latitude: 47.6062, longitude: -122.3321 },
      'boston': { latitude: 42.3601, longitude: -71.0589 },
      'las vegas': { latitude: 36.1699, longitude: -115.1398 }
    };

    const city = address.split(',')[0]?.trim().toLowerCase();
    return cityCoords[city] || null;
  }

  // Calculate distance between two coordinates in miles


  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // Calculate deadhead distance from driver location to pickup
  private async calculateDeadheadDistance(driver: Driver, load: LoadWithRelations): Promise<number> {
    // Simple approximate calculation - in production you'd use a geocoding service
    // For now, return a reasonable estimate based on the cities
    if (!driver.city || !load.pickupAddress) return 0;
    
    // Extract city/state from addresses for rough calculation
    const driverLocation = driver.city.toLowerCase();
    const pickupLocation = load.pickupAddress.toLowerCase();
    
    // If they're in the same city, assume low deadhead
    if (pickupLocation.includes(driverLocation.split(',')[0])) {
      return Math.floor(Math.random() * 25) + 5; // 5-30 miles
    }
    
    // Different cities - estimate based on common distances
    const stateDistances: Record<string, Record<string, number>> = {
      'atlanta': { 'miami': 650, 'charlotte': 240, 'jacksonville': 345, 'dallas': 780, 'houston': 800 },
      'miami': { 'atlanta': 650, 'orlando': 235, 'tampa': 280, 'jacksonville': 345 },
      'dallas': { 'houston': 240, 'atlanta': 780, 'phoenix': 880, 'denver': 780 },
      'chicago': { 'detroit': 280, 'milwaukee': 90, 'indianapolis': 185 },
      'los angeles': { 'phoenix': 370, 'las vegas': 270, 'san diego': 120 }
    };
    
    // Try to find a rough distance estimate
    for (const [city, distances] of Object.entries(stateDistances)) {
      if (driverLocation.includes(city)) {
        for (const [destination, distance] of Object.entries(distances)) {
          if (pickupLocation.includes(destination)) {
            return distance;
          }
        }
      }
    }
    
    // Default estimate for unknown routes
    return Math.floor(Math.random() * 200) + 50; // 50-250 miles
  }

  private async sendLoadToDriver(load: LoadWithRelations, driver: Driver, matchScore?: number, distance?: number): Promise<void> {
    if (!this.bot || !this.config || !driver.telegramId || !driver.enableTelegramNotifications) return;

    // Validate telegram ID format - should be numeric
    if (!/^\d+$/.test(driver.telegramId)) {
      console.log(`⚠️ Invalid telegram ID format for driver ${driver.name}: ${driver.telegramId}. Disabling notifications.`);
      await storage.updateDriver(driver.id, {
        telegramId: null,
        enableTelegramNotifications: false
      });
      return;
    }

    try {
      // Calculate deadhead distance for this driver and load
      const deadheadDistance = await this.calculateDeadheadDistance(driver, load);
      
      // Format load message (from script)
      const message = this.formatLoadMessage(load, matchScore, distance, deadheadDistance);
      
      // Send message with inline keyboard (removed Markdown parsing to fix format errors)
      const options = {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📦 BOOK NOW', callback_data: `book_${load.id}` },
              { text: '❌ DECLINE', callback_data: `decline_${load.id}` }
            ]
          ]
        }
      };

      const sentMessage = await this.bot.sendMessage(driver.telegramId, message, options);
      
      // Create load offer record
      const timeoutDate = new Date();
      timeoutDate.setMinutes(timeoutDate.getMinutes() + this.config.responseTimeoutMinutes);
      
      await storage.createLoadOffer({
        loadId: load.id,
        driverId: driver.id,
        telegramMessageId: sentMessage.message_id.toString(),
        status: 'pending',
        sentAt: new Date(),
        timeoutAt: timeoutDate
      });

      // Set timeout for automatic retry logic
      setTimeout(async () => {
        await this.handleLoadOfferTimeout(load, driver);
      }, this.config.responseTimeoutMinutes * 60 * 1000);

      console.log(`Sent load ${load.loadNumber} to driver ${driver.name} via Telegram`);
    } catch (error) {
      console.error(`Error sending load to driver ${driver.name}:`, error);
    }
  }

  private formatLoadMessage(load: LoadWithRelations, matchScore?: number, distance?: number, deadheadDistance?: number): string {
    // Calculate driver rate (10% less than posted rate)
    const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
    const rpm = driverRate && load.miles ? (driverRate / load.miles).toFixed(2) : 'N/A';
    const deadheadText = deadheadDistance ? ` (${Math.round(deadheadDistance)} mi deadhead)` : '';
    const matchText = matchScore ? `\n📊 *Match Score:* ${matchScore}%` : '';
    
    // Enhanced LoadMailer Bot formatting with professional styling
    return `✨ *New Load Available* ✨

📍 *From:* ${load.pickupAddress}
📍 *To:* ${load.deliveryAddress}

🛣 *Miles:* ${load.miles || 'TBD'} miles${deadheadText}
💡 *Weight:* ${load.weight?.toLocaleString() || 'TBD'} lbs
💵 *Rate:* $${driverRate.toLocaleString() || 'TBD'}
📞 *Contact:* ${load.contactPhone || load.company || 'Broker'}

📦 *Equipment:* ${load.equipmentType}
🏢 *Company:* ${load.company || 'Direct Shipper'}
💰 *Rate/Mile:* $${rpm}${matchText}

📅 *Schedule:*
• Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}
• Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}

${load.temperatureRequired ? '🌡️ *Temperature Controlled*\n' : ''}${load.specialInstructions ? `📝 *Instructions:* ${load.specialInstructions}\n` : ''}Tap below:
✅ /bookload
❌ /decline

*Load #:* ${load.loadNumber}`;
  }

  async sendTestLoad(): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running');
      return false;
    }

    try {
      // Create a specific test load with straight_box_truck equipment for Annex
      const testLoadData = {
        loadNumber: `TEST-${Date.now()}`,
        sourceBoard: 'test',
        pickupAddress: 'Nashville, TN',
        deliveryAddress: 'Atlanta, GA',
        pickupDate: new Date(),
        deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        pickupTime: '08:00',
        deliveryTime: '16:00',
        rate: 2500,
        miles: 250,
        weight: 15000,
        equipmentType: 'straight_box_truck', // KEY: This matches Annex's equipment
        commodity: 'General Freight - TEST LOAD',
        company: 'TEST LOGISTICS',
        contactPhone: '555-TEST-LOAD',
        ratePerMile: 10.00,
        status: 'available' as const,
        priority: 'standard' as const,
        urgency: 'standard' as const,
        temperatureRequired: false,
        specialInstructions: '🧪 THIS IS A TEST LOAD - Testing button functionality'
      };

      // Create test load in database
      const testLoad = await storage.createLoad(testLoadData);
      console.log(`✅ TEST LOAD CREATED: ${testLoad.loadNumber} (straight_box_truck for Annex)`);

      // Process the test load through the normal dispatch system
      await this.processNewLoad(testLoad);
      console.log(`📱 TEST LOAD SENT: ${testLoad.loadNumber} dispatched to eligible drivers`);
      
      return true;
    } catch (error) {
      console.error('Error sending test load:', error);
      return false;
    }
  }

  async sendTestLoadToDriver(load: LoadWithRelations, driverId: string): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running');
      return false;
    }

    try {
      const driver = await storage.getDriver(driverId);
      if (!driver || !driver.telegramId || !driver.enableTelegramNotifications) {
        console.log('Driver not found or Telegram not enabled');
        return false;
      }

      await this.sendLoadToDriver(load, driver);
      console.log(`Test load ${load.loadNumber} sent to driver ${driver.name} via Telegram`);
      return true;
    } catch (error) {
      console.error('Error sending test load to driver:', error);
      return false;
    }
  }

  async sendLoadConfirmation(load: LoadWithRelations, driver: any): Promise<boolean> {
    if (!this.bot || !this.isRunning || !driver.telegramId) {
      console.log('Telegram service not running or driver has no Telegram ID');
      return false;
    }

    try {
      // Calculate driver rate (10% less than posted rate)
      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      
      // Format pickup and delivery times
      const pickupTime = load.pickupTime || '12:30 PM';
      const deliveryTime = load.deliveryTime || '08:00 AM';
      
      // Format confirmation message based on LAMP Logistics template
      const confirmationMessage = `🚛 **LOAD CONFIRMATION**

Please check in as **LoadMaster Logistics**
You are working for **LoadMaster Logistics**:

======================
📍 **Pick Up:** ${load.pickupDate.toLocaleDateString()} until ${pickupTime}
**Address:** ${load.customer?.name || 'Customer'}
${load.pickupAddress}
======================

📝 **Notes:**
${load.specialInstructions || 'No special instructions'}

======================
🏁 **Deliver:** ${load.deliveryDate.toLocaleDateString()} ${deliveryTime}
**Customer:** ${load.customer?.name || 'Delivery Location'}
${load.deliveryAddress}
======================

📞 **24/7 Support:** (203) 951-1991
Stay safe on the road and have a good trip!

================================
📍 **For tracking purposes, please accept MacroPoint.**
This is a strict requirement.
If your phone number for tracking has been changed, please text us back the correct one!

======================
💰 **Rate:** $${driverRate.toLocaleString()}
======================

✅ **Please confirm and provide ETA for the pick-up**

**Load #:** ${load.loadNumber}`;

      await this.bot.sendMessage(driver.telegramId, confirmationMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      console.log(`Load confirmation sent to driver ${driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending load confirmation to driver ${driver.name}:`, error);
      return false;
    }
  }

  async sendOnboardingInvitation(telegramId: string, onboardingToken: string, email: string): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.error('Telegram service not initialized');
      return false;
    }

    try {
      // Use custom domain (TRAQ IQ) or fall back to Replit domains
      const customDomain = process.env.CUSTOM_DOMAIN || 'traqiqs.io';
      const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
      const domain = replitDomain || customDomain;
      const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
      const onboardingUrl = `${baseUrl}/driver-onboarding?token=${onboardingToken}`;
      
      const message = `🚛 **Welcome to TRAQ IQ!**
      
You've been invited to join our fleet management system with GPS tracking capabilities.

📋 **Complete your driver onboarding here:**
${onboardingUrl}

📧 **Email:** ${email}
🕐 **Link expires:** 7 days from now

**What you'll get:**
✅ Real-time load assignments via Telegram
✅ GPS tracking for route optimization  
✅ Automated notifications and updates
✅ Geofencing for pickup/delivery zones
✅ Performance analytics and reporting

👆 Click the link above to start your onboarding process and familiarize yourself with the TRAQ IQ system!`;

      await this.bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      console.log(`Onboarding invitation sent to Telegram ID: ${telegramId}`);
      return true;
    } catch (error) {
      console.error('Error sending onboarding invitation via Telegram:', error);
      return false;
    }
  }

  // Send dispatcher-set rate confirmation message to driver
  async sendDispatcherRateConfirmation(driverId: string, load: LoadWithRelations, dispatcherRate: number, deadheadDistance?: number): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.error('Telegram service not initialized');
      return false;
    }

    try {
      const driver = await storage.getDriver(driverId);
      if (!driver || !driver.telegramId) {
        console.error('Driver not found or no Telegram ID');
        return false;
      }

      const deadheadText = deadheadDistance ? `\n🛣️ Deadhead: ${deadheadDistance} miles` : '';
      
      const confirmationMessage = `🚛 *LOAD BOOKING CONFIRMATION*

📋 Load: ${load.loadNumber}
💰 Your Rate: $${dispatcherRate}
📍 Route: ${load.pickupAddress} → ${load.deliveryAddress}
📦 Equipment: ${load.equipmentType || 'Any'}
📅 Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime || '12:00 PM'}
📅 Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime || '08:00 AM'}${deadheadText}

${load.specialInstructions ? `📝 Instructions: ${load.specialInstructions}\n\n` : ''}*Please confirm this load assignment:*

✅ Click to confirm and book the load

⏰ *You have 10 minutes to respond*`;

      // Create shorter callback data using the first 8 characters of IDs
      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = driverId.substring(0, 8);
      
      const options = {
        parse_mode: 'Markdown' as const,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ CONFIRM & BOOK', callback_data: `confirm_${shortLoadId}_${shortDriverId}` }
            ]
          ]
        }
      };

      await this.bot.sendMessage(driver.telegramId, confirmationMessage, options);
      console.log(`Dispatcher rate confirmation sent to driver ${driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending dispatcher rate confirmation to driver:`, error);
      return false;
    }
  }

  async sendPickupConfirmation(load: LoadWithRelations): Promise<boolean> {
    if (!this.bot || !this.isRunning || !load.driver?.telegramId) {
      console.error('Telegram service not initialized or driver has no Telegram ID');
      return false;
    }

    try {
      const pickupTime = load.pickupTime || '12:00 PM';
      
      const confirmationMessage = `📍 *PICKUP CONFIRMATION REQUIRED*

📋 Load: ${load.loadNumber}
🏢 Pickup Location: ${load.pickupAddress}
⏰ Pickup Time: ${load.pickupDate.toLocaleDateString()} at ${pickupTime}

*Are you at the pickup location?*`;

      // Create shorter callback data using the first 8 characters of IDs
      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = load.driver.id.substring(0, 8);
      
      const options = {
        parse_mode: 'Markdown' as const,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ ON SITE', callback_data: `onsite_${shortLoadId}_${shortDriverId}` },
              { text: '⏰ DELAY', callback_data: `delay_${shortLoadId}_${shortDriverId}` }
            ]
          ]
        }
      };

      this.queueMessage(async () => {
        await this.bot?.sendMessage(load.driver.telegramId, confirmationMessage, options);
      });
      console.log(`Pickup confirmation sent to driver ${load.driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending pickup confirmation to driver:`, error);
      return false;
    }
  }

  async sendPickupInstructions(load: LoadWithRelations, driverId: string): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.error('Telegram service not initialized');
      return false;
    }

    try {
      const driver = await storage.getDriver(driverId);
      if (!driver || !driver.telegramId) {
        console.error('Driver not found or no Telegram ID');
        return false;
      }

      const instructionsMessage = `✅ *PICKUP INSTRUCTIONS*

📋 Load: ${load.loadNumber}

*Please follow instructions below:*

1) Please make sure the cargo isn't damaged.
2) Please secure the load with the straps and provide me with the photos of the load inside your truck.
3) Please mention your IN and OUT time (should be confirmed and signed by the shipper)
4) Please email me a scan of the BOL with the signature of the shipper (should be straight, clear, and in high quality). My email is: dispatch@lampslogistics.com

*IMPORTANT: Don't leave the shipper without my good to go.*`;

      this.queueMessage(async () => {
        await this.bot?.sendMessage(driver.telegramId, instructionsMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      });
      
      console.log(`Pickup instructions sent to driver ${driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending pickup instructions to driver:`, error);
      return false;
    }
  }

  async sendDelayReasons(load: LoadWithRelations, driverId: string): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.error('Telegram service not initialized');
      return false;
    }

    try {
      const driver = await storage.getDriver(driverId);
      if (!driver || !driver.telegramId) {
        console.error('Driver not found or no Telegram ID');
        return false;
      }

      const delayMessage = `⏰ *DELAY REASON*

📋 Load: ${load.loadNumber}

*Please select the reason for delay:*`;

      // Create shorter callback data using the first 8 characters of IDs
      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = driverId.substring(0, 8);
      
      const options = {
        parse_mode: 'Markdown' as const,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚴 Bike Issue', callback_data: `delay_reason_bike_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '🚗 Traffic', callback_data: `delay_reason_traffic_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '🌧️ Weather', callback_data: `delay_reason_weather_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '🔧 Vehicle Issue', callback_data: `delay_reason_vehicle_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '📋 Documentation', callback_data: `delay_reason_docs_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '📞 Other', callback_data: `delay_reason_other_${shortLoadId}_${shortDriverId}` }
            ]
          ]
        }
      };

      await this.bot.sendMessage(driver.telegramId, delayMessage, options);
      console.log(`Delay reasons sent to driver ${driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending delay reasons to driver:`, error);
      return false;
    }
  }

  // Handle driver confirmation of load offer
  private async handleConfirmLoad(loadId: string, driverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Call the confirmation API endpoint
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/loads/${loadId}/confirm-driver/${driverId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmed: true })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Remove the buttons from the original message by editing it
        if (messageId) {
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] }, // Remove all buttons
              { chat_id: chatId, message_id: messageId }
            );
          } catch (editError) {
            console.log('Could not edit message buttons:', editError);
          }
        }
        
        // Send the booking confirmation message
        const confirmationMessage = `🎉 🎊 CONGRATULATION 🎉 🎊 YOUR Bid WAS ACCEPTED!!!

✅ *LOAD BOOKED SUCCESSFULLY*

Your load has been booked. Please start planning your trip and heading to your pick up location.

📋 Load: ${result.loadNumber}
🚛 Status: Assigned to you

Safe travels! 🛣️`;

        await this.bot.sendMessage(chatId, confirmationMessage, {
          parse_mode: 'Markdown'
        });
      } else {
        await this.bot.sendMessage(chatId, '❌ Error confirming load. Please contact dispatch.');
      }
    } catch (error) {
      console.error('Error confirming load:', error);
      await this.bot.sendMessage(chatId, '❌ Error confirming load. Please contact dispatch.');
    }
  }

  // Handle driver declining load confirmation
  private async handleDeclineConfirmation(loadId: string, driverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Call the confirmation API endpoint
      const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/loads/${loadId}/confirm-driver/${driverId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmed: false })
      });

      if (response.ok) {
        const result = await response.json();
        
        // Remove the buttons from the original message by editing it
        if (messageId) {
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] }, // Remove all buttons
              { chat_id: chatId, message_id: messageId }
            );
          } catch (editError) {
            console.log('Could not edit message buttons:', editError);
          }
        }
        
        await this.bot.sendMessage(chatId, `❌ *Load Declined*\n\nLoad ${result.loadNumber} has been declined. The load will be offered to other drivers.`, {
          parse_mode: 'Markdown'
        });
      } else {
        await this.bot.sendMessage(chatId, '❌ Error declining load. Please contact dispatch.');
      }
    } catch (error) {
      console.error('Error declining load confirmation:', error);
      await this.bot.sendMessage(chatId, '❌ Error declining load. Please contact dispatch.');
    }
  }

  stop(): void {
    if (this.bot) {
      this.bot.stopPolling();
    }
    this.isRunning = false;
    console.log('Telegram Load Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  getConfig(): TelegramBotConfig | null {
    return this.config;
  }

  /**
   * Send bid offer to driver for load bidding system
   */
  async sendBidOffer(telegramId: string, bidData: {
    bidId: string;
    loadNumber: string;
    pickupAddress: string;
    deliveryAddress: string;
    pickupDate: string;
    deliveryDate: string;
    bidAmount: number;
    margin: number;
    miles: number;
    commodity: string;
    equipment: string;
    timeoutMinutes: number;
  }): Promise<number | null> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running');
      return null;
    }

    try {
      const message = `🚛 *NEW LOAD OPPORTUNITY*\n\n` +
        `📦 Load: ${bidData.loadNumber}\n` +
        `📍 Pickup: ${bidData.pickupAddress}\n` +
        `📍 Delivery: ${bidData.deliveryAddress}\n` +
        `📅 Pickup: ${bidData.pickupDate}\n` +
        `📅 Delivery: ${bidData.deliveryDate}\n` +
        `💰 Bid Amount: $${bidData.bidAmount.toFixed(2)}\n` +
        `📏 Miles: ${bidData.miles}\n` +
        `📦 Commodity: ${bidData.commodity}\n` +
        `🚚 Equipment: ${bidData.equipment}\n` +
        `💵 Your Profit: $${bidData.margin.toFixed(2)}\n\n` +
        `⏰ Respond within ${bidData.timeoutMinutes} minutes\n\n` +
        `Accept this load opportunity?`;

      const options = {
        parse_mode: 'Markdown' as const,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ ACCEPT', callback_data: `bid_accept_${bidData.bidId}` },
              { text: '❌ DECLINE', callback_data: `bid_decline_${bidData.bidId}` },
              { text: '💬 NEGOTIATE', callback_data: `bid_negotiate_${bidData.bidId}` }
            ]
          ]
        }
      };

      const sentMessage = await this.bot.sendMessage(telegramId, message, options);
      console.log(`Sent bid offer for ${bidData.loadNumber} to Telegram ID: ${telegramId}`);
      return sentMessage.message_id;
    } catch (error) {
      console.error('Error sending bid offer via Telegram:', error);
      return null;
    }
  }

  /**
   * Send notification to dispatcher
   */
  async sendDispatcherNotification(chatId: string, message: string): Promise<number | null> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running');
      return null;
    }

    return new Promise((resolve) => {
      this.queueMessage(async () => {
        try {
          const sentMessage = await this.bot?.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });
          console.log(`Sent dispatcher notification to chat: ${chatId}`);
          resolve(sentMessage?.message_id || null);
        } catch (error) {
          console.error('Error sending dispatcher notification via Telegram:', error);
          resolve(null);
        }
      });
    });
  }

  /**
   * Send a direct message via Telegram (for booking confirmations, etc.)
   */
  async sendMessage(chatId: string, message: string): Promise<number | null> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running - would send:', message);
      return null;
    }

    return new Promise((resolve) => {
      this.queueMessage(async () => {
        try {
          const sentMessage = await this.bot?.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });
          console.log(`Sent message to chat ${chatId}: ${message.substring(0, 100)}...`);
          resolve(sentMessage?.message_id || null);
        } catch (error) {
          console.error(`Error sending message to chat ${chatId}:`, error);
          
          // If chat not found, handle gracefully
          if (error instanceof Error && error.message.includes('chat not found')) {
            console.log(`❌ Chat ${chatId} not found - likely invalid or blocked chat ID`);
          }
          
          resolve(null);
        }
      });
    });
  }

  private async handleBookLoad(loadId: string, telegramId: string, chatId: number): Promise<void> {
    try {
      const driver = await storage.getDriverByTelegramId(telegramId);
      if (!driver) {
        this.bot?.sendMessage(chatId, '❌ Driver not found. Please contact dispatcher.');
        return;
      }

      const load = await storage.getLoad(loadId);
      if (!load) {
        this.bot?.sendMessage(chatId, '❌ Load not found.');
        return;
      }

      // Check if load offer exists, create if missing
      let loadOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driver.id);
      if (!loadOffer) {
        console.log(`Creating missing load offer for ${driver.name} and load ${load.loadNumber}`);
        loadOffer = await storage.createLoadOffer({
          loadId: load.id,
          driverId: driver.id,
          status: 'pending',
          sentAt: new Date(),
          timeoutAt: new Date(Date.now() + 3 * 60 * 60 * 1000) // 3 hours from now
        });
      }

      // Update load offer status to accepted (driver has shown interest)
      await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
        status: 'accepted',
        respondedAt: new Date()
      });

      // Send initial confirmation to driver
      this.bot?.sendMessage(
        chatId,
        `✅ *INTEREST CONFIRMED*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\n\nYour interest has been sent to dispatch. You will receive a rate confirmation within 15 minutes.`,
        { parse_mode: 'Markdown' }
      );

      // Notify dispatcher that driver is interested and needs rate setting
      if (this.config) {
        const dispatchMessage = `🚛 *DRIVER INTERESTED IN LOAD*\n\n` +
          `📦 **Load:** ${load.loadNumber}\n` +
          `🚛 **Driver:** ${driver.name}\n` +
          `📞 **Phone:** ${driver.phone}\n` +
          `📍 **Location:** ${driver.city || 'Not specified'}\n` +
          `🚚 **Equipment:** ${driver.equipmentType}\n\n` +
          `**Route:** ${load.pickupAddress} → ${load.deliveryAddress}\n` +
          `**Original Rate:** $${load.rate?.toLocaleString()}\n` +
          `**Distance:** ${load.miles} miles\n\n` +
          `⚡ **ACTION REQUIRED:** Set dispatcher rate in dashboard to proceed with booking.`;

        this.bot?.sendMessage(
          this.config.dispatcherId,
          dispatchMessage,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} accepted load ${load.loadNumber} via Telegram button`);
    } catch (error) {
      console.error('Error handling book load:', error);
      this.bot?.sendMessage(chatId, '❌ Error processing booking request.');
    }
  }

  private async handleDeclineLoad(loadId: string, telegramId: string, chatId: number): Promise<void> {
    try {
      const driver = await storage.getDriverByTelegramId(telegramId);
      if (!driver) {
        this.bot?.sendMessage(chatId, '❌ Driver not found. Please contact dispatcher.');
        return;
      }

      const load = await storage.getLoad(loadId);
      if (!load) {
        this.bot?.sendMessage(chatId, '❌ Load not found.');
        return;
      }

      // Check if load offer exists, create if missing
      let loadOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driver.id);
      if (!loadOffer) {
        console.log(`Creating missing load offer for ${driver.name} and load ${load.loadNumber}`);
        loadOffer = await storage.createLoadOffer({
          loadId: load.id,
          driverId: driver.id,
          status: 'pending',
          sentAt: new Date(),
          timeoutAt: new Date(Date.now() + 3 * 60 * 60 * 1000) // 3 hours from now
        });
      }

      // Update load offer status
      await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
        status: 'declined',
        respondedAt: new Date()
      });

      // Send confirmation to driver (show driver rate - 10% less)
      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      this.bot?.sendMessage(
        chatId,
        `❌ *LOAD DECLINED*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nRate: $${driverRate.toLocaleString()}\n\nThank you for your response. You will continue to receive new load offers.`,
        { parse_mode: 'Markdown' }
      );

      // Notify dispatcher (show full rate for dispatcher)
      if (this.config) {
        this.bot?.sendMessage(
          this.config.dispatcherId,
          `❌ *LOAD DECLINED*\n\nDriver *${driver.name}* declined Load ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}\n\nLoad is still available for other drivers.`,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} declined load ${load.loadNumber} via Telegram button`);
    } catch (error) {
      console.error('Error handling decline load:', error);
      this.bot?.sendMessage(chatId, '❌ Error processing decline request.');
    }
  }

  private async handleLoadOfferTimeout(load: LoadWithRelations, originalDriver: Driver): Promise<void> {
    try {
      const offer = await storage.getLoadOfferByLoadAndDriver(load.id, originalDriver.id);
      if (!offer || offer.status !== 'pending') {
        return; // Already responded or handled
      }

      // Check if this is the first timeout (no retry count or retryCount = 0)
      const retryCount = (offer as any).retryCount || 0;
      
      if (retryCount === 0) {
        // First timeout - resend to same driver
        console.log(`No response from ${originalDriver.name} for Load ${load.loadNumber} - resending (retry 1)`);
        
        // Update offer with retry count
        await storage.updateLoadOfferByLoadAndDriver(load.id, originalDriver.id, {
          retryCount: 1,
          lastSentAt: new Date()
        } as any);

        // Resend the load to the same driver
        if (this.bot && originalDriver.telegramId) {
          const message = `🔄 *LOAD REMINDER* - No response received\n\n${this.formatLoadMessage(load)}\n\n⚠️ *Please respond within 3 minutes or this load will be offered to other drivers.*`;
          
          const options = {
            parse_mode: 'Markdown' as const,
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📦 BOOK NOW', callback_data: `book_${load.id}` },
                  { text: '❌ DECLINE', callback_data: `decline_${load.id}` }
                ]
              ]
            }
          };

          await this.bot.sendMessage(originalDriver.telegramId, message, options);
          
          // Schedule second timeout for sending to other drivers
          setTimeout(async () => {
            await this.handleSecondTimeout(load, originalDriver);
          }, this.config!.responseTimeoutMinutes * 60 * 1000);
        }
      }
    } catch (error) {
      console.error('Error handling load offer timeout:', error);
    }
  }

  private async handleSecondTimeout(load: LoadWithRelations, originalDriver: Driver): Promise<void> {
    try {
      const offer = await storage.getLoadOfferByLoadAndDriver(load.id, originalDriver.id);
      if (!offer || offer.status !== 'pending') {
        return; // Driver finally responded
      }

      console.log(`Second timeout for ${originalDriver.name} on Load ${load.loadNumber} - sending to other drivers`);
      
      // Mark original offer as timeout
      await storage.updateLoadOfferByLoadAndDriver(load.id, originalDriver.id, {
        status: 'timeout'
      });

      // Find other eligible drivers in the vicinity
      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      const otherDrivers = eligibleDrivers.filter(driverMatch => driverMatch.driver.id !== originalDriver.id);

      if (otherDrivers.length > 0) {
        // Send to the next best driver
        const nextDriver = otherDrivers[0];
        console.log(`Sending load ${load.loadNumber} to next available driver: ${nextDriver.driver.name}`);
        
        await this.sendLoadToDriver(load, nextDriver.driver, nextDriver.matchScore, nextDriver.distance);
        
        // Notify dispatcher about the driver change (show full rate)
        if (this.bot && this.config) {
          this.bot.sendMessage(
            this.config.dispatcherId,
            `🔄 *LOAD REASSIGNED*\n\nLoad ${load.loadNumber} reassigned from ${originalDriver.name} (no response) to ${nextDriver.driver.name}\n\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}`,
            { parse_mode: 'Markdown' }
          );
        }
      } else {
        // No other drivers available - notify dispatcher (show full rate)
        if (this.bot && this.config) {
          this.bot.sendMessage(
            this.config.dispatcherId,
            `⚠️ *NO DRIVERS AVAILABLE*\n\nLoad ${load.loadNumber} - no response from ${originalDriver.name} and no other drivers in vicinity.\n\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}\n\nManual assignment required.`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (error) {
      console.error('Error handling second timeout:', error);
    }
  }

  // Handler methods for shortened ID callbacks
  private async handleConfirmLoadShort(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Find the full load and driver IDs by matching the first 8 characters
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }
      
      await this.handleConfirmLoad(load.id, driver.id, telegramId, chatId, messageId);
    } catch (error) {
      console.error('Error handling confirmation with short IDs:', error);
      await this.bot?.sendMessage(chatId, '❌ Error processing confirmation. Please contact dispatch.');
    }
  }

  private async handleDeclineConfirmationShort(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Find the full load and driver IDs by matching the first 8 characters
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }
      
      await this.handleDeclineConfirmation(load.id, driver.id, telegramId, chatId, messageId);
    } catch (error) {
      console.error('Error handling decline with short IDs:', error);
      await this.bot?.sendMessage(chatId, '❌ Error processing decline. Please contact dispatch.');
    }
  }

  // Pickup confirmation handlers
  private async handleOnSiteConfirmation(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Find the full load and driver IDs by matching the first 8 characters
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      // Remove the buttons from the original message
      if (messageId && this.bot) {
        try {
          await this.bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      // Send pickup instructions
      await this.sendPickupInstructions(load, driver.id);
      
      // Update load status to in_transit
      await storage.updateLoad(load.id, {
        status: 'in_transit'
      });

      console.log(`Driver ${driver.name} confirmed on-site for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling on-site confirmation:', error);
      await this.bot?.sendMessage(chatId, '❌ Error processing on-site confirmation. Please contact dispatch.');
    }
  }

  private async handleDelayConfirmation(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Find the full load and driver IDs by matching the first 8 characters
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      // Remove the buttons from the original message
      if (messageId && this.bot) {
        try {
          await this.bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      // Send delay reason options
      await this.sendDelayReasons(load, driver.id);
      
      console.log(`Driver ${driver.name} reported delay for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling delay confirmation:', error);
      await this.bot?.sendMessage(chatId, '❌ Error processing delay. Please contact dispatch.');
    }
  }

  private async handleDelayReason(reason: string, shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      // Find the full load and driver IDs by matching the first 8 characters
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      // Remove the buttons from the original message
      if (messageId && this.bot) {
        try {
          await this.bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      // Map reason codes to readable text
      const reasonMap: { [key: string]: string } = {
        'bike': 'Bike Issue',
        'traffic': 'Traffic',
        'weather': 'Weather',
        'vehicle': 'Vehicle Issue',
        'docs': 'Documentation',
        'other': 'Other'
      };

      const reasonText = reasonMap[reason] || reason;

      // Send confirmation message to driver
      const confirmationMessage = `⏰ *DELAY RECORDED*

📋 Load: ${load.loadNumber}
📝 Reason: ${reasonText}

Your delay has been recorded and dispatch has been notified. Please proceed to pickup when ready.`;

      await this.bot?.sendMessage(chatId, confirmationMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      // Notify dispatcher about the delay
      if (this.config) {
        const dispatchMessage = `⏰ *PICKUP DELAY REPORTED*

📦 **Load:** ${load.loadNumber}
🚛 **Driver:** ${driver.name}
📞 **Phone:** ${driver.phone}
📝 **Reason:** ${reasonText}
📍 **Pickup:** ${load.pickupAddress}
⏰ **Pickup Time:** ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime || '12:00 PM'}

Please contact driver if needed.`;

        await this.bot?.sendMessage(this.config.dispatcherId, dispatchMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      }

      console.log(`Driver ${driver.name} reported delay reason: ${reasonText} for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling delay reason:', error);
      await this.bot?.sendMessage(chatId, '❌ Error processing delay reason. Please contact dispatch.');
    }
  }

  // Send driver onboarding invitation via Telegram
  async sendDriverOnboarding(phoneNumber: string, onboardingToken: string): Promise<{ success: boolean; error?: string; botLink?: string }> {
    try {
      if (!this.bot) {
        return { success: false, error: 'Telegram bot not initialized' };
      }

      // Since Telegram bots cannot send messages to users who haven't started a chat,
      // we'll return the bot link for manual sharing instead of attempting direct messaging
      const botUsername = await this.getBotUsername();
      const botLink = `https://t.me/${botUsername}`;
      
      console.log(`📱 Telegram invitation created for ${phoneNumber}`);
      console.log(`🤖 Bot link to share: ${botLink}`);
      
      // Store the invitation token for when the user eventually contacts the bot
      const onboardingUrl = `${process.env.REPLIT_DOMAINS || 'http://localhost'}/driver-onboarding?token=${onboardingToken}`;
      
      return { 
        success: true, 
        botLink,
        error: `Share this bot link with the driver: ${botLink}. They need to start a chat with the bot to receive automatic onboarding.`
      };

    } catch (error: any) {
      console.error('Telegram service error:', error);
      const botUsername = await this.getBotUsername();
      return { 
        success: false, 
        error: `Telegram service error. Share this bot link manually: https://t.me/${botUsername}` 
      };
    }
  }

  // Handle direct driver registration when they respond "YES"
  // NEW: Link existing driver accounts to Telegram
  async linkExistingDriver(chatId: number, email: string, userInfo: any): Promise<void> {
    try {
      console.log(`🔗 Attempting to link existing driver with email: ${email} to chat: ${chatId}`);
      
      // Find driver by email
      const drivers = await storage.getAllDrivers();
      const existingDriver = drivers.find(d => d.email.toLowerCase() === email.toLowerCase());
      
      if (!existingDriver) {
        await this.bot?.sendMessage(chatId,
          `❌ *Driver Not Found*\n\n` +
          `No driver account found with email: ${email}\n\n` +
          `Please check the email address or contact support if you need help.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Update driver with real Telegram chat ID
      await storage.updateDriver(existingDriver.id, {
        telegramId: chatId.toString(),
        enableTelegramNotifications: true,
        status: 'available'
      });
      
      await this.bot?.sendMessage(chatId,
        `🎉 *Account Successfully Linked!*\n\n` +
        `Welcome back, ${existingDriver.name}!\n\n` +
        `📍 Location: ${existingDriver.city}\n` +
        `🚛 Equipment: ${existingDriver.equipmentType.replace('_', ' ')}\n` +
        `📱 Status: Available for loads\n\n` +
        `✅ You'll now receive Tennessee load offers directly in this chat!\n\n` +
        `Happy trucking! 🚛💰`,
        { parse_mode: 'Markdown' }
      );
      
      console.log(`✅ Successfully linked ${existingDriver.name} (${existingDriver.email}) to chat ID: ${chatId}`);
      
    } catch (error) {
      console.error('Error linking existing driver:', error);
      await this.bot?.sendMessage(chatId,
        `❌ Error linking your account. Please try again or contact support.`
      );
    }
  }

  async handleDriverRegistration(chatId: number, userInfo: any): Promise<void> {
    try {
      console.log(`🔗 Handling driver registration for ${userInfo?.first_name} (Chat: ${chatId})`);
      
      // Check if this chat ID is already connected to a driver
      const drivers = await storage.getAllDrivers();
      let existingDriver = drivers.find(d => d.telegramId === chatId.toString());
      
      if (existingDriver) {
        // Driver already exists, just enable notifications
        await storage.updateDriver(existingDriver.id, {
          enableTelegramNotifications: true,
          status: 'available'
        });
        
        await this.bot?.sendMessage(chatId,
          `✅ *Welcome back, ${existingDriver.name}!*\n\n` +
          `Your Telegram notifications are now enabled.\n` +
          `You'll start receiving Tennessee load offers immediately!\n\n` +
          `📍 Location: ${existingDriver.city}\n` +
          `🚛 Equipment: ${existingDriver.equipmentType.replace('_', ' ')}\n` +
          `📱 Status: Available`,
          { parse_mode: 'Markdown' }
        );
        
        console.log(`✅ Re-enabled notifications for existing driver: ${existingDriver.name}`);
        return;
      }
      
      // Check if this is Annex by username or name
      const telegramUsername = userInfo?.username?.toLowerCase() || '';
      const firstName = userInfo?.first_name?.toLowerCase() || '';
      
      if (telegramUsername.includes('annex') || firstName.includes('annex') || firstName.includes('kay')) {
        // This is likely Annex - find his profile and connect it
        const annexDriver = drivers.find(d => 
          d.name.toLowerCase().includes('annex') || 
          d.telegramUsername?.toLowerCase().includes('annex')
        );
        
        if (annexDriver) {
          // Connect Annex's existing profile to this chat ID
          await storage.updateDriver(annexDriver.id, {
            telegramId: chatId.toString(),
            enableTelegramNotifications: true,
            status: 'available'
          });
          
          await this.bot?.sendMessage(chatId,
            `🎉 *Welcome Annex!*\n\n` +
            `Your driver profile is now connected to Telegram!\n\n` +
            `📍 Location: ${annexDriver.city}\n` +
            `🚛 Equipment: ${annexDriver.equipmentType.replace('_', ' ')}\n` +
            `📞 Phone: ${annexDriver.phone}\n` +
            `💰 Max Weight: ${annexDriver.maxWeight} lbs\n\n` +
            `✅ *You're all set!* Tennessee load offers will start arriving immediately.\n\n` +
            `The system will match you with loads within 150 miles of your location.`,
            { parse_mode: 'Markdown' }
          );
          
          console.log(`✅ Connected Annex's profile (${annexDriver.id}) to chat ID: ${chatId}`);
          return;
        }
      }
      
      // New driver - send registration form
      await this.sendAutoOnboarding(chatId, userInfo);
      
    } catch (error) {
      console.error('Error handling driver registration:', error);
      await this.bot?.sendMessage(chatId,
        `❌ Error connecting your profile. Please contact support or try again later.`
      );
    }
  }

  // Send automatic onboarding when user starts chat
  async sendAutoOnboarding(chatId: number, userInfo: any): Promise<void> {
    try {
      // Create an onboarding token automatically
      const { randomUUID } = await import('crypto');
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      // Create a temporary email based on user info
      const tempEmail = `${userInfo?.username || chatId}@telegram-onboarding.local`;
      
      const tokenData = {
        token,
        email: tempEmail,
        telegramChatId: chatId.toString(), // Store the chat ID for later linking
        expiresAt,
        isUsed: false,
      };
      
      console.log('Creating onboarding token for Telegram user:', { token, email: tempEmail, chatId });
      const createdToken = await storage.createOnboardingToken(tokenData);
      console.log('Token created successfully:', createdToken.id);
      
      // Format the onboarding message with proper domain and token
      const domain = process.env.REPLIT_DOMAINS ? 
        `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 
        'http://localhost:5000';
      const onboardingUrl = `${domain}/simple-registration?token=${token}`;
      
      const message = `🚛 *LAMP Logistics Driver Onboarding*

Hi ${userInfo?.first_name || 'Driver'}! Ready to join our fleet and start earning?

✅ *What You'll Need:*
• Driver's License Number
• Emergency Contact Information  
• Equipment Type & Capacity
• Current Location

⏰ *This invitation expires in 7 days*

Once registered, you'll receive instant load offers with one-click booking!

Need help? Just reply to this message.`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📝 START REGISTRATION', url: onboardingUrl }
          ],
          [
            { text: '❓ How It Works', callback_data: 'how_it_works' },
            { text: '📞 Contact Support', callback_data: 'contact_support' }
          ]
        ]
      };

      await this.bot?.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });

      console.log(`📱 Auto-onboarding sent to new user: ${userInfo?.first_name} (${chatId})`);
      
      // Log this automatic onboarding
      await storage.createEmailLog({
        recipientEmail: tempEmail,
        subject: "Telegram Auto-Onboarding",
        status: "sent",
        sentAt: new Date(),
      });

    } catch (error) {
      console.error('Error sending auto-onboarding:', error);
    }
  }

  // Get bot username for sharing
  async getBotUsername(): Promise<string> {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }
      
      const botInfo = await this.bot.getMe();
      return botInfo.username || '';
    } catch (error) {
      console.error('Failed to get bot info:', error);
      return '';
    }
  }
}

// Singleton instance
export const telegramLoadService = new TelegramLoadService();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down Telegram Load Service...');
  telegramLoadService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down Telegram Load Service...');
  telegramLoadService.stop();
});