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
          const loadId = data.substring(8); // Remove 'decline_' prefix
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
        }
      } catch (error) {
        console.error('Error handling callback query:', error);
        this.bot.sendMessage(chatId, '❌ Error processing your request.');
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

      console.log(`Sent load ${load.loadNumber} to ${eligibleDrivers.length} drivers via Telegram`);
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

        // Skip unavailable drivers immediately
        if (driver.status === 'unavailable') continue;

        // Calculate proximity score and distance
        const proximity = await this.calculateDriverProximity(driver, load);
        if (proximity.distance > 150) continue; // Skip drivers more than 150 miles away

        // Calculate overall match score
        const matchScore = await this.calculateDriverMatchScore(driver, load, proximity.distance);
        console.log(`Driver ${driver.name} match score for load ${load.loadNumber}: ${matchScore}% (distance: ${proximity.distance}mi, equipment: ${driver.equipmentType}/${load.equipmentType})`);
        if (matchScore < 40) continue; // Lowered threshold to 40% for better matching

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

    // Distance score (30% weight) - closer is better
    maxScore += 30;
    if (distance <= 25) score += 30;
    else if (distance <= 50) score += 25;
    else if (distance <= 100) score += 15;
    else if (distance <= 150) score += 8;

    // Equipment type match (25% weight)
    maxScore += 25;
    if (driver.equipmentType === load.equipmentType || !load.equipmentType) {
      score += 25;
    }

    // Load type preference match (15% weight)
    maxScore += 15;
    const driverLoadPrefs = driver.preferredLoadTypes || 'full_partial';
    const loadType = load.loadType || 'full';
    if (driverLoadPrefs === 'full_partial' || driverLoadPrefs === loadType) {
      score += 15;
    }

    // Weight capacity match (10% weight)
    maxScore += 10;
    const driverMaxWeight = driver.maxWeight || driver.weightCapacity || 48000;
    if (load.weight && load.weight <= driverMaxWeight) {
      score += 10;
    } else if (load.weight && load.weight <= driverMaxWeight * 1.1) {
      score += 5; // Allow 10% over capacity with reduced score
    } else if (!load.weight) {
      score += 8; // Default score if weight not specified
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
    if (!this.bot || !this.config || !driver.telegramId) return;

    try {
      // Calculate deadhead distance for this driver and load
      const deadheadDistance = await this.calculateDeadheadDistance(driver, load);
      
      // Format load message (from script)
      const message = this.formatLoadMessage(load, matchScore, distance, deadheadDistance);
      
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
    const distanceText = distance ? ` (${Math.round(distance)} mi away)` : '';
    const matchText = matchScore ? `\n📊 *Match Score:* ${matchScore}%` : '';
    const deadheadText = deadheadDistance ? `\n🛣️ *Deadhead:* ${Math.round(deadheadDistance)} mi` : '';
    
    return `🚛 *LAMP Logistics New Load Offer*${distanceText}
Origin: *${load.pickupAddress}*
Destination: *${load.deliveryAddress}*
Pick-Up Date: *${load.pickupDate.toLocaleDateString()}*
Weight: *${load.weight.toLocaleString()} lbs*
Rate: *$${driverRate.toLocaleString() || 'TBD'}*
Miles: *${load.miles || 'N/A'} mi*
Rate/Mile: *$${rpm}*${deadheadText}${matchText}

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
**Address:** ${load.customerCompany || 'Customer'}
${load.pickupAddress}
======================

📝 **Notes:**
${load.specialInstructions || 'No special instructions'}

======================
🏁 **Deliver:** ${load.deliveryDate.toLocaleDateString()} ${deliveryTime}
**Customer:** ${load.customerCompany || 'Delivery Location'}
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
📦 Weight: ${load.weight.toLocaleString()} lbs
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

      await this.bot.sendMessage(load.driver.telegramId, confirmationMessage, options);
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

      await this.bot.sendMessage(driver.telegramId, instructionsMessage, {
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

  /**
   * Send a direct message via Telegram (for booking confirmations, etc.)
   */
  async sendMessage(chatId: string, message: string): Promise<number | null> {
    if (!this.bot || !this.isRunning) {
      console.log('Telegram service not running - would send:', message);
      return null;
    }

    try {
      const sentMessage = await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`Sent message to chat ${chatId}: ${message.substring(0, 100)}...`);
      return sentMessage.message_id;
    } catch (error) {
      console.error('Error sending message via Telegram:', error);
      return null;
    }
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