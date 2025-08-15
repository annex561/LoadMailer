import { type Driver, type InsertDriver, type Customer, type InsertCustomer, type Load, type InsertLoad, type LoadWithRelations, type EmailTemplate, type InsertEmailTemplate, type EmailLog, type InsertEmailLog, type EmailLogWithRelations } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private drivers: Map<string, Driver> = new Map();
  private customers: Map<string, Customer> = new Map();
  private loads: Map<string, Load> = new Map();
  private emailTemplates: Map<string, EmailTemplate> = new Map();
  private emailLogs: Map<string, EmailLog> = new Map();
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
      createdAt: new Date(),
    };
    
    const driver2: Driver = {
      id: randomUUID(),
      name: "Sarah Williams",
      email: "sarah.williams@company.com",
      phone: "(555) 987-6543",
      status: "on_route",
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
      pickupDate: new Date(insertLoad.pickupDate),
      deliveryDate: new Date(insertLoad.deliveryDate),
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
}

export const storage = new MemStorage();
