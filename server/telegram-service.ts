import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { storage } from "./storage";
import { randomUUID } from "crypto";
import { canHandleEquipmentType } from "@shared/equipment-types";
import type { LoadWithRelations, Driver, LanePreference, AvoidLocation, TelegramBotConfig, LoadOffer } from "@shared/schema";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DISPATCHER_ID = process.env.DISPATCHER_CHAT_ID || '';

export class TelegramLoadService {
  private bot: Telegraf | null = null;
  private config: TelegramBotConfig | null = null;
  private isRunning = false;
  private isRestarting = false;
  private isStartingPolling = false;
  private restartTimeout: NodeJS.Timeout | null = null;
  private messageQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastMessageTime = 0;
  private readonly MESSAGE_DELAY = 1500;
  
  private loadBatchQueue: LoadWithRelations[] = [];
  private isBatchProcessing = false;
  private readonly BATCH_SIZE = 3;
  private readonly BATCH_INTERVAL = 30000;

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Telegram Load Dispatcher...');
      
      if (!TELEGRAM_TOKEN || !DISPATCHER_ID) {
        console.log('⚠️ Telegram service disabled - missing TELEGRAM_BOT_TOKEN or DISPATCHER_CHAT_ID');
        return;
      }

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

      await this.shutdown();
      
      await this.initializeBotConfig();
      
      this.bot = new Telegraf(TELEGRAM_TOKEN);

      (globalThis as any).__telegramBotSingleton = {
        bot: this.bot,
        instanceId,
        ownerStack,
        isRunning: false
      };

      try {
        await this.bot.telegram.deleteWebhook({ drop_pending_updates: false });
        const botInfo = await this.bot.telegram.getMe();
        console.log(`🤖 Bot authenticated: @${botInfo.username} (${botInfo.first_name})`);
        console.log(`🆔 Instance ID: ${instanceId}`);
      } catch (error) {
        console.warn('⚠️ Could not clear webhook state:', error);
      }
      
      this.bot.catch((err, ctx) => {
        console.error('Telegram bot error:', err);
        if (err.message?.includes('409')) {
          console.log('🔄 Bot conflict detected - attempting safe restart...');
          this.safeRestartPolling();
        }
      });
      
      this.setupCommandHandlers();
      
      await this.startPollingWithRetry();
      
      this.startQueueProcessor();
      
      await this.initializeDefaultData();
      
      this.isRunning = true;
      console.log('✅ Telegram Load Dispatcher initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Telegram service:', error);
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
            if (error?.code === 429) {
              console.log('Rate limit hit, waiting longer...');
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }
      }
      
      this.isProcessingQueue = false;
      
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
          await this.bot?.launch({ dropPendingUpdates: true });
          console.log('✅ Telegram bot polling started successfully');
          this.isRunning = true;
          
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
    if (this.isRestarting) {
      console.log('⚠️ Restart already in progress, skipping...');
      return;
    }
    
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }
    
    this.restartTimeout = setTimeout(async () => {
      if (this.isRestarting || !this.bot) return;
      
      this.isRestarting = true;
      console.log('🔄 Safe restart: stopping and restarting polling on same bot instance...');
      
      try {
        this.bot.stop('RESTART');
        console.log('✅ Polling stopped');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await this.bot.launch({ dropPendingUpdates: true });
        console.log('✅ Polling restarted successfully');
        
        this.isRunning = true;
      } catch (error) {
        console.error('Failed to restart polling:', error);
        this.isRunning = false;
      } finally {
        this.isRestarting = false;
        this.restartTimeout = null;
      }
    }, 10000);
  }

  private async restartBot(): Promise<void> {
    console.log('🔄 Legacy restart called - using safe restart instead...');
    return this.safeRestartPolling();
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down Telegram service...');
    this.isRunning = false;
    this.isRestarting = false;
    this.isStartingPolling = false;
    
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    
    try {
      if (this.bot) {
        this.bot.stop('SHUTDOWN');
        this.bot = null;
      }
      
      this.messageQueue = [];
      this.isProcessingQueue = false;
      
      console.log('✅ Telegram service shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  getBot(): Telegraf | null {
    return this.bot;
  }

  isInitialized(): boolean {
    return this.isRunning && this.bot !== null;
  }

  private startBatchProcessor(): void {
    if (this.isBatchProcessing) return;
    
    this.isBatchProcessing = true;
    const processBatches = async () => {
      while (this.loadBatchQueue.length > 0 && this.isRunning) {
        const batch = this.loadBatchQueue.splice(0, this.BATCH_SIZE);
        
        console.log(`🚛 PROCESSING BATCH: ${batch.length} loads - ${batch.map(l => l.loadNumber).join(', ')}`);
        
        for (const load of batch) {
          await this.processSingleLoad(load);
        }
        
        console.log(`✅ BATCH COMPLETE: Sent ${batch.length} loads to drivers`);
        
        if (this.loadBatchQueue.length > 0) {
          console.log(`⏳ BATCH DELAY: Waiting 30 seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, this.BATCH_INTERVAL));
        }
      }
      
      this.isBatchProcessing = false;
      
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

    console.log('Telegram service initialized - waiting for real driver connections');
    
    const drivers = await storage.getAllDrivers();
    for (const driver of drivers) {
      if (driver.id === '3ce898f4-6962-461f-a9ea-bb81cc7d4a6f') {
        console.log(`✅ Keeping Annex Luberisse available for load assignment`);
        continue;
      }
      
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

    this.bot.on(message('text'), async (ctx) => {
      const msg = ctx.message;
      const text = msg.text || '';
      
      console.log(`📱 TELEGRAM MESSAGE RECEIVED: User ${ctx.from?.first_name || 'Unknown'} (${ctx.from?.id || 'no-id'}) Chat: ${ctx.chat?.id || 'no-chat'} Text: "${text}"`);
      
      if (text && !text.startsWith('/')) {
        const chatId = ctx.chat.id;
        const userInfo = ctx.from;
        const responseText = text.toUpperCase().trim();
        
        console.log(`🔍 Processing response: "${responseText}" from ${userInfo?.first_name}`);
        
        if (responseText === 'YES' || responseText === 'Y') {
          await this.handleDriverRegistration(chatId, userInfo);
        } else if (responseText === 'INFO' || responseText === 'HELP') {
          await ctx.reply(
            `*Want to know how TRAQ IQ can help you earn more money?*\n\n` +
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
          const email = responseText.replace('LINK ', '').trim().toLowerCase();
          await this.linkExistingDriver(chatId, email, userInfo);
        } else {
          await ctx.reply(
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
    
    this.bot.command('start', async (ctx) => {
      const chatId = ctx.chat.id;
      const userInfo = ctx.from;
      
      console.log(`📱 NEW USER STARTED CHAT: ${userInfo?.first_name || 'Unknown'} ${userInfo?.last_name || ''} (ID: ${userInfo?.id}) Chat: ${chatId}`);
      
      try {
        await ctx.reply(
          `🚛 *Welcome to TRAQ IQ!*\n\n` +
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

        await this.sendAutoOnboarding(chatId, userInfo);
      } catch (error) {
        console.error(`❌ Error sending welcome message to ${chatId}:`, error);
      }
    });

    this.bot.command('bookload', async (ctx) => {
      const chatId = ctx.chat.id;
      const telegramId = ctx.from?.id.toString();
      console.log(`📱 Load booking request from ${ctx.from?.first_name} (${chatId})`);
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await ctx.reply(`Please register as a driver first using /start command.`);
          return;
        }

        await ctx.reply(
          `📋 *Booking Request Received*\n\n` +
          `Your load booking request is being processed.\n` +
          `Dispatcher will confirm within 15 minutes.\n\n` +
          `Thank you ${driver.name}! 👍`,
          { parse_mode: 'Markdown' }
        );

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

          await this.bot?.telegram.sendMessage(this.config.dispatcherId, dispatcherMessage, {
            parse_mode: 'Markdown'
          });
          console.log(`✅ Sent booking notification to dispatcher`);
        }
      } catch (error) {
        console.error('Error handling bookload command:', error);
        await ctx.reply('Error processing booking request. Please try again.');
      }
    });

    this.bot.command('decline', async (ctx) => {
      const chatId = ctx.chat.id;
      const telegramId = ctx.from?.id.toString();
      console.log(`📱 Load declined by ${ctx.from?.first_name} (${chatId})`);
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        await ctx.reply(
          `✅ Load declined. Thanks for your response ${driver?.name || 'Driver'}!\n\n` +
          `We'll keep you in mind for the next suitable load. 👍`
        );
        console.log(`✅ Load declined by ${driver?.name || 'unknown'}`);
      } catch (error) {
        console.error('Error handling decline command:', error);
        await ctx.reply('Response recorded. Thank you!');
      }
    });

    this.bot.command('location', async (ctx) => {
      const chatId = ctx.chat.id;
      const telegramId = ctx.from?.id.toString();
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await ctx.reply('Driver not found. Please register first.');
          return;
        }

        await ctx.reply(
          `📍 *Share Your Location*\n\n` +
          `To get loads along your route, please share your current GPS location:\n\n` +
          `1️⃣ Tap the 📎 attachment button\n` +
          `2️⃣ Select "📍 Location"\n` +
          `3️⃣ Choose "Send My Current Location"\n\n` +
          `This helps us find loads nearest to you!`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Error handling location command:', error);
        await ctx.reply('Error requesting location. Please try again.');
      }
    });

    this.bot.on(message('location'), async (ctx) => {
      const msg = ctx.message;
      const chatId = ctx.chat.id;
      const telegramId = ctx.from?.id.toString() || '';
      
      console.log(`📍 Location received from ${ctx.from?.first_name}: ${msg.location.latitude}, ${msg.location.longitude}`);
      
      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          await ctx.reply('Driver not found. Please register first using /start command.');
          return;
        }

        await storage.updateDriverLocation({
          driverId: driver.id,
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
          accuracy: 10,
          source: 'telegram',
          isActive: true,
          heading: null,
          speed: null
        });

        await ctx.reply(
          `📍 *Location Updated!*\n\n` +
          `Coordinates: ${msg.location.latitude.toFixed(4)}, ${msg.location.longitude.toFixed(4)}\n\n` +
          `We're now scanning for loads in your area. You'll receive notifications when matching loads are available.`,
          { parse_mode: 'Markdown' }
        );

        console.log(`✅ Location saved for driver ${driver.name}`);
      } catch (error) {
        console.error('Error processing location:', error);
        await ctx.reply('Error processing location. Please try again.');
      }
    });

    this.bot.on('callback_query', async (ctx) => {
      const callbackQuery = ctx.callbackQuery;
      if (!('data' in callbackQuery)) return;
      
      const data = callbackQuery.data;
      const telegramId = ctx.from?.id.toString() || '';
      const chatId = callbackQuery.message?.chat.id || 0;
      const messageId = callbackQuery.message?.message_id;
      
      console.log(`🔘 Callback received: ${data} from ${ctx.from?.first_name} (${telegramId})`);
      
      try {
        if (data.startsWith('book_')) {
          const loadId = data.replace('book_', '');
          await this.handleBookLoad(loadId, telegramId, chatId, messageId);
        } else if (data.startsWith('decline_')) {
          const loadId = data.replace('decline_', '');
          await this.handleDeclineLoad(loadId, telegramId, chatId, messageId);
        } else if (data.startsWith('confirm_')) {
          const parts = data.split('_');
          if (parts.length >= 3) {
            const shortLoadId = parts[1];
            const shortDriverId = parts[2];
            await this.handleConfirmLoadShort(shortLoadId, shortDriverId, telegramId, chatId, messageId);
          }
        } else if (data.startsWith('onsite_')) {
          const parts = data.split('_');
          if (parts.length >= 3) {
            await this.handleOnSiteConfirmation(parts[1], parts[2], telegramId, chatId, messageId);
          }
        } else if (data.startsWith('delay_')) {
          const parts = data.split('_');
          if (parts.length >= 3) {
            await this.handleDelayConfirmation(parts[1], parts[2], telegramId, chatId, messageId);
          }
        } else if (data.startsWith('delayreason_')) {
          const parts = data.split('_');
          if (parts.length >= 4) {
            await this.handleDelayReason(parts[1], parts[2], parts[3], telegramId, chatId, messageId);
          }
        } else if (data === 'how_it_works') {
          await ctx.answerCbQuery('Loading information...');
          await this.bot?.telegram.sendMessage(chatId,
            `*How TRAQ IQ Works:*\n\n` +
            `1️⃣ Register as a driver\n` +
            `2️⃣ Receive instant load offers\n` +
            `3️⃣ Accept loads with one click\n` +
            `4️⃣ Track your assignments\n` +
            `5️⃣ Get paid fast!\n\n` +
            `Reply "YES" to get started!`,
            { parse_mode: 'Markdown' }
          );
        } else if (data === 'contact_support') {
          await ctx.answerCbQuery('Loading support info...');
          await this.bot?.telegram.sendMessage(chatId,
            `📞 *Support Contact:*\n\n` +
            `Phone: (203) 951-1991\n` +
            `Email: support@traqiq.com\n\n` +
            `We're here to help 24/7!`,
            { parse_mode: 'Markdown' }
          );
        }
        
        await ctx.answerCbQuery();
      } catch (error) {
        console.error('Error handling callback query:', error);
        await ctx.answerCbQuery('Error processing request');
      }
    });
  }

  async processNewLoad(load: LoadWithRelations): Promise<void> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running - skipping load dispatch');
      return;
    }

    console.log(`\n🚛 ==========================================`);
    console.log(`🚛 NEW LOAD RECEIVED: ${load.loadNumber}`);
    console.log(`🚛 ==========================================`);
    console.log(`📍 Route: ${load.pickupAddress} → ${load.deliveryAddress}`);
    console.log(`💰 Rate: $${load.rate} | 📏 Miles: ${load.miles}`);
    console.log(`🚚 Equipment Required: ${load.equipmentType}`);
    console.log(`📅 Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}`);

    this.addLoadToBatch(load);
  }

  private async processSingleLoad(load: LoadWithRelations): Promise<void> {
    try {
      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      
      console.log(`\n👥 DRIVER MATCHING for ${load.loadNumber}:`);
      console.log(`   Found ${eligibleDrivers.length} eligible drivers`);

      if (eligibleDrivers.length === 0) {
        console.log(`⚠️ No eligible drivers found for load ${load.loadNumber}`);
        if (this.config?.dispatcherId) {
          await this.bot?.telegram.sendMessage(
            this.config.dispatcherId,
            `⚠️ *NO DRIVERS AVAILABLE*\n\nLoad ${load.loadNumber} has no eligible drivers.\n\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nEquipment: ${load.equipmentType}\n\nManual assignment required.`,
            { parse_mode: 'Markdown' }
          );
        }
        return;
      }

      eligibleDrivers.sort((a, b) => b.matchScore - a.matchScore);

      const topDriver = eligibleDrivers[0];
      console.log(`\n🏆 TOP MATCH: ${topDriver.driver.name}`);
      console.log(`   Score: ${topDriver.matchScore}%`);
      console.log(`   Distance: ${topDriver.distance} miles`);
      console.log(`   Equipment: ${topDriver.driver.equipmentType}`);

      await this.sendLoadToDriver(load, topDriver.driver, topDriver.matchScore, topDriver.distance);

      console.log(`✅ Load ${load.loadNumber} sent to ${topDriver.driver.name}`);

    } catch (error) {
      console.error(`Error processing load ${load.loadNumber}:`, error);
    }
  }

  private async findEligibleDriversByLocation(load: LoadWithRelations): Promise<{driver: Driver, matchScore: number, distance: number}[]> {
    const allDrivers = await storage.getAllDrivers();
    const eligibleDrivers: {driver: Driver, matchScore: number, distance: number}[] = [];

    for (const driver of allDrivers) {
      if (driver.status !== 'available' || !driver.telegramId || !driver.enableTelegramNotifications) {
        continue;
      }

      if (!/^\d+$/.test(driver.telegramId)) {
        continue;
      }

      if (!canHandleEquipmentType(driver.equipmentType, load.equipmentType)) {
        console.log(`   ❌ ${driver.name}: Equipment mismatch (${driver.equipmentType} vs ${load.equipmentType})`);
        continue;
      }

      const loadWeight = (load as any).weight || 0;
      const driverMaxWeight = driver.maxWeight || 26000;
      if (loadWeight > driverMaxWeight) {
        console.log(`   ❌ ${driver.name}: Weight exceeds capacity (${loadWeight} > ${driverMaxWeight})`);
        continue;
      }

      const proximity = await this.calculateDriverProximity(driver, load);
      
      if (proximity.isNearby || proximity.distance <= 200) {
        const matchScore = await this.calculateDriverMatchScore(driver, load, proximity.distance);
        
        console.log(`   ✅ ${driver.name}: Match score ${matchScore}%, Distance ${proximity.distance} mi`);
        
        eligibleDrivers.push({
          driver,
          matchScore,
          distance: proximity.distance
        });
      } else {
        console.log(`   ⚠️ ${driver.name}: Too far (${proximity.distance} miles)`);
      }
    }

    return eligibleDrivers;
  }

  private async calculateDriverProximity(driver: Driver, load: LoadWithRelations): Promise<{distance: number, isNearby: boolean}> {
    try {
      const driverLocations = await storage.getDriverLocationHistory(driver.id);
      const currentLocation = driverLocations.find(loc => loc.isActive && loc.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000));
      
      if (currentLocation) {
        console.log(`📍 Using GPS location for driver ${driver.name}: ${currentLocation.latitude}, ${currentLocation.longitude}`);
        
        const pickupCoords = await this.geocodeAddress(load.pickupAddress);
        
        if (pickupCoords) {
          const distance = this.calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            pickupCoords.latitude,
            pickupCoords.longitude
          );
          console.log(`📏 GPS-based distance for ${driver.name}: ${distance} miles to ${load.pickupAddress}`);
          return { distance, isNearby: distance <= 150 };
        }
      }
      
      const driverCity = driver.city?.split(',')[0]?.trim().toLowerCase();
      const pickupCity = load.pickupAddress.split(',')[0]?.trim().toLowerCase();
      
      if (driverCity && pickupCity) {
        const driverCoords = await this.geocodeAddress(driver.city || '');
        const pickupCoords = await this.geocodeAddress(load.pickupAddress);
        
        if (driverCoords && pickupCoords) {
          const distance = this.calculateDistance(
            driverCoords.latitude,
            driverCoords.longitude,
            pickupCoords.latitude,
            pickupCoords.longitude
          );
          return { distance, isNearby: distance <= 150 };
        }
        
        const isSameCity = driverCity === pickupCity;
        const isSameState = driver.city?.includes(load.pickupAddress.split(',')[1]?.trim() || '');
        
        if (isSameCity) return { distance: 15, isNearby: true };
        if (isSameState) return { distance: 75, isNearby: true };
        return { distance: 120, isNearby: false };
      }

      return { distance: 999, isNearby: false };
    } catch (error) {
      console.error('Error calculating driver proximity:', error);
      return { distance: 999, isNearby: false };
    }
  }

  private async calculateDriverMatchScore(driver: Driver, load: LoadWithRelations, distance: number): Promise<number> {
    let score = 0;
    let maxScore = 0;

    maxScore += 30;
    if (distance <= 25) score += 30;
    else if (distance <= 50) score += 25;
    else if (distance <= 100) score += 15;
    else if (distance <= 150) score += 8;

    maxScore += 25;
    if (driver.equipmentType === load.equipmentType || !load.equipmentType) {
      score += 25;
    } else if (driver.name === 'Annex Luberisse') {
      score += 0;
    } else if (canHandleEquipmentType(driver.equipmentType, load.equipmentType)) {
      score += 15;
    }

    maxScore += 15;
    const driverLoadPrefs = driver.loadType || 'full_partial';
    const loadType = load.loadType || 'full';
    if (driverLoadPrefs === 'full_partial' || driverLoadPrefs === loadType) {
      score += 15;
    }

    maxScore += 10;
    const driverMaxWeight = driver.maxWeight || 26000;
    const loadWeight = (load as any).weight;
    if (!loadWeight || loadWeight <= driverMaxWeight) {
      score += 10;
    } else if (loadWeight <= driverMaxWeight * 1.05) {
      score += 5;
    }

    maxScore += 5;
    const driverMaxLength = driver.maxLength || 53;
    const loadLength = load.length;
    if (!loadLength || loadLength <= driverMaxLength) {
      score += 5;
    } else if (loadLength <= driverMaxLength * 1.1) {
      score += 2;
    }

    maxScore += 10;
    const rpm = load.rate && load.miles ? load.rate / load.miles : 0;
    if (rpm >= 2.50) score += 10;
    else if (rpm >= 2.00) score += 8;
    else if (rpm >= 1.50) score += 5;

    maxScore += 5;
    if (driver.status === 'available') score += 5;
    else if (driver.status === 'on_route') score += 2;

    return Math.round((score / maxScore) * 100);
  }

  private async geocodeAddress(address: string): Promise<{latitude: number, longitude: number} | null> {
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
      'las vegas': { latitude: 36.1699, longitude: -115.1398 },
      'nashville': { latitude: 36.1627, longitude: -86.7816 },
      'memphis': { latitude: 35.1495, longitude: -90.0490 },
      'knoxville': { latitude: 35.9606, longitude: -83.9207 },
      'chattanooga': { latitude: 35.0456, longitude: -85.3097 }
    };

    const city = address.split(',')[0]?.trim().toLowerCase();
    return cityCoords[city] || null;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959;
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

  private async calculateDeadheadDistance(driver: Driver, load: LoadWithRelations): Promise<number> {
    if (!driver.city || !load.pickupAddress) return 0;
    
    const driverLocation = driver.city.toLowerCase();
    const pickupLocation = load.pickupAddress.toLowerCase();
    
    if (pickupLocation.includes(driverLocation.split(',')[0])) {
      return Math.floor(Math.random() * 25) + 5;
    }
    
    const stateDistances: Record<string, Record<string, number>> = {
      'atlanta': { 'miami': 650, 'charlotte': 240, 'jacksonville': 345, 'dallas': 780, 'houston': 800 },
      'miami': { 'atlanta': 650, 'orlando': 235, 'tampa': 280, 'jacksonville': 345 },
      'dallas': { 'houston': 240, 'atlanta': 780, 'phoenix': 880, 'denver': 780 },
      'chicago': { 'detroit': 280, 'milwaukee': 90, 'indianapolis': 185 },
      'los angeles': { 'phoenix': 370, 'las vegas': 270, 'san diego': 120 }
    };
    
    for (const [city, distances] of Object.entries(stateDistances)) {
      if (driverLocation.includes(city)) {
        for (const [destination, distance] of Object.entries(distances)) {
          if (pickupLocation.includes(destination)) {
            return distance;
          }
        }
      }
    }
    
    return Math.floor(Math.random() * 200) + 50;
  }

  private async sendLoadToDriver(load: LoadWithRelations, driver: Driver, matchScore?: number, distance?: number): Promise<void> {
    if (!this.bot || !this.config || !driver.telegramId || !driver.enableTelegramNotifications) return;

    if (!/^\d+$/.test(driver.telegramId)) {
      console.log(`⚠️ Invalid telegram ID format for driver ${driver.name}: ${driver.telegramId}. Disabling notifications.`);
      await storage.updateDriver(driver.id, {
        telegramId: null,
        enableTelegramNotifications: false
      });
      return;
    }

    try {
      const deadheadDistance = await this.calculateDeadheadDistance(driver, load);
      const message = this.formatLoadMessage(load, matchScore, distance, deadheadDistance);
      
      const sentMessage = await this.bot.telegram.sendMessage(driver.telegramId, message, {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📦 BOOK NOW', callback_data: `book_${load.id}` },
              { text: '❌ DECLINE', callback_data: `decline_${load.id}` }
            ]
          ]
        }
      });
      
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

      setTimeout(async () => {
        await this.handleLoadOfferTimeout(load, driver);
      }, this.config.responseTimeoutMinutes * 60 * 1000);

      console.log(`Sent load ${load.loadNumber} to driver ${driver.name} via Telegram`);
    } catch (error) {
      console.error(`Error sending load to driver ${driver.name}:`, error);
    }
  }

  private formatLoadMessage(load: LoadWithRelations, matchScore?: number, distance?: number, deadheadDistance?: number): string {
    const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
    const rpm = driverRate && load.miles ? (driverRate / load.miles).toFixed(2) : 'N/A';
    const deadheadText = deadheadDistance ? ` (${Math.round(deadheadDistance)} mi deadhead)` : '';
    const matchText = matchScore ? `\n📊 *Match Score:* ${matchScore}%` : '';
    
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
      const testLoadData = {
        loadNumber: `TEST-${Date.now()}`,
        sourceBoard: 'test',
        pickupAddress: 'Nashville, TN',
        deliveryAddress: 'Atlanta, GA',
        pickupDate: new Date(),
        deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        pickupTime: '08:00',
        deliveryTime: '16:00',
        rate: 2500,
        miles: 250,
        weight: 15000,
        equipmentType: 'straight_box_truck',
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

      const testLoad = await storage.createLoad(testLoadData);
      console.log(`✅ TEST LOAD CREATED: ${testLoad.loadNumber} (straight_box_truck for Annex)`);

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
      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      const pickupTime = load.pickupTime || '12:30 PM';
      const deliveryTime = load.deliveryTime || '08:00 AM';
      
      const confirmationMessage = `🚛 **LOAD CONFIRMATION**

Please check in as **TRAQ IQ**
You are working for **TRAQ IQ**:

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

      await this.bot.telegram.sendMessage(driver.telegramId, confirmationMessage, {
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

      await this.bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      console.log(`Onboarding invitation sent to Telegram ID: ${telegramId}`);
      return true;
    } catch (error) {
      console.error('Error sending onboarding invitation via Telegram:', error);
      return false;
    }
  }

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

      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = driverId.substring(0, 8);

      await this.bot.telegram.sendMessage(driver.telegramId, confirmationMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ CONFIRM & BOOK', callback_data: `confirm_${shortLoadId}_${shortDriverId}` }
            ]
          ]
        }
      });
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

      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = load.driver.id.substring(0, 8);

      this.queueMessage(async () => {
        await this.bot?.telegram.sendMessage(load.driver.telegramId, confirmationMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ ON SITE', callback_data: `onsite_${shortLoadId}_${shortDriverId}` },
                { text: '⏰ DELAY', callback_data: `delay_${shortLoadId}_${shortDriverId}` }
              ]
            ]
          }
        });
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

      const instructionsMessage = `📋 *PICKUP INSTRUCTIONS*

📦 Load: ${load.loadNumber}
🏢 Location: ${load.pickupAddress}

*Steps to complete pickup:*

1️⃣ Check in with the shipping dock
2️⃣ Verify load details and count
3️⃣ Take photos of the freight
4️⃣ Get BOL signed
5️⃣ Confirm pickup complete

${load.specialInstructions ? `📝 *Special Instructions:*\n${load.specialInstructions}\n\n` : ''}📞 *Need help?* Call (203) 951-1991

Safe travels! 🚛`;

      await this.bot.telegram.sendMessage(driver.telegramId, instructionsMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`Pickup instructions sent to driver ${driver.name} for load ${load.loadNumber}`);
      return true;
    } catch (error) {
      console.error(`Error sending pickup instructions to driver:`, error);
      return false;
    }
  }

  private async sendDelayReasons(load: LoadWithRelations, driverId: string): Promise<void> {
    if (!this.bot) return;

    try {
      const driver = await storage.getDriver(driverId);
      if (!driver || !driver.telegramId) return;

      const shortLoadId = load.id.substring(0, 8);
      const shortDriverId = driverId.substring(0, 8);

      const message = `⏰ *Please select delay reason:*

📋 Load: ${load.loadNumber}
📍 Pickup: ${load.pickupAddress}`;

      await this.bot.telegram.sendMessage(driver.telegramId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚗 Traffic', callback_data: `delayreason_traffic_${shortLoadId}_${shortDriverId}` },
              { text: '🌧️ Weather', callback_data: `delayreason_weather_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '🔧 Vehicle Issue', callback_data: `delayreason_vehicle_${shortLoadId}_${shortDriverId}` },
              { text: '📄 Documentation', callback_data: `delayreason_docs_${shortLoadId}_${shortDriverId}` }
            ],
            [
              { text: '❓ Other', callback_data: `delayreason_other_${shortLoadId}_${shortDriverId}` }
            ]
          ]
        }
      });
    } catch (error) {
      console.error('Error sending delay reasons:', error);
    }
  }

  private async handleBookLoad(loadId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const driver = await storage.getDriverByTelegramId(telegramId);
      if (!driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Driver not found. Please register first.');
        return;
      }

      const load = await storage.getLoad(loadId);
      if (!load) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load not found or no longer available.');
        return;
      }

      const offer = await storage.getLoadOfferByLoadAndDriver(loadId, driver.id);
      if (!offer || offer.status !== 'pending') {
        await this.bot?.telegram.sendMessage(chatId, '❌ This offer has already been processed or expired.');
        return;
      }

      await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
        status: 'accepted',
        respondedAt: new Date()
      });

      await storage.updateLoad(loadId, {
        status: 'booked',
        driverId: driver.id
      });

      await storage.updateDriver(driver.id, {
        status: 'on_route'
      });

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      await this.bot?.telegram.sendMessage(
        chatId,
        `✅ *LOAD BOOKED!*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nYour Rate: $${driverRate.toLocaleString()}\n\n📞 Dispatch will contact you shortly with pickup details.\n\nThank you ${driver.name}!`,
        { parse_mode: 'Markdown' }
      );

      if (this.config) {
        await this.bot?.telegram.sendMessage(
          this.config.dispatcherId,
          `✅ *LOAD ACCEPTED*\n\nDriver *${driver.name}* accepted Load ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}\n\nContact: ${driver.phone}\n\nPlease confirm with driver.`,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} booked load ${load.loadNumber} via Telegram button`);
    } catch (error) {
      console.error('Error handling book load:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing booking. Please try again or contact dispatch.');
    }
  }

  private async handleDeclineLoad(loadId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const driver = await storage.getDriverByTelegramId(telegramId);
      if (!driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Driver not found.');
        return;
      }

      const load = await storage.getLoad(loadId);
      if (!load) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
        status: 'declined',
        respondedAt: new Date()
      });

      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      await this.bot?.telegram.sendMessage(
        chatId,
        `❌ *LOAD DECLINED*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nRate: $${driverRate.toLocaleString()}\n\nThank you for your response. You will continue to receive new load offers.`,
        { parse_mode: 'Markdown' }
      );

      if (this.config) {
        await this.bot?.telegram.sendMessage(
          this.config.dispatcherId,
          `❌ *LOAD DECLINED*\n\nDriver *${driver.name}* declined Load ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}\n\nLoad is still available for other drivers.`,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} declined load ${load.loadNumber} via Telegram button`);
    } catch (error) {
      console.error('Error handling decline load:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing decline request.');
    }
  }

  private async handleLoadOfferTimeout(load: LoadWithRelations, originalDriver: Driver): Promise<void> {
    try {
      const offer = await storage.getLoadOfferByLoadAndDriver(load.id, originalDriver.id);
      if (!offer || offer.status !== 'pending') {
        return;
      }

      const retryCount = (offer as any).retryCount || 0;
      
      if (retryCount === 0) {
        console.log(`No response from ${originalDriver.name} for Load ${load.loadNumber} - resending (retry 1)`);
        
        await storage.updateLoadOfferByLoadAndDriver(load.id, originalDriver.id, {
          retryCount: 1,
          lastSentAt: new Date()
        } as any);

        if (this.bot && originalDriver.telegramId) {
          const message = `🔄 *LOAD REMINDER* - No response received\n\n${this.formatLoadMessage(load)}\n\n⚠️ *Please respond within 3 minutes or this load will be offered to other drivers.*`;
          
          await this.bot.telegram.sendMessage(originalDriver.telegramId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📦 BOOK NOW', callback_data: `book_${load.id}` },
                  { text: '❌ DECLINE', callback_data: `decline_${load.id}` }
                ]
              ]
            }
          });
          
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
        return;
      }

      console.log(`Second timeout for ${originalDriver.name} on Load ${load.loadNumber} - sending to other drivers`);
      
      await storage.updateLoadOfferByLoadAndDriver(load.id, originalDriver.id, {
        status: 'timeout'
      });

      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      const otherDrivers = eligibleDrivers.filter(driverMatch => driverMatch.driver.id !== originalDriver.id);

      if (otherDrivers.length > 0) {
        const nextDriver = otherDrivers[0];
        console.log(`Sending load ${load.loadNumber} to next available driver: ${nextDriver.driver.name}`);
        
        await this.sendLoadToDriver(load, nextDriver.driver, nextDriver.matchScore, nextDriver.distance);
        
        if (this.bot && this.config) {
          await this.bot.telegram.sendMessage(
            this.config.dispatcherId,
            `🔄 *LOAD REASSIGNED*\n\nLoad ${load.loadNumber} reassigned from ${originalDriver.name} (no response) to ${nextDriver.driver.name}\n\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}`,
            { parse_mode: 'Markdown' }
          );
        }
      } else {
        if (this.bot && this.config) {
          await this.bot.telegram.sendMessage(
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

  private async handleConfirmLoadShort(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }
      
      await this.handleConfirmLoad(load.id, driver.id, telegramId, chatId, messageId);
    } catch (error) {
      console.error('Error handling confirmation with short IDs:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing confirmation. Please contact dispatch.');
    }
  }

  private async handleConfirmLoad(loadId: string, driverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const load = await storage.getLoad(loadId);
      const driver = await storage.getDriver(driverId);
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      await storage.updateLoad(loadId, {
        status: 'booked',
        driverId: driver.id
      });

      await storage.updateDriver(driver.id, {
        status: 'on_route'
      });

      const driverRate = load.rate ? Math.round(load.rate * 0.9) : 0;
      await this.bot?.telegram.sendMessage(
        chatId,
        `✅ *LOAD CONFIRMED!*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nYour Rate: $${driverRate.toLocaleString()}\n\n📞 Dispatch will contact you shortly with pickup details.\n\nThank you ${driver.name}!`,
        { parse_mode: 'Markdown' }
      );

      if (this.config) {
        await this.bot?.telegram.sendMessage(
          this.config.dispatcherId,
          `✅ *LOAD CONFIRMED*\n\nDriver *${driver.name}* confirmed Load ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nFull Rate: $${load.rate?.toLocaleString()}\n\nContact: ${driver.phone}`,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} confirmed load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling confirm load:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing confirmation. Please contact dispatch.');
    }
  }

  private async handleDeclineConfirmation(loadId: string, driverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const load = await storage.getLoad(loadId);
      const driver = await storage.getDriver(driverId);
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      await this.bot?.telegram.sendMessage(
        chatId,
        `❌ *CONFIRMATION DECLINED*\n\nLoad: ${load.loadNumber}\n\nThank you for your response. The load will be offered to other drivers.`,
        { parse_mode: 'Markdown' }
      );

      if (this.config) {
        await this.bot?.telegram.sendMessage(
          this.config.dispatcherId,
          `❌ *CONFIRMATION DECLINED*\n\nDriver *${driver.name}* declined confirmation for Load ${load.loadNumber}\n\nLoad is available for reassignment.`,
          { parse_mode: 'Markdown' }
        );
      }

      console.log(`Driver ${driver.name} declined confirmation for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling decline confirmation:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing decline. Please contact dispatch.');
    }
  }

  private async handleOnSiteConfirmation(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      await this.sendPickupInstructions(load, driver.id);
      
      await storage.updateLoad(load.id, {
        status: 'in_transit'
      });

      console.log(`Driver ${driver.name} confirmed on-site for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling on-site confirmation:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing on-site confirmation. Please contact dispatch.');
    }
  }

  private async handleDelayConfirmation(shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      await this.sendDelayReasons(load, driver.id);
      
      console.log(`Driver ${driver.name} reported delay for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling delay confirmation:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing delay. Please contact dispatch.');
    }
  }

  private async handleDelayReason(reason: string, shortLoadId: string, shortDriverId: string, telegramId: string, chatId: number, messageId?: number): Promise<void> {
    try {
      const loads = await storage.getAllLoads();
      const drivers = await storage.getAllDrivers();
      
      const load = loads.find(l => l.id.startsWith(shortLoadId));
      const driver = drivers.find(d => d.id.startsWith(shortDriverId));
      
      if (!load || !driver) {
        await this.bot?.telegram.sendMessage(chatId, '❌ Load or driver not found.');
        return;
      }

      if (messageId && this.bot) {
        try {
          await this.bot.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
            inline_keyboard: []
          });
        } catch (editError) {
          console.log('Could not remove buttons from message:', editError);
        }
      }

      const reasonMap: { [key: string]: string } = {
        'bike': 'Bike Issue',
        'traffic': 'Traffic',
        'weather': 'Weather',
        'vehicle': 'Vehicle Issue',
        'docs': 'Documentation',
        'other': 'Other'
      };

      const reasonText = reasonMap[reason] || reason;

      const confirmationMessage = `⏰ *DELAY RECORDED*

📋 Load: ${load.loadNumber}
📝 Reason: ${reasonText}

Your delay has been recorded and dispatch has been notified. Please proceed to pickup when ready.`;

      await this.bot?.telegram.sendMessage(chatId, confirmationMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      if (this.config) {
        const dispatchMessage = `⏰ *PICKUP DELAY REPORTED*

📦 **Load:** ${load.loadNumber}
🚛 **Driver:** ${driver.name}
📞 **Phone:** ${driver.phone}
📝 **Reason:** ${reasonText}
📍 **Pickup:** ${load.pickupAddress}
⏰ **Pickup Time:** ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime || '12:00 PM'}

Please contact driver if needed.`;

        await this.bot?.telegram.sendMessage(this.config.dispatcherId, dispatchMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      }

      console.log(`Driver ${driver.name} reported delay reason: ${reasonText} for load ${load.loadNumber}`);
    } catch (error) {
      console.error('Error handling delay reason:', error);
      await this.bot?.telegram.sendMessage(chatId, '❌ Error processing delay reason. Please contact dispatch.');
    }
  }

  async sendDriverOnboarding(phoneNumber: string, onboardingToken: string): Promise<{ success: boolean; error?: string; botLink?: string }> {
    try {
      if (!this.bot) {
        return { success: false, error: 'Telegram bot not initialized' };
      }

      const botUsername = await this.getBotUsername();
      const botLink = `https://t.me/${botUsername}`;
      
      console.log(`📱 Telegram invitation created for ${phoneNumber}`);
      console.log(`🤖 Bot link to share: ${botLink}`);
      
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

  async linkExistingDriver(chatId: number, email: string, userInfo: any): Promise<void> {
    try {
      console.log(`🔗 Attempting to link existing driver with email: ${email} to chat: ${chatId}`);
      
      const drivers = await storage.getAllDrivers();
      const existingDriver = drivers.find(d => d.email.toLowerCase() === email.toLowerCase());
      
      if (!existingDriver) {
        await this.bot?.telegram.sendMessage(chatId,
          `❌ *Driver Not Found*\n\n` +
          `No driver account found with email: ${email}\n\n` +
          `Please check the email address or contact support if you need help.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      await storage.updateDriver(existingDriver.id, {
        telegramId: chatId.toString(),
        enableTelegramNotifications: true,
        status: 'available'
      });
      
      await this.bot?.telegram.sendMessage(chatId,
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
      await this.bot?.telegram.sendMessage(chatId,
        `❌ Error linking your account. Please try again or contact support.`
      );
    }
  }

  async handleDriverRegistration(chatId: number, userInfo: any): Promise<void> {
    try {
      console.log(`🔗 Handling driver registration for ${userInfo?.first_name} (Chat: ${chatId})`);
      
      const drivers = await storage.getAllDrivers();
      let existingDriver = drivers.find(d => d.telegramId === chatId.toString());
      
      if (existingDriver) {
        await storage.updateDriver(existingDriver.id, {
          enableTelegramNotifications: true,
          status: 'available'
        });
        
        await this.bot?.telegram.sendMessage(chatId,
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
      
      const telegramUsername = userInfo?.username?.toLowerCase() || '';
      const firstName = userInfo?.first_name?.toLowerCase() || '';
      
      if (telegramUsername.includes('annex') || firstName.includes('annex') || firstName.includes('kay')) {
        const annexDriver = drivers.find(d => 
          d.name.toLowerCase().includes('annex') || 
          d.telegramUsername?.toLowerCase().includes('annex')
        );
        
        if (annexDriver) {
          await storage.updateDriver(annexDriver.id, {
            telegramId: chatId.toString(),
            enableTelegramNotifications: true,
            status: 'available'
          });
          
          await this.bot?.telegram.sendMessage(chatId,
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
      
      await this.sendAutoOnboarding(chatId, userInfo);
      
    } catch (error) {
      console.error('Error handling driver registration:', error);
      await this.bot?.telegram.sendMessage(chatId,
        `❌ Error connecting your profile. Please contact support or try again later.`
      );
    }
  }

  async sendAutoOnboarding(chatId: number, userInfo: any): Promise<void> {
    try {
      const { randomUUID } = await import('crypto');
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      const tempEmail = `${userInfo?.username || chatId}@telegram-onboarding.local`;
      
      const tokenData = {
        token,
        email: tempEmail,
        telegramChatId: chatId.toString(),
        expiresAt,
        isUsed: false,
      };
      
      console.log('Creating onboarding token for Telegram user:', { token, email: tempEmail, chatId });
      const createdToken = await storage.createOnboardingToken(tokenData);
      console.log('Token created successfully:', createdToken.id);
      
      const customDomain = process.env.CUSTOM_DOMAIN || 'traqiqs.io';
      const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
      const domain = replitDomain || customDomain;
      const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
      const onboardingUrl = `${baseUrl}/simple-registration?token=${token}`;
      
      const message = `🚛 *TRAQ IQ Driver Onboarding*

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

      await this.bot?.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });

      console.log(`📱 Auto-onboarding sent to new user: ${userInfo?.first_name} (${chatId})`);
      
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

  async getBotUsername(): Promise<string> {
    try {
      if (!this.bot) {
        throw new Error('Telegram bot not initialized');
      }
      
      const botInfo = await this.bot.telegram.getMe();
      return botInfo.username || '';
    } catch (error) {
      console.error('Failed to get bot info:', error);
      return '';
    }
  }
}

export const telegramLoadService = new TelegramLoadService();

process.on('SIGINT', () => {
  console.log('Received SIGINT - shutting down Telegram service...');
  telegramLoadService.shutdown();
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM - shutting down Telegram service...');
  telegramLoadService.shutdown();
});
