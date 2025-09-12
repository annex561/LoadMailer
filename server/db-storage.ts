import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, and, or, desc, sql as drizzleSql, notInArray } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { IStorage } from './storage';
import { randomUUID } from 'crypto';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

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

  async getDriverByTelegramId(telegramId: string): Promise<schema.Driver | undefined> {
    const result = await db.select().from(schema.drivers).where(eq(schema.drivers.telegramId, telegramId));
    return result[0];
  }

  async getDriversWithTelegramEnabled(): Promise<schema.Driver[]> {
    const result = await db.select().from(schema.drivers).where(
      and(
        eq(schema.drivers.enableTelegramNotifications, true),
        // telegramId is not null - check if it exists and is not empty
        sql`${schema.drivers.telegramId} IS NOT NULL AND ${schema.drivers.telegramId} != ''`
      )
    );
    return result;
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
        limit: 100, // Limit to prevent response too large error
        orderBy: [schema.loads.createdAt]
      });
    } catch (error) {
      console.error('Database relation error, falling back to simple query:', error);
      // Fallback to simple query without relations, limited to recent loads
      const loads = await db.select().from(schema.loads)
        .orderBy(schema.loads.createdAt)
        .limit(100);
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
      }).from(schema.driverLocations).where(eq(schema.driverLocations.id, id));
      return result[0];
    } catch (error) {
      console.error('Error updating driver location:', error);
      return undefined;
    }
  }

  async getDriverCurrentLocation(driverId: string): Promise<schema.DriverLocation | undefined> {
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
        .where(and(eq(schema.driverLocations.driverId, driverId), eq(schema.driverLocations.isActive, true)))
        .orderBy(desc(schema.driverLocations.timestamp))
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
        .orderBy(desc(schema.driverLocations.timestamp))
        .limit(100);
      return result;
    } catch (error) {
      console.error('Error getting driver location history:', error);
      return [];
    }
  }

  async getDriverLocations(driverId: string, limit = 10): Promise<schema.DriverLocation[]> {
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
        .orderBy(desc(schema.driverLocations.timestamp))
        .limit(limit);
      return result;
    } catch (error) {
      console.error('Error getting driver locations:', error);
      return [];
    }
  }

  async getAllCurrentDriverLocations(): Promise<schema.DriverLocation[]> {
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
        .where(eq(schema.driverLocations.isActive, true))
        .orderBy(desc(schema.driverLocations.timestamp));
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
        .orderBy(desc(schema.driverLocations.timestamp));
      
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
        .orderBy(desc(schema.driverLocations.timestamp))
        .limit(keepCount);

      if (locationsToKeep.length === keepCount) {
        const keepIds = locationsToKeep.map(l => l.id);
        await db.delete(schema.driverLocations)
          .where(and(
            eq(schema.driverLocations.driverId, driverId),
            notInArray(schema.driverLocations.id, keepIds)
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

  // Load Offer operations - CRITICAL for button functionality
  async getLoadOffer(id: string): Promise<schema.LoadOffer | undefined> {
    const result = await db.select().from(schema.loadOffers).where(eq(schema.loadOffers.id, id));
    return result[0];
  }

  async getAllLoadOffers(): Promise<schema.LoadOffer[]> {
    return await db.select().from(schema.loadOffers);
  }

  async getLoadOffers(loadId: string): Promise<schema.LoadOffer[]> {
    return await db.select().from(schema.loadOffers).where(eq(schema.loadOffers.loadId, loadId));
  }

  async createLoadOffer(offer: schema.InsertLoadOffer): Promise<schema.LoadOffer> {
    const id = randomUUID();
    const loadOffer: schema.LoadOffer = {
      ...offer,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.loadOffers).values(loadOffer);
    return loadOffer;
  }

  async updateLoadOffer(id: string, offer: Partial<schema.InsertLoadOffer>): Promise<schema.LoadOffer | undefined> {
    await db.update(schema.loadOffers).set({ ...offer, updatedAt: new Date() }).where(eq(schema.loadOffers.id, id));
    return this.getLoadOffer(id);
  }

  async getLoadOfferByLoadAndDriver(loadId: string, driverId: string): Promise<schema.LoadOffer | undefined> {
    const result = await db.select().from(schema.loadOffers).where(
      and(
        eq(schema.loadOffers.loadId, loadId),
        eq(schema.loadOffers.driverId, driverId)
      )
    );
    return result[0];
  }

  async updateLoadOfferByLoadAndDriver(loadId: string, driverId: string, offer: Partial<schema.InsertLoadOffer>): Promise<schema.LoadOffer | undefined> {
    const existing = await this.getLoadOfferByLoadAndDriver(loadId, driverId);
    if (!existing) return undefined;

    await db.update(schema.loadOffers).set({ ...offer, updatedAt: new Date() }).where(eq(schema.loadOffers.id, existing.id));
    return this.getLoadOffer(existing.id);
  }

  // Load offer statistics methods
  async getLoadOffersByDriver(driverId: string): Promise<schema.LoadOffer[]> {
    return await db.select().from(schema.loadOffers).where(eq(schema.loadOffers.driverId, driverId));
  }

  async getLoadOffersWithDetails(): Promise<(schema.LoadOffer & { load: schema.LoadWithRelations; driver: schema.Driver })[]> {
    // Return empty array for now - complex join query would need proper implementation
    return [];
  }

  async getDriverLoadOfferStats(driverId: string): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}> {
    const offers = await this.getLoadOffersByDriver(driverId);
    const driver = await this.getDriver(driverId);
    
    return {
      driverId,
      driverName: driver?.name || 'Unknown',
      totalOffers: offers.length,
      accepted: offers.filter(o => o.status === 'accepted').length,
      declined: offers.filter(o => o.status === 'declined').length,
      timeout: offers.filter(o => o.status === 'timeout').length,
      pending: offers.filter(o => o.status === 'pending').length,
    };
  }

  async getAllDriverLoadOfferStats(): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}[]> {
    const drivers = await this.getAllDrivers();
    const stats = [];
    
    for (const driver of drivers) {
      const driverStats = await this.getDriverLoadOfferStats(driver.id);
      stats.push(driverStats);
    }
    
    return stats;
  }

  // Route operations - Fix GPS tracking error
  async getRoute(id: string): Promise<schema.Route | undefined> {
    return undefined;
  }

  async getAllRoutes(): Promise<schema.Route[]> {
    return [];
  }

  async getActiveRoutes(): Promise<schema.Route[]> {
    return [];
  }

  async createRoute(route: schema.InsertRoute): Promise<schema.Route> {
    const id = randomUUID();
    const newRoute: schema.Route = {
      ...route,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return newRoute;
  }

  async updateRoute(id: string, route: Partial<schema.InsertRoute>): Promise<schema.Route | undefined> {
    return undefined;
  }

  async getActiveRouteForDriver(driverId: string): Promise<schema.Route | undefined> {
    return undefined;
  }

  async deleteRoute(id: string): Promise<boolean> {
    return false;
  }

  // Available drivers method
  async getAvailableDrivers(): Promise<schema.Driver[]> {
    return await db.select().from(schema.drivers).where(eq(schema.drivers.status, 'available'));
  }

  // Load Communication Thread operations
  async getLoadCommunicationThread(id: string): Promise<schema.LoadCommunicationThread | undefined> {
    const result = await db.select().from(schema.loadCommunicationThreads).where(eq(schema.loadCommunicationThreads.id, id));
    return result[0];
  }

  async getLoadCommunicationThreadByLoad(loadId: string): Promise<schema.LoadCommunicationThread | undefined> {
    const result = await db.select().from(schema.loadCommunicationThreads).where(eq(schema.loadCommunicationThreads.loadId, loadId));
    return result[0];
  }

  async getAllLoadCommunicationThreads(): Promise<schema.LoadCommunicationThread[]> {
    return await db.select().from(schema.loadCommunicationThreads).orderBy(desc(schema.loadCommunicationThreads.lastMessageAt));
  }

  async createLoadCommunicationThread(insertThread: schema.InsertLoadCommunicationThread): Promise<schema.LoadCommunicationThread> {
    const id = randomUUID();
    const thread: schema.LoadCommunicationThread = {
      ...insertThread,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await db.insert(schema.loadCommunicationThreads).values(thread);
    return thread;
  }

  async updateLoadCommunicationThread(id: string, updateData: Partial<schema.InsertLoadCommunicationThread>): Promise<schema.LoadCommunicationThread | undefined> {
    await db.update(schema.loadCommunicationThreads).set({ ...updateData, updatedAt: new Date() }).where(eq(schema.loadCommunicationThreads.id, id));
    return this.getLoadCommunicationThread(id);
  }

  async deleteLoadCommunicationThread(id: string): Promise<boolean> {
    const result = await db.delete(schema.loadCommunicationThreads).where(eq(schema.loadCommunicationThreads.id, id));
    return result.rowCount > 0;
  }

  // Load Message operations
  async getLoadMessage(id: string): Promise<schema.LoadMessage | undefined> {
    const result = await db.select().from(schema.loadMessages).where(eq(schema.loadMessages.id, id));
    return result[0];
  }

  async getLoadMessagesByThread(threadId: string): Promise<schema.LoadMessage[]> {
    return await db.select().from(schema.loadMessages)
      .where(eq(schema.loadMessages.threadId, threadId))
      .orderBy(schema.loadMessages.createdAt);
  }

  async getLoadMessagesByLoad(loadId: string): Promise<schema.LoadMessage[]> {
    return await db.select().from(schema.loadMessages)
      .where(eq(schema.loadMessages.loadId, loadId))
      .orderBy(schema.loadMessages.createdAt);
  }

  async createLoadMessage(insertMessage: schema.InsertLoadMessage): Promise<schema.LoadMessage> {
    const id = randomUUID();
    const message: schema.LoadMessage = {
      ...insertMessage,
      id,
      createdAt: new Date(),
    };
    
    await db.insert(schema.loadMessages).values(message);
    return message;
  }

  async updateLoadMessage(id: string, updateData: Partial<schema.InsertLoadMessage>): Promise<schema.LoadMessage | undefined> {
    await db.update(schema.loadMessages).set(updateData).where(eq(schema.loadMessages.id, id));
    return this.getLoadMessage(id);
  }

  async markMessageAsRead(messageId: string): Promise<boolean> {
    const result = await db.update(schema.loadMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(schema.loadMessages.id, messageId));
    return result.rowCount > 0;
  }

  async getUnreadMessagesForDriver(driverId: string): Promise<schema.LoadMessage[]> {
    const threadQuery = db.select({ id: schema.loadCommunicationThreads.id })
      .from(schema.loadCommunicationThreads)
      .where(eq(schema.loadCommunicationThreads.driverId, driverId));
    
    return await db.select().from(schema.loadMessages)
      .where(and(
        eq(schema.loadMessages.senderRole, 'dispatch'),
        eq(schema.loadMessages.isRead, false),
        drizzleSql`${schema.loadMessages.threadId} IN (${threadQuery})`
      ))
      .orderBy(desc(schema.loadMessages.createdAt));
  }

  async getUnreadMessagesForDispatch(): Promise<schema.LoadMessage[]> {
    return await db.select().from(schema.loadMessages)
      .where(and(
        eq(schema.loadMessages.senderRole, 'driver'),
        eq(schema.loadMessages.isRead, false)
      ))
      .orderBy(desc(schema.loadMessages.createdAt));
  }

  // Message Attachment operations
  async getMessageAttachment(id: string): Promise<schema.MessageAttachment | undefined> {
    const result = await db.select().from(schema.messageAttachments).where(eq(schema.messageAttachments.id, id));
    return result[0];
  }

  async getMessageAttachmentsByMessage(messageId: string): Promise<schema.MessageAttachment[]> {
    return await db.select().from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.messageId, messageId))
      .orderBy(schema.messageAttachments.createdAt);
  }

  async getMessageAttachmentsByLoad(loadId: string): Promise<schema.MessageAttachment[]> {
    return await db.select().from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.loadId, loadId))
      .orderBy(desc(schema.messageAttachments.createdAt));
  }

  async createMessageAttachment(insertAttachment: schema.InsertMessageAttachment): Promise<schema.MessageAttachment> {
    const id = randomUUID();
    const attachment: schema.MessageAttachment = {
      ...insertAttachment,
      id,
      createdAt: new Date(),
    };
    
    await db.insert(schema.messageAttachments).values(attachment);
    return attachment;
  }

  async updateMessageAttachment(id: string, updateData: Partial<schema.InsertMessageAttachment>): Promise<schema.MessageAttachment | undefined> {
    await db.update(schema.messageAttachments).set(updateData).where(eq(schema.messageAttachments.id, id));
    return this.getMessageAttachment(id);
  }

  async deleteMessageAttachment(id: string): Promise<boolean> {
    const result = await db.delete(schema.messageAttachments).where(eq(schema.messageAttachments.id, id));
    return result.rowCount > 0;
  }

  // Quick Reply Template operations
  async getQuickReplyTemplate(id: string): Promise<schema.QuickReplyTemplate | undefined> {
    const result = await db.select().from(schema.quickReplyTemplates).where(eq(schema.quickReplyTemplates.id, id));
    return result[0];
  }

  async getAllQuickReplyTemplates(): Promise<schema.QuickReplyTemplate[]> {
    return await db.select().from(schema.quickReplyTemplates).orderBy(schema.quickReplyTemplates.order);
  }

  async getActiveQuickReplyTemplates(): Promise<schema.QuickReplyTemplate[]> {
    return await db.select().from(schema.quickReplyTemplates)
      .where(eq(schema.quickReplyTemplates.isActive, true))
      .orderBy(schema.quickReplyTemplates.order);
  }

  async getQuickReplyTemplatesForDriver(): Promise<schema.QuickReplyTemplate[]> {
    return await db.select().from(schema.quickReplyTemplates)
      .where(and(
        eq(schema.quickReplyTemplates.isActive, true),
        eq(schema.quickReplyTemplates.isForDriver, true)
      ))
      .orderBy(schema.quickReplyTemplates.order);
  }

  async getQuickReplyTemplatesForDispatch(): Promise<schema.QuickReplyTemplate[]> {
    return await db.select().from(schema.quickReplyTemplates)
      .where(and(
        eq(schema.quickReplyTemplates.isActive, true),
        eq(schema.quickReplyTemplates.isForDispatch, true)
      ))
      .orderBy(schema.quickReplyTemplates.order);
  }

  async createQuickReplyTemplate(insertTemplate: schema.InsertQuickReplyTemplate): Promise<schema.QuickReplyTemplate> {
    const id = randomUUID();
    const template: schema.QuickReplyTemplate = {
      ...insertTemplate,
      id,
      createdAt: new Date(),
    };
    
    await db.insert(schema.quickReplyTemplates).values(template);
    return template;
  }

  async updateQuickReplyTemplate(id: string, updateData: Partial<schema.InsertQuickReplyTemplate>): Promise<schema.QuickReplyTemplate | undefined> {
    await db.update(schema.quickReplyTemplates).set(updateData).where(eq(schema.quickReplyTemplates.id, id));
    return this.getQuickReplyTemplate(id);
  }

  async deleteQuickReplyTemplate(id: string): Promise<boolean> {
    const result = await db.delete(schema.quickReplyTemplates).where(eq(schema.quickReplyTemplates.id, id));
    return result.rowCount > 0;
  }

  // Communication Log operations
  async getCommunicationLog(id: string): Promise<schema.CommunicationLog | undefined> {
    const result = await db.select().from(schema.communicationLogs).where(eq(schema.communicationLogs.id, id));
    return result[0];
  }

  async getCommunicationLogsByLoad(loadId: string): Promise<schema.CommunicationLog[]> {
    return await db.select().from(schema.communicationLogs)
      .where(eq(schema.communicationLogs.loadId, loadId))
      .orderBy(desc(schema.communicationLogs.timestamp));
  }

  async getCommunicationLogsByThread(threadId: string): Promise<schema.CommunicationLog[]> {
    return await db.select().from(schema.communicationLogs)
      .where(eq(schema.communicationLogs.threadId, threadId))
      .orderBy(desc(schema.communicationLogs.timestamp));
  }

  async createCommunicationLog(insertLog: schema.InsertCommunicationLog): Promise<schema.CommunicationLog> {
    const id = randomUUID();
    const log: schema.CommunicationLog = {
      ...insertLog,
      id,
      createdAt: new Date(),
    };
    
    await db.insert(schema.communicationLogs).values(log);
    return log;
  }

  // AI Assistant Communication operations
  async getSuggestedMessages(threadId: string): Promise<schema.LoadMessage[]> {
    return await db.select()
      .from(schema.loadMessages)
      .where(and(
        eq(schema.loadMessages.threadId, threadId),
        eq(schema.loadMessages.isSuggested, true),
        eq(schema.loadMessages.isSent, false)
      ))
      .orderBy(desc(schema.loadMessages.createdAt));
  }

  async approveSuggestedMessage(messageId: string, approverId: string): Promise<schema.LoadMessage | undefined> {
    await db.update(schema.loadMessages)
      .set({
        approvedBy: approverId,
        approvedAt: new Date(),
        isSent: true,
      })
      .where(eq(schema.loadMessages.id, messageId));
    
    const result = await db.select().from(schema.loadMessages).where(eq(schema.loadMessages.id, messageId));
    return result[0];
  }

  async rejectSuggestedMessage(messageId: string): Promise<boolean> {
    const result = await db.delete(schema.loadMessages)
      .where(eq(schema.loadMessages.id, messageId));
    return result.rowCount > 0;
  }

  async updateThreadAiConfig(threadId: string, config: {
    assistantEnabled?: boolean;
    assistantMode?: 'suggest' | 'autosend' | 'off';
    autoSendConfidence?: number;
    systemPrompt?: string;
  }): Promise<schema.LoadCommunicationThread | undefined> {
    await db.update(schema.loadCommunicationThreads)
      .set({
        ...config,
        updatedAt: new Date(),
      })
      .where(eq(schema.loadCommunicationThreads.id, threadId));
    
    const result = await db.select().from(schema.loadCommunicationThreads)
      .where(eq(schema.loadCommunicationThreads.id, threadId));
    return result[0];
  }

  async getMessagesForContext(threadId: string, limit: number = 20): Promise<schema.LoadMessage[]> {
    const messages = await db.select()
      .from(schema.loadMessages)
      .where(eq(schema.loadMessages.threadId, threadId))
      .orderBy(desc(schema.loadMessages.createdAt))
      .limit(limit);
    
    return messages.reverse(); // Return in chronological order
  }
}