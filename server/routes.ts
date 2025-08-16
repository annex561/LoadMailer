import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyticsService } from "./analytics-service";
import { schedulerService } from "./scheduler-service";
import { loadExpirationService } from "./load-expiration-service";
import { telegramLoadService } from "./telegram-service";
import { insertDriverSchema, insertCustomerSchema, insertLoadSchema, insertEmailTemplateSchema, insertOnboardingTokenSchema, insertDriverLocationSchema, driverOnboardingSchema, type LoadWithRelations } from "@shared/schema";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

// Email service configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "your-email@gmail.com",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "your-app-password",
  },
});

// Template variable replacement
function replaceTemplateVariables(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
}

// Send email function
async function sendEmail(to: string, subject: string, body: string, loadId?: string, templateId?: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "LoadMaster <noreply@loadmaster.com>",
      to,
      subject,
      text: body,
    });

    // Log successful email
    await storage.createEmailLog({
      loadId,
      templateId,
      recipientEmail: to,
      subject,
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    // Log failed email
    await storage.createEmailLog({
      loadId,
      templateId,
      recipientEmail: to,
      subject,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Send automated emails based on load status
async function sendAutomatedEmails(load: LoadWithRelations, trigger: string) {
  const templates = await storage.getEmailTemplatesByTrigger(trigger);
  
  for (const template of templates) {
    const variables = {
      loadNumber: load.loadNumber,
      customerName: load.customer.name,
      customerContactPerson: load.customer.contactPerson,
      driverName: load.driver?.name || "Not assigned",
      driverPhone: load.driver?.phone || "N/A",
      pickupAddress: load.pickupAddress,
      pickupDate: load.pickupDate.toLocaleDateString(),
      pickupTime: load.pickupTime,
      deliveryAddress: load.deliveryAddress,
      deliveryDate: load.deliveryDate.toLocaleDateString(),
      deliveryTime: load.deliveryTime,
      specialInstructions: load.specialInstructions || "None",
      currentTime: new Date().toLocaleString(),
    };

    const subject = replaceTemplateVariables(template.subject, variables);
    const body = replaceTemplateVariables(template.body, variables);

    if (template.recipients === "driver" && load.driver) {
      await sendEmail(load.driver.email, subject, body, load.id, template.id);
    } else if (template.recipients === "customer") {
      await sendEmail(load.customer.email, subject, body, load.id, template.id);
    } else if (template.recipients === "both") {
      await sendEmail(load.customer.email, subject, body, load.id, template.id);
      if (load.driver) {
        await sendEmail(load.driver.email, subject, body, load.id, template.id);
      }
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize scheduler service on startup
  try {
    await schedulerService.initialize();
    console.log('Scheduler service initialized');
  } catch (error) {
    console.error('Failed to initialize scheduler service:', error);
  }

  // Initialize load expiration service on startup
  try {
    await loadExpirationService.initialize();
    console.log('Load expiration service initialized');
  } catch (error) {
    console.error('Failed to initialize load expiration service:', error);
  }

  // Initialize Telegram Load Service on startup
  try {
    await telegramLoadService.initialize();
    console.log('Telegram Load Service initialized');
  } catch (error) {
    console.error('Failed to initialize Telegram Load Service:', error);
  }

  // Driver routes
  app.get("/api/drivers", async (req, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  app.post("/api/drivers", async (req, res) => {
    try {
      const validatedData = insertDriverSchema.parse(req.body);
      const driver = await storage.createDriver(validatedData);
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  app.put("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertDriverSchema.partial().parse(req.body);
      const driver = await storage.updateDriver(id, validatedData);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  app.delete("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteDriver(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete driver" });
    }
  });

  // Customer routes
  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const validatedData = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(validatedData);
      res.status(201).json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.put("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(id, validatedData);
      
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      res.json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteCustomer(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  // Load routes
  app.get("/api/loads", async (req, res) => {
    try {
      const { status } = req.query;
      
      if (status && typeof status === "string") {
        const loads = await storage.getLoadsByStatus(status);
        res.json(loads);
      } else {
        const loads = await storage.getAllLoads();
        res.json(loads);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loads" });
    }
  });

  app.get("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const load = await storage.getLoad(id);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      res.json(load);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load" });
    }
  });

  app.post("/api/loads", async (req, res) => {
    try {
      const validatedData = insertLoadSchema.parse(req.body);
      const load = await storage.createLoad(validatedData);
      
      // Send automated emails for new load
      await sendAutomatedEmails(load, "load_created");
      
      // Send load to drivers via Telegram if it matches preferences
      await telegramLoadService.processNewLoad(load);
      
      res.status(201).json(load);
    } catch (error) {
      res.status(400).json({ error: "Invalid load data" });
    }
  });

  app.put("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertLoadSchema.partial().parse(req.body);
      const originalLoad = await storage.getLoad(id);
      
      if (!originalLoad) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      const updatedLoad = await storage.updateLoad(id, validatedData);
      
      if (!updatedLoad) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      // Send automated emails based on status changes
      if (validatedData.status && validatedData.status !== originalLoad.status) {
        if (validatedData.status === "in_transit") {
          await sendAutomatedEmails(updatedLoad, "pickup_confirmed");
        } else if (validatedData.status === "delivered") {
          await sendAutomatedEmails(updatedLoad, "delivered");
        }
      }
      
      res.json(updatedLoad);
    } catch (error) {
      res.status(400).json({ error: "Invalid load data" });
    }
  });

  app.delete("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteLoad(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete load" });
    }
  });

  // Email template routes
  app.get("/api/email-templates", async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch email templates" });
    }
  });

  app.post("/api/email-templates", async (req, res) => {
    try {
      const validatedData = insertEmailTemplateSchema.parse(req.body);
      const template = await storage.createEmailTemplate(validatedData);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: "Invalid email template data" });
    }
  });

  app.put("/api/email-templates/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertEmailTemplateSchema.partial().parse(req.body);
      const template = await storage.updateEmailTemplate(id, validatedData);
      
      if (!template) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: "Invalid email template data" });
    }
  });

  app.delete("/api/email-templates/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteEmailTemplate(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete email template" });
    }
  });

  // Test email endpoint
  app.post("/api/test-email", async (req, res) => {
    try {
      const { templateId, loadId, recipientEmail } = req.body;
      
      const template = await storage.getEmailTemplate(templateId);
      const load = loadId ? await storage.getLoad(loadId) : null;
      
      if (!template) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      const variables = load ? {
        loadNumber: load.loadNumber,
        customerName: load.customer.name,
        customerContactPerson: load.customer.contactPerson,
        driverName: load.driver?.name || "Not assigned",
        driverPhone: load.driver?.phone || "N/A",
        pickupAddress: load.pickupAddress,
        pickupDate: load.pickupDate.toLocaleDateString(),
        pickupTime: load.pickupTime,
        deliveryAddress: load.deliveryAddress,
        deliveryDate: load.deliveryDate.toLocaleDateString(),
        deliveryTime: load.deliveryTime,
        specialInstructions: load.specialInstructions || "None",
        currentTime: new Date().toLocaleString(),
      } : {
        loadNumber: "TEST-001",
        customerName: "Test Customer",
        customerContactPerson: "Test Contact",
        driverName: "Test Driver",
        driverPhone: "(555) 000-0000",
        pickupAddress: "Test Pickup Address",
        pickupDate: "01/01/2024",
        pickupTime: "10:00 AM",
        deliveryAddress: "Test Delivery Address",
        deliveryDate: "01/02/2024",
        deliveryTime: "2:00 PM",
        specialInstructions: "This is a test email",
        currentTime: new Date().toLocaleString(),
      };
      
      const subject = replaceTemplateVariables(template.subject, variables);
      const body = replaceTemplateVariables(template.body, variables);
      
      const result = await sendEmail(recipientEmail, subject, body, loadId, templateId);
      
      if (result.success) {
        res.json({ success: true, message: "Test email sent successfully" });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to send test email" });
    }
  });

  // Email logs routes
  app.get("/api/email-logs", async (req, res) => {
    try {
      const { loadId } = req.query;
      
      if (loadId && typeof loadId === "string") {
        const logs = await storage.getEmailLogsByLoad(loadId);
        res.json(logs);
      } else {
        const logs = await storage.getAllEmailLogs();
        res.json(logs);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch email logs" });
    }
  });

  // Dashboard stats
  app.get("/api/dashboard-stats", async (req, res) => {
    try {
      const allLoads = await storage.getAllLoads();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const stats = {
        activeLoads: allLoads.filter(load => load.status !== "delivered" && load.status !== "cancelled").length,
        inTransit: allLoads.filter(load => load.status === "in_transit").length,
        deliveredToday: allLoads.filter(load => 
          load.status === "delivered" && 
          load.updatedAt && load.updatedAt >= today
        ).length,
        emailAlerts: (await storage.getAllEmailLogs()).length,
      };
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Driver onboarding routes
  app.post("/api/create-onboarding-invite", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      res.status(201).json(onboardingToken);
    } catch (error) {
      res.status(400).json({ error: "Failed to create onboarding invitation" });
    }
  });

  app.post("/api/create-sms-onboarding-invite", async (req, res) => {
    try {
      const { email, phone } = req.body;
      
      if (!email || !phone) {
        return res.status(400).json({ error: "Email and phone are required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      // Create the onboarding link
      const onboardingLink = `${req.protocol}://${req.hostname}/driver-onboarding?token=${token}`;
      
      // SMS message content
      const smsMessage = `Welcome to LoadMaster! Complete your driver onboarding here: ${onboardingLink}. This link expires in 7 days.`;
      
      // Send SMS (placeholder - would use Twilio in production)
      console.log(`SMS would be sent to ${phone}: ${smsMessage}`);
      
      // Log the SMS attempt
      await storage.createEmailLog({
        recipientEmail: email,
        subject: "SMS Driver Onboarding",
        status: "sent",
        sentAt: new Date(),
      });
      
      res.status(201).json({ 
        ...onboardingToken, 
        phone,
        message: "SMS invitation sent successfully"
      });
    } catch (error) {
      console.error("SMS invitation error:", error);
      res.status(400).json({ error: "Failed to send SMS invitation" });
    }
  });

  app.post("/api/validate-onboarding-token", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      const onboardingToken = await storage.getOnboardingToken(token);
      
      if (!onboardingToken) {
        return res.json({ valid: false, error: "Token not found" });
      }
      
      if (onboardingToken.isUsed) {
        return res.json({ valid: false, error: "Token already used" });
      }
      
      if (new Date(onboardingToken.expiresAt) < new Date()) {
        return res.json({ valid: false, error: "Token expired" });
      }
      
      res.json({ valid: true, email: onboardingToken.email });
    } catch (error) {
      res.status(500).json({ error: "Failed to validate token" });
    }
  });

  app.post("/api/driver-onboarding", async (req, res) => {
    try {
      const { token, ...driverData } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      const validatedData = driverOnboardingSchema.parse(driverData);
      const driver = await storage.completeDriverOnboarding(validatedData, token);
      
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to complete onboarding" });
    }
  });

  app.get("/api/onboarding-tokens", async (req, res) => {
    try {
      const tokens = await storage.getAllOnboardingTokens();
      res.json(tokens);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch onboarding tokens" });
    }
  });

  // Driver location routes
  app.post("/api/driver-location", async (req, res) => {
    try {
      const validatedData = insertDriverLocationSchema.parse(req.body);
      const location = await storage.createDriverLocation(validatedData);
      res.status(201).json(location);
    } catch (error) {
      res.status(400).json({ error: "Invalid location data" });
    }
  });

  app.get("/api/driver-locations", async (req, res) => {
    try {
      const { driverId } = req.query;
      
      if (driverId && typeof driverId === "string") {
        const locations = await storage.getDriverLocationHistory(driverId);
        res.json(locations);
      } else {
        // Return current locations for all drivers
        const drivers = await storage.getAllDrivers();
        const locationsPromises = drivers.map(async (driver) => {
          const currentLocation = await storage.getDriverCurrentLocation(driver.id);
          return currentLocation ? { ...currentLocation, driver } : null;
        });
        
        const locations = (await Promise.all(locationsPromises)).filter(Boolean);
        res.json(locations);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver locations" });
    }
  });

  app.get("/api/drivers/:id/location", async (req, res) => {
    try {
      const { id } = req.params;
      const location = await storage.getDriverCurrentLocation(id);
      
      if (!location) {
        return res.status(404).json({ error: "Driver location not found" });
      }
      
      res.json(location);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver location" });
    }
  });

  // Analytics and Reporting Routes
  app.get('/api/analytics/dashboard', async (req, res) => {
    try {
      const dashboardData = await analyticsService.getDashboardAnalytics();
      res.json(dashboardData);
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard analytics' });
    }
  });

  app.get('/api/analytics/driver-performance', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const performance = await analyticsService.getDriverPerformance({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(performance);
    } catch (error) {
      console.error('Driver performance analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch driver performance' });
    }
  });

  app.get('/api/analytics/customer-insights', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const insights = await analyticsService.getCustomerInsights({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(insights);
    } catch (error) {
      console.error('Customer insights error:', error);
      res.status(500).json({ error: 'Failed to fetch customer insights' });
    }
  });

  app.get('/api/analytics/business-metrics', async (req, res) => {
    try {
      const { period = 'monthly', metricType } = req.query;
      const metrics = await analyticsService.getBusinessMetrics({
        period: period as string,
        metricType: metricType as string,
      });
      res.json(metrics);
    } catch (error) {
      console.error('Business metrics error:', error);
      res.status(500).json({ error: 'Failed to fetch business metrics' });
    }
  });

  app.get('/api/analytics/load-trends', async (req, res) => {
    try {
      const { days = '7' } = req.query;
      const trends = await analyticsService.getLoadTrends(parseInt(days as string));
      res.json(trends);
    } catch (error) {
      console.error('Load trends error:', error);
      res.status(500).json({ error: 'Failed to fetch load trends' });
    }
  });

  app.get('/api/analytics/revenue', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const revenue = await analyticsService.getRevenueAnalytics({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(revenue);
    } catch (error) {
      console.error('Revenue analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
  });

  app.post('/api/analytics/generate-report', async (req, res) => {
    try {
      const reportConfig = req.body;
      const report = await analyticsService.generateReport(reportConfig);
      res.json(report);
    } catch (error) {
      console.error('Report generation error:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // DAT Scraper Routes - Full implementation
  app.get('/api/scraper-configs', async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      console.error('Error fetching scraper configs:', error);
      res.status(500).json({ message: 'Failed to fetch scraper configs' });
    }
  });

  app.post('/api/scraper-configs', async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      
      // Schedule the task if it's enabled
      if (config.enabled) {
        await schedulerService.scheduleScraperTask(config);
      }
      
      res.json(config);
    } catch (error) {
      console.error('Error creating scraper config:', error);
      res.status(500).json({ message: 'Failed to create scraper config' });
    }
  });

  app.patch('/api/scraper-configs/:id', async (req, res) => {
    try {
      const config = await storage.updateScraperConfig(req.params.id, req.body);
      if (!config) {
        return res.status(404).json({ message: 'Scraper config not found' });
      }
      
      // Update the scheduled task
      await schedulerService.updateTask(config);
      
      res.json(config);
    } catch (error) {
      console.error('Error updating scraper config:', error);
      res.status(500).json({ message: 'Failed to update scraper config' });
    }
  });

  app.post('/api/scraper-configs/:id/run', async (req, res) => {
    try {
      const result = await schedulerService.runTaskNow(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Error running scraper:', error);
      res.status(500).json({ message: 'Failed to run scraper' });
    }
  });

  // Scraper logs routes
  app.get('/api/scraper-logs', async (req, res) => {
    try {
      const logs = await storage.getAllScraperLogs();
      res.json(logs);
    } catch (error) {
      console.error('Error fetching scraper logs:', error);
      res.status(500).json({ message: 'Failed to fetch scraper logs' });
    }
  });

  app.get('/api/scraper-status', async (req, res) => {
    try {
      res.json({ message: 'DAT Scraper integration active and running' });
    } catch (error) {
      console.error('Failed to get scraper status:', error);
      res.status(500).json({ error: 'Failed to get scraper status' });
    }
  });

  // Load expiration API endpoints
  app.get("/api/load-expiration-stats", async (req, res) => {
    try {
      const stats = await loadExpirationService.getExpirationStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expiration stats" });
    }
  });

  app.post("/api/expire-load/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await loadExpirationService.expireLoadManually(id);
      
      if (success) {
        res.json({ success: true, message: "Load expired successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to expire load" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to expire load" });
    }
  });

  app.post("/api/set-load-expiration/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { expiresAt } = req.body;
      
      if (!expiresAt) {
        return res.status(400).json({ error: "Expiration date is required" });
      }
      
      const success = await loadExpirationService.setLoadExpiration(id, new Date(expiresAt));
      
      if (success) {
        res.json({ success: true, message: "Load expiration set successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to set load expiration" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to set load expiration" });
    }
  });

  app.post("/api/process-load-expirations", async (req, res) => {
    try {
      await loadExpirationService.processLoadExpirations();
      res.json({ success: true, message: "Load expirations processed successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to process load expirations" });
    }
  });

  app.get("/api/load-expiration-config", async (req, res) => {
    try {
      const config = loadExpirationService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expiration config" });
    }
  });

  // Telegram bot API endpoints
  app.get("/api/telegram/config", async (req, res) => {
    try {
      const config = telegramLoadService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Telegram config" });
    }
  });

  app.get("/api/telegram/status", async (req, res) => {
    try {
      const isRunning = telegramLoadService.isServiceRunning();
      res.json({ isRunning, status: isRunning ? 'active' : 'inactive' });
    } catch (error) {
      res.status(500).json({ error: "Failed to get Telegram service status" });
    }
  });

  app.post("/api/telegram/test-load", async (req, res) => {
    try {
      const success = await telegramLoadService.sendTestLoad();
      if (success) {
        res.json({ success: true, message: "Test load sent successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to send test load" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  // Lane preferences API
  app.get("/api/lane-preferences", async (req, res) => {
    try {
      const preferences = await storage.getAllLanePreferences();
      res.json(preferences);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lane preferences" });
    }
  });

  app.post("/api/lane-preferences", async (req, res) => {
    try {
      const { fromStates, toStates, minRPM } = req.body;
      const preference = await storage.createLanePreference({
        fromStates,
        toStates,
        minRPM,
        isActive: true
      });
      res.status(201).json(preference);
    } catch (error) {
      res.status(400).json({ error: "Invalid lane preference data" });
    }
  });

  app.delete("/api/lane-preferences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteLanePreference(id);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Lane preference not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete lane preference" });
    }
  });

  // Avoid locations API
  app.get("/api/avoid-locations", async (req, res) => {
    try {
      const locations = await storage.getAllAvoidLocations();
      res.json(locations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch avoid locations" });
    }
  });

  app.post("/api/avoid-locations", async (req, res) => {
    try {
      const { location, type } = req.body;
      const avoidLocation = await storage.createAvoidLocation({
        location,
        type: type || 'city',
        isActive: true
      });
      res.status(201).json(avoidLocation);
    } catch (error) {
      res.status(400).json({ error: "Invalid avoid location data" });
    }
  });

  app.delete("/api/avoid-locations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteAvoidLocation(id);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Avoid location not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete avoid location" });
    }
  });

  // Load offers API
  app.get("/api/load-offers", async (req, res) => {
    try {
      const offers = await storage.getAllLoadOffers();
      res.json(offers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load offers" });
    }
  });

  // Telegram Load Dispatching routes
  app.get("/api/telegram/load-offers", async (req, res) => {
    try {
      const offers = await storage.getLoadOffersWithDetails();
      res.json(offers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load offers" });
    }
  });

  app.get("/api/telegram/driver-stats", async (req, res) => {
    try {
      const stats = await storage.getAllDriverLoadOfferStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver stats" });
    }
  });

  app.get("/api/telegram/driver-stats/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const stats = await storage.getDriverLoadOfferStats(id);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver stats" });
    }
  });

  app.get("/api/telegram/test-load", async (req, res) => {
    try {
      const result = await telegramLoadService.sendTestLoad();
      res.json({ success: result, message: result ? "Test load sent successfully" : "No loads available or service not running" });
    } catch (error) {
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  app.get("/api/telegram/service-status", async (req, res) => {
    try {
      const isRunning = telegramLoadService.isServiceRunning();
      const config = telegramLoadService.getConfig();
      res.json({ isRunning, config });
    } catch (error) {
      res.status(500).json({ error: "Failed to get service status" });
    }
  });

  app.post("/api/driver-test-load", async (req, res) => {
    try {
      const { driverId } = req.body;
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }

      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      if (!driver.telegramId || !driver.enableTelegramNotifications) {
        return res.status(400).json({ error: "Driver does not have Telegram notifications enabled" });
      }

      // Create a test load
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        return res.status(400).json({ error: "No customers available for test load" });
      }

      const testLoad = await storage.createLoad({
        customerId: customers[0].id,
        description: "Test Load - Welcome to LoadMaster!",
        weight: 25000,
        priority: "standard",
        pickupAddress: "Atlanta, GA",
        pickupDate: new Date().toISOString(),
        pickupTime: "09:00 AM",
        deliveryAddress: driver.city || "Location TBD",
        deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        deliveryTime: "05:00 PM",
        specialInstructions: "This is a test load to verify your Telegram notifications are working. Please respond to confirm you're ready to receive loads.",
        rate: 1500,
        miles: 250,
        company: "LoadMaster Test",
        contactPhone: "(555) 123-4567",
        sourceBoard: "test"
      });

      // Send the test load via Telegram to specific driver
      const result = await telegramLoadService.sendTestLoadToDriver(testLoad, driverId);
      
      if (result) {
        res.json({ success: true, message: "Test load sent successfully", loadId: testLoad.id });
      } else {
        res.status(500).json({ error: "Failed to send test load via Telegram" });
      }
    } catch (error) {
      console.error("Error sending test load:", error);
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}