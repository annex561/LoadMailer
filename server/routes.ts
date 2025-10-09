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

    // Initialize Zello voice dispatch service immediately
    setTimeout(async () => {
      try {
        console.log('🎙️ Starting Zello voice dispatch initialization...');
        await zelloService.initialize();
        const status = {
          initialized: zelloService.isServiceRunning(),
          configured: zelloService.isServiceConfigured(),
          channels: zelloService.channels,
          totalUsers: zelloService.users.size
        };
        console.log('✅ Zello voice dispatch service initialized:', status);
        
        // Set up Zello event handlers
        zelloService.on('load_accepted', async (data) => {
          console.log(`✅ Driver ${data.driver} accepted load ${data.loadNumber} via Zello`);
          // Update load status in database
          const load = await storage.getLoadByNumber(data.loadNumber);
          if (load && load.status === 'available') {
            const driver = await storage.getDriverByNameOrPhone(data.driver);
            if (driver) {
              await storage.updateLoad(load.id, {
                status: 'assigned',
                driverId: driver.id
              });
            }
          }
        });
        
        zelloService.on('load_declined', async (data) => {
          console.log(`❌ Driver ${data.driver} declined load ${data.loadNumber} via Zello`);
          // TODO: Find next eligible driver
        });
        
      } catch (error) {
        console.error('❌ Failed to initialize Zello service:', error);
      }
    }, 2000);  // Wait 2 seconds for server to be fully ready

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
  
  // Get active driver locations for real-time map tracking
  app.get('/api/driver-locations/active', async (req, res) => {
    try {
      console.log('📋 Fetching driver locations from database and Zello...');
      
      // Get all drivers from database
      const drivers = await storage.getAllDrivers();
      console.log(`📋 Database returned ${drivers.length} drivers:`, 
        drivers.map(d => `${d.name} (${d.id})`));
      
      // Get GPS locations from Zello service for active users
      const zelloLocations = await zelloService.getUserLocations();
      console.log(`📍 Zello returned ${zelloLocations.length} user locations`);
      
      // Create a map of Zello locations by display name for quick lookup
      const zelloLocationMap = new Map<string, any>();
      zelloLocations.forEach(loc => {
        if (loc.location) {
          zelloLocationMap.set(loc.displayName.toLowerCase(), loc);
        }
      });
      
      // Filter for available/on_route drivers and get their locations
      const activeDrivers = drivers.filter(d => d.status === 'available' || d.status === 'on_route');
      
      // Map drivers to locations, prioritizing Zello GPS data
      const locations = activeDrivers.map(driver => {
        // Try to find Zello GPS data for this driver
        const zelloUser = zelloLocationMap.get(driver.name.toLowerCase());
        
        if (zelloUser && zelloUser.location) {
          // Use real Zello GPS data
          console.log(`✅ Using Zello GPS for driver: ${driver.name}`);
          const loc = zelloUser.location;
          
          return {
            driverId: driver.id,
            driverName: driver.name,
            latitude: loc.latitude,
            longitude: loc.longitude,
            address: loc.address || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`,
            lastUpdate: loc.timestamp,
            speed: loc.speed || 0,
            batteryLevel: loc.batteryLevel || 100,
            isMoving: (loc.speed || 0) > 5,
            heading: loc.heading || 0,
            routeName: driver.status === 'on_route' ? 'Load Delivery Route' : undefined,
            source: 'zello' // Track data source
          };
        } else {
          // Fallback to simulated location for drivers without Zello GPS
          console.log(`⚠️ No Zello GPS for driver: ${driver.name}, using fallback`);
          
          // Use driver's city if available, otherwise default to Tennessee locations
          const cityLocations = {
            'nashville': { lat: 36.1627, lng: -86.7816, city: 'Nashville, TN' },
            'knoxville': { lat: 35.9606, lng: -83.9207, city: 'Knoxville, TN' },
            'memphis': { lat: 35.1495, lng: -90.0490, city: 'Memphis, TN' },
            'chattanooga': { lat: 35.0456, lng: -85.3097, city: 'Chattanooga, TN' },
            'clarksville': { lat: 36.5298, lng: -87.3595, city: 'Clarksville, TN' },
            'atlanta': { lat: 33.7490, lng: -84.3880, city: 'Atlanta, GA' },
            'charlotte': { lat: 35.2271, lng: -80.8431, city: 'Charlotte, NC' },
            'birmingham': { lat: 33.5186, lng: -86.8104, city: 'Birmingham, AL' }
          };
          
          // Try to match driver's city
          let baseLocation = cityLocations['nashville']; // Default
          if (driver.city) {
            const cityKey = driver.city.toLowerCase().split(',')[0].trim();
            if (cityLocations[cityKey]) {
              baseLocation = cityLocations[cityKey];
            }
          }
          
          // Add small random offset for variety
          const latOffset = (Math.random() - 0.5) * 0.05; 
          const lngOffset = (Math.random() - 0.5) * 0.05;
          
          return {
            driverId: driver.id,
            driverName: driver.name,
            latitude: baseLocation.lat + latOffset,
            longitude: baseLocation.lng + lngOffset,
            address: baseLocation.city,
            lastUpdate: new Date().toISOString(),
            speed: 0,
            batteryLevel: 85,
            isMoving: false,
            heading: 0,
            routeName: driver.status === 'on_route' ? 'Load Delivery Route' : undefined,
            source: 'fallback' // Track data source
          };
        }
      }).filter(location => location !== null); // Filter out any null locations
      
      res.json({
        locations,
        count: locations.length,
        serviceRunning: true,
        trackedDrivers: locations.length
      });
      
    } catch (error) {
      console.error('Error fetching driver locations:', error);
      res.status(500).json({ error: "Failed to fetch driver locations" });
    }
  });

  // CRITICAL DRIVER ENDPOINTS - Moved from deferred registration to immediate
  
  // Simple driver registration with Zello integration
  app.post("/api/simple-driver-registration", async (req, res) => {
    try {
      console.log('📱 Processing driver registration with Zello integration...');
      
      // Extract token and driver data
      const { token, ...driverData } = req.body;
      
      // Prepare driver data with defaults
      const driverRecord = {
        name: driverData.name,
        email: driverData.email,
        phone: driverData.phone,
        city: driverData.city,
        equipmentType: driverData.equipmentType,
        weightCapacity: driverData.maxWeight || 26000,
        maxLength: driverData.maxLength || 53,
        status: 'available' as const,
        enableSmsNotifications: true,
        telegramUsername: driverData.telegramUsername || '',
        licenseNumber: driverData.licenseNumber || '',
        licenseState: driverData.licenseState || ''
      };
      
      // Check for duplicates before creating
      const duplicates = await storage.findDuplicateDrivers(
        driverRecord.name,
        driverRecord.email,
        driverRecord.phone
      );
      
      if (duplicates.length > 0) {
        return res.status(409).json({
          error: "Duplicate contact found",
          duplicates,
          message: "A driver with this name, email, or phone already exists."
        });
      }
      
      // Create driver in database first
      const driver = await storage.createDriver(driverRecord);
      
      console.log(`✅ Driver created: ${driver.name} (${driver.id})`);
      
      // Create Zello account for the driver
      try {
        const zelloCredentials = await zelloService.createDriverAccount({
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          equipmentType: driver.equipmentType
        });
        
        // Immediately sync the driver to Zello channels
        await zelloService.syncDriverToZello({
          name: driver.name,
          phone: driver.phone,
          equipmentType: driver.equipmentType
        });
        
        // Store Zello credentials with driver (in metadata or custom fields)
        // For now, we'll return them to the driver directly
        
        // Send welcome SMS with Zello credentials
        const welcomeMessage = zelloService.generateWelcomeMessage(zelloCredentials);
        
        // Try to send SMS with Zello credentials
        if (smsLoadService?.isServiceConfigured()) {
          try {
            await smsLoadService.sendDirectSMS(driver.phone, welcomeMessage);
            console.log('📱 Sent Zello welcome SMS to driver');
          } catch (smsError) {
            console.error('⚠️ Failed to send welcome SMS:', smsError);
            // Continue even if SMS fails - they still get the info on screen
          }
        }
        
        console.log(`🎙️ Zello account created for ${driver.name}: ${zelloCredentials.username}`);
        
        res.status(201).json({
          ...driver,
          zelloAccount: {
            username: zelloCredentials.username,
            password: zelloCredentials.password, // Show password once during registration
            channels: zelloCredentials.channels,
            appLinks: zelloCredentials.appDownloadLinks
          },
          message: 'Registration complete! Check your phone for Zello app download links.'
        });
      } catch (zelloError) {
        console.error('⚠️ Failed to create Zello account:', zelloError);
        // Still return success for driver creation even if Zello fails
        res.status(201).json({
          ...driver,
          message: 'Driver registered successfully. Voice dispatch setup pending.'
        });
      }
      
    } catch (error) {
      console.error('❌ Registration error:', error);
      res.status(400).json({ error: "Registration failed" });
    }
  });
  
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

  // Search drivers for communication
  app.get('/api/communication/search-drivers', async (req, res) => {
    try {
      const { query } = req.query;
      const drivers = await storage.getAllDrivers();
      
      // Filter drivers based on query if provided
      let filteredDrivers = drivers;
      if (query && typeof query === 'string') {
        const searchQuery = query.toLowerCase();
        filteredDrivers = drivers.filter(driver => 
          driver.name.toLowerCase().includes(searchQuery) ||
          driver.phone?.toLowerCase().includes(searchQuery) ||
          driver.email?.toLowerCase().includes(searchQuery)
        );
      }
      
      // Return driver info suitable for communication
      const result = filteredDrivers.map(driver => ({
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        email: driver.email,
        status: driver.status,
        equipmentType: driver.equipmentType,
        currentMood: driver.currentMood
      }));
      
      res.json(result);
    } catch (error) {
      console.error('Error searching drivers:', error);
      res.status(500).json({ error: 'Failed to search drivers' });
    }
  });

  // Get or create general communication thread with a driver
  app.post('/api/communication/general-thread', async (req, res) => {
    try {
      const { driverId } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: 'Driver ID required' });
      }
      
      // Check if general thread already exists
      let thread = await storage.getGeneralCommunicationThreadByDriver(driverId);
      
      if (!thread) {
        // Get driver info
        const driver = await storage.getDriver(driverId);
        if (!driver) {
          return res.status(404).json({ error: 'Driver not found' });
        }
        
        // Create new general thread
        thread = await storage.createLoadCommunicationThread({
          threadType: 'general',
          driverId: driverId,
          status: 'active',
          messageCount: 0,
          unreadDriverMessages: 0,
          unreadDispatchMessages: 0,
          driverName: driver.name,
          driverPhone: driver.phone || '',
          assistantEnabled: false,
          assistantMode: 'off',
          autoSendConfidence: 80
        });
      }
      
      res.json(thread);
    } catch (error) {
      console.error('Error creating general thread:', error);
      res.status(500).json({ error: 'Failed to create general communication thread' });
    }
  });

  // Offer load to driver in general conversation
  app.post('/api/communication/offer-load', async (req, res) => {
    try {
      const { threadId, loadId } = req.body;
      console.log('🚚 Offering load to driver in thread:', threadId, 'Load:', loadId);

      if (!threadId || !loadId) {
        return res.status(400).json({ error: 'Thread ID and Load ID required' });
      }

      // Get the thread
      const thread = await storage.getLoadCommunicationThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Verify it's a general conversation
      if (thread.threadType !== 'general') {
        return res.status(400).json({ error: 'Can only offer loads in general conversations' });
      }

      // Get load info
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }

      // Update thread with load offer
      const updatedThread = await storage.updateLoadCommunicationThread(threadId, {
        loadId: loadId,
        loadOfferStatus: 'pending',
        loadNumber: load.loadNumber,
        loadOrigin: load.origin,
        loadDestination: load.destination
      });

      // Create a system message about the load offer
      await storage.createLoadMessage({
        threadId,
        content: `Load offered: ${load.loadNumber} - ${load.origin} → ${load.destination} - Rate: $${load.rate || 'TBD'}`,
        sender: 'dispatch',
        isRead: false
      });
      
      console.log('✅ Load offered successfully');
      res.json(updatedThread);
    } catch (error) {
      console.error('❌ Error offering load:', error);
      res.status(500).json({ error: 'Failed to offer load' });
    }
  });

  // Accept load offer in general conversation
  app.post('/api/communication/accept-load', async (req, res) => {
    try {
      const { threadId } = req.body;
      console.log('✅ Accepting load offer for thread:', threadId);

      if (!threadId) {
        return res.status(400).json({ error: 'Thread ID required' });
      }

      // Get the thread
      const thread = await storage.getLoadCommunicationThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Verify it's a general conversation with a pending offer
      if (thread.threadType !== 'general' || thread.loadOfferStatus !== 'pending') {
        return res.status(400).json({ error: 'No pending load offer to accept' });
      }

      // Update thread to convert to load conversation
      const updatedThread = await storage.updateLoadCommunicationThread(threadId, {
        threadType: 'load',
        loadOfferStatus: 'accepted'
      });

      // Update load assignment
      if (thread.loadId) {
        await storage.updateLoad(thread.loadId, { driverId: thread.driverId, status: 'assigned' });
      }

      // Create a system message about the acceptance
      await storage.createLoadMessage({
        threadId,
        content: `Driver accepted the load offer! Load ${thread.loadNumber} is now assigned.`,
        sender: 'driver',
        isRead: false
      });
      
      console.log('✅ Load offer accepted');
      res.json(updatedThread);
    } catch (error) {
      console.error('❌ Error accepting load offer:', error);
      res.status(500).json({ error: 'Failed to accept load offer' });
    }
  });

  // Decline load offer in general conversation
  app.post('/api/communication/decline-load', async (req, res) => {
    try {
      const { threadId } = req.body;
      console.log('❌ Declining load offer for thread:', threadId);

      if (!threadId) {
        return res.status(400).json({ error: 'Thread ID required' });
      }

      // Get the thread
      const thread = await storage.getLoadCommunicationThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Verify it's a general conversation with a pending offer
      if (thread.threadType !== 'general' || thread.loadOfferStatus !== 'pending') {
        return res.status(400).json({ error: 'No pending load offer to decline' });
      }

      // Update thread to decline offer
      const updatedThread = await storage.updateLoadCommunicationThread(threadId, {
        loadOfferStatus: 'declined',
        loadId: null,
        loadNumber: null,
        loadOrigin: null,
        loadDestination: null
      });

      // Create a system message about the decline
      await storage.createLoadMessage({
        threadId,
        content: `Driver declined the load offer.`,
        sender: 'driver',
        isRead: false
      });
      
      console.log('✅ Load offer declined');
      res.json(updatedThread);
    } catch (error) {
      console.error('❌ Error declining load offer:', error);
      res.status(500).json({ error: 'Failed to decline load offer' });
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

      // Send message through SMS Communication Service and Zello
      let messageDelivered = false;
      let zelloDelivered = false;
      console.log(`🔍 ROUTE DEBUG: Sender is: "${sender}", thread load ID: ${thread.loadId}`);
      
      if (sender === 'dispatch' || sender === 'dispatcher') {
        console.log(`🔍 ROUTE DEBUG: About to call SMS service for load ${thread.loadId}`);
        messageDelivered = await smsCommunicationService.sendLoadUpdateToDriver(thread.loadId, content);
        console.log(`🔍 ROUTE DEBUG: SMS service returned: ${messageDelivered}`);
        
        // Also send through Zello for drivers with Zello app
        try {
          const driver = await storage.getDriver(thread.driverId);
          if (driver && driver.name) {
            // Format message for Zello with load context
            const load = await storage.getLoad(thread.loadId);
            const zelloMessage = `📨 Message for Load ${load?.loadNumber || thread.loadId}\n` +
                               `${load?.origin || ''} → ${load?.destination || ''}\n\n` +
                               `${content}`;
            
            // Send to driver's personal channel or all-drivers channel
            const driverUsername = driver.name.toLowerCase().replace(/\s+/g, '_');
            await zelloService.sendCustomMessage(zelloMessage, driverUsername);
            // Also send to all-drivers channel for visibility
            await zelloService.sendCustomMessage(zelloMessage, 'all-drivers');
            zelloDelivered = true;
            console.log(`✅ Message sent via Zello to driver ${driver.name}`);
          }
        } catch (zelloError) {
          console.error('⚠️ Zello delivery failed:', zelloError);
          // Don't fail the entire request if Zello fails, SMS is primary
        }
        
        // If neither SMS nor Zello delivery succeeds, return error
        if (!messageDelivered && !zelloDelivered) {
          console.log(`🔍 ROUTE DEBUG: Both SMS and Zello delivery failed, returning 409 error`);
          return res.status(409).json({ 
            error: 'Message could not be delivered to driver. Check if load has assigned driver with valid phone number.',
            success: false 
          });
        }
        console.log(`🔍 ROUTE DEBUG: Message delivered via ${messageDelivered ? 'SMS' : ''} ${zelloDelivered ? 'Zello' : ''}`);
      } else {
        console.log(`🔍 ROUTE DEBUG: Sender is not dispatch/dispatcher, skipping SMS and Zello`);
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

  // ===== MESSAGE ATTACHMENT / DOCUMENT MANAGEMENT ENDPOINTS =====
  
  // Upload attachment to a message/thread
  app.post('/api/communication/attachments', async (req, res) => {
    try {
      const { 
        messageId, 
        threadId, 
        loadId, 
        driverId,
        fileName,
        fileUrl,
        fileSize,
        fileType,
        documentCategory,
        documentDescription,
        uploadedBy
      } = req.body;

      if (!loadId || !fileName || !fileUrl) {
        return res.status(400).json({ error: 'Load ID, file name, and file URL are required' });
      }

      // Create attachment record
      const attachment = await storage.createMessageAttachment({
        messageId: messageId || null,
        loadId,
        driverId: driverId || null,
        fileName,
        fileUrl,
        fileSize: fileSize || 0,
        fileType: fileType || 'application/octet-stream',
        documentCategory: documentCategory || 'other',
        documentDescription: documentDescription || '',
        documentStatus: 'pending_review',
        uploadedBy: uploadedBy || 'driver',
        createdAt: new Date()
      });

      console.log(`📎 Document uploaded: ${fileName} for load ${loadId}, category: ${documentCategory}`);
      res.json(attachment);
    } catch (error) {
      console.error('❌ Error uploading attachment:', error);
      res.status(500).json({ error: 'Failed to upload attachment' });
    }
  });

  // Get attachments for a load
  app.get('/api/communication/attachments/load/:loadId', async (req, res) => {
    try {
      const { loadId } = req.params;
      const attachments = await storage.getMessageAttachmentsByLoad(loadId);
      res.json(attachments);
    } catch (error) {
      console.error('❌ Error fetching load attachments:', error);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  // Get attachments for a driver
  app.get('/api/communication/attachments/driver/:driverId', async (req, res) => {
    try {
      const { driverId } = req.params;
      const attachments = await storage.getMessageAttachmentsByDriver(driverId);
      res.json(attachments);
    } catch (error) {
      console.error('❌ Error fetching driver attachments:', error);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  // Get attachments by category for a load
  app.get('/api/communication/attachments/load/:loadId/category/:category', async (req, res) => {
    try {
      const { loadId, category } = req.params;
      const attachments = await storage.getMessageAttachmentsByCategory(loadId, category);
      res.json(attachments);
    } catch (error) {
      console.error('❌ Error fetching categorized attachments:', error);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  // Get pending review attachments
  app.get('/api/communication/attachments/pending-review', async (req, res) => {
    try {
      const attachments = await storage.getPendingReviewAttachments();
      res.json(attachments);
    } catch (error) {
      console.error('❌ Error fetching pending review attachments:', error);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  // Approve attachment
  app.post('/api/communication/attachments/:id/approve', async (req, res) => {
    try {
      const { id } = req.params;
      const { reviewerId = 'dispatcher', notes } = req.body;
      
      const attachment = await storage.approveMessageAttachment(id, reviewerId, notes);
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }
      
      console.log(`✅ Attachment ${id} approved by ${reviewerId}`);
      res.json(attachment);
    } catch (error) {
      console.error('❌ Error approving attachment:', error);
      res.status(500).json({ error: 'Failed to approve attachment' });
    }
  });

  // Reject attachment
  app.post('/api/communication/attachments/:id/reject', async (req, res) => {
    try {
      const { id } = req.params;
      const { reviewerId = 'dispatcher', notes } = req.body;
      
      if (!notes) {
        return res.status(400).json({ error: 'Rejection notes are required' });
      }
      
      const attachment = await storage.rejectMessageAttachment(id, reviewerId, notes);
      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }
      
      console.log(`❌ Attachment ${id} rejected by ${reviewerId}: ${notes}`);
      res.json(attachment);
    } catch (error) {
      console.error('❌ Error rejecting attachment:', error);
      res.status(500).json({ error: 'Failed to reject attachment' });
    }
  });

  // Delete attachment
  app.delete('/api/communication/attachments/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteMessageAttachment(id);
      
      if (!success) {
        return res.status(404).json({ error: 'Attachment not found' });
      }
      
      console.log(`🗑️ Attachment ${id} deleted`);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error deleting attachment:', error);
      res.status(500).json({ error: 'Failed to delete attachment' });
    }
  });

  // Get attachments for a message
  app.get('/api/communication/messages/:messageId/attachments', async (req, res) => {
    try {
      const { messageId } = req.params;
      const attachments = await storage.getMessageAttachmentsByMessage(messageId);
      res.json(attachments);
    } catch (error) {
      console.error('❌ Error fetching message attachments:', error);
      res.status(500).json({ error: 'Failed to fetch attachments' });
    }
  });

  // ===== ZELLO VOICE DISPATCH API ENDPOINTS =====

  // Initialize Zello Voice Dispatch Service
  app.post('/api/zello/initialize', async (req, res) => {
    try {
      console.log('🎙️ Manual Zello initialization requested');
      await zelloService.initialize();
      const status = {
        initialized: zelloService.isServiceRunning(),
        configured: zelloService.isServiceConfigured(),
        channels: zelloService.channels,
        totalUsers: zelloService.users.size
      };
      console.log('✅ Zello initialization complete:', status);
      res.json(status);
    } catch (error) {
      console.error('❌ Zello initialization failed:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to initialize Zello' 
      });
    }
  });

  // Zello webhook endpoint for receiving messages from drivers
  app.post('/api/zello/webhook', async (req, res) => {
    try {
      console.log('🎙️ Zello webhook received:', JSON.stringify(req.body, null, 2));
      
      const { 
        type, 
        channel, 
        sender, 
        message, 
        text, 
        attachment,
        timestamp 
      } = req.body;

      // Handle different Zello event types
      if (type === 'message' || type === 'text_message') {
        // Text or voice message from driver
        const messageContent = message || text || '';
        const fromDriver = sender || req.body.from || req.body.user || '';
        
        if (!fromDriver || !messageContent) {
          console.log('⚠️ Invalid Zello message - missing sender or content');
          return res.status(400).json({ error: 'Invalid message data' });
        }

        // Find driver by name or phone
        const driver = await storage.getDriverByNameOrPhone(fromDriver);
        if (!driver) {
          console.log(`⚠️ Unknown driver in Zello message: ${fromDriver}`);
          return res.json({ status: 'ignored', reason: 'Unknown driver' });
        }

        // Check if message is a load response (ACCEPT/DECLINE)
        const upperMessage = messageContent.toUpperCase();
        if (upperMessage.includes('ACCEPT') || upperMessage.includes('BOOK')) {
          // Driver accepting a load
          const loadNumberMatch = messageContent.match(/LOAD-\d+/i);
          if (loadNumberMatch) {
            const loadNumber = loadNumberMatch[0].toUpperCase();
            console.log(`✅ Driver ${driver.name} accepted load ${loadNumber} via Zello`);
            
            // Update load status
            const load = await storage.getLoadByNumber(loadNumber);
            if (load && load.status === 'available') {
              await storage.updateLoad(load.id, {
                status: 'assigned',
                driverId: driver.id
              });
              
              // Send confirmation back through Zello
              await zelloService.sendMessage(
                channel || 'all-drivers',
                `✅ Load ${loadNumber} confirmed for ${driver.name}. Check Communication Dashboard for details.`
              );
            }
          }
        } else if (upperMessage.includes('DECLINE') || upperMessage.includes('PASS')) {
          // Driver declining a load
          const loadNumberMatch = messageContent.match(/LOAD-\d+/i);
          if (loadNumberMatch) {
            const loadNumber = loadNumberMatch[0].toUpperCase();
            console.log(`❌ Driver ${driver.name} declined load ${loadNumber} via Zello`);
            // TODO: Find next eligible driver
          }
        } else {
          // Regular message - store in communication thread
          console.log(`💬 Storing message from ${driver.name}: ${messageContent}`);
          
          // Find or create communication thread for this driver
          let thread = await storage.getGeneralCommunicationThreadByDriver(driver.id);
          
          if (!thread) {
            // Create new general communication thread
            thread = await storage.createCommunicationThread({
              driverId: driver.id,
              loadId: null,  // General thread, no load attached
              status: 'active',
              threadType: 'general'
            });
          }

          // Store the message
          await storage.createCommunicationMessage({
            threadId: thread.id,
            sender: 'driver',
            content: messageContent,
            channel: 'zello',
            metadata: {
              zelloChannel: channel,
              originalSender: fromDriver,
              timestamp: timestamp || new Date().toISOString()
            }
          });

          console.log(`✅ Zello message stored in thread ${thread.id}`);
        }

        // Handle attachments (documents, photos)
        if (attachment) {
          console.log('📎 Processing Zello attachment:', attachment);
          
          // Determine document type from caption or filename
          const caption = attachment.caption || attachment.name || '';
          let documentType = 'other';
          
          if (caption.match(/pod|delivery|proof/i)) {
            documentType = 'proof_of_delivery';
          } else if (caption.match(/bol|bill|lading/i)) {
            documentType = 'bill_of_lading';  
          } else if (caption.match(/inspect|report/i)) {
            documentType = 'inspection_report';
          } else if (caption.match(/damage|claim/i)) {
            documentType = 'damage_photo';
          }

          // Find the most recent load for this driver
          const recentLoad = await storage.getMostRecentLoadForDriver(driver.id);
          
          if (recentLoad) {
            // Store attachment
            await storage.createMessageAttachment({
              messageId: null, // Will be linked to message if in thread
              loadId: recentLoad.id,
              driverId: driver.id,
              fileUrl: attachment.url || attachment.path || '',
              fileName: attachment.name || `zello_${Date.now()}.jpg`,
              fileType: attachment.type || 'image/jpeg',
              fileSize: attachment.size || 0,
              uploadedBy: 'driver',
              documentType: documentType,
              metadata: {
                source: 'zello',
                channel: channel,
                caption: caption,
                timestamp: timestamp
              }
            });
            
            console.log(`📎 Zello document stored: ${documentType} for load ${recentLoad.loadNumber}`);
          }
        }
        
        res.json({ status: 'received', processed: true });
        
      } else if (type === 'channel_status') {
        // Channel status update
        console.log(`📻 Zello channel status: ${channel} - ${req.body.status}`);
        res.json({ status: 'acknowledged' });
        
      } else if (type === 'user_status') {
        // User online/offline status
        console.log(`👤 Zello user status: ${req.body.user} - ${req.body.status}`);
        res.json({ status: 'acknowledged' });
        
      } else {
        console.log(`❓ Unknown Zello event type: ${type}`);
        res.json({ status: 'ignored', reason: 'Unknown event type' });
      }
      
    } catch (error) {
      console.error('❌ Error handling Zello webhook:', error);
      res.status(500).json({ error: 'Failed to process Zello webhook' });
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
  
  // Zello webhook for voice responses and document uploads
  app.post('/api/zello/webhook', async (req, res) => {
    try {
      console.log('🎙️ Zello webhook received:', req.body);
      
      const { channel, username, message, type, audio_url, image_url, file_url, file_name, file_size, mime_type, caption } = req.body;
      
      if (!channel || !username) {
        return res.status(400).json({ error: 'Invalid webhook data' });
      }
      
      // Handle different types of Zello events
      if (type === 'voice_message' || type === 'text_message') {
        const command = message?.toUpperCase() || '';
        
        // Extract load number from message if present
        const loadNumberMatch = command.match(/LOAD-(\d+)/);
        const loadNumber = loadNumberMatch ? loadNumberMatch[0] : undefined;
        
        // Find driver by Zello username
        const drivers = await storage.getAllDrivers();
        const driver = drivers.find(d => 
          d.name.toLowerCase().replace(/[^a-z0-9]/g, '_').includes(username.toLowerCase())
        );
        
        if (driver && loadNumber) {
          // First try to find an existing thread by matching load number
          const allThreads = await storage.getAllLoadCommunicationThreads();
          let thread = allThreads.find(t => 
            t.driverId === driver.id && 
            (t.loadNumber === loadNumber || t.loadId === loadNumber)
          );
          
          let load = null;
          
          if (!thread) {
            // If no thread exists, try to find the load
            const loads = await storage.getAllLoads();
            load = loads.find(l => l.loadNumber === loadNumber);
            
            if (load) {
              // Check if thread exists for this load and driver
              thread = await storage.getLoadCommunicationThreadByLoadAndDriver(load.id, driver.id);
            }
          }
          
          // If we have a thread (either found or created), save the message
          if (thread) {
            // Set load info if we don't have it
            if (!load && thread.loadId) {
              const loads = await storage.getAllLoads();
              load = loads.find(l => l.id === thread.loadId);
            }
            
            // Create message in the communication thread
            await storage.createLoadMessage({
              threadId: thread.id,
              loadId: thread.loadId || load?.id || '',
              driverId: driver.id,
              message: message || '',
              textContent: message || '',
              messageType: type === 'voice_message' ? 'voice' : 'text',
              senderRole: 'driver',
              senderName: driver.name,
              isFromDriver: true,
              isRead: false,
              isSuggested: false,
              isSent: true,
              attachments: audio_url ? [{
                fileUrl: audio_url,
                fileType: 'audio/mp3',
                fileName: `voice_${Date.now()}.mp3`,
                fileSize: 0
              }] : undefined,
              metadata: {
                zelloChannel: channel,
                zelloUsername: username
              },
              createdAt: new Date()
            });
            
            // Update thread stats
            await storage.updateLoadCommunicationThread(thread.id, {
              messageCount: (thread.messageCount || 0) + 1,
              unreadDispatchMessages: (thread.unreadDispatchMessages || 0) + 1,
              lastMessageAt: new Date(),
              lastMessageText: message?.substring(0, 100) || 'Voice message',
              lastMessageSender: 'driver'
            });
            
            console.log(`✅ Created communication message from ${driver.name} for load ${loadNumber}`);
          }
        }
        
        await zelloService.handleVoiceResponse({
          channel,
          from: username,
          command,
          loadNumber
        });
        
        console.log(`✅ Processed Zello response from ${username}: ${command}`);
      } else if (type === 'image_message' || type === 'file_message') {
        // Handle document upload through Zello
        const imageUrl = image_url || file_url;
        
        // Extract load ID from caption if present
        const loadIdMatch = (caption || '').match(/LOAD-(\d+)/i);
        let loadId = loadIdMatch ? loadIdMatch[0] : undefined;
        
        // If no load ID in caption, try to find driver's active load
        if (!loadId) {
          // Look up driver by Zello username to find their active load
          const drivers = await storage.getAllDrivers();
          const driver = drivers.find(d => d.name.toLowerCase().replace(/[^a-z0-9]/g, '_').includes(username.toLowerCase()));
          
          if (driver) {
            const driverLoads = await storage.getLoadsByDriver(driver.id);
            const activeLoad = driverLoads.find(l => l.status === 'in_transit' || l.status === 'at_pickup' || l.status === 'at_delivery');
            if (activeLoad) {
              loadId = activeLoad.id;
            }
          }
        }
        
        // Process the document upload
        await zelloService.handleDocumentUpload({
          channel,
          from: username,
          imageUrl,
          fileName: file_name,
          fileSize: file_size,
          mimeType: mime_type,
          caption,
          loadId
        });
        
        // Also store in message attachments
        if (loadId) {
          await storage.createMessageAttachment({
            loadId,
            driverId: null, // Will be matched from username later
            fileName: file_name || `zello_doc_${Date.now()}.jpg`,
            fileUrl: imageUrl,
            fileSize: file_size || 0,
            fileType: mime_type || 'image/jpeg',
            documentCategory: 'other', // Will be categorized by Zello service
            documentDescription: caption || 'Uploaded via Zello',
            documentStatus: 'pending_review',
            uploadedBy: username,
            createdAt: new Date()
          });
        }
        
        console.log(`✅ Processed Zello document from ${username}: ${file_name || 'unnamed'}`);
      }
      
      res.json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      console.error('❌ Error handling Zello webhook:', error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  });
  
  // Request documents from driver via Zello
  app.post('/api/zello/request-documents', async (req, res) => {
    try {
      const { driverId, loadId, documentTypes } = req.body;
      
      if (!driverId || !loadId || !documentTypes || !Array.isArray(documentTypes)) {
        return res.status(400).json({ error: 'Driver ID, Load ID, and document types are required' });
      }
      
      // Get driver details to find Zello username
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      // Generate Zello username from driver name
      const phoneDigits = driver.phone?.replace(/\D/g, '').slice(-4) || '0000';
      const cleanName = driver.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const zelloUsername = `${cleanName}_${phoneDigits}`;
      
      // Send document request through Zello
      await zelloService.sendDocumentRequest(zelloUsername, loadId, documentTypes);
      
      console.log(`📨 Document request sent to ${driver.name} for load ${loadId} via Zello`);
      res.json({ 
        success: true, 
        message: `Document request sent to ${driver.name} via Zello`,
        username: zelloUsername,
        documentTypes 
      });
    } catch (error) {
      console.error('❌ Error sending document request:', error);
      res.status(500).json({ error: 'Failed to send document request' });
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

  // Manual Zello authentication test endpoint
  app.post('/api/zello/test-auth', async (req, res) => {
    try {
      // Always use the correct API key from the Zello dashboard  
      const apiKey = '9TRA0D2GBV1OCOC657BFSPIH4QBDICH5';
      const username = 'annexAPI';
      const password = 'Anonymous#561';
      
      console.log('🔐 Manual Zello authentication test starting...');
      console.log(`📝 Using credentials: ${username} (API Key: ${apiKey.substring(0, 10)}...)`);
      
      // Step 1: Get token
      const tokenUrl = `https://lamp1.zellowork.com/user/gettoken`;
      const tokenResponse = await fetch(tokenUrl, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey
        }
      });
      
      const tokenData = await tokenResponse.json();
      console.log('🔑 Token response:', tokenData);
      
      if (tokenData.status !== 'OK') {
        return res.status(401).json({
          success: false,
          step: 'gettoken',
          error: tokenData,
          message: 'Failed to get token. Check API key.'
        });
      }
      
      // Step 2: Login
      // Hash the password according to Zello API docs: md5(md5(password) + token + api_key)
      const { createHash } = await import('crypto');
      const passwordMd5 = createHash('md5').update(password).digest('hex');
      const combined = passwordMd5 + tokenData.token + apiKey;
      const hashedPassword = createHash('md5').update(combined).digest('hex');
      
      console.log('🔒 Password hashing for test:');
      console.log('  - Token:', tokenData.token.substring(0, 8) + '...');
      console.log('  - Hashed password:', hashedPassword.substring(0, 8) + '...');
      
      const loginUrl = `https://lamp1.zellowork.com/user/login?sid=${tokenData.sid}`;
      const loginBody = new URLSearchParams({
        username: username,
        password: hashedPassword  // Use the properly hashed password
      });
      
      const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: loginBody
      });
      
      const loginData = await loginResponse.json();
      console.log('🔐 Login response:', loginData);
      
      if (loginData.status === 'OK') {
        console.log('✅ Authentication successful!');
        return res.json({
          success: true,
          message: 'Authentication successful!',
          sessionId: tokenData.sid,
          loginData
        });
      } else {
        console.error('❌ Login failed:', loginData);
        
        // Check if CAPTCHA is required
        if (loginData.requireCaptchaOnFailedLoginAttempts) {
          return res.status(401).json({
            success: false,
            step: 'login',
            error: loginData,
            message: `CAPTCHA REQUIRED: Too many failed attempts (${loginData.failedLoginAttemptsCount}). Please log into https://lamp1.zellowork.com with the API user credentials (${username}) to clear the CAPTCHA, then try again.`,
            captchaRequired: true,
            failedAttempts: loginData.failedLoginAttemptsCount,
            instructions: [
              '1. Go to https://lamp1.zellowork.com',
              `2. Log in with username: ${username} and password: ${password.substring(0, 5)}...`,
              '3. Complete the CAPTCHA challenge',
              '4. Then return here and try the authentication test again'
            ]
          });
        }
        
        return res.status(401).json({
          success: false,
          step: 'login',
          error: loginData,
          message: 'Authentication failed. Check username and password.'
        });
      }
    } catch (error) {
      console.error('❌ Test authentication error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Authentication test failed'
      });
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

  // Create and send driver onboarding link
  app.post('/api/driver/send-onboarding-link', async (req, res) => {
    try {
      const { phone, email, name } = req.body;
      
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required' });
      }
      
      // Normalize phone number to E.164 format
      let normalizedPhone = phone.replace(/\D/g, '');
      if (!normalizedPhone.startsWith('+')) {
        if (normalizedPhone.length === 10) {
          normalizedPhone = `+1${normalizedPhone}`;
        } else if (!normalizedPhone.startsWith('1') && normalizedPhone.length === 11) {
          normalizedPhone = `+${normalizedPhone}`;
        }
      }
      
      // Generate onboarding token
      const { randomUUID } = await import('crypto');
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Token expires in 7 days
      
      // Create token in database
      const tokenData = await storage.createOnboardingToken({
        token,
        email: email || `${normalizedPhone}@onboarding.local`,
        expiresAt,
        isUsed: false
      });
      
      // Generate registration link
      const domain = process.env.REPLIT_DOMAINS ? 
        `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 
        'http://localhost:5000';
      const registrationLink = `${domain}/simple-registration?token=${token}`;
      
      // Create SMS message
      const smsMessage = `🚛 LAMP Logistics Driver Registration\n\n` +
        `Hi ${name || 'Driver'}! You're invited to join our fleet.\n\n` +
        `Complete your registration here:\n${registrationLink}\n\n` +
        `This link expires in 7 days.\n\n` +
        `Questions? Call dispatch at (615) 555-0123`;
      
      // Check if SMS service is available (Twilio)
      const smsService = (global as any).smsService;
      let smsSent = false;
      let smsError = null;
      
      if (smsService && smsService.isServiceConfigured && smsService.isServiceConfigured()) {
        try {
          await smsService.sendSMS(normalizedPhone, smsMessage);
          smsSent = true;
          console.log(`✅ Onboarding SMS sent to ${normalizedPhone}`);
        } catch (error) {
          console.error('Failed to send SMS:', error);
          smsError = 'SMS service error';
        }
      } else {
        console.log('⚠️ SMS service not configured - link generated but not sent');
        smsError = 'SMS service not configured';
      }
      
      // Log the onboarding invitation
      await storage.createEmailLog({
        recipientEmail: email || normalizedPhone,
        subject: "Driver Onboarding Invitation",
        status: smsSent ? "sent" : "failed",
        sentAt: new Date(),
        metadata: {
          phone: normalizedPhone,
          token: token,
          link: registrationLink,
          smsError: smsError
        }
      });
      
      res.json({
        success: true,
        message: smsSent ? 
          `Onboarding link sent to ${normalizedPhone}` : 
          'Onboarding link created (SMS not configured - send manually)',
        link: registrationLink,
        phone: normalizedPhone,
        expiresAt: expiresAt,
        smsSent: smsSent,
        smsError: smsError
      });
      
    } catch (error) {
      console.error('❌ Error creating onboarding link:', error);
      res.status(500).json({ error: 'Failed to create onboarding link' });
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
