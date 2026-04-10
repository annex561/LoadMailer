import { eq, and, or, desc, sql as drizzleSql, notInArray, inArray } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { IStorage } from './storage';
import { randomUUID, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { db } from './db';

function generateSecureTrackingToken(): string {
  return randomBytes(32).toString('hex');
}

export class DatabaseStorage implements IStorage {
  // Driver operations
  async getDriver(id: string): Promise<schema.Driver | undefined> {
    const result = await db.select().from(schema.drivers).where(eq(schema.drivers.id, id));
    return result[0];
  }

  async getAllDrivers(): Promise<schema.Driver[]> {
    return await db.select().from(schema.drivers);
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

  async getDriverByNameOrPhone(nameOrPhone: string): Promise<schema.Driver | undefined> {
    // First try to find by exact name match
    const byName = await db.select().from(schema.drivers)
      .where(eq(schema.drivers.name, nameOrPhone))
      .limit(1);
    
    if (byName.length > 0) return byName[0];
    
    // Then try to find by phone number (clean both for comparison)
    const cleanedSearch = nameOrPhone.replace(/[^0-9]/g, '');
    if (cleanedSearch.length >= 10) {
      // Use PostgreSQL's REPLACE to clean phone numbers in the database
      const byPhone = await db.select().from(schema.drivers)
        .where(drizzleSql`REPLACE(REPLACE(REPLACE(REPLACE(${schema.drivers.phone}, '-', ''), ' ', ''), '(', ''), ')', '') = ${cleanedSearch}`)
        .limit(1);
      
      if (byPhone.length > 0) return byPhone[0];
    }
    
    // Finally try partial name match (case insensitive)
    const byPartialName = await db.select().from(schema.drivers)
      .where(drizzleSql`LOWER(${schema.drivers.name}) LIKE LOWER(${`%${nameOrPhone}%`})`)
      .limit(1);
    
    return byPartialName[0];
  }

  async updateDriverMood(driverId: string, mood: string, note?: string): Promise<schema.Driver | undefined> {
    await db.update(schema.drivers).set({ 
      currentMood: mood, 
      moodNote: note || null,
      moodUpdatedAt: new Date() 
    }).where(eq(schema.drivers.id, driverId));
    return this.getDriver(driverId);
  }

  async generateTrackingToken(driverId: string): Promise<{ token: string } | undefined> {
    const token = generateSecureTrackingToken();
    await db.update(schema.drivers).set({ trackingToken: token }).where(eq(schema.drivers.id, driverId));
    console.log(`🔐 Generated tracking token for driver ${driverId}`);
    return { token };
  }

  async validateTrackingToken(driverId: string, token: string): Promise<boolean> {
    const driver = await this.getDriver(driverId);
    if (!driver) {
      console.log(`⚠️ SECURITY: Token validation failed - driver ${driverId} not found`);
      return false;
    }
    if (!driver.trackingToken) {
      console.log(`⚠️ SECURITY: Token validation failed - driver ${driverId} has no tracking token`);
      return false;
    }
    const isValid = driver.trackingToken === token;
    if (!isValid) {
      console.log(`🚨 SECURITY: Token validation failed - invalid token for driver ${driverId}`);
    }
    return isValid;
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

  // Company operations (multi-tenant subscription system)
  async getCompany(id: string): Promise<any | undefined> {
    const result = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    return result[0];
  }

  async getAllCompanies(): Promise<any[]> {
    return await db.select().from(schema.companies);
  }

  async updateCompany(id: string, updateData: any): Promise<any | undefined> {
    await db.update(schema.companies).set(updateData).where(eq(schema.companies.id, id));
    return this.getCompany(id);
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
    try {
      return await db.query.loads.findMany({
        with: {
          driver: true,
          customer: true,
        },
        limit: 100, // Limit to prevent response too large error
        orderBy: (loads, { desc }) => [desc(loads.createdAt)]
      });
    } catch (error) {
      console.error('Database relation error, falling back to simple query:', error);
      // Fallback to simple query without relations, limited to recent loads
      const loads = await db.select().from(schema.loads)
        .orderBy(desc(schema.loads.createdAt))
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

  async getActiveLoadsForDispatch(): Promise<{ id: string; driverId: string | null; loadNumber: string; status: string }[]> {
    const result = await db
      .select({
        id: schema.loads.id,
        driverId: schema.loads.driverId,
        loadNumber: schema.loads.loadNumber,
        status: schema.loads.status,
      })
      .from(schema.loads)
      .where(inArray(schema.loads.status, ['assigned', 'in_transit', 'at_pickup', 'at_delivery']));
    return result;
  }

  async createLoad(insertLoad: schema.InsertLoad): Promise<schema.LoadWithRelations> {
    try {
      const id = randomUUID();
      // Generate collision-proof load number with nanoid suffix
      const loadNumber = `LOAD-${Date.now().toString().slice(-6)}-${nanoid(6)}`;
      
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
      
      const dbLoad: schema.Load = {
        ...insertLoad,
        id,
        loadNumber,
        pickupDate,
        deliveryDate,
        description: insertLoad.description || 'General Freight',
        status: insertLoad.status || 'scheduled',
        priority: insertLoad.priority || 'standard',
        equipmentType: insertLoad.equipmentType || 'dry_van',
        temperatureRequired: insertLoad.temperatureRequired || false,
        isExpired: insertLoad.isExpired || false,
        sourceBoard: insertLoad.sourceBoard || 'manual',
        weight: insertLoad.weight || 25000,
        pickupTime: insertLoad.pickupTime || '08:00',
        deliveryTime: insertLoad.deliveryTime || '17:00',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Insert directly into database - NO fallback to memory
      await db.insert(schema.loads).values(dbLoad);
      console.log(`✅ Load ${loadNumber} created successfully in database - ${dbLoad.description}`);
      
      // Return load with relations
      const load = await this.getLoad(id);
      if (!load) {
        throw new Error('Failed to retrieve created load from database');
      }
      
      return load;
      
    } catch (error) {
      console.error('❌ Failed to create load:', error);
      throw error; // Propagate error instead of silently falling back
    }
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

  async getLoadsByDriver(driverId: string): Promise<schema.LoadWithRelations[]> {
    // Properly use parameterized query to prevent SQL injection
    try {
      // Use Drizzle query builder for safety
      const result = await db.query.loads.findMany({
        where: and(
          eq(schema.loads.driverId, driverId),
          or(
            eq(schema.loads.status, 'available'),
            eq(schema.loads.status, 'assigned'),
            eq(schema.loads.status, 'in_transit'),
            eq(schema.loads.status, 'picked_up')
          )
        ),
        with: {
          driver: true,
          customer: true,
        },
        orderBy: [desc(schema.loads.createdAt)],
      });
      return result;
    } catch (error) {
      console.error('Error in getLoadsByDriver:', error);
      return [];
    }
  }

  async getLoadByNumber(loadNumber: string): Promise<schema.LoadWithRelations | undefined> {
    try {
      const result = await db.query.loads.findFirst({
        where: eq(schema.loads.loadNumber, loadNumber),
        with: {
          driver: true,
          customer: true,
        },
      });
      return result;
    } catch (error) {
      console.error(`Error getting load by number ${loadNumber}:`, error);
      return undefined;
    }
  }

  async getMostRecentLoadForDriver(driverId: string): Promise<schema.LoadWithRelations | undefined> {
    try {
      const result = await db.query.loads.findFirst({
        where: and(
          eq(schema.loads.driverId, driverId),
          or(
            eq(schema.loads.status, 'assigned'),
            eq(schema.loads.status, 'in_transit'),
            eq(schema.loads.status, 'picked_up')
          )
        ),
        with: {
          driver: true,
          customer: true,
        },
        orderBy: [desc(schema.loads.createdAt)],
      });
      return result;
    } catch (error) {
      console.error(`Error getting most recent load for driver ${driverId}:`, error);
      return undefined;
    }
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
  async createEmailLog(log: schema.InsertEmailLog): Promise<schema.EmailLog> {
    try {
      const [result] = await db.insert(schema.emailLogs).values(log).returning();
      return result;
    } catch (error) {
      console.error('Database error creating email log:', error);
      // Return a minimal email log on error
      const { randomUUID } = await import('crypto');
      return {
        ...log,
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as schema.EmailLog;
    }
  }
  async updateEmailLog(id: string, log: Partial<schema.InsertEmailLog>): Promise<schema.EmailLog | undefined> { return undefined; }
  async getEmailLogsByLoad(loadId: string): Promise<schema.EmailLogWithRelations[]> { return []; }

  async createOnboardingToken(token: schema.InsertOnboardingToken): Promise<schema.OnboardingToken> {
    try {
      const [result] = await db.insert(schema.onboardingTokens).values(token).returning();
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
  async getOnboardingToken(tokenString: string): Promise<schema.OnboardingToken | undefined> {
    try {
      const result = await db
        .select()
        .from(schema.onboardingTokens)
        .where(eq(schema.onboardingTokens.token, tokenString))
        .limit(1);
      return result[0];
    } catch (error) {
      console.error('Database error retrieving onboarding token:', error);
      return undefined;
    }
  }
  
  async getAllOnboardingTokens(): Promise<schema.OnboardingToken[]> {
    try {
      const results = await db
        .select()
        .from(schema.onboardingTokens)
        .orderBy(desc(schema.onboardingTokens.createdAt));
      return results;
    } catch (error) {
      console.error('Database error retrieving all onboarding tokens:', error);
      return [];
    }
  }
  
  async markTokenAsUsed(tokenString: string): Promise<boolean> {
    try {
      const result = await db
        .update(schema.onboardingTokens)
        .set({ isUsed: true })
        .where(eq(schema.onboardingTokens.token, tokenString))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('Database error marking token as used:', error);
      return false;
    }
  }

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

  // Load Document operations - Professional document management with approval workflow
  async createLoadDocument(data: schema.InsertLoadDocument): Promise<schema.LoadDocument> {
    try {
      const id = randomUUID();
      const document: schema.LoadDocument = {
        ...data,
        id,
        approvalStatus: data.approvalStatus || 'pending',
        uploadSource: data.uploadSource || 'web',
        version: data.version || 1,
        isLatestVersion: data.isLatestVersion !== undefined ? data.isLatestVersion : true,
        isRequired: data.isRequired || false,
        uploadedAt: new Date(),
        createdAt: new Date(),
        approvedBy: data.approvedBy || null,
        approvedAt: data.approvedAt || null,
        rejectedBy: data.rejectedBy || null,
        rejectedAt: data.rejectedAt || null,
        rejectionReason: data.rejectionReason || null,
        dispatcherNotes: data.dispatcherNotes || null,
        imageWidth: data.imageWidth || null,
        imageHeight: data.imageHeight || null,
        qualityScore: data.qualityScore || null,
        qualityWarnings: data.qualityWarnings || null,
        parentDocumentId: data.parentDocumentId || null,
        requiredCategory: data.requiredCategory || null,
        signerName: data.signerName || null,
        notes: data.notes || null,
        mimeType: data.mimeType || null,
        fileSize: data.fileSize || null,
      };
      
      await db.insert(schema.loadDocuments).values(document);
      console.log(`📄 Created load document ${id} for load ${data.loadId}`);
      return document;
    } catch (error) {
      console.error('Error creating load document:', error);
      throw error;
    }
  }

  async getLoadDocument(id: string): Promise<schema.LoadDocument | null> {
    try {
      const result = await db.select().from(schema.loadDocuments).where(eq(schema.loadDocuments.id, id));
      return result[0] || null;
    } catch (error) {
      console.error('Error getting load document:', error);
      return null;
    }
  }

  async getDocument(id: string): Promise<schema.LoadDocument | null> {
    return this.getLoadDocument(id);
  }

  async updateDocumentNotes(id: string, notes: string): Promise<schema.LoadDocument | undefined> {
    try {
      await db.update(schema.loadDocuments)
        .set({ notes })
        .where(eq(schema.loadDocuments.id, id));
      
      const result = await this.getLoadDocument(id);
      console.log(`📝 Updated document ${id} notes`);
      return result || undefined;
    } catch (error) {
      console.error('Error updating document notes:', error);
      return undefined;
    }
  }

  async getLoadDocumentsByLoad(loadId: string): Promise<schema.LoadDocument[]> {
    try {
      const result = await db.select().from(schema.loadDocuments)
        .where(eq(schema.loadDocuments.loadId, loadId))
        .orderBy(desc(schema.loadDocuments.createdAt));
      return result;
    } catch (error) {
      console.error('Error getting load documents by load:', error);
      return [];
    }
  }

  async getLoadDocumentsByDriver(driverId: string): Promise<schema.LoadDocument[]> {
    try {
      const result = await db.select().from(schema.loadDocuments)
        .where(eq(schema.loadDocuments.driverId, driverId))
        .orderBy(desc(schema.loadDocuments.createdAt));
      return result;
    } catch (error) {
      console.error('Error getting load documents by driver:', error);
      return [];
    }
  }

  async getLoadDocumentsByType(loadId: string, documentType: string): Promise<schema.LoadDocument[]> {
    try {
      const result = await db.select().from(schema.loadDocuments)
        .where(
          and(
            eq(schema.loadDocuments.loadId, loadId),
            eq(schema.loadDocuments.documentType, documentType)
          )
        )
        .orderBy(desc(schema.loadDocuments.createdAt));
      return result;
    } catch (error) {
      console.error('Error getting load documents by type:', error);
      return [];
    }
  }

  async updateLoadDocument(id: string, data: Partial<schema.InsertLoadDocument>): Promise<schema.LoadDocument | null> {
    try {
      await db.update(schema.loadDocuments).set(data).where(eq(schema.loadDocuments.id, id));
      return this.getLoadDocument(id);
    } catch (error) {
      console.error('Error updating load document:', error);
      return null;
    }
  }

  async deleteLoadDocument(id: string): Promise<boolean> {
    try {
      const result = await db.delete(schema.loadDocuments).where(eq(schema.loadDocuments.id, id));
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting load document:', error);
      return false;
    }
  }

  async getAllLoadDocuments(): Promise<schema.LoadDocument[]> {
    try {
      const result = await db.select().from(schema.loadDocuments)
        .orderBy(desc(schema.loadDocuments.createdAt));
      return result;
    } catch (error) {
      console.error('Error getting all load documents:', error);
      return [];
    }
  }

  // Enhanced Load Document operations - Professional document approval workflow
  async approveDocument(documentId: string, approverId: string, notes?: string): Promise<schema.LoadDocument | undefined> {
    try {
      await db.update(schema.loadDocuments).set({
        approvalStatus: 'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
        dispatcherNotes: notes || null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      }).where(eq(schema.loadDocuments.id, documentId));
      
      const result = await this.getLoadDocument(documentId);
      console.log(`✅ Document ${documentId} approved by ${approverId}`);
      return result || undefined;
    } catch (error) {
      console.error('Error approving document:', error);
      return undefined;
    }
  }

  async rejectDocument(documentId: string, rejectedBy: string, reason: string): Promise<schema.LoadDocument | undefined> {
    try {
      await db.update(schema.loadDocuments).set({
        approvalStatus: 'rejected',
        rejectedBy: rejectedBy,
        rejectedAt: new Date(),
        rejectionReason: reason,
        approvedBy: null,
        approvedAt: null,
      }).where(eq(schema.loadDocuments.id, documentId));
      
      const result = await this.getLoadDocument(documentId);
      console.log(`❌ Document ${documentId} rejected by ${rejectedBy}: ${reason}`);
      return result || undefined;
    } catch (error) {
      console.error('Error rejecting document:', error);
      return undefined;
    }
  }

  async getDocumentsByLoad(loadId: string, includeRejected: boolean = false): Promise<schema.LoadDocument[]> {
    try {
      if (includeRejected) {
        return this.getLoadDocumentsByLoad(loadId);
      } else {
        const result = await db.select().from(schema.loadDocuments)
          .where(
            and(
              eq(schema.loadDocuments.loadId, loadId),
              or(
                eq(schema.loadDocuments.approvalStatus, 'pending'),
                eq(schema.loadDocuments.approvalStatus, 'approved')
              )
            )
          )
          .orderBy(desc(schema.loadDocuments.createdAt));
        return result;
      }
    } catch (error) {
      console.error('Error getting documents by load:', error);
      return [];
    }
  }

  async getRequiredDocuments(loadId: string): Promise<schema.LoadDocument[]> {
    try {
      const result = await db.select().from(schema.loadDocuments)
        .where(
          and(
            eq(schema.loadDocuments.loadId, loadId),
            eq(schema.loadDocuments.isRequired, true)
          )
        )
        .orderBy(desc(schema.loadDocuments.createdAt));
      console.log(`📋 Found ${result.length} required documents for load ${loadId}`);
      return result;
    } catch (error) {
      console.error('Error getting required documents:', error);
      return [];
    }
  }

  async getDocumentAuditLog(documentId: string): Promise<schema.LoadDocument[]> {
    try {
      // Get the document to find its parent chain
      const document = await this.getLoadDocument(documentId);
      if (!document) return [];
      
      // Get all versions in the document chain (parent documents and child versions)
      const result = await db.select().from(schema.loadDocuments)
        .where(
          or(
            eq(schema.loadDocuments.id, documentId),
            eq(schema.loadDocuments.parentDocumentId, documentId),
            drizzleSql`${schema.loadDocuments.parentDocumentId} IN (
              SELECT id FROM ${schema.loadDocuments} WHERE ${schema.loadDocuments.parentDocumentId} = ${documentId}
            )`
          )
        )
        .orderBy(desc(schema.loadDocuments.version), desc(schema.loadDocuments.createdAt));
      
      console.log(`📋 Audit log for document ${documentId}: ${result.length} versions`);
      return result;
    } catch (error) {
      console.error('Error getting document audit log:', error);
      return [];
    }
  }

  async recategorizeDocument(documentId: string, newCategory: string): Promise<schema.LoadDocument | undefined> {
    try {
      await db.update(schema.loadDocuments).set({
        documentType: newCategory,
      }).where(eq(schema.loadDocuments.id, documentId));
      
      const result = await this.getLoadDocument(documentId);
      console.log(`🔄 Document ${documentId} recategorized to ${newCategory}`);
      return result || undefined;
    } catch (error) {
      console.error('Error recategorizing document:', error);
      return undefined;
    }
  }

  // Get all documents with load details for document management page
  async getAllDocuments(): Promise<any[]> {
    try {
      const result = await db.select({
        id: schema.loadDocuments.id,
        loadId: schema.loadDocuments.loadId,
        driverId: schema.loadDocuments.driverId,
        documentType: schema.loadDocuments.documentType,
        imageUrl: schema.loadDocuments.imageUrl,
        uploadedAt: schema.loadDocuments.createdAt,
        uploadedBy: schema.loadDocuments.uploadedBy,
        approvalStatus: schema.loadDocuments.approvalStatus,
        approvedBy: schema.loadDocuments.approvedBy,
        rejectedBy: schema.loadDocuments.rejectedBy,
        approvedAt: schema.loadDocuments.approvedAt,
        rejectedAt: schema.loadDocuments.rejectedAt,
        approvalNotes: schema.loadDocuments.dispatcherNotes,
        rejectionReason: schema.loadDocuments.rejectionReason,
        qualityScore: schema.loadDocuments.qualityScore,
        resolution: schema.loadDocuments.resolution,
        fileSize: schema.loadDocuments.fileSize,
        version: schema.loadDocuments.version,
        isLatestVersion: schema.loadDocuments.isLatestVersion,
        loadTableId: schema.loads.id,
        loadNumber: schema.loads.loadNumber,
        pickupLocation: schema.loads.pickupLocation,
        deliveryLocation: schema.loads.deliveryLocation,
        loadStatus: schema.loads.status,
      })
      .from(schema.loadDocuments)
      .leftJoin(schema.loads, eq(schema.loadDocuments.loadId, schema.loads.id))
      .orderBy(desc(schema.loadDocuments.createdAt));
      
      return result.map(row => ({
        ...row,
        load: row.loadTableId ? {
          id: row.loadTableId,
          loadNumber: row.loadNumber,
          pickupLocation: row.pickupLocation,
          deliveryLocation: row.deliveryLocation,
          status: row.loadStatus,
        } : null
      }));
    } catch (error) {
      console.error('Error getting all documents with load details:', error);
      return [];
    }
  }

  // Create document - wrapper around createLoadDocument
  async createDocument(data: Partial<schema.InsertLoadDocument>): Promise<schema.LoadDocument> {
    return this.createLoadDocument(data as schema.InsertLoadDocument);
  }

  // AI Document Extraction operations
  async createDocumentExtraction(data: schema.InsertDocumentExtraction): Promise<schema.DocumentExtraction> {
    try {
      const id = randomUUID();
      const extraction: schema.DocumentExtraction = {
        ...data,
        id,
        isVerified: data.isVerified ?? false,
        verifiedBy: data.verifiedBy || null,
        verifiedAt: data.verifiedAt || null,
        createdAt: new Date(),
      };
      
      await db.insert(schema.documentExtractions).values(extraction);
      console.log(`✅ Created document extraction ${id} for document ${data.documentId}`);
      return extraction;
    } catch (error) {
      console.error('Error creating document extraction:', error);
      throw error;
    }
  }

  async getDocumentExtraction(id: string): Promise<schema.DocumentExtraction | undefined> {
    try {
      const result = await db.select().from(schema.documentExtractions).where(eq(schema.documentExtractions.id, id));
      return result[0];
    } catch (error) {
      console.error('Error getting document extraction:', error);
      return undefined;
    }
  }

  async getExtractionByDocumentId(documentId: string): Promise<schema.DocumentExtraction | undefined> {
    try {
      const result = await db.select()
        .from(schema.documentExtractions)
        .where(eq(schema.documentExtractions.documentId, documentId))
        .orderBy(desc(schema.documentExtractions.createdAt))
        .limit(1);
      return result[0];
    } catch (error) {
      console.error('Error getting extraction by document ID:', error);
      return undefined;
    }
  }

  async updateExtractionVerification(id: string, verifiedBy: string, verifiedAt: Date): Promise<schema.DocumentExtraction | undefined> {
    try {
      await db.update(schema.documentExtractions)
        .set({ 
          isVerified: true,
          verifiedBy,
          verifiedAt 
        })
        .where(eq(schema.documentExtractions.id, id));
      
      console.log(`✅ Updated extraction verification for ${id}`);
      return this.getDocumentExtraction(id);
    } catch (error) {
      console.error('Error updating extraction verification:', error);
      return undefined;
    }
  }

  async createExtractionVerification(data: schema.InsertExtractionVerification): Promise<schema.ExtractionVerification> {
    try {
      const id = randomUUID();
      const verification: schema.ExtractionVerification = {
        ...data,
        id,
        verifiedAt: new Date(),
      };
      
      await db.insert(schema.extractionVerifications).values(verification);
      console.log(`✅ Created extraction verification ${id} for extraction ${data.extractionId}`);
      return verification;
    } catch (error) {
      console.error('Error creating extraction verification:', error);
      throw error;
    }
  }

  async getExtractionVerifications(extractionId: string): Promise<schema.ExtractionVerification[]> {
    try {
      const result = await db.select()
        .from(schema.extractionVerifications)
        .where(eq(schema.extractionVerifications.extractionId, extractionId))
        .orderBy(desc(schema.extractionVerifications.verifiedAt));
      return result;
    } catch (error) {
      console.error('Error getting extraction verifications:', error);
      return [];
    }
  }

  async createGeofence(geofence: schema.InsertGeofence): Promise<schema.Geofence> {
    try {
      const id = randomUUID();
      const newGeofence: schema.Geofence = {
        ...geofence,
        id,
        isActive: geofence.isActive ?? true,
        notificationSettings: geofence.notificationSettings ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(schema.geofences).values(newGeofence);
      console.log(`✅ Created geofence ${id}: ${geofence.name}`);
      return newGeofence;
    } catch (error) {
      console.error('Error creating geofence:', error);
      throw error;
    }
  }

  async getGeofence(id: string): Promise<schema.Geofence | undefined> {
    try {
      const result = await db.select().from(schema.geofences).where(eq(schema.geofences.id, id));
      return result[0];
    } catch (error) {
      console.error('Error getting geofence:', error);
      return undefined;
    }
  }

  async updateGeofence(id: string, geofence: Partial<schema.InsertGeofence>): Promise<schema.Geofence | undefined> {
    try {
      await db.update(schema.geofences)
        .set({ ...geofence, updatedAt: new Date() })
        .where(eq(schema.geofences.id, id));
      console.log(`✅ Updated geofence ${id}`);
      return this.getGeofence(id);
    } catch (error) {
      console.error('Error updating geofence:', error);
      return undefined;
    }
  }

  async deleteGeofence(id: string): Promise<boolean> {
    try {
      const result = await db.delete(schema.geofences).where(eq(schema.geofences.id, id));
      console.log(`✅ Deleted geofence ${id}`);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting geofence:', error);
      return false;
    }
  }

  async getAllGeofences(): Promise<schema.Geofence[]> {
    try {
      return await db.select().from(schema.geofences).orderBy(desc(schema.geofences.createdAt));
    } catch (error) {
      console.error('Error getting all geofences:', error);
      return [];
    }
  }

  async createGeofenceEvent(event: schema.InsertGeofenceEvent): Promise<schema.GeofenceEvent> {
    try {
      const id = randomUUID();
      const newEvent: schema.GeofenceEvent = {
        ...event,
        id,
        wasNotified: event.wasNotified ?? false,
        createdAt: new Date(),
      };
      await db.insert(schema.geofenceEvents).values(newEvent);
      console.log(`✅ Created geofence event ${id}: ${event.eventType}`);
      return newEvent;
    } catch (error) {
      console.error('Error creating geofence event:', error);
      throw error;
    }
  }

  async getGeofenceEvent(id: string): Promise<schema.GeofenceEvent | undefined> {
    try {
      const result = await db.select().from(schema.geofenceEvents).where(eq(schema.geofenceEvents.id, id));
      return result[0];
    } catch (error) {
      console.error('Error getting geofence event:', error);
      return undefined;
    }
  }

  async getGeofenceEventsByDriver(driverId: string): Promise<schema.GeofenceEvent[]> {
    try {
      return await db.select()
        .from(schema.geofenceEvents)
        .where(eq(schema.geofenceEvents.driverId, driverId))
        .orderBy(desc(schema.geofenceEvents.timestamp));
    } catch (error) {
      console.error('Error getting geofence events by driver:', error);
      return [];
    }
  }

  async getGeofenceEventsByGeofence(geofenceId: string): Promise<schema.GeofenceEvent[]> {
    try {
      return await db.select()
        .from(schema.geofenceEvents)
        .where(eq(schema.geofenceEvents.geofenceId, geofenceId))
        .orderBy(desc(schema.geofenceEvents.timestamp));
    } catch (error) {
      console.error('Error getting geofence events by geofence:', error);
      return [];
    }
  }

  async getAllGeofenceEvents(): Promise<schema.GeofenceEvent[]> {
    try {
      return await db.select().from(schema.geofenceEvents).orderBy(desc(schema.geofenceEvents.timestamp));
    } catch (error) {
      console.error('Error getting all geofence events:', error);
      return [];
    }
  }

  async createRoute(route: schema.InsertRoute): Promise<schema.Route> {
    try {
      const id = randomUUID();
      const newRoute: schema.Route = {
        ...route,
        id,
        status: route.status ?? 'planned',
        plannedRoute: route.plannedRoute ?? null,
        actualRoute: route.actualRoute ?? null,
        deviationAlerts: route.deviationAlerts ?? [],
        trafficData: route.trafficData ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(schema.routes).values(newRoute);
      console.log(`✅ Created route ${id} for load ${route.loadId}`);
      return newRoute;
    } catch (error) {
      console.error('Error creating route:', error);
      throw error;
    }
  }

  async getRoute(id: string): Promise<schema.Route | undefined> {
    try {
      const result = await db.select().from(schema.routes).where(eq(schema.routes.id, id));
      return result[0];
    } catch (error) {
      console.error('Error getting route:', error);
      return undefined;
    }
  }

  async updateRoute(id: string, route: Partial<schema.InsertRoute>): Promise<schema.Route | undefined> {
    try {
      await db.update(schema.routes)
        .set({ ...route, updatedAt: new Date() })
        .where(eq(schema.routes.id, id));
      console.log(`✅ Updated route ${id}`);
      return this.getRoute(id);
    } catch (error) {
      console.error('Error updating route:', error);
      return undefined;
    }
  }

  async deleteRoute(id: string): Promise<boolean> {
    try {
      const result = await db.delete(schema.routes).where(eq(schema.routes.id, id));
      console.log(`✅ Deleted route ${id}`);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting route:', error);
      return false;
    }
  }

  async getRoutesByDriver(driverId: string): Promise<schema.Route[]> {
    try {
      return await db.select()
        .from(schema.routes)
        .where(eq(schema.routes.driverId, driverId))
        .orderBy(desc(schema.routes.createdAt));
    } catch (error) {
      console.error('Error getting routes by driver:', error);
      return [];
    }
  }

  async getAllRoutes(): Promise<schema.Route[]> {
    try {
      return await db.select().from(schema.routes).orderBy(desc(schema.routes.createdAt));
    } catch (error) {
      console.error('Error getting all routes:', error);
      return [];
    }
  }

  async createGpsDevice(device: schema.InsertGpsDevice): Promise<schema.GpsDevice> {
    try {
      const id = randomUUID();
      const newDevice: schema.GpsDevice = {
        ...device,
        id,
        status: device.status ?? 'active',
        deviceType: device.deviceType ?? 'mobile',
        isActive: device.isActive ?? true,
        settings: device.settings ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(schema.gpsDevices).values(newDevice);
      console.log(`✅ Created GPS device ${id}: ${device.deviceId}`);
      return newDevice;
    } catch (error) {
      console.error('Error creating GPS device:', error);
      throw error;
    }
  }

  async getGpsDevice(id: string): Promise<schema.GpsDevice | undefined> {
    try {
      const result = await db.select().from(schema.gpsDevices).where(eq(schema.gpsDevices.id, id));
      return result[0];
    } catch (error) {
      console.error('Error getting GPS device:', error);
      return undefined;
    }
  }

  async updateGpsDevice(id: string, device: Partial<schema.InsertGpsDevice>): Promise<schema.GpsDevice | undefined> {
    try {
      await db.update(schema.gpsDevices)
        .set({ ...device, updatedAt: new Date() })
        .where(eq(schema.gpsDevices.id, id));
      console.log(`✅ Updated GPS device ${id}`);
      return this.getGpsDevice(id);
    } catch (error) {
      console.error('Error updating GPS device:', error);
      return undefined;
    }
  }

  async deleteGpsDevice(id: string): Promise<boolean> {
    try {
      const result = await db.delete(schema.gpsDevices).where(eq(schema.gpsDevices.id, id));
      console.log(`✅ Deleted GPS device ${id}`);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting GPS device:', error);
      return false;
    }
  }

  async getGpsDevicesByDriver(driverId: string): Promise<schema.GpsDevice[]> {
    try {
      return await db.select()
        .from(schema.gpsDevices)
        .where(eq(schema.gpsDevices.driverId, driverId))
        .orderBy(desc(schema.gpsDevices.createdAt));
    } catch (error) {
      console.error('Error getting GPS devices by driver:', error);
      return [];
    }
  }

  async getAllGpsDevices(): Promise<schema.GpsDevice[]> {
    try {
      return await db.select().from(schema.gpsDevices).orderBy(desc(schema.gpsDevices.createdAt));
    } catch (error) {
      console.error('Error getting all GPS devices:', error);
      return [];
    }
  }

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
        source: schema.driverLocations.source, // CRITICAL: Needed for GPS vs simulated filtering
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
    const now = new Date();
    const loadOffer: schema.LoadOffer = {
      ...offer,
      id,
      sentAt: offer.sentAt || now, // Use provided sentAt or current time
      timeoutAt: offer.timeoutAt || new Date(now.getTime() + 3 * 60 * 1000), // Default 3 minute timeout
      createdAt: now,
      updatedAt: now,
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

  async getLoadCommunicationThreadByLoadAndDriver(loadId: string, driverId: string): Promise<schema.LoadCommunicationThread | undefined> {
    const result = await db.select()
      .from(schema.loadCommunicationThreads)
      .where(
        and(
          eq(schema.loadCommunicationThreads.loadId, loadId),
          eq(schema.loadCommunicationThreads.driverId, driverId)
        )
      );
    return result[0];
  }

  async getLoadCommunicationThreadByDriver(driverId: string): Promise<schema.LoadCommunicationThread | undefined> {
    const result = await db.select()
      .from(schema.loadCommunicationThreads)
      .where(eq(schema.loadCommunicationThreads.driverId, driverId))
      .orderBy(desc(schema.loadCommunicationThreads.lastMessageAt))
      .limit(1);
    return result[0];
  }

  async getAllLoadCommunicationThreads(): Promise<any[]> {
    const threads = await db
      .select({
        id: schema.loadCommunicationThreads.id,
        loadId: schema.loadCommunicationThreads.loadId,
        driverId: schema.loadCommunicationThreads.driverId,
        threadType: schema.loadCommunicationThreads.threadType,
        status: schema.loadCommunicationThreads.status,
        messageCount: schema.loadCommunicationThreads.messageCount,
        unreadDriverMessages: schema.loadCommunicationThreads.unreadDriverMessages,
        unreadDispatchMessages: schema.loadCommunicationThreads.unreadDispatchMessages,
        lastMessageAt: schema.loadCommunicationThreads.lastMessageAt,
        assistantEnabled: schema.loadCommunicationThreads.assistantEnabled,
        loadOrigin: schema.loadCommunicationThreads.loadOrigin,
        loadDestination: schema.loadCommunicationThreads.loadDestination,
        createdAt: schema.loadCommunicationThreads.createdAt,
        updatedAt: schema.loadCommunicationThreads.updatedAt,
        // Driver info
        driverName: schema.drivers.name,
        driverPhone: schema.drivers.phone,
        // Load info from threads table (cached) - preferred
        loadNumber: schema.loadCommunicationThreads.loadNumber,
        // Load info from loads table (fallback for null values)
        loadNumberFromLoad: schema.loads.loadNumber,
        lastMessageText: schema.loadCommunicationThreads.lastMessageText,
        lastMessageSender: schema.loadCommunicationThreads.lastMessageSender
      })
      .from(schema.loadCommunicationThreads)
      .leftJoin(schema.drivers, eq(schema.loadCommunicationThreads.driverId, schema.drivers.id))
      .leftJoin(schema.loads, eq(schema.loadCommunicationThreads.loadId, schema.loads.id))
      .where(eq(schema.loadCommunicationThreads.status, 'active'))
      .orderBy(desc(schema.loadCommunicationThreads.lastMessageAt));

    return threads;
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

  async getGeneralCommunicationThreadByDriver(driverId: string): Promise<schema.LoadCommunicationThread | undefined> {
    const result = await db.select()
      .from(schema.loadCommunicationThreads)
      .where(
        and(
          eq(schema.loadCommunicationThreads.driverId, driverId),
          eq(schema.loadCommunicationThreads.threadType, 'general'),
          eq(schema.loadCommunicationThreads.status, 'active')
        )
      );
    return result[0];
  }

  async getUnifiedThreadByDriver(driverId: string): Promise<schema.LoadCommunicationThread | undefined> {
    // Return the most recently active thread for this driver regardless of thread_type,
    // so inbound SMS always lands in the same thread the UI is displaying.
    const result = await db.select()
      .from(schema.loadCommunicationThreads)
      .where(
        and(
          eq(schema.loadCommunicationThreads.driverId, driverId),
          eq(schema.loadCommunicationThreads.status, 'active')
        )
      )
      .orderBy(desc(schema.loadCommunicationThreads.lastMessageAt))
      .limit(1);
    return result[0];
  }

  async getThreadsByDriver(driverId: string): Promise<any[]> {
    const threads = await db
      .select({
        id: schema.loadCommunicationThreads.id,
        loadId: schema.loadCommunicationThreads.loadId,
        driverId: schema.loadCommunicationThreads.driverId,
        threadType: schema.loadCommunicationThreads.threadType,
        status: schema.loadCommunicationThreads.status,
        messageCount: schema.loadCommunicationThreads.messageCount,
        unreadDriverMessages: schema.loadCommunicationThreads.unreadDriverMessages,
        unreadDispatchMessages: schema.loadCommunicationThreads.unreadDispatchMessages,
        lastMessageAt: schema.loadCommunicationThreads.lastMessageAt,
        assistantEnabled: schema.loadCommunicationThreads.assistantEnabled,
        loadOrigin: schema.loadCommunicationThreads.loadOrigin,
        loadDestination: schema.loadCommunicationThreads.loadDestination,
        createdAt: schema.loadCommunicationThreads.createdAt,
        updatedAt: schema.loadCommunicationThreads.updatedAt,
        driverName: schema.drivers.name,
        driverPhone: schema.drivers.phone,
        loadNumber: schema.loadCommunicationThreads.loadNumber,
        loadNumberFromLoad: schema.loads.loadNumber,
        lastMessageText: schema.loadCommunicationThreads.lastMessageText,
        lastMessageSender: schema.loadCommunicationThreads.lastMessageSender
      })
      .from(schema.loadCommunicationThreads)
      .leftJoin(schema.drivers, eq(schema.loadCommunicationThreads.driverId, schema.drivers.id))
      .leftJoin(schema.loads, eq(schema.loadCommunicationThreads.loadId, schema.loads.id))
      .where(eq(schema.loadCommunicationThreads.driverId, driverId))
      .orderBy(desc(schema.loadCommunicationThreads.lastMessageAt));

    return threads;
  }

  async consolidateDuplicateThreadsForDriver(driverId: string): Promise<{ merged: number; canonical: schema.LoadCommunicationThread | null }> {
    try {
      console.log(`🔄 Starting thread consolidation for driver ${driverId}`);
      
      // Find all unified threads for this driver
      const allThreads = await db.select()
        .from(schema.loadCommunicationThreads)
        .where(
          and(
            eq(schema.loadCommunicationThreads.driverId, driverId),
            eq(schema.loadCommunicationThreads.threadType, 'unified')
          )
        )
        .orderBy(desc(schema.loadCommunicationThreads.createdAt));
      
      if (allThreads.length <= 1) {
        console.log(`✅ Driver ${driverId} has ${allThreads.length} thread(s), no consolidation needed`);
        return { merged: 0, canonical: allThreads[0] || null };
      }
      
      console.log(`📊 Found ${allThreads.length} threads for driver ${driverId}, consolidating...`);
      
      // Select the newest thread as canonical (first in list due to DESC order)
      const canonicalThread = allThreads[0];
      const duplicateThreads = allThreads.slice(1);
      
      // Re-link all messages from duplicate threads to canonical thread
      let totalMessagesRelinked = 0;
      for (const dupThread of duplicateThreads) {
        const messages = await this.getLoadMessagesByThread(dupThread.id);
        
        for (const message of messages) {
          await db.update(schema.loadMessages)
            .set({ threadId: canonicalThread.id })
            .where(eq(schema.loadMessages.id, message.id));
          totalMessagesRelinked++;
        }
        
        console.log(`📝 Relinked ${messages.length} messages from thread ${dupThread.id}`);
      }
      
      // Recalculate message counts for canonical thread
      const allMessages = await this.getLoadMessagesByThread(canonicalThread.id);
      const unreadDispatch = allMessages.filter(m => m.senderRole === 'driver' && !m.isRead).length;
      const unreadDriver = allMessages.filter(m => m.senderRole === 'dispatch' && !m.isRead).length;
      
      await db.update(schema.loadCommunicationThreads)
        .set({
          messageCount: allMessages.length,
          unreadDispatchMessages: unreadDispatch,
          unreadDriverMessages: unreadDriver,
          updatedAt: new Date()
        })
        .where(eq(schema.loadCommunicationThreads.id, canonicalThread.id));
      
      // Soft-delete duplicate threads (archive them)
      for (const dupThread of duplicateThreads) {
        await db.update(schema.loadCommunicationThreads)
          .set({ 
            status: 'archived',
            updatedAt: new Date()
          })
          .where(eq(schema.loadCommunicationThreads.id, dupThread.id));
      }
      
      console.log(`✅ Consolidated ${duplicateThreads.length} duplicate threads for driver ${driverId}`);
      console.log(`📊 Total messages relinked: ${totalMessagesRelinked}`);
      
      // Return updated canonical thread
      const updatedCanonical = await this.getLoadCommunicationThread(canonicalThread.id);
      return { merged: duplicateThreads.length, canonical: updatedCanonical || null };
    } catch (error) {
      console.error(`❌ Error consolidating threads for driver ${driverId}:`, error);
      return { merged: 0, canonical: null };
    }
  }

  async consolidateAllDuplicateThreads(): Promise<{ totalDrivers: number; totalMerged: number }> {
    try {
      console.log('🚀 Starting global thread consolidation...');
      
      // Get all drivers who have unified threads
      const driversWithThreads = await db.selectDistinct({ driverId: schema.loadCommunicationThreads.driverId })
        .from(schema.loadCommunicationThreads)
        .where(eq(schema.loadCommunicationThreads.threadType, 'unified'));
      
      let totalMerged = 0;
      for (const { driverId } of driversWithThreads) {
        if (driverId) {
          const result = await this.consolidateDuplicateThreadsForDriver(driverId);
          totalMerged += result.merged;
        }
      }
      
      console.log(`✅ Global consolidation complete: ${totalMerged} threads merged across ${driversWithThreads.length} drivers`);
      return { totalDrivers: driversWithThreads.length, totalMerged };
    } catch (error) {
      console.error('❌ Error during global thread consolidation:', error);
      return { totalDrivers: 0, totalMerged: 0 };
    }
  }

  async acceptLoadOffer(threadId: string, loadId: string): Promise<boolean> {
    // Get the thread
    const thread = await this.getLoadCommunicationThread(threadId);
    if (!thread) return false;

    // Update the thread to mark the offer as accepted
    await db.update(schema.loadCommunicationThreads)
      .set({
        loadOfferStatus: 'accepted',
        loadOfferRespondedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(schema.loadCommunicationThreads.id, threadId));

    // Assign the driver to the load
    await db.update(schema.loads)
      .set({
        driverId: thread.driverId,
        status: 'assigned',
        updatedAt: new Date()
      })
      .where(eq(schema.loads.id, loadId));

    // Create a new load-specific thread for this driver and load
    await this.createLoadCommunicationThread({
      threadType: 'load',
      loadId: loadId,
      driverId: thread.driverId,
      status: 'active',
      messageCount: 0,
      unreadDriverMessages: 0,
      unreadDispatchMessages: 0,
      assistantEnabled: true,
      assistantMode: 'suggest',
      autoSendConfidence: 80
    });

    return true;
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

  async getMessageAttachmentsByDriver(driverId: string): Promise<schema.MessageAttachment[]> {
    return await db.select().from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.driverId, driverId))
      .orderBy(desc(schema.messageAttachments.createdAt));
  }

  async getMessageAttachmentsByCategory(loadId: string, category: string): Promise<schema.MessageAttachment[]> {
    return await db.select().from(schema.messageAttachments)
      .where(and(
        eq(schema.messageAttachments.loadId, loadId),
        eq(schema.messageAttachments.documentCategory, category)
      ))
      .orderBy(desc(schema.messageAttachments.createdAt));
  }

  async getPendingReviewAttachments(): Promise<schema.MessageAttachment[]> {
    return await db.select().from(schema.messageAttachments)
      .where(eq(schema.messageAttachments.documentStatus, 'pending_review'))
      .orderBy(desc(schema.messageAttachments.createdAt));
  }

  async approveMessageAttachment(id: string, reviewerId: string, notes?: string): Promise<schema.MessageAttachment | undefined> {
    await db.update(schema.messageAttachments)
      .set({
        documentStatus: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes || null
      })
      .where(eq(schema.messageAttachments.id, id));
    return this.getMessageAttachment(id);
  }

  async rejectMessageAttachment(id: string, reviewerId: string, notes: string): Promise<schema.MessageAttachment | undefined> {
    await db.update(schema.messageAttachments)
      .set({
        documentStatus: 'rejected',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNotes: notes
      })
      .where(eq(schema.messageAttachments.id, id));
    return this.getMessageAttachment(id);
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

  // Communication Analytics operations
  async getCommunicationInsights(startDate: Date, endDate: Date, insightType?: string): Promise<schema.CommunicationInsights[]> {
    const conditions = [
      gte(schema.communicationInsights.periodStart, startDate),
      lte(schema.communicationInsights.periodEnd, endDate),
    ];

    if (insightType) {
      conditions.push(eq(schema.communicationInsights.insightType, insightType));
    }

    return await db.select()
      .from(schema.communicationInsights)
      .where(and(...conditions))
      .orderBy(desc(schema.communicationInsights.periodStart));
  }

  async getAIPerformanceMetrics(startDate: Date, endDate: Date, driverId?: string, threadId?: string): Promise<schema.AiPerformanceMetrics[]> {
    const conditions = [
      gte(schema.aiPerformanceMetrics.periodStart, startDate),
      lte(schema.aiPerformanceMetrics.periodEnd, endDate),
    ];

    if (driverId) {
      conditions.push(eq(schema.aiPerformanceMetrics.driverId, driverId));
    }

    if (threadId) {
      conditions.push(eq(schema.aiPerformanceMetrics.threadId, threadId));
    }

    return await db.select()
      .from(schema.aiPerformanceMetrics)
      .where(and(...conditions))
      .orderBy(desc(schema.aiPerformanceMetrics.periodStart));
  }

  async getDriverEngagementMetrics(startDate: Date, endDate: Date, driverId?: string): Promise<schema.DriverEngagementMetrics[]> {
    const conditions = [
      gte(schema.driverEngagementMetrics.periodStart, startDate),
      lte(schema.driverEngagementMetrics.periodEnd, endDate),
    ];

    if (driverId) {
      conditions.push(eq(schema.driverEngagementMetrics.driverId, driverId));
    }

    return await db.select()
      .from(schema.driverEngagementMetrics)
      .where(and(...conditions))
      .orderBy(desc(schema.driverEngagementMetrics.periodStart));
  }

  // User operations - REQUIRED for Replit Auth
  async getUser(id: string): Promise<schema.User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  }

  async upsertUser(userData: schema.UpsertUser): Promise<schema.User> {
    const [user] = await db
      .insert(schema.users)
      .values(userData)
      .onConflictDoUpdate({
        target: schema.users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Zello Channel Operations - Store in memory for now, migrate to DB later
  private zelloChannelMessages: Map<string, schema.ZelloChannelMessage> = new Map();
  private zelloChannelStatuses: Map<string, schema.ZelloChannelStatus> = new Map();

  async createZelloChannelMessage(message: schema.InsertZelloChannelMessage): Promise<schema.ZelloChannelMessage> {
    const id = randomUUID();
    const newMessage: schema.ZelloChannelMessage = {
      ...message,
      id,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.zelloChannelMessages.set(id, newMessage);
    
    // Update channel unread count
    const status = await this.getZelloChannelStatus(message.channel);
    if (status) {
      await this.updateZelloChannelUnreadCount(message.channel, 1);
    } else {
      await this.createOrUpdateZelloChannelStatus({
        channelName: message.channel,
        unreadCount: 1,
        lastMessageAt: new Date(),
        lastMessageSender: message.sender,
        lastMessagePreview: message.textContent || '[Voice Message]',
        isActive: true,
        onlineUsers: 0,
        totalUsers: 0,
      });
    }
    
    return newMessage;
  }

  async getZelloChannelMessages(channel: string, limit: number = 100): Promise<schema.ZelloChannelMessage[]> {
    return Array.from(this.zelloChannelMessages.values())
      .filter(msg => msg.channel === channel)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getUnreadZelloMessages(channel: string): Promise<schema.ZelloChannelMessage[]> {
    return Array.from(this.zelloChannelMessages.values())
      .filter(msg => msg.channel === channel && !msg.isRead)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async markZelloMessagesAsRead(channel: string, messageIds: string[]): Promise<number> {
    let count = 0;
    for (const id of messageIds) {
      const msg = this.zelloChannelMessages.get(id);
      if (msg && msg.channel === channel && !msg.isRead) {
        msg.isRead = true;
        msg.updatedAt = new Date();
        this.zelloChannelMessages.set(id, msg);
        count++;
      }
    }
    
    // Update channel unread count
    if (count > 0) {
      await this.updateZelloChannelUnreadCount(channel, -count);
    }
    
    return count;
  }

  async getZelloChannelStatus(channel: string): Promise<schema.ZelloChannelStatus | null> {
    return this.zelloChannelStatuses.get(channel) || null;
  }

  async createOrUpdateZelloChannelStatus(status: schema.InsertZelloChannelStatus): Promise<schema.ZelloChannelStatus> {
    const existing = this.zelloChannelStatuses.get(status.channelName);
    const id = existing?.id || randomUUID();
    
    const updatedStatus: schema.ZelloChannelStatus = {
      ...existing,
      ...status,
      id,
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };
    
    this.zelloChannelStatuses.set(status.channelName, updatedStatus);
    return updatedStatus;
  }

  async updateZelloChannelUnreadCount(channel: string, delta: number): Promise<schema.ZelloChannelStatus | null> {
    const status = this.zelloChannelStatuses.get(channel);
    if (!status) return null;
    
    status.unreadCount = Math.max(0, status.unreadCount + delta);
    status.updatedAt = new Date();
    
    this.zelloChannelStatuses.set(channel, status);
    return status;
  }

  async getAllZelloChannelStatuses(): Promise<schema.ZelloChannelStatus[]> {
    return Array.from(this.zelloChannelStatuses.values())
      .sort((a, b) => a.channelName.localeCompare(b.channelName));
  }

  async getZelloMessageById(id: string): Promise<schema.ZelloChannelMessage | null> {
    return this.zelloChannelMessages.get(id) || null;
  }

  // MVFRS: Truck operations
  async getTruck(id: string): Promise<schema.Truck | undefined> {
    const result = await db.select().from(schema.trucks).where(eq(schema.trucks.id, id));
    return result[0];
  }

  async getTrucksByCompany(companyId: string): Promise<schema.Truck[]> {
    return await db.select().from(schema.trucks).where(eq(schema.trucks.companyId, companyId));
  }

  async createTruck(truck: schema.InsertTruck): Promise<schema.Truck> {
    const id = randomUUID();
    const newTruck: schema.Truck = {
      ...truck,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.trucks).values(newTruck);
    return newTruck;
  }

  async updateTruck(id: string, truck: Partial<schema.InsertTruck>): Promise<schema.Truck | undefined> {
    await db.update(schema.trucks).set({ ...truck, updatedAt: new Date() }).where(eq(schema.trucks.id, id));
    return this.getTruck(id);
  }

  async deleteTruck(id: string): Promise<boolean> {
    const result = await db.delete(schema.trucks).where(eq(schema.trucks.id, id));
    return result.rowCount > 0;
  }

  // MVFRS: Truck Risk Score Calculation
  async calculateTruckRiskScore(truckId: string): Promise<{
    riskScore: number;
    inspectionRiskPoints: number;
    maintenanceRiskPoints: number;
    breakdownRiskPoints: number;
    complianceRiskPoints: number;
    ageRiskPoints: number;
    dispatchGateStatus: 'GREEN' | 'YELLOW' | 'RED';
    dispatchGateReason: string | null;
  }> {
    const truck = await this.getTruck(truckId);
    if (!truck) throw new Error('Truck not found');

    let inspectionRiskPoints = 0;
    let maintenanceRiskPoints = 0;
    let breakdownRiskPoints = 0;
    let complianceRiskPoints = 0;
    let ageRiskPoints = 0;
    const reasons: string[] = [];

    // 1. Inspection Risk (0-25 points) - Failed inspections in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentInspections = await db.select().from(schema.fleetInspections)
      .where(and(
        eq(schema.fleetInspections.truckId, truckId),
        drizzleSql`${schema.fleetInspections.createdAt} >= ${thirtyDaysAgo}`
      ));
    
    const failedInspections = recentInspections.filter(i => i.status === 'FAILED');
    if (failedInspections.length > 0) {
      inspectionRiskPoints = Math.min(25, failedInspections.length * 10);
      reasons.push(`${failedInspections.length} failed inspection(s) in last 30 days`);
    }

    // Check for safety-critical defects in inspection items
    for (const inspection of recentInspections) {
      const items = await db.select().from(schema.inspectionItems)
        .where(and(
          eq(schema.inspectionItems.inspectionId, inspection.id),
          eq(schema.inspectionItems.isSafetyCritical, true),
          eq(schema.inspectionItems.status, 'DEFECT')
        ));
      if (items.length > 0) {
        inspectionRiskPoints = Math.min(25, inspectionRiskPoints + items.length * 5);
        reasons.push(`${items.length} safety-critical defect(s) found`);
      }
    }

    // 2. Maintenance Risk (0-25 points) - Open work orders
    const openWorkOrders = await db.select().from(schema.workOrders)
      .where(and(
        eq(schema.workOrders.truckId, truckId),
        notInArray(schema.workOrders.status, ['COMPLETED', 'CANCELLED'])
      ));
    
    const criticalWOs = openWorkOrders.filter(wo => wo.priority === 'CRITICAL');
    const urgentWOs = openWorkOrders.filter(wo => wo.priority === 'URGENT');
    const safetyHoldWOs = openWorkOrders.filter(wo => wo.safetyHold === true);

    if (safetyHoldWOs.length > 0) {
      maintenanceRiskPoints = 25;
      reasons.push(`${safetyHoldWOs.length} work order(s) with safety hold`);
    } else if (criticalWOs.length > 0) {
      maintenanceRiskPoints = Math.min(25, 15 + criticalWOs.length * 5);
      reasons.push(`${criticalWOs.length} critical work order(s) open`);
    } else if (urgentWOs.length > 0) {
      maintenanceRiskPoints = Math.min(20, urgentWOs.length * 5);
      reasons.push(`${urgentWOs.length} urgent work order(s) open`);
    } else if (openWorkOrders.length > 3) {
      maintenanceRiskPoints = Math.min(10, (openWorkOrders.length - 3) * 2);
      reasons.push(`${openWorkOrders.length} open work orders`);
    }

    // 3. Breakdown Risk (0-20 points) - Recent breakdowns
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const recentBreakdowns = await db.select().from(schema.breakdownReports)
      .where(and(
        eq(schema.breakdownReports.truckId, truckId),
        drizzleSql`${schema.breakdownReports.createdAt} >= ${ninetyDaysAgo}`
      ));
    
    if (recentBreakdowns.length > 0) {
      breakdownRiskPoints = Math.min(20, recentBreakdowns.length * 7);
      reasons.push(`${recentBreakdowns.length} breakdown(s) in last 90 days`);
    }

    // 4. Compliance Risk (0-20 points) - Expired documents
    const expiredDocs = await db.select().from(schema.fleetDocuments)
      .where(and(
        eq(schema.fleetDocuments.subjectId, truckId),
        eq(schema.fleetDocuments.subjectType, 'TRUCK'),
        eq(schema.fleetDocuments.status, 'EXPIRED')
      ));
    
    if (expiredDocs.length > 0) {
      complianceRiskPoints = Math.min(20, expiredDocs.length * 10);
      reasons.push(`${expiredDocs.length} expired document(s)`);
    }

    // Check for documents expiring in next 14 days
    const fourteenDaysFromNow = new Date();
    fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
    
    const expiringDocs = await db.select().from(schema.fleetDocuments)
      .where(and(
        eq(schema.fleetDocuments.subjectId, truckId),
        eq(schema.fleetDocuments.subjectType, 'TRUCK'),
        eq(schema.fleetDocuments.status, 'ACTIVE'),
        drizzleSql`${schema.fleetDocuments.expiresAt} <= ${fourteenDaysFromNow}`
      ));
    
    if (expiringDocs.length > 0) {
      complianceRiskPoints = Math.min(20, complianceRiskPoints + expiringDocs.length * 3);
      reasons.push(`${expiringDocs.length} document(s) expiring soon`);
    }

    // 5. Age Risk (0-10 points) - Based on truck age
    const currentYear = new Date().getFullYear();
    const truckAge = currentYear - (truck.year || currentYear);
    
    if (truckAge >= 15) {
      ageRiskPoints = 10;
      reasons.push(`Truck is ${truckAge} years old`);
    } else if (truckAge >= 10) {
      ageRiskPoints = 5;
    } else if (truckAge >= 7) {
      ageRiskPoints = 2;
    }

    // Calculate total risk score (0-100)
    const riskScore = Math.min(100, 
      inspectionRiskPoints + 
      maintenanceRiskPoints + 
      breakdownRiskPoints + 
      complianceRiskPoints + 
      ageRiskPoints
    );

    // Determine dispatch gate status
    let dispatchGateStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    let dispatchGateReason: string | null = null;

    // RED conditions (no dispatch allowed)
    if (safetyHoldWOs.length > 0 || truck.status === 'OUT_OF_SERVICE' || expiredDocs.length > 0) {
      dispatchGateStatus = 'RED';
      dispatchGateReason = reasons.length > 0 ? reasons.slice(0, 3).join('; ') : 'Safety hold or compliance issue';
    }
    // YELLOW conditions (requires manager approval)
    else if (riskScore >= 40 || criticalWOs.length > 0 || failedInspections.length > 0) {
      dispatchGateStatus = 'YELLOW';
      dispatchGateReason = reasons.length > 0 ? reasons.slice(0, 3).join('; ') : 'Elevated risk';
    }

    // Update truck with calculated values
    await db.update(schema.trucks).set({
      riskScore,
      inspectionRiskPoints,
      maintenanceRiskPoints,
      breakdownRiskPoints,
      complianceRiskPoints,
      ageRiskPoints,
      dispatchGateStatus,
      dispatchGateReason,
      riskScoreLastCalculatedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.trucks.id, truckId));

    return {
      riskScore,
      inspectionRiskPoints,
      maintenanceRiskPoints,
      breakdownRiskPoints,
      complianceRiskPoints,
      ageRiskPoints,
      dispatchGateStatus,
      dispatchGateReason
    };
  }

  // MVFRS: Check if truck can be dispatched
  async checkDispatchGate(truckId: string): Promise<{
    canDispatch: boolean;
    status: 'GREEN' | 'YELLOW' | 'RED';
    reason: string | null;
    riskScore: number;
    requiresApproval: boolean;
    overrideInfo?: {
      overrideBy: string | null;
      overrideAt: Date | null;
      overrideReason: string | null;
    };
  }> {
    const truck = await this.getTruck(truckId);
    if (!truck) throw new Error('Truck not found');

    // Recalculate risk score if stale (older than 1 hour)
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    
    if (!truck.riskScoreLastCalculatedAt || truck.riskScoreLastCalculatedAt < oneHourAgo) {
      await this.calculateTruckRiskScore(truckId);
      const updatedTruck = await this.getTruck(truckId);
      if (updatedTruck) {
        return {
          canDispatch: updatedTruck.dispatchGateStatus !== 'RED',
          status: updatedTruck.dispatchGateStatus as 'GREEN' | 'YELLOW' | 'RED',
          reason: updatedTruck.dispatchGateReason,
          riskScore: updatedTruck.riskScore || 0,
          requiresApproval: updatedTruck.dispatchGateStatus === 'YELLOW',
          overrideInfo: updatedTruck.dispatchGateOverrideBy ? {
            overrideBy: updatedTruck.dispatchGateOverrideBy,
            overrideAt: updatedTruck.dispatchGateOverrideAt,
            overrideReason: updatedTruck.dispatchGateOverrideReason
          } : undefined
        };
      }
    }

    return {
      canDispatch: truck.dispatchGateStatus !== 'RED',
      status: (truck.dispatchGateStatus || 'GREEN') as 'GREEN' | 'YELLOW' | 'RED',
      reason: truck.dispatchGateReason,
      riskScore: truck.riskScore || 0,
      requiresApproval: truck.dispatchGateStatus === 'YELLOW',
      overrideInfo: truck.dispatchGateOverrideBy ? {
        overrideBy: truck.dispatchGateOverrideBy,
        overrideAt: truck.dispatchGateOverrideAt,
        overrideReason: truck.dispatchGateOverrideReason
      } : undefined
    };
  }

  // MVFRS: Override dispatch gate (manager approval)
  async overrideDispatchGate(truckId: string, userId: string, reason: string): Promise<schema.Truck | undefined> {
    await db.update(schema.trucks).set({
      dispatchGateOverrideBy: userId,
      dispatchGateOverrideAt: new Date(),
      dispatchGateOverrideReason: reason,
      updatedAt: new Date()
    }).where(eq(schema.trucks.id, truckId));
    
    return this.getTruck(truckId);
  }

  // MVFRS: Clear dispatch gate override
  async clearDispatchGateOverride(truckId: string): Promise<schema.Truck | undefined> {
    await db.update(schema.trucks).set({
      dispatchGateOverrideBy: null,
      dispatchGateOverrideAt: null,
      dispatchGateOverrideReason: null,
      updatedAt: new Date()
    }).where(eq(schema.trucks.id, truckId));
    
    return this.getTruck(truckId);
  }

  // MVFRS: Vendor operations
  async getVendor(id: string): Promise<schema.Vendor | undefined> {
    const result = await db.select().from(schema.vendors).where(eq(schema.vendors.id, id));
    return result[0];
  }

  async getVendorsByCompany(companyId: string): Promise<schema.Vendor[]> {
    return await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
  }

  async createVendor(vendor: schema.InsertVendor): Promise<schema.Vendor> {
    const id = randomUUID();
    const newVendor: schema.Vendor = {
      ...vendor,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.vendors).values(newVendor);
    return newVendor;
  }

  async updateVendor(id: string, vendor: Partial<schema.InsertVendor>): Promise<schema.Vendor | undefined> {
    await db.update(schema.vendors).set({ ...vendor, updatedAt: new Date() }).where(eq(schema.vendors.id, id));
    return this.getVendor(id);
  }

  async deleteVendor(id: string): Promise<boolean> {
    const result = await db.delete(schema.vendors).where(eq(schema.vendors.id, id));
    return result.rowCount > 0;
  }

  // MVFRS: Fleet Inspection operations
  async getFleetInspection(id: string): Promise<schema.FleetInspection | undefined> {
    const result = await db.select().from(schema.fleetInspections).where(eq(schema.fleetInspections.id, id));
    return result[0];
  }

  async getFleetInspectionsByTruck(truckId: string): Promise<schema.FleetInspection[]> {
    return await db.select().from(schema.fleetInspections)
      .where(eq(schema.fleetInspections.truckId, truckId))
      .orderBy(desc(schema.fleetInspections.createdAt));
  }

  async getFleetInspectionsByCompany(companyId: string): Promise<schema.FleetInspection[]> {
    return await db.select().from(schema.fleetInspections)
      .where(eq(schema.fleetInspections.companyId, companyId))
      .orderBy(desc(schema.fleetInspections.createdAt));
  }

  async createFleetInspection(inspection: schema.InsertFleetInspection): Promise<schema.FleetInspection> {
    const id = randomUUID();
    const newInspection: schema.FleetInspection = {
      ...inspection,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.fleetInspections).values(newInspection);
    return newInspection;
  }

  async updateFleetInspection(id: string, inspection: Partial<schema.InsertFleetInspection>): Promise<schema.FleetInspection | undefined> {
    await db.update(schema.fleetInspections).set({ ...inspection, updatedAt: new Date() }).where(eq(schema.fleetInspections.id, id));
    return this.getFleetInspection(id);
  }

  // MVFRS: Inspection Items operations
  async getInspectionItem(id: string): Promise<schema.InspectionItem | undefined> {
    const result = await db.select().from(schema.inspectionItems).where(eq(schema.inspectionItems.id, id));
    return result[0];
  }

  async getInspectionItemsByInspection(inspectionId: string): Promise<schema.InspectionItem[]> {
    return await db.select().from(schema.inspectionItems)
      .where(eq(schema.inspectionItems.inspectionId, inspectionId));
  }

  async createInspectionItem(item: schema.InsertInspectionItem): Promise<schema.InspectionItem> {
    const id = randomUUID();
    const newItem: schema.InspectionItem = {
      ...item,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.inspectionItems).values(newItem);
    return newItem;
  }

  async updateInspectionItem(id: string, item: Partial<schema.InsertInspectionItem>): Promise<schema.InspectionItem | undefined> {
    await db.update(schema.inspectionItems).set({ ...item, updatedAt: new Date() }).where(eq(schema.inspectionItems.id, id));
    return this.getInspectionItem(id);
  }

  async bulkCreateInspectionItems(items: schema.InsertInspectionItem[]): Promise<schema.InspectionItem[]> {
    const createdItems: schema.InspectionItem[] = [];
    for (const item of items) {
      const created = await this.createInspectionItem(item);
      createdItems.push(created);
    }
    return createdItems;
  }

  // MVFRS: Work Order operations
  async getWorkOrder(id: string): Promise<schema.WorkOrder | undefined> {
    const result = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, id));
    return result[0];
  }

  async getWorkOrdersByCompany(companyId: string): Promise<schema.WorkOrder[]> {
    return await db.select().from(schema.workOrders)
      .where(eq(schema.workOrders.companyId, companyId))
      .orderBy(desc(schema.workOrders.createdAt));
  }

  async getWorkOrdersByTruck(truckId: string): Promise<schema.WorkOrder[]> {
    return await db.select().from(schema.workOrders)
      .where(eq(schema.workOrders.truckId, truckId))
      .orderBy(desc(schema.workOrders.createdAt));
  }

  async getWorkOrdersByStatus(companyId: string, status: string): Promise<schema.WorkOrder[]> {
    return await db.select().from(schema.workOrders)
      .where(and(
        eq(schema.workOrders.companyId, companyId),
        eq(schema.workOrders.status, status as any)
      ))
      .orderBy(desc(schema.workOrders.createdAt));
  }

  async createWorkOrder(workOrder: schema.InsertWorkOrder): Promise<schema.WorkOrder> {
    const id = randomUUID();
    const newWorkOrder: schema.WorkOrder = {
      ...workOrder,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.workOrders).values(newWorkOrder);
    return newWorkOrder;
  }

  async updateWorkOrder(id: string, workOrder: Partial<schema.InsertWorkOrder>): Promise<schema.WorkOrder | undefined> {
    await db.update(schema.workOrders).set({ ...workOrder, updatedAt: new Date() }).where(eq(schema.workOrders.id, id));
    return this.getWorkOrder(id);
  }

  // MVFRS: Work Order Event operations
  async getWorkOrderEvents(workOrderId: string): Promise<schema.WorkOrderEvent[]> {
    return await db.select().from(schema.workOrderEvents)
      .where(eq(schema.workOrderEvents.workOrderId, workOrderId))
      .orderBy(desc(schema.workOrderEvents.createdAt));
  }

  async createWorkOrderEvent(event: schema.InsertWorkOrderEvent): Promise<schema.WorkOrderEvent> {
    const id = randomUUID();
    const newEvent: schema.WorkOrderEvent = {
      ...event,
      id,
      createdAt: new Date(),
    };
    await db.insert(schema.workOrderEvents).values(newEvent);
    return newEvent;
  }

  // MVFRS: Breakdown Report operations
  async getBreakdownReport(id: string): Promise<schema.BreakdownReport | undefined> {
    const result = await db.select().from(schema.breakdownReports).where(eq(schema.breakdownReports.id, id));
    return result[0];
  }

  async getBreakdownReportsByCompany(companyId: string): Promise<schema.BreakdownReport[]> {
    return await db.select().from(schema.breakdownReports)
      .where(eq(schema.breakdownReports.companyId, companyId))
      .orderBy(desc(schema.breakdownReports.reportedAt));
  }

  async createBreakdownReport(report: schema.InsertBreakdownReport): Promise<schema.BreakdownReport> {
    const id = randomUUID();
    const newReport: schema.BreakdownReport = {
      ...report,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.breakdownReports).values(newReport);
    return newReport;
  }

  async updateBreakdownReport(id: string, report: Partial<schema.InsertBreakdownReport>): Promise<schema.BreakdownReport | undefined> {
    await db.update(schema.breakdownReports).set({ ...report, updatedAt: new Date() }).where(eq(schema.breakdownReports.id, id));
    return this.getBreakdownReport(id);
  }

  // MVFRS: Fleet Document operations
  async getFleetDocument(id: string): Promise<schema.FleetDocument | undefined> {
    const result = await db.select().from(schema.fleetDocuments).where(eq(schema.fleetDocuments.id, id));
    return result[0];
  }

  async getFleetDocumentsByCompany(companyId: string): Promise<schema.FleetDocument[]> {
    return await db.select().from(schema.fleetDocuments)
      .where(eq(schema.fleetDocuments.companyId, companyId))
      .orderBy(desc(schema.fleetDocuments.expiryDate));
  }

  async getFleetDocumentsBySubject(subjectType: string, subjectId: string): Promise<schema.FleetDocument[]> {
    return await db.select().from(schema.fleetDocuments)
      .where(and(
        eq(schema.fleetDocuments.subjectType, subjectType as any),
        eq(schema.fleetDocuments.subjectId, subjectId)
      ));
  }

  async getExpiringDocuments(companyId: string, daysAhead: number): Promise<schema.FleetDocument[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    
    return await db.select().from(schema.fleetDocuments)
      .where(and(
        eq(schema.fleetDocuments.companyId, companyId),
        eq(schema.fleetDocuments.status, 'ACTIVE'),
        drizzleSql`${schema.fleetDocuments.expiryDate} <= ${futureDate}`
      ))
      .orderBy(schema.fleetDocuments.expiryDate);
  }

  async createFleetDocument(doc: schema.InsertFleetDocument): Promise<schema.FleetDocument> {
    const id = randomUUID();
    const newDoc: schema.FleetDocument = {
      ...doc,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.fleetDocuments).values(newDoc);
    return newDoc;
  }

  async updateFleetDocument(id: string, doc: Partial<schema.InsertFleetDocument>): Promise<schema.FleetDocument | undefined> {
    await db.update(schema.fleetDocuments).set({ ...doc, updatedAt: new Date() }).where(eq(schema.fleetDocuments.id, id));
    return this.getFleetDocument(id);
  }

  // MVFRS: PM Schedule operations
  async getPmSchedule(id: string): Promise<schema.PmSchedule | undefined> {
    const result = await db.select().from(schema.pmSchedule).where(eq(schema.pmSchedule.id, id));
    return result[0];
  }

  async getPmSchedulesByTruck(truckId: string): Promise<schema.PmSchedule[]> {
    return await db.select().from(schema.pmSchedule)
      .where(eq(schema.pmSchedule.truckId, truckId))
      .orderBy(schema.pmSchedule.dueDate);
  }

  async getDuePmSchedules(companyId: string): Promise<schema.PmSchedule[]> {
    return await db.select().from(schema.pmSchedule)
      .innerJoin(schema.trucks, eq(schema.pmSchedule.truckId, schema.trucks.id))
      .where(and(
        eq(schema.trucks.companyId, companyId),
        or(
          eq(schema.pmSchedule.status, 'DUE'),
          eq(schema.pmSchedule.status, 'DUE_SOON'),
          eq(schema.pmSchedule.status, 'OVERDUE')
        )
      )) as any;
  }

  async createPmSchedule(schedule: schema.InsertPmSchedule): Promise<schema.PmSchedule> {
    const id = randomUUID();
    const newSchedule: schema.PmSchedule = {
      ...schedule,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.pmSchedule).values(newSchedule);
    return newSchedule;
  }

  async updatePmSchedule(id: string, schedule: Partial<schema.InsertPmSchedule>): Promise<schema.PmSchedule | undefined> {
    await db.update(schema.pmSchedule).set({ ...schedule, updatedAt: new Date() }).where(eq(schema.pmSchedule.id, id));
    return this.getPmSchedule(id);
  }

  // MVFRS: Maintenance Plan operations
  async getMaintenancePlan(id: string): Promise<schema.MaintenancePlan | undefined> {
    const result = await db.select().from(schema.maintenancePlans).where(eq(schema.maintenancePlans.id, id));
    return result[0];
  }

  async getMaintenancePlansByCompany(companyId: string): Promise<schema.MaintenancePlan[]> {
    return await db.select().from(schema.maintenancePlans)
      .where(eq(schema.maintenancePlans.companyId, companyId));
  }

  async createMaintenancePlan(plan: schema.InsertMaintenancePlan): Promise<schema.MaintenancePlan> {
    const id = randomUUID();
    const newPlan: schema.MaintenancePlan = {
      ...plan,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.maintenancePlans).values(newPlan);
    return newPlan;
  }

  async updateMaintenancePlan(id: string, plan: Partial<schema.InsertMaintenancePlan>): Promise<schema.MaintenancePlan | undefined> {
    await db.update(schema.maintenancePlans).set({ ...plan, updatedAt: new Date() }).where(eq(schema.maintenancePlans.id, id));
    return this.getMaintenancePlan(id);
  }
}