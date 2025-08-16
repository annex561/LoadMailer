import TelegramBot from "node-telegram-bot-api";
import { storage } from "./storage";
import type { LoadWithRelations, Driver, LanePreference, AvoidLocation, TelegramBotConfig, LoadOffer } from "@shared/schema";

// Bot configuration from the script
const TELEGRAM_TOKEN = '8322765631:AAExgmA8q8PEAhhgdhyaIKX0mdVH8bZuN1c';
const DISPATCHER_ID = '5908383693';

export class TelegramLoadService {
  private bot: TelegramBot | null = null;
  private config: TelegramBotConfig | null = null;
  private isRunning = false;

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Telegram Load Dispatcher...');
      
      // Initialize bot configuration
      await this.initializeBotConfig();
      
      // Create bot instance
      this.bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
      
      // Set up command handlers
      this.setupCommandHandlers();
      
      // Initialize default data
      await this.initializeDefaultData();
      
      this.isRunning = true;
      console.log('Telegram Load Dispatcher initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Telegram service:', error);
      throw error;
    }
  }

  private async initializeBotConfig(): Promise<void> {
    // Check if bot config exists, if not create it
    const configs = await storage.getAllTelegramBotConfigs();
    if (configs.length === 0) {
      this.config = await storage.createTelegramBotConfig({
        botToken: TELEGRAM_TOKEN,
        dispatcherId: DISPATCHER_ID,
        botUsername: 'LoadMailerBot',
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

    // Update existing driver with telegram info from script
    const drivers = await storage.getAllDrivers();
    if (drivers.length > 0) {
      const firstDriver = drivers[0];
      // Update with Alex Liberty info from script
      await storage.updateDriver(firstDriver.id, {
        telegramId: '5908383693',
        city: 'Atlanta, GA',
        phone: '+15615777540',
        enableTelegramNotifications: true
      });
      console.log('Updated driver with Telegram information');
    }
  }

  private setupCommandHandlers(): void {
    if (!this.bot) return;

    // Welcome message
    this.bot.onText(/\/start/, (msg: any) => {
      if (!this.bot) return;
      this.bot.sendMessage(msg.chat.id, 'Welcome to LAMP Load Dispatcher 🚛');
    });

    // Book load handler
    this.bot.onText(/book_(\w+)/, async (msg: any, match: any) => {
      if (!this.bot || !match) return;
      
      const loadId = match[1];
      const telegramId = msg.from?.id.toString();
      
      if (!telegramId) return;

      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          this.bot.sendMessage(msg.chat.id, '❌ Driver not found. Please contact dispatcher.');
          return;
        }

        // Update load offer status
        await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
          status: 'accepted',
          respondedAt: new Date()
        });

        // Assign driver to load
        await storage.updateLoad(loadId, {
          driverId: driver.id,
          status: 'assigned'
        });

        // Send confirmation to driver
        this.bot.sendMessage(
          msg.chat.id,
          '✅ Booking request received. Dispatcher is working on it. If no reply in 15 min, feel free to bid on other loads.'
        );

        // Notify dispatcher
        if (this.config) {
          this.bot.sendMessage(
            this.config.dispatcherId,
            `📞 *BOOKING CONFIRMATION*\nDriver *${driver.name}* accepted Load ${loadId}.\nPhone: ${driver.phone}\nLocation: ${driver.city}\n\n[📞 Call Carrier Now](tel:${driver.phone})`,
            { parse_mode: 'Markdown' }
          );
        }

        console.log(`Driver ${driver.name} accepted load ${loadId}`);
      } catch (error) {
        console.error('Error handling book command:', error);
        this.bot.sendMessage(msg.chat.id, '❌ Error processing booking request.');
      }
    });

    // Decline load handler
    this.bot.onText(/decline_(\w+)/, async (msg: any, match: any) => {
      if (!this.bot || !match) return;
      
      const loadId = match[1];
      const telegramId = msg.from?.id.toString();
      
      if (!telegramId) return;

      try {
        const driver = await storage.getDriverByTelegramId(telegramId);
        if (!driver) {
          this.bot.sendMessage(msg.chat.id, '❌ Driver not found. Please contact dispatcher.');
          return;
        }

        // Update load offer status
        await storage.updateLoadOfferByLoadAndDriver(loadId, driver.id, {
          status: 'declined',
          respondedAt: new Date()
        });

        // Notify dispatcher
        if (this.config) {
          this.bot.sendMessage(
            this.config.dispatcherId,
            `❌ Driver ${driver.name} declined Load ${loadId}.`
          );
        }

        // Send confirmation to driver
        this.bot.sendMessage(msg.chat.id, '❌ Load declined. Thank you for your response.');

        console.log(`Driver ${driver.name} declined load ${loadId}`);
      } catch (error) {
        console.error('Error handling decline command:', error);
        this.bot.sendMessage(msg.chat.id, '❌ Error processing decline request.');
      }
    });
  }

  async processNewLoad(load: LoadWithRelations): Promise<boolean> {
    if (!this.bot || !this.config || !this.isRunning) {
      console.log('Telegram service not initialized, skipping load notification');
      return false;
    }

    try {
      // Check if load matches preferred lanes
      const matchesLane = await this.matchesPreferredLane(load);
      if (!matchesLane) {
        console.log(`Load ${load.loadNumber} does not match preferred lanes, skipping Telegram notification`);
        return false;
      }

      // Get eligible drivers
      const drivers = await storage.getDriversWithTelegramEnabled();
      
      if (drivers.length === 0) {
        console.log('No drivers with Telegram enabled found');
        return false;
      }

      // Send load offers to drivers
      for (const driver of drivers) {
        await this.sendLoadToDriver(load, driver);
      }

      console.log(`Sent load ${load.loadNumber} to ${drivers.length} drivers via Telegram`);
      return true;
    } catch (error) {
      console.error('Error processing new load for Telegram:', error);
      return false;
    }
  }

  private async matchesPreferredLane(load: LoadWithRelations): Promise<boolean> {
    try {
      // Always allow test loads
      if (load.sourceBoard === 'test') {
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

  private async sendLoadToDriver(load: LoadWithRelations, driver: Driver): Promise<void> {
    if (!this.bot || !this.config || !driver.telegramId) return;

    try {
      // Format load message (from script)
      const message = this.formatLoadMessage(load);
      
      // Send message with inline keyboard
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

      // Set timeout for no response
      setTimeout(async () => {
        try {
          const offer = await storage.getLoadOfferByLoadAndDriver(load.id, driver.id);
          if (offer && offer.status === 'pending') {
            // Update offer status to timeout
            await storage.updateLoadOfferByLoadAndDriver(load.id, driver.id, {
              status: 'timeout'
            });

            // Notify dispatcher
            if (this.bot && this.config) {
              this.bot.sendMessage(
                this.config.dispatcherId,
                `⏰ No response from ${driver.name} for Load ${load.loadNumber} in ${this.config.responseTimeoutMinutes} minutes.`
              );
            }
          }
        } catch (error) {
          console.error('Error handling timeout:', error);
        }
      }, this.config.responseTimeoutMinutes * 60 * 1000);

      console.log(`Sent load ${load.loadNumber} to driver ${driver.name} via Telegram`);
    } catch (error) {
      console.error(`Error sending load to driver ${driver.name}:`, error);
    }
  }

  private formatLoadMessage(load: LoadWithRelations): string {
    const rpm = load.rate && load.miles ? (load.rate / load.miles).toFixed(2) : 'N/A';
    
    return `🚛 *New Load Offer*
Origin: *${load.pickupAddress}*
Destination: *${load.deliveryAddress}*
Pick-Up Date: *${load.pickupDate.toLocaleDateString()}*
Weight: *${load.weight.toLocaleString()} lbs*
Rate: *$${load.rate?.toLocaleString() || 'TBD'}*
Miles: *${load.miles || 'N/A'} mi*
Rate/Mile: *$${rpm}*

${load.temperatureRequired ? '🌡️ *Temperature Controlled*\n' : ''}${load.specialInstructions ? `📝 *Instructions:* ${load.specialInstructions}\n` : ''}
*Load #:* ${load.loadNumber}`;
  }

  async sendTestLoad(): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running');
      return false;
    }

    try {
      // Get a sample load or create test data
      const loads = await storage.getAllLoads();
      if (loads.length > 0) {
        // Find the most recent test load or any available load
        const testLoad = loads.find(load => load.sourceBoard === 'test') || loads[0];
        await this.processNewLoad(testLoad);
        return true;
      }
      
      console.log('No loads available for testing');
      return false;
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