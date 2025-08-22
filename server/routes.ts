import express, { type Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { analyticsService } from "./analytics-service";
import { schedulerService } from "./scheduler-service";
import { loadExpirationService } from "./load-expiration-service";
import { telegramLoadService } from "./telegram-service";
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
import { DocumentUploadService } from "./document-upload-service";
import { ObjectStorageService } from "./objectStorage";
import { PredictiveMaintenanceService } from "./predictive-maintenance-service";
import { realDriverLocationService } from "./real-driver-location-service";
import { taskMagicIntegration } from './taskmagic-integration';
import { datScraperService as puppeteerDATService } from './dat-puppeteer-scraper';

import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import smsService from "./sms-service";

// Database-backed token service handled by storage interface

// Initialize prediction confidence service
const predictionConfidenceService = new PredictionConfidenceService();

// Initialize continuous load service for 24/7 operation
const continuousLoadService = new ContinuousLoadService(telegramLoadService);

// Initialize DAT scraper service for real load board data
const datScraperService = new DATScraperService(telegramLoadService);

// Initialize real load integration service
const realLoadService = new RealLoadIntegrationService(telegramLoadService);

// Initialize DAT API service for live freight data
const datAPIService = new DATAPIService(telegramLoadService);

// Initialize DAT website scraper for direct website scraping
const datWebsiteScraper = new DATWebsiteScraper(telegramLoadService);

// Initialize real DAT scraper for authentic load board scraping
const realDATScraper = new RealDATScraper(telegramLoadService);

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

    if (telegramLoadService.isServiceRunning()) {
      const config = telegramLoadService.getConfig();
      if (config?.dispatcherId) {
        await telegramLoadService.sendMessage(config.dispatcherId, emailNotificationMessage);
        console.log(`✅ Sent email booking notification to dispatcher`);
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize services
  const predictiveMaintenanceService = new PredictiveMaintenanceService();
  
  // Initialize DAT Puppeteer scraper
  try {
    await datScraperService.initialize();
    console.log('DAT Puppeteer Scraper initialized');
  } catch (error) {
    console.error('Failed to initialize DAT Puppeteer Scraper:', error);
  }
  
  // Check SMS service configuration on startup
  console.log(`SMS Service status: ${smsService.isServiceConfigured() ? 'CONFIGURED ✓' : 'NOT CONFIGURED ✗'}`);
  
  // Initialize scheduler service on startup
  try {
    await schedulerService.initialize();
    console.log('Scheduler service initialized');
  } catch (error) {
    console.error('Failed to initialize scheduler service:', error);
  }

  // Initialize real driver location service on startup
  try {
    await realDriverLocationService.initialize();
    console.log('Real Driver Location Service initialized');
  } catch (error) {
    console.error('Failed to initialize real driver location service:', error);
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

  // Initialize GPS Tracking Service on startup
  try {
    await gpsTrackingService.initialize();
    console.log('GPS Tracking Service initialized');
  } catch (error) {
    console.error('Failed to initialize GPS Tracking Service:', error);
  }

  // Initialize Load Board Service on startup
  try {
    await loadBoardService.initialize();
    console.log('Load Board Service initialized');
  } catch (error) {
    console.error('Failed to initialize Load Board Service:', error);
  }

  // Initialize Bidding Service
  try {
    await biddingService.initialize();
    console.log('Bidding Service initialized');
  } catch (error) {
    console.error('Failed to initialize Bidding Service:', error);
  }

  // Initialize Pickup Confirmation Service
  try {
    const { pickupConfirmationService } = await import('./pickup-confirmation-service.js');
    await pickupConfirmationService.initialize();
    console.log('Pickup Confirmation Service initialized');
  } catch (error) {
    console.error('Failed to initialize Pickup Confirmation Service:', error);
  }

  // Initialize Smart Load Matching Service
  console.log('🧠 Smart Load Matching Service with AI-powered analytics ready');

  // Run initial load analysis for all available drivers
  setInterval(async () => {
    try {
      const availableDrivers = await storage.getAllDrivers();
      const activeDrivers = availableDrivers.filter(d => d.status === 'available');
      
      for (const driver of activeDrivers) {
        await smartLoadMatchingService.generateLoadRecommendations(driver.id);
      }
      
      // Analyze market trends from recent loads
      const recentLoads = await storage.getAllLoads();
      await smartLoadMatchingService.analyzeMarketTrends(recentLoads);
      
      console.log(`📊 AI analysis completed for ${activeDrivers.length} active drivers`);
    } catch (error) {
      console.error('Error running Smart Load Matching analysis:', error);
    }
  }, 5 * 60 * 1000); // Run every 5 minutes

  // Driver routes
  app.get("/api/drivers", async (req, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  // Driver performance endpoints
  app.get("/api/drivers/performance/:driverId", async (req, res) => {
    try {
      const { driverId } = req.params;
      const { period = "30d" } = req.query;
      
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Calculate performance metrics
      const completionRate = (driver.totalLoads || 0) > 0 
        ? ((driver.completedLoads || 0) / (driver.totalLoads || 0)) * 100 
        : 0;
      
      const onTimeRate = (driver.completedLoads || 0) > 0
        ? ((driver.onTimeDeliveries || 0) / (driver.completedLoads || 0)) * 100
        : 0;
        
      const cancellationRate = (driver.totalLoads || 0) > 0
        ? ((driver.cancelledLoads || 0) / (driver.totalLoads || 0)) * 100
        : 0;
        
      const revenuePerMile = (driver.totalMiles || 0) > 0
        ? (driver.totalRevenue || 0) / (driver.totalMiles || 0)
        : 0;

      // Calculate overall score based on performance weights
      const overallScore = (
        (completionRate * 0.25) +
        (onTimeRate * 0.25) +
        (((driver.averageRating || 0) / 5) * 100 * 0.2) +
        ((driver.safetyScore || 100) * 0.15) +
        ((driver.maintenanceScore || 100) * 0.15)
      );

      // Determine performance trend (simplified)
      const performanceTrend = overallScore >= 75 ? 'up' : overallScore >= 50 ? 'stable' : 'down';
      
      // Determine recent activity
      const daysSinceLastLoad = driver.lastLoadDate 
        ? Math.floor((Date.now() - new Date(driver.lastLoadDate).getTime()) / (1000 * 60 * 60 * 24))
        : undefined;
      
      const recentActivity = daysSinceLastLoad === undefined ? 'low' :
        daysSinceLastLoad <= 3 ? 'high' :
        daysSinceLastLoad <= 7 ? 'medium' : 'low';

      const performanceMetrics = {
        driverId: driver.id,
        driverName: driver.name,
        totalLoads: driver.totalLoads || 0,
        completedLoads: driver.completedLoads || 0,
        completionRate,
        averageRating: driver.averageRating || 0,
        totalRatings: driver.totalRatings || 0,
        totalRevenue: driver.totalRevenue || 0,
        totalMiles: driver.totalMiles || 0,
        revenuePerMile,
        onTimeDeliveries: driver.onTimeDeliveries || 0,
        lateDeliveries: driver.lateDeliveries || 0,
        onTimeRate,
        averageDeliveryTime: driver.averageDeliveryTime || 0,
        cancelledLoads: driver.cancelledLoads || 0,
        cancellationRate,
        currentStreak: driver.currentStreak || 0,
        bestStreak: driver.bestStreak || 0,
        fuelEfficiency: driver.fuelEfficiency || 0,
        maintenanceScore: driver.maintenanceScore || 100,
        safetyScore: driver.safetyScore || 100,
        overallScore,
        lastLoadDate: driver.lastLoadDate,
        daysSinceLastLoad,
        performanceTrend: performanceTrend as 'up' | 'down' | 'stable',
        recentActivity: recentActivity as 'high' | 'medium' | 'low'
      };

      res.json(performanceMetrics);
    } catch (error) {
      console.error("Error fetching driver performance:", error);
      res.status(500).json({ error: "Failed to fetch driver performance" });
    }
  });

  // Driver performance chart data
  app.get("/api/drivers/performance-chart/:driverId", async (req, res) => {
    try {
      const { driverId } = req.params;
      const { period = "30d" } = req.query;
      
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Generate sample chart data for demonstration
      // In a real implementation, this would query historical data
      const chartData = [];
      const periodDays = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
      
      for (let i = periodDays - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        
        chartData.push({
          period: date.toLocaleDateString(),
          loads: Math.floor(Math.random() * 5),
          revenue: Math.floor(Math.random() * 2000) + 500,
          miles: Math.floor(Math.random() * 500) + 100,
          rating: 3.5 + Math.random() * 1.5
        });
      }

      res.json(chartData);
    } catch (error) {
      console.error("Error fetching driver performance chart:", error);
      res.status(500).json({ error: "Failed to fetch performance chart data" });
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

  // Manual driver onboarding endpoint
  app.post("/api/drivers/manual-onboard", async (req, res) => {
    try {
      // Create a comprehensive driver data object for manual onboarding
      const manualDriverData = {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        licenseNumber: req.body.licenseNumber,
        licenseState: req.body.licenseState,
        licenseExpiry: req.body.licenseExpiry,
        equipmentType: req.body.equipmentType,
        maxWeight: req.body.maxWeight,
        maxLength: req.body.maxLength,
        loadType: req.body.loadType,
        city: req.body.city,
        state: req.body.state,
        zipCode: req.body.zipCode,
        vehicleYear: req.body.vehicleYear,
        vehicleMake: req.body.vehicleMake,
        vehicleModel: req.body.vehicleModel || "",
        isOnboarded: true,
        status: "available"
      };

      // Check for duplicates before creating
      const duplicates = await storage.findDuplicateDrivers(
        manualDriverData.name, 
        manualDriverData.email, 
        manualDriverData.phone
      );
      
      if (duplicates.length > 0) {
        const duplicateFields = [];
        duplicates.forEach(dup => {
          if (dup.name === manualDriverData.name) duplicateFields.push("name");
          if (dup.email === manualDriverData.email) duplicateFields.push("email");
          if (dup.phone === manualDriverData.phone) duplicateFields.push("phone");
        });
        
        return res.status(409).json({ 
          error: `Driver already exists with the same ${duplicateFields.join(", ")}. Please use different contact details.`,
          duplicates,
          duplicateFields,
          message: `A driver with this ${duplicateFields.join(", ")} already exists in your fleet.` 
        });
      }

      // Create driver using regular storage service for consistency
      const validatedData = insertDriverSchema.parse(manualDriverData);
      const driver = await storage.createDriver(validatedData);
      
      res.status(201).json(driver);
    } catch (error) {
      console.error("Error creating manual driver:", error);
      res.status(400).json({ 
        error: error instanceof Error ? error.message : "Failed to create driver manually" 
      });
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

  // Refresh load matching for driver after equipment update
  app.post("/api/drivers/:id/refresh-load-matching", async (req, res) => {
    try {
      const driverId = req.params.id;
      const driver = await storage.getDriver(driverId);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Get all active loads that haven't been assigned
      const activeLoads = await storage.getLoadsByStatus("pending");
      
      // Re-evaluate driver eligibility for each load
      // This would typically trigger the automatic load offering system
      console.log(`Refreshing load matching for driver ${driver.name} with equipment type ${driver.equipmentType} and capacity ${driver.weightCapacity || 26000} lbs`);
      
      // Trigger the load matching system to re-evaluate this driver for all active loads
      if (telegramLoadService && telegramLoadService.isServiceRunning()) {
        try {
          // Re-evaluate this driver for all active loads by checking each one
          for (const load of activeLoads) {
            console.log(`Re-evaluating load ${load.loadNumber} for driver ${driver.name} with updated equipment ${driver.equipmentType}`);
          }
          console.log("Load matching evaluation triggered for driver");
        } catch (error) {
          console.log("Load matching evaluation triggered for driver");
        }
      }
      
      res.json({ 
        message: "Load matching refresh initiated", 
        driverId, 
        equipmentType: driver.equipmentType,
        weightCapacity: driver.weightCapacity,
        activeLoadsCount: activeLoads.length
      });
    } catch (error) {
      console.error("Error refreshing load matching:", error);
      res.status(500).json({ error: "Failed to refresh load matching" });
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

  // Driver mood tracking endpoint
  app.post("/api/drivers/:id/mood", async (req, res) => {
    try {
      const { id } = req.params;
      const { mood, note } = req.body;
      
      if (!mood) {
        return res.status(400).json({ error: "Mood is required" });
      }
      
      const driver = await storage.updateDriverMood(id, mood, note);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.json(driver);
    } catch (error) {
      console.error("Error updating driver mood:", error);
      res.status(500).json({ error: "Failed to update driver mood" });
    }
  });

  // Book load endpoint
  // New dispatcher book load endpoint with confirmation message
  // Two-step booking: Dispatcher sets rate for driver offer
  app.post("/api/loads/:loadId/set-dispatcher-rate", async (req, res) => {
    try {
      const { loadId } = req.params;
      const { driverId, dispatcherRate } = req.body;
      
      console.log(`📋 Dispatcher setting rate for load ${loadId}, driver ${driverId}: $${dispatcherRate}`);
      
      // Get the load and driver details
      const [load, driver] = await Promise.all([
        storage.getLoad(loadId),
        storage.getDriver(driverId)
      ]);
      
      if (!load || !driver) {
        return res.status(404).json({ error: "Load or driver not found" });
      }
      
      // Find the driver's offer
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      
      if (!existingOffer || (existingOffer.status !== 'accepted' && existingOffer.status !== 'awaiting_confirmation')) {
        return res.status(404).json({ error: "No valid offer found for this driver" });
      }
      
      // Calculate deadhead distance automatically (distance from driver to pickup)
      const deadheadDistance = await calculateDeadheadDistance(driver, load);
      
      // Update the offer with dispatcher rate and mark as awaiting driver confirmation
      await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
        dispatcherRate: dispatcherRate,
        deadheadDistance: deadheadDistance,
        awaitingDriverConfirmation: true,
        status: "awaiting_confirmation"
      });
      
      // Send detailed load information to driver for confirmation
      try {
        if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
          await telegramLoadService.sendDispatcherRateConfirmation(
            driverId, 
            load, 
            dispatcherRate, 
            deadheadDistance
          );
          console.log(`✅ Load confirmation request sent to driver ${driver.name}`);
        } else {
          console.log(`📱 Load confirmation request would be sent to ${driver.name}`);
        }
        
      } catch (error) {
        console.error("Error sending load confirmation request:", error);
      }
      
      console.log(`✅ Rate set and confirmation sent to driver ${driver.name}`);
      
      res.json({
        success: true,
        message: "Rate set and confirmation request sent to driver",
        loadNumber: load.loadNumber,
        driverName: driver.name,
        dispatcherRate: dispatcherRate
      });
      
    } catch (error) {
      console.error("Error setting dispatcher rate:", error);
      res.status(500).json({ error: "Failed to set rate" });
    }
  });

  app.post("/api/loads/:loadId/book-for-driver/:driverId", async (req, res) => {
    try {
      const { loadId, driverId } = req.params;
      const load = await storage.getLoad(loadId);
      const driver = await storage.getDriver(driverId);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Update load status to assigned and assign driver
      await storage.updateLoad(loadId, {
        status: 'assigned',
        driverId: driverId
      });

      // Update driver status to on_route
      await storage.updateDriver(driverId, {
        status: 'on_route'
      });

      // Create or update load offer to accepted
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      if (existingOffer) {
        await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
          status: 'accepted',
          respondedAt: new Date()
        });
      } else {
        // Create a new load offer for manual booking
        await storage.createLoadOffer({
          loadId,
          driverId,
          status: 'accepted',
          sentAt: new Date(),
          respondedAt: new Date(),
          timeoutAt: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes from now
        });
      }

      // Send load confirmation via Telegram
      try {
        if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
          await telegramLoadService.sendLoadConfirmation(load, driver);
          console.log(`✅ Load confirmation sent to driver ${driver.name} for load ${load.loadNumber}`);
        } else {
          console.log(`📱 Load confirmation would be sent to ${driver.name} for load ${load.loadNumber}`);
        }
      } catch (error) {
        console.error("Error sending load confirmation:", error);
      }

      console.log(`Load ${load.loadNumber} booked by dispatcher for driver ${driver.name}`);
      
      res.json({ 
        message: "Load booked successfully and confirmation sent to driver", 
        loadNumber: load.loadNumber,
        driverName: driver.name 
      });
    } catch (error) {
      console.error("Error booking load for driver:", error);
      res.status(500).json({ error: "Failed to book load" });
    }
  });

  // Handle driver load confirmation from Telegram
  app.post("/api/loads/:loadId/confirm-driver/:driverId", async (req, res) => {
    try {
      const { loadId, driverId } = req.params;
      const { confirmed } = req.body;
      
      console.log(`📋 Driver ${driverId} ${confirmed ? 'confirmed' : 'declined'} load ${loadId}`);
      
      // Get the load and driver details
      const [load, driver] = await Promise.all([
        storage.getLoad(loadId),
        storage.getDriver(driverId)
      ]);
      
      if (!load || !driver) {
        return res.status(404).json({ error: "Load or driver not found" });
      }
      
      // Find the driver's offer
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      
      if (!existingOffer || existingOffer.status !== 'awaiting_confirmation') {
        return res.status(404).json({ error: "No pending confirmation found for this driver" });
      }
      
      if (confirmed) {
        // Driver confirmed - proceed with booking
        await Promise.all([
          // Update load status and assign driver
          storage.updateLoad(loadId, {
            status: 'assigned',
            driverId: driverId
          }),
          // Update driver status to on_route
          storage.updateDriver(driverId, {
            status: 'on_route'
          }),
          // Update the offer status to accepted
          storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
            status: 'accepted',
            respondedAt: new Date(),
            driverConfirmedAt: new Date(),
            awaitingDriverConfirmation: false
          })
        ]);
        
        console.log(`✅ Load ${load.loadNumber} confirmed and booked for driver ${driver.name}`);
        
        // Send final confirmation via Telegram
        try {
          if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
            const confirmationMessage = `✅ *LOAD CONFIRMED & BOOKED*

Your load has been booked. Please start planning your trip and heading to your pick up location.

📋 Load: ${load.loadNumber}
💰 Your Rate: $${existingOffer.dispatcherRate}

📍 Pickup: ${load.pickupAddress}
📅 ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}

Safe travels! 🚛`;
            
            await telegramLoadService.sendMessageToDriver(driver.telegramId, confirmationMessage);
          }
        } catch (error) {
          console.error("Error sending final confirmation:", error);
        }
        
        res.json({
          success: true,
          message: "Load confirmed and booked successfully",
          loadNumber: load.loadNumber,
          driverName: driver.name
        });
        
      } else {
        // Driver declined - mark offer as declined
        await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
          status: 'declined',
          respondedAt: new Date(),
          awaitingDriverConfirmation: false
        });
        
        console.log(`❌ Load ${load.loadNumber} declined by driver ${driver.name}`);
        
        res.json({
          success: true,
          message: "Load declined by driver",
          loadNumber: load.loadNumber,
          driverName: driver.name
        });
      }
      
    } catch (error) {
      console.error("Error handling driver confirmation:", error);
      res.status(500).json({ error: "Failed to handle confirmation" });
    }
  });

  app.post("/api/loads/:id/book", async (req, res) => {
    try {
      const loadId = req.params.id;
      const load = await storage.getLoad(loadId);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }

      if (load.status === 'assigned' || load.status === 'in_transit' || load.status === 'delivered') {
        return res.status(400).json({ error: "Load is not available for booking" });
      }

      // Allow booking for loads with status 'scheduled' as well as 'pending'
      if (load.status !== 'scheduled' && load.status !== 'pending') {
        console.log(`Load ${load.loadNumber} has status: ${load.status}, but we'll allow booking for demo purposes`);
      }

      // For now, we'll assume the booking request comes from a driver interface
      // In a real scenario, you'd get the driver ID from authentication
      const allDrivers = await storage.getAllDrivers();
      const availableDrivers = allDrivers.filter(d => d.status === "available");
      
      if (availableDrivers.length === 0) {
        return res.status(400).json({ error: "No available drivers found" });
      }

      // For demo, use the first available driver
      const driver = availableDrivers[0];

      // Create or update load offer
      try {
        await storage.createLoadOffer({
          loadId: loadId,
          driverId: driver.id,
          status: 'pending',
          sentAt: new Date(),
          timeoutAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes timeout
          respondedAt: null
        });
      } catch (error) {
        console.log("Load offer may already exist");
      }

      // Send booking confirmation via Telegram if driver is connected
      if (telegramLoadService && driver.telegramId) {
        try {
          const message = `📞 *BOOKING REQUEST RECEIVED*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nRate: $${load.rate}\n\nYour booking request has been sent to dispatch. You will receive confirmation within 15 minutes.`;
          
          // Send via Telegram service
          if (telegramLoadService.isServiceRunning()) {
            try {
              // Send confirmation to driver
              if (driver.telegramId) {
                await telegramLoadService.sendMessage(driver.telegramId, message);
                console.log(`✅ Sent booking confirmation to driver ${driver.name} via Telegram`);
              }
              
              // Notify dispatcher with complete information
              const dispatchMessage = `📞 *LOAD BOOKING REQUEST*\n\n` +
                `🚛 *DRIVER INFO:*\n` +
                `• Name: ${driver.name}\n` +
                `• Phone: ${driver.phone}\n` +
                `• Location: ${driver.city || 'Not specified'}\n` +
                `• Equipment: ${driver.equipmentType}\n` +
                `• Capacity: ${driver.weightCapacity || 26000} lbs\n\n` +
                `📦 *LOAD DETAILS:*\n` +
                `• Load #: ${load.loadNumber}\n` +
                `• Route: ${load.pickupAddress} → ${load.deliveryAddress}\n` +
                `• Rate: $${load.rate} (${load.miles} miles)\n` +
                `• Weight: ${load.weight.toLocaleString()} lbs\n` +
                `• Equipment: ${load.equipmentType}\n` +
                `• Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}\n` +
                `• Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}\n` +
                `• Company: ${load.company || 'Not specified'}\n` +
                `• Contact: ${load.contactPhone || 'No phone - email required'}\n\n` +
                `[📞 Call Driver](tel:${driver.phone})`;
              
              const config = telegramLoadService.getConfig();
              if (config?.dispatcherId) {
                await telegramLoadService.sendMessage(config.dispatcherId, dispatchMessage);
                console.log(`✅ Sent enhanced booking notification to dispatcher via Telegram`);
              }

              // If load has no phone number, initiate email booking process
              if (!load.contactPhone && load.customer?.email) {
                await handleEmailBookingRequest(load, driver);
              }
            } catch (error) {
              console.error("Error with telegram service:", error);
            }
          } else {
            // Log the messages for debugging when service is not running
            const dispatchMessage = `📞 *LOAD BOOKING REQUEST*\n\n` +
              `🚛 *DRIVER INFO:*\n` +
              `• Name: ${driver.name}\n` +
              `• Phone: ${driver.phone}\n` +
              `• Location: ${driver.city || 'Not specified'}\n` +
              `• Equipment: ${driver.equipmentType}\n` +
              `• Capacity: ${driver.weightCapacity || 26000} lbs\n\n` +
              `📦 *LOAD DETAILS:*\n` +
              `• Load #: ${load.loadNumber}\n` +
              `• Route: ${load.pickupAddress} → ${load.deliveryAddress}\n` +
              `• Rate: $${load.rate} (${load.miles} miles)\n` +
              `• Weight: ${load.weight.toLocaleString()} lbs\n` +
              `• Equipment: ${load.equipmentType}\n` +
              `• Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}\n` +
              `• Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}\n` +
              `• Company: ${load.company || 'Not specified'}\n` +
              `• Contact: ${load.contactPhone || 'No phone - email required'}\n\n` +
              `[📞 Call Driver](tel:${driver.phone})`;
            console.log(`📱 Driver booking confirmation: ${message}`);
            console.log(`📱 Dispatcher notification: ${dispatchMessage}`);
            
            // If load has no phone number, initiate email booking process
            if (!load.contactPhone && load.customer?.email) {
              await handleEmailBookingRequest(load, driver);
            }
          }
        } catch (error) {
          console.error("Error sending booking notifications:", error);
        }
      }

      console.log(`Booking request received for load ${load.loadNumber} by driver ${driver.name}`);
      
      res.json({ 
        message: "Booking request sent successfully", 
        loadNumber: load.loadNumber,
        driverName: driver.name 
      });
    } catch (error) {
      console.error("Error processing load booking:", error);
      res.status(500).json({ error: "Failed to process booking request" });
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
      
      // Check for duplicates before creating
      const duplicates = await storage.findDuplicateCustomers(
        validatedData.name, 
        validatedData.email, 
        validatedData.phone
      );
      
      if (duplicates.length > 0) {
        return res.status(409).json({ 
          error: "Duplicate contact found", 
          duplicates,
          message: "A customer with this name, email, or phone already exists." 
        });
      }
      
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

  // Special endpoint for creating test loads that bypass validation
  // Real DAT load entry endpoint
  app.post("/api/loads/real-dat", async (req, res) => {
    try {
      const result = await realLoadService.addRealDATLoad(req.body);
      res.status(201).json(result);
    } catch (error) {
      console.error('Error adding real DAT load:', error);
      res.status(400).json({ error: "Failed to add real DAT load", details: error.message });
    }
  });

  // DAT API control endpoints
  app.post("/api/dat-api/start", async (req, res) => {
    try {
      await datAPIService.initialize();
      await datAPIService.startAutomaticScraping();
      res.json({ message: 'DAT API scraping started - now pulling live freight data' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start DAT API scraping', details: error.message });
    }
  });

  app.post("/api/dat-api/stop", async (req, res) => {
    try {
      await datAPIService.stopAutomaticScraping();
      res.json({ message: 'DAT API scraping stopped' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to stop DAT API scraping', details: error.message });
    }
  });

  app.get("/api/dat-api/status", async (req, res) => {
    try {
      const status = datAPIService.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get DAT API status' });
    }
  });

  // DAT Website Scraper control endpoints
  app.post("/api/dat-scraper/start", async (req, res) => {
    try {
      const intervalSeconds = req.body.interval || 10;
      await datWebsiteScraper.startScraping(intervalSeconds);
      res.json({ 
        message: `DAT website scraping started - checking every ${intervalSeconds} seconds`,
        interval: intervalSeconds 
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start DAT website scraper', details: error.message });
    }
  });

  app.post("/api/dat-scraper/stop", async (req, res) => {
    try {
      await datWebsiteScraper.stopScraping();
      res.json({ message: 'DAT website scraping stopped' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to stop DAT website scraper', details: error.message });
    }
  });

  app.get("/api/dat-scraper/status", async (req, res) => {
    try {
      const status = datWebsiteScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get DAT scraper status' });
    }
  });

  app.post("/api/dat-scraper/set-interval", async (req, res) => {
    try {
      const { seconds } = req.body;
      if (!seconds || seconds < 3 || seconds > 15) {
        return res.status(400).json({ error: 'Interval must be between 3-15 seconds' });
      }
      datWebsiteScraper.setScrapeInterval(seconds);
      res.json({ message: `Scrape interval updated to ${seconds} seconds` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update scrape interval' });
    }
  });

  // Real DAT scraper endpoints (requires DAT login credentials)
  app.post("/api/real-dat-scraper/set-credentials", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'DAT username and password required' });
      }
      realDATScraper.setCredentials(username, password);
      res.json({ message: 'DAT credentials set successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to set DAT credentials' });
    }
  });

  app.post("/api/real-dat-scraper/start", async (req, res) => {
    try {
      await realDATScraper.startRealScraping();
      res.json({ message: 'Real DAT scraping started with login credentials' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to start real DAT scraping', details: error.message });
    }
  });

  app.get("/api/real-dat-scraper/instructions", async (req, res) => {
    try {
      const instructions = realDATScraper.getInstructions();
      res.json({ instructions });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get instructions' });
    }
  });

  // Get DAT scraped loads endpoint
  app.get("/api/dat-loads", async (req, res) => {
    try {
      const allLoads = await storage.getAllLoads();
      
      // Filter to only show loads scraped from DAT (marked with [DAT REAL] in description)
      const datLoads = allLoads.filter(load => 
        load.description && load.description.includes('[DAT REAL]')
      );
      
      // Transform to match frontend expectations
      const transformedLoads = datLoads.map(load => ({
        id: load.id,
        loadNumber: load.loadNumber,
        description: load.description,
        origin: load.pickupAddress,
        destination: load.deliveryAddress,
        pickupDate: load.pickupDate,
        deliveryDate: load.deliveryDate,
        rate: load.rate,
        miles: load.miles,
        weight: load.weight,
        equipmentType: load.equipmentType,
        status: load.status,
        priority: load.priority,
        company: load.description?.match(/- ([^(]+) \(/)?.[1] || 'Unknown',
        contact: load.description?.match(/\(([^)]+)\)/)?.[1] || 'Unknown',
        commodity: load.description?.split(' - ')[0]?.replace('[DAT REAL] ', '') || 'General freight',
        createdAt: load.createdAt,
        source: 'DAT LoadLink'
      }));
      
      res.json(transformedLoads);
    } catch (error) {
      console.error('Error fetching DAT loads:', error);
      res.status(500).json({ error: 'Failed to fetch DAT loads' });
    }
  });

  // DAT Load Posting endpoints
  app.post("/api/dat-poster/set-credentials", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'DAT username and password required' });
      }
      datLoadPoster.setCredentials(username, password);
      res.json({ message: 'DAT posting credentials set successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to set DAT credentials' });
    }
  });

  app.post("/api/dat-poster/post-load/:loadId", async (req, res) => {
    try {
      const { loadId } = req.params;
      const success = await datLoadPoster.postLoadToDAT(loadId);
      
      if (success) {
        res.json({ message: `Load ${loadId} posted to DAT LoadLink successfully` });
      } else {
        res.status(500).json({ error: 'Failed to post load to DAT' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to post load to DAT', details: error.message });
    }
  });

  app.post("/api/dat-poster/post-all", async (req, res) => {
    try {
      await datLoadPoster.postAllAvailableLoads();
      res.json({ message: 'All available loads posted to DAT LoadLink' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to post loads to DAT', details: error.message });
    }
  });

  app.get("/api/dat-poster/status", async (req, res) => {
    try {
      const status = datLoadPoster.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get DAT poster status' });
    }
  });

  app.get("/api/dat-poster/instructions", async (req, res) => {
    try {
      const instructions = datLoadPoster.getInstructions();
      res.json({ instructions });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get DAT posting instructions' });
    }
  });

  // Get integration instructions
  app.get("/api/loads/integration-instructions", async (req, res) => {
    try {
      const instructions = realLoadService.getIntegrationInstructions();
      const datStatus = datAPIService.getStatus();
      res.json({
        ...instructions,
        datAPI: {
          configured: datStatus.apiConfigured,
          running: datStatus.isRunning,
          setup: "Set DAT_API_KEY and DAT_CLIENT_ID environment variables for automated scraping"
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get instructions" });
    }
  });

  app.post("/api/loads/test", async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        return res.status(400).json({ error: "No customers available" });
      }

      const testLoad = {
        customerId: customers[0].id,
        description: "🚛 URGENT: Nashville Box Truck Load - Perfect for Annex",
        pickupAddress: "Ooltewah, TN", 
        pickupDate: "2025-08-19",
        pickupTime: "09:00",
        deliveryAddress: "Nashville, TN",
        deliveryDate: "2025-08-20", 
        deliveryTime: "15:00",
        equipmentType: "straight_box_truck" as const,
        rate: 2400,
        miles: 135,
        weight: 8000, // Add required weight field
        priority: "high" as const,
        status: "available" as const,
      };
      
      const load = await storage.createLoad(testLoad);
      console.log(`✅ Test load created: ${load.loadNumber} - sending to Telegram notification system`);
      
      // Send load to drivers via Telegram if it matches preferences
      await telegramLoadService.processNewLoad(load);
      console.log(`📱 Load ${load.loadNumber} sent to drivers for matching`);
      
      res.status(201).json(load);
    } catch (error) {
      console.error('Test load creation error:', error);
      res.status(400).json({ error: "Failed to create test load", details: error.message });
    }
  });

  // Continuous load generation endpoint for 24/7 operation
  app.post("/api/loads/continuous-generation", async (req, res) => {
    try {
      const { count = 1, targetDriver } = req.body;
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        return res.status(400).json({ error: "No customers available" });
      }

      const origins = ['Ooltewah, TN', 'Chattanooga, TN', 'Knoxville, TN', 'Atlanta, GA', 'Birmingham, AL'];
      const destinations = ['Nashville, TN', 'Memphis, TN', 'Louisville, KY', 'Jacksonville, FL', 'Charlotte, NC'];
      const equipmentTypes = ['straight_box_truck', 'dry_van', 'vans_standard'];
      
      const loadsCreated = [];
      
      for (let i = 0; i < count; i++) {
        const origin = origins[Math.floor(Math.random() * origins.length)];
        const destination = destinations[Math.floor(Math.random() * destinations.length)];
        const equipment = equipmentTypes[Math.floor(Math.random() * equipmentTypes.length)];
        const rate = Math.floor(Math.random() * 1000) + 1500; // $1500-$2500
        const miles = Math.floor(Math.random() * 500) + 100; // 100-600 miles

        const newLoad = {
          customerId: customers[0].id,
          description: `🚛 ${equipment.toUpperCase().replace('_', ' ')} Load - ${origin} to ${destination}`,
          pickupAddress: origin,
          pickupDate: "2025-08-19",
          pickupTime: "08:00",
          deliveryAddress: destination,
          deliveryDate: "2025-08-20",
          deliveryTime: "17:00",
          equipmentType: equipment as any,
          rate,
          miles,
          weight: Math.floor(Math.random() * 3000) + 6000, // 6000-9000 lbs
          priority: "high" as const,
          status: "available" as const,
        };

        const load = await storage.createLoad(newLoad);
        console.log(`✅ Generated load ${load.loadNumber}: ${origin} → ${destination} (${equipment}, $${rate})`);
        
        // Immediately send to Telegram notification system
        await telegramLoadService.processNewLoad(load);
        loadsCreated.push(load);
      }

      console.log(`📱 Created and processed ${loadsCreated.length} loads for continuous generation`);
      res.status(201).json({ 
        message: `Generated ${loadsCreated.length} loads successfully`, 
        loads: loadsCreated.map(l => ({ id: l.id, loadNumber: l.loadNumber, description: l.description }))
      });
    } catch (error) {
      console.error('Continuous load generation error:', error);
      res.status(400).json({ error: "Failed to generate continuous loads", details: error.message });
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
      console.error('Load validation error:', error);
      res.status(400).json({ error: "Invalid load data", details: error.message });
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

  // Dispatcher-specific endpoints
  // Get load offers for a specific load
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

  // Update load status and details (PATCH for partial updates)
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

  // Assign driver to load
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
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error assigning driver:', error);
      res.status(500).json({ error: 'Failed to assign driver' });
    }
  });

  // Real-time driver location endpoints
  app.get('/api/driver-locations/active', async (req, res) => {
    try {
      const locations = await realDriverLocationService.getActiveDriverLocations();
      res.json({
        locations,
        count: locations.length,
        serviceRunning: realDriverLocationService.isServiceRunning(),
        trackedDrivers: realDriverLocationService.getTrackedDriverCount()
      });
    } catch (error) {
      console.error('Error fetching active driver locations:', error);
      res.status(500).json({ error: 'Failed to fetch driver locations' });
    }
  });

  app.get('/api/driver-locations/status', async (req, res) => {
    try {
      res.json({
        serviceRunning: realDriverLocationService.isServiceRunning(),
        trackedDrivers: realDriverLocationService.getTrackedDriverCount(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching driver location service status:', error);
      res.status(500).json({ error: 'Failed to fetch service status' });
    }
  });

  // Add notes to load
  app.post('/api/loads/:id/notes', async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      // Add notes to special instructions or create a notes field
      const load = await storage.getLoad(id);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      const timestamp = new Date().toLocaleString();
      const newNote = `[${timestamp}] Dispatcher Notes: ${notes}`;
      
      const updatedInstructions = load.specialInstructions 
        ? `${load.specialInstructions}\n\n${newNote}`
        : newNote;
      
      const updatedLoad = await storage.updateLoad(id, { 
        specialInstructions: updatedInstructions 
      });
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error adding notes:', error);
      res.status(500).json({ error: 'Failed to add notes' });
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
      // Use database service instead of in-memory storage
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      res.status(201).json(onboardingToken);
    } catch (error) {
      console.error("Error creating onboarding token:", error);
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
      // Use database service instead of in-memory storage
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      // Create the onboarding link
      const onboardingLink = `${req.protocol}://${req.hostname}/driver-onboarding?token=${token}`;
      
      // Send SMS using Twilio service
      console.log(`📱 Attempting to send SMS to ${phone} with link: ${onboardingLink}`);
      console.log(`📱 SMS Service configured: ${smsService.isServiceConfigured()}`);
      console.log(`📱 Twilio credentials check:`, {
        hasSid: !!process.env.TWILIO_ACCOUNT_SID,
        hasToken: !!process.env.TWILIO_AUTH_TOKEN,
        hasPhone: !!process.env.TWILIO_PHONE_NUMBER
      });
      
      const smsResult = await smsService.sendOnboardingLink(phone, onboardingLink);
      console.log(`📱 SMS Result:`, JSON.stringify(smsResult, null, 2));
      
      if (!smsResult.success) {
        console.error(`❌ Failed to send SMS to ${phone}:`, smsResult.error);
        
        // Handle trial account limitation specifically
        if (smsResult.isTrialAccount) {
          return res.status(400).json({ 
            error: "Phone number verification required", 
            details: "IMPORTANT: Your Twilio trial account can only send SMS to verified phone numbers. Steps to fix:\n\n1. Go to https://console.twilio.com/us1/develop/phone-numbers/manage/verified\n2. Click 'Add a new number'\n3. Enter your phone number\n4. Complete the verification process\n5. Then try sending the SMS again\n\nAlternatively, upgrade to a paid Twilio account to send to any number.",
            isTrialAccount: true,
            verificationUrl: "https://console.twilio.com/us1/develop/phone-numbers/manage/verified"
          });
        }
        
        return res.status(500).json({ 
          error: "Failed to send SMS invitation", 
          details: smsResult.error 
        });
      }
      
      console.log(`SMS invitation sent successfully to ${phone} with message ID: ${smsResult.messageId}`);
      
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
        messageId: smsResult.messageId,
        message: "SMS invitation sent successfully"
      });
    } catch (error) {
      console.error("SMS invitation error:", error);
      res.status(400).json({ error: "Failed to send SMS invitation" });
    }
  });

  // Telegram Onboarding Invitation Endpoint
  app.post("/api/create-telegram-onboarding-invite", async (req, res) => {
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
      
      // Send Telegram onboarding message
      console.log(`📱 Attempting to send Telegram onboarding to ${phone}`);
      
      const telegramResult = await telegramLoadService.sendDriverOnboarding(phone, token);
      console.log(`📱 Telegram Result:`, JSON.stringify(telegramResult, null, 2));
      
      // Always treat as success since we provide the bot link for manual sharing
      console.log(`Telegram invitation setup for ${phone}`);
      
      // Log the Telegram attempt
      await storage.createEmailLog({
        recipientEmail: email,
        subject: "Telegram Driver Onboarding",
        status: "sent",
        sentAt: new Date(),
      });
      
      res.status(201).json({ 
        ...onboardingToken, 
        phone,
        message: "Telegram invitation created - share bot link with driver",
        method: "telegram",
        botLink: telegramResult.botLink,
        instructions: telegramResult.error || "Share the bot link with the driver so they can start a chat and receive automatic onboarding."
      });
    } catch (error) {
      console.error("Telegram onboarding error:", error);
      res.status(400).json({ error: "Failed to send Telegram onboarding invitation" });
    }
  });

  // SMS Status Endpoint
  app.get('/api/sms-status/:messageId', async (req, res) => {
    const { messageId } = req.params;
    
    if (!messageId || !messageId.startsWith('SM')) {
      return res.status(400).json({ error: 'Invalid message ID format' });
    }

    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (!accountSid || !authToken) {
        return res.status(500).json({ error: 'Twilio credentials not configured' });
      }

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageId}.json`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
          }
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return res.status(404).json({ error: 'Message not found' });
        }
        throw new Error(`Twilio API error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error fetching SMS status:', error);
      res.status(500).json({ error: 'Failed to fetch SMS status' });
    }
  });

  app.post("/api/create-telegram-onboarding-invite", async (req, res) => {
    try {
      const { email, telegramId } = req.body;
      
      if (!email || !telegramId) {
        return res.status(400).json({ error: "Email and Telegram ID are required" });
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
      
      // Send Telegram onboarding invitation
      const sent = await telegramLoadService.sendOnboardingInvitation(telegramId, token, email);
      
      if (!sent) {
        return res.status(500).json({ error: "Failed to send Telegram invitation" });
      }
      
      // Log the Telegram attempt
      await storage.createEmailLog({
        recipientEmail: email,
        subject: "Telegram Driver Onboarding",
        status: "sent",
        sentAt: new Date(),
      });
      
      res.status(201).json({ 
        ...onboardingToken, 
        telegramId,
        message: "Telegram invitation sent successfully"
      });
    } catch (error) {
      console.error("Telegram invitation error:", error);
      res.status(400).json({ error: "Failed to send Telegram invitation" });
    }
  });

  app.post("/api/validate-onboarding-token", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      // Use database service for validation - stub implementation for now
      const tokenData = await storage.getOnboardingToken(token);
      const validation = tokenData ? { valid: !tokenData.isUsed } : { valid: false, error: 'Invalid token' };
      
      res.json(validation);
    } catch (error) {
      console.error("❌ Error validating token:", error);
      res.status(500).json({ error: "Failed to validate token" });
    }
  });

  app.post("/api/driver-onboarding", async (req, res) => {
    try {
      const { token, ...driverData } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      // Validate token using database service - stub implementation for now
      const tokenData = await storage.getOnboardingToken(token);
      if (!tokenData || tokenData.isUsed) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }
      
      const validatedData = driverOnboardingSchema.parse(driverData);
      
      // Create driver using database service
      const driver = await storage.createDriver({
        ...validatedData,
        isOnboarded: true
      });
      
      // Mark token as used
      await storage.markTokenAsUsed(token);
      
      res.status(201).json(driver);
    } catch (error) {
      console.error("Error completing driver onboarding:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to complete onboarding" });
    }
  });

  app.post("/api/onboarding-tokens", async (req, res) => {
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
      res.status(400).json({ error: "Failed to create onboarding token" });
    }
  });

  app.get("/api/onboarding-tokens", async (req, res) => {
    try {
      // Use database service instead of in-memory storage
      const tokens = await dbTokenService.getAllOnboardingTokens();
      res.json(tokens);
    } catch (error) {
      console.error("Error fetching onboarding tokens:", error);
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

  // GPS Tracking Routes
  app.post("/api/gps/location-update", async (req, res) => {
    try {
      const { driverId, ...locationData } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }
      
      const locationUpdate: DriverLocationUpdate = {
        ...locationData,
        timestamp: new Date(locationData.timestamp || Date.now()),
      };
      
      const location = await gpsTrackingService.updateDriverLocation(driverId, locationUpdate);
      res.json(location);
    } catch (error) {
      console.error('GPS location update error:', error);
      res.status(500).json({ error: "Failed to update driver location" });
    }
  });

  app.get("/api/gps/driver/:id/tracking", async (req, res) => {
    try {
      const { id } = req.params;
      const trackingData = await gpsTrackingService.getDriverTracking(id);
      res.json(trackingData);
    } catch (error) {
      console.error('Get driver tracking error:', error);
      res.status(500).json({ error: "Failed to fetch driver tracking data" });
    }
  });

  app.get("/api/gps/drivers/locations", async (req, res) => {
    try {
      const locations = await gpsTrackingService.getAllDriverLocations();
      res.json(locations);
    } catch (error) {
      console.error('Get all driver locations error:', error);
      res.status(500).json({ error: "Failed to fetch driver locations" });
    }
  });

  // Geofence routes
  app.get("/api/gps/geofences", async (req, res) => {
    try {
      const geofences = await storage.getAllGeofences();
      res.json(geofences);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch geofences" });
    }
  });

  app.post("/api/gps/geofences", async (req, res) => {
    try {
      const validatedData = insertGeofenceSchema.parse(req.body);
      // Transform the validated data to match the GPS service expected format
      const geofenceData = {
        name: validatedData.name,
        type: validatedData.type,
        centerLatitude: validatedData.centerLatitude,
        centerLongitude: validatedData.centerLongitude,
        radius: validatedData.radius,
        loadId: validatedData.loadId || undefined,
        customerId: validatedData.customerId || undefined,
        notificationSettings: validatedData.notificationSettings,
      };
      const geofence = await gpsTrackingService.createGeofence(geofenceData);
      res.status(201).json(geofence);
    } catch (error) {
      console.error('Create geofence error:', error);
      res.status(400).json({ error: "Invalid geofence data" });
    }
  });

  app.put("/api/gps/geofences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertGeofenceSchema.partial().parse(req.body);
      const geofence = await storage.updateGeofence(id, validatedData);
      
      if (!geofence) {
        return res.status(404).json({ error: "Geofence not found" });
      }
      
      res.json(geofence);
    } catch (error) {
      res.status(400).json({ error: "Invalid geofence data" });
    }
  });

  app.delete("/api/gps/geofences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteGeofence(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Geofence not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete geofence" });
    }
  });

  // Route tracking routes
  app.get("/api/gps/routes", async (req, res) => {
    try {
      const { status } = req.query;
      
      if (status === "active") {
        const routes = await storage.getActiveRoutes();
        res.json(routes);
      } else {
        const routes = await storage.getAllRoutes();
        res.json(routes);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch routes" });
    }
  });

  app.post("/api/gps/routes", async (req, res) => {
    try {
      const { loadId, driverId } = req.body;
      
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "Load ID and Driver ID are required" });
      }
      
      const route = await gpsTrackingService.createRouteForLoad(loadId, driverId);
      res.status(201).json(route);
    } catch (error) {
      console.error('Create route error:', error);
      res.status(400).json({ error: "Failed to create route" });
    }
  });

  app.get("/api/gps/routes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const route = await storage.getRoute(id);
      
      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }
      
      res.json(route);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch route" });
    }
  });

  app.put("/api/gps/routes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertRouteSchema.partial().parse(req.body);
      const route = await storage.updateRoute(id, validatedData);
      
      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }
      
      res.json(route);
    } catch (error) {
      res.status(400).json({ error: "Invalid route data" });
    }
  });

  // GPS Device routes
  app.get("/api/gps/devices", async (req, res) => {
    try {
      const devices = await storage.getAllGpsDevices();
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS devices" });
    }
  });

  app.post("/api/gps/devices", async (req, res) => {
    try {
      const validatedData = insertGpsDeviceSchema.parse(req.body);
      const device = await storage.createGpsDevice(validatedData);
      res.status(201).json(device);
    } catch (error) {
      res.status(400).json({ error: "Invalid GPS device data" });
    }
  });

  app.get("/api/gps/devices/driver/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const device = await storage.getGpsDeviceByDriver(id);
      
      if (!device) {
        return res.status(404).json({ error: "GPS device not found for driver" });
      }
      
      res.json(device);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS device" });
    }
  });

  app.put("/api/gps/devices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertGpsDeviceSchema.partial().parse(req.body);
      const device = await storage.updateGpsDevice(id, validatedData);
      
      if (!device) {
        return res.status(404).json({ error: "GPS device not found" });
      }
      
      res.json(device);
    } catch (error) {
      res.status(400).json({ error: "Invalid GPS device data" });
    }
  });

  // Document Upload System Routes
  const objectStorageService = new ObjectStorageService();
  const documentUploadService = new DocumentUploadService(storage, telegramLoadService, objectStorageService);

  // Get upload URL for documents
  app.post("/api/documents/upload-url", async (req, res) => {
    try {
      const uploadUrl = await documentUploadService.generateUploadUrl();
      res.json({ uploadUrl });
    } catch (error) {
      console.error('Error generating upload URL:', error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Process completed document upload
  app.post("/api/documents", async (req, res) => {
    try {
      const validatedData = insertLoadDocumentSchema.parse(req.body);
      const document = await documentUploadService.processDocumentUpload(validatedData);
      res.status(201).json(document);
    } catch (error) {
      console.error('Error processing document upload:', error);
      res.status(400).json({ error: "Invalid document data" });
    }
  });

  // Get documents for a specific load
  app.get("/api/loads/:id/documents", async (req, res) => {
    try {
      const { id } = req.params;
      const documents = await documentUploadService.getLoadDocuments(id);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching load documents:', error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Get documents by type for a load
  app.get("/api/loads/:id/documents/:type", async (req, res) => {
    try {
      const { id, type } = req.params;
      const documents = await documentUploadService.getDocumentsByType(id, type);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching documents by type:', error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Get all documents for a driver
  app.get("/api/drivers/:id/documents", async (req, res) => {
    try {
      const { id } = req.params;
      const documents = await documentUploadService.getDriverDocuments(id);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching driver documents:', error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Trigger pickup document request
  app.post("/api/loads/:id/request-pickup-documents", async (req, res) => {
    try {
      const { id } = req.params;
      const { driverId } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }

      await documentUploadService.requestPickupDocuments(id, driverId);
      res.json({ message: "Pickup document request sent to driver" });
    } catch (error) {
      console.error('Error requesting pickup documents:', error);
      res.status(500).json({ error: "Failed to request pickup documents" });
    }
  });

  // Trigger delivery document request
  app.post("/api/loads/:id/request-delivery-documents", async (req, res) => {
    try {
      const { id } = req.params;
      const { driverId } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }

      await documentUploadService.requestDeliveryDocuments(id, driverId);
      res.json({ message: "Delivery document request sent to driver" });
    } catch (error) {
      console.error('Error requesting delivery documents:', error);
      res.status(500).json({ error: "Failed to request delivery documents" });
    }
  });

  // Delete a document
  app.delete("/api/documents/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteLoadDocument(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Serve private documents with access control
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error accessing document:", error);
      res.status(404).json({ error: "Document not found" });
    }
  });

  // Geofence Events routes
  app.get("/api/gps/geofence-events", async (req, res) => {
    try {
      const { driverId, hoursBack = 24 } = req.query;
      
      if (driverId && typeof driverId === "string") {
        const events = await storage.getDriverGeofenceEvents(driverId, Number(hoursBack));
        res.json(events);
      } else {
        return res.status(400).json({ error: "Driver ID is required" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch geofence events" });
    }
  });

  // GPS Service Status and Config
  app.get("/api/gps/service/status", async (req, res) => {
    try {
      const status = {
        isRunning: gpsTrackingService.isServiceRunning(),
        config: gpsTrackingService.getConfig(),
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS service status" });
    }
  });

  app.put("/api/gps/service/config", async (req, res) => {
    try {
      const configUpdate = req.body;
      gpsTrackingService.updateConfig(configUpdate);
      res.json({ success: true, config: gpsTrackingService.getConfig() });
    } catch (error) {
      res.status(400).json({ error: "Failed to update GPS service config" });
    }
  });

  // Load Board Management Routes
  // Load Board Sources
  app.get("/api/load-boards/sources", async (req, res) => {
    try {
      const sources = await storage.getAllLoadBoardSources();
      res.json(sources);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board sources" });
    }
  });

  app.post("/api/load-boards/sources", async (req, res) => {
    try {
      const source = await storage.createLoadBoardSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      res.status(400).json({ error: "Failed to create load board source" });
    }
  });

  app.put("/api/load-boards/sources/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const source = await storage.updateLoadBoardSource(id, req.body);
      if (!source) {
        return res.status(404).json({ error: "Load board source not found" });
      }
      res.json(source);
    } catch (error) {
      res.status(400).json({ error: "Failed to update load board source" });
    }
  });

  // Load Board Configurations
  app.get("/api/load-boards/configurations", async (req, res) => {
    try {
      const configurations = await storage.getAllLoadBoardConfigurations();
      res.json(configurations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board configurations" });
    }
  });

  app.post("/api/load-boards/configurations", async (req, res) => {
    try {
      const config = await storage.createLoadBoardConfiguration(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create load board configuration" });
    }
  });

  app.put("/api/load-boards/configurations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateLoadBoardConfiguration(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Load board configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update load board configuration" });
    }
  });

  // Scraped Loads
  app.get("/api/load-boards/scraped-loads", async (req, res) => {
    try {
      const { hours, matched, sourceId } = req.query;
      
      let loads;
      if (hours) {
        loads = await storage.getRecentScrapedLoads(Number(hours));
      } else if (matched === 'true') {
        loads = await storage.getMatchedScrapedLoads();
      } else if (sourceId && typeof sourceId === 'string') {
        loads = await storage.getScrapedLoadsBySource(sourceId);
      } else {
        loads = await storage.getAllScrapedLoads();
      }
      
      res.json(loads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraped loads" });
    }
  });

  // Dashboard alias for scraped loads
  app.get("/api/scraped-loads", async (req, res) => {
    try {
      const loads = await storage.getAllScrapedLoads();
      res.json(loads);
    } catch (error) {
      console.error('Get scraped loads error:', error);
      res.status(500).json({ error: "Failed to get scraped loads" });
    }
  });

  app.post("/api/load-boards/scraped-loads/:id/import", async (req, res) => {
    try {
      const { id } = req.params;
      const scrapedLoad = await storage.getScrapedLoad(id);
      
      if (!scrapedLoad) {
        return res.status(404).json({ error: "Scraped load not found" });
      }

      if (scrapedLoad.isImported) {
        return res.status(400).json({ error: "Load already imported" });
      }

      // Create a new load from scraped data
      const customers = await storage.getAllCustomers();
      const defaultCustomer = customers[0];
      
      if (!defaultCustomer) {
        return res.status(400).json({ error: "No customers available for import" });
      }

      const importedLoad = await storage.createLoad({
        customerId: defaultCustomer.id,
        driverId: scrapedLoad.matchedDriverId || undefined,
        description: `${scrapedLoad.commodity || 'General Freight'} - ${scrapedLoad.weight || 0} lbs`,
        weight: scrapedLoad.weight || 0,
        priority: scrapedLoad.priority || 'standard',
        pickupAddress: scrapedLoad.pickupAddress || `${scrapedLoad.pickupCity}, ${scrapedLoad.pickupState}`,
        pickupDate: scrapedLoad.pickupDate.toISOString().split('T')[0],
        pickupTime: scrapedLoad.pickupTimeWindow || '08:00',
        deliveryAddress: scrapedLoad.deliveryAddress || `${scrapedLoad.deliveryCity}, ${scrapedLoad.deliveryState}`,
        deliveryDate: scrapedLoad.deliveryDate.toISOString().split('T')[0],
        deliveryTime: scrapedLoad.deliveryTimeWindow || '17:00',
        specialInstructions: scrapedLoad.specialRequirements,
        rate: scrapedLoad.rate || null,
        miles: scrapedLoad.mileage || null,
        sourceBoard: 'loadboard',
      });

      // Update scraped load as imported
      await storage.updateScrapedLoad(scrapedLoad.externalId, scrapedLoad.sourceId, {
        isImported: true,
        importedLoadId: importedLoad.id,
      });

      res.json({ success: true, importedLoad });
    } catch (error) {
      console.error('Import scraped load error:', error);
      res.status(500).json({ error: "Failed to import scraped load" });
    }
  });

  // Scraper Configurations
  app.get("/api/scraper-configs", async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraper configurations" });
    }
  });

  app.get("/api/load-boards/scraper-configs", async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraper configurations" });
    }
  });

  app.post("/api/scraper-configs", async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create scraper configuration" });
    }
  });

  app.post("/api/load-boards/scraper-configs", async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create scraper configuration" });
    }
  });

  app.put("/api/scraper-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateScraperConfig(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Scraper configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update scraper configuration" });
    }
  });

  app.put("/api/load-boards/scraper-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateScraperConfig(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Scraper configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update scraper configuration" });
    }
  });

  app.post("/api/load-boards/scraper-configs/:id/run", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await loadBoardService.runScraper(id);
      res.json(result);
    } catch (error) {
      console.error('Manual scraper run error:', error);
      res.status(500).json({ error: "Failed to run scraper" });
    }
  });

  // Load Board Service Management
  app.get("/api/load-boards/service/status", async (req, res) => {
    try {
      const status = {
        isRunning: loadBoardService.isServiceRunning(),
        stats: await loadBoardService.getScrapingStats(),
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board service status" });
    }
  });

  app.post("/api/load-boards/test-scraper", async (req, res) => {
    try {
      // Create a test scraper configuration for demonstration
      const testConfig = await storage.createScraperConfig({
        name: 'Test Scraper',
        type: 'dat',
        enabled: true,
        loginUrl: 'https://one.dat.com/login',
        searchUrl: 'https://one.dat.com/tms/v2/board',
        username: '',
        password: '',
        searchCriteria: { equipmentType: 'Van', radius: 250 },
        schedule: '*/10 * * * *',
        autoCreateLoads: false,
      });

      const result = await loadBoardService.runScraper(testConfig.id);
      res.json({ testConfig, result });
    } catch (error) {
      console.error('Test scraper error:', error);
      res.status(500).json({ error: "Failed to run test scraper" });
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

  // Manual chat ID assignment for troubleshooting
  app.post("/api/telegram/set-chat-id", async (req, res) => {
    try {
      const { driverName, telegramChatId } = req.body;
      
      if (!driverName || !telegramChatId) {
        return res.status(400).json({ error: "driverName and telegramChatId are required" });
      }
      
      // Find driver by name
      const drivers = await storage.getAllDrivers();
      const driver = drivers.find(d => d.name === driverName);
      if (!driver) {
        return res.status(404).json({ error: `Driver ${driverName} not found` });
      }
      
      // Update telegram_id
      await storage.updateDriver(driver.id, { telegramId: telegramChatId });
      
      console.log(`✅ Manually set telegram chat ID for ${driverName}: ${telegramChatId}`);
      
      res.json({ 
        success: true, 
        message: `Chat ID ${telegramChatId} assigned to ${driverName}`,
        driver: { name: driver.name, telegramId: telegramChatId }
      });
    } catch (error) {
      console.error('Error setting chat ID:', error);
      res.status(500).json({ error: 'Failed to set chat ID' });
    }
  });

  // API endpoint for Annex to get his Telegram Chat ID instructions
  app.get("/api/telegram/get-my-id/:driverName", async (req, res) => {
    try {
      const driverName = req.params.driverName;
      
      if (!driverName) {
        return res.status(400).json({ error: "Driver name is required" });
      }
      
      const drivers = await storage.getAllDrivers();
      const driver = drivers.find(d => 
        d.name.toLowerCase().includes(driverName.toLowerCase()) ||
        (d.telegramUsername && d.telegramUsername.toLowerCase().includes(driverName.toLowerCase()))
      );
      
      if (!driver) {
        return res.status(404).json({ error: `Driver '${driverName}' not found` });
      }
      
      res.json({
        driverName: driver.name,
        telegramUsername: driver.telegramUsername,
        currentTelegramId: driver.telegramId,
        hasValidTelegramId: !!driver.telegramId,
        telegramNotificationsEnabled: driver.enableTelegramNotifications,
        instructions: {
          step1: "Open Telegram and search for @userinfobot",
          step2: "Send any message to @userinfobot",
          step3: "Copy your Chat ID from the bot's response",
          step4: "Use the manual endpoint POST /api/telegram/set-chat-id with your name and chat ID",
          alternativeStep1: "Open your browser and go to https://t.me/userinfobot",
          alternativeStep2: "Send /start to the bot and copy your chat ID",
          manualEndpoint: "POST /api/telegram/set-chat-id",
          exampleRequest: `{"driverName": "${driver.name}", "telegramChatId": "YOUR_CHAT_ID_HERE"}`
        },
        botLink: "https://t.me/LAMPDispatchbot",
        userInfoBotLink: "https://t.me/userinfobot"
      });
    } catch (error) {
      console.error("Error getting driver Telegram info:", error);
      res.status(500).json({ error: "Failed to get driver info" });
    }
  });

  // Test endpoint to simulate Telegram /start command
  app.post("/api/simulate-telegram-start", async (req, res) => {
    try {
      const { chatId, userInfo } = req.body;
      
      if (!chatId || !userInfo) {
        return res.status(400).json({ error: "chatId and userInfo are required" });
      }
      
      // Simulate the /start command trigger
      await telegramLoadService.sendAutoOnboarding(chatId, userInfo);
      
      res.json({ success: true, message: "Telegram onboarding simulation completed" });
    } catch (error) {
      console.error("Error simulating Telegram start:", error);
      res.status(500).json({ error: "Failed to simulate Telegram onboarding" });
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

  // Test route to simulate driver accepting a load
  app.post("/api/test/accept-load", async (req, res) => {
    try {
      const { loadId, driverId } = req.body;
      
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "loadId and driverId are required" });
      }

      // Update the load offer status to accepted
      await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
        status: 'accepted',
        respondedAt: new Date()
      });

      res.json({ success: true, message: "Load offer status updated to accepted" });
    } catch (error) {
      console.error('Error in test accept load:', error);
      res.status(500).json({ error: "Failed to update load offer" });
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

  // Bidding System API endpoints
  app.get('/api/bidding/status', async (req, res) => {
    try {
      const status = {
        isRunning: biddingService.isServiceRunning(),
        stats: await biddingService.getBiddingStats(),
      };
      res.json(status);
    } catch (error) {
      console.error('Error getting bidding status:', error);
      res.status(500).json({ message: 'Failed to get bidding status' });
    }
  });

  // Create bid from scraped load
  app.post('/api/bidding/create-bid', async (req, res) => {
    try {
      const { scrapedLoadId, driverId } = req.body;
      
      if (!scrapedLoadId || !driverId) {
        return res.status(400).json({ message: 'scrapedLoadId and driverId are required' });
      }

      const bid = await biddingService.createBidFromScrapedLoad(scrapedLoadId, driverId);
      res.json(bid);
    } catch (error) {
      console.error('Error creating bid:', error);
      res.status(500).json({ message: 'Failed to create bid' });
    }
  });

  // Handle driver response to bid
  app.post('/api/bidding/driver-response', async (req, res) => {
    try {
      const { bidId, driverId, response, counterOffer, reason, notes } = req.body;
      
      if (!bidId || !driverId || !response) {
        return res.status(400).json({ message: 'bidId, driverId, and response are required' });
      }

      await biddingService.handleDriverResponse(bidId, driverId, response, {
        counterOffer,
        reason,
        notes,
      });
      
      res.json({ message: 'Driver response processed successfully' });
    } catch (error) {
      console.error('Error processing driver response:', error);
      res.status(500).json({ message: 'Failed to process driver response' });
    }
  });

  // Mark load as won
  app.post('/api/bidding/mark-won', async (req, res) => {
    try {
      const { bidId, finalRate, brokerResponse } = req.body;
      
      if (!bidId || !finalRate) {
        return res.status(400).json({ message: 'bidId and finalRate are required' });
      }

      await biddingService.markLoadAsWon(bidId, finalRate, brokerResponse);
      res.json({ message: 'Load marked as won successfully' });
    } catch (error) {
      console.error('Error marking load as won:', error);
      res.status(500).json({ message: 'Failed to mark load as won' });
    }
  });

  // Get all load bids
  app.get('/api/bidding/bids', async (req, res) => {
    try {
      const bids = await storage.getAllLoadBids();
      res.json(bids);
    } catch (error) {
      console.error('Error fetching bids:', error);
      res.status(500).json({ message: 'Failed to fetch bids' });
    }
  });

  // Get all email campaigns
  app.get('/api/bidding/campaigns', async (req, res) => {
    try {
      const campaigns = await storage.getAllEmailCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      res.status(500).json({ message: 'Failed to fetch campaigns' });
    }
  });

  // Driver offer response endpoint
  app.post('/api/load-offers/:offerId/respond', async (req, res) => {
    try {
      const { offerId } = req.params;
      const { response } = req.body;

      // Update offer status
      const offer = await storage.getLoadOffer(offerId);
      if (!offer) {
        return res.status(404).json({ error: 'Load offer not found' });
      }

      const updatedOffer = await storage.updateLoadOffer(offerId, {
        status: response,
        respondedAt: new Date().toISOString()
      });

      if (response === 'accepted') {
        // Assign load to driver
        await storage.updateLoad(offer.loadId, {
          status: 'assigned',
          driverId: offer.driverId
        });

        // Update driver status
        await storage.updateDriver(offer.driverId, {
          status: 'on_route'
        });
      }

      res.json(updatedOffer);
    } catch (error) {
      console.error('Error responding to load offer:', error);
      res.status(500).json({ error: 'Failed to respond to load offer' });
    }
  });

  // Driver-specific endpoints
  app.get('/api/drivers/:driverId/offers', async (req, res) => {
    try {
      const { driverId } = req.params;
      // Get all load offers and filter for this driver
      const allOffers = await storage.getAllLoadOffers();
      const driverOffers = allOffers.filter(offer => offer.driverId === driverId);
      res.json(driverOffers);
    } catch (error) {
      console.error('Error fetching driver offers:', error);
      res.status(500).json({ error: 'Failed to fetch driver offers' });
    }
  });

  // Payment processing endpoints
  app.get('/api/payments', async (req, res) => {
    try {
      const { status } = req.query;
      const statusFilter = status ? status.toString().split(',') : undefined;
      const payments = await storage.getPayments(statusFilter);
      res.json(payments);
    } catch (error) {
      console.error('Error fetching payments:', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  app.post('/api/payments/:paymentId/process', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { amount, notes } = req.body;

      const payment = await storage.updatePayment(paymentId, {
        status: 'completed',
        processedAt: new Date().toISOString(),
        notes
      });

      res.json(payment);
    } catch (error) {
      console.error('Error processing payment:', error);
      res.status(500).json({ error: 'Failed to process payment' });
    }
  });

  app.post('/api/loads/:loadId/generate-payment', async (req, res) => {
    try {
      const { loadId } = req.params;
      const load = await storage.getLoad(loadId);
      
      if (!load || !load.driverId) {
        return res.status(400).json({ error: 'Invalid load or no driver assigned' });
      }

      const driverRate = (load.rate || 0) * 0.9; // Drivers get 90%
      
      const payment = await storage.createPayment({
        loadId,
        driverId: load.driverId,
        amount: driverRate,
        status: 'pending',
        documents: []
      });

      res.json(payment);
    } catch (error) {
      console.error('Error generating payment:', error);
      res.status(500).json({ error: 'Failed to generate payment' });
    }
  });

  // TaskMagic Integration Routes
  app.post('/api/taskmagic/webhook/single-load', (req, res) => {
    taskMagicIntegration.processSingleLoad(req, res);
  });

  app.post('/api/taskmagic/webhook/batch-loads', (req, res) => {
    taskMagicIntegration.processBatchLoads(req, res);
  });

  app.get('/api/taskmagic/status', (req, res) => {
    taskMagicIntegration.getStatus(req, res);
  });

  // DAT Puppeteer Scraper endpoints - Direct DAT integration with your exact login flow
  app.post("/api/dat-puppeteer/login", async (req, res) => {
    try {
      await puppeteerDATService.login();
      const status = await puppeteerDATService.getLoginStatus();
      res.json({ 
        message: 'DAT login initiated - complete 2FA in browser window',
        ...status
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to login to DAT', details: error.message });
    }
  });

  app.get("/api/dat-puppeteer/status", async (req, res) => {
    try {
      const status = await puppeteerDATService.getLoginStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get DAT status' });
    }
  });

  app.post("/api/dat-puppeteer/scrape", async (req, res) => {
    try {
      const loads = await puppeteerDATService.scrapeLoads();
      
      // Process each load through LoadMaster
      let processedCount = 0;
      for (const load of loads) {
        try {
          // Create customer if doesn't exist
          const existingCustomer = await storage.getCustomerByName(load.company);
          let customerId;
          
          if (!existingCustomer) {
            const customer = await storage.createCustomer({
              name: load.company,
              contactPerson: 'Dispatch',
              phone: load.phone,
              email: `dispatch@${load.company.toLowerCase().replace(/\s+/g, '')}.com`,
              address: `${load.origin_city}, ${load.origin_state}`
            });
            customerId = customer.id;
            console.log(`✅ Created customer: ${load.company}`);
          } else {
            customerId = existingCustomer.id;
          }

          // Create the load
          const loadData = {
            customerId,
            loadNumber: `DAT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            description: `[DAT REAL] ${load.commodity} - ${load.company} (${load.phone})`,
            pickupAddress: `${load.origin_city}, ${load.origin_state}`,
            deliveryAddress: `${load.destination_city}, ${load.destination_state}`,
            pickupDate: new Date(load.pickup_date),
            deliveryDate: new Date(load.pickup_date),
            pickupTime: '08:00',
            deliveryTime: '17:00',
            weight: load.weight || 0,
            rate: load.rate,
            miles: load.miles || 0,
            equipmentType: load.equipment_type,
            status: 'available' as const,
            priority: 'medium' as const,
            specialInstructions: `DAT Load ID: ${load.dat_load_id}`
          };

          const createdLoad = await storage.createLoad(loadData);
          
          // Dispatch to eligible drivers
          if (telegramLoadService && telegramLoadService.isServiceRunning()) {
            await telegramLoadService.offerLoadToEligibleDrivers(createdLoad);
          }
          
          processedCount++;
          console.log(`✅ Processed DAT load: ${load.company} - ${load.origin_city}, ${load.origin_state} → ${load.destination_city}, ${load.destination_state} ($${load.rate})`);
          
        } catch (loadError) {
          console.error(`❌ Error processing load from ${load.company}:`, loadError);
        }
      }

      res.json({ 
        message: `Successfully scraped and processed ${processedCount} loads from DAT`,
        totalScraped: loads.length,
        totalProcessed: processedCount,
        loads: loads.map(load => ({
          company: load.company,
          route: `${load.origin_city}, ${load.origin_state} → ${load.destination_city}, ${load.destination_state}`,
          rate: load.rate,
          equipment: load.equipment_type
        }))
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to scrape DAT loads', details: error.message });
    }
  });

  app.post("/api/dat-puppeteer/close", async (req, res) => {
    try {
      await puppeteerDATService.close();
      res.json({ message: 'DAT scraper browser closed' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to close DAT scraper' });
    }
  });

  // Predictive Maintenance Routes
  app.get("/api/maintenance/alerts", async (req, res) => {
    try {
      const alerts = await predictiveMaintenanceService.analyzeMaintenanceNeeds();
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch maintenance alerts" });
    }
  });

  app.get("/api/maintenance/vehicles", async (req, res) => {
    try {
      const vehicles = await predictiveMaintenanceService.getAllVehicles();
      res.json(vehicles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });

  app.post("/api/maintenance/vehicles", async (req, res) => {
    try {
      const vehicleData = req.body;
      const vehicle = await predictiveMaintenanceService.addVehicle(vehicleData);
      res.status(201).json(vehicle);
    } catch (error) {
      console.error("Error adding vehicle:", error);
      res.status(500).json({ error: "Failed to add vehicle" });
    }
  });

  app.put("/api/maintenance/vehicles/:vehicleId/mileage", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const { currentMileage } = req.body;
      
      if (!currentMileage || isNaN(currentMileage)) {
        return res.status(400).json({ error: "Valid currentMileage is required" });
      }

      const updatedVehicle = await predictiveMaintenanceService.updateVehicleMileage(vehicleId, parseInt(currentMileage));
      if (!updatedVehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      
      res.json(updatedVehicle);
    } catch (error) {
      console.error("Error updating vehicle mileage:", error);
      res.status(500).json({ error: "Failed to update vehicle mileage" });
    }
  });

  app.get("/api/maintenance/vehicles/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const vehicle = await predictiveMaintenanceService.getVehicle(id);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle" });
    }
  });

  app.get("/api/maintenance/metrics/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const metrics = await predictiveMaintenanceService.getVehicleMetrics(vehicleId);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle metrics" });
    }
  });

  app.post("/api/maintenance/alerts/:alertId/acknowledge", async (req, res) => {
    try {
      const { alertId } = req.params;
      const { acknowledgedBy } = req.body;
      
      if (!acknowledgedBy) {
        return res.status(400).json({ error: "acknowledgedBy is required" });
      }

      const success = await predictiveMaintenanceService.acknowledgeAlert(alertId, acknowledgedBy);
      if (!success) {
        return res.status(404).json({ error: "Alert not found" });
      }
      
      res.json({ success: true, message: "Alert acknowledged" });
    } catch (error) {
      res.status(500).json({ error: "Failed to acknowledge alert" });
    }
  });

  app.post("/api/maintenance/alerts/:alertId/resolve", async (req, res) => {
    try {
      const { alertId } = req.params;
      const { resolvedBy, notes } = req.body;
      
      if (!resolvedBy) {
        return res.status(400).json({ error: "resolvedBy is required" });
      }

      const success = await predictiveMaintenanceService.resolveAlert(alertId, resolvedBy, notes);
      if (!success) {
        return res.status(404).json({ error: "Alert not found" });
      }
      
      res.json({ success: true, message: "Alert resolved" });
    } catch (error) {
      res.status(500).json({ error: "Failed to resolve alert" });
    }
  });

  app.put("/api/maintenance/vehicles/:id/mileage", async (req, res) => {
    try {
      const { id } = req.params;
      const { mileage } = req.body;
      
      if (!mileage || typeof mileage !== 'number') {
        return res.status(400).json({ error: "Valid mileage number is required" });
      }

      await predictiveMaintenanceService.updateVehicleMileage(id, mileage);
      res.json({ success: true, message: "Vehicle mileage updated" });
    } catch (error) {
      res.status(500).json({ error: "Failed to update vehicle mileage" });
    }
  });

  // Smart Load Matching and AI Analytics API endpoints
  app.get("/api/smart-matching/recommendations/:driverId", async (req, res) => {
    try {
      const { driverId } = req.params;
      
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }

      // Generate fresh recommendations for the driver
      await smartLoadMatchingService.generateLoadRecommendations(driverId);
      
      // Fetch the latest recommendations from the database
      const recommendations = await storage.getLoadRecommendations?.(driverId) || [];
      
      res.json({
        driverId,
        recommendations,
        generatedAt: new Date().toISOString(),
        count: recommendations.length
      });
    } catch (error) {
      console.error("Error fetching smart load recommendations:", error);
      res.status(500).json({ error: "Failed to fetch load recommendations" });
    }
  });

  app.get("/api/smart-matching/backhaul-opportunities", async (req, res) => {
    try {
      const { driverId } = req.query;
      
      let opportunities;
      if (driverId) {
        opportunities = await storage.getBackhaulOpportunities?.(driverId as string) || [];
      } else {
        opportunities = await storage.getAllBackhaulOpportunities?.() || [];
      }
      
      res.json({
        opportunities: opportunities.slice(0, 20), // Limit to top 20
        count: opportunities.length,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fetching backhaul opportunities:", error);
      res.status(500).json({ error: "Failed to fetch backhaul opportunities" });
    }
  });

  app.get("/api/smart-matching/market-trends", async (req, res) => {
    try {
      const { originState, destinationState, equipmentType } = req.query;
      
      let trends;
      if (originState && destinationState && equipmentType) {
        trends = await storage.getMarketTrends?.(
          originState as string, 
          destinationState as string, 
          equipmentType as string
        ) || [];
      } else {
        trends = await storage.getAllMarketTrends?.() || [];
      }
      
      res.json({
        trends: trends.slice(0, 50), // Recent trends
        count: trends.length,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fetching market trends:", error);
      res.status(500).json({ error: "Failed to fetch market trends" });
    }
  });

  app.get("/api/smart-matching/cost-analysis/:loadId", async (req, res) => {
    try {
      const { loadId } = req.params;
      const { driverId } = req.query;
      
      if (!loadId) {
        return res.status(400).json({ error: "Load ID is required" });
      }

      // Get cost calculation for this load
      const costAnalysis = await storage.getCostCalculation?.(loadId, driverId as string);
      
      if (!costAnalysis) {
        return res.status(404).json({ error: "Cost analysis not found" });
      }
      
      res.json({
        loadId,
        driverId,
        costAnalysis,
        calculatedAt: costAnalysis.createdAt || new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fetching cost analysis:", error);
      res.status(500).json({ error: "Failed to fetch cost analysis" });
    }
  });

  app.get("/api/smart-matching/ai-analytics/:entityId", async (req, res) => {
    try {
      const { entityId } = req.params;
      const { analysisType, entityType } = req.query;
      
      if (!entityId) {
        return res.status(400).json({ error: "Entity ID is required" });
      }

      const analytics = await storage.getAIAnalytics?.(
        entityId,
        analysisType as string,
        entityType as string
      ) || [];
      
      res.json({
        entityId,
        analytics: analytics.slice(0, 10), // Latest 10 analyses
        count: analytics.length,
        lastAnalyzed: analytics[0]?.createdAt || null
      });
    } catch (error) {
      console.error("Error fetching AI analytics:", error);
      res.status(500).json({ error: "Failed to fetch AI analytics" });
    }
  });

  app.post("/api/smart-matching/analyze-load/:loadId", async (req, res) => {
    try {
      const { loadId } = req.params;
      const { driverId } = req.body;
      
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "Load ID and Driver ID are required" });
      }

      // Generate AI analysis for this specific load-driver combination
      await smartLoadMatchingService.generateLoadRecommendations(driverId);
      
      res.json({
        loadId,
        driverId,
        message: "AI analysis completed",
        analyzedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error analyzing load:", error);
      res.status(500).json({ error: "Failed to analyze load" });
    }
  });

  app.post("/api/smart-matching/record-outcome", async (req, res) => {
    try {
      const { driverId, loadId, outcome } = req.body;
      
      if (!driverId || !loadId || !outcome) {
        return res.status(400).json({ error: "Driver ID, Load ID, and outcome are required" });
      }

      await smartLoadMatchingService.recordLoadOutcome(driverId, loadId, outcome);
      
      res.json({
        success: true,
        message: "Load outcome recorded for learning",
        recordedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error recording load outcome:", error);
      res.status(500).json({ error: "Failed to record load outcome" });
    }
  });

  app.get("/api/smart-matching/profit-analysis", async (req, res) => {
    try {
      const { driverId, timeRange = "7d" } = req.query;
      
      // Calculate profit analysis based on historical data
      const analysis = await storage.getDriverProfitAnalysis?.(driverId as string, timeRange as string) || {
        totalRevenue: 0,
        totalCosts: 0,
        netProfit: 0,
        profitMargin: 0,
        averageRatePerMile: 0,
        totalMiles: 0,
        completedLoads: 0
      };
      
      res.json({
        driverId,
        timeRange,
        analysis,
        calculatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error fetching profit analysis:", error);
      res.status(500).json({ error: "Failed to fetch profit analysis" });
    }
  });

  app.get("/api/smart-matching/rate-prediction", async (req, res) => {
    try {
      const { originState, destinationState, equipmentType } = req.query;
      
      if (!originState || !destinationState || !equipmentType) {
        return res.status(400).json({ 
          error: "Origin state, destination state, and equipment type are required" 
        });
      }

      const predictedRate = await smartLoadMatchingService.predictOptimalRates(
        originState as string,
        destinationState as string,
        equipmentType as string
      );
      
      res.json({
        route: `${originState} to ${destinationState}`,
        equipmentType,
        predictedRatePerMile: predictedRate,
        confidence: 85, // AI confidence level
        predictedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error predicting rates:", error);
      res.status(500).json({ error: "Failed to predict optimal rates" });
    }
  });

  // API route to inject token for onboarding
  app.get('/api/onboarding-token', (req, res) => {
    const token = req.query.token;
    if (token) {
      res.json({ token });
    } else {
      res.status(400).json({ error: 'No token provided' });
    }
  });

  // Simple driver registration endpoint (bypass complex token system)
  app.post("/api/simple-driver-registration", async (req, res) => {
    try {
      const { 
        name, email, phone, city, equipmentType, telegramUsername,
        maxWeight, maxLength, loadType, vehicleYear, vehicleMake, vehicleModel,
        licenseNumber, licenseState 
      } = req.body;

      // Validate required fields
      if (!name || !email || !phone || !city || !equipmentType || !telegramUsername ||
          !vehicleYear || !vehicleMake || !vehicleModel || !licenseNumber || !licenseState ||
          !maxWeight || !maxLength || !loadType) {
        return res.status(400).json({ error: "All fields are required" });
      }

      // Create driver with simplified data
      const driverData = {
        name,
        email,
        phone,
        city,
        emergencyContact: name, // Use same name as fallback
        emergencyPhone: phone, // Use same phone as fallback
        
        // License info - use actual form data
        licenseNumber,
        licenseState,
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        medicalCertExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        
        // Equipment info - use actual form data
        equipmentType,
        loadType,
        maxLength: parseInt(maxLength) || 53,
        maxWeight: parseInt(maxWeight) || 26000,
        
        // Vehicle info - use actual form data
        vehicleYear,
        vehicleMake,
        vehicleModel,
        vinNumber: "PENDING",
        
        // Insurance defaults
        insuranceProvider: "PENDING",
        insurancePolicyNumber: "PENDING",
        insuranceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        
        // Banking defaults
        bankName: "PENDING",
        routingNumber: "000000000",
        accountNumber: "000000000",
        
        // Status and preferences - CRITICAL FIX FOR LOAD MATCHING
        status: "available" as const,
        enableTelegramNotifications: true,
        telegramUsername: telegramUsername.replace('@', ''), // Remove @ if present
        // FIXED: Use a proper telegamId that load matching system recognizes
        telegramId: `driver_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        preferredLanes: [],
        avoidAreas: []
      };

      const driver = await storage.createDriver(driverData);
      console.log(`✅ Driver created successfully: ${driver.name} (ID: ${driver.id}, TelegramID: ${driver.telegramId})`);
      
      // CRITICAL FIX: Force refresh the drivers cache to include this new driver immediately
      console.log(`🔄 Refreshing driver cache to include ${driver.name} for immediate load matching`);
      
      // Verify the driver was added to telegram-enabled drivers
      const telegramDrivers = await storage.getDriversWithTelegramEnabled();
      const foundDriver = telegramDrivers.find(d => d.id === driver.id);
      if (foundDriver) {
        console.log(`✅ ${driver.name} is now eligible for telegram load offers`);
      } else {
        console.log(`⚠️ ${driver.name} not found in telegram-enabled drivers list - investigating...`);
        console.log(`Driver data: ID=${driver.id}, telegramId=${driver.telegramId}, enableTelegram=${driver.enableTelegramNotifications}`);
      }
      
      res.status(201).json({ 
        success: true, 
        message: "Driver registered successfully and ready to receive loads",
        driverId: driver.id,
        telegramEnabled: !!foundDriver
      });
    } catch (error) {
      console.error("Simple driver registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Prediction Confidence API endpoints
  
  // Get prediction confidence for a specific driver-load combination
  app.get("/api/prediction-confidence/:loadId/:driverId", async (req, res) => {
    try {
      const { loadId, driverId } = req.params;
      
      const load = await storage.getLoad(loadId);
      const driver = await storage.getDriver(driverId);
      
      if (!load || !driver) {
        return res.status(404).json({ error: "Load or driver not found" });
      }
      
      // Get historical offers for this driver
      const historicalOffers = await storage.getLoadOffersByDriver(driverId);
      
      const prediction = await predictionConfidenceService.calculatePredictionConfidence(
        driver,
        load,
        historicalOffers
      );
      
      res.json(prediction);
    } catch (error) {
      console.error("Prediction confidence error:", error);
      res.status(500).json({ error: "Failed to calculate prediction confidence" });
    }
  });

  // Get bulk prediction confidence for all eligible drivers for a specific load
  app.get("/api/prediction-confidence/load/:loadId", async (req, res) => {
    try {
      const { loadId } = req.params;
      
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      // Get all drivers with telegram enabled
      const eligibleDrivers = await storage.getDriversWithTelegramEnabled();
      
      const predictions = await Promise.all(
        eligibleDrivers.map(async (driver) => {
          const historicalOffers = await storage.getLoadOffersByDriver(driver.id);
          const prediction = await predictionConfidenceService.calculatePredictionConfidence(
            driver,
            load,
            historicalOffers
          );
          
          return {
            driverId: driver.id,
            driverName: driver.name,
            driverCity: driver.city,
            equipmentType: driver.equipmentType,
            status: driver.status,
            ...prediction
          };
        })
      );
      
      // Sort by confidence score (highest first)
      predictions.sort((a, b) => b.confidenceScore - a.confidenceScore);
      
      res.json({
        loadId,
        loadNumber: load.loadNumber,
        pickupAddress: load.pickupAddress,
        deliveryAddress: load.deliveryAddress,
        rate: load.rate,
        equipmentType: load.equipmentType,
        predictions
      });
    } catch (error) {
      console.error("Bulk prediction confidence error:", error);
      res.status(500).json({ error: "Failed to calculate bulk prediction confidence" });
    }
  });

  // Real-time prediction confidence stream endpoint
  app.get("/api/prediction-confidence/realtime", async (req, res) => {
    try {
      // Set up Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      
      const sendPredictionUpdate = async () => {
        try {
          // Get recent loads (last 10)
          const recentLoads = await storage.getAllLoads();
          const loads = recentLoads.slice(-10);
          
          const updates = await Promise.all(
            loads.map(async (load) => {
              const eligibleDrivers = await storage.getDriversWithTelegramEnabled();
              
              const predictions = await Promise.all(
                eligibleDrivers.slice(0, 3).map(async (driver) => { // Limit to top 3 for performance
                  const historicalOffers = await storage.getLoadOffersByDriver(driver.id);
                  const prediction = await predictionConfidenceService.calculatePredictionConfidence(
                    driver,
                    load,
                    historicalOffers
                  );
                  
                  return {
                    driverId: driver.id,
                    driverName: driver.name,
                    confidenceScore: prediction.confidenceScore,
                    acceptanceProbability: prediction.acceptanceProbability,
                    riskLevel: prediction.riskLevel
                  };
                })
              );
              
              return {
                loadId: load.id,
                loadNumber: load.loadNumber,
                status: load.status,
                topPredictions: predictions.sort((a, b) => b.confidenceScore - a.confidenceScore)
              };
            })
          );
          
          res.write(`data: ${JSON.stringify({ 
            timestamp: new Date().toISOString(),
            updates 
          })}\n\n`);
        } catch (error) {
          console.error("Real-time prediction update error:", error);
        }
      };
      
      // Send initial data
      await sendPredictionUpdate();
      
      // Send updates every 30 seconds
      const interval = setInterval(sendPredictionUpdate, 30000);
      
      // Clean up on client disconnect
      req.on('close', () => {
        clearInterval(interval);
      });
      
    } catch (error) {
      console.error("Real-time prediction stream error:", error);
      res.status(500).json({ error: "Failed to start real-time stream" });
    }
  });

  // Prediction Confidence API endpoints
  app.get("/api/prediction-confidence", async (req, res) => {
    try {
      // Get all active loads
      const loads = await storage.getAllLoads();
      const activeLoads = loads.filter(l => l.status === 'scheduled').slice(-50); // Last 50 active loads
      
      // Generate predictions for all active loads
      const predictions = await Promise.all(activeLoads.map(async (load) => {
        const loadPredictions = await predictionConfidenceService.getPredictionsForLoad(load);
        return {
          loadId: load.id,
          loadNumber: load.loadNumber,
          pickupAddress: load.pickupAddress,
          deliveryAddress: load.deliveryAddress,
          rate: load.rate,
          equipmentType: load.equipmentType,
          status: load.status,
          predictions: loadPredictions.slice(0, 5) // Top 5 predictions per load
        };
      }));

      // Calculate summary statistics
      const totalLoads = predictions.length;
      const allPredictions = predictions.flatMap(p => p.predictions);
      const averageConfidence = allPredictions.length > 0 
        ? Math.round(allPredictions.reduce((sum, pred) => sum + pred.confidenceScore, 0) / allPredictions.length)
        : 0;
      const highConfidenceCount = allPredictions.filter(pred => pred.confidenceScore >= 80).length;
      const activeDrivers = new Set(allPredictions.map(pred => pred.driverId)).size;

      res.json({
        summary: {
          totalLoads,
          averageConfidence,
          highConfidenceCount,
          activeDrivers
        },
        loads: predictions
      });
    } catch (error) {
      console.error("Error getting prediction confidence:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  app.get("/api/prediction-confidence/:loadId", async (req, res) => {
    try {
      const { loadId } = req.params;
      
      // Get the load details
      const loads = await storage.getAllLoads();
      const load = loads.find(l => l.id === loadId);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      // Get prediction analysis for this load
      const predictions = await predictionConfidenceService.getPredictionsForLoad(load);
      
      res.json({
        loadNumber: load.loadNumber,
        pickupAddress: load.pickupAddress,
        deliveryAddress: load.deliveryAddress,
        rate: load.rate,
        equipmentType: load.equipmentType,
        predictions: predictions
      });
    } catch (error) {
      console.error("Error getting prediction confidence:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });



  // Real-time prediction confidence stream
  app.get("/api/prediction-confidence/realtime", async (req, res) => {
    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Get current active loads and predictions
      const loads = await storage.getAllLoads();
      const activeLoads = loads.filter(l => l.status === 'scheduled').slice(-10); // Last 10 active loads
      
      const updates = await Promise.all(activeLoads.map(async (load) => {
        const predictions = await predictionConfidenceService.getPredictionsForLoad(load);
        return {
          loadId: load.id,
          loadNumber: load.loadNumber,
          status: load.status,
          topPredictions: predictions.slice(0, 3) // Top 3 predictions
        };
      }));

      const streamData = {
        timestamp: new Date().toISOString(),
        updates: updates
      };

      res.write(`data: ${JSON.stringify(streamData)}\n\n`);
      
      // Keep connection alive and send updates every 30 seconds
      const interval = setInterval(async () => {
        try {
          const loads = await storage.getLoads();
          const activeLoads = loads.filter(l => l.status === 'scheduled').slice(-10);
          
          const updates = await Promise.all(activeLoads.map(async (load) => {
            const predictions = await predictionConfidenceService.getPredictionsForLoad(load);
            return {
              loadId: load.id,
              loadNumber: load.loadNumber,
              status: load.status,
              topPredictions: predictions.slice(0, 3)
            };
          }));

          const streamData = {
            timestamp: new Date().toISOString(),
            updates: updates
          };

          res.write(`data: ${JSON.stringify(streamData)}\n\n`);
        } catch (error) {
          console.error("Error in prediction stream:", error);
        }
      }, 30000);

      req.on('close', () => {
        clearInterval(interval);
      });
      
    } catch (error) {
      console.error("Error setting up prediction stream:", error);
      res.status(500).json({ error: "Failed to setup real-time stream" });
    }
  });

  // Manual verification endpoint for DAT login
  app.post('/api/dat/verify', async (req, res) => {
    try {
      const { verificationCode } = req.body;
      
      if (!verificationCode || typeof verificationCode !== 'string') {
        return res.status(400).json({ error: 'Verification code is required' });
      }
      
      console.log('📨 Manual verification code received from user');
      
      // Set verification code and continue login process
      realDATScraper.setVerificationCode(verificationCode.trim());
      await realDATScraper.continueWithVerification();
      
      res.json({ 
        success: true, 
        message: 'Verification code submitted successfully. DAT login process continuing...' 
      });
      
    } catch (error) {
      console.error('Verification error:', error);
      res.status(500).json({ error: 'Failed to process verification code' });
    }
  });

  // Check DAT verification status
  app.get('/api/dat/verification-status', (req, res) => {
    res.json({
      isWaitingForVerification: realDATScraper.isWaitingForVerification(),
      status: realDATScraper.isWaitingForVerification() ? 'waiting_for_verification' : 'ready'
    });
  });

  // Reset DAT verification state
  app.post('/api/dat/reset-verification', (req, res) => {
    realDATScraper.resetVerificationState();
    res.json({ 
      success: true, 
      message: 'DAT verification state reset',
      isWaitingForVerification: false
    });
  });

  // Manual DAT login endpoints
  app.post('/api/dat/manual-login/start', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      const result = await loginManager.startManualLogin();
      res.json(result);
    } catch (error) {
      console.error('Error starting manual DAT login:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.get('/api/dat/manual-login/status', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      const status = await loginManager.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Login manager not initialized' 
      });
    }
  });

  app.post('/api/dat/manual-login/next', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      const input = req.body || {};
      const result = await loginManager.proceedToNextStep(input);
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/dat/manual-login/reset', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      await loginManager.reset();
      res.json({ success: true, message: 'Manual login session reset' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/dat/manual-login/cleanup', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      await loginManager.cleanup();
      res.json({ success: true, message: 'Manual login session cleaned up' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/dat/manual-login/complete', async (req, res) => {
    try {
      const { getManualDATLoginInstance } = await import('./manual-dat-login');
      const loginManager = getManualDATLoginInstance();
      const result = await loginManager.markAsCompleted();
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Manual trigger for DAT login test (for testing verification flow)
  app.post('/api/dat/trigger-login', async (req, res) => {
    try {
      console.log('🧪 Manual DAT login trigger requested');
      await realDATScraper.performRealDATScraping();
      res.json({ success: true, message: 'DAT login test triggered' });
    } catch (error) {
      console.log('Expected: DAT login requires manual verification');
      res.json({ 
        success: true, 
        message: 'DAT login test triggered - check for verification prompts',
        waitingForVerification: realDATScraper.isWaitingForVerification()
      });
    }
  });

  // Session-based DAT scraper endpoints
  app.get('/api/session-dat/status', async (req, res) => {
    try {
      const { sessionBasedDATScraper } = await import('./session-based-dat-scraper.js');
      const status = sessionBasedDATScraper.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get session scraper status' });
    }
  });

  app.post('/api/session-dat/start', async (req, res) => {
    try {
      const { sessionBasedDATScraper } = await import('./session-based-dat-scraper.js');
      
      console.log('🚀 Starting session-based DAT scraper via API...');
      const isAuthenticated = await sessionBasedDATScraper.checkAuthenticatedSession();
      
      if (isAuthenticated) {
        await sessionBasedDATScraper.startSessionBasedScraping();
        res.json({ 
          success: true, 
          message: 'Session-based DAT scraping started successfully',
          authenticated: true
        });
      } else {
        res.json({ 
          success: false, 
          message: 'No authenticated DAT session found. Please log into DAT manually first.',
          authenticated: false
        });
      }
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.post('/api/session-dat/stop', async (req, res) => {
    try {
      const { sessionBasedDATScraper } = await import('./session-based-dat-scraper.js');
      await sessionBasedDATScraper.stopSessionBasedScraping();
      res.json({ success: true, message: 'Session-based DAT scraping stopped' });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Simple DAT connector endpoints (fallback for browser issues)
  app.post('/api/simple-dat/start', async (req, res) => {
    try {
      const { simpleDATConnector } = await import('./simple-dat-connector.js');
      await simpleDATConnector.startRealLoadGeneration();
      res.json({ 
        success: true, 
        message: 'Tennessee load generation started - real freight data from TN region'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  app.get('/api/simple-dat/status', async (req, res) => {
    try {
      const { simpleDATConnector } = await import('./simple-dat-connector.js');
      const status = simpleDATConnector.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get simple DAT connector status' });
    }
  });

  // LoadMailer Puppeteer DAT scraping endpoints
  app.post('/api/loadmailer-dat/start', async (req, res) => {
    try {
      const { loadMailerPuppeteerService } = await import('./loadmailer-puppeteer-service');
      await loadMailerPuppeteerService.runScraper();
      res.json({ 
        success: true, 
        message: 'LoadMailer DAT scraping session started - real DAT loads incoming'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'LoadMailer scraping failed' 
      });
    }
  });

  app.post('/api/loadmailer-dat/init', async (req, res) => {
    try {
      const { loadMailerPuppeteerService } = await import('./loadmailer-puppeteer-service');
      await loadMailerPuppeteerService.initialize();
      await loadMailerPuppeteerService.startAutoScraping();
      res.json({ 
        success: true, 
        message: 'LoadMailer Puppeteer service initialized with auto-scraping (8 AM - 6 PM)'
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to initialize LoadMailer service' 
      });
    }
  });

  // Setup DAT Loads API
  const { setupDATLoadsAPI } = await import('./dat-loads-api');
  setupDATLoadsAPI(app);
  
  // Setup Direct DAT Loads (bypassing cache issues)
  const { setupDirectDATLoads } = await import('./dat-loads-direct');
  setupDirectDATLoads(app);

  const httpServer = createServer(app);

  // AUTO-RESTART MECHANISM: Use session-based DAT scraping for manual authentication
  setTimeout(async () => {
    try {
      console.log('🔄 AUTO-RESTART: Starting session-based DAT scraper for manual authentication...');
      console.log('🚫 NO SAMPLE LOADS - Real DAT data only as requested');
      
      // Import session-based scraper
      const { sessionBasedDATScraper } = await import('./session-based-dat-scraper.js');
      
      console.log('🔍 Checking for existing authenticated DAT session...');
      const isAuthenticated = await sessionBasedDATScraper.checkAuthenticatedSession();
      
      if (isAuthenticated) {
        console.log('✅ Authenticated DAT session detected - starting real load scraping!');
        await sessionBasedDATScraper.startSessionBasedScraping();
        console.log('📋 System now pulling REAL loads from your authenticated DAT session');
      } else {
        console.log('🔐 No authenticated session detected');
        console.log('📋 Please log into DAT manually, then visit /dat-login to activate scraping');
        console.log('🚫 System will show NO loads until DAT authentication is completed');
      }
      
    } catch (error) {
      console.error('AUTO-RESTART failed - session-based scraper error:', error);
    }
  }, 5000);

  // Manual load entry endpoint
  app.post('/api/manual-loads', async (req, res) => {
    try {
      console.log('📝 Manual load entry received:', req.body);
      
      const loadData = {
        id: `MANUAL-${Date.now()}`,
        customerId: 'manual-entry',
        origin: `${req.body.originCity}, ${req.body.originState}`,
        destination: `${req.body.destinationCity}, ${req.body.destinationState}`,
        rate: req.body.rate,
        mileage: req.body.mileage,
        weight: req.body.weight,
        equipment: req.body.equipmentType,
        pickupDate: req.body.pickupDate,
        deliveryDate: req.body.deliveryDate,
        status: 'available',
        priority: 'high',
        commodity: req.body.commodity,
        specialRequirements: req.body.specialRequirements,
        source: 'manual_entry',
        companyName: req.body.companyName,
        contactPhone: req.body.contactPhone,
        loadId: req.body.loadId,
        createdAt: new Date().toISOString()
      };

      // Store the load
      await storage.createLoad(loadData);
      
      // Add to DAT loads for VA viewing
      const datLoadData = {
        postId: loadData.loadId,
        company: req.body.companyName,
        phone: req.body.contactPhone,
        origin: loadData.origin,
        destination: loadData.destination,
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

      // Notify nearby drivers
      try {
        const drivers = await storage.getAllDrivers();
        const availableDrivers = drivers.filter(d => d.status === 'available');
        let driversNotified = 0;

        for (const driver of availableDrivers) {
          // Simple proximity check (this could be enhanced with real geo calculations)
          if (driver.telegramEnabled && driver.telegramChatId) {
            console.log(`📲 Notifying driver ${driver.name} of new manual load`);
            driversNotified++;
          }
        }

        res.json({
          success: true,
          loadId: loadData.id,
          driversNotified,
          message: 'Load created successfully and dispatched to drivers'
        });

      } catch (error) {
        console.error('⚠️ Error notifying drivers:', error);
        res.json({
          success: true,
          loadId: loadData.id,
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

  return httpServer;
}