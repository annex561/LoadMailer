import { type Driver, type InsertDriver, type Customer, type InsertCustomer, type Load, type InsertLoad, type LoadWithRelations, type EmailTemplate, type InsertEmailTemplate, type EmailLog, type InsertEmailLog, type EmailLogWithRelations, type OnboardingToken, type InsertOnboardingToken, type DriverLocation, type InsertDriverLocation, type DriverOnboarding, type ReportTemplate, type InsertReportTemplate, type ScraperConfig, type InsertScraperConfig, type ScraperLog, type InsertScraperLog, type LanePreference, type InsertLanePreference, type AvoidLocation, type InsertAvoidLocation, type TelegramBotConfig, type InsertTelegramBotConfig, type LoadOffer, type InsertLoadOffer } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Driver operations
  getDriver(id: string): Promise<Driver | undefined>;
  getAllDrivers(): Promise<Driver[]>;
  createDriver(driver: InsertDriver): Promise<Driver>;
  updateDriver(id: string, driver: Partial<InsertDriver>): Promise<Driver | undefined>;
  deleteDriver(id: string): Promise<boolean>;

  // Customer operations
  getCustomer(id: string): Promise<Customer | undefined>;
  getAllCustomers(): Promise<Customer[]>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;

  // Load operations
  getLoad(id: string): Promise<LoadWithRelations | undefined>;
  getAllLoads(): Promise<LoadWithRelations[]>;
  createLoad(load: InsertLoad): Promise<LoadWithRelations>;
  updateLoad(id: string, load: Partial<InsertLoad>): Promise<LoadWithRelations | undefined>;
  deleteLoad(id: string): Promise<boolean>;
  getLoadsByStatus(status: string): Promise<LoadWithRelations[]>;

  // Email template operations
  getEmailTemplate(id: string): Promise<EmailTemplate | undefined>;
  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;
  updateEmailTemplate(id: string, template: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined>;
  deleteEmailTemplate(id: string): Promise<boolean>;
  getEmailTemplatesByTrigger(trigger: string): Promise<EmailTemplate[]>;

  // Email log operations
  getEmailLog(id: string): Promise<EmailLogWithRelations | undefined>;
  getAllEmailLogs(): Promise<EmailLogWithRelations[]>;
  createEmailLog(log: InsertEmailLog): Promise<EmailLog>;
  updateEmailLog(id: string, log: Partial<InsertEmailLog>): Promise<EmailLog | undefined>;
  getEmailLogsByLoad(loadId: string): Promise<EmailLogWithRelations[]>;

  // Onboarding token operations
  createOnboardingToken(token: InsertOnboardingToken): Promise<OnboardingToken>;
  getOnboardingToken(token: string): Promise<OnboardingToken | undefined>;
  getAllOnboardingTokens(): Promise<OnboardingToken[]>;
  markTokenAsUsed(token: string): Promise<boolean>;

  // Driver location operations
  createDriverLocation(location: InsertDriverLocation): Promise<DriverLocation>;
  getDriverCurrentLocation(driverId: string): Promise<DriverLocation | undefined>;
  getDriverLocationHistory(driverId: string): Promise<DriverLocation[]>;

  // Driver onboarding
  completeDriverOnboarding(data: DriverOnboarding, token: string): Promise<Driver>;

  // Scraper configuration operations
  getScraperConfig(id: string): Promise<ScraperConfig | undefined>;
  getAllScraperConfigs(): Promise<ScraperConfig[]>;
  createScraperConfig(config: InsertScraperConfig): Promise<ScraperConfig>;
  updateScraperConfig(id: string, config: Partial<InsertScraperConfig>): Promise<ScraperConfig | undefined>;
  deleteScraperConfig(id: string): Promise<boolean>;

  // Scraper log operations
  getScraperLog(id: string): Promise<ScraperLog | undefined>;
  getAllScraperLogs(): Promise<ScraperLog[]>;
  createScraperLog(log: InsertScraperLog): Promise<ScraperLog>;
  updateScraperLog(id: string, log: Partial<InsertScraperLog>): Promise<ScraperLog | undefined>;
  getScraperLogsByConfig(configId: string): Promise<ScraperLog[]>;

  // Telegram bot operations
  getTelegramBotConfig(id: string): Promise<TelegramBotConfig | undefined>;
  getAllTelegramBotConfigs(): Promise<TelegramBotConfig[]>;
  createTelegramBotConfig(config: InsertTelegramBotConfig): Promise<TelegramBotConfig>;
  updateTelegramBotConfig(id: string, config: Partial<InsertTelegramBotConfig>): Promise<TelegramBotConfig | undefined>;
  
  // Lane preference operations
  getLanePreference(id: string): Promise<LanePreference | undefined>;
  getAllLanePreferences(): Promise<LanePreference[]>;
  createLanePreference(pref: InsertLanePreference): Promise<LanePreference>;
  updateLanePreference(id: string, pref: Partial<InsertLanePreference>): Promise<LanePreference | undefined>;
  deleteLanePreference(id: string): Promise<boolean>;
  
  // Avoid location operations
  getAvoidLocation(id: string): Promise<AvoidLocation | undefined>;
  getAllAvoidLocations(): Promise<AvoidLocation[]>;
  createAvoidLocation(location: InsertAvoidLocation): Promise<AvoidLocation>;
  updateAvoidLocation(id: string, location: Partial<InsertAvoidLocation>): Promise<AvoidLocation | undefined>;
  deleteAvoidLocation(id: string): Promise<boolean>;
  
  // Load offer operations
  getLoadOffer(id: string): Promise<LoadOffer | undefined>;
  getAllLoadOffers(): Promise<LoadOffer[]>;
  createLoadOffer(offer: InsertLoadOffer): Promise<LoadOffer>;
  updateLoadOffer(id: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined>;
  getLoadOfferByLoadAndDriver(loadId: string, driverId: string): Promise<LoadOffer | undefined>;
  updateLoadOfferByLoadAndDriver(loadId: string, driverId: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined>;
  
  // Driver telegram operations
  getDriverByTelegramId(telegramId: string): Promise<Driver | undefined>;
  getDriversWithTelegramEnabled(): Promise<Driver[]>;
}

export class MemStorage implements IStorage {
  private drivers: Map<string, Driver> = new Map();
  private customers: Map<string, Customer> = new Map();
  private loads: Map<string, Load> = new Map();
  private emailTemplates: Map<string, EmailTemplate> = new Map();
  private emailLogs: Map<string, EmailLog> = new Map();
  private onboardingTokens: Map<string, OnboardingToken> = new Map();
  private driverLocations: Map<string, DriverLocation> = new Map();
  private scraperConfigs: Map<string, ScraperConfig> = new Map();
  private scraperLogs: Map<string, ScraperLog> = new Map();
  private telegramBotConfigs: Map<string, TelegramBotConfig> = new Map();
  private lanePreferences: Map<string, LanePreference> = new Map();
  private avoidLocations: Map<string, AvoidLocation> = new Map();
  private loadOffers: Map<string, LoadOffer> = new Map();
  private loadCounter = 1;

  constructor() {
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    // Create default drivers
    const driver1: Driver = {
      id: randomUUID(),
      name: "Mike Johnson",
      email: "mike.johnson@company.com",
      phone: "(555) 123-4567",
      status: "available",
      licenseNumber: "DL12345678",
      emergencyContact: "Jane Johnson",
      emergencyPhone: "(555) 987-6543",
      isOnboarded: true,
      telegramId: null,
      telegramUsername: null,
      city: null,
      enableTelegramNotifications: false,
      createdAt: new Date(),
    };
    
    const driver2: Driver = {
      id: randomUUID(),
      name: "Sarah Williams",
      email: "sarah.williams@company.com",
      phone: "(555) 987-6543",
      status: "on_route",
      licenseNumber: "DL87654321",
      emergencyContact: "John Williams",
      emergencyPhone: "(555) 321-0987",
      isOnboarded: true,
      telegramId: null,
      telegramUsername: null,
      city: null,
      enableTelegramNotifications: false,
      createdAt: new Date(),
    };

    this.drivers.set(driver1.id, driver1);
    this.drivers.set(driver2.id, driver2);

    // Create default customers
    const customer1: Customer = {
      id: randomUUID(),
      name: "ABC Manufacturing",
      contactPerson: "John Smith",
      email: "contact@abcmfg.com",
      phone: "(555) 234-5678",
      address: "1234 Industrial Blvd, Chicago, IL 60601",
      status: "active",
      createdAt: new Date(),
    };

    const customer2: Customer = {
      id: randomUUID(),
      name: "XYZ Logistics",
      contactPerson: "Maria Garcia",
      email: "orders@xyzlog.com",
      phone: "(555) 876-5432",
      address: "9876 Commerce Ave, Dallas, TX 75201",
      status: "active",
      createdAt: new Date(),
    };

    this.customers.set(customer1.id, customer1);
    this.customers.set(customer2.id, customer2);

    // Create default email templates
    const template1: EmailTemplate = {
      id: randomUUID(),
      name: "Load Assignment",
      description: "Notification sent to drivers when a new load is assigned",
      trigger: "load_created",
      recipients: "driver",
      subject: "New Load Assignment - {{loadNumber}}",
      body: "Hello {{driverName}},\n\nYou have been assigned a new load:\n\nLoad Number: {{loadNumber}}\nCustomer: {{customerName}}\nPickup: {{pickupAddress}} on {{pickupDate}} at {{pickupTime}}\nDelivery: {{deliveryAddress}} on {{deliveryDate}} at {{deliveryTime}}\n\nSpecial Instructions: {{specialInstructions}}\n\nPlease confirm receipt of this assignment.\n\nBest regards,\nLoadMaster Team",
      isActive: true,
      createdAt: new Date(),
    };

    const template2: EmailTemplate = {
      id: randomUUID(),
      name: "Pickup Confirmation",
      description: "Sent to customer when driver confirms pickup",
      trigger: "pickup_confirmed",
      recipients: "customer",
      subject: "Pickup Confirmed - {{loadNumber}}",
      body: "Dear {{customerContactPerson}},\n\nWe're pleased to confirm that your shipment has been picked up:\n\nLoad Number: {{loadNumber}}\nPickup Time: {{currentTime}}\nDriver: {{driverName}} - {{driverPhone}}\nExpected Delivery: {{deliveryDate}} at {{deliveryTime}}\n\nYou can track your shipment status through our system.\n\nThank you for choosing our services.\n\nBest regards,\nLoadMaster Team",
      isActive: true,
      createdAt: new Date(),
    };

    const template3: EmailTemplate = {
      id: randomUUID(),
      name: "Delivery Complete",
      description: "Confirmation sent when delivery is completed",
      trigger: "delivered",
      recipients: "both",
      subject: "Delivery Complete - {{loadNumber}}",
      body: "Hello,\n\nWe're happy to confirm that the delivery has been completed successfully:\n\nLoad Number: {{loadNumber}}\nDelivery Time: {{currentTime}}\nDelivery Address: {{deliveryAddress}}\n\nThank you for your business.\n\nBest regards,\nLoadMaster Team",
      isActive: true,
      createdAt: new Date(),
    };

    this.emailTemplates.set(template1.id, template1);
    this.emailTemplates.set(template2.id, template2);
    this.emailTemplates.set(template3.id, template3);
  }

  // Driver operations
  async getDriver(id: string): Promise<Driver | undefined> {
    return this.drivers.get(id);
  }

  async getAllDrivers(): Promise<Driver[]> {
    return Array.from(this.drivers.values());
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const id = randomUUID();
    const driver: Driver = {
      ...insertDriver,
      id,
      status: insertDriver.status || "available",
      licenseNumber: insertDriver.licenseNumber || null,
      emergencyContact: insertDriver.emergencyContact || null,
      emergencyPhone: insertDriver.emergencyPhone || null,
      isOnboarded: insertDriver.isOnboarded || false,
      telegramId: insertDriver.telegramId || null,
      telegramUsername: insertDriver.telegramUsername || null,
      city: insertDriver.city || null,
      enableTelegramNotifications: insertDriver.enableTelegramNotifications || false,
      createdAt: new Date(),
    };
    this.drivers.set(id, driver);
    return driver;
  }

  async updateDriver(id: string, updates: Partial<InsertDriver>): Promise<Driver | undefined> {
    const driver = this.drivers.get(id);
    if (!driver) return undefined;

    const updatedDriver = { ...driver, ...updates };
    this.drivers.set(id, updatedDriver);
    return updatedDriver;
  }

  async deleteDriver(id: string): Promise<boolean> {
    return this.drivers.delete(id);
  }

  // Customer operations
  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async getAllCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values());
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const customer: Customer = {
      ...insertCustomer,
      id,
      status: insertCustomer.status || "active",
      createdAt: new Date(),
    };
    this.customers.set(id, customer);
    return customer;
  }

  async updateCustomer(id: string, updates: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const customer = this.customers.get(id);
    if (!customer) return undefined;

    const updatedCustomer = { ...customer, ...updates };
    this.customers.set(id, updatedCustomer);
    return updatedCustomer;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    return this.customers.delete(id);
  }

  // Load operations
  async getLoad(id: string): Promise<LoadWithRelations | undefined> {
    const load = this.loads.get(id);
    if (!load) return undefined;

    const customer = this.customers.get(load.customerId);
    const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;

    if (!customer) return undefined;

    return {
      ...load,
      customer,
      driver,
    };
  }

  async getAllLoads(): Promise<LoadWithRelations[]> {
    const loads: LoadWithRelations[] = [];
    
    for (const load of Array.from(this.loads.values())) {
      const customer = this.customers.get(load.customerId);
      const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;
      
      if (customer) {
        loads.push({
          ...load,
          customer,
          driver,
        });
      }
    }
    
    return loads.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createLoad(insertLoad: InsertLoad): Promise<LoadWithRelations> {
    const id = randomUUID();
    const loadNumber = `LM-${new Date().getFullYear()}-${this.loadCounter.toString().padStart(3, '0')}`;
    this.loadCounter++;

    const load: Load = {
      ...insertLoad,
      id,
      loadNumber,
      status: insertLoad.status || "scheduled",
      priority: insertLoad.priority || "standard",
      pickupDate: new Date(insertLoad.pickupDate),
      deliveryDate: new Date(insertLoad.deliveryDate),
      driverId: insertLoad.driverId || null,
      equipmentType: insertLoad.equipmentType || "dry_van",
      temperatureRequired: insertLoad.temperatureRequired || false,
      isExpired: insertLoad.isExpired || false,
      temperatureUnit: insertLoad.temperatureUnit || "F",
      sourceBoard: insertLoad.sourceBoard || "manual",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.loads.set(id, load);

    const customer = this.customers.get(load.customerId);
    const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;

    return {
      ...load,
      customer: customer!,
      driver,
    };
  }

  async updateLoad(id: string, updates: Partial<InsertLoad>): Promise<LoadWithRelations | undefined> {
    const load = this.loads.get(id);
    if (!load) return undefined;

    const updatedLoad: Load = {
      ...load,
      ...updates,
      pickupDate: updates.pickupDate ? new Date(updates.pickupDate) : load.pickupDate,
      deliveryDate: updates.deliveryDate ? new Date(updates.deliveryDate) : load.deliveryDate,
      updatedAt: new Date(),
    };

    this.loads.set(id, updatedLoad);

    const customer = this.customers.get(updatedLoad.customerId);
    if (!customer) return undefined;
    const driver = updatedLoad.driverId ? this.drivers.get(updatedLoad.driverId) || null : null;

    return {
      ...updatedLoad,
      customer: customer!,
      driver,
    };
  }

  async deleteLoad(id: string): Promise<boolean> {
    return this.loads.delete(id);
  }

  async getLoadsByStatus(status: string): Promise<LoadWithRelations[]> {
    const allLoads = await this.getAllLoads();
    return allLoads.filter(load => load.status === status);
  }

  // Email template operations
  async getEmailTemplate(id: string): Promise<EmailTemplate | undefined> {
    return this.emailTemplates.get(id);
  }

  async getAllEmailTemplates(): Promise<EmailTemplate[]> {
    return Array.from(this.emailTemplates.values());
  }

  async createEmailTemplate(insertTemplate: InsertEmailTemplate): Promise<EmailTemplate> {
    const id = randomUUID();
    const template: EmailTemplate = {
      ...insertTemplate,
      id,
      isActive: insertTemplate.isActive !== undefined ? insertTemplate.isActive : true,
      createdAt: new Date(),
    };
    this.emailTemplates.set(id, template);
    return template;
  }

  async updateEmailTemplate(id: string, updates: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined> {
    const template = this.emailTemplates.get(id);
    if (!template) return undefined;

    const updatedTemplate = { ...template, ...updates };
    this.emailTemplates.set(id, updatedTemplate);
    return updatedTemplate;
  }

  async deleteEmailTemplate(id: string): Promise<boolean> {
    return this.emailTemplates.delete(id);
  }

  async getEmailTemplatesByTrigger(trigger: string): Promise<EmailTemplate[]> {
    return Array.from(this.emailTemplates.values()).filter(template => 
      template.trigger === trigger && template.isActive
    );
  }

  // Email log operations
  async getEmailLog(id: string): Promise<EmailLogWithRelations | undefined> {
    const log = this.emailLogs.get(id);
    if (!log) return undefined;

    const load = log.loadId ? await this.getLoad(log.loadId) : undefined;
    const template = log.templateId ? this.emailTemplates.get(log.templateId) : undefined;

    return {
      ...log,
      load,
      template,
    };
  }

  async getAllEmailLogs(): Promise<EmailLogWithRelations[]> {
    const logs: EmailLogWithRelations[] = [];
    
    for (const log of Array.from(this.emailLogs.values())) {
      const load = log.loadId ? await this.getLoad(log.loadId) : undefined;
      const template = log.templateId ? this.emailTemplates.get(log.templateId) : undefined;
      
      logs.push({
        ...log,
        load,
        template,
      });
    }
    
    return logs.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createEmailLog(insertLog: InsertEmailLog): Promise<EmailLog> {
    const id = randomUUID();
    const log: EmailLog = {
      ...insertLog,
      id,
      loadId: insertLog.loadId || null,
      templateId: insertLog.templateId || null,
      errorMessage: insertLog.errorMessage || null,
      sentAt: insertLog.sentAt || null,
      createdAt: new Date(),
    };
    this.emailLogs.set(id, log);
    return log;
  }

  async updateEmailLog(id: string, updates: Partial<InsertEmailLog>): Promise<EmailLog | undefined> {
    const log = this.emailLogs.get(id);
    if (!log) return undefined;

    const updatedLog = { ...log, ...updates };
    this.emailLogs.set(id, updatedLog);
    return updatedLog;
  }

  async getEmailLogsByLoad(loadId: string): Promise<EmailLogWithRelations[]> {
    const allLogs = await this.getAllEmailLogs();
    return allLogs.filter(log => log.loadId === loadId);
  }

  // Onboarding token operations
  async createOnboardingToken(insertToken: InsertOnboardingToken): Promise<OnboardingToken> {
    const id = randomUUID();
    const token: OnboardingToken = {
      ...insertToken,
      id,
      isUsed: insertToken.isUsed || false,
      createdAt: new Date(),
    };
    this.onboardingTokens.set(insertToken.token, token);
    return token;
  }

  async getOnboardingToken(tokenString: string): Promise<OnboardingToken | undefined> {
    return this.onboardingTokens.get(tokenString);
  }

  async getAllOnboardingTokens(): Promise<OnboardingToken[]> {
    return Array.from(this.onboardingTokens.values()).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async markTokenAsUsed(tokenString: string): Promise<boolean> {
    const token = this.onboardingTokens.get(tokenString);
    if (!token) return false;
    
    const updatedToken = { ...token, isUsed: true };
    this.onboardingTokens.set(tokenString, updatedToken);
    return true;
  }

  // Driver location operations
  async createDriverLocation(insertLocation: InsertDriverLocation): Promise<DriverLocation> {
    const id = randomUUID();
    const location: DriverLocation = {
      ...insertLocation,
      id,
      accuracy: insertLocation.accuracy || null,
      speed: insertLocation.speed || null,
      heading: insertLocation.heading || null,
      createdAt: new Date(),
    };
    this.driverLocations.set(id, location);
    return location;
  }

  async getDriverCurrentLocation(driverId: string): Promise<DriverLocation | undefined> {
    const locations = Array.from(this.driverLocations.values())
      .filter(location => location.driverId === driverId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return locations[0];
  }

  async getDriverLocationHistory(driverId: string): Promise<DriverLocation[]> {
    return Array.from(this.driverLocations.values())
      .filter(location => location.driverId === driverId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // Driver onboarding
  async completeDriverOnboarding(data: DriverOnboarding, tokenString: string): Promise<Driver> {
    const token = await this.getOnboardingToken(tokenString);
    if (!token || token.isUsed || new Date(token.expiresAt) < new Date()) {
      throw new Error('Invalid or expired token');
    }

    // Create the driver
    const driverData: InsertDriver = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      status: 'available',
      licenseNumber: data.licenseNumber,
      emergencyContact: data.emergencyContact,
      emergencyPhone: data.emergencyPhone,
    };

    const driver = await this.createDriver(driverData);
    
    // Mark driver as onboarded
    const updatedDriver = { ...driver, isOnboarded: true };
    this.drivers.set(driver.id, updatedDriver);
    
    // Mark token as used
    await this.markTokenAsUsed(tokenString);
    
    return updatedDriver;
  }

  // Scraper configuration operations
  async getScraperConfig(id: string): Promise<ScraperConfig | undefined> {
    return this.scraperConfigs.get(id);
  }

  async getAllScraperConfigs(): Promise<ScraperConfig[]> {
    return Array.from(this.scraperConfigs.values());
  }

  async createScraperConfig(config: InsertScraperConfig): Promise<ScraperConfig> {
    const id = randomUUID();
    const newConfig: ScraperConfig = {
      ...config,
      id,
      type: config.type || "dat",
      schedule: config.schedule || "*/1 * * * * *",
      enabled: config.enabled || false,
      autoCreateLoads: config.autoCreateLoads || true,
      username: config.username || null,
      password: config.password || null,
      searchCriteria: config.searchCriteria || {},
      defaultCustomerId: config.defaultCustomerId || null,
      lastRunAt: config.lastRunAt || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.scraperConfigs.set(id, newConfig);
    return newConfig;
  }

  async updateScraperConfig(id: string, config: Partial<InsertScraperConfig>): Promise<ScraperConfig | undefined> {
    const existing = this.scraperConfigs.get(id);
    if (!existing) return undefined;

    const updated: ScraperConfig = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.scraperConfigs.set(id, updated);
    return updated;
  }

  async deleteScraperConfig(id: string): Promise<boolean> {
    return this.scraperConfigs.delete(id);
  }

  // Scraper log operations
  async getScraperLog(id: string): Promise<ScraperLog | undefined> {
    return this.scraperLogs.get(id);
  }

  async getAllScraperLogs(): Promise<ScraperLog[]> {
    return Array.from(this.scraperLogs.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createScraperLog(log: InsertScraperLog): Promise<ScraperLog> {
    const id = randomUUID();
    const newLog: ScraperLog = {
      ...log,
      id,
      loadsScraped: log.loadsScraped || 0,
      loadsCreated: log.loadsCreated || 0,
      errorMessage: log.errorMessage || null,
      executionTime: log.executionTime || null,
      completedAt: log.completedAt || null,
      metadata: log.metadata || {},
      createdAt: new Date(),
    };
    this.scraperLogs.set(id, newLog);
    return newLog;
  }

  async updateScraperLog(id: string, log: Partial<InsertScraperLog>): Promise<ScraperLog | undefined> {
    const existing = this.scraperLogs.get(id);
    if (!existing) return undefined;

    const updated: ScraperLog = {
      ...existing,
      ...log,
    };
    this.scraperLogs.set(id, updated);
    return updated;
  }

  async getScraperLogsByConfig(configId: string): Promise<ScraperLog[]> {
    return Array.from(this.scraperLogs.values())
      .filter(log => log.configId === configId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  // Telegram bot config operations
  async getTelegramBotConfig(id: string): Promise<TelegramBotConfig | undefined> {
    return this.telegramBotConfigs.get(id);
  }

  async getAllTelegramBotConfigs(): Promise<TelegramBotConfig[]> {
    return Array.from(this.telegramBotConfigs.values());
  }

  async createTelegramBotConfig(config: InsertTelegramBotConfig): Promise<TelegramBotConfig> {
    const id = randomUUID();
    const newConfig: TelegramBotConfig = {
      ...config,
      id,
      botUsername: config.botUsername || null,
      responseTimeoutMinutes: config.responseTimeoutMinutes || 3,
      isActive: config.isActive !== undefined ? config.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.telegramBotConfigs.set(id, newConfig);
    return newConfig;
  }

  async updateTelegramBotConfig(id: string, config: Partial<InsertTelegramBotConfig>): Promise<TelegramBotConfig | undefined> {
    const existing = this.telegramBotConfigs.get(id);
    if (!existing) return undefined;

    const updated: TelegramBotConfig = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.telegramBotConfigs.set(id, updated);
    return updated;
  }

  // Lane preference operations
  async getLanePreference(id: string): Promise<LanePreference | undefined> {
    return this.lanePreferences.get(id);
  }

  async getAllLanePreferences(): Promise<LanePreference[]> {
    return Array.from(this.lanePreferences.values())
      .filter(pref => pref.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createLanePreference(pref: InsertLanePreference): Promise<LanePreference> {
    const id = randomUUID();
    const newPref: LanePreference = {
      ...pref,
      id,
      isActive: pref.isActive !== undefined ? pref.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.lanePreferences.set(id, newPref);
    return newPref;
  }

  async updateLanePreference(id: string, pref: Partial<InsertLanePreference>): Promise<LanePreference | undefined> {
    const existing = this.lanePreferences.get(id);
    if (!existing) return undefined;

    const updated: LanePreference = {
      ...existing,
      ...pref,
      updatedAt: new Date(),
    };
    this.lanePreferences.set(id, updated);
    return updated;
  }

  async deleteLanePreference(id: string): Promise<boolean> {
    return this.lanePreferences.delete(id);
  }

  // Avoid location operations
  async getAvoidLocation(id: string): Promise<AvoidLocation | undefined> {
    return this.avoidLocations.get(id);
  }

  async getAllAvoidLocations(): Promise<AvoidLocation[]> {
    return Array.from(this.avoidLocations.values())
      .filter(loc => loc.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createAvoidLocation(location: InsertAvoidLocation): Promise<AvoidLocation> {
    const id = randomUUID();
    const newLocation: AvoidLocation = {
      ...location,
      id,
      type: location.type || "city",
      isActive: location.isActive !== undefined ? location.isActive : true,
      createdAt: new Date(),
    };
    this.avoidLocations.set(id, newLocation);
    return newLocation;
  }

  async updateAvoidLocation(id: string, location: Partial<InsertAvoidLocation>): Promise<AvoidLocation | undefined> {
    const existing = this.avoidLocations.get(id);
    if (!existing) return undefined;

    const updated: AvoidLocation = {
      ...existing,
      ...location,
    };
    this.avoidLocations.set(id, updated);
    return updated;
  }

  async deleteAvoidLocation(id: string): Promise<boolean> {
    return this.avoidLocations.delete(id);
  }

  // Load offer operations
  async getLoadOffer(id: string): Promise<LoadOffer | undefined> {
    return this.loadOffers.get(id);
  }

  async getAllLoadOffers(): Promise<LoadOffer[]> {
    return Array.from(this.loadOffers.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createLoadOffer(offer: InsertLoadOffer): Promise<LoadOffer> {
    const id = randomUUID();
    const newOffer: LoadOffer = {
      ...offer,
      id,
      status: offer.status || "pending",
      telegramMessageId: offer.telegramMessageId || null,
      respondedAt: offer.respondedAt || null,
      createdAt: new Date(),
    };
    this.loadOffers.set(id, newOffer);
    return newOffer;
  }

  async updateLoadOffer(id: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined> {
    const existing = this.loadOffers.get(id);
    if (!existing) return undefined;

    const updated: LoadOffer = {
      ...existing,
      ...offer,
    };
    this.loadOffers.set(id, updated);
    return updated;
  }

  async getLoadOfferByLoadAndDriver(loadId: string, driverId: string): Promise<LoadOffer | undefined> {
    return Array.from(this.loadOffers.values())
      .find(offer => offer.loadId === loadId && offer.driverId === driverId);
  }

  async updateLoadOfferByLoadAndDriver(loadId: string, driverId: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined> {
    const existing = await this.getLoadOfferByLoadAndDriver(loadId, driverId);
    if (!existing) return undefined;

    const updated: LoadOffer = {
      ...existing,
      ...offer,
    };
    this.loadOffers.set(existing.id, updated);
    return updated;
  }

  // Driver telegram operations
  async getDriverByTelegramId(telegramId: string): Promise<Driver | undefined> {
    return Array.from(this.drivers.values())
      .find(driver => driver.telegramId === telegramId);
  }

  async getDriversWithTelegramEnabled(): Promise<Driver[]> {
    return Array.from(this.drivers.values())
      .filter(driver => driver.telegramId && driver.enableTelegramNotifications);
  }
}

export const storage = new MemStorage();
