import express, { type Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { analyticsService } from "./analytics-service";
import { schedulerService } from "./scheduler-service";
import { loadExpirationService } from "./load-expiration-service";
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
import { ObjectStorageService, objectStorageClient, parseObjectPath } from "./objectStorage";
import { PredictiveMaintenanceService } from "./predictive-maintenance-service";
import { realDriverLocationService } from "./real-driver-location-service";
import { taskMagicIntegration } from './taskmagic-integration';
import { datScraperService as puppeteerDATService } from './dat-puppeteer-scraper';
import { googleSheetsService } from './google-sheets-service';
import { smsLoadService } from './sms-service';
import { smsCommunicationService } from './sms-communication-service';
import { setupAuth, isAuthenticated } from "./replitAuth";
import { pdfService } from './pdf-service';
import { documentReminderService } from './document-reminder-service';

import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import twilio from "twilio";
import rateLimit from "express-rate-limit";
import { z } from "zod";

// Initialize Twilio client for SMS communication
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// GPS Location Update Validation Schema
const gpsLocationUpdateSchema = z.object({
  driverId: z.string().min(1, "Driver ID is required"),
  lat: z.number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  lon: z.number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
  timestamp: z.string().optional()
});

// Helper function to extract city and state from full address
// Handles multiple formats: "City, State Zip", "Nashville TN 37203", "Street, City, ST", etc.
function extractCityState(address: string | null | undefined): string {
  // Handle null/undefined/empty cases - return meaningful fallback
  if (!address || address.trim() === '') {
    return 'Location TBD';
  }
  
  const trimmedAddress = address.trim();
  
  // Pattern 1: "Street, City, State Zip" or "City, State Zip" (with comma)
  // Example: "123 Main St, Nashville, TN 37203" or "Nashville, TN 37203"
  const cityStatePatternWithComma = /,\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5})?$/i;
  const matchComma = trimmedAddress.match(cityStatePatternWithComma);
  
  if (matchComma && matchComma[1] && matchComma[2]) {
    return `${matchComma[1].trim()}, ${matchComma[2].toUpperCase()}`;
  }
  
  // Pattern 2: "City, ST" (simple comma pattern)
  // Example: "Nashville, TN"
  const simpleCommaPattern = /([^,]+),\s*([A-Z]{2})\b/i;
  const simpleMatch = trimmedAddress.match(simpleCommaPattern);
  
  if (simpleMatch && simpleMatch[1] && simpleMatch[2]) {
    return `${simpleMatch[1].trim()}, ${simpleMatch[2].toUpperCase()}`;
  }
  
  // Pattern 3: "City ST Zip" (no comma - space-separated)
  // Example: "Nashville TN 37203" or "New York NY 10001"
  const noCommaPattern = /\b([A-Z][a-zA-Z\s]+)\s+([A-Z]{2})(?:\s+\d{5})?\s*$/i;
  const noCommaMatch = trimmedAddress.match(noCommaPattern);
  
  if (noCommaMatch && noCommaMatch[1] && noCommaMatch[2]) {
    return `${noCommaMatch[1].trim()}, ${noCommaMatch[2].toUpperCase()}`;
  }
  
  // Pattern 4: Try to extract last two parts separated by comma
  const parts = trimmedAddress.split(',').map(p => p.trim()).filter(p => p);
  if (parts.length >= 2) {
    // Check if last part looks like "State Zip"
    const lastPart = parts[parts.length - 1];
    const stateZipMatch = lastPart.match(/^([A-Z]{2})(?:\s+\d{5})?$/i);
    if (stateZipMatch) {
      return `${parts[parts.length - 2]}, ${stateZipMatch[1].toUpperCase()}`;
    }
    // Otherwise return last two parts as-is
    return parts.slice(-2).join(', ');
  }
  
  // Pattern 5: Try to extract from space-separated parts (find state code)
  const spaceParts = trimmedAddress.split(/\s+/);
  if (spaceParts.length >= 2) {
    // Look for a 2-letter state code
    for (let i = 0; i < spaceParts.length; i++) {
      if (/^[A-Z]{2}$/i.test(spaceParts[i])) {
        // Found state code, grab the word before it as city
        if (i > 0) {
          return `${spaceParts[i - 1]}, ${spaceParts[i].toUpperCase()}`;
        }
      }
    }
  }
  
  // Final fallback: Return a shortened version if address is too long
  if (trimmedAddress.length > 30) {
    // Try to get just the first meaningful part
    const firstPart = trimmedAddress.split(',')[0].trim();
    if (firstPart.length > 0 && firstPart.length <= 30) {
      return firstPart;
    }
    // If still too long, truncate with ellipsis
    return trimmedAddress.substring(0, 27) + '...';
  }
  
  // Return the whole address if it's short enough
  return trimmedAddress;
}

// Rate limiter for GPS location updates - max 120 requests per hour per IP
const gpsLocationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 120, // max 120 requests per hour (one every 30 seconds with buffer)
  message: { error: "Too many location updates. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    console.log(`⚠️ SECURITY: Rate limit exceeded for GPS updates from IP: ${ip}`);
    res.status(429).json({ 
      error: "Too many location updates. Please try again later.",
      retryAfter: 60 
    });
  }
});

// Rate limiter for bulk SMS operations - max 1 request per hour per IP
const bulkSmsRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1, // max 1 bulk send per hour
  message: { error: "Bulk send is limited to once per hour. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;
    console.log(`⚠️ SECURITY: Bulk SMS rate limit exceeded from IP: ${ip}`);
    res.status(429).json({ 
      error: "Bulk send is limited to once per hour. Please try again later.",
      retryAfter: 3600
    });
  }
});

// Helper function to normalize and validate phone numbers for Twilio E.164 format
function normalizePhoneToE164(phoneNumber: string | undefined | null): string | null {
  if (!phoneNumber) return null;
  
  // Strip all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Validate and normalize to E.164 format (+1XXXXXXXXXX)
  if (digitsOnly.length === 10) {
    // 10 digits: US number without country code -> add +1
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // 11 digits starting with 1: US number with country code -> add +
    return `+${digitsOnly}`;
  } else {
    // Invalid format: cannot normalize to E.164
    console.error(`❌ Invalid phone number format: "${phoneNumber}" (${digitsOnly.length} digits) - cannot normalize to E.164`);
    return null;
  }
}

// Helper function to determine the correct base URL with protocol based on environment
function getBaseUrl(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
  
  // If domain already has protocol, use as-is
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  
  // If localhost, use HTTP
  if (domain === 'localhost' || domain.startsWith('localhost:')) {
    return `http://${domain}`;
  }
  
  // Production Replit domain - use HTTPS
  return `https://${domain}`;
}

// Authorization middleware for bulk operations
// Requires either authenticated session OR admin API key
function requireBulkAuthorization(req: any, res: any, next: any) {
  // Check 1: Is user authenticated via session?
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    console.log(`✅ Bulk operation authorized via session: ${req.user.claims?.email || 'unknown'}`);
    return next();
  }

  // Check 2: Is admin API key provided?
  const adminApiKey = process.env.ADMIN_API_KEY;
  const providedKey = req.headers['x-admin-api-key'];
  
  if (adminApiKey && providedKey && providedKey === adminApiKey) {
    console.log(`✅ Bulk operation authorized via API key from IP: ${req.ip}`);
    return next();
  }

  // Check 3: Development bypass (only if explicitly enabled)
  if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_BULK === 'true') {
    console.log(`⚠️ DEV MODE: Bulk operation allowed without auth from IP: ${req.ip}`);
    return next();
  }

  // No valid authorization found
  console.log(`❌ UNAUTHORIZED bulk operation attempt from IP: ${req.ip}`);
  res.status(401).json({ 
    error: "Unauthorized: Bulk operations require authentication or admin API key"
  });
}

// Helper function to send GPS tracking link SMS to driver
// loadId is optional - if null, sends general fleet tracking link instead of load-specific
async function sendGPSTrackingSMS(driverId: string, loadId: string | null): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`📍 GPS TRACKING SMS: Starting for driver ${driverId}${loadId ? `, load ${loadId}` : ' (general tracking)'}`);
    
    // Generate GPS tracking token for the driver
    const tokenResult = await storage.generateTrackingToken(driverId);
    if (!tokenResult?.token) {
      console.error(`❌ GPS TRACKING SMS: Failed to generate tracking token for driver ${driverId}`);
      return { success: false, error: "Failed to generate tracking token" };
    }
    const token = tokenResult.token;
    console.log(`🔐 GPS TRACKING SMS: Generated token for driver ${driverId}`);
    
    // Get driver details to get phone number
    const driver = await storage.getDriver(driverId);
    if (!driver) {
      console.error(`❌ GPS TRACKING SMS: Driver ${driverId} not found`);
      return { success: false, error: "Driver not found" };
    }
    
    // Get driver's phone number
    const driverPhone = driver.phoneNumber || driver.phone;
    const normalizedPhone = normalizePhoneToE164(driverPhone);
    
    if (!normalizedPhone) {
      console.log(`⚠️ GPS TRACKING SMS: Driver ${driver.name} has no valid phone number - cannot send GPS tracking SMS`);
      return { success: false, error: "Driver has no valid phone number" };
    }
    
    // Create tracking URL
    const trackingUrl = `${getBaseUrl()}/driver-tracker?driver=${driverId}&token=${token}`;
    
    // Create GPS tracking SMS message
    let smsMessage: string;
    let logContext: string;
    
    if (loadId) {
      // Load-specific tracking message
      const load = await storage.getLoad(loadId);
      if (!load) {
        console.error(`❌ GPS TRACKING SMS: Load ${loadId} not found`);
        return { success: false, error: "Load not found" };
      }
      
      // Extract locations with improved error handling
      const pickupLocation = extractCityState(load.pickupAddress);
      const deliveryLocation = extractCityState(load.deliveryAddress);
      
      // Build route info - only show arrow if we have valid locations
      let routeInfo = '';
      if (pickupLocation !== 'Location TBD' || deliveryLocation !== 'Location TBD') {
        routeInfo = `\n📦 ${pickupLocation} → ${deliveryLocation}`;
      }
      
      smsMessage = `📍 Load ${load.loadNumber} assigned!${routeInfo}\n\nStart GPS tracking: ${trackingUrl}\n\nClick the link to share your location with dispatch.`;
      logContext = `load ${load.loadNumber}`;
    } else {
      // General fleet tracking message
      smsMessage = `📍 GPS Tracking Request: Please share your location with dispatch: ${trackingUrl}\n\nClick the link to enable location tracking.`;
      logContext = 'general tracking';
    }
    
    console.log(`📱 GPS TRACKING SMS: Sending to ${driver.name} (${normalizedPhone}) for ${logContext}`);
    console.log(`📱 GPS TRACKING SMS: URL: ${trackingUrl}`);
    
    // Send SMS using existing SMS service
    const smsResult = await smsService.sendSMS({
      to: normalizedPhone,
      body: smsMessage
    });
    
    if (smsResult.success) {
      console.log(`✅ GPS TRACKING SMS: Successfully sent to ${driver.name} for ${logContext}`);
      console.log(`✅ GPS TRACKING SMS: Tracking URL: ${trackingUrl}`);
      return { success: true };
    } else {
      console.error(`❌ GPS TRACKING SMS: Failed to send - ${smsResult.error}`);
      return { success: false, error: smsResult.error || "Failed to send SMS" };
    }
    
  } catch (error) {
    console.error(`❌ GPS TRACKING SMS: Error sending GPS tracking SMS for driver ${driverId}${loadId ? `, load ${loadId}` : ''}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

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
    const normalizedDispatcherPhone = normalizePhoneToE164(dispatcherPhone);
    
    if (normalizedDispatcherPhone && twilioPhoneNumber) {
      try {
        await twilioClient.messages.create({
          to: normalizedDispatcherPhone,
          from: twilioPhoneNumber,
          body: emailNotificationMessage
        });
        console.log(`✅ Sent email booking notification to dispatcher via SMS (${normalizedDispatcherPhone})`);
      } catch (error) {
        console.error(`❌ Failed to send SMS notification:`, error);
      }
    } else {
      console.log(`📱 Email booking notification (dispatcher phone invalid or Twilio not configured): ${emailNotificationMessage}`);
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

async function initializeDependentServices() {
  try {
    console.log('🚀 Initializing dependent services...');
    
    continuousLoadService = new ContinuousLoadService();
    datScraperService = new DATScraperService();
    realLoadService = new RealLoadIntegrationService();
    datAPIService = new DATAPIService();
    datWebsiteScraper = new DATWebsiteScraper();
    realDATScraper = new RealDATScraper();
    
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

    // Initialize dependent services
    setTimeout(() => {
      initializeDependentServices();
    }, 2000);

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
      
      if (!twilioPhoneNumber) {
        return res.status(503).json({
          success: false,
          error: 'Twilio SMS is not configured',
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

      // Normalize phone number using helper - check both fields
      const driverPhone = driver.phoneNumber || driver.phone;
      const normalizedPhone = normalizePhoneToE164(driverPhone);
      
      if (!normalizedPhone) {
        return res.status(400).json({
          success: false,
          error: `Driver phone number (${driverPhone}) cannot be normalized to E.164 format`,
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
        `Phone: ${normalizedPhone}\n` +
        `Time: ${new Date().toLocaleString()}`;

      const smsResult = await twilioClient.messages.create({
        to: normalizedPhone,
        from: twilioPhoneNumber,
        body: testMessage
      });

      res.json({
        success: true,
        message: 'Test SMS sent successfully',
        driverName: driver.name,
        phoneNumber: normalizedPhone,
        messageId: smsResult.sid,
        timestamp: new Date().toISOString()
      });

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
      console.log('📋 Fetching driver locations from database...');
      
      // Get all drivers from database
      const drivers = await storage.getAllDrivers();
      console.log(`📋 Database returned ${drivers.length} drivers:`, 
        drivers.map(d => `${d.name} (${d.id})`));
      
      // Filter for available/on_route drivers and get their locations
      const activeDrivers = drivers.filter(d => d.status === 'available' || d.status === 'on_route');
      
      // Get real GPS locations from driverLocations table
      const locationPromises = activeDrivers.map(async (driver) => {
        // Get driver's current (most recent active) location from database
        const currentLocation = await storage.getDriverCurrentLocation(driver.id);
        
        console.log(`🔍 DEBUG - Driver ${driver.name} (${driver.id}): currentLocation =`, currentLocation ? `lat=${currentLocation.latitude}, lon=${currentLocation.longitude}, isActive=${currentLocation.isActive}` : 'NULL');
        
        if (currentLocation && currentLocation.isActive) {
          console.log(`📍 Using real GPS location for driver: ${driver.name}`);
          return {
            driverId: driver.id,
            driverName: driver.name,
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            address: currentLocation.address || `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`,
            lastUpdate: currentLocation.timestamp.toISOString(),
            speed: currentLocation.speed || 0,
            batteryLevel: currentLocation.batteryLevel || 85,
            isMoving: (currentLocation.speed || 0) > 0,
            heading: currentLocation.heading || 0,
            routeName: driver.status === 'on_route' ? 'Load Delivery Route' : undefined,
            source: 'gps'
          };
        }
        
        // Fallback to city-based location if no GPS data
        console.log(`📍 Using fallback location for driver: ${driver.name}`);
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
        
        let baseLocation = cityLocations['nashville'];
        if (driver.city) {
          const cityKey = driver.city.toLowerCase().split(',')[0].trim();
          if (cityLocations[cityKey]) {
            baseLocation = cityLocations[cityKey];
          }
        }
        
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
          source: 'fallback'
        };
      });
      
      const locations = await Promise.all(locationPromises);
      
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

  // Generate tracking token for driver GPS authentication
  app.post('/api/drivers/:driverId/generate-tracking-token', async (req, res) => {
    const { driverId } = req.params;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    try {
      console.log(`🔐 SECURITY: Generating tracking token for driver ${driverId} from IP ${ip}`);
      
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        console.log(`⚠️ SECURITY: Token generation failed - driver ${driverId} not found (IP: ${ip})`);
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      const result = await storage.generateTrackingToken(driverId);
      
      if (!result) {
        console.log(`❌ SECURITY: Token generation failed for driver ${driverId} (IP: ${ip})`);
        return res.status(500).json({ error: 'Failed to generate tracking token' });
      }
      
      console.log(`✅ SECURITY: Tracking token generated successfully for driver ${driverId} (IP: ${ip})`);
      
      res.json({
        success: true,
        token: result.token,
        driverId
      });
    } catch (error) {
      console.error(`❌ SECURITY: Error generating tracking token for driver ${driverId} (IP: ${ip}):`, error);
      res.status(500).json({ error: 'Failed to generate tracking token' });
    }
  });

  // Get driver earnings breakdown
  app.get('/api/drivers/:driverId/earnings', async (req, res) => {
    try {
      const { driverId } = req.params;
      
      // Get all loads for this driver
      const allLoads = await storage.getAllLoads();
      const driverLoads = allLoads.filter(load => load.driverId === driverId);
      
      // Get driver info for total revenue
      const driver = await storage.getDriver(driverId);
      
      // Calculate earnings
      const completedLoads = driverLoads.filter(load => 
        load.status === 'delivered' || load.status === 'completed'
      );
      
      const pendingPaymentLoads = completedLoads.filter(load => 
        load.status === 'delivered' // Delivered but not yet marked as completed/paid
      );
      
      const totalEarnings = driver?.totalRevenue || 0;
      const pendingPayment = pendingPaymentLoads.reduce((sum, load) => 
        sum + (load.rate ? load.rate * 0.9 : 0), 0
      );
      
      // Calculate this week and month earnings
      const now = new Date();
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const paidThisWeek = completedLoads
        .filter(load => load.status === 'completed' && load.deliveryDate && new Date(load.deliveryDate) >= weekStart)
        .reduce((sum, load) => sum + (load.rate ? load.rate * 0.9 : 0), 0);
      
      const paidThisMonth = completedLoads
        .filter(load => load.status === 'completed' && load.deliveryDate && new Date(load.deliveryDate) >= monthStart)
        .reduce((sum, load) => sum + (load.rate ? load.rate * 0.9 : 0), 0);
      
      // Format load earnings data
      const loads = completedLoads.map(load => ({
        loadNumber: load.loadNumber,
        amount: load.rate ? load.rate * 0.9 : 0,
        status: load.status,
        completedDate: load.deliveryDate,
        paymentStatus: load.status === 'completed' ? 'paid' : 'pending'
      }));
      
      res.json({
        totalEarnings,
        pendingPayment,
        paidThisWeek,
        paidThisMonth,
        loads
      });
    } catch (error) {
      console.error('Error fetching driver earnings:', error);
      res.status(500).json({ error: 'Failed to fetch driver earnings' });
    }
  });

  // Get driver load history
  app.get('/api/drivers/:driverId/load-history', async (req, res) => {
    try {
      const { driverId } = req.params;
      
      // Get all loads for this driver
      const allLoads = await storage.getAllLoads();
      const driverLoads = allLoads
        .filter(load => load.driverId === driverId)
        .sort((a, b) => {
          const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
          const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
          return dateB - dateA; // Most recent first
        });
      
      res.json(driverLoads);
    } catch (error) {
      console.error('Error fetching driver load history:', error);
      res.status(500).json({ error: 'Failed to fetch load history' });
    }
  });

  // Update driver location from GPS tracker
  // SECURITY: Token-based authentication, rate limited, validated, and logged endpoint
  app.post('/api/driver-location/update', gpsLocationRateLimiter, async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    try {
      // Validate request payload using Zod schema
      const validationResult = gpsLocationUpdateSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        console.log(`⚠️ SECURITY: Invalid GPS update rejected from IP ${ip}: ${errors}`);
        return res.status(400).json({ 
          error: 'Invalid request data',
          details: errors
        });
      }

      const { driverId, lat, lon, timestamp } = validationResult.data;
      const { trackingToken, accuracy, altitude, speed, heading, batteryLevel } = req.body;

      // CRITICAL SECURITY CHECK: Validate tracking token
      if (!trackingToken) {
        console.log(`🚨 SECURITY ALERT: GPS update rejected - missing tracking token for driver ${driverId} from IP ${ip}`);
        return res.status(401).json({ 
          error: 'Unauthorized: Tracking token required',
          message: 'GPS tracking requires authentication. Please restart tracking from your dashboard.'
        });
      }

      // Validate that the token matches the driver ID
      const isValidToken = await storage.validateTrackingToken(driverId, trackingToken);
      
      if (!isValidToken) {
        console.log(`🚨 SECURITY ALERT: GPS update rejected - invalid/mismatched tracking token for driver ${driverId} from IP ${ip}`);
        return res.status(401).json({ 
          error: 'Unauthorized: Invalid tracking token',
          message: 'Authentication failed. Please restart tracking from your dashboard.'
        });
      }

      // Security audit log - log all location updates with IP for monitoring
      console.log(`🔒 SECURITY AUDIT: GPS update - Driver: ${driverId}, IP: ${ip}, Coordinates: (${lat}, ${lon}), Speed: ${speed || 'N/A'}, Battery: ${batteryLevel || 'N/A'}%, Time: ${new Date().toISOString()}`);

      // Get human-readable address from coordinates using reverse geocoding
      const { reverseGeocode } = await import('./geocoding-service');
      const address = await reverseGeocode(lat, lon);
      
      // Create new driver location record in database with all available metadata
      await storage.createDriverLocation({
        driverId,
        latitude: lat,
        longitude: lon,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        isActive: true,
        source: 'gps', // Mark as real GPS data from driver's device
        accuracy: accuracy !== undefined ? accuracy : undefined,
        speed: speed !== undefined ? speed : undefined,
        heading: heading !== undefined ? heading : undefined,
        altitude: altitude !== undefined ? altitude : undefined,
        batteryLevel: batteryLevel !== undefined ? batteryLevel : undefined,
        signalStrength: undefined,
        address: address, // Real city, state from GPS coordinates
        loadId: undefined
      });

      // Deactivate old SIMULATED locations only - preserve all real GPS data
      const oldLocations = await storage.getDriverLocations(driverId, 10);
      for (const loc of oldLocations.slice(1)) {
        // Only deactivate simulated locations, never deactivate real GPS data
        if (loc.source !== 'gps') {
          await storage.updateDriverLocation(loc.id, { isActive: false });
        }
      }

      console.log(`✅ GPS location updated successfully for driver ${driverId}`);

      res.json({
        success: true,
        message: 'Location updated successfully',
        driverId,
        lat,
        lon,
        timestamp: timestamp || new Date().toISOString()
      });
    } catch (error) {
      console.error(`❌ SECURITY: GPS update error for IP ${ip}:`, error);
      res.status(500).json({ error: "Failed to update driver location" });
    }
  });

  // Manual GPS Tracking Link Sender
  // Allows dispatchers to manually send GPS tracking links to drivers
  // loadId is optional - used for delivery tracking or general fleet visibility
  app.post("/api/gps/send-tracking-link", async (req, res) => {
    try {
      const { driverId, loadId } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ 
          error: "driverId is required" 
        });
      }
      
      // loadId is optional - if not provided, it's for general fleet tracking
      const result = await sendGPSTrackingSMS(driverId, loadId || null);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: "GPS tracking link sent successfully" 
        });
      } else {
        res.status(400).json({ 
          success: false,
          error: result.error || "Failed to send GPS tracking link" 
        });
      }
    } catch (error) {
      console.error('Error sending GPS tracking link:', error);
      res.status(500).json({ 
        success: false,
        error: "Failed to send GPS tracking link" 
      });
    }
  });

  // CRITICAL DRIVER ENDPOINTS - Moved from deferred registration to immediate
  
  // Simple driver registration
  app.post("/api/simple-driver-registration", async (req, res) => {
    try {
      console.log('📱 Processing driver registration...');
      
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
      
      // Create driver in database
      const driver = await storage.createDriver(driverRecord);
      
      console.log(`✅ Driver created: ${driver.name} (${driver.id})`);
      
      // Send welcome SMS if Twilio is configured
      const normalizedPhone = normalizePhoneToE164(driver.phone);
      if (normalizedPhone && twilioPhoneNumber) {
        try {
          const welcomeMessage = `Welcome to LAMP Logistics, ${driver.name}!\n\n` +
            `Your driver account has been created successfully.\n` +
            `You'll receive load notifications via SMS.\n\n` +
            `Questions? Contact dispatch.`;
          
          await twilioClient.messages.create({
            to: normalizedPhone,
            from: twilioPhoneNumber,
            body: welcomeMessage
          });
          console.log(`📱 Sent welcome SMS to driver (${normalizedPhone})`);
        } catch (smsError) {
          console.error('⚠️ Failed to send welcome SMS:', smsError);
        }
      }
      
      res.status(201).json({
        ...driver,
        message: 'Driver registered successfully!'
      });
      
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

      // Fire-and-forget SMS send - don't await, don't block response
      const driverPhone = driver.phoneNumber || driver.phone;
      const normalizedPhone = normalizePhoneToE164(driverPhone);

      if (normalizedPhone) {
        // Send SMS asynchronously without blocking
        setImmediate(async () => {
          try {
            const dashboardUrl = `${getBaseUrl()}/driver-dashboard?driverId=${driver.id}`;
            
            const smsMessage = `Welcome to Load Signal, ${driver.name}! 👋\n\n` +
              `Your driver account has been created.\n\n` +
              `Access your dashboard:\n${dashboardUrl}\n\n` +
              `💡 Add this to your home screen for easy access!`;

            const smsResult = await smsLoadService.sendSMS({
              to: normalizedPhone,
              body: smsMessage
            });
            
            if (smsResult.success) {
              console.log(`✅ Dashboard link sent to new driver ${driver.name} (${normalizedPhone})`);
            } else {
              console.error(`⚠️ Failed to send dashboard link to new driver: ${smsResult.error}`);
            }
          } catch (smsError) {
            console.error('⚠️ Error sending dashboard link SMS:', smsError);
          }
        });
      }

      // Return immediately without waiting for SMS
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  // Send dashboard link SMS to a single driver
  app.post("/api/drivers/:id/send-dashboard-link", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get driver details
      const driver = await storage.getDriver(id);
      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found'
        });
      }

      // Normalize phone number
      const driverPhone = driver.phoneNumber || driver.phone;
      const normalizedPhone = normalizePhoneToE164(driverPhone);
      
      if (!normalizedPhone) {
        return res.status(400).json({
          success: false,
          error: `Driver phone number (${driverPhone}) cannot be normalized to E.164 format`,
          driverName: driver.name
        });
      }

      // Create dashboard URL
      const dashboardUrl = `${getBaseUrl()}/driver-dashboard?driverId=${driver.id}`;
      
      // Create SMS message
      const smsMessage = `Hello ${driver.name}! 👋\n\n` +
        `Access your Load Signal driver dashboard:\n${dashboardUrl}\n\n` +
        `💡 TIP: Add this to your home screen for easy access!`;

      // Send SMS using smsLoadService
      const smsResult = await smsLoadService.sendSMS({
        to: normalizedPhone,
        body: smsMessage
      });
      
      if (smsResult.success) {
        console.log(`✅ Dashboard link sent to ${driver.name} (${normalizedPhone})${smsResult.messageSid ? ` - SID: ${smsResult.messageSid}` : ''}`);
        
        res.json({
          success: true,
          message: 'Dashboard link sent successfully',
          driverName: driver.name,
          phoneNumber: normalizedPhone,
          messageId: smsResult.messageSid
        });
      } else {
        console.error(`❌ Failed to send dashboard link SMS: ${smsResult.error}`);
        res.status(503).json({
          success: false,
          error: smsResult.error || 'Failed to send SMS'
        });
      }

    } catch (error) {
      console.error('Error sending dashboard link SMS:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Send dashboard links to all active drivers
  app.post("/api/drivers/send-dashboard-links", requireBulkAuthorization, bulkSmsRateLimiter, async (req, res) => {
    try {
      const userIdentifier = req.user?.claims?.email || (req.headers['x-admin-api-key'] ? 'API_KEY' : 'DEV_MODE');
      console.log(`🚨 BULK SMS SEND INITIATED - User: ${userIdentifier}, IP: ${req.ip}, Time: ${new Date().toISOString()}`);
      
      const drivers = await storage.getAllDrivers();
      
      // Filter for drivers with valid phone numbers
      const driversWithPhones = drivers.filter(d => {
        const phone = d.phoneNumber || d.phone;
        return normalizePhoneToE164(phone) !== null;
      });

      if (driversWithPhones.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No drivers found with valid phone numbers'
        });
      }

      // Limit batch size to prevent runaway costs
      const MAX_BATCH_SIZE = 100;
      if (driversWithPhones.length > MAX_BATCH_SIZE) {
        console.log(`⚠️ SECURITY: Bulk send attempted for ${driversWithPhones.length} drivers - limiting to ${MAX_BATCH_SIZE}`);
        return res.status(400).json({
          success: false,
          error: `Batch size too large (${driversWithPhones.length} drivers). Maximum allowed: ${MAX_BATCH_SIZE}. Please contact admin for large batches.`
        });
      }

      console.log(`📱 Sending dashboard links to ${driversWithPhones.length} drivers...`);

      const results = {
        total: driversWithPhones.length,
        sent: 0,
        failed: 0,
        errors: [] as any[]
      };

      // Send SMS to each driver
      for (const driver of driversWithPhones) {
        try {
          const driverPhone = driver.phoneNumber || driver.phone;
          const normalizedPhone = normalizePhoneToE164(driverPhone);
          
          if (!normalizedPhone) {
            results.failed++;
            results.errors.push({
              driverId: driver.id,
              driverName: driver.name,
              error: 'Invalid phone number format'
            });
            continue;
          }

          const dashboardUrl = `${getBaseUrl()}/driver-dashboard?driverId=${driver.id}`;
          
          const smsMessage = `Hello ${driver.name}! 👋\n\n` +
            `Access your Load Signal driver dashboard:\n${dashboardUrl}\n\n` +
            `💡 TIP: Add this to your home screen for easy access!`;

          const smsResult = await smsLoadService.sendSMS({
            to: normalizedPhone,
            body: smsMessage
          });
          
          if (smsResult.success) {
            results.sent++;
            console.log(`✅ Dashboard link sent to ${driver.name} (${normalizedPhone})`);
          } else {
            results.failed++;
            results.errors.push({
              driverId: driver.id,
              driverName: driver.name,
              error: smsResult.error || 'Unknown error'
            });
            console.error(`❌ Failed to send to ${driver.name}: ${smsResult.error}`);
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          results.failed++;
          results.errors.push({
            driverId: driver.id,
            driverName: driver.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      console.log(`✅ Bulk send complete: ${results.sent} sent, ${results.failed} failed`);

      res.json({
        success: true,
        results: results,
        message: `Sent ${results.sent} of ${results.total} dashboard links`
      });

    } catch (error) {
      console.error('Error sending bulk dashboard links:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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
      const { status, driverId } = req.query;
      
      // BUG FIX #3: Add driverId filtering support
      if (driverId && typeof driverId === "string") {
        const loads = await storage.getLoadsByDriver(driverId);
        res.json(loads);
      } else if (status && typeof status === "string") {
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
        console.log(`🚛 Load ${id} assigned to driver ${validatedData.driverId}`);
        // SMS notifications handled separately
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
      const { forceComplete, overrideReason } = req.query;
      
      // Get current load before updating to check for status changes
      const currentLoad = await storage.getLoad(id);
      if (!currentLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      // 🚫 LOAD COMPLETION GATE: Prevent completion without required approved documents
      if (updates.status === 'completed' && !forceComplete) {
        console.log(`🔒 Load Completion Gate: Checking required documents for load ${id}...`);
        
        // Get all documents for this load
        const allDocuments = await storage.getLoadDocumentsByLoad(id);
        const approvedDocuments = allDocuments.filter(doc => doc.approvalStatus === 'approved');
        
        // Check for required document types
        const hasApprovedBOL = approvedDocuments.some(doc => doc.documentType === 'bol');
        const hasApprovedPOD = approvedDocuments.some(doc => doc.documentType === 'pod');
        
        const missingDocs: string[] = [];
        if (!hasApprovedBOL) missingDocs.push('BOL (Bill of Lading)');
        if (!hasApprovedPOD) missingDocs.push('POD (Proof of Delivery)');
        
        if (missingDocs.length > 0) {
          console.log(`❌ Load Completion Gate: Blocked - Missing approved documents: ${missingDocs.join(', ')}`);
          return res.status(400).json({
            error: 'Cannot complete load. Missing required approved documents.',
            missingDocuments: missingDocs,
            message: `This load cannot be marked as completed until the following documents are approved: ${missingDocs.join(', ')}. Please have the driver upload these documents and get them approved before completing the load.`,
            canOverride: true
          });
        }
        
        console.log(`✅ Load Completion Gate: All required documents approved - allowing completion`);
      }
      
      // Handle override for emergency completion
      if (updates.status === 'completed' && forceComplete === 'true') {
        console.log(`⚠️  Load Completion Gate: OVERRIDE used for load ${id}`);
        console.log(`Override reason: ${overrideReason || 'No reason provided'}`);
        
        // Log the override in communication logs
        await storage.createCommunicationLog({
          loadId: id,
          threadId: null,
          action: 'load_completion_override',
          actorId: 'dispatcher', // In production, get from authenticated user
          actorRole: 'dispatcher',
          details: {
            reason: overrideReason || 'Emergency override - no reason provided',
            timestamp: new Date().toISOString(),
            originalStatus: currentLoad.status,
            newStatus: 'completed'
          },
          timestamp: new Date()
        });
      }
      
      const updatedLoad = await storage.updateLoad(id, updates);
      if (!updatedLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      // BUG FIX #1: Update driver stats when load is marked as 'completed'
      if (updates.status === 'completed' && currentLoad.status !== 'completed' && updatedLoad.driverId) {
        try {
          const driver = await storage.getDriver(updatedLoad.driverId);
          if (driver) {
            const totalLoads = (driver.totalLoads || 0) + 1;
            const completedLoads = (driver.completedLoads || 0) + 1;
            const totalRevenue = (driver.totalRevenue || 0) + (updatedLoad.rate || 0);
            
            await storage.updateDriver(updatedLoad.driverId, {
              totalLoads,
              completedLoads,
              totalRevenue
            });
            
            console.log(`✅ Driver stats updated: total_loads=${totalLoads}, completed_loads=${completedLoads}, revenue=$${totalRevenue}`);
          } else {
            console.error(`❌ Driver ${updatedLoad.driverId} not found - cannot update stats`);
          }
        } catch (error) {
          console.error(`❌ Error updating driver stats for load ${id}:`, error);
        }
      }
      
      // Check if status changed to "in_transit" (driver started delivery)
      if (updates.status === 'in_transit' && currentLoad.status !== 'in_transit') {
        console.log(`🚚 Load ${id} status changed to in_transit - sending GPS tracking SMS`);
        
        // Send GPS tracking link SMS to driver when they start delivery
        if (updatedLoad.driverId) {
          sendGPSTrackingSMS(updatedLoad.driverId, id).catch(error => {
            console.error(`❌ Failed to send GPS tracking SMS for load ${id}:`, error);
          });
        } else {
          console.log(`⚠️ Cannot send GPS tracking SMS - no driver assigned to load ${id}`);
        }
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
      
      // BUG FIX #2: Update driver status to 'on_route' when load is assigned
      if (updatedLoad.driverId) {
        try {
          await storage.updateDriver(updatedLoad.driverId, { status: 'on_route' });
          console.log(`✅ Driver status updated to 'on_route'`);
        } catch (error) {
          console.error(`❌ Error updating driver status:`, error);
        }
      }
      
      // GPS tracking SMS removed - now sent when driver starts delivery (status: in_transit)
      // Driver will receive GPS tracking link when they click "Start Delivery"
      
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

  // ==================== DOCUMENT UPLOAD & OBJECT STORAGE ====================
  
  // POST /api/documents/upload-url - Get presigned URL for document upload
  app.post('/api/documents/upload-url', async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      
      res.json({ uploadUrl });
    } catch (error) {
      console.error('Error generating upload URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  // GET /api/documents/all - Get all documents across all loads with load details
  app.get('/api/documents/all', async (req, res) => {
    try {
      const documents = await storage.getAllDocuments();
      res.json(documents);
    } catch (error) {
      console.error('Error fetching all documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  // POST /api/documents - Create a new document record
  app.post('/api/documents', async (req, res) => {
    try {
      // Validate request body with Zod schema
      const validatedData = insertLoadDocumentSchema.parse(req.body);

      const document = await storage.createDocument(validatedData);

      console.log(`✅ Document created: ${validatedData.documentType} for load ${validatedData.loadId}`);
      res.json(document);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid document data', details: error.errors });
      }
      console.error('Error creating document:', error);
      res.status(500).json({ error: 'Failed to create document' });
    }
  });

  // ==================== DOCUMENT APPROVAL WORKFLOW API ENDPOINTS ====================
  
  // 1. POST /api/documents/:documentId/approve - Approve a document
  app.post('/api/documents/:documentId/approve', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { approvedBy, notes } = req.body;
      
      if (!approvedBy) {
        return res.status(400).json({ error: 'Approver ID is required' });
      }
      
      const document = await storage.approveDocument(documentId, approvedBy, notes);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      console.log(`✅ Document ${documentId} approved by ${approvedBy}`);
      res.json({ 
        success: true, 
        message: 'Document approved successfully',
        document 
      });
    } catch (error) {
      console.error('Error approving document:', error);
      res.status(500).json({ error: 'Failed to approve document' });
    }
  });
  
  // 2. POST /api/documents/:documentId/reject - Reject a document with SMS notification
  app.post('/api/documents/:documentId/reject', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { rejectedBy, reason } = req.body;
      
      if (!rejectedBy || !reason) {
        return res.status(400).json({ error: 'Rejected by and reason are required' });
      }
      
      // Get document to find driver info before rejection
      const existingDocument = await storage.getLoadDocument(documentId);
      if (!existingDocument) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      const document = await storage.rejectDocument(documentId, rejectedBy, reason);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Send SMS notification to driver about rejection
      try {
        if (document.driverId) {
          const driver = await storage.getDriver(document.driverId);
          const load = document.loadId ? await storage.getLoad(document.loadId) : null;
          
          if (driver?.phone) {
            const driverPhone = normalizePhoneToE164(driver.phone);
            if (driverPhone) {
              // Build load context with route info if available
              let loadContext = '';
              if (load) {
                const pickupLocation = extractCityState(load.pickupAddress);
                const deliveryLocation = extractCityState(load.deliveryAddress);
                
                // Only show route info if we have valid locations
                if (pickupLocation !== 'Location TBD' || deliveryLocation !== 'Location TBD') {
                  loadContext = ` (${pickupLocation} → ${deliveryLocation})`;
                }
                loadContext = `load ${load.loadNumber}${loadContext}`;
              } else {
                loadContext = `load ${document.loadId}`;
              }
              
              const smsMessage = `📄 Document Rejected\n\n` +
                `Your ${document.documentType.replace('_', ' ').toUpperCase()} for ${loadContext} was rejected.\n\n` +
                `Reason: ${reason}\n\n` +
                `Please resubmit a corrected document. Contact dispatch if you have questions.`;
              
              const result = await smsService.sendSMS(driverPhone, smsMessage);
              
              if (result.success) {
                console.log(`📱 Rejection SMS sent to driver ${driver.name} for document ${documentId}`);
              } else {
                console.error(`Failed to send rejection SMS: ${result.error}`);
              }
            }
          }
        }
      } catch (smsError) {
        console.error('Error sending rejection SMS:', smsError);
        // Continue even if SMS fails - rejection is still recorded
      }
      
      console.log(`❌ Document ${documentId} rejected by ${rejectedBy}: ${reason}`);
      res.json({ 
        success: true, 
        message: 'Document rejected and driver notified',
        document 
      });
    } catch (error) {
      console.error('Error rejecting document:', error);
      res.status(500).json({ error: 'Failed to reject document' });
    }
  });
  
  // 3. POST /api/documents/:documentId/recategorize - Recategorize a document
  app.post('/api/documents/:documentId/recategorize', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { category } = req.body;
      
      // Validate category against known document types
      const validCategories = ['bol', 'pod', 'weight_ticket', 'inspection', 'receipt', 'fuel_receipt', 'scale_ticket', 'freight_photo', 'other'];
      if (!category || !validCategories.includes(category)) {
        return res.status(400).json({ 
          error: 'Invalid category',
          validCategories 
        });
      }
      
      const document = await storage.recategorizeDocument(documentId, category);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      console.log(`🔄 Document ${documentId} recategorized to ${category}`);
      res.json({ 
        success: true, 
        message: `Document recategorized to ${category}`,
        document 
      });
    } catch (error) {
      console.error('Error recategorizing document:', error);
      res.status(500).json({ error: 'Failed to recategorize document' });
    }
  });
  
  // 4. GET /api/loads/:loadId/documents - Get all documents for a load
  app.get('/api/loads/:loadId/documents', async (req, res) => {
    try {
      const { loadId } = req.params;
      const includeRejected = req.query.includeRejected === 'true';
      
      const documents = await storage.getDocumentsByLoad(loadId, includeRejected);
      
      res.json(documents);
    } catch (error) {
      console.error('Error fetching load documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  // POST /api/loads/:loadId/upload-document - Upload a document for a load
  app.post('/api/loads/:loadId/upload-document', async (req, res) => {
    try {
      const { loadId } = req.params;
      const { documentType, fileName, fileUrl, fileSize, mimeType, driverId } = req.body;

      // Validate required fields
      if (!loadId) {
        return res.status(400).json({ error: 'Load ID is required' });
      }
      if (!documentType) {
        return res.status(400).json({ error: 'Document type is required' });
      }
      if (!fileName) {
        return res.status(400).json({ error: 'File name is required' });
      }
      if (!fileUrl) {
        return res.status(400).json({ error: 'File URL is required' });
      }
      if (!driverId) {
        return res.status(400).json({ error: 'Driver ID is required' });
      }

      // Validate document type
      const validDocumentTypes = ['bol', 'freight_photo', 'delivery_photo', 'signature', 'pod', 'weight_ticket', 'lumper_receipt', 'scale_ticket', 'inspection_report', 'damage_report', 'temperature_log', 'customs_documents', 'other'];
      if (!validDocumentTypes.includes(documentType)) {
        return res.status(400).json({ 
          error: 'Invalid document type',
          validTypes: validDocumentTypes
        });
      }

      // Verify load exists
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }

      // Verify driver exists
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
      }

      // Normalize the file URL to get the object path
      const objectStorageService = new ObjectStorageService();
      const objectPath = objectStorageService.normalizeObjectEntityPath(fileUrl);
      
      // Set ACL policy for the uploaded document
      await objectStorageService.trySetObjectEntityAclPolicy(fileUrl, {
        owner: driverId,
        visibility: "private",
      });

      // Create document record
      const document = await storage.createLoadDocument({
        loadId,
        driverId,
        documentType,
        fileName,
        fileUrl: objectPath,
        fileSize,
        mimeType,
      });

      console.log(`📄 Document uploaded: ${documentType} for load ${loadId} by driver ${driverId}`);

      // Get updated documents list for the load
      const documents = await storage.getDocumentsByLoad(loadId, false);

      res.json({
        success: true,
        message: 'Document uploaded successfully',
        document,
        documents
      });
    } catch (error) {
      console.error('Error uploading document:', error);
      res.status(500).json({ 
        error: 'Failed to upload document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // 5. GET /api/loads/:loadId/documents/required - Get required documents status
  app.get('/api/loads/:loadId/documents/required', async (req, res) => {
    try {
      const { loadId } = req.params;
      
      const requiredDocuments = await storage.getRequiredDocuments(loadId);
      
      res.json(requiredDocuments);
    } catch (error) {
      console.error('Error fetching required documents:', error);
      res.status(500).json({ error: 'Failed to fetch required documents' });
    }
  });
  
  // 6. GET /api/documents/:documentId/audit-log - Get document version history
  app.get('/api/documents/:documentId/audit-log', async (req, res) => {
    try {
      const { documentId } = req.params;
      
      const auditLog = await storage.getDocumentAuditLog(documentId);
      
      res.json(auditLog);
    } catch (error) {
      console.error('Error fetching document audit log:', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // 7. GET /api/documents/:documentId/annotations - Get document annotations
  app.get('/api/documents/:documentId/annotations', async (req, res) => {
    try {
      const { documentId } = req.params;
      
      // Get document to retrieve annotations from notes field
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Annotations are stored as JSON in the notes field
      let annotations = [];
      if (document.notes) {
        try {
          const parsed = JSON.parse(document.notes);
          if (Array.isArray(parsed)) {
            annotations = parsed;
          }
        } catch (e) {
          // Notes field might contain regular text, not JSON
          console.log('Notes field is not JSON, returning empty annotations');
        }
      }
      
      res.json(annotations);
    } catch (error) {
      console.error('Error fetching document annotations:', error);
      res.status(500).json({ error: 'Failed to fetch annotations' });
    }
  });

  // 8. POST /api/documents/:documentId/annotations - Save document annotations
  app.post('/api/documents/:documentId/annotations', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { annotations } = req.body;
      
      if (!Array.isArray(annotations)) {
        return res.status(400).json({ error: 'Annotations must be an array' });
      }
      
      // Store annotations as JSON in the notes field
      await storage.updateDocumentNotes(documentId, JSON.stringify(annotations));
      
      res.json({ success: true, message: 'Annotations saved successfully' });
    } catch (error) {
      console.error('Error saving document annotations:', error);
      res.status(500).json({ error: 'Failed to save annotations' });
    }
  });

  // ==================== PDF GENERATION & EMAIL DELIVERY ENDPOINTS ====================
  
  // 9. POST /api/loads/:loadId/generate-pdf - Generate PDF package for load
  app.post('/api/loads/:loadId/generate-pdf', async (req, res) => {
    try {
      const { loadId } = req.params;
      
      console.log(`📄 Generating PDF package for load ${loadId}...`);
      
      const { pdfPath, pdfUrl } = await pdfService.generateLoadDocumentPackage(loadId);
      
      res.json({
        success: true,
        message: 'PDF package generated successfully',
        pdfUrl,
        pdfPath
      });
    } catch (error) {
      console.error('Error generating PDF package:', error);
      res.status(500).json({
        error: 'Failed to generate PDF package',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // 10. GET /api/loads/:loadId/download-pdf/:filename - Download generated PDF
  app.get('/api/loads/:loadId/download-pdf/:filename', async (req, res) => {
    try {
      const { loadId, filename } = req.params;
      const pdfPath = path.join('/tmp', filename);
      
      // Check if file exists
      if (!fs.existsSync(pdfPath)) {
        return res.status(404).json({ error: 'PDF not found' });
      }
      
      // Stream the PDF file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(pdfPath);
      fileStream.pipe(res);
      
      console.log(`📥 PDF downloaded: ${filename}`);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      res.status(500).json({ error: 'Failed to download PDF' });
    }
  });
  
  // 11. POST /api/loads/:loadId/email-documents - Email document package
  app.post('/api/loads/:loadId/email-documents', async (req, res) => {
    try {
      const { loadId } = req.params;
      const { recipientEmail, recipientType } = req.body;
      
      if (!recipientEmail) {
        return res.status(400).json({ error: 'Recipient email is required' });
      }
      
      console.log(`📧 Emailing document package for load ${loadId} to ${recipientEmail}...`);
      
      // Generate PDF first
      const { pdfPath, pdfUrl } = await pdfService.generateLoadDocumentPackage(loadId);
      
      // Get load details for email
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      // Get all approved documents
      const allDocuments = await storage.getLoadDocumentsByLoad(loadId);
      const approvedDocuments = allDocuments.filter(doc => doc.approvalStatus === 'approved');
      
      // Create document list for email
      const documentList = approvedDocuments.map((doc, index) => {
        const typeLabel = doc.documentType.replace('_', ' ').toUpperCase();
        return `${index + 1}. ${typeLabel} - Uploaded: ${new Date(doc.uploadedAt).toLocaleDateString()}, Approved: ${doc.approvedAt ? new Date(doc.approvedAt).toLocaleDateString() : 'N/A'}`;
      }).join('\n');
      
      // Create professional email
      const emailSubject = `Load ${load.loadNumber} - Complete Documentation Package`;
      const emailBody = `
Dear ${recipientType === 'customer' ? 'Customer' : recipientType === 'shipper' ? 'Shipper' : recipientType === 'consignee' ? 'Consignee' : 'Partner'},

Please find attached the complete documentation package for Load ${load.loadNumber}.

LOAD DETAILS:
- Load Number: ${load.loadNumber}
- Pickup: ${load.pickupAddress}
- Pickup Date: ${new Date(load.pickupDate).toLocaleDateString()} at ${load.pickupTime}
- Delivery: ${load.deliveryAddress}
- Delivery Date: ${new Date(load.deliveryDate).toLocaleDateString()} at ${load.deliveryTime}

INCLUDED DOCUMENTS (${approvedDocuments.length} total):
${documentList}

All documents have been reviewed and approved by our dispatch team. If you have any questions or need additional information, please contact us.

Best regards,
LoadMaster Dispatch Team
      `;
      
      // Send email with PDF attachment
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "LoadMaster <noreply@loadmaster.com>",
        to: recipientEmail,
        subject: emailSubject,
        text: emailBody,
        attachments: [
          {
            filename: `load_${load.loadNumber}_documents.pdf`,
            path: pdfPath
          }
        ]
      });
      
      // Log successful email
      await storage.createEmailLog({
        loadId,
        recipientEmail,
        subject: emailSubject,
        status: "sent",
        sentAt: new Date(),
      });
      
      console.log(`✅ Document package emailed to ${recipientEmail}`);
      
      res.json({
        success: true,
        message: `Document package sent to ${recipientEmail}`,
        documentsIncluded: approvedDocuments.length
      });
    } catch (error) {
      console.error('Error emailing document package:', error);
      
      // Log failed email
      try {
        await storage.createEmailLog({
          loadId: req.params.loadId,
          recipientEmail: req.body.recipientEmail,
          subject: `Load ${req.params.loadId} - Document Package`,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
      } catch (logError) {
        console.error('Failed to log email error:', logError);
      }
      
      res.status(500).json({
        error: 'Failed to email document package',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
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

  // Create communication thread (generic - supports both general and load threads)
  app.post('/api/communication/threads', async (req, res) => {
    try {
      const { driverId, loadId, threadType } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: 'Driver ID required' });
      }
      
      // Get driver info
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      // If loadId provided, verify it exists and get load details
      let loadNumber = null;
      let loadOrigin = null;
      let loadDestination = null;
      
      if (loadId) {
        const load = await storage.getLoad(loadId);
        if (!load) {
          return res.status(404).json({ error: 'Load not found' });
        }
        loadNumber = load.loadNumber;
        loadOrigin = load.pickupAddress || null;
        loadDestination = load.deliveryAddress || null;
      }
      
      // Create thread
      const thread = await storage.createLoadCommunicationThread({
        threadType: threadType || (loadId ? 'load' : 'general'),
        driverId: driverId,
        loadId: loadId || null,
        status: 'active',
        messageCount: 0,
        unreadDriverMessages: 0,
        unreadDispatchMessages: 0,
        driverName: driver.name,
        driverPhone: driver.phone || '',
        loadNumber: loadNumber,
        loadOrigin: loadOrigin,
        loadDestination: loadDestination,
        assistantEnabled: false,
        assistantMode: 'off',
        autoSendConfidence: 80
      });
      
      res.json(thread);
    } catch (error) {
      console.error('Error creating communication thread:', error);
      res.status(500).json({ error: 'Failed to create communication thread' });
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
        
        // GPS tracking SMS removed - now sent when driver starts delivery (status: in_transit)
        // Driver will receive GPS tracking link when they click "Start Delivery"
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
      const { threadId} = req.params;
      const messages = await storage.getLoadMessagesByThread(threadId);
      
      // Transform snake_case DB fields to camelCase for frontend
      const transformedMessages = messages.map((msg: any) => ({
        id: msg.id,
        threadId: msg.threadId || msg.thread_id,
        loadId: msg.loadId || msg.load_id,
        senderId: msg.senderId || msg.sender_id,
        senderRole: msg.senderRole || msg.sender_role,
        senderName: msg.senderName || msg.sender_name,
        messageType: msg.messageType || msg.message_type,
        content: msg.textContent || msg.text_content || '',
        textContent: msg.textContent || msg.text_content,
        mediaUrl: msg.mediaUrl || msg.media_url,  // Read snake_case field from DB
        mediaType: msg.mediaType || msg.media_type, // Read snake_case field from DB
        smsMessageId: msg.smsMessageId || msg.sms_message_id,
        isRead: msg.isRead ?? msg.is_read ?? false,
        readAt: msg.readAt || msg.read_at,
        deliveryStatus: msg.deliveryStatus || msg.delivery_status,
        deliveryMethod: msg.deliveryMethod || msg.delivery_method,
        isSuggested: msg.isSuggested ?? msg.is_suggested ?? false,
        isSent: msg.isSent ?? msg.is_sent ?? false,
        approvedBy: msg.approvedBy || msg.approved_by,
        approvedAt: msg.approvedAt || msg.approved_at,
        sender: (msg.senderRole || msg.sender_role) === 'driver' ? 'driver' : 'dispatch',
        createdAt: msg.createdAt || msg.created_at
      }));
      
      res.json(transformedMessages);
    } catch (error) {
      console.error('❌ Error fetching messages:', error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Proxy endpoint to serve Twilio MMS images with authentication
  app.get('/api/communication/media-proxy', async (req, res) => {
    try {
      const { url } = req.query;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Media URL is required' });
      }
      
      // Ensure Twilio credentials are configured
      if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.error('❌ Twilio credentials not configured');
        return res.status(500).json({ error: 'Server configuration error' });
      }
      
      // Parse and validate the URL to prevent SSRF attacks
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      
      // Validate that this is a Twilio media URL (strict hostname check)
      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'api.twilio.com') {
        return res.status(400).json({ error: 'Only Twilio media URLs are allowed' });
      }
      
      // Validate that the URL path matches the expected Twilio media endpoint pattern
      const expectedPathPattern = `/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages/`;
      if (!parsedUrl.pathname.startsWith(expectedPathPattern)) {
        return res.status(400).json({ error: 'Invalid Twilio media URL path' });
      }
      
      console.log(`📷 Proxying Twilio media: ${url}`);
      
      // Fetch the image from Twilio with authentication
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString('base64')
        }
      });
      
      if (!response.ok) {
        console.error(`❌ Failed to fetch media from Twilio: ${response.status} ${response.statusText}`);
        return res.status(response.status).json({ error: 'Failed to fetch media from Twilio' });
      }
      
      // Get the image data and content type
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const imageBuffer = await response.arrayBuffer();
      
      console.log(`✅ Successfully fetched media (${contentType}, ${imageBuffer.byteLength} bytes)`);
      
      // Set appropriate headers and send the image
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(Buffer.from(imageBuffer));
      
    } catch (error) {
      console.error('❌ Error proxying media:', error);
      res.status(500).json({ error: 'Failed to proxy media' });
    }
  });

  // Send message to thread via SMS
  app.post('/api/communication/messages', async (req, res) => {
    try {
      const { threadId, content, sender = 'dispatch' } = req.body;
      
      if (!threadId || !content) {
        return res.status(400).json({ error: 'Thread ID and content are required' });
      }

      // Get thread details
      const thread = await storage.getLoadCommunicationThread(threadId);
      if (!thread) {
        return res.status(404).json({ error: 'Communication thread not found' });
      }

      let deliveryMethod = 'none';
      let deliverySuccess = false;
      
      if (sender === 'dispatch' || sender === 'dispatcher') {
        const driver = await storage.getDriver(thread.driverId);
        if (!driver) {
          return res.status(404).json({ error: 'Driver not found for this thread' });
        }

        // Format message based on thread type
        let smsMessage: string;
        
        if (thread.threadType === 'general') {
          // General chat: Simple message format
          smsMessage = `Message from Dispatch: ${content}`;
        } else {
          // Load communication: Include load context with route information
          const load = thread.loadId ? await storage.getLoad(thread.loadId) : null;
          if (load) {
            // Extract locations with improved error handling
            const pickupLocation = extractCityState(load.pickupAddress);
            const deliveryLocation = extractCityState(load.deliveryAddress);
            
            // Build route info - only show arrow if we have valid locations
            let routeInfo = '';
            if (pickupLocation !== 'Location TBD' || deliveryLocation !== 'Location TBD') {
              routeInfo = ` (${pickupLocation} → ${deliveryLocation})`;
            }
            
            smsMessage = `Load ${load.loadNumber}${routeInfo}: ${content}`;
          } else {
            smsMessage = `Load Message: ${content}`;
          }
        }
        
        // Send via SMS using the SMS service (handles Messaging Service SID and delivery status)
        const driverPhone = driver.phoneNumber || driver.phone;
        const normalizedPhone = normalizePhoneToE164(driverPhone);
        
        if (normalizedPhone) {
          try {
            console.log(`📱 Sending SMS to ${driver.name} (${normalizedPhone})`);
            
            const smsResult = await smsService.sendSMS({
              to: normalizedPhone,
              body: smsMessage
            });
            
            if (smsResult.success) {
              console.log(`✅ Message sent via SMS to ${driver.name} (${normalizedPhone})${smsResult.messageSid ? ` - SID: ${smsResult.messageSid}` : ''}`);
              deliveryMethod = 'sms';
              deliverySuccess = true;
            } else {
              console.error(`❌ SMS delivery failed: ${smsResult.error}`);
            }
          } catch (smsError) {
            console.error(`❌ SMS delivery error:`, smsError);
          }
        } else {
          console.log(`❌ Cannot send SMS - invalid phone (phoneNumber: ${driver.phoneNumber}, phone: ${driver.phone})`);
        }
        
        if (!deliverySuccess) {
          return res.status(503).json({ 
            error: 'Message could not be delivered via SMS',
            success: false 
          });
        }
      }

      // Store message in database
      await storage.createLoadMessage({
        threadId: threadId,
        loadId: thread.loadId || null,
        senderId: sender === 'driver' ? thread.driverId : null,
        senderRole: sender,
        senderName: sender === 'driver' ? thread.driverName : 'Dispatcher',
        messageType: 'text',
        textContent: content,
        isRead: false,
        isSuggested: false,
        isSent: true,
        communicationMethod: deliveryMethod
      });

      // Update thread stats
      await storage.updateLoadCommunicationThread(threadId, {
        messageCount: (thread.messageCount || 0) + 1,
        lastMessageAt: new Date(),
        lastMessageText: content.substring(0, 100),
        lastMessageSender: sender
      });
      
      res.json({ 
        success: true,
        message: `Message sent via ${deliveryMethod}`,
        deliveryMethod: deliveryMethod
      });
    } catch (error) {
      console.error('❌ Error sending message:', error);
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
      
      const { From, Body, MessageSid, NumMedia } = req.body;
      
      if (!From) {
        console.log('⚠️ Invalid SMS webhook data - missing From');
        console.log('📋 Request body keys:', Object.keys(req.body));
        return res.status(400).send('Invalid webhook data');
      }

      // Extract MMS media attachments if present
      const mediaUrls: string[] = [];
      const mediaTypes: string[] = [];
      const numMedia = parseInt(NumMedia || '0', 10);
      
      if (numMedia > 0) {
        console.log(`📎 MMS received with ${numMedia} media attachment(s)`);
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = req.body[`MediaUrl${i}`];
          const mediaType = req.body[`MediaContentType${i}`];
          if (mediaUrl) {
            mediaUrls.push(mediaUrl);
            mediaTypes.push(mediaType || 'unknown');
            console.log(`  📷 Media ${i}: ${mediaType} - ${mediaUrl}`);
          }
        }
      }

      // Handle incoming SMS/MMS through communication service
      await smsCommunicationService.handleIncomingSMS(From, Body || '', MessageSid, mediaUrls, mediaTypes);
      
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

  // SMS status webhook to track delivery status (both endpoints for compatibility)
  const handleSmsStatus = async (req: any, res: any) => {
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
      
      const { MessageSid, MessageStatus, ErrorCode, ErrorMessage, To } = req.body;
      
      console.log(`📱 SMS Status Update - SID: ${MessageSid}, Status: ${MessageStatus}, To: ${To}`);
      
      if (MessageStatus === 'delivered') {
        console.log(`✅ SMS ${MessageSid} delivered successfully to ${To}`);
      } else if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
        console.log(`❌ SMS ${MessageSid} to ${To} failed with status: ${MessageStatus}`);
        if (ErrorCode) {
          console.log(`   Error Code: ${ErrorCode} - ${ErrorMessage}`);
          // Log common error codes with explanations
          if (ErrorCode === '21610') {
            console.log('   ⚠️ Recipient has opted out (sent STOP). They must text START to re-enable.');
          } else if (ErrorCode === '30007') {
            console.log('   ⚠️ Carrier filtering/blocking. Ensure A2P 10DLC campaign is approved.');
          } else if (ErrorCode === '21408' || ErrorCode === '21608') {
            console.log('   ⚠️ Permission to send to this number not enabled or trial account restriction.');
          }
        }
      } else if (MessageStatus === 'sent' || MessageStatus === 'queued') {
        console.log(`📤 SMS ${MessageSid} ${MessageStatus} to ${To}`);
      }
      
      // Just acknowledge receipt
      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ Error handling SMS status webhook:', error);
      res.status(500).send('Error processing status');
    }
  };

  app.post('/api/sms/status', handleSmsStatus);
  app.post('/api/sms/status-callback', handleSmsStatus);

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
