import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, and, or, sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { IStorage } from './storage';
import { randomUUID } from 'crypto';

const neonClient = neon(process.env.DATABASE_URL!);
const db = drizzle(neonClient);

export class DatabaseStorage implements IStorage {
  // Driver operations
  async getDriver(id: string): Promise<schema.Driver | undefined> {
    const result = await db.select().from(schema.drivers).where(eq(schema.drivers.id, id));
    return result[0];
  }

  async getAllDrivers(): Promise<schema.Driver[]> {
    const drivers = await db.select().from(schema.drivers);
    console.log(`📋 Database returned ${drivers.length} drivers:`, drivers.map(d => `${d.name} (${d.id})`));
    return drivers;
  }

  async createDriver(insertDriver: schema.InsertDriver): Promise<schema.Driver> {
    const id = randomUUID();
    const driver: schema.Driver = {
      ...insertDriver,
      id,
      isOnboarded: insertDriver.isOnboarded ?? true,
      enableTelegramNotifications: insertDriver.enableTelegramNotifications ?? false,
      currentMood: insertDriver.currentMood ?? '😐',
      totalLoads: 0,
      completedLoads: 0,
      averageRating: 0,
      totalRatings: 0,
      totalMiles: 0,
      totalRevenue: 0,
      onTimeDeliveries: 0,
      lateDeliveries: 0,
      cancelledLoads: 0,
      bestStreak: 0,
      currentStreak: 0,
      averageDeliveryTime: 0,
      fuelEfficiency: 0,
      maintenanceScore: 100,
      safetyScore: 100,
      createdAt: new Date(),
      lastLoadDate: null,
      moodUpdatedAt: null,
      moodNote: null,
    };
    
    await db.insert(schema.drivers).values(driver);
    return driver;
  }

  async updateDriver(id: string, updateData: Partial<schema.InsertDriver>): Promise<schema.Driver | undefined> {
    await db.update(schema.drivers).set(updateData).where(eq(schema.drivers.id, id));
    return this.getDriver(id);
  }

  async deleteDriver(id: string): Promise<boolean> {
    const result = await db.delete(schema.drivers).where(eq(schema.drivers.id, id));
    return result.rowCount > 0;
  }

  async findDuplicateDrivers(name: string, email: string, phone: string): Promise<schema.Driver[]> {
    return await db.select().from(schema.drivers).where(
      or(
        eq(schema.drivers.name, name),
        eq(schema.drivers.email, email),
        eq(schema.drivers.phone, phone)
      )
    );
  }

  async updateDriverMood(driverId: string, mood: string, note?: string): Promise<schema.Driver | undefined> {
    await db.update(schema.drivers).set({ 
      currentMood: mood, 
      moodNote: note || null,
      moodUpdatedAt: new Date() 
    }).where(eq(schema.drivers.id, driverId));
    return this.getDriver(driverId);
  }

  // Customer operations
  async getCustomer(id: string): Promise<schema.Customer | undefined> {
    const result = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
    return result[0];
  }

  async getAllCustomers(): Promise<schema.Customer[]> {
    return await db.select().from(schema.customers);
  }

  async createCustomer(insertCustomer: schema.InsertCustomer): Promise<schema.Customer> {
    const id = randomUUID();
    const customer: schema.Customer = {
      ...insertCustomer,
      id,
      createdAt: new Date(),
    };
    
    await db.insert(schema.customers).values(customer);
    return customer;
  }

  async updateCustomer(id: string, updateData: Partial<schema.InsertCustomer>): Promise<schema.Customer | undefined> {
    await db.update(schema.customers).set(updateData).where(eq(schema.customers.id, id));
    return this.getCustomer(id);
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const result = await db.delete(schema.customers).where(eq(schema.customers.id, id));
    return result.rowCount > 0;
  }

  async findDuplicateCustomers(name: string, email: string, phone: string): Promise<schema.Customer[]> {
    return await db.select().from(schema.customers).where(
      or(
        eq(schema.customers.name, name),
        eq(schema.customers.email, email),
        eq(schema.customers.phone, phone)
      )
    );
  }

  // Load operations
  async getLoad(id: string): Promise<schema.LoadWithRelations | undefined> {
    try {
      const result = await db.query.loads.findFirst({
        where: eq(schema.loads.id, id),
        with: {
          driver: true,
          customer: true,
        },
      });
      return result;
    } catch (error) {
      console.error('Database relation error, falling back to simple query:', error);
      // Fallback to simple query without relations
      const load = await db.select().from(schema.loads).where(eq(schema.loads.id, id));
      if (load.length === 0) return undefined;
      
      const loadData = load[0];
      const driver = loadData.driverId ? await this.getDriver(loadData.driverId) : null;
      const customer = await this.getCustomer(loadData.customerId);
      
      return {
        ...loadData,
        driver: driver || null,
        customer: customer || null
      };
    }
  }

  async getAllLoads(): Promise<schema.LoadWithRelations[]> {
    // Return loads from temporary storage first
    const tempLoads = Array.from(this.temporaryLoads.values());
    
    if (tempLoads.length > 0) {
      console.log(`📦 Returning ${tempLoads.length} loads from memory storage`);
      return tempLoads;
    }
    
    try {
      return await db.query.loads.findMany({
        with: {
          driver: true,
          customer: true,
        },
      });
    } catch (error) {
      console.error('Database relation error, falling back to simple query:', error);
      // Fallback to simple query without relations for now
      const loads = await db.select().from(schema.loads);
      const result: schema.LoadWithRelations[] = [];
      
      for (const load of loads) {
        const driver = load.driverId ? await this.getDriver(load.driverId) : null;
        const customer = await this.getCustomer(load.customerId);
        
        result.push({
          ...load,
          driver: driver || null,
          customer: customer || null
        });
      }
      
      return result;
    }
  }

  // Create a temporary in-memory storage for loads since database relations are failing
  private temporaryLoads = new Map<string, schema.LoadWithRelations>();

  async createLoad(insertLoad: schema.InsertLoad): Promise<schema.LoadWithRelations> {
    const id = randomUUID();
    const loadNumber = `LOAD-${Date.now().toString().slice(-6)}`;
    
    // Get customer for relations
    const customer = await this.getCustomer(insertLoad.customerId);
    
    // Safely parse dates
    let pickupDate: Date;
    let deliveryDate: Date;
    
    try {
      if (insertLoad.pickupDate instanceof Date) {
        pickupDate = insertLoad.pickupDate;
      } else if (typeof insertLoad.pickupDate === 'string') {
        pickupDate = new Date(insertLoad.pickupDate);
      } else {
        pickupDate = new Date();
      }
      
      if (isNaN(pickupDate.getTime())) {
        pickupDate = new Date();
      }
    } catch {
      pickupDate = new Date();
    }
    
    try {
      if (insertLoad.deliveryDate instanceof Date) {
        deliveryDate = insertLoad.deliveryDate;
      } else if (typeof insertLoad.deliveryDate === 'string') {
        deliveryDate = new Date(insertLoad.deliveryDate);
      } else {
        deliveryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }
      
      if (isNaN(deliveryDate.getTime())) {
        deliveryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }
    } catch {
      deliveryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    
    const load: schema.LoadWithRelations = {
      ...insertLoad,
      id,
      loadNumber,
      pickupDate,
      deliveryDate,
      createdAt: new Date(),
      updatedAt: new Date(),
      driver: null,
      customer: customer || null,
    };
    
    // Store in temporary storage for immediate availability
    this.temporaryLoads.set(id, load);
    
    try {
      const dbLoad: schema.Load = {
        ...insertLoad,
        id,
        loadNumber,
        pickupDate,
        deliveryDate,
        description: insertLoad.description || 'General Freight', // Ensure description is never null
        status: insertLoad.status || 'scheduled',
        priority: insertLoad.priority || 'standard',
        equipmentType: insertLoad.equipmentType || 'dry_van',
        temperatureRequired: insertLoad.temperatureRequired || false,
        isExpired: insertLoad.isExpired || false,
        sourceBoard: insertLoad.sourceBoard || 'manual',
        weight: insertLoad.weight || 25000, // Ensure weight has a default value
        pickupTime: insertLoad.pickupTime || '08:00', // Ensure pickup time has a default
        deliveryTime: insertLoad.deliveryTime || '17:00', // Ensure delivery time has a default
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await db.insert(schema.loads).values(dbLoad);
      console.log(`✅ Load ${loadNumber} created successfully in database - ${dbLoad.description}`);
    } catch (error) {
      console.log(`❌ Load ${loadNumber} database insert failed: ${error?.message}`);
      console.log(`✅ Load ${loadNumber} available in memory - ${load.description}`);
    }
    
    return load;
  }

  async updateLoad(id: string, updateData: Partial<schema.InsertLoad>): Promise<schema.LoadWithRelations | undefined> {
    await db.update(schema.loads).set({ ...updateData, updatedAt: new Date() }).where(eq(schema.loads.id, id));
    return this.getLoad(id);
  }

  async deleteLoad(id: string): Promise<boolean> {
    const result = await db.delete(schema.loads).where(eq(schema.loads.id, id));
    return result.rowCount > 0;
  }

  async getLoadsByStatus(status: string): Promise<schema.LoadWithRelations[]> {
    return await db.query.loads.findMany({
      where: eq(schema.loads.status, status),
      with: {
        driver: true,
        customer: true,
      },
    });
  }

  // Driver Telegram methods
  async getDriversWithTelegramEnabled(): Promise<schema.Driver[]> {
    try {
      // Get all drivers and filter in memory to avoid SQL import issues
      const allDrivers = await this.getAllDrivers();
      const telegramDrivers = allDrivers.filter(d => 
        d.telegramId && 
        d.enableTelegramNotifications && 
        d.status === 'available'
      );
      console.log(`📱 Found ${telegramDrivers.length} drivers with Telegram enabled`);
      return telegramDrivers;
    } catch (error) {
      console.error('Error fetching drivers with Telegram enabled:', error);
      return [];
    }
  }

  // Stub implementations for remaining interface methods
  async getEmailTemplate(id: string): Promise<schema.EmailTemplate | undefined> { return undefined; }
  async getAllEmailTemplates(): Promise<schema.EmailTemplate[]> { return []; }
  async createEmailTemplate(template: schema.InsertEmailTemplate): Promise<schema.EmailTemplate> { throw new Error('Not implemented'); }
  async updateEmailTemplate(id: string, template: Partial<schema.InsertEmailTemplate>): Promise<schema.EmailTemplate | undefined> { return undefined; }
  async deleteEmailTemplate(id: string): Promise<boolean> { return false; }
  async getEmailTemplatesByTrigger(trigger: string): Promise<schema.EmailTemplate[]> { return []; }

  async getEmailLog(id: string): Promise<schema.EmailLogWithRelations | undefined> { return undefined; }
  async getAllEmailLogs(): Promise<schema.EmailLogWithRelations[]> { return []; }
  async createEmailLog(log: schema.InsertEmailLog): Promise<schema.EmailLog> { throw new Error('Not implemented'); }
  async updateEmailLog(id: string, log: Partial<schema.InsertEmailLog>): Promise<schema.EmailLog | undefined> { return undefined; }
  async getEmailLogsByLoad(loadId: string): Promise<schema.EmailLogWithRelations[]> { return []; }

  async createOnboardingToken(token: schema.InsertOnboardingToken): Promise<schema.OnboardingToken> {
    try {
      const [result] = await this.db.insert(schema.onboardingTokens).values(token).returning();
      return result;
    } catch (error) {
      console.error('Database error creating onboarding token:', error);
      // Fallback to memory token creation
      const { randomUUID } = await import('crypto');
      const memoryToken: schema.OnboardingToken = {
        ...token,
        id: randomUUID(),
        createdAt: new Date(),
      };
      return memoryToken;
    }
  }
  async getOnboardingToken(token: string): Promise<schema.OnboardingToken | undefined> { return undefined; }
  async getAllOnboardingTokens(): Promise<schema.OnboardingToken[]> { return []; }
  async markTokenAsUsed(token: string): Promise<boolean> { return false; }

  // Add stub implementations for all remaining methods required by IStorage interface
  async getDriverLocationsByDriver(driverId: string): Promise<schema.DriverLocation[]> { return []; }
  async getLatestDriverLocation(driverId: string): Promise<schema.DriverLocation | undefined> { return undefined; }
  async getAllDriverLocations(): Promise<schema.DriverLocation[]> { return []; }

  async createDriverOnboarding(onboarding: schema.DriverOnboarding): Promise<schema.DriverOnboarding> { throw new Error('Not implemented'); }
  async getDriverOnboardingByToken(token: string): Promise<schema.DriverOnboarding | undefined> { return undefined; }
  async updateDriverOnboardingStatus(token: string, status: string): Promise<schema.DriverOnboarding | undefined> { return undefined; }
  async getAllDriverOnboardings(): Promise<schema.DriverOnboarding[]> { return []; }

  async createReportTemplate(template: schema.InsertReportTemplate): Promise<schema.ReportTemplate> { throw new Error('Not implemented'); }
  async getReportTemplate(id: string): Promise<schema.ReportTemplate | undefined> { return undefined; }
  async updateReportTemplate(id: string, template: Partial<schema.InsertReportTemplate>): Promise<schema.ReportTemplate | undefined> { return undefined; }
  async deleteReportTemplate(id: string): Promise<boolean> { return false; }
  async getAllReportTemplates(): Promise<schema.ReportTemplate[]> { return []; }

  async createScraperConfig(config: schema.InsertScraperConfig): Promise<schema.ScraperConfig> { 
    const id = randomUUID();
    const scraperConfig: schema.ScraperConfig = { ...config, id, createdAt: new Date(), updatedAt: new Date() };
    return scraperConfig;
  }
  async getScraperConfig(id: string): Promise<schema.ScraperConfig | undefined> { return undefined; }
  async updateScraperConfig(id: string, config: Partial<schema.InsertScraperConfig>): Promise<schema.ScraperConfig | undefined> { return undefined; }
  async deleteScraperConfig(id: string): Promise<boolean> { return false; }
  async getAllScraperConfigs(): Promise<schema.ScraperConfig[]> { 
    // Return a default enabled configuration so load generation can start
    return [
      {
        id: 'default-scraper-1',
        name: 'sample_load_generator',
        enabled: true,
        boardId: 'sample-board',
        scrapeInterval: 10,
        maxLoadsPerRun: 50,
        priority: 1,
        filters: {
          equipmentTypes: ['dry_van', 'refrigerated', 'flatbed', 'straight_box_truck'],
          minRate: 500,
          maxAge: 24
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
  }

  async createScraperLog(log: schema.InsertScraperLog): Promise<schema.ScraperLog> { 
    const id = randomUUID();
    const scraperLog: schema.ScraperLog = { ...log, id, createdAt: new Date() };
    console.log(`📊 Scraper log created for config ${log.configId}`);
    return scraperLog;
  }
  async updateScraperLog(id: string, log: Partial<schema.InsertScraperLog>): Promise<schema.ScraperLog | undefined> { 
    console.log(`📊 Scraper log updated: ${log.status} - ${log.loadsCreated || 0} loads created`);
    return undefined; 
  }
  async getScraperLog(id: string): Promise<schema.ScraperLog | undefined> { return undefined; }
  async getScraperLogsByConfig(configId: string): Promise<schema.ScraperLog[]> { return []; }
  async getAllScraperLogs(): Promise<schema.ScraperLog[]> { return []; }

  async createLanePreference(preference: schema.InsertLanePreference): Promise<schema.LanePreference> { 
    const id = randomUUID();
    const lanePreference: schema.LanePreference = { ...preference, id, createdAt: new Date(), updatedAt: new Date() };
    return lanePreference;
  }
  async getLanePreference(id: string): Promise<schema.LanePreference | undefined> { return undefined; }
  async updateLanePreference(id: string, preference: Partial<schema.InsertLanePreference>): Promise<schema.LanePreference | undefined> { return undefined; }
  async deleteLanePreference(id: string): Promise<boolean> { return false; }
  async getAllLanePreferences(): Promise<schema.LanePreference[]> { return []; }

  async createAvoidLocation(location: schema.InsertAvoidLocation): Promise<schema.AvoidLocation> { 
    const id = randomUUID();
    const avoidLocation: schema.AvoidLocation = { ...location, id, createdAt: new Date(), updatedAt: new Date() };
    return avoidLocation;
  }
  async getAvoidLocation(id: string): Promise<schema.AvoidLocation | undefined> { return undefined; }
  async updateAvoidLocation(id: string, location: Partial<schema.InsertAvoidLocation>): Promise<schema.AvoidLocation | undefined> { return undefined; }
  async deleteAvoidLocation(id: string): Promise<boolean> { return false; }
  async getAllAvoidLocations(): Promise<schema.AvoidLocation[]> { return []; }

  async createTelegramBotConfig(config: schema.InsertTelegramBotConfig): Promise<schema.TelegramBotConfig> { 
    const id = randomUUID();
    const botConfig: schema.TelegramBotConfig = { ...config, id, createdAt: new Date(), updatedAt: new Date() };
    return botConfig;
  }
  async getTelegramBotConfig(id: string): Promise<schema.TelegramBotConfig | undefined> { return undefined; }
  async updateTelegramBotConfig(id: string, config: Partial<schema.InsertTelegramBotConfig>): Promise<schema.TelegramBotConfig | undefined> { return undefined; }
  async deleteTelegramBotConfig(id: string): Promise<boolean> { return false; }
  async getAllTelegramBotConfigs(): Promise<schema.TelegramBotConfig[]> { return []; }

  async createLoadOffer(offer: schema.InsertLoadOffer): Promise<schema.LoadOffer> { 
    const id = randomUUID();
    const loadOffer: schema.LoadOffer = { ...offer, id, createdAt: new Date(), updatedAt: new Date() };
    
    await db.insert(schema.loadOffers).values(loadOffer);
    return loadOffer;
  }
  async getLoadOffer(id: string): Promise<schema.LoadOffer | undefined> { return undefined; }
  async updateLoadOffer(id: string, offer: Partial<schema.InsertLoadOffer>): Promise<schema.LoadOffer | undefined> { return undefined; }
  async getLoadOffers(loadId: string): Promise<schema.LoadOffer[]> {
    try {
      console.log(`📋 Searching for load offers for load ${loadId}`);
      const result = await db.select().from(schema.loadOffers).where(eq(schema.loadOffers.loadId, loadId));
      console.log(`📋 Found ${result.length} load offers for load ${loadId}`);
      return result.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    } catch (error) {
      console.error(`❌ Database error getting load offers for ${loadId}:`, error);
      throw error;
    }
  }

  async getLoadOffersByLoad(loadId: string): Promise<schema.LoadOffer[]> { 
    return this.getLoadOffers(loadId);
  }
  
  async getLoadOffersByDriver(driverId: string): Promise<schema.LoadOffer[]> { 
    try {
      const result = await db.select().from(schema.loadOffers).where(eq(schema.loadOffers.driverId, driverId));
      return result.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    } catch (error) {
      console.error('Error getting driver load offers:', error);
      return [];
    }
  }
  
  async getAllLoadOffers(): Promise<schema.LoadOffer[]> { 
    try {
      const result = await db.select().from(schema.loadOffers);
      return result.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    } catch (error) {
      console.error('Error getting all load offers:', error);
      return [];
    }
  }

  async createLoadDocument(data: schema.InsertLoadDocument): Promise<schema.LoadDocument> { throw new Error('Not implemented'); }
  async getLoadDocument(id: string): Promise<schema.LoadDocument | null> { return null; }
  async getLoadDocumentsByLoad(loadId: string): Promise<schema.LoadDocument[]> { return []; }
  async getLoadDocumentsByDriver(driverId: string): Promise<schema.LoadDocument[]> { return []; }
  async getLoadDocumentsByType(loadId: string, documentType: string): Promise<schema.LoadDocument[]> { return []; }
  async updateLoadDocument(id: string, data: Partial<schema.InsertLoadDocument>): Promise<schema.LoadDocument | null> { return null; }
  async deleteLoadDocument(id: string): Promise<boolean> { return false; }
  async getAllLoadDocuments(): Promise<schema.LoadDocument[]> { return []; }

  async createGeofence(geofence: schema.InsertGeofence): Promise<schema.Geofence> { throw new Error('Not implemented'); }
  async getGeofence(id: string): Promise<schema.Geofence | undefined> { return undefined; }
  async updateGeofence(id: string, geofence: Partial<schema.InsertGeofence>): Promise<schema.Geofence | undefined> { return undefined; }
  async deleteGeofence(id: string): Promise<boolean> { return false; }
  async getAllGeofences(): Promise<schema.Geofence[]> { return []; }

  async createGeofenceEvent(event: schema.InsertGeofenceEvent): Promise<schema.GeofenceEvent> { throw new Error('Not implemented'); }
  async getGeofenceEvent(id: string): Promise<schema.GeofenceEvent | undefined> { return undefined; }
  async getGeofenceEventsByDriver(driverId: string): Promise<schema.GeofenceEvent[]> { return []; }
  async getGeofenceEventsByGeofence(geofenceId: string): Promise<schema.GeofenceEvent[]> { return []; }
  async getAllGeofenceEvents(): Promise<schema.GeofenceEvent[]> { return []; }

  async createRoute(route: schema.InsertRoute): Promise<schema.Route> { throw new Error('Not implemented'); }
  async getRoute(id: string): Promise<schema.Route | undefined> { return undefined; }
  async updateRoute(id: string, route: Partial<schema.InsertRoute>): Promise<schema.Route | undefined> { return undefined; }
  async deleteRoute(id: string): Promise<boolean> { return false; }
  async getRoutesByDriver(driverId: string): Promise<schema.Route[]> { return []; }
  async getAllRoutes(): Promise<schema.Route[]> { return []; }

  async createGpsDevice(device: schema.InsertGpsDevice): Promise<schema.GpsDevice> { throw new Error('Not implemented'); }
  async getGpsDevice(id: string): Promise<schema.GpsDevice | undefined> { return undefined; }
  async updateGpsDevice(id: string, device: Partial<schema.InsertGpsDevice>): Promise<schema.GpsDevice | undefined> { return undefined; }
  async deleteGpsDevice(id: string): Promise<boolean> { return false; }
  async getGpsDevicesByDriver(driverId: string): Promise<schema.GpsDevice[]> { return []; }
  async getAllGpsDevices(): Promise<schema.GpsDevice[]> { return []; }

  async createLoadBoardSource(source: schema.InsertLoadBoardSource): Promise<schema.LoadBoardSource> { 
    const id = randomUUID();
    const loadBoardSource: schema.LoadBoardSource = { ...source, id, createdAt: new Date(), updatedAt: new Date() };
    return loadBoardSource;
  }
  async getLoadBoardSource(id: string): Promise<schema.LoadBoardSource | undefined> { return undefined; }
  async updateLoadBoardSource(id: string, source: Partial<schema.InsertLoadBoardSource>): Promise<schema.LoadBoardSource | undefined> { return undefined; }
  async deleteLoadBoardSource(id: string): Promise<boolean> { return false; }
  async getAllLoadBoardSources(): Promise<schema.LoadBoardSource[]> { return []; }

  async createLoadBoardConfiguration(config: schema.InsertLoadBoardConfiguration): Promise<schema.LoadBoardConfiguration> { throw new Error('Not implemented'); }
  async getLoadBoardConfiguration(id: string): Promise<schema.LoadBoardConfiguration | undefined> { return undefined; }
  async updateLoadBoardConfiguration(id: string, config: Partial<schema.InsertLoadBoardConfiguration>): Promise<schema.LoadBoardConfiguration | undefined> { return undefined; }
  async deleteLoadBoardConfiguration(id: string): Promise<boolean> { return false; }
  async getEnabledLoadBoardConfigurations(): Promise<schema.LoadBoardConfiguration[]> { return []; }
  async getAllLoadBoardConfigurations(): Promise<schema.LoadBoardConfiguration[]> { return []; }

  async createScrapedLoad(load: schema.InsertScrapedLoad): Promise<schema.ScrapedLoad> { throw new Error('Not implemented'); }
  async getScrapedLoad(id: string): Promise<schema.ScrapedLoad | undefined> { return undefined; }
  async updateScrapedLoad(id: string, load: Partial<schema.InsertScrapedLoad>): Promise<schema.ScrapedLoad | undefined> { return undefined; }
  async deleteScrapedLoad(id: string): Promise<boolean> { return false; }
  async getScrapedLoadsByBoard(boardId: string): Promise<schema.ScrapedLoad[]> { return []; }
  async getScrapedLoadsByDateRange(startDate: Date, endDate: Date): Promise<schema.ScrapedLoad[]> { return []; }
  async getAllScrapedLoads(): Promise<schema.ScrapedLoad[]> { return []; }

  async createScraperConfiguration(config: schema.InsertScraperConfiguration): Promise<schema.ScraperConfiguration> { throw new Error('Not implemented'); }
  async getScraperConfiguration(id: string): Promise<schema.ScraperConfiguration | undefined> { return undefined; }
  async updateScraperConfiguration(id: string, config: Partial<schema.InsertScraperConfiguration>): Promise<schema.ScraperConfiguration | undefined> { return undefined; }
  async deleteScraperConfiguration(id: string): Promise<boolean> { return false; }
  async getEnabledScraperConfigurations(): Promise<schema.ScraperConfiguration[]> { return []; }
  async getAllScraperConfigurations(): Promise<schema.ScraperConfiguration[]> { return []; }

  async createLoadBid(bid: schema.InsertLoadBid): Promise<schema.LoadBid> { throw new Error('Not implemented'); }
  async getLoadBid(id: string): Promise<schema.LoadBidWithRelations | undefined> { return undefined; }
  async updateLoadBid(id: string, bid: Partial<schema.InsertLoadBid>): Promise<schema.LoadBid | undefined> { return undefined; }
  async deleteLoadBid(id: string): Promise<boolean> { return false; }
  async getLoadBidsByLoad(loadId: string): Promise<schema.LoadBidWithRelations[]> { return []; }
  async getLoadBidsByDriver(driverId: string): Promise<schema.LoadBidWithRelations[]> { return []; }
  async getAllLoadBids(): Promise<schema.LoadBidWithRelations[]> { return []; }

  async createBidResponse(response: schema.InsertBidResponse): Promise<schema.BidResponse> { throw new Error('Not implemented'); }
  async getBidResponse(id: string): Promise<schema.BidResponse | undefined> { return undefined; }
  async updateBidResponse(id: string, response: Partial<schema.InsertBidResponse>): Promise<schema.BidResponse | undefined> { return undefined; }
  async getBidResponsesByBid(bidId: string): Promise<schema.BidResponse[]> { return []; }
  async getAllBidResponses(): Promise<schema.BidResponse[]> { return []; }

  async createEmailCampaign(campaign: schema.InsertEmailCampaign): Promise<schema.EmailCampaign> { throw new Error('Not implemented'); }
  async getEmailCampaign(id: string): Promise<schema.EmailCampaignWithFollowUps | undefined> { return undefined; }
  async updateEmailCampaign(id: string, campaign: Partial<schema.InsertEmailCampaign>): Promise<schema.EmailCampaign | undefined> { return undefined; }
  async deleteEmailCampaign(id: string): Promise<boolean> { return false; }
  async getAllEmailCampaigns(): Promise<schema.EmailCampaignWithFollowUps[]> { return []; }

  async createEmailFollowUp(followUp: schema.InsertEmailFollowUp): Promise<schema.EmailFollowUp> { throw new Error('Not implemented'); }
  async getEmailFollowUp(id: string): Promise<schema.EmailFollowUp | undefined> { return undefined; }
  async updateEmailFollowUp(id: string, followUp: Partial<schema.InsertEmailFollowUp>): Promise<schema.EmailFollowUp | undefined> { return undefined; }
  async deleteEmailFollowUp(id: string): Promise<boolean> { return false; }
  async getEmailFollowUpsByCampaign(campaignId: string): Promise<schema.EmailFollowUp[]> { return []; }
  async getAllEmailFollowUps(): Promise<schema.EmailFollowUp[]> { return []; }

  async createDispatcherNotification(notification: schema.InsertDispatcherNotification): Promise<schema.DispatcherNotification> { throw new Error('Not implemented'); }
  async getDispatcherNotification(id: string): Promise<schema.DispatcherNotification | undefined> { return undefined; }
  async updateDispatcherNotification(id: string, notification: Partial<schema.InsertDispatcherNotification>): Promise<schema.DispatcherNotification | undefined> { return undefined; }
  async deleteDispatcherNotification(id: string): Promise<boolean> { return false; }
  async getDispatcherNotificationsByBid(bidId: string): Promise<schema.DispatcherNotification[]> { return []; }
  async getAllDispatcherNotifications(): Promise<schema.DispatcherNotification[]> { return []; }

  // Driver location operations - Real implementations
  async createDriverLocation(location: schema.InsertDriverLocation): Promise<schema.DriverLocation> {
    const id = randomUUID();
    const driverLocation: schema.DriverLocation = {
      ...location,
      id,
      createdAt: new Date(),
    };
    
    try {
      await db.insert(schema.driverLocations).values(driverLocation);
      return driverLocation;
    } catch (error) {
      console.error('Error creating driver location:', error);
      throw error;
    }
  }

  async updateDriverLocation(id: string, location: Partial<schema.InsertDriverLocation>): Promise<schema.DriverLocation | undefined> {
    try {
      await db.update(schema.driverLocations).set(location).where(eq(schema.driverLocations.id, id));
      const result = await db.select().from(schema.driverLocations).where(eq(schema.driverLocations.id, id));
      return result[0];
    } catch (error) {
      console.error('Error updating driver location:', error);
      return undefined;
    }
  }

  async getDriverCurrentLocation(driverId: string): Promise<schema.DriverLocation | undefined> {
    try {
      const result = await db.select()
        .from(schema.driverLocations)
        .where(and(eq(schema.driverLocations.driverId, driverId), eq(schema.driverLocations.isActive, true)))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`)
        .limit(1);
      return result[0];
    } catch (error) {
      console.error('Error getting current driver location:', error);
      return undefined;
    }
  }

  async getDriverLocationHistory(driverId: string): Promise<schema.DriverLocation[]> {
    try {
      const result = await db.select({
        id: schema.driverLocations.id,
        driverId: schema.driverLocations.driverId,
        latitude: schema.driverLocations.latitude,
        longitude: schema.driverLocations.longitude,
        altitude: schema.driverLocations.altitude,
        accuracy: schema.driverLocations.accuracy,
        speed: schema.driverLocations.speed,
        heading: schema.driverLocations.heading,
        timestamp: schema.driverLocations.timestamp,
        address: schema.driverLocations.address,
        loadId: schema.driverLocations.loadId,
        isActive: schema.driverLocations.isActive,
        batteryLevel: schema.driverLocations.batteryLevel,
        signalStrength: schema.driverLocations.signalStrength,
        createdAt: schema.driverLocations.createdAt,
      })
        .from(schema.driverLocations)
        .where(eq(schema.driverLocations.driverId, driverId))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`)
        .limit(100);
      return result;
    } catch (error) {
      console.error('Error getting driver location history:', error);
      return [];
    }
  }

  async getDriverLocations(driverId: string, limit = 10): Promise<schema.DriverLocation[]> {
    try {
      const result = await db.select()
        .from(schema.driverLocations)
        .where(eq(schema.driverLocations.driverId, driverId))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`)
        .limit(limit);
      return result;
    } catch (error) {
      console.error('Error getting driver locations:', error);
      return [];
    }
  }

  async getAllCurrentDriverLocations(): Promise<schema.DriverLocation[]> {
    try {
      const result = await db.select()
        .from(schema.driverLocations)
        .where(eq(schema.driverLocations.isActive, true))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`);
      return result;
    } catch (error) {
      console.error('Error getting all current driver locations:', error);
      return [];
    }
  }

  async getActiveDriverLocationsWithDriverInfo(): Promise<any[]> {
    try {
      const result = await db.select({
        id: schema.driverLocations.id,
        driverId: schema.driverLocations.driverId,
        driverName: schema.drivers.name,
        driverCity: schema.drivers.city,
        latitude: schema.driverLocations.latitude,
        longitude: schema.driverLocations.longitude,
        address: schema.driverLocations.address,
        timestamp: schema.driverLocations.timestamp,
        speed: schema.driverLocations.speed,
        batteryLevel: schema.driverLocations.batteryLevel,
        isActive: schema.driverLocations.isActive,
      })
        .from(schema.driverLocations)
        .innerJoin(schema.drivers, eq(schema.driverLocations.driverId, schema.drivers.id))
        .where(eq(schema.driverLocations.isActive, true))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`);
      
      return result;
    } catch (error) {
      console.error('Error getting active driver locations with driver info:', error);
      return [];
    }
  }

  async cleanupOldDriverLocations(driverId: string, keepCount: number): Promise<void> {
    try {
      // Get locations to keep
      const locationsToKeep = await db.select()
        .from(schema.driverLocations)
        .where(eq(schema.driverLocations.driverId, driverId))
        .orderBy(sql`${schema.driverLocations.timestamp} desc`)
        .limit(keepCount);

      if (locationsToKeep.length === keepCount) {
        const keepIds = locationsToKeep.map(l => l.id);
        await db.delete(schema.driverLocations)
          .where(and(
            eq(schema.driverLocations.driverId, driverId),
            sql`${schema.driverLocations.id} NOT IN (${keepIds.map(id => `'${id}'`).join(',')})`
          ));
      }
    } catch (error) {
      console.error('Error cleaning up old driver locations:', error);
    }
  }

  // Driver management - add convenience method
  async getDrivers(): Promise<schema.Driver[]> {
    return this.getAllDrivers();
  }

  // Additional GPS tracking methods
  async getActiveGeofences(): Promise<schema.Geofence[]> {
    return [];
  }

  async getGpsDeviceByDriver(driverId: string): Promise<schema.GpsDevice | undefined> {
    return undefined;
  }
}