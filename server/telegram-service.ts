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

      // Get eligible drivers based on location and preferences
      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      
      if (eligibleDrivers.length === 0) {
        console.log('No eligible drivers found for load');
        return false;
      }

      // Send load offers to eligible drivers sorted by proximity and match score
      for (const driverMatch of eligibleDrivers) {
        await this.sendLoadToDriver(load, driverMatch.driver, driverMatch.matchScore, driverMatch.distance);
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
      const allDrivers = await storage.getDriversWithTelegramEnabled();
      const eligibleDrivers: Array<{driver: Driver, matchScore: number, distance: number}> = [];

      for (const driver of allDrivers) {
        if (!driver.city) continue;

        // Calculate proximity score and distance
        const proximity = await this.calculateDriverProximity(driver, load);
        if (proximity.distance > 150) continue; // Skip drivers more than 150 miles away

        // Calculate overall match score
        const matchScore = await this.calculateDriverMatchScore(driver, load, proximity.distance);
        if (matchScore < 60) continue; // Skip drivers with less than 60% match

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

  // Calculate driver proximity to pickup location
  private async calculateDriverProximity(driver: Driver, load: LoadWithRelations): Promise<{distance: number, isNearby: boolean}> {
    try {
      // Use city-based proximity calculation with coordinates when possible
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
          return { distance, isNearby: distance <= 100 };
        }
        
        // Fallback to simple city matching
        const isSameCity = driverCity === pickupCity;
        return { distance: isSameCity ? 15 : 85, isNearby: isSameCity };
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

    // Distance score (40% weight) - closer is better
    maxScore += 40;
    if (distance <= 25) score += 40;
    else if (distance <= 50) score += 30;
    else if (distance <= 100) score += 20;
    else if (distance <= 150) score += 10;

    // Equipment type match (25% weight)
    maxScore += 25;
    if (driver.equipmentType === load.equipmentType || !load.equipmentType) {
      score += 25;
    }

    // Rate attractiveness (20% weight)
    maxScore += 20;
    const rpm = load.rate && load.miles ? load.rate / load.miles : 0;
    if (rpm >= 2.50) score += 20;
    else if (rpm >= 2.00) score += 15;
    else if (rpm >= 1.50) score += 10;

    // Driver availability (15% weight)
    maxScore += 15;
    if (driver.status === 'available') score += 15;
    else if (driver.status === 'on_route') score += 5;

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

  private async sendLoadToDriver(load: LoadWithRelations, driver: Driver, matchScore?: number, distance?: number): Promise<void> {
    if (!this.bot || !this.config || !driver.telegramId) return;

    try {
      // Format load message (from script)
      const message = this.formatLoadMessage(load, matchScore, distance);
      
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

  private formatLoadMessage(load: LoadWithRelations, matchScore?: number, distance?: number): string {
    const rpm = load.rate && load.miles ? (load.rate / load.miles).toFixed(2) : 'N/A';
    const distanceText = distance ? ` (${Math.round(distance)} mi away)` : '';
    const matchText = matchScore ? `\n📊 *Match Score:* ${matchScore}%` : '';
    
    return `🚛 *New Load Offer*${distanceText}
Origin: *${load.pickupAddress}*
Destination: *${load.deliveryAddress}*
Pick-Up Date: *${load.pickupDate.toLocaleDateString()}*
Weight: *${load.weight.toLocaleString()} lbs*
Rate: *$${load.rate?.toLocaleString() || 'TBD'}*
Miles: *${load.miles || 'N/A'} mi*
Rate/Mile: *$${rpm}*${matchText}

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

  async sendOnboardingInvitation(telegramId: string, onboardingToken: string, email: string): Promise<boolean> {
    if (!this.bot || !this.isRunning) {
      console.error('Telegram service not initialized');
      return false;
    }

    try {
      const onboardingUrl = `${process.env.REPLIT_APP_URL || 'https://loadmaster.replit.app'}/driver-onboarding?token=${onboardingToken}`;
      
      const message = `🚛 **Welcome to LoadMaster!**
      
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

👆 Click the link above to start your onboarding process and familiarize yourself with the LoadMaster system!`;

      await this.bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      console.log(`Onboarding invitation sent to Telegram ID: ${telegramId}`);
      return true;
    } catch (error) {
      console.error('Error sending onboarding invitation via Telegram:', error);
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

    try {
      const sentMessage = await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`Sent dispatcher notification to chat: ${chatId}`);
      return sentMessage.message_id;
    } catch (error) {
      console.error('Error sending dispatcher notification via Telegram:', error);
      return null;
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