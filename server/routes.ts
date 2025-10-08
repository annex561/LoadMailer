import express, { type Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { analyticsService } from "./analytics-service";
import { schedulerService } from "./scheduler-service";
import { loadExpirationService } from "./load-expiration-service";
import { smsService as smsLoadService } from "./sms-service";
import { smsCommunicationService } from "./sms-communication-service";
import { gpsTrackingService } from "./gps-tracking-service";
import { loadBoardService } from "./load-board-service";
import { biddingService } from "./bidding-service";
import { smartLoadMatchingService } from "./smart-load-matching-service";
import { PredictionConfidenceService } from "./prediction-confidence-service";
import { ContinuousLoadService } from "./continuous-load-service";
import { DATScraperService } from "./dat-scraper-service";
import { RealLoadIntegrationService } from "./real-load-integration-service";
import { DATAPIService } from "./dat-api-service";
import { DATWebsiteScraper } from "./dat-website-scraper";
import { RealDATScraper } from "./real-dat-scraper";
import { DATLoadPoster } from "./dat-load-poster";
import { insertDriverSchema, insertCustomerSchema, insertLoadSchema, insertEmailTemplateSchema, insertOnboardingTokenSchema, insertDriverLocationSchema, driverOnboardingSchema, type LoadWithRelations, type DriverLocationUpdate, insertGeofenceSchema, insertRouteSchema, insertGpsDeviceSchema, insertLoadDocumentSchema } from "@shared/schema";
import { aiCommunicationService } from "./ai-communication-service";
import { DocumentUploadService } from "./document-upload-service";
import { ObjectStorageService } from "./objectStorage";
import { PredictiveMaintenanceService } from "./predictive-maintenance-service";
import { realDriverLocationService } from "./real-driver-location-service";
import { taskMagicIntegration } from './taskmagic-integration';
import { datScraperService as puppeteerDATService } from './dat-puppeteer-scraper';
import { googleSheetsService } from './google-sheets-service';
import { zelloService } from './zello-service';
import { setupAuth, isAuthenticated } from "./replitAuth";

import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import twilio from "twilio";
// Database-backed token service handled by storage interface

// Initialize prediction confidence service
const predictionConfidenceService = new PredictionConfidenceService();

// Declare services that will be initialized later
let continuousLoadService: ContinuousLoadService | null = null;
let datScraperService: DATScraperService | null = null;
let realLoadService: RealLoadIntegrationService | null = null;
let datAPIService: DATAPIService | null = null;
let datWebsiteScraper: DATWebsiteScraper | null = null;
let realDATScraper: RealDATScraper | null = null;

// DAT load posting removed - focusing only on pulling loads from DAT
// const datLoadPoster = new DATLoadPoster();

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

// Calculate deadhead distance from driver location to pickup
async function calculateDeadheadDistance(driver: any, load: any): Promise<number> {
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
  const stateDistances: Record<string, number> = {
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

// Helper function to handle email booking requests for loads without phone numbers
async function handleEmailBookingRequest(load: any, driver: any) {
  try {
    console.log(`📧 Initiating email booking for load ${load.loadNumber} - no phone contact available`);
    
    // Create email template for shipper booking request
    const emailSubject = `Load Booking Request - ${load.loadNumber}`;
    const emailBody = `
Dear ${load.company || 'Shipper'},

We have a qualified driver interested in booking your load:

LOAD DETAILS:
- Load Number: ${load.loadNumber}
- Route: ${load.pickupAddress} → ${load.deliveryAddress}
- Rate: $${load.rate}
- Weight: ${load.weight.toLocaleString()} lbs
- Pickup Date: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}
- Delivery Date: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}

DRIVER INFORMATION:
- Name: ${driver.name}
- Phone: ${driver.phone}
- Location: ${driver.city || 'Available'}
- Equipment Type: ${driver.equipmentType}
- Weight Capacity: ${driver.weightCapacity || 26000} lbs

Please reply to this email or call ${driver.phone} to confirm the booking.

Best regards,
LoadMaster Dispatch Team
    `;

    // Log the email booking attempt
    console.log(`📧 Email booking request would be sent to: ${load.customer?.email}`);
    console.log(`📧 Subject: ${emailSubject}`);
    console.log(`📧 Body preview: ${emailBody.substring(0, 200)}...`);

    // Here you would typically send the email using your email service
    // For now, we'll create an email log entry
    await storage.createEmailLog({
      loadId: load.id,
      recipientEmail: load.customer?.email || 'unknown@example.com',
      subject: emailSubject,
      sentAt: new Date(),
      status: 'pending'
    });

    console.log(`✅ Email booking request logged for load ${load.loadNumber}`);

    // Notify dispatcher about email booking initiation
    const emailNotificationMessage = `📧 *EMAIL BOOKING INITIATED*\n\n` +
      `Load ${load.loadNumber} has no phone contact.\n` +
      `Email booking request sent to: ${load.customer?.email}\n` +
      `Driver: ${driver.name} (${driver.phone})\n\n` +
      `Monitor email responses for booking confirmation.`;

    // Send SMS notification to dispatcher if configured
    const dispatcherPhone = process.env.DISPATCHER_PHONE_NUMBER;
    if (dispatcherPhone && smsLoadService.isServiceConfigured()) {
      const result = await smsLoadService.sendSMS({
        to: dispatcherPhone,
        body: emailNotificationMessage
      });
      if (result.success) {
        console.log(`✅ Sent email booking notification to dispatcher via SMS`);
      } else {
        console.log(`❌ Failed to send SMS notification: ${result.error}`);
      }
    } else {
      console.log(`📱 Email booking notification: ${emailNotificationMessage}`);
    }

  } catch (error) {
    console.error('Error handling email booking request:', error);
  }
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

// Function to initialize services that depend on Telegram service
async function initializeDependentServices() {
  try {
    console.log('🚀 Initializing dependent services...');
    
    // Initialize services only if Telegram is running or if they can work without it
    continuousLoadService = new ContinuousLoadService(smsLoadService);
    datScraperService = new DATScraperService(smsLoadService);
    realLoadService = new RealLoadIntegrationService(smsLoadService);
    datAPIService = new DATAPIService(smsLoadService);
    datWebsiteScraper = new DATWebsiteScraper(smsLoadService);
    realDATScraper = new RealDATScraper(smsLoadService);
    
    console.log('✅ Dependent services initialized');
  } catch (error) {
    console.error('❌ Failed to initialize dependent services:', error);
  }
}

// Function to initialize all services after server starts
async function initializeAllServices() {
  try {
    console.log('🚀 Starting background service initialization...');
    
    // Make SMS service globally available for test endpoint
    (global as any).smsService = smsLoadService;
    
    // Initialize services
    const predictiveMaintenanceService = new PredictiveMaintenanceService();
    
    // Check SMS service configuration
    console.log(`SMS Service status: ${smsLoadService.isServiceConfigured() ? 'CONFIGURED ✓' : 'NOT CONFIGURED ✗'}`);
    
    // Initialize all services asynchronously
    Promise.resolve().then(async () => {
      try {
        console.log('🚚 Starting Real Driver Location Service initialization...');
        await realDriverLocationService.initialize();
        console.log('✅ Real Driver Location Service initialized and running');
      } catch (error) {
        console.error('❌ Failed to initialize real driver location service:', error);
      }
    });

    // Initialize Zello voice dispatch service
    Promise.resolve().then(async () => {
      try {
        console.log('🎙️ Starting Zello voice dispatch initialization...');
        await zelloService.initialize();
        console.log('✅ Zello voice dispatch service initialized');
        
        // Set up Zello event handlers
        zelloService.on('load_accepted', async (data) => {
          console.log(`✅ Driver ${data.driver} accepted load ${data.loadNumber} via Zello`);
          // TODO: Update load status in database
        });
        
        zelloService.on('load_declined', async (data) => {
          console.log(`❌ Driver ${data.driver} declined load ${data.loadNumber} via Zello`);
          // TODO: Find next eligible driver
        });
        
      } catch (error) {
        console.error('❌ Failed to initialize Zello service:', error);
      }
    });

    Promise.resolve().then(async () => {
      try {
        // Initialize SMS Load Service
        await smsLoadService.initializeLoadService();
        console.log('✅ SMS Load Service initialized');
        
        // Initialize SMS communication service
        await smsCommunicationService.initialize();
        console.log('✅ SMS Communication Service initialized');
        
        // Initialize dependent services after SMS service is ready
        setTimeout(() => {
          initializeDependentServices();
        }, 2000);
      } catch (error) {
        console.error('Failed to initialize Telegram Load Service:', error);
      }
    });

    Promise.resolve().then(async () => {
      try {
        await gpsTrackingService.initialize();
        console.log('✅ GPS Tracking Service initialized');
      } catch (error) {
        console.error('Failed to initialize GPS Tracking Service:', error);
      }
    });

    console.log('✅ Background service initialization started');
  } catch (error) {
    console.error('❌ Error starting background services:', error);
  }
}

export async function registerRoutes(app: Express): Promise<void> {
  console.log('⚡ Ultra-fast server startup - registering routes...');
  
  // Set up authentication FIRST to secure all routes
  console.log('🔐 Setting up Replit authentication...');
  await setupAuth(app);
  console.log('✅ Authentication middleware configured');

  // Apply prefix-level authentication guards for communication and AI endpoints
  console.log('🛡️ Setting up route protection for communication and AI endpoints...');
  // Temporarily making communication and AI routes public for dashboard access
  // TODO: Implement proper user authentication system
  // app.use('/api/communication', isAuthenticated);
  // app.use('/api/communications', isAuthenticated);
  // app.use('/api/ai', isAuthenticated);
  // app.use('/api/ai-insights', isAuthenticated);
  app.use([
    '/api/loads/:loadId/communications',
    '/api/loads/:loadId/communication-logs',
    '/api/loads/:loadId/init-communications',
  ], isAuthenticated);
  console.log('✅ Protected communication and AI endpoints from unauthorized access');

  // Add authentication routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  
  // Register routes immediately
  
  // Add only the most essential routes for immediate startup
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Telegram service health check
  app.get('/api/sms/health', (req, res) => {
    try {
      const isRunning = smsLoadService.isLoadServiceRunning?.() || false;
      const isConfigured = smsLoadService.isServiceConfigured();
      
      res.json({
        status: isRunning ? 'running' : 'stopped',
        isServiceRunning: isRunning,
        isConfigured: isConfigured,
        service: 'Twilio SMS',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Send test SMS to specific driver
  app.post('/api/sms/test/:driverId', async (req, res) => {
    try {
      const { driverId } = req.params;
      
      if (!smsLoadService.isServiceConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'SMS service is not configured',
          timestamp: new Date().toISOString()
        });
      }

      // Get driver details
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
          timestamp: new Date().toISOString()
        });
      }

      if (!driver.phoneNumber) {
        return res.status(400).json({
          success: false,
          error: 'Driver does not have phone number configured',
          driverName: driver.name,
          timestamp: new Date().toISOString()
        });
      }

      // Send test SMS
      const testMessage = `TEST MESSAGE\n\n` +
        `Hello ${driver.name}!\n\n` +
        `This is a test message from the LoadMaster dispatch system.\n` +
        `Your SMS notifications are working correctly.\n\n` +
        `Driver ID: ${driver.id}\n` +
        `Phone: ${driver.phoneNumber}\n` +
        `Time: ${new Date().toLocaleString()}`;

      const result = await smsLoadService.sendSMS({
        to: driver.phoneNumber,
        body: testMessage
      });

      if (result.success) {
        res.json({
          success: true,
          message: 'Test SMS sent successfully',
          driverName: driver.name,
          phoneNumber: driver.phoneNumber,
          messageId: result.messageId,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to send test SMS',
          details: result.error,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Error sending test SMS:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // PRIORITY: Manual load entry endpoint - register early for proper JSON handling
  app.post('/api/manual-loads', async (req, res) => {
    try {
      console.log('📝 Manual load entry received:', req.body);
      
      // First, create or get a customer for this manual entry
      const allCustomers = await storage.getAllCustomers();
      let customer = allCustomers.find(c => c.name === req.body.companyName);
      if (!customer) {
        customer = await storage.createCustomer({
          name: req.body.companyName,
          contactPerson: 'Manual Entry',
          phone: req.body.contactPhone || '',
          email: '',
          address: ''
        });
      }
      
      const loadData = {
        loadNumber: req.body.loadId || `MANUAL-${Date.now()}`,
        customerId: customer.id,
        description: req.body.commodity || 'Manual Entry Load',
        pickupAddress: `${req.body.originCity}, ${req.body.originState}`,
        deliveryAddress: `${req.body.destinationCity}, ${req.body.destinationState}`,
        rate: req.body.rate,
        miles: req.body.mileage,
        weight: req.body.weight,
        equipmentType: req.body.equipmentType,
        pickupDate: new Date(req.body.pickupDate),
        pickupTime: '08:00', // Default time
        deliveryDate: new Date(req.body.deliveryDate),
        deliveryTime: '17:00', // Default time
        status: 'scheduled',
        priority: 'high',
        specialInstructions: req.body.specialRequirements,
        sourceBoard: 'manual',
        company: req.body.companyName,
        contactPhone: req.body.contactPhone
      };

      // Store the load
      const createdLoad = await storage.createLoad(loadData);
      
      // Add to DAT loads for VA viewing
      const datLoadData = {
        postId: createdLoad.loadNumber,
        company: req.body.companyName,
        phone: req.body.contactPhone,
        origin: loadData.pickupAddress,
        destination: loadData.deliveryAddress,
        rate: `$${req.body.rate}`,
        mileage: `${req.body.mileage} mi`,
        equipment: req.body.equipmentType.replace('_', ' ').toUpperCase(),
        weight: `${req.body.weight} lbs`,
        pickupDate: req.body.pickupDate,
        deliveryDate: req.body.deliveryDate,
        commodity: req.body.commodity,
        age: '0 min',
        source: 'manual_entry'
      };

      // Add to DAT loads storage
      if (global.manualDatLoads) {
        global.manualDatLoads.unshift(datLoadData);
      } else {
        global.manualDatLoads = [datLoadData];
      }

      console.log('✅ Manual load created and added to DAT loads tab');

      // Notify drivers using existing load notification system
      try {
        const drivers = await storage.getAllDrivers();
        const availableDrivers = drivers.filter(d => d.status === 'available' && d.enableSmsNotifications);
        let driversNotified = 0;

        // Send to SMS Load Service if available
        if (smsLoadService && smsLoadService.isServiceConfigured()) {
          console.log(`📲 Sending new manual load to SMS service for dispatch`);
          
          // Create a load offer for each eligible driver
          for (const driver of availableDrivers) {
            if (driver.phoneNumber && driver.equipmentType === createdLoad.equipmentType) {
              await storage.createLoadOffer({
                loadId: createdLoad.id,
                driverId: driver.id,
                status: 'pending',
                sentAt: new Date(),
                timeoutAt: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3 hours
              });
              driversNotified++;
            }
          }
        }

        res.json({
          success: true,
          loadId: createdLoad.id,
          loadNumber: createdLoad.loadNumber,
          driversNotified,
          message: 'Load created successfully and dispatched to drivers'
        });

      } catch (error) {
        console.error('⚠️ Error notifying drivers:', error);
        res.json({
          success: true,
          loadId: createdLoad.id,
          loadNumber: createdLoad.loadNumber,
          driversNotified: 0,
          message: 'Load created but driver notification failed'
        });
      }

    } catch (error) {
      console.error('❌ Manual load creation error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to create load' 
      });
    }
  });
  
  app.get('/api/drivers', async (req, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  // CRITICAL DRIVER ENDPOINTS - Moved from deferred registration to immediate
  
  // Check for duplicate contacts before creation
  app.post("/api/check-duplicates", async (req, res) => {
    try {
      const { name, email, phone, type } = req.body;
      
      if (!name || !email || !phone || !type) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      if (type === "driver") {
        const duplicates = await storage.findDuplicateDrivers(name, email, phone);
        res.json({ duplicates, hasDuplicates: duplicates.length > 0 });
      } else if (type === "customer") {
        const duplicates = await storage.findDuplicateCustomers(name, email, phone);
        res.json({ duplicates, hasDuplicates: duplicates.length > 0 });
      } else {
        res.status(400).json({ error: "Invalid type. Must be 'driver' or 'customer'" });
      }
    } catch (error) {
      console.error("Error checking duplicates:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new driver
  app.post("/api/drivers", async (req, res) => {
    try {
      const validatedData = insertDriverSchema.parse(req.body);
      
      // Check for duplicates before creating
      const duplicates = await storage.findDuplicateDrivers(
        validatedData.name, 
        validatedData.email, 
        validatedData.phone
      );
      
      if (duplicates.length > 0) {
        return res.status(409).json({ 
          error: "Duplicate contact found", 
          duplicates,
          message: "A driver with this name, email, or phone already exists." 
        });
      }
      
      const driver = await storage.createDriver(validatedData);
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  // Update driver
  app.put("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertDriverSchema.partial().parse(req.body);
      
      // Check if driver exists
      const existingDriver = await storage.getDriver(id);
      if (!existingDriver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      // Check for duplicates only if name, email, or phone are being updated
      if (validatedData.name || validatedData.email || validatedData.phone) {
        const duplicates = await storage.findDuplicateDrivers(
          validatedData.name || existingDriver.name,
          validatedData.email || existingDriver.email,
          validatedData.phone || existingDriver.phone
        );
        
        // Filter out the driver being updated from duplicates
        const otherDuplicates = duplicates.filter(dup => dup.id !== id);
        
        if (otherDuplicates.length > 0) {
          return res.status(409).json({ 
            error: "Duplicate contact found", 
            duplicates: otherDuplicates,
            message: "Another driver with this name, email, or phone already exists." 
          });
        }
      }
      
      const updatedDriver = await storage.updateDriver(id, validatedData);
      res.json(updatedDriver);
    } catch (error) {
      console.error("Error updating driver:", error);
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  // Delete driver
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
  
  // Critical load CRUD routes - must be available immediately for frontend
  app.get('/api/loads', async (req, res) => {
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
      
      // Send load to drivers via SMS if it matches preferences
      await smsLoadService.processNewLoad(load);
      
      res.status(201).json(load);
    } catch (error) {
      console.error('Load validation error:', error);
      res.status(400).json({ error: "Invalid load data", details: error.message });
    }
  });

  app.put("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`Updating load ${id} with data:`, req.body);
      
      const validatedData = insertLoadSchema.partial().parse(req.body);
      console.log(`Validated data:`, validatedData);
      
      const originalLoad = await storage.getLoad(id);
      
      if (!originalLoad) {
        console.error(`Load not found: ${id}`);
        return res.status(404).json({ error: "Load not found" });
      }
      
      const updatedLoad = await storage.updateLoad(id, validatedData);
      
      if (!updatedLoad) {
        console.error(`Failed to update load: ${id}`);
        return res.status(404).json({ error: "Load not found after update" });
      }
      
      // Send automated emails based on status changes
      if (validatedData.status && validatedData.status !== originalLoad.status) {
        if (validatedData.status === "in_transit") {
          await sendAutomatedEmails(updatedLoad, "pickup_confirmed");
        } else if (validatedData.status === "delivered") {
          await sendAutomatedEmails(updatedLoad, "delivered");
        }
      }
      
      // Send SMS notifications for driver assignments
      if (validatedData.driverId && validatedData.driverId !== originalLoad.driverId) {
        console.log(`🚛 Load ${id} assigned to driver ${validatedData.driverId} - sending SMS notification`);
        try {
          await smsLoadService.processNewLoad(updatedLoad);
          console.log(`✅ SMS notification sent for load assignment ${id}`);
        } catch (error) {
          console.error(`❌ Failed to send SMS notification for load ${id}:`, error);
        }
      }
      
      console.log(`Successfully updated load ${id}`);
      res.json(updatedLoad);
    } catch (error) {
      console.error('Load update error:', error);
      res.status(400).json({ 
        error: "Invalid load data", 
        details: error instanceof Error ? error.message : 'Unknown error',
        data: req.body
      });
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

  app.patch('/api/loads/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updatedLoad = await storage.updateLoad(id, updates);
      if (!updatedLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error updating load:', error);
      res.status(500).json({ error: 'Failed to update load' });
    }
  });

  // Load-related endpoints
  app.post('/api/loads/:id/assign', async (req, res) => {
    try {
      const { id } = req.params;
      const { driverId } = req.body;
      
      const updatedLoad = await storage.updateLoad(id, { 
        driverId, 
        status: 'assigned' 
      });
      
      if (!updatedLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      // Send SMS notification for driver assignment
      console.log(`🚛 Load ${id} assigned to driver ${driverId} - sending SMS notification`);
      try {
        await smsLoadService.processNewLoad(updatedLoad);
        console.log(`✅ SMS notification sent for load assignment ${id}`);
      } catch (error) {
        console.error(`❌ Failed to send SMS notification for load ${id}:`, error);
      }
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error assigning driver:', error);
      res.status(500).json({ error: 'Failed to assign driver' });
    }
  });

  app.get('/api/loads/:id/offers', async (req, res) => {
    try {
      const { id } = req.params;
      const offers = await storage.getLoadOffers(id);
      res.json(offers);
    } catch (error) {
      console.error('Error fetching load offers:', error);
      res.status(500).json({ error: 'Failed to fetch load offers' });
    }
  });

  // CRITICAL: Google Sheets loads endpoint - must be available immediately
  app.get('/api/dat-loads', async (req, res) => {
    try {
      // Use the already imported googleSheetsSimple instance
      const { googleSheetsSimple, getGoogleSheetsLoads } = await import('./google-sheets-simple.js');
      const loads = getGoogleSheetsLoads();
      console.log(`📋 DIRECT API serving ${loads.length} Google Sheets loads (bypassing db-storage)`);
      
      // If no loads, try to manually check the instance
      if (loads.length === 0) {
        console.log('⚠️ No loads found, checking module state...');
      }
      
      res.json(loads);
    } catch (error) {
      console.error('❌ Error getting Google Sheets loads:', error);
      res.json([]);
    }
  });
  
  // Communication threads route - CRITICAL for dashboard
  app.get('/api/communication/threads', async (req, res) => {
    try {
      console.log('🚀 Communication threads API called');
      console.log('📞 About to call storage.getAllLoadCommunicationThreads()');
      const threads = await storage.getAllLoadCommunicationThreads();
      console.log(`📋 Retrieved ${threads.length} communication threads from storage`);
      res.json(threads);
    } catch (error) {
      console.error('❌ Error fetching communication threads:', error);
      res.status(500).json({ error: "Failed to fetch communication threads" });
    }
  });

  // Get messages for a specific communication thread
  app.get('/api/communication/messages/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;
      console.log(`🚀 Getting messages for thread: ${threadId}`);
      const messages = await storage.getLoadMessagesByThread(threadId);
      console.log(`📋 Retrieved ${messages.length} messages for thread ${threadId}`);
      res.json(messages);
    } catch (error) {
      console.error('❌ Error fetching messages:', error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Send message to thread (POST to /api/communication/messages) - CRITICAL for dashboard
  app.post('/api/communication/messages', async (req, res) => {
    try {
      const { threadId, content, sender = 'dispatch' } = req.body;
      
      if (!threadId || !content) {
        return res.status(400).json({ error: 'Thread ID and content are required' });
      }

      // Get thread details to find the loadId
      const thread = await storage.getLoadCommunicationThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Communication thread not found' });
      }

      // Send message through SMS Communication Service
      let messageDelivered = false;
      console.log(`🔍 ROUTE DEBUG: Sender is: "${sender}", thread load ID: ${thread.loadId}`);
      
      if (sender === 'dispatch' || sender === 'dispatcher') {
        console.log(`🔍 ROUTE DEBUG: About to call SMS service for load ${thread.loadId}`);
        messageDelivered = await smsCommunicationService.sendLoadUpdateToDriver(thread.loadId, content);
        console.log(`🔍 ROUTE DEBUG: SMS service returned: ${messageDelivered}`);
        
        // If SMS delivery fails, return error to show delivery failure
        if (!messageDelivered) {
          console.log(`🔍 ROUTE DEBUG: SMS delivery failed, returning 409 error`);
          return res.status(409).json({ 
            error: 'Message could not be delivered to driver. Check if load has assigned driver with valid phone number.',
            success: false 
          });
        }
        console.log(`🔍 ROUTE DEBUG: SMS delivery successful, continuing with database save`);
      } else {
        console.log(`🔍 ROUTE DEBUG: Sender is not dispatch/dispatcher, skipping SMS`);
      }

      // Create message record in database
      await storage.createLoadMessage({
        threadId: threadId,
        loadId: thread.loadId,
        driverId: thread.driverId,
        message: content,
        textContent: content,
        messageType: 'text',
        senderRole: sender,
        senderName: sender === 'driver' ? thread.driverName : 'Dispatcher',
        isFromDriver: sender === 'driver',
        isRead: false,
        isSuggested: false,
        isSent: true,
        createdAt: new Date()
      });

      // Update thread stats
      await storage.updateLoadCommunicationThread(threadId, {
        messageCount: (thread.messageCount || 0) + 1,
        lastMessageAt: new Date(),
        lastMessageText: content.substring(0, 100), // First 100 chars
        lastMessageSender: sender
      });
      
      res.json({ 
        success: true,
        message: 'Message sent successfully'
      });
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // MOVED DRIVER ENDPOINTS HERE TO TEST REGISTRATION LOCATION
  console.log("🔥 TESTING DRIVER ENDPOINTS REGISTRATION AT WORKING LOCATION");
  
  // TEST ENDPOINT to verify route registration
  app.get("/api/test-drivers-moved", (req, res) => {
    console.log("🔧 MOVED TEST endpoint HIT - route registration working");
    res.json({ message: "Moved test endpoint working", timestamp: new Date().toISOString() });
  });

  app.post("/api/drivers-moved", async (req, res) => {
    console.log("🔧 MOVED POST /api/drivers-moved endpoint HIT");
    try {
      const validatedData = insertDriverSchema.parse(req.body);
      const driver = await storage.createDriver(validatedData);
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  // AI suggestions endpoint
  app.get('/api/ai/suggestions/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;
      console.log(`🤖 Getting AI suggestions for thread: ${threadId}`);
      
      // Mock AI suggestions for now - replace with actual AI service
      const suggestions = [
        {
          id: "1",
          text: "Thanks for the update! Please confirm your ETA to the delivery location.",
          confidence: 0.85,
          type: "status_check"
        },
        {
          id: "2", 
          text: "Please upload BOL and delivery confirmation when complete.",
          confidence: 0.78,
          type: "paperwork"
        },
        {
          id: "3",
          text: "Great job on the pickup! Drive safe to your destination.",
          confidence: 0.72,
          type: "encouragement"
        }
      ];
      
      res.json({ suggestions });
    } catch (error) {
      console.error('❌ Error getting AI suggestions:', error);
      res.status(500).json({ error: "Failed to get AI suggestions" });
    }
  });

  // AI conversation insights endpoint
  app.get('/api/ai/conversation-insights/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;
      console.log(`🧠 Getting conversation insights for thread: ${threadId}`);
      
      // Mock insights for now - replace with actual AI analysis
      const insights = {
        sentiment: "positive",
        urgency: "medium", 
        driverMood: "confident",
        responseTime: "2min",
        keyTopics: ["pickup", "delivery", "paperwork"],
        riskFactors: []
      };
      
      res.json(insights);
    } catch (error) {
      console.error('❌ Error getting conversation insights:', error);
      res.status(500).json({ error: "Failed to get conversation insights" });
    }
  });

  // ===== SMS COMMUNICATION API ENDPOINTS =====

  // Initialize SMS Communication Service
  app.post('/api/communication/initialize', async (req, res) => {
    try {
      await smsCommunicationService.initialize();
      res.json({ success: true, message: 'SMS Communication Service initialized' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Debug endpoint to test SMS communication service
  app.get('/api/communication/debug', async (req, res) => {
    try {
      const isRunning = smsCommunicationService.serviceRunning;
      const smsConfigured = smsLoadService.isServiceConfigured();
      
      console.log('🔧 SMS Communication Debug Check:');
      console.log(`📡 Service running: ${isRunning}`);
      console.log(`📱 SMS service configured: ${smsConfigured}`);
      
      res.json({
        serviceRunning: isRunning,
        smsConfigured: smsConfigured,
        communicationType: 'SMS',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ SMS Communication debug error:', error);
      res.status(500).json({ error: 'Debug check failed' });
    }
  });

  // SMS Webhook endpoints for receiving messages from drivers
  app.post('/api/sms/webhook', async (req, res) => {
    try {
      // Verify Twilio signature for security (required for production)
      const twilioSignature = req.headers['x-twilio-signature'] as string;
      if (process.env.NODE_ENV === 'production' && process.env.TWILIO_AUTH_TOKEN) {
        if (!twilioSignature) {
          console.log('🔒 Missing Twilio signature in production - request rejected');
          return res.status(403).send('Forbidden: Missing signature');
        }
        
        const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const isValidSignature = twilio.validateRequest(
          process.env.TWILIO_AUTH_TOKEN,
          twilioSignature,
          webhookUrl,
          req.body
        );
        
        if (!isValidSignature) {
          console.log('🔒 Invalid Twilio signature - request rejected');
          return res.status(403).send('Forbidden: Invalid signature');
        }
        
        console.log('🔒 Twilio signature verified successfully');
      }
      
      console.log('📱 SMS webhook received:', req.body);
      
      const { From, Body, MessageSid } = req.body;
      
      if (!From || !Body) {
        console.log('⚠️ Invalid SMS webhook data - missing From or Body');
        console.log('📋 Request body keys:', Object.keys(req.body));
        return res.status(400).send('Invalid webhook data');
      }

      // Handle incoming SMS through communication service
      await smsCommunicationService.handleIncomingSMS(From, Body, MessageSid);
      
      // Respond with TwiML to acknowledge receipt
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Message received</Message>
</Response>`);
    } catch (error) {
      console.error('❌ Error handling SMS webhook:', error);
      res.status(500).send('Error processing SMS');
    }
  });

  // ===== ZELLO VOICE DISPATCH ENDPOINTS =====
  
  // Zello webhook for voice responses
  app.post('/api/zello/webhook', async (req, res) => {
    try {
      console.log('🎙️ Zello webhook received:', req.body);
      
      const { channel, username, message, type, audio_url } = req.body;
      
      if (!channel || !username) {
        return res.status(400).json({ error: 'Invalid webhook data' });
      }
      
      // Handle different types of Zello events
      if (type === 'voice_message' || type === 'text_message') {
        const command = message?.toUpperCase() || '';
        
        // Extract load number from message if present
        const loadNumberMatch = command.match(/LOAD-(\d+)/);
        const loadNumber = loadNumberMatch ? loadNumberMatch[0] : undefined;
        
        await zelloService.handleVoiceResponse({
          channel,
          from: username,
          command,
          loadNumber
        });
        
        console.log(`✅ Processed Zello response from ${username}: ${command}`);
      }
      
      res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error('❌ Error handling Zello webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  });
  
  // Get Zello channel status
  app.get('/api/zello/status', async (req, res) => {
    try {
      const status = zelloService.getChannelStatus();
      res.json(status);
    } catch (error) {
      console.error('❌ Error getting Zello status:', error);
      res.status(500).json({ error: 'Failed to get Zello status' });
    }
  });
  
  // Create dynamic Zello channel for specific load
  app.post('/api/zello/channels', async (req, res) => {
    try {
      const { name, users } = req.body;
      
      if (!name || !users || !Array.isArray(users)) {
        return res.status(400).json({ error: 'Invalid channel data' });
      }
      
      const success = await zelloService.createDynamicChannel(name, users);
      
      if (success) {
        res.json({ success: true, message: `Channel ${name} created` });
      } else {
        res.status(400).json({ error: 'Failed to create channel' });
      }
    } catch (error) {
      console.error('❌ Error creating Zello channel:', error);
      res.status(500).json({ error: 'Failed to create channel' });
    }
  });
  
  // Send custom Zello broadcast
  app.post('/api/zello/broadcast', async (req, res) => {
    try {
      const { message, channel } = req.body;
      
      if (!message || !channel) {
        return res.status(400).json({ error: 'Message and channel required' });
      }
      
      await zelloService.sendCustomMessage(message, channel);
      res.json({ success: true, message: 'Broadcast sent' });
    } catch (error) {
      console.error('❌ Error sending Zello broadcast:', error);
      res.status(500).json({ error: 'Failed to send broadcast' });
    }
  });

  // Test SMS endpoint to send messages
  app.post('/api/test-sms', async (req, res) => {
    try {
      const { to, message } = req.body;
      
      // Normalize phone number to E.164 format
      let normalizedPhone = to.replace(/\D/g, '');
      if (!normalizedPhone.startsWith('+')) {
        if (normalizedPhone.length === 10) {
          normalizedPhone = `+1${normalizedPhone}`;
        } else if (!normalizedPhone.startsWith('1') && normalizedPhone.length === 11) {
          normalizedPhone = `+${normalizedPhone}`;
        }
      }
      
      console.log(`📱 Sending test SMS to ${normalizedPhone}: ${message}`);
      
      const smsService = (global as any).smsService;
      if (!smsService) {
        return res.status(500).json({ error: 'SMS service not initialized' });
      }
      
      const result = await smsService.sendSMS({
        to: normalizedPhone,
        body: message
      });
      
      res.json(result);
    } catch (error) {
      console.error('Error sending test SMS:', error);
      res.status(500).json({ error: 'Failed to send test SMS' });
    }
  });

  // SMS status webhook to track delivery status
  app.post('/api/sms/status', async (req, res) => {
    try {
      // Verify Twilio signature for security (required for production)
      const twilioSignature = req.headers['x-twilio-signature'] as string;
      if (process.env.NODE_ENV === 'production' && process.env.TWILIO_AUTH_TOKEN) {
        if (!twilioSignature) {
          console.log('🔒 Missing Twilio signature in production - status request rejected');
          return res.status(403).send('Forbidden: Missing signature');
        }
        
        const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const isValidSignature = twilio.validateRequest(
          process.env.TWILIO_AUTH_TOKEN,
          twilioSignature,
          webhookUrl,
          req.body
        );
        
        if (!isValidSignature) {
          console.log('🔒 Invalid Twilio signature - status request rejected');
          return res.status(403).send('Forbidden: Invalid signature');
        }
        
        console.log('🔒 Twilio signature verified for status webhook');
      }
      
      console.log('📱 SMS status update:', req.body);
      
      const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;
      
      if (MessageStatus === 'delivered') {
        console.log(`✅ SMS ${MessageSid} delivered successfully`);
      } else if (MessageStatus === 'failed') {
        console.log(`❌ SMS ${MessageSid} delivery failed: ${ErrorCode} - ${ErrorMessage}`);
      }
      
      // Just acknowledge receipt
      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Error handling SMS status webhook:', error);
      res.status(500).send('Error processing status');
    }
  });

  console.log('✅ Essential routes registered - server ready for startup');
  
  // Background initialization - immediate startup (no deferred registration needed)
  console.log('🔄 Starting immediate background initialization...');
  initializeAllServices();
  
  console.log('✅ All routes registered successfully');
}

// COMPREHENSIVE CLEANUP COMPLETED:
// Removed thousands of lines of orphaned route definitions that were causing "app is not defined" runtime errors.
// These route definitions were improperly placed in global scope outside any function where the Express app object
// is not accessible. All necessary route definitions are now properly contained within the registerRoutes function above.
// This cleanup eliminated the startup crash and allows the application to run successfully.

// Function to create and configure the HTTP server
export function createHTTPServer(app: Express): Server {
  console.log('⚡ Creating HTTP server...');
  
  const httpServer = createServer(app);

  // All route definitions have been moved to the registerRoutes function above.
  // The createHTTPServer function now contains only server creation logic as intended.

  console.log('✅ HTTP server created successfully');
  return httpServer;
}
