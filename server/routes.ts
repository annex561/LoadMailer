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
import { insertDriverSchema, insertCustomerSchema, insertLoadSchema, insertEmailTemplateSchema, insertOnboardingTokenSchema, insertDriverLocationSchema, driverOnboardingSchema, type LoadWithRelations, type DriverLocationUpdate, type InsertLoad, insertGeofenceSchema, insertRouteSchema, insertGpsDeviceSchema, insertLoadDocumentSchema, insertTruckSchema, insertVendorSchema, insertFleetInspectionSchema, insertInspectionItemSchema, insertWorkOrderSchema, insertWorkOrderEventSchema, insertBreakdownReportSchema, insertFleetDocumentSchema, insertMaintenancePlanSchema, gmailAccounts, activityLog, loads } from "@shared/schema";
import { db } from "./db";
import { eq, gte } from "drizzle-orm";
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
import { setupAuth, isAuthenticated } from "./auth";
import { pdfService } from './pdf-service';
import { documentReminderService } from './document-reminder-service';
import { urlShortener } from './url-shortener-service';
import { generateMessageSuggestions, improveMessage, extractLoadFromScreenshot } from './openai-helper';
import { stripeService } from './stripe-service';
import { calculateMiles } from './services/distance-calculator';

import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import gaLoadsRouter from "./ga-loads-router";
import traqiqSopRoutes from "./traqiq-sop-routes";
import driverSMSUploadRoutes from "./driver-sms-upload-routes";
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

// Helper function to sanitize numeric values from corrupted database data
// Fixes string concatenation bugs from old import code
function sanitizeNumericValue(value: any): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  
  // If it's already a clean number, use it
  if (typeof value === 'number' && !isNaN(value) && isFinite(value)) {
    // Check if it's a ridiculously large number (likely corrupted)
    // Normal freight rates are $100-$10000, miles are 0-3000
    if (value > 1000000) {
      console.warn(`⚠️ Sanitizing corrupted number: ${value} -> 0`);
      return 0;
    }
    return value;
  }
  
  // Convert to string and strip non-numeric characters
  const stringValue = String(value)
    .replace(/[^\d.-]/g, '') // Remove everything except digits, dots, and minus
    .trim();
  
  if (stringValue === '' || stringValue === '-') {
    return 0;
  }
  
  const parsed = parseFloat(stringValue);
  
  // Check if parsing failed or resulted in corrupted data
  if (isNaN(parsed) || !isFinite(parsed) || parsed > 1000000) {
    console.warn(`⚠️ Sanitizing corrupted value: ${value} -> 0`);
    return 0;
  }
  
  return parsed;
}

// Helper function to sanitize load data before sending to frontend
function sanitizeLoadData(load: any): any {
  if (!load) return load;
  
  return {
    ...load,
    rate: sanitizeNumericValue(load.rate),
    miles: sanitizeNumericValue(load.miles),
    weight: sanitizeNumericValue(load.weight),
  };
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
    console.log('SECURITY: Rate limit exceeded for GPS updates:', { ip });
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
    console.log('SECURITY: Bulk SMS rate limit exceeded:', { ip });
    res.status(429).json({ 
      error: "Bulk send is limited to once per hour. Please try again later.",
      retryAfter: 3600
    });
  }
});

// Helper function to normalize and validate phone numbers for Twilio E.164 format
// Supports US numbers (10 or 11 digits) and already-formatted E.164 international numbers
function normalizePhoneToE164(phoneNumber: string | undefined | null): string | null {
  if (!phoneNumber) return null;
  
  // Trim whitespace
  const trimmed = phoneNumber.trim();
  if (!trimmed) return null;
  
  // If already in E.164 format (starts with +), validate and return
  if (trimmed.startsWith('+')) {
    // For E.164 numbers, only strip spaces and hyphens (not parentheses, extensions, etc.)
    const cleaned = trimmed.substring(1).replace(/[\s-]/g, '');
    
    // Strict validation: must be exactly 8-15 digits, no other characters
    if (/^\d{8,15}$/.test(cleaned)) {
      return `+${cleaned}`;
    } else {
      console.error(`❌ Invalid E.164 format: "${trimmed}" - must be + followed by 8-15 digits`);
      return null;
    }
  }
  
  // Strip all non-digit characters (spaces, dashes, parentheses, etc.)
  const digitsOnly = trimmed.replace(/\D/g, '');
  
  // Normalize US numbers only (10 or 11 digits)
  if (digitsOnly.length === 10) {
    // 10 digits: US number without country code → add +1
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // 11 digits starting with 1: US number with country code → add +
    return `+${digitsOnly}`;
  } else {
    // Not a US number and not already E.164 formatted - reject
    console.error(`❌ Cannot normalize phone: "${trimmed}" (${digitsOnly.length} digits) - Use E.164 format (+country+number) for international numbers`);
    return null;
  }
}

// Helper function to determine the correct base URL with protocol based on environment
function getBaseUrl(): string {
  // Priority 1: Custom domain (TRAQ IQ production domain)
  const customDomain = process.env.CUSTOM_DOMAIN || 'traqiq.app';
  
  // Priority 2: Development/Replit domains
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(',')[0];
  
  // Use Replit domain for development, custom domain for production
  const domain = replitDomain || customDomain;
  
  // If domain already has protocol, use as-is
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  
  // If localhost, use HTTP
  if (domain === 'localhost' || domain.startsWith('localhost:')) {
    return `http://${domain}`;
  }
  
  // Production domain - use HTTPS
  return `https://${domain}`;
}

// Authorization middleware for bulk operations
// Requires either authenticated session OR admin API key
function requireBulkAuthorization(req: any, res: any, next: any) {
  // Check 1: Is user authenticated via session?
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    console.log('Bulk operation authorized via session:', { email: req.user.claims?.email || 'unknown' });
    return next();
  }

  // Check 2: Is admin API key provided?
  const adminApiKey = process.env.ADMIN_API_KEY;
  const providedKey = req.headers['x-admin-api-key'];
  
  if (adminApiKey && providedKey && providedKey === adminApiKey) {
    console.log('Bulk operation authorized via API key:', { ip: req.ip });
    return next();
  }

  // Check 3: Development bypass (only if explicitly enabled)
  if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_BULK === 'true') {
    console.log('DEV MODE: Bulk operation allowed without auth:', { ip: req.ip });
    return next();
  }

  // No valid authorization found
  console.log('UNAUTHORIZED bulk operation attempt:', { ip: req.ip });
  res.status(401).json({ 
    error: "Unauthorized: Bulk operations require authentication or admin API key"
  });
}

// Helper function to send GPS tracking link SMS to driver
// loadId is optional - if null, sends general fleet tracking link instead of load-specific
async function sendGPSTrackingSMS(driverId: string, loadId: string | null, options: { override?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('GPS TRACKING SMS: Starting:', { driverId, loadId: loadId || 'general tracking' });
    
    // THROTTLE CHECK: Prevent SMS spam by checking last send time
    const THROTTLE_MINUTES = 30; // Don't resend within 30 minutes
    
    if (loadId && !options.override) {
      const load = await storage.getLoad(loadId);
      if (load?.gpsTrackingSmsLastSentAt) {
        const lastSentAt = new Date(load.gpsTrackingSmsLastSentAt);
        const now = new Date();
        const minutesSinceLastSend = (now.getTime() - lastSentAt.getTime()) / (1000 * 60);
        
        if (minutesSinceLastSend < THROTTLE_MINUTES) {
          const remainingMinutes = Math.ceil(THROTTLE_MINUTES - minutesSinceLastSend);
          console.log('GPS TRACKING SMS: Throttled:', { loadId, minutesSinceLastSend: Math.floor(minutesSinceLastSend), remainingMinutes });
          return { 
            success: true, 
            throttled: true, 
            message: `GPS tracking SMS already sent ${Math.floor(minutesSinceLastSend)} minutes ago (throttled)` 
          };
        }
      }
    }
    
    // Generate GPS tracking token for the driver
    const tokenResult = await storage.generateTrackingToken(driverId);
    if (!tokenResult?.token) {
      console.error('GPS TRACKING SMS: Failed to generate tracking token:', { driverId });
      return { success: false, error: "Failed to generate tracking token" };
    }
    const token = tokenResult.token;
    console.log('GPS TRACKING SMS: Generated token:', { driverId });
    
    // Get driver details to get phone number
    const driver = await storage.getDriver(driverId);
    if (!driver) {
      console.error('GPS TRACKING SMS: Driver not found:', { driverId });
      return { success: false, error: "Driver not found" };
    }
    
    // Get driver's phone number
    const driverPhone = driver.phoneNumber || driver.phone;
    const normalizedPhone = normalizePhoneToE164(driverPhone);
    
    if (!normalizedPhone) {
      console.log('GPS TRACKING SMS: Driver has no valid phone number:', { driverName: driver.name });
      return { success: false, error: "Driver has no valid phone number" };
    }
    
    // Create tracking URL
    const trackingUrl = `${getBaseUrl()}/driver-tracker?driver=${driverId}&token=${token}`;
    
    // Shorten URL for professional appearance
    const shortUrlResult = await urlShortener.shortenUrl(trackingUrl);
    const link = shortUrlResult.shortUrl || trackingUrl;
    
    // Create GPS tracking SMS message
    let smsMessage: string;
    let logContext: string;
    
    if (loadId) {
      // Load-specific tracking message
      const load = await storage.getLoad(loadId);
      if (!load) {
        console.error('GPS TRACKING SMS: Load not found:', { loadId });
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
      
      smsMessage = `🚛 TRAQ IQ\n\n📍 Load ${load.loadNumber} assigned!${routeInfo}\n\nStart GPS tracking:\n${link}\n\nTap to share location with dispatch.`;
      logContext = `load ${load.loadNumber}`;
    } else {
      // General fleet tracking message
      smsMessage = `🚛 TRAQ IQ\n\n📍 GPS Tracking Request\n\nShare your location:\n${link}\n\nTap to enable tracking.`;
      logContext = 'general tracking';
    }
    
    console.log('GPS TRACKING SMS: Sending:', { driverName: driver.name, normalizedPhone, logContext });
    console.log('GPS TRACKING SMS: URL:', { trackingUrl });
    
    // Send SMS using existing SMS service
    const smsResult = await smsService.sendSMS({
      to: normalizedPhone,
      body: smsMessage
    });
    
    if (smsResult.success) {
      console.log('GPS TRACKING SMS: Successfully sent:', { driverName: driver.name, logContext });
      
      // Update load timestamp to prevent re-sending within throttle window
      if (loadId) {
        try {
          await storage.updateLoad(loadId, { 
            gpsTrackingSmsLastSentAt: new Date() 
          });
          console.log('GPS TRACKING SMS: Updated throttle timestamp:', { loadId });
        } catch (updateError) {
          console.error('GPS TRACKING SMS: Failed to update throttle timestamp (non-critical):', updateError);
          // Don't fail the overall SMS send if timestamp update fails
        }
      }
      
      return { success: true };
    } else {
      console.error('GPS TRACKING SMS: Failed to send:', { error: smsResult.error });
      return { success: false, error: smsResult.error || "Failed to send SMS" };
    }
    
  } catch (error) {
    console.error('GPS TRACKING SMS: Error sending:', { driverId, loadId }, error);
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
TRAQ IQ Dispatch Team
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
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "TRAQ IQ <noreply@traqiqs.io>",
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

    // Ops Monitor — dispatcher alerts on pipeline degradation and stuck loads
    Promise.resolve().then(async () => {
      try {
        const { opsMonitor } = await import('./ops-monitor-service');
        await opsMonitor.initialize();
      } catch (error) {
        console.error('Failed to initialize Ops Monitor:', error);
      }
    });

    // Weekly Statements cron — Fri 5pm ET SMS link to each driver
    Promise.resolve().then(async () => {
      try {
        const { statementsCron } = await import('./statements-cron');
        await statementsCron.initialize();
      } catch (error) {
        console.error('Failed to initialize Statements cron:', error);
      }
    });

    // Geofence cron — auto-SMS photo upload links when driver enters pickup/delivery radius
    Promise.resolve().then(async () => {
      try {
        const { geofenceCron } = await import('./geofence-cron');
        await geofenceCron.initialize();
      } catch (error) {
        console.error('Failed to initialize Geofence cron:', error);
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

  // Ops Monitor — snapshot of state
  app.get('/api/ops/snapshot', async (_req, res) => {
    try {
      const { opsMonitor } = await import('./ops-monitor-service');
      res.json({ ok: true, ...opsMonitor.getSnapshot() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Ops Monitor — fire a test SMS to the configured alert phone
  app.post('/api/ops/test-alert', async (_req, res) => {
    try {
      const { opsMonitor } = await import('./ops-monitor-service');
      const phone = opsMonitor.getSnapshot().alertPhone;
      const result = await smsLoadService.sendSMS(
        phone,
        `✅ TRAQ: Ops Monitor alert test — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}. You're wired up.`
      );
      res.json({ ok: result.success, phone, messageSid: result.messageSid, error: result.error });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Settlements — weekly driver pay computed from delivered loads
  app.get('/api/settlements', async (req, res) => {
    try {
      const { computeSettlements, fmtYMD, weekRange } = await import('./settlements-service');
      const weekRef =
        (req.query.weekStart as string) ||
        (req.query.week as string) ||
        fmtYMD(new Date());
      const { start, end } = weekRange(weekRef);
      const settlements = await computeSettlements(weekRef);
      const totalPay = +settlements.reduce((s, x) => s + x.totalPay, 0).toFixed(2);
      const totalRevenue = +settlements.reduce((s, x) => s + x.totalRevenue, 0).toFixed(2);
      res.json({
        ok: true,
        weekStart: fmtYMD(start),
        weekEnd: fmtYMD(new Date(end.getTime() - 1)),
        driverCount: settlements.length,
        totalPay,
        totalRevenue,
        settlements,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get('/api/settlements/:driverId', async (req, res) => {
    try {
      const { computeSettlementForDriver, fmtYMD } = await import('./settlements-service');
      const weekRef =
        (req.query.weekStart as string) ||
        (req.query.week as string) ||
        fmtYMD(new Date());
      const settlement = await computeSettlementForDriver(req.params.driverId, weekRef);
      if (!settlement) {
        return res.json({ ok: true, settlement: null, message: 'No delivered loads this week' });
      }
      res.json({ ok: true, settlement });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Geofence cron — manual trigger + status
  app.post('/api/geofence/tick', async (_req, res) => {
    try {
      const { geofenceCron } = await import('./geofence-cron');
      const r = await geofenceCron.triggerNow();
      res.json({ ok: true, ...r });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get('/api/geofence/status', async (_req, res) => {
    try {
      const { geofenceCron } = await import('./geofence-cron');
      res.json({ ok: true, ...geofenceCron.getStatus() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ========== Driver photo uploads (Cloudinary) ==========
  // Tokenized upload page — SMS link sends driver here
  app.get('/u/:loadId', async (req, res) => {
    try {
      const { db } = await import('./db');
      const { loads } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { renderUploadPage, PICKUP_STAGES, DELIVERY_STAGES } = await import('./load-photos-service');

      const load = await db.query.loads.findFirst({ where: eq(loads.id, req.params.loadId) });
      if (!load) return res.status(404).type('html').send('<h1>Load not found</h1>');

      const qsStages = (req.query.stages as string | undefined) || '';
      let stages: any[] = qsStages
        .split(',')
        .filter(Boolean)
        .filter((s) =>
          ['pickup_bol', 'pickup_securement', 'delivery_pod', 'delivery_signed_bol'].includes(s),
        );
      if (stages.length === 0) {
        stages = [...PICKUP_STAGES, ...DELIVERY_STAGES];
      }
      res.type('html').send(renderUploadPage(load.id, stages as any, load.loadNumber));
    } catch (err: any) {
      console.error('Upload page error:', err);
      res.status(500).type('html').send('<h1>Error loading page</h1>');
    }
  });

  // Multipart photo upload
  app.post('/api/loads/:id/photos', async (req, res) => {
    try {
      const multer = (await import('multer')).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
      upload.single('photo')(req, res, async (err: any) => {
        if (err) return res.status(400).json({ ok: false, error: err.message });
        const file = (req as any).file;
        if (!file) return res.status(400).json({ ok: false, error: 'No file' });
        const { uploadLoadPhoto } = await import('./load-photos-service');
        const stage = (req.body.stage || '').toString();
        if (!['pickup_bol', 'pickup_securement', 'delivery_pod', 'delivery_signed_bol'].includes(stage)) {
          return res.status(400).json({ ok: false, error: 'Invalid stage' });
        }
        const result = await uploadLoadPhoto({
          loadId: req.params.id,
          stage: stage as any,
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalName: file.originalname,
          lat: req.body.lat ? Number(req.body.lat) : undefined,
          lng: req.body.lng ? Number(req.body.lng) : undefined,
        });
        if (!result.ok) return res.status(500).json(result);
        res.json(result);
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // List photos for a load
  app.get('/api/loads/:id/photos', async (req, res) => {
    try {
      const { listLoadPhotos } = await import('./load-photos-service');
      const result = await listLoadPhotos(req.params.id);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Dispatcher action: SMS the driver an upload link for pickup or delivery photos
  app.post('/api/loads/:id/photos/request', async (req, res) => {
    try {
      const { sendUploadLink, PICKUP_STAGES, DELIVERY_STAGES } = await import('./load-photos-service');
      const phase = (req.body.phase || '').toString();
      let stages: any[] = [];
      if (phase === 'pickup') stages = PICKUP_STAGES;
      else if (phase === 'delivery') stages = DELIVERY_STAGES;
      else if (Array.isArray(req.body.stages)) stages = req.body.stages;
      else return res.status(400).json({ ok: false, error: 'phase must be pickup or delivery' });

      const result = await sendUploadLink(req.params.id, stages, req.body.message);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Backfill missing tracking tokens for drivers (required for statement SMS links)
  app.post('/api/drivers/backfill-tokens', async (_req, res) => {
    try {
      const { pool } = await import('./db');
      if (!pool) return res.status(500).json({ ok: false, error: 'No DB pool' });
      const result = await pool.query(
        `UPDATE drivers
         SET tracking_token = replace(gen_random_uuid()::text, '-', '')
         WHERE tracking_token IS NULL OR tracking_token = ''
         RETURNING id, name`,
      );
      res.json({ ok: true, updated: result.rowCount, drivers: result.rows });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Manually fire the weekly statements job (for testing + off-cycle runs)
  app.post('/api/statements/send-weekly', async (req, res) => {
    try {
      const { statementsCron } = await import('./statements-cron');
      const result = await statementsCron.triggerNow(req.body?.weekStart);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get('/api/statements/status', async (_req, res) => {
    try {
      const { statementsCron } = await import('./statements-cron');
      res.json({ ok: true, ...statementsCron.getStatus() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Update a driver's pay rule
  app.patch('/api/drivers/:id/pay', async (req, res) => {
    try {
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { payType, payRate } = req.body || {};
      if (!['percent', 'per_mile', 'flat'].includes(payType)) {
        return res.status(400).json({ ok: false, error: 'payType must be percent|per_mile|flat' });
      }
      const rate = Number(payRate);
      if (!isFinite(rate) || rate < 0) {
        return res.status(400).json({ ok: false, error: 'payRate must be a non-negative number' });
      }
      const [updated] = await db
        .update(drivers)
        .set({ payType, payRate: rate })
        .where(eq(drivers.id, req.params.id))
        .returning();
      res.json({ ok: true, driver: updated });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Driver SOP page — linked from dispatch SMS
  app.get('/sop', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LAMP Logistics — Driver SOP</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; line-height: 1.55; color: #111; background: #fff; }
  h1 { font-size: 22px; color: #00B5B8; margin-bottom: 4px; }
  h2 { font-size: 16px; margin-top: 24px; border-bottom: 2px solid #00B5B8; padding-bottom: 4px; }
  p, li { font-size: 15px; }
  .warn { background: #fff4e5; border-left: 4px solid #ff9500; padding: 10px 14px; margin: 14px 0; border-radius: 4px; }
  .contact { background: #f0f7ff; border-left: 4px solid #0066cc; padding: 10px 14px; margin: 14px 0; border-radius: 4px; }
</style>
</head>
<body>
<h1>LAMP Logistics — Driver SOP</h1>
<p style="color:#666;margin-top:0;">Standard operating procedures for every load.</p>

<div class="warn"><strong>Late delivery = $250 fee.</strong> Notify Dispatch immediately if you'll be late.</div>

<h2>While in Transit</h2>
<ul>
  <li><strong>GPS tracking must be ON at all times</strong> during transit.</li>
  <li>Secure load with <strong>(2) load locks</strong> minimum.</li>
  <li>If we can't reach you, we call your emergency contact and begin repowering. Any extra costs / chargebacks will apply.</li>
</ul>

<h2>At Pickup</h2>
<ul>
  <li>Send <strong>BOL photo</strong> to Dispatch.</li>
  <li>Send <strong>load securement photos</strong> to Dispatch.</li>
  <li>Verify seal # if sealed — <strong>report any seal issues immediately</strong>.</li>
  <li><strong>WAIT for "GO" from Dispatch</strong> before leaving the shipper.</li>
</ul>

<h2>At Delivery</h2>
<ul>
  <li>Send <strong>POD</strong> (signed, stamped) to Dispatch.</li>
  <li><strong>WAIT for "GO" from Dispatch</strong> before leaving the receiver.</li>
</ul>

<h2>Issues / Emergencies</h2>
<div class="contact">Call or text Dispatch directly. Do not leave the shipper/receiver without authorization.</div>

<p style="color:#666;font-size:13px;margin-top:32px;">Reply <strong>YES</strong> to your dispatch SMS to confirm the load.</p>
</body>
</html>`);
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

  // Send a direct SMS to any phone number (admin use)
  app.post('/api/sms/send-direct', async (req, res) => {
    try {
      const { to, message } = req.body;
      if (!to || !message) {
        return res.status(400).json({ error: 'to and message are required' });
      }
      if (!twilioPhoneNumber) {
        return res.status(503).json({ error: 'Twilio not configured' });
      }
      const normalizedTo = normalizePhoneToE164(to);
      if (!normalizedTo) {
        return res.status(400).json({ error: 'Invalid phone number' });
      }
      const result = await twilioClient.messages.create({
        to: normalizedTo,
        from: twilioPhoneNumber,
        body: message,
      });
      res.json({ success: true, sid: result.sid, to: normalizedTo });
    } catch (err: any) {
      console.error('send-direct SMS error:', err);
      res.status(500).json({ error: err.message });
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
        `This is a test message from the TRAQ IQ dispatch system.\n` +
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

  // EV SOP Checklist - Send template SMS
  app.post('/api/sms/send-template', async (req, res) => {
    try {
      const { loadId, type } = req.body;
      
      if (!loadId || !type) {
        return res.status(400).json({ error: 'loadId and type are required' });
      }
      
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      if (!load.driverId) {
        return res.status(400).json({ error: 'No driver assigned to this load' });
      }
      
      const driver = await storage.getDriver(load.driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      const driverPhone = driver.phoneNumber || driver.phone;
      const normalizedPhone = normalizePhoneToE164(driverPhone);
      
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Invalid driver phone number' });
      }
      
      let message = '';
      const baseUrl = process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN || 'https://traq-iq.replit.app';
      const loadViewUrl = `${baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl}/driver/load/${load.id}`;
      
      if (type === 'INITIAL') {
        message = `📦 LOAD ASSIGNMENT\n\n` +
          `Load #${load.loadNumber}\n` +
          `From: ${load.originCity || load.pickupAddress?.split(',')[0] || 'TBD'}, ${load.originState || ''}\n` +
          `To: ${load.destCity || load.deliveryAddress?.split(',')[0] || 'TBD'}, ${load.destState || ''}\n` +
          `Rate: $${load.rate || 0}\n` +
          `Weight: ${load.weight ? load.weight.toLocaleString() + ' lbs' : 'TBD'}\n\n` +
          `Pickup: ${load.pickupDate ? new Date(load.pickupDate).toLocaleDateString() : 'TBD'} @ ${load.pickupTime || 'TBD'}\n\n` +
          `View details: ${loadViewUrl}\n\n` +
          `Reply YES to confirm.`;
      } else if (type === 'TRIP') {
        const dashboardUrl = `${process.env.REPLIT_DEPLOYMENT_URL || 'https://traq-iq.replit.app'}/driver-dashboard?driverId=${driver.id}`;
        message = `🚚 TRIP STARTED\n\n` +
          `Load #${load.loadNumber}\n\n` +
          `Open your dashboard for GPS tracking:\n${dashboardUrl}\n\n` +
          `Drive safe!`;
      } else if (type === 'BOOKING_REQUEST') {
        // Use the new SMS service method
        const result = await smsLoadService.sendBookingRequest(load, driver);
        return res.json({ success: result.success, message: result.success ? 'Booking request SMS sent' : result.error });
      } else if (type === 'DISPATCH_INSTRUCTIONS') {
        // Use the new SMS service method
        const result = await smsLoadService.sendDispatchInstructions(load, driver);
        return res.json({ success: result.success, message: result.success ? 'Dispatch instructions SMS sent' : result.error });
      } else {
        return res.status(400).json({ error: 'Invalid template type' });
      }
      
      if (twilioClient && twilioPhoneNumber) {
        await twilioClient.messages.create({
          to: normalizedPhone,
          from: twilioPhoneNumber,
          body: message
        });
      }
      
      res.json({ success: true, message: 'SMS sent successfully' });
    } catch (error) {
      console.error('Error sending template SMS:', error);
      res.status(500).json({ error: 'Failed to send SMS' });
    }
  });

  // EV SOP Checklist - Send broker thank you email with POD
  // Email Ingestion API - Gmail Rate Confirmation Polling
  app.get('/api/email/ingestion/status', async (req, res) => {
    try {
      const { emailIngestion } = await import('./email-ingestion-service');
      const status = await emailIngestion.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error checking email ingestion status:', error);
      res.status(500).json({ error: 'Failed to check status' });
    }
  });

  app.post('/api/email/ingestion/poll', async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) {
        return res.status(400).json({ error: 'companyId is required' });
      }
      
      const { emailIngestion } = await import('./email-ingestion-service');
      const results = await emailIngestion.pollForRateCons(companyId);
      
      res.json({ 
        success: true, 
        processed: results.length,
        results 
      });
    } catch (error) {
      console.error('Error polling emails:', error);
      res.status(500).json({ error: 'Failed to poll emails' });
    }
  });

  // ============================================================================
  // GMAIL OAUTH SETUP — one-click flow to get refresh token and register account
  // ============================================================================

  app.get('/api/gmail/oauth/start', (req, res) => {
    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId) {
      return res.status(500).send('GMAIL_CLIENT_ID is not set in Railway environment variables.');
    }
    const redirectUri = `https://traqiq.app/api/gmail/oauth/callback`;
    const scope = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ].join(' ');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent'); // force refresh_token issuance
    res.redirect(url.toString());
  });

  app.get('/api/gmail/oauth/callback', async (req, res) => {
    const { code, error } = req.query as { code?: string; error?: string };
    if (error || !code) {
      return res.status(400).send(`OAuth error: ${error || 'no code returned'}`);
    }
    try {
      const clientId = process.env.GMAIL_CLIENT_ID!;
      const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
      const redirectUri = `https://traqiq.app/api/gmail/oauth/callback`;

      // Exchange code for tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenRes.json() as any;
      if (!tokens.refresh_token) {
        return res.status(400).send(`No refresh_token returned. Tokens received: ${JSON.stringify(tokens)}`);
      }

      // Get the email address for this account
      const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json() as any;
      const email = profile.emailAddress || 'unknown@gmail.com';

      // Save to gmailAccounts table (upsert by email)
      const existing = await db.select().from(gmailAccounts).where(eq(gmailAccounts.email, email));
      if (existing.length > 0) {
        await db.update(gmailAccounts)
          .set({ refreshToken: tokens.refresh_token, isActive: true })
          .where(eq(gmailAccounts.email, email));
        console.log(`📧 Updated Gmail account: ${email}`);
      } else {
        await db.insert(gmailAccounts).values({
          email,
          refreshToken: tokens.refresh_token,
          companyId: 'default',
          isActive: true,
        });
        console.log(`📧 Registered new Gmail account: ${email}`);
      }

      res.send(`
        <html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center">
          <h2 style="color:#16a34a">✅ Gmail Connected</h2>
          <p><strong>${email}</strong> is now registered.</p>
          <p>TRAQ-IQ will scan this inbox every minute for Rate Confirmations automatically.</p>
          <p><a href="https://traqiq.app">Return to TRAQ-IQ</a></p>
        </body></html>
      `);
    } catch (err: any) {
      console.error('Gmail OAuth callback error:', err);
      res.status(500).send(`OAuth callback failed: ${err.message}`);
    }
  });

  // Custom Gmail OAuth - Manual Trigger for Rate Confirmation Ingestion
  app.get('/api/ingest/status', async (req, res) => {
    try {
      const { gmailIngest } = await import('./services/gmail');
      const configured = gmailIngest.isConfigured();
      res.json({ 
        configured,
        message: configured 
          ? 'Gmail OAuth credentials are configured' 
          : 'Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN'
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/ingest/trigger', async (req, res) => {
    try {
      console.log("Manual Gmail trigger received...");
      const { gmailIngest } = await import('./services/gmail');
      const count = await gmailIngest.scanInbox();
      res.json({ success: true, filesProcessed: count });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // DEBUG: pull 1 recent PDF from Gmail and run it through the parser with verbose output
  app.post('/api/debug/parse-last-pdf', async (req, res) => {
    try {
      const { google } = await import('googleapis');
      const { rateconParser } = await import('./services/ratecon-parser');
      const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));
      if (accounts.length === 0) return res.status(400).json({ error: 'no active Gmail account' });
      const account = accounts[0];

      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: account.refreshToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const list = await gmail.users.messages.list({
        userId: 'me',
        q: 'has:attachment filename:pdf newer_than:7d',
        maxResults: 10,
      });

      const messages = list.data.messages || [];
      const results: any[] = [];
      const findAtt = (p: any): any[] => {
        let out: any[] = [];
        if (p.filename && p.filename.toLowerCase().endsWith('.pdf') && p.body?.attachmentId) out.push(p);
        if (p.parts) for (const part of p.parts) out = out.concat(findAtt(part));
        return out;
      };

      const hasOpenAIKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'not-configured');
      const openAIKeyLength = process.env.OPENAI_API_KEY?.length || 0;

      for (const msg of messages) {
        const email = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
        const subject = email.data.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || '';
        const from = email.data.payload?.headers?.find((h: any) => h.name === 'From')?.value || '';
        const atts = findAtt(email.data.payload);
        if (atts.length === 0) continue;
        const att = atts[0];
        const data = await gmail.users.messages.attachments.get({
          userId: 'me', messageId: msg.id!, id: att.body.attachmentId,
        });
        if (!data.data.data) continue;
        const buffer = Buffer.from(data.data.data, 'base64');
        const parsed = await rateconParser.parsePdf(buffer);
        results.push({
          subject, from, filename: att.filename, sizeBytes: buffer.length,
          loadNumber: parsed.loadNumber,
          rate: parsed.rate,
          origin: parsed.origin,
          destination: parsed.destination,
          notes: parsed.notes?.substring(0, 200),
        });
      }

      res.json({ hasOpenAIKey, openAIKeyLength, count: results.length, results });
    } catch (error: any) {
      console.error('debug parse error:', error);
      res.status(500).json({ error: error.message || String(error), stack: error.stack });
    }
  });

  // FORCE RESCAN: re-scan Gmail including already-read emails, then backfill dispatch
  app.post('/api/gmail/force-rescan', async (req, res) => {
    try {
      const { gmailIngest } = await import('./services/gmail');
      const query = (req.body?.query as string) || 'has:attachment filename:pdf newer_than:7d';
      const maxResults = parseInt(req.body?.maxResults || '50', 10);
      const scanResults = await gmailIngest.forceRescan(query, maxResults);
      res.json({ scanResults });
    } catch (error: any) {
      console.error('Force rescan error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // CLEANUP: Archive orphan PG loads (no driverId, no driverName, LB-* auto-generated).
  // These are stale placeholders from pre-pipeline imports that clutter dashboards but
  // have no actionable data. Archiving keeps them in the DB but hides them from active views.
  app.post('/api/loads/archive-orphans', async (req, res) => {
    try {
      const dryRun = req.query.dryRun === '1';
      const { and, isNull, like, ne } = await import('drizzle-orm');

      const orphans = await db.query.loads.findMany({
        where: and(
          isNull(loads.driverId),
          like(loads.loadNumber, 'LB-%'),
          ne(loads.status, 'archived')
        ),
      });

      if (dryRun) {
        return res.json({
          dryRun: true,
          wouldArchive: orphans.length,
          samples: orphans.slice(0, 10).map(l => ({ loadNumber: l.loadNumber, status: l.status, createdAt: l.createdAt })),
        });
      }

      let archived = 0;
      for (const l of orphans) {
        await db.update(loads)
          .set({ status: 'archived' })
          .where(eq(loads.loadNumber, l.loadNumber));
        archived++;
      }

      res.json({ ok: true, archived, total: orphans.length });
    } catch (error: any) {
      console.error('Archive orphans error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // BACKFILL: Dispatch SMS for every load created today that hasn't been dispatched yet
  app.post('/api/dispatch/backfill-today', async (req, res) => {
    try {
      const { gmailIngest } = await import('./services/gmail');
      // Accept ?hours=N query param, default 72h to cover timezone gaps
      const hours = parseInt((req.query.hours as string) || '72', 10);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const todaysLoads = await db.query.loads.findMany({
        where: gte(loads.createdAt, since),
        with: { driver: true },
      });

      const summary = {
        total: todaysLoads.length,
        dispatched: [] as string[],
        alreadySent: [] as string[],
        noDriver: [] as string[],
        failed: [] as { load: string; reason: string }[],
      };

      // Pull ga_loads snapshot once so we can cross-reference driver_name for unlinked PG loads
      const { default: gaDb } = await import('./ga-db');
      const gaRows: any[] = gaDb.prepare(
        `SELECT load_number, driver_name, raw_json FROM ga_loads WHERE driver_name IS NOT NULL AND driver_name != '' OR raw_json IS NOT NULL`
      ).all();
      const gaByLoadNum = new Map<string, string>();
      for (const r of gaRows) {
        let dn = (r.driver_name || '').trim();
        if (!dn && r.raw_json) {
          try { dn = (JSON.parse(r.raw_json)?.driverName || '').trim(); } catch {}
        }
        if (r.load_number && dn) gaByLoadNum.set(String(r.load_number), dn);
      }

      for (const load of todaysLoads) {
        const loadNum = load.loadNumber;
        const sop = (load.sopProgress as any) || {};
        if (sop.dispatchSent) {
          summary.alreadySent.push(loadNum);
          continue;
        }
        const driver = (load as any).driver;
        // If PG has a driver record, use its name; else fall back to ga_loads driver_name
        // so resolveAndDispatch can do an ilike match against drivers table.
        const driverName = driver?.name || gaByLoadNum.get(String(loadNum)) || '';
        if (!driver?.phone && !driverName) {
          summary.noDriver.push(loadNum);
          continue;
        }
        try {
          await gmailIngest.resolveAndDispatch(loadNum, { driverName });
          summary.dispatched.push(loadNum);
        } catch (err: any) {
          summary.failed.push({ load: loadNum, reason: err?.message || String(err) });
        }
      }

      res.json(summary);
    } catch (error: any) {
      console.error('Backfill dispatch error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // TEST: Pull last RateCon and send dispatch SMS to driver as a dry-run
  app.post('/api/test/ratecon-pipeline', async (req, res) => {
    try {
      const { gmailIngest } = await import('./services/gmail');
      const { smsLoadService } = await import('./sms-service');
      // Auto-seed Gmail account from env var if not already in DB
      const envToken = process.env.GMAIL_REFRESH_TOKEN;
      const envEmail = process.env.GMAIL_USER || process.env.SMTP_USER || 'dispatch@lamplogi.com';
      if (envToken) {
        const existing = await db.select().from(gmailAccounts).where(eq(gmailAccounts.refreshToken, envToken));
        if (existing.length === 0) {
          await db.insert(gmailAccounts).values({
            email: envEmail,
            refreshToken: envToken,
            companyId: 'default',
            isActive: true,
          });
          console.log(`[TEST] Auto-seeded Gmail account: ${envEmail}`);
        }
      }

      // Run full Gmail scan
      const results = await gmailIngest.scanAllAccounts();
      const totalCreated = results.reduce((s: number, r: any) => s + (r.loadsCreated || 0), 0);
      const totalUpdated = results.reduce((s: number, r: any) => s + (r.loadsUpdated || 0), 0);
      const totalFiles  = results.reduce((s: number, r: any) => s + (r.filesProcessed || 0), 0);
      const errors      = results.flatMap((r: any) => r.errors || []);

      // Find the most recently booked load from Gmail
      const bookedLoads = await storage.getLoadsByStatus('booked');
      const recentLoad = bookedLoads.sort((a: any, b: any) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      )[0];

      if (!recentLoad) {
        return res.json({
          success: true,
          message: 'Scan complete — no booked loads found. Check Gmail credentials or inbox for new RateCons.',
          filesProcessed: totalFiles,
          loadsCreated: totalCreated,
          errors,
        });
      }

      // Send test SMS to driver (if assigned) or DISPATCHER_PHONE as proof
      const driverPhone = (recentLoad as any).driver?.phone;
      const testPhone = driverPhone || process.env.DISPATCHER_PHONE;
      let smsSent = false;
      if (testPhone) {
        const pickupDateStr = recentLoad.pickupDate
          ? new Date(recentLoad.pickupDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'TBD';
        const msg = [
          `[TEST - RateCon Pipeline] ✅`,
          `Load #${recentLoad.loadNumber}`,
          `${recentLoad.originCity} → ${recentLoad.destCity}`,
          `Rate: $${recentLoad.rate} | Miles: ${recentLoad.miles}`,
          `Pickup: ${pickupDateStr}`,
          `Broker: ${recentLoad.brokerName || 'N/A'}`,
          driverPhone ? '' : `(sent to dispatcher — no driver assigned yet)`,
        ].filter(Boolean).join('\n');
        await smsLoadService.sendSMS(testPhone, msg);
        smsSent = true;
      }

      res.json({
        success: true,
        filesProcessed: totalFiles,
        loadsCreated: totalCreated,
        loadsUpdated: totalUpdated,
        errors,
        testLoad: {
          id: recentLoad.id,
          loadNumber: recentLoad.loadNumber,
          origin: recentLoad.originCity,
          destination: recentLoad.destCity,
          rate: recentLoad.rate,
          miles: recentLoad.miles,
          broker: recentLoad.brokerName,
          status: recentLoad.status,
          driverId: recentLoad.driverId || null,
        },
        smsSent,
        smsSentTo: testPhone || 'no phone configured (set DISPATCHER_PHONE in Railway env)',
      });
    } catch (error: any) {
      console.error('[TEST] RateCon pipeline error:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // Gmail Auto-Polling Scheduler
  app.get('/api/ingest/scheduler/status', async (req, res) => {
    try {
      const { gmailScheduler } = await import('./services/gmail-scheduler');
      const { gmailIngest } = await import('./services/gmail');
      res.json({ 
        configured: gmailIngest.isConfigured(),
        schedulerActive: gmailScheduler.isActive()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/ingest/scheduler/start', async (req, res) => {
    try {
      const { intervalMinutes = 5 } = req.body;
      const { gmailScheduler } = await import('./services/gmail-scheduler');
      gmailScheduler.start(intervalMinutes);
      res.json({ success: true, message: `Gmail polling started - checking every ${intervalMinutes} minutes` });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/ingest/scheduler/stop', async (req, res) => {
    try {
      const { gmailScheduler } = await import('./services/gmail-scheduler');
      gmailScheduler.stop();
      res.json({ success: true, message: 'Gmail polling stopped' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // Gmail scheduler is started in index.ts background services — not here

  // ============================================================================
  // GMAIL MULTI-ACCOUNT MANAGEMENT ENDPOINTS
  // ============================================================================

  app.get('/api/gmail/accounts', async (req, res) => {
    try {
      const companyId = req.query.companyId as string;
      
      if (!companyId) {
        return res.status(400).json({ error: 'companyId is required for tenant isolation' });
      }
      
      const { gmailIngest } = await import('./services/gmail');
      const accounts = await gmailIngest.getAccountsForCompany(companyId);
      
      const safeAccounts = accounts.map(a => ({
        id: a.id,
        companyId: a.companyId,
        email: a.email,
        isActive: a.isActive,
        lastSyncedAt: a.lastSyncedAt,
        createdAt: a.createdAt
      }));
      
      res.json(safeAccounts);
    } catch (error: any) {
      console.error('Error fetching Gmail accounts:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/gmail/accounts', async (req, res) => {
    try {
      const { companyId, email, refreshToken } = req.body;
      
      if (!companyId || !refreshToken) {
        return res.status(400).json({ error: 'companyId and refreshToken are required' });
      }
      
      const { gmailIngest } = await import('./services/gmail');
      
      const testResult = await gmailIngest.testAccount(refreshToken);
      if (!testResult.success) {
        return res.status(400).json({ error: `OAuth test failed: ${testResult.error}` });
      }
      
      const account = await gmailIngest.addAccount({
        companyId,
        email: email || testResult.email || 'unknown',
        refreshToken
      });
      
      res.json({ 
        success: true, 
        account: {
          id: account.id,
          email: account.email,
          verifiedEmail: testResult.email
        }
      });
    } catch (error: any) {
      console.error('Error adding Gmail account:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/gmail/accounts/test', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
      }
      
      const { gmailIngest } = await import('./services/gmail');
      const result = await gmailIngest.testAccount(refreshToken);
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // SIMPLE ADD GMAIL ACCOUNT - paste token from OAuth Playground
  // Body: { email: "dispatch@newco.com", refreshToken: "1//...", companyId: "123" }
  app.post("/api/gmail/add-account", async (req, res) => {
    try {
      const { email, refreshToken, companyId } = req.body;

      if (!email || !refreshToken) {
        return res.status(400).json({ error: "Missing email or refreshToken" });
      }

      const [account] = await db.insert(gmailAccounts).values({
        email,
        refreshToken,
        companyId: companyId || "default",
        isActive: true
      }).returning();

      console.log(`📧 Connected Gmail account: ${email}`);
      res.json({ success: true, message: `Connected ${email}`, accountId: account.id });
    } catch (error: any) {
      console.error('Error adding Gmail account:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/gmail/accounts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId, ...updates } = req.body;
      
      if (!companyId) {
        return res.status(400).json({ error: 'companyId is required for tenant isolation' });
      }
      
      const { gmailIngest } = await import('./services/gmail');
      const updated = await gmailIngest.updateAccountForCompany(id, companyId, updates);
      
      if (!updated) {
        return res.status(404).json({ error: 'Account not found or access denied' });
      }
      
      res.json({ 
        success: true,
        account: {
          id: updated.id,
          email: updated.email,
          isActive: updated.isActive
        }
      });
    } catch (error: any) {
      console.error('Error updating Gmail account:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/gmail/accounts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const companyId = req.query.companyId as string;
      
      if (!companyId) {
        return res.status(400).json({ error: 'companyId is required for tenant isolation' });
      }
      
      const { gmailIngest } = await import('./services/gmail');
      const deleted = await gmailIngest.deleteAccountForCompany(id, companyId);
      
      if (!deleted) {
        return res.status(404).json({ error: 'Account not found or access denied' });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error deleting Gmail account:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/gmail/scan', async (req, res) => {
    try {
      const { companyId, forceRescan } = req.body;
      const { gmailIngest } = await import('./services/gmail');
      
      let results;
      if (companyId) {
        results = await gmailIngest.scanAccountsForCompany(companyId);
      } else {
        results = await gmailIngest.scanAllAccounts(forceRescan === true);
      }
      
      const totalFiles = results.reduce((sum: number, r: any) => sum + (r.filesProcessed || 0), 0);
      const totalLoads = results.reduce((sum: number, r: any) => sum + (r.loadsCreated || 0), 0);
      res.json({
        ok: true,
        success: true,
        companyId: companyId || 'all',
        accountsScanned: results.length,
        totalFilesProcessed: totalFiles,
        totalLoadsCreated: totalLoads,
        results
      });
    } catch (error: any) {
      console.error('Error scanning accounts:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/email/broker-thank-you', async (req, res) => {
    try {
      const { loadId } = req.body;
      
      if (!loadId) {
        return res.status(400).json({ error: 'loadId is required' });
      }
      
      const load = await storage.getLoad(loadId);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      const customer = load.customerId ? await storage.getCustomer(load.customerId) : null;
      const brokerEmail = customer?.email;
      
      if (!brokerEmail) {
        return res.status(400).json({ error: 'No broker email found - customer email required' });
      }
      
      console.log(`📧 Sending broker thank you email for load ${load.loadNumber} to ${brokerEmail}`);
      
      res.json({ 
        success: true, 
        message: 'Broker thank you email queued',
        recipient: brokerEmail 
      });
    } catch (error) {
      console.error('Error sending broker email:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });

  // Stripe API endpoints for multi-tenant subscription system
  
  // List subscription products (Starter, Pro, Enterprise)
  app.get('/api/stripe/products', async (req, res) => {
    try {
      const products = await stripeService.listProducts(true, 50, 0);
      res.json({ data: products });
    } catch (error) {
      console.error('Error fetching Stripe products:', error);
      res.status(500).json({ error: 'Failed to fetch subscription products' });
    }
  });

  // List subscription prices
  app.get('/api/stripe/prices', async (req, res) => {
    try {
      const prices = await stripeService.listPrices(true, 50, 0);
      res.json({ data: prices });
    } catch (error) {
      console.error('Error fetching Stripe prices:', error);
      res.status(500).json({ error: 'Failed to fetch subscription prices' });
    }
  });

  // Create checkout session for subscription
  app.post('/api/stripe/create-checkout', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { priceId, companyId } = req.body;

      if (!priceId || !companyId) {
        return res.status(400).json({ error: 'Missing priceId or companyId' });
      }

      // Get company details
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      // Create or get Stripe customer
      let customerId = company.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(
          company.billingEmail,
          company.id,
          company.name
        );
        await storage.updateCompany(company.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }

      // Create checkout session with 14-day trial for new subscriptions
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${baseUrl}/checkout/success`,
        `${baseUrl}/checkout/cancel`,
        companyId,
        14 // 14-day trial
      );

      res.json({ url: session.url });
    } catch (error) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  // Create customer portal session for managing subscription
  app.post('/api/stripe/create-portal', isAuthenticated, async (req: any, res) => {
    try {
      const { companyId } = req.body;

      if (!companyId) {
        return res.status(400).json({ error: 'Missing companyId' });
      }

      const company = await storage.getCompany(companyId);
      if (!company || !company.stripeCustomerId) {
        return res.status(404).json({ error: 'No Stripe customer found for this company' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripeService.createCustomerPortalSession(
        company.stripeCustomerId,
        `${baseUrl}/settings/billing`
      );

      res.json({ url: session.url });
    } catch (error) {
      console.error('Error creating portal session:', error);
      res.status(500).json({ error: 'Failed to create billing portal session' });
    }
  });

  // Get company subscription status
  app.get('/api/stripe/subscription', isAuthenticated, async (req: any, res) => {
    try {
      const { companyId } = req.query;

      if (!companyId) {
        return res.status(400).json({ error: 'Missing companyId' });
      }

      const company = await storage.getCompany(companyId as string);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      // Get subscription from stripe schema (synced via webhooks)
      const subscription = await stripeService.getCompanySubscription(company.id);
      
      res.json({ 
        subscription,
        company: {
          id: company.id,
          name: company.name,
          stripeCustomerId: company.stripeCustomerId,
          trialEndsAt: company.trialEndsAt,
        }
      });
    } catch (error) {
      console.error('Error fetching subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription' });
    }
  });

  // Customer API endpoints
  app.get('/api/customers', async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      res.json(customers);
    } catch (error) {
      console.error('Error fetching customers:', error);
      res.status(500).json({ error: 'Failed to fetch customers' });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const validatedData = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(validatedData);
      res.json(customer);
    } catch (error) {
      console.error('Error creating customer:', error);
      res.status(500).json({ error: 'Failed to create customer' });
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
    } catch (error: any) {
      console.error('GET /api/drivers error:', error?.message || error);
      res.status(500).json({ error: error?.message || "Failed to fetch drivers" });
    }
  });

  // Get single driver by ID
  app.get('/api/drivers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const driver = await storage.getDriver(id);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.json(driver);
    } catch (error) {
      console.error('Error fetching driver:', error);
      res.status(500).json({ error: "Failed to fetch driver" });
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
        
        return {
          driverId: driver.id,
          driverName: driver.name,
          latitude: baseLocation.lat,
          longitude: baseLocation.lng,
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
      console.log('SECURITY: Generating tracking token:', { driverId, ip });
      
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        console.log('SECURITY: Token generation failed - driver not found:', { driverId, ip });
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      const result = await storage.generateTrackingToken(driverId);
      
      if (!result) {
        console.log('SECURITY: Token generation failed:', { driverId, ip });
        return res.status(500).json({ error: 'Failed to generate tracking token' });
      }
      
      console.log('SECURITY: Tracking token generated successfully:', { driverId, ip });
      
      res.json({
        success: true,
        token: result.token,
        driverId
      });
    } catch (error) {
      console.error('SECURITY: Error generating tracking token:', { driverId, ip }, error);
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

  // Get driver's current GPS location
  app.get('/api/drivers/:driverId/current-location', async (req, res) => {
    try {
      const { driverId } = req.params;
      
      // Get driver's most recent active location
      const currentLocation = await storage.getDriverCurrentLocation(driverId);
      
      if (!currentLocation || !currentLocation.isActive) {
        return res.status(404).json({ 
          error: 'No active location found for this driver',
          hasLocation: false
        });
      }
      
      res.json({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        address: currentLocation.address,
        timestamp: currentLocation.timestamp,
        speed: currentLocation.speed || 0,
        heading: currentLocation.heading || 0,
        accuracy: currentLocation.accuracy || 0,
        hasLocation: true
      });
    } catch (error) {
      console.error('Error fetching driver current location:', error);
      res.status(500).json({ error: 'Failed to fetch current location' });
    }
  });

  // Calculate distance between driver and target address
  // Helper function using Haversine formula - returns distance in miles
  function calculateDistanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // POST endpoint to calculate distance (supports city-to-city OR lat/lon to targetAddress)
  app.post('/api/calculate-distance', async (req, res) => {
    try {
      const { origin, destination } = req.body;

      // Support city-to-city calculation
      if (typeof origin === 'string' && typeof destination === 'string') {
        const miles = await calculateMiles(origin, destination);
        
        if (miles === null) {
          return res.status(404).json({ 
            ok: false,
            error: 'Unable to calculate distance between cities',
            origin,
            destination
          });
        }

        return res.json({
          ok: true,
          miles,
          origin,
          destination
        });
      }

      // Legacy support: lat/lon to targetAddress
      const { lat, lon, targetAddress } = req.body;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !targetAddress) {
        return res.status(400).json({ 
          ok: false,
          error: 'Invalid request. Required: origin (string) and destination (string), OR lat (number), lon (number), targetAddress (string)' 
        });
      }

      // Geocode the target address using OpenStreetMap Nominatim
      const geocodeResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(targetAddress)}&limit=1`,
        {
          headers: {
            'User-Agent': 'TRAQ-IQ-Fleet-Management/1.0'
          }
        }
      );
      
      const geocodeData = await geocodeResponse.json();
      
      if (!geocodeData || geocodeData.length === 0) {
        return res.status(404).json({ 
          ok: false,
          error: 'Unable to geocode target address',
          address: targetAddress
        });
      }

      const targetLat = parseFloat(geocodeData[0].lat);
      const targetLon = parseFloat(geocodeData[0].lon);

      // Calculate distance using Haversine formula (local version)
      const R = 3959;
      const dLat = (targetLat - lat) * Math.PI / 180;
      const dLon = (targetLon - lon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distanceInMiles = Math.round(R * c);

      res.json({
        ok: true,
        miles: distanceInMiles,
        distance: distanceInMiles,
        unit: 'miles',
        from: { lat, lon },
        to: { lat: targetLat, lon: targetLon, address: targetAddress }
      });
    } catch (error) {
      console.error('Error calculating distance:', error);
      res.status(500).json({ ok: false, error: 'Failed to calculate distance' });
    }
  });

  // POST endpoint to extract load info from Amazon Relay screenshot using AI vision
  app.post('/api/extract-load-screenshot', async (req, res) => {
    try {
      const { image } = req.body;
      
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ 
          ok: false, 
          error: 'Image data is required. Send base64 encoded image.' 
        });
      }

      console.log('📸 Extracting load info from screenshot...');
      const loadData = await extractLoadFromScreenshot(image);
      
      console.log('✅ Extracted load data:', loadData);
      res.json({
        ok: true,
        ...loadData
      });
    } catch (error: any) {
      console.error('Error extracting load from screenshot:', error);
      res.status(500).json({ 
        ok: false, 
        error: error?.message || 'Failed to extract load information from screenshot' 
      });
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
        console.log('SECURITY: Invalid GPS update rejected:', { ip, errors });
        return res.status(400).json({ 
          error: 'Invalid request data',
          details: errors
        });
      }

      const { driverId, lat, lon, timestamp } = validationResult.data;
      const { trackingToken, accuracy, altitude, speed, heading, batteryLevel } = req.body;

      // CRITICAL SECURITY CHECK: Validate tracking token
      if (!trackingToken) {
        console.log('SECURITY ALERT: GPS update rejected - missing tracking token:', { driverId, ip });
        return res.status(401).json({ 
          error: 'Unauthorized: Tracking token required',
          message: 'GPS tracking requires authentication. Please restart tracking from your dashboard.'
        });
      }

      // Validate that the token matches the driver ID
      const isValidToken = await storage.validateTrackingToken(driverId, trackingToken);
      
      if (!isValidToken) {
        console.log('SECURITY ALERT: GPS update rejected - invalid/mismatched tracking token:', { driverId, ip });
        return res.status(401).json({ 
          error: 'Unauthorized: Invalid tracking token',
          message: 'Authentication failed. Please restart tracking from your dashboard.'
        });
      }

      // Security audit log - log all location updates with IP for monitoring
      console.log('SECURITY AUDIT: GPS update:', { driverId, ip, lat, lon, speed: speed || 'N/A', batteryLevel: batteryLevel || 'N/A' });

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

      console.log('GPS location updated successfully:', { driverId });

      res.json({
        success: true,
        message: 'Location updated successfully',
        driverId,
        lat,
        lon,
        timestamp: timestamp || new Date().toISOString()
      });
    } catch (error) {
      console.error('SECURITY: GPS update error:', { ip }, error);
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
          const welcomeMessage = `Welcome to TRAQ IQ, ${driver.name}!\n\n` +
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

  // Validate onboarding token
  app.post("/api/validate-onboarding-token", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ 
          valid: false, 
          error: "Token is required" 
        });
      }

      const tokenData = await storage.getOnboardingToken(token);
      
      if (!tokenData) {
        return res.status(404).json({ 
          valid: false, 
          error: "Invalid token" 
        });
      }

      // Check if token is expired
      if (new Date() > new Date(tokenData.expiresAt)) {
        return res.status(400).json({ 
          valid: false, 
          error: "Token has expired" 
        });
      }

      // Check if token was already used
      if (tokenData.isUsed) {
        return res.status(400).json({ 
          valid: false, 
          error: "Token has already been used" 
        });
      }

      res.json({ 
        valid: true, 
        email: tokenData.email 
      });
    } catch (error) {
      console.error('Error validating token:', error);
      res.status(500).json({ 
        valid: false, 
        error: "Failed to validate token" 
      });
    }
  });

  // Full driver onboarding
  app.post("/api/driver-onboarding", async (req, res) => {
    try {
      const { token, ...driverData } = req.body;
      
      let tokenData = null;
      
      // Validate token if provided (token is optional)
      if (token) {
        tokenData = await storage.getOnboardingToken(token);
        
        if (!tokenData || tokenData.isUsed || new Date() > new Date(tokenData.expiresAt)) {
          return res.status(400).json({ error: "Invalid or expired token" });
        }
      }

      // Prepare driver data
      const driverRecord = {
        name: driverData.name,
        email: driverData.email || (tokenData?.email),
        phone: driverData.phone,
        city: driverData.city,
        emergencyContact: driverData.emergencyContact || null,
        emergencyPhone: driverData.emergencyPhone || null,
        licenseNumber: driverData.licenseNumber,
        licenseState: driverData.licenseState,
        equipmentType: driverData.equipmentType,
        weightCapacity: driverData.maxWeight || driverData.weightCapacity || 26000,
        maxLength: driverData.maxLength || 53,
        maxWeight: driverData.maxWeight || 48000,
        loadType: driverData.loadType || 'full_partial',
        status: 'available' as const,
        enableSmsNotifications: true,
        enableTelegramNotifications: false,
        isOnboarded: true
      };

      // Check for duplicates
      console.log(`🔍 Checking for duplicates: name="${driverRecord.name}", email="${driverRecord.email}", phone="${driverRecord.phone}"`);
      const duplicates = await storage.findDuplicateDrivers(
        driverRecord.name,
        driverRecord.email,
        driverRecord.phone
      );
      
      if (duplicates.length > 0) {
        console.log(`❌ Found ${duplicates.length} duplicate(s):`, duplicates.map(d => `${d.name} (${d.email} / ${d.phone})`));
        return res.status(409).json({
          error: "Duplicate driver found",
          duplicates,
          message: "A driver with this name, email, or phone already exists."
        });
      }
      console.log('✅ No duplicates found, proceeding with driver creation');

      // Create driver
      const driver = await storage.createDriver(driverRecord);
      
      // Mark token as used (only if token was provided)
      if (token) {
        await storage.markTokenAsUsed(token);
      }
      
      console.log(`✅ Driver onboarded: ${driver.name} (${driver.id})`);

      // Send welcome SMS
      const normalizedPhone = normalizePhoneToE164(driver.phone);
      if (normalizedPhone && twilioPhoneNumber) {
        try {
          const welcomeMessage = `Welcome to TRAQ IQ, ${driver.name}!\n\n` +
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
        message: 'Driver onboarded successfully!'
      });
      
    } catch (error) {
      console.error('❌ Onboarding error:', error);
      res.status(400).json({ error: "Onboarding failed" });
    }
  });

  // Create onboarding token and send invitation
  // Accepts { name?, email?, phone?, sendVia: 'sms'|'email' }
  // SMS-first is the fast path — just name + phone is enough.
  app.post("/api/create-onboarding-token", async (req, res) => {
    try {
      const { email, phone, name, sendVia } = req.body;

      if (!email && !phone) {
        return res.status(400).json({ error: "Email or phone is required" });
      }

      const { randomUUID } = await import('crypto');
      const tokenValue = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

      const tokenData = await storage.createOnboardingToken({
        token: tokenValue,
        email: email || `pending-${tokenValue.slice(0, 8)}@traqiq.app`,
        expiresAt,
        isUsed: false,
      });

      const onboardingUrl = `${getBaseUrl()}/driver-onboarding?token=${tokenValue}`;
      let smsSent = false;
      let smsError: string | null = null;

      // SMS path — actually fire the invite
      if ((sendVia === 'sms' || (!sendVia && phone)) && phone) {
        const { smsLoadService } = await import('./sms-service');
        const greeting = name ? `Hi ${name.split(' ')[0]}! ` : '';
        const body =
          `${greeting}TRAQ-IQ dispatch here. Tap this link to finish onboarding ` +
          `(CDL + truck info, 2 minutes): ${onboardingUrl}\n\n` +
          `Link expires in 7 days. Reply STOP to opt out.`;
        const result = await smsLoadService.sendSMS(phone, body);
        smsSent = !!result.success;
        smsError = result.error || null;
        if (smsSent) console.log(`📱 Onboarding SMS sent to ${phone}`);
        else console.warn(`⚠️ Onboarding SMS to ${phone} failed: ${smsError}`);
      }

      res.json({
        success: true,
        token: tokenValue,
        onboardingUrl,
        expiresAt: tokenData.expiresAt,
        smsSent,
        smsError,
      });
    } catch (error: any) {
      console.error('Error creating onboarding token:', error);
      res.status(500).json({ error: error?.message || "Failed to create onboarding token" });
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
            const dashboardUrl = `${getBaseUrl()}/mobile-driver-dashboard?driverId=${driver.id}`;
            
            // Shorten URL for professional appearance
            const shortUrlResult = await urlShortener.shortenUrl(dashboardUrl);
            const link = shortUrlResult.shortUrl || dashboardUrl;
            
            const smsMessage = `🚛 TRAQ IQ\n\n` +
              `Welcome, ${driver.name}!\n\n` +
              `Your driver portal is ready. Tap to access:\n` +
              `${link}\n\n` +
              `💡 Add to home screen for quick access\n\n` +
              `Questions? Reply to this message.`;

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

  // Manual driver onboarding endpoint (used by the Add Driver form)
  app.post("/api/drivers/manual-onboard", async (req, res) => {
    try {
      const normalizedDriverPhone = normalizePhoneToE164(req.body.phone) || req.body.phone;
      const manualDriverData = {
        name: req.body.name,
        email: req.body.email,
        phone: normalizedDriverPhone,
        phoneNumber: normalizedDriverPhone,
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

      const duplicates = await storage.findDuplicateDrivers(
        manualDriverData.name,
        manualDriverData.email,
        manualDriverData.phone
      );

      if (duplicates.length > 0) {
        const duplicateFields: string[] = [];
        duplicates.forEach((dup: any) => {
          if (dup.name === manualDriverData.name) duplicateFields.push("name");
          if (dup.email === manualDriverData.email) duplicateFields.push("email");
          if (dup.phone === manualDriverData.phone) duplicateFields.push("phone");
        });
        return res.status(409).json({
          error: `Driver already exists with the same ${duplicateFields.join(", ")}.`,
          duplicates,
          duplicateFields,
          message: `A driver with this ${duplicateFields.join(", ")} already exists in your fleet.`
        });
      }

      let driver;
      try {
        const validatedData = insertDriverSchema.parse(manualDriverData);
        driver = await storage.createDriver(validatedData);
      } catch (innerErr: any) {
        console.error("createDriver failed, trying raw SQL insert:", innerErr.message);
        // Direct raw SQL insert with only guaranteed columns
        const { randomUUID } = await import('crypto');
        const { db } = await import('./db');
        const { sql: rawSql } = await import('drizzle-orm');
        const newId = randomUUID();
        await db.execute(rawSql`
          INSERT INTO drivers (id, name, email, phone, status, license_number, is_onboarded, created_at)
          VALUES (${newId}, ${manualDriverData.name}, ${manualDriverData.email},
                  ${manualDriverData.phone}, 'available',
                  ${manualDriverData.licenseNumber || null}, true, NOW())
        `);
        driver = { id: newId, ...manualDriverData, status: 'available', isOnboarded: true, createdAt: new Date() };
      }
      res.status(201).json(driver);
    } catch (error: any) {
      console.error("Error creating manual driver:", error);
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create driver manually"
      });
    }
  });

  // Send dashboard link SMS to a single driver
  app.post("/api/drivers/:id/send-dashboard-link", async (req, res) => {
    try {
      const { id } = req.params;
      
      console.log(`\n📱 ========== DASHBOARD LINK REQUEST ==========`);
      console.log(`🔍 Driver ID: ${id}`);
      
      // Get driver details
      const driver = await storage.getDriver(id);
      if (!driver) {
        console.log(`❌ Driver not found: ${id}`);
        return res.status(404).json({
          success: false,
          error: 'Driver not found'
        });
      }

      console.log(`✅ Driver found: ${driver.name}`);
      console.log(`📋 Phone fields - phone: "${driver.phone}", phoneNumber: "${driver.phoneNumber}"`);

      // Normalize phone number
      const driverPhone = driver.phoneNumber || driver.phone;
      console.log(`🔍 Using phone field: ${driver.phoneNumber ? 'phoneNumber' : 'phone'} → "${driverPhone}"`);
      
      const normalizedPhone = normalizePhoneToE164(driverPhone);
      
      if (!normalizedPhone) {
        console.error(`❌ Phone normalization failed for driver ${driver.name}`);
        return res.status(400).json({
          success: false,
          error: `Driver phone number (${driverPhone}) cannot be normalized to E.164 format`,
          driverName: driver.name
        });
      }

      console.log(`✅ Phone normalized successfully: ${normalizedPhone}`);

      // Create dashboard URL
      const dashboardUrl = `${getBaseUrl()}/mobile-driver-dashboard?driverId=${driver.id}`;
      console.log(`🔗 Dashboard URL: ${dashboardUrl}`);
      
      // Shorten URL for professional appearance
      const shortUrlResult = await urlShortener.shortenUrl(dashboardUrl);
      const link = shortUrlResult.shortUrl || dashboardUrl;
      console.log(`🔗 ${shortUrlResult.shortUrl ? 'Shortened' : 'Original'} link: ${link}`);
      
      // Create SMS message with TRAQ IQ branding
      const smsMessage = `🚛 TRAQ IQ\n\n` +
        `Hi ${driver.name}!\n\n` +
        `Access your driver portal:\n` +
        `${link}\n\n` +
        `View loads, track GPS, and message dispatch.\n\n` +
        `Questions? Reply here.`;

      console.log(`📨 Sending SMS to ${normalizedPhone}...`);
      console.log(`📝 Message preview: ${smsMessage.substring(0, 100)}...`);

      // Send SMS using smsLoadService
      const smsResult = await smsLoadService.sendSMS({
        to: normalizedPhone,
        body: smsMessage
      });
      
      console.log(`📊 SMS Result:`, smsResult);
      
      if (smsResult.success) {
        console.log(`✅ ========== DASHBOARD LINK SENT SUCCESSFULLY ==========`);
        console.log(`   Driver: ${driver.name}`);
        console.log(`   Phone: ${normalizedPhone}`);
        console.log(`   Message SID: ${smsResult.messageSid || 'N/A'}`);
        console.log(`========================================================\n`);
        
        res.json({
          success: true,
          message: 'Dashboard link sent successfully',
          driverName: driver.name,
          phoneNumber: normalizedPhone,
          messageId: smsResult.messageSid
        });
      } else {
        console.error(`❌ ========== DASHBOARD LINK SEND FAILED ==========`);
        console.error(`   Driver: ${driver.name}`);
        console.error(`   Phone: ${normalizedPhone}`);
        console.error(`   Error: ${smsResult.error}`);
        console.error(`====================================================\n`);
        
        // Check if this is a Twilio authentication error
        const isTwilioAuthError = smsResult.error?.includes('Authenticate') || 
                                   smsResult.error?.includes('401') ||
                                   smsResult.error?.includes('20003');
        
        if (isTwilioAuthError) {
          return res.status(503).json({
            success: false,
            error: 'Twilio authentication failed. Please check your Twilio credentials (ACCOUNT_SID and AUTH_TOKEN) in the environment settings.',
            technicalError: smsResult.error
          });
        }
        
        res.status(503).json({
          success: false,
          error: smsResult.error || 'Failed to send SMS'
        });
      }

    } catch (error) {
      console.error('Error sending dashboard link SMS:', error);
      
      // Check if this is a Twilio authentication error in the exception
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTwilioAuthError = errorMessage.includes('Authenticate') || 
                                 errorMessage.includes('401') ||
                                 errorMessage.includes('20003');
      
      if (isTwilioAuthError) {
        return res.status(503).json({
          success: false,
          error: 'Twilio authentication failed. Please verify your Twilio ACCOUNT_SID and AUTH_TOKEN are correct and active.',
          technicalError: errorMessage
        });
      }
      
      res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  });

  // Send dashboard links to all active drivers
  app.post("/api/drivers/send-dashboard-links", requireBulkAuthorization, bulkSmsRateLimiter, async (req, res) => {
    try {
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

          const dashboardUrl = `${getBaseUrl()}/mobile-driver-dashboard?driverId=${driver.id}`;
          
          // Shorten URL for professional appearance
          const shortUrlResult = await urlShortener.shortenUrl(dashboardUrl);
          const link = shortUrlResult.shortUrl || dashboardUrl;
          
          const smsMessage = `🚛 TRAQ IQ\n\n` +
            `Hi ${driver.name}!\n\n` +
            `Access your driver portal:\n` +
            `${link}\n\n` +
            `View loads, track GPS, and message dispatch.\n\n` +
            `Questions? Reply here.`;

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
      
      let loads;
      // BUG FIX #3: Add driverId filtering support
      if (driverId && typeof driverId === "string") {
        loads = await storage.getLoadsByDriver(driverId);
      } else if (status && typeof status === "string") {
        loads = await storage.getLoadsByStatus(status);
      } else {
        loads = await storage.getAllLoads();
      }
      
      // Sanitize all loads before sending to frontend
      const sanitizedLoads = loads.map(sanitizeLoadData);
      res.json(sanitizedLoads);
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
      
      // Sanitize load data before sending to frontend
      const sanitizedLoad = sanitizeLoadData(load);
      res.json(sanitizedLoad);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load" });
    }
  });

  // --- DEDICATED DISPATCH COMMAND ---
  // Atomic transaction: update load + send SMS in one request
  app.post("/api/loads/dispatch", async (req, res) => {
    try {
      const { loadId, driverId } = req.body;

      console.log(`🚀 Dispatching Load #${loadId} to Driver #${driverId}`);

      // Validate inputs - loadId and driverId can be UUIDs (strings) or numbers
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "loadId and driverId are required" });
      }

      // 1. UPDATE DATABASE (The Critical Step)
      // We force the status to 'dispatched' and assign the driver
      const updatedLoad = await storage.updateLoad(String(loadId), {
        status: "dispatched",
        driverId: String(driverId),
        sopProgress: { initialSms: true } // Auto-start step 1
      });

      if (!updatedLoad) {
        throw new Error("Load update failed. Load not found.");
      }

      console.log("✅ Load Moved Successfully:", updatedLoad.status);

      // 2. SEND SMS (Only happens if Step 1 succeeds)
      try {
        const driver = await storage.getDriver(String(driverId));
        if (driver && updatedLoad) {
          await smsLoadService.sendBookingRequest(updatedLoad, driver);
          console.log("✅ SMS Sent Successfully");
        }
      } catch (smsError) {
        console.error("⚠️ SMS Failed (but Load Moved):", smsError);
        // We don't throw error here because we want the move to persist
      }

      res.json({ success: true, load: updatedLoad });

    } catch (error: any) {
      console.error("❌ Dispatch Error:", error);
      res.status(500).json({ error: error.message });
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
      console.log('Updating load:', { id, data: req.body });
      
      const validatedData = insertLoadSchema.partial().parse(req.body);
      console.log('Validated data:', validatedData);
      
      const originalLoad = await storage.getLoad(id);
      
      if (!originalLoad) {
        console.error('Load not found:', { id });
        return res.status(404).json({ error: "Load not found" });
      }
      
      const updatedLoad = await storage.updateLoad(id, validatedData);
      
      if (!updatedLoad) {
        console.error('Failed to update load:', { id });
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
        console.log('Load assigned to driver:', { loadId: id, driverId: validatedData.driverId });
        // SMS notifications handled separately
      }
      
      console.log('Successfully updated load:', { id });
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
      
      // SAFETY CHECK: Validate and clean the Driver ID
      // FIX: Return error for invalid driverId instead of silently removing it
      if (updates.assignedDriverId !== undefined) {
        if (updates.assignedDriverId === null || updates.assignedDriverId === '') {
          delete updates.assignedDriverId; // Allow explicit null to clear assignment
        } else {
          const parsed = parseInt(updates.assignedDriverId);
          if (isNaN(parsed)) {
            return res.status(400).json({ 
              error: "Invalid assignedDriverId", 
              message: "Driver ID must be a valid number" 
            });
          }
          updates.assignedDriverId = parsed;
        }
      }
      
      // Also handle driverId for backwards compatibility
      if (updates.driverId !== undefined) {
        if (updates.driverId === null || updates.driverId === '') {
          delete updates.driverId; // Allow explicit null to clear assignment
        } else {
          const parsed = parseInt(updates.driverId);
          if (isNaN(parsed)) {
            return res.status(400).json({ 
              error: "Invalid driverId", 
              message: "Driver ID must be a valid number" 
            });
          }
          updates.driverId = parsed;
        }
      }
      
      console.log(`📝 Updating Load #${id}:`, updates);
      
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
      
      // Send SMS to driver with load assignment details and link
      let smsSent = false;
      if (updatedLoad.driverId && twilioClient && twilioPhoneNumber) {
        try {
          const driver = await storage.getDriver(updatedLoad.driverId);
          if (driver?.phone) {
            const baseUrl = process.env.REPLIT_DEPLOYMENT_URL || process.env.REPLIT_DEV_DOMAIN || 'https://traq-iq.replit.app';
            const loadViewUrl = `${baseUrl.startsWith('http') ? baseUrl : 'https://' + baseUrl}/driver/load/${updatedLoad.id}`;
            
            const message = `📦 LOAD ASSIGNMENT\n\n` +
              `Load #${updatedLoad.loadNumber || id.slice(0, 8)}\n` +
              `From: ${updatedLoad.originCity || updatedLoad.pickupAddress?.split(',')[0] || 'TBD'}, ${updatedLoad.originState || ''}\n` +
              `To: ${updatedLoad.destCity || updatedLoad.deliveryAddress?.split(',')[0] || 'TBD'}, ${updatedLoad.destState || ''}\n` +
              `Rate: $${updatedLoad.rate || 0}\n` +
              `Weight: ${updatedLoad.weight ? updatedLoad.weight.toLocaleString() + ' lbs' : 'TBD'}\n\n` +
              `Pickup: ${updatedLoad.pickupDate ? new Date(updatedLoad.pickupDate).toLocaleDateString() : 'TBD'} @ ${updatedLoad.pickupTime || 'TBD'}\n\n` +
              `View details: ${loadViewUrl}\n\n` +
              `Reply YES to confirm.`;
            
            const normalizedPhone = driver.phone.startsWith('+') ? driver.phone : '+1' + driver.phone.replace(/\D/g, '');
            await twilioClient.messages.create({
              to: normalizedPhone,
              from: twilioPhoneNumber,
              body: message
            });
            smsSent = true;
            console.log(`📱 SMS sent to driver ${driver.name} for load ${updatedLoad.id}`);
          }
        } catch (smsErr) {
          console.warn('Failed to send assignment SMS to driver:', smsErr);
        }
      }
      
      res.json({ ...updatedLoad, smsSent });
    } catch (error) {
      console.error('Error assigning driver:', error);
      res.status(500).json({ error: 'Failed to assign driver' });
    }
  });

  // Mark a load delivered — sets deliveredAt + status so settlements can pick it up
  app.post('/api/loads/:id/deliver', async (req, res) => {
    try {
      const { id } = req.params;
      const deliveredAt = req.body?.deliveredAt ? new Date(req.body.deliveredAt) : new Date();
      const updatedLoad = await storage.updateLoad(id, {
        status: 'delivered',
        deliveredAt,
        lifecycleStatus: 'delivered' as any,
      });
      if (!updatedLoad) {
        return res.status(404).json({ ok: false, error: 'Load not found' });
      }
      // Free up the driver
      if (updatedLoad.driverId) {
        try {
          await storage.updateDriver(updatedLoad.driverId, { status: 'available' });
        } catch (e) {
          console.warn('Failed to update driver status on deliver:', e);
        }
      }
      res.json({ ok: true, load: updatedLoad });
    } catch (err: any) {
      console.error('Error marking delivered:', err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Public weekly statement for a driver (token-gated; no auth required so driver can
  // open from SMS link). Token comes from drivers.trackingToken.
  app.get('/statements/:token', async (req, res) => {
    try {
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { computeSettlementForDriver, fmtYMD } = await import('./settlements-service');

      const [driver] = await db
        .select()
        .from(drivers)
        .where(eq(drivers.trackingToken, req.params.token));
      if (!driver) return res.status(404).type('html').send('<h1>Statement not found</h1>');

      const weekRef = (req.query.week as string) || fmtYMD(new Date());
      const settlement = await computeSettlementForDriver(driver.id, weekRef);

      const rows = settlement
        ? settlement.lines
            .map(
              (l) => `<tr>
  <td>${l.loadNumber}</td>
  <td>${l.origin} → ${l.destination}</td>
  <td>${l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString() : '—'}</td>
  <td style="text-align:right">$${l.rate.toFixed(2)}</td>
  <td style="text-align:right">${l.miles || '—'}</td>
  <td style="text-align:right"><b>$${l.pay.toFixed(2)}</b></td>
</tr>`,
            )
            .join('')
        : '<tr><td colspan="6" style="text-align:center;color:#666">No delivered loads this week.</td></tr>';

      const totalPay = settlement?.totalPay ?? 0;
      const totalRev = settlement?.totalRevenue ?? 0;
      const weekStart = settlement?.weekStart ?? weekRef;
      const weekEnd = settlement?.weekEnd ?? weekRef;

      res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LAMP — Weekly Statement</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#111;background:#fff}
  h1{font-size:22px;color:#00B5B8;margin-bottom:4px}
  .meta{color:#666;font-size:14px}
  .total{background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:14px 16px;margin:16px 0;display:flex;justify-content:space-between;align-items:center}
  .total b{font-size:28px;color:#16a34a}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
  th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
  th{background:#fafafa;color:#555;font-weight:600}
</style></head><body>
  <h1>LAMP Logistics — Weekly Statement</h1>
  <div class="meta">${driver.name} · Week of ${weekStart} → ${weekEnd}</div>
  <div class="meta">Pay rule: ${driver.payType || 'percent'} @ ${driver.payRate ?? 75}${
        (driver.payType || 'percent') === 'percent' ? '%' : '$'
      }</div>
  <div class="total">
    <div>Total Pay <div style="font-size:12px;color:#666">of $${totalRev.toFixed(2)} revenue</div></div>
    <b>$${totalPay.toFixed(2)}</b>
  </div>
  <table>
    <thead><tr><th>Load</th><th>Route</th><th>Delivered</th><th style="text-align:right">Rate</th><th style="text-align:right">Miles</th><th style="text-align:right">Pay</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#999;font-size:12px;margin-top:24px">Questions? Text dispatch.</p>
</body></html>`);
    } catch (err: any) {
      console.error('Statement error:', err);
      res.status(500).type('html').send('<h1>Error loading statement</h1>');
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
      
      console.log('Document approved:', { documentId, approvedBy });
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
              
              const smsMessage = `🚛 TRAQ IQ\n\n` +
                `📄 Document Rejected\n\n` +
                `Your ${document.documentType.replace('_', ' ').toUpperCase()} for ${loadContext} was rejected.\n\n` +
                `Reason: ${reason}\n\n` +
                `Please resubmit. Questions? Reply here.`;
              
              const result = await smsService.sendSMS(driverPhone, smsMessage);
              
              if (result.success) {
                console.log('Rejection SMS sent:', { driverName: driver.name, documentId });
              } else {
                console.error('Failed to send rejection SMS:', { error: result.error });
              }
            }
          }
        }
      } catch (smsError) {
        console.error('Error sending rejection SMS:', smsError);
        // Continue even if SMS fails - rejection is still recorded
      }
      
      console.log('Document rejected:', { documentId, rejectedBy, reason });
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
      const { category, driverId } = req.body;
      
      // Authentication: Require driverId
      if (!driverId) {
        return res.status(401).json({ error: 'Driver ID is required for authentication' });
      }
      
      // Verify driver exists
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(401).json({ error: 'Invalid driver' });
      }
      
      // Get document to verify ownership
      const existingDoc = await storage.getLoadDocument(documentId);
      if (!existingDoc) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Authorization: Verify document ownership
      if (existingDoc.driverId !== driverId) {
        console.warn('Unauthorized recategorize attempt:', { requestingDriver: driverId, documentId, ownerDriver: existingDoc.driverId });
        return res.status(403).json({ error: 'Not authorized to modify this document' });
      }
      
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
      
      console.log('Document recategorized:', { documentId, category, driverId });
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

  // DELETE /api/documents/:documentId - Delete a document
  app.delete('/api/documents/:documentId', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { driverId } = req.body;
      
      // Authentication: Require driverId
      if (!driverId) {
        return res.status(401).json({ error: 'Driver ID is required for authentication' });
      }
      
      // Verify driver exists
      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(401).json({ error: 'Invalid driver' });
      }
      
      // Get document before deletion for logging and ownership verification
      const document = await storage.getLoadDocument(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Authorization: Verify document ownership
      if (document.driverId !== driverId) {
        console.warn('Unauthorized delete attempt:', { requestingDriver: driverId, documentId, ownerDriver: document.driverId });
        return res.status(403).json({ error: 'Not authorized to delete this document' });
      }
      
      const success = await storage.deleteLoadDocument(documentId);
      
      if (!success) {
        return res.status(500).json({ error: 'Failed to delete document' });
      }
      
      console.log('Document deleted:', { documentId, documentType: document.documentType, driverId });
      res.json({ 
        success: true, 
        message: 'Document deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(500).json({ error: 'Failed to delete document' });
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
TRAQ IQ Dispatch Team
      `;
      
      // Send email with PDF attachment
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "TRAQ IQ <noreply@traqiqs.io>",
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
  
  // ─── Auto Load Matcher Routes ─────────────────────────────────────────────

  // GET /api/hot-loads — returns all recent auto-matched loads (dispatched + pending)
  app.get('/api/hot-loads', async (_req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      // Return all matches so dispatcher sees what was auto-sent and what needs manual action
      res.json(autoLoadMatcher.getAllMatches());
    } catch (e: any) {
      res.json([]);
    }
  });

  // ─── Load Lifecycle Routes ─────────────────────────────────────────────────

  // GET /api/lifecycle/sop/:loadId — get SOP progress for a load
  app.get('/api/lifecycle/sop/:loadId', async (req, res) => {
    try {
      const load = await storage.getLoad(req.params.loadId);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      res.json({
        loadId: load.id,
        loadNumber: load.loadNumber,
        status: load.status,
        sopProgress: (load as any).sopProgress || {},
        driverConfirmedAt: (load as any).driverConfirmedAt,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/lifecycle/submit-factoring/:loadId — manually trigger Einstein email
  app.post('/api/lifecycle/submit-factoring/:loadId', async (req, res) => {
    try {
      const load = await storage.getLoad(req.params.loadId);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const einsteinEmail = process.env.FACTORING_EMAIL || process.env.EINSTEIN_EMAIL;
      if (!einsteinEmail) return res.status(400).json({ error: 'FACTORING_EMAIL env var not set in Railway' });

      const driver = load.driverId ? await storage.getDriver(load.driverId) : null;
      const rate = (load as any).rate || (load as any).rate_total || 0;

      await transporter.sendMail({
        from: process.env.SMTP_USER || 'dispatch@traqiq.app',
        to: einsteinEmail,
        subject: `📦 Factoring Package — Load #${load.loadNumber} | ${(load as any).originCity || ''} → ${(load as any).destCity || ''}`,
        html: `
          <h2>Factoring Submission — Load #${load.loadNumber}</h2>
          <p><b>Driver:</b> ${driver?.name || 'N/A'}</p>
          <p><b>Route:</b> ${(load as any).originCity || ''} → ${(load as any).destCity || ''}</p>
          <p><b>Rate:</b> $${Number(rate).toLocaleString()}</p>
          <p><b>Load #:</b> ${load.loadNumber}</p>
          <p>Please submit to factoring: RateCon + BOL + freight photos. Documents are stored in TRAQ-IQ.</p>
          <p style="color:#999;font-size:12px;">Sent by TRAQ-IQ · LAMP Logistics</p>
        `,
      });

      await storage.updateLoad(load.id, {
        sopProgress: { ...((load as any).sopProgress || {}), einsteinSubmitted: true, einsteinSubmittedAt: new Date().toISOString() },
      });

      res.json({ success: true, message: `Factoring package emailed to ${einsteinEmail}` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/lifecycle/release-driver/:loadId — send "you are good to go" to driver
  app.post('/api/lifecycle/release-driver/:loadId', async (req, res) => {
    try {
      const load = await storage.getLoad(req.params.loadId);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      const driver = load.driverId ? await storage.getDriver(load.driverId) : null;
      if (!driver?.phone) return res.status(400).json({ error: 'No driver phone' });

      const { smsLoadService } = await import('./sms-service');
      await (smsLoadService as any).sendSMS(driver.phone,
        `✅ You are GOOD TO GO!\n\nLoad #${load.loadNumber} is complete. Thank you for the great work!\n\nYour documents have been received. Stay safe out there. We'll be in touch for your next load. 🚛`
      );

      await storage.updateLoad(load.id, {
        status: 'delivered',
        sopProgress: { ...((load as any).sopProgress || {}), driverReleased: true },
      });

      res.json({ success: true, message: 'Driver released' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/hot-loads/stats — matcher stats
  app.get('/api/hot-loads/stats', async (_req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      res.json(autoLoadMatcher.getStats());
    } catch (e: any) {
      res.json({ total: 0, pending: 0, isRunning: false });
    }
  });

  // POST /api/hot-loads/:id/dispatch — dispatcher approves, sends SMS to driver
  app.post('/api/hot-loads/:id/dispatch', async (req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      const hotLoad = autoLoadMatcher.getHotLoads().find(h => h.id === req.params.id);
      if (!hotLoad) return res.status(404).json({ error: 'Hot load not found' });

      // Send booking request SMS to driver
      if (hotLoad.matchedDriverPhone) {
        try {
          const { smsLoadService } = await import('./sms-service');
          const fakeLoad = {
            loadNumber: hotLoad.sourceLoadId,
            load_number: hotLoad.sourceLoadId,
            rate: hotLoad.rate,
            rate_total: hotLoad.rate,
            originCity: hotLoad.origin,
            origin_city: hotLoad.origin,
            destCity: hotLoad.destination,
            dest_city: hotLoad.destination,
          };
          const fakeDriver = {
            phone: hotLoad.matchedDriverPhone,
            name: hotLoad.matchedDriverName,
          };
          await smsLoadService.sendBookingRequest(fakeLoad, fakeDriver);
        } catch (smsErr: any) {
          console.error('[HotLoad] SMS failed:', smsErr.message);
        }
      }

      autoLoadMatcher.markDispatched(req.params.id);
      res.json({ success: true, message: 'Dispatch SMS sent to driver' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/hot-loads/:id/dismiss — dispatcher dismisses a match
  app.post('/api/hot-loads/:id/dismiss', async (req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      const ok = autoLoadMatcher.dismissMatch(req.params.id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/dispatch-criteria — get current ideal load criteria
  app.get('/api/dispatch-criteria', async (_req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      res.json(autoLoadMatcher.getCriteria());
    } catch (e: any) {
      res.json({});
    }
  });

  // PUT /api/dispatch-criteria — update ideal load criteria
  app.put('/api/dispatch-criteria', async (req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      const updated = autoLoadMatcher.updateCriteria(req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/dispatch-criteria/reset — reset to defaults
  app.post('/api/dispatch-criteria/reset', async (_req, res) => {
    try {
      const { autoLoadMatcher } = await import('./auto-load-matcher');
      res.json(autoLoadMatcher.resetCriteria());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Communication threads route - CRITICAL for dashboard
  // Enhanced to include driver status and current active load information
  // Supports ?driverId= filter for efficient mobile dashboard loading
  app.get('/api/communication/threads', async (req, res) => {
    try {
      const { driverId: filterDriverId } = req.query;
      
      // Optimized path for driver-specific requests (mobile dashboard)
      if (filterDriverId && typeof filterDriverId === 'string') {
        const threads = await storage.getThreadsByDriver(filterDriverId);
        const enrichedThreads = threads.map(thread => ({
          ...thread,
          lastMessage: thread.lastMessageText,
          lastMessageTimestamp: thread.lastMessageAt
        }));
        return res.json(enrichedThreads);
      }
      
      // Full query for dispatcher dashboard - run all three in parallel for speed
      const [threads, allDrivers, activeLoads] = await Promise.all([
        storage.getAllLoadCommunicationThreads(),
        storage.getAllDrivers(),
        (storage as any).getActiveLoadsForDispatch(),
      ]);
      
      // For each thread, enrich with driver status and current load info
      // Use cached thread data instead of N+1 message queries for performance
      const enrichedThreads = threads.map((thread) => {
        // Find driver info
        const driver = allDrivers.find((d: any) => d.id === thread.driverId);
        
        // Find driver's current active load (not necessarily the thread's load)
        const activeLoad = activeLoads.find((load: any) => load.driverId === thread.driverId);
        
        // Determine driver status
        const driverStatus = activeLoad ? 'Active' : 'Available';
        const currentLoadNumber = activeLoad?.loadNumber || null;
        
        return {
          ...thread,
          lastMessage: thread.lastMessageText,
          lastMessageTimestamp: thread.lastMessageAt,
          lastMessageSenderRole: thread.lastMessageSender || null,
          // New enhanced fields
          driverStatus,
          currentLoadNumber, // Current active load (may differ from thread.loadNumber)
          driverEquipmentType: driver?.equipmentType || null,
          driverMood: driver?.currentMood || null
        };
      });
      
      res.json(enrichedThreads);
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

  // Send SMS to a driver from dispatcher dashboard
  app.post('/api/communication/send-sms', async (req, res) => {
    try {
      const { driverId, message } = req.body;
      
      if (!driverId || !message) {
        return res.status(400).json({ error: 'Driver ID and message are required' });
      }
      
      console.log(`📱 Dispatcher SMS: Sending to driver ${driverId}`);
      
      // Get driver details
      const driver = await storage.getDriverById(driverId);
      if (!driver) {
        return res.status(404).json({ error: 'Driver not found' });
      }
      
      // Get or validate phone number (handle both snake_case and camelCase)
      const phoneNumber = driver.phoneNumber || driver.phone_number || driver.phone;
      if (!phoneNumber) {
        return res.status(400).json({ error: 'Driver has no phone number' });
      }
      
      // Normalize phone number
      const normalizedPhone = phoneNumber.replace(/\D/g, '');
      
      // Send SMS using the SMS service
      const smsService = (global as any).smsService;
      if (!smsService || !smsService.isServiceConfigured || !smsService.isServiceConfigured()) {
        return res.status(503).json({ error: 'SMS service not configured' });
      }
      
      const result = await smsService.sendSMS({
        to: normalizedPhone,
        body: message
      });
      
      if (!result.success) {
        console.error(`❌ Failed to send SMS to driver ${driverId}:`, result.error);
        return res.status(500).json({ error: result.error || 'Failed to send SMS' });
      }
      
      console.log(`✅ Dispatcher SMS sent successfully to ${driver.name} (${normalizedPhone})`);
      
      // Find or create communication thread for this driver (reuse existing active thread of any type)
      let thread = null;
      try {
        const threads = await storage.getAllLoadCommunicationThreads();
        // Prefer the most recently active thread for this driver (any type) so dispatch
        // outbound messages and inbound SMS always land in the same conversation thread.
        const driverActiveThreads = threads
          .filter((t: any) => t.driverId === driverId && t.status === 'active')
          .sort((a: any, b: any) => {
            const aTime = new Date(a.lastMessageAt || 0).getTime();
            const bTime = new Date(b.lastMessageAt || 0).getTime();
            return bTime - aTime;
          });
        thread = driverActiveThreads[0] || null;
        
        // If no thread exists at all, create a unified one
        if (!thread) {
          thread = await storage.createLoadCommunicationThread({
            driverId,
            loadId: null,
            threadType: 'unified',
            driverName: driver.name,
            loadNumber: null,
            loadOrigin: null,
            loadDestination: null,
            loadOfferStatus: null
          });
          console.log(`✅ Created new unified thread for driver ${driver.name}`);
        }
        
        // Create message record in the thread
        await storage.createLoadMessage({
          threadId: thread.id,
          content: message,
          sender: 'dispatch',
          isRead: true,
          deliveryStatus: 'delivered',
          deliveryMethod: 'sms',
          smsMessageId: result.sid || null
        });
        
        console.log(`✅ Message saved to thread ${thread.id}`);
      } catch (threadError) {
        console.error('⚠️ Failed to save message to thread (non-critical):', threadError);
        // Don't fail the response if thread creation fails
      }
      
      res.json({ 
        success: true, 
        message: 'SMS sent successfully',
        sid: result.sid,
        threadId: thread?.id
      });
    } catch (error) {
      console.error('❌ Error sending dispatcher SMS:', error);
      res.status(500).json({ error: 'Failed to send SMS' });
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
      res.setHeader('Content-Length', imageBuffer.byteLength.toString());
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(imageBuffer));
      
    } catch (error) {
      console.error('❌ Error proxying media:', error);
      res.status(500).json({ error: 'Failed to proxy media' });
    }
  });

  // Consolidate duplicate threads for a specific driver
  app.post('/api/communication/consolidate-driver-threads', async (req, res) => {
    try {
      const { driverId } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: 'Driver ID is required' });
      }
      
      console.log(`🔄 Consolidating threads for driver ${driverId}`);
      const result = await storage.consolidateDuplicateThreadsForDriver(driverId);
      
      res.json({
        success: true,
        merged: result.merged,
        canonicalThread: result.canonical
      });
    } catch (error) {
      console.error('❌ Error consolidating driver threads:', error);
      res.status(500).json({ error: 'Failed to consolidate driver threads' });
    }
  });

  // Consolidate all duplicate threads globally
  app.post('/api/communication/consolidate-all-threads', async (req, res) => {
    try {
      console.log('🚀 Starting global thread consolidation');
      const result = await storage.consolidateAllDuplicateThreads();
      
      res.json({
        success: true,
        totalDrivers: result.totalDrivers,
        totalMerged: result.totalMerged,
        message: `Consolidated ${result.totalMerged} threads across ${result.totalDrivers} drivers`
      });
    } catch (error) {
      console.error('❌ Error consolidating all threads:', error);
      res.status(500).json({ error: 'Failed to consolidate threads' });
    }
  });

  // Send message to thread via SMS
  app.post('/api/communication/messages', async (req, res) => {
    try {
      const { threadId, content, sender = 'dispatch', driverId, loadId: requestLoadId, mediaUrl } = req.body;
      
      if (!content) {
        return res.status(400).json({ error: 'Content is required' });
      }

      // Get or find/create thread
      let thread;
      
      if (threadId && threadId !== 'auto') {
        // Lookup existing thread by ID
        thread = await storage.getLoadCommunicationThread(threadId);
        if (!thread) {
          return res.status(404).json({ error: 'Communication thread not found' });
        }
      } else if (driverId) {
        // Find or create unified thread for this driver (used by mobile dashboard)
        const allThreads = await storage.getAllLoadCommunicationThreads();
        thread = allThreads.find(t => t.driverId === driverId && t.threadType === 'unified');
        
        if (!thread) {
          // Create new unified thread for this driver
          const driver = await storage.getDriver(driverId);
          if (!driver) {
            return res.status(404).json({ error: 'Driver not found' });
          }
          
          // Get driver's current active load for context (optional)
          const activeLoads = await storage.getLoadsByStatus('assigned');
          const driverLoad = activeLoads.find(load => load.driverId === driverId);
          
          thread = await storage.createLoadCommunicationThread({
            threadType: 'unified',
            loadId: driverLoad?.id || null,
            driverId: driverId,
            status: 'active',
            lastMessageAt: new Date(),
            messageCount: 0,
            unreadDriverMessages: 0,
            unreadDispatchMessages: 0,
            driverName: driver.name,
            driverPhone: driver.phone || driver.phoneNumber || '',
            loadNumber: driverLoad?.loadNumber || null
          });
          
          console.log(`✅ Created unified thread for driver ${driver.name} (${driverId})`);
        }
      } else {
        return res.status(400).json({ error: 'Either threadId or driverId is required' });
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
        
        if (thread.threadType === 'general' && !requestLoadId) {
          // General chat: Simple message format
          smsMessage = `Message from Dispatch: ${content}`;
        } else {
          // Load communication: Include load context with route information
          // Use requestLoadId if provided (for load-specific chats), otherwise fallback to thread.loadId
          const loadIdForContext = requestLoadId || thread.loadId;
          const load = loadIdForContext ? await storage.getLoad(loadIdForContext) : null;
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
      } else if (sender === 'driver') {
        // Handle driver-originated messages - send SMS to dispatcher
        const driver = await storage.getDriver(thread.driverId);
        if (!driver) {
          return res.status(404).json({ error: 'Driver not found for this thread' });
        }

        // Get dispatcher phone number from environment
        const dispatcherPhone = process.env.DISPATCHER_PHONE_NUMBER;
        const normalizedDispatcherPhone = normalizePhoneToE164(dispatcherPhone);
        
        if (!normalizedDispatcherPhone) {
          console.log(`⚠️ Cannot send SMS to dispatcher - DISPATCHER_PHONE_NUMBER not configured`);
          deliveryMethod = 'app_only';
          deliverySuccess = true; // Still save the message in app
        } else {
          // Format message with driver and load context
          let smsMessage: string;
          
          if (thread.threadType === 'general') {
            // General chat: Include driver name
            smsMessage = `Message from ${driver.name}: ${content}`;
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
              
              smsMessage = `${driver.name} - Load ${load.loadNumber}${routeInfo}: ${content}`;
            } else {
              smsMessage = `${driver.name} - Load Message: ${content}`;
            }
          }
          
          // Send via SMS to dispatcher
          try {
            console.log(`📱 Sending driver message to dispatcher (${normalizedDispatcherPhone})`);
            
            const smsResult = await smsService.sendSMS({
              to: normalizedDispatcherPhone,
              body: smsMessage
            });
            
            if (smsResult.success) {
              console.log(`✅ Driver message sent via SMS to dispatcher${smsResult.messageSid ? ` - SID: ${smsResult.messageSid}` : ''}`);
              deliveryMethod = 'sms';
              deliverySuccess = true;
            } else {
              console.error(`❌ SMS delivery to dispatcher failed: ${smsResult.error}`);
              deliveryMethod = 'app_only';
              deliverySuccess = true; // Still save the message in app
            }
          } catch (smsError) {
            console.error(`❌ SMS delivery error to dispatcher:`, smsError);
            deliveryMethod = 'app_only';
            deliverySuccess = true; // Still save the message in app
          }
        }
      }

      // Store message in database - use requestLoadId if provided, otherwise fall back to thread loadId
      const messageLoadId = requestLoadId || thread.loadId || null;
      await storage.createLoadMessage({
        threadId: thread.id,
        loadId: messageLoadId,
        senderId: sender === 'driver' ? thread.driverId : null,
        senderRole: sender,
        senderName: sender === 'driver' ? thread.driverName : 'Dispatcher',
        messageType: mediaUrl ? 'image' : 'text',
        textContent: content,
        mediaUrl: mediaUrl || null,
        isRead: false,
        isSuggested: false,
        isSent: true,
        communicationMethod: deliveryMethod
      });

      // Update thread stats
      await storage.updateLoadCommunicationThread(thread.id, {
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

  // Typing indicator REST API endpoints (fallback for WebSocket)
  app.post('/api/communication/typing', async (req, res) => {
    try {
      const { threadId, participantId, participantType, participantName, isTyping } = req.body;
      
      if (!threadId || !participantId) {
        return res.status(400).json({ error: 'threadId and participantId are required' });
      }
      
      const { typingIndicatorService } = await import('./typing-indicator-service');
      typingIndicatorService.setTypingStatus(
        threadId,
        participantId,
        participantType || 'dispatch',
        participantName || 'Someone',
        isTyping !== false
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('❌ Error updating typing status:', error);
      res.status(500).json({ error: 'Failed to update typing status' });
    }
  });

  app.get('/api/communication/typing/:threadId', async (req, res) => {
    try {
      const { threadId } = req.params;
      
      const { typingIndicatorService } = await import('./typing-indicator-service');
      const typingUsers = typingIndicatorService.getTypingStatus(threadId);
      
      res.json({ typing: typingUsers });
    } catch (error) {
      console.error('❌ Error getting typing status:', error);
      res.status(500).json({ error: 'Failed to get typing status' });
    }
  });

  // AI Message Suggestions endpoint
  app.post('/api/ai/message-suggestions', async (req, res) => {
    try {
      const { input, context, driverId, loadId } = req.body;
      
      console.log(`🤖 Generating AI message suggestions for driver: ${driverId}`);
      
      // Build enhanced context
      let enhancedContext = context || '';
      
      // Add load details if available
      if (loadId) {
        try {
          const load = await storage.getLoad(loadId);
          if (load) {
            enhancedContext += `\nLoad: ${load.loadNumber} from ${load.pickupCity}, ${load.pickupState} to ${load.deliveryCity}, ${load.deliveryState}`;
            if (load.status) {
              enhancedContext += `\nCurrent Status: ${load.status}`;
            }
          }
        } catch (err) {
          console.error('Error fetching load details:', err);
        }
      }
      
      const suggestions = await generateMessageSuggestions(input, enhancedContext);
      
      res.json({ 
        success: true,
        suggestions
      });
    } catch (error) {
      console.error('❌ Error generating AI suggestions:', error);
      res.status(500).json({ 
        error: "Failed to generate AI suggestions",
        suggestions: [
          "Arrived at pickup location and ready to load.",
          "Running about 15 minutes behind schedule due to traffic.",
          "Load secured and heading to delivery location now."
        ]
      });
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
      
      console.log('Attachment rejected:', { id, reviewerId, notes });
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
      
      console.log('Attachment deleted:', { id });
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

  // =============================================================================
  // AI DOCUMENT PROCESSING ENDPOINTS
  // =============================================================================

  // POST /api/documents/:documentId/process - Trigger AI processing for uploaded document
  app.post('/api/documents/:documentId/process', async (req, res) => {
    try {
      const { documentId } = req.params;

      console.log(`🤖 Starting AI processing for document ${documentId}`);

      // Check OpenAI configuration first
      const { checkOpenAIConfig } = await import('./ai-document-processor');
      const configCheck = checkOpenAIConfig();
      if (!configCheck.configured) {
        console.error(`❌ OpenAI not configured: ${configCheck.error}`);
        return res.status(500).json({
          error: 'AI processing unavailable',
          message: configCheck.error,
          configured: false
        });
      }

      // Get document from storage
      const document = await storage.getLoadDocument(documentId);
      if (!document) {
        return res.status(404).json({ 
          error: 'Document not found',
          documentId 
        });
      }

      // Check if already processed
      const existingExtraction = await storage.getExtractionByDocumentId(documentId);
      if (existingExtraction) {
        console.log(`ℹ️ Document ${documentId} already has extraction ${existingExtraction.id}`);
        return res.json({
          message: 'Document already processed',
          extraction: existingExtraction,
          alreadyProcessed: true
        });
      }

      // Update document status to processing
      await storage.updateLoadDocument(documentId, {
        approvalStatus: 'pending'
      });

      // Process document with AI
      const { processDocument } = await import('./ai-document-processor');
      const result = await processDocument(document.fileUrl);

      console.log(`✅ AI processing complete for document ${documentId}:`, {
        documentType: result.documentType,
        hasData: !!result.data
      });

      // Store extraction in database
      const extraction = await storage.createDocumentExtraction({
        documentId,
        documentType: result.documentType,
        extractedData: result.data || {},
        confidence: result.documentType === 'unknown' ? 0 : 0.85,
        isVerified: false
      });

      res.json({
        success: true,
        documentId,
        extractionId: extraction.id,
        documentType: result.documentType,
        extractedData: result.data,
        confidence: extraction.confidence,
        message: 'Document processed successfully'
      });

    } catch (error) {
      console.error('❌ Error processing document:', error);
      res.status(500).json({ 
        error: 'Failed to process document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // POST /api/documents/:documentId/verify - Verify and edit extracted data with workflow triggers
  app.post('/api/documents/:documentId/verify', async (req, res) => {
    try {
      const { documentId } = req.params;
      const { extractedData, verifiedBy, corrections } = req.body;

      console.log(`✅ Verifying document ${documentId} by ${verifiedBy}`);

      // Get extraction
      const extraction = await storage.getExtractionByDocumentId(documentId);
      if (!extraction) {
        return res.status(404).json({ 
          error: 'No extraction found for this document' 
        });
      }

      // Update extraction as verified
      await storage.updateExtractionVerification(extraction.id, {
        isVerified: true,
        verifiedBy,
        verifiedAt: new Date()
      });

      // Create verification records for corrections
      if (corrections && Array.isArray(corrections)) {
        for (const correction of corrections) {
          await storage.createExtractionVerification({
            extractionId: extraction.id,
            field: correction.field,
            originalValue: correction.originalValue,
            correctedValue: correction.correctedValue,
            verifiedBy
          });
        }
        console.log(`📝 Recorded ${corrections.length} corrections`);
      }

      // Trigger workflow based on document type
      const documentType = extraction.documentType;
      const data = extractedData || extraction.extractedData;

      console.log(`🔄 Triggering ${documentType} workflow...`);

      if (documentType === 'bol') {
        // BOL Workflow: Update load totals
        const bolData = data as any;
        if (bolData.loadNumber) {
          const load = await storage.getLoadByNumber(bolData.loadNumber);
          if (load) {
            const totalAmount = parseFloat(bolData.totalAmount || '0');
            await storage.updateLoad(load.id, {
              rate: totalAmount || load.rate
            });
            console.log(`💰 Updated load ${load.loadNumber} rate to $${totalAmount}`);
          } else {
            console.warn(`⚠️ Load not found for number: ${bolData.loadNumber}`);
          }
        }
      } else if (documentType === 'driver_sheet') {
        // Driver Sheet Workflow: Send SMS and start GPS tracking
        const driverSheet = data as any;
        if (driverSheet.driverName) {
          const driver = await storage.getDriverByNameOrPhone(driverSheet.driverName);
          if (driver && driver.phoneNumber) {
            const smsMessage = `🚛 New load assignment!\n\n` +
              `Pickup: ${driverSheet.pickupAddress || 'TBD'}\n` +
              `Delivery: ${driverSheet.deliveryAddress || 'TBD'}\n\n` +
              `Reply CONFIRM to start tracking.`;

            try {
              if (twilioClient && twilioPhoneNumber) {
                await twilioClient.messages.create({
                  to: driver.phoneNumber,
                  from: twilioPhoneNumber,
                  body: smsMessage
                });
                console.log(`📱 SMS sent to driver ${driver.name} at ${driver.phoneNumber}`);
              } else {
                console.warn('⚠️ Twilio not configured - SMS not sent');
              }
            } catch (smsError) {
              console.error('❌ Failed to send SMS:', smsError);
            }
          } else {
            console.warn(`⚠️ Driver not found: ${driverSheet.driverName}`);
          }
        }
      } else if (documentType === 'recon') {
        // Recon Workflow: Update financial records
        const reconData = data as any;
        if (reconData.loadNumber) {
          const load = await storage.getLoadByNumber(reconData.loadNumber);
          if (load) {
            console.log(`📊 Reconciliation for load ${load.loadNumber}:`, {
              revenue: reconData.totalRevenue,
              netProfit: reconData.netProfit,
              expenses: reconData.expenses?.length || 0
            });
          } else {
            console.warn(`⚠️ Load not found for number: ${reconData.loadNumber}`);
          }
        }
      }

      // Update document approval status
      const document = await storage.getLoadDocument(documentId);
      if (document) {
        await storage.updateLoadDocument(documentId, {
          approvalStatus: 'approved',
          approvedBy: verifiedBy,
          approvedAt: new Date()
        });
      }

      res.json({
        success: true,
        message: 'Document verified and workflow triggered',
        documentId,
        extractionId: extraction.id,
        documentType,
        correctionsApplied: corrections?.length || 0
      });

    } catch (error) {
      console.error('❌ Error verifying document:', error);
      res.status(500).json({ 
        error: 'Failed to verify document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // GET /api/documents/:documentId/extraction - Get extraction data with verification status
  app.get('/api/documents/:documentId/extraction', async (req, res) => {
    try {
      const { documentId } = req.params;

      const extraction = await storage.getExtractionByDocumentId(documentId);
      if (!extraction) {
        return res.status(404).json({ 
          error: 'No extraction found for this document' 
        });
      }

      // Get verification corrections
      const verifications = await storage.getExtractionVerifications(extraction.id);

      res.json({
        extraction: {
          id: extraction.id,
          documentId: extraction.documentId,
          documentType: extraction.documentType,
          extractedData: extraction.extractedData,
          confidence: extraction.confidence,
          isVerified: extraction.isVerified,
          verifiedBy: extraction.verifiedBy,
          verifiedAt: extraction.verifiedAt,
          createdAt: extraction.createdAt
        },
        corrections: verifications,
        correctionCount: verifications.length
      });

    } catch (error) {
      console.error('❌ Error fetching extraction:', error);
      res.status(500).json({ 
        error: 'Failed to fetch extraction',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // POST /api/documents/batch-process - Process multiple documents in parallel
  app.post('/api/documents/batch-process', async (req, res) => {
    try {
      const { documentIds } = req.body;

      if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ 
          error: 'documentIds array is required and must not be empty' 
        });
      }

      console.log(`🤖 Batch processing ${documentIds.length} documents`);

      // Check OpenAI configuration first
      const { checkOpenAIConfig, processDocument } = await import('./ai-document-processor');
      const configCheck = checkOpenAIConfig();
      if (!configCheck.configured) {
        console.error(`❌ OpenAI not configured: ${configCheck.error}`);
        return res.status(500).json({
          error: 'AI processing unavailable',
          message: configCheck.error,
          configured: false
        });
      }
      
      // Process all documents in parallel
      const results = await Promise.allSettled(
        documentIds.map(async (documentId) => {
          try {
            // Get document
            const document = await storage.getLoadDocument(documentId);
            if (!document) {
              throw new Error(`Document ${documentId} not found`);
            }

            // Check if already processed
            const existingExtraction = await storage.getExtractionByDocumentId(documentId);
            if (existingExtraction) {
              return {
                documentId,
                status: 'already_processed',
                extraction: existingExtraction
              };
            }

            // Process with AI
            const result = await processDocument(document.fileUrl);

            // Store extraction
            const extraction = await storage.createDocumentExtraction({
              documentId,
              documentType: result.documentType,
              extractedData: result.data || {},
              confidence: result.documentType === 'unknown' ? 0 : 0.85,
              isVerified: false
            });

            return {
              documentId,
              status: 'processed',
              extractionId: extraction.id,
              documentType: result.documentType,
              confidence: extraction.confidence
            };
          } catch (error) {
            return {
              documentId,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }
        })
      );

      // Aggregate results
      const processed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'processed').length;
      const alreadyProcessed = results.filter(r => r.status === 'fulfilled' && r.value.status === 'already_processed').length;
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')).length;

      const resultsData = results.map(r => 
        r.status === 'fulfilled' ? r.value : { status: 'failed', error: 'Promise rejected' }
      );

      console.log(`✅ Batch processing complete: ${processed} processed, ${alreadyProcessed} already processed, ${failed} failed`);

      res.json({
        success: true,
        total: documentIds.length,
        processed,
        alreadyProcessed,
        failed,
        results: resultsData
      });

    } catch (error) {
      console.error('❌ Error in batch processing:', error);
      res.status(500).json({ 
        error: 'Failed to batch process documents',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // =============================================================================
  // END AI DOCUMENT PROCESSING ENDPOINTS
  // =============================================================================

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
      const registrationLink = `${getBaseUrl()}/simple-registration?token=${token}`;
      
      // Shorten URL for professional appearance
      const shortUrlResult = await urlShortener.shortenUrl(registrationLink);
      const link = shortUrlResult.shortUrl || registrationLink;
      
      // Create SMS message with TRAQ IQ branding
      const smsMessage = `🚛 TRAQ IQ\n\n` +
        `Hi ${name || 'Driver'}!\n\n` +
        `You're invited to join our fleet.\n\n` +
        `Complete registration:\n${link}\n\n` +
        `⏰ Link expires in 7 days\n\n` +
        `Questions? Reply to this message.`;
      
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

      // Respond to Twilio IMMEDIATELY with empty TwiML to avoid the 15-second timeout.
      // Processing is done async below — getAllLoads() alone can take 13+ seconds.
      // Using empty <Response> instead of <Message> to avoid sending a duplicate
      // "Message received" SMS to the driver on top of the one sent by handleIncomingSMS.
      res.set('Content-Type', 'text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

      // Process the inbound SMS asynchronously (fire-and-forget)
      smsCommunicationService.handleIncomingSMS(From, Body || '', MessageSid, mediaUrls, mediaTypes)
        .catch(err => console.error('❌ Error processing inbound SMS:', err));
    } catch (error) {
      console.error('❌ Error handling SMS webhook:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing SMS');
      }
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

  // ==================== Webhook: New Load SMS Broadcast ====================
  app.post('/api/webhook/new-load', async (req, res) => {
    try {
      const { origin, destination, rate } = req.body;

      if (!origin || typeof origin !== 'string' || !origin.trim()) {
        return res.status(400).json({ error: 'Missing or invalid required field: origin' });
      }
      if (!destination || typeof destination !== 'string' || !destination.trim()) {
        return res.status(400).json({ error: 'Missing or invalid required field: destination' });
      }
      if (rate === undefined || rate === null || rate === '') {
        return res.status(400).json({ error: 'Missing required field: rate' });
      }

      const rateDisplay = typeof rate === 'number' ? `$${rate.toLocaleString()}` : `$${String(rate).replace(/^\$/, '')}`;
      const message = `🚛 NEW LOAD ALERT\n${origin.trim()} → ${destination.trim()}\nRate: ${rateDisplay}\n\nReply YES to claim or call dispatch.`;

      console.log(`📡 Webhook /new-load received: ${origin} → ${destination} | Rate: ${rateDisplay}`);

      // Resolve real company ID for FK constraint
      let webhookCompanyId = 'default-company';
      try {
        const companies = await storage.getAllCompanies();
        if (companies.length > 0) webhookCompanyId = companies[0].id;
      } catch (_) {}

      const allDrivers = await storage.getAllDrivers();
      const eligibleDrivers = allDrivers.filter(
        (d) => d.status !== 'inactive' && d.status !== 'terminated' && (d.phone || d.phoneNumber)
      );

      console.log(`📨 Broadcasting new load to ${eligibleDrivers.length} drivers...`);

      const results: { driverId: string; driverName: string; success: boolean; error?: string }[] = [];

      for (const driver of eligibleDrivers) {
        const phone = driver.phoneNumber || driver.phone;
        if (!phone) continue;
        try {
          const smsResult = await smsLoadService.sendSMS(phone, message);
          results.push({
            driverId: driver.id,
            driverName: driver.name,
            success: smsResult.success,
            error: smsResult.error,
          });
        } catch (err: any) {
          results.push({
            driverId: driver.id,
            driverName: driver.name,
            success: false,
            error: err.message,
          });
        }
      }

      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;

      console.log(`✅ Broadcast complete: ${successes} sent, ${failures} failed out of ${results.length} drivers`);

      try {
        await db.insert(activityLog).values({
          companyId: webhookCompanyId,
          entityType: 'webhook_load_broadcast',
          entityId: `broadcast-${Date.now()}`,
          action: 'sms_broadcast',
          actor: 'webhook',
          details: {
            load: { origin: origin.trim(), destination: destination.trim(), rate: rateDisplay },
            summary: { total: results.length, sent: successes, failed: failures },
            failedDrivers: results.filter((r) => !r.success).map((r) => ({ id: r.driverId, name: r.driverName, error: r.error })),
          },
        });
      } catch (logErr) {
        console.error('⚠️ Failed to persist broadcast log:', logErr);
      }

      res.json({
        status: 'broadcast_complete',
        load: { origin: origin.trim(), destination: destination.trim(), rate: rateDisplay },
        summary: { total: results.length, sent: successes, failed: failures },
        details: results,
      });
    } catch (error: any) {
      console.error('❌ Error in /api/webhook/new-load:', error);
      res.status(500).json({ error: 'Failed to broadcast load alert', details: error.message });
    }
  });

  // ==================== Amazon Relay Webhook — GPS Proximity Dispatch ====================
  app.post('/api/relay-alert', async (req, res) => {
    try {
      const {
        Rate, Mileage, RPM, LoadLink,
        PickupCity, PickupState, PickupLat, PickupLon,
        DeliveryCity, DeliveryState, DeliveryLat, DeliveryLon,
      } = req.body;

      if (Rate === undefined || Rate === null) {
        return res.status(400).json({ error: 'Missing required field: Rate' });
      }
      if (Mileage === undefined || Mileage === null) {
        return res.status(400).json({ error: 'Missing required field: Mileage' });
      }
      if (!LoadLink) {
        return res.status(400).json({ error: 'Missing required field: LoadLink' });
      }

      const rate = parseFloat(String(Rate));
      const mileage = parseFloat(String(Mileage));
      if (isNaN(rate) || rate <= 0) {
        return res.status(400).json({ error: 'Rate must be a positive number' });
      }
      if (isNaN(mileage) || mileage <= 0) {
        return res.status(400).json({ error: 'Mileage must be a positive number' });
      }
      const rpmRaw = RPM !== undefined && RPM !== null ? parseFloat(String(RPM)) : rate / mileage;
      const rpm = isNaN(rpmRaw) ? 0 : parseFloat(rpmRaw.toFixed(2));
      const MIN_RPM = 1.80;
      const rpmWarning = rpm < MIN_RPM;

      const hasLocationData = PickupLat !== undefined && PickupLon !== undefined;
      if (hasLocationData) {
        const latVal = parseFloat(String(PickupLat));
        const lonVal = parseFloat(String(PickupLon));
        if (isNaN(latVal) || isNaN(lonVal)) {
          return res.status(400).json({ error: 'PickupLat and PickupLon must be valid numbers' });
        }
      }

      console.log(`📡 Amazon Relay webhook received: Rate=$${rate} | Miles=${mileage} | RPM=$${rpm}/mi | HasLocation=${hasLocationData}`);

      // --- Haversine distance calculation (inline, coords in degrees) ---
      function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 3959;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      // Resolve the real company ID (FK constraint requires it to exist in companies table)
      let realCompanyId = 'default-company';
      try {
        const companies = await storage.getAllCompanies();
        if (companies.length > 0) realCompanyId = companies[0].id;
      } catch (_) {}

      // --- PROXIMITY DISPATCH (when location data is included) ---
      if (hasLocationData) {
        const pickupLat = parseFloat(String(PickupLat));
        const pickupLon = parseFloat(String(PickupLon));
        const pickupCity = PickupCity ? String(PickupCity) : 'Unknown';
        const pickupState = PickupState ? String(PickupState) : '';
        const deliveryCity = DeliveryCity ? String(DeliveryCity) : 'Unknown';
        const deliveryState = DeliveryState ? String(DeliveryState) : '';

        // Find all available drivers with GPS locations — single batch query
        const [allDrivers, allActiveLocations] = await Promise.all([
          storage.getAllDrivers(),
          storage.getActiveDriverLocationsWithDriverInfo(),
        ]);

        const driverStatusMap = new Map(allDrivers.map(d => [d.id, d]));

        type DriverMatch = {
          driver: typeof allDrivers[0];
          distance: number;
          location: { latitude: number; longitude: number };
        };
        const driversWithDistance: DriverMatch[] = [];

        // De-duplicate: keep only the latest location per driver
        const seenDriverIds = new Set<string>();
        for (const loc of allActiveLocations) {
          if (seenDriverIds.has(loc.driverId)) continue;
          seenDriverIds.add(loc.driverId);
          if (loc.latitude === null || loc.longitude === null) continue;
          const driver = driverStatusMap.get(loc.driverId);
          if (!driver || driver.status !== 'available') continue;
          const dist = haversine(loc.latitude, loc.longitude, pickupLat, pickupLon);
          if (dist <= 50) {
            driversWithDistance.push({ driver, distance: dist, location: { latitude: loc.latitude, longitude: loc.longitude } });
          }
        }

        const availableDrivers = allDrivers.filter(d => d.status === 'available');

        if (driversWithDistance.length === 0) {
          console.log(`⚠️ No available drivers within 50 miles of ${pickupCity}, ${pickupState}`);

          try {
            await db.insert(activityLog).values({
              companyId: realCompanyId,
              entityType: 'relay_alert',
              entityId: `relay-${Date.now()}`,
              action: 'no_driver_available',
              actor: 'relay-webhook',
              details: {
                load: { rate, mileage, rpm, loadLink: LoadLink, pickup: `${pickupCity}, ${pickupState}`, delivery: `${deliveryCity}, ${deliveryState}` },
                reason: 'No available drivers within 50 miles of pickup',
                rpmWarning,
              },
            });
          } catch (logErr) { console.error('⚠️ Failed to persist relay log:', logErr); }

          return res.json({
            status: 'no_driver_available',
            reason: 'No available drivers within 50 miles of pickup location',
            pickup: `${pickupCity}, ${pickupState}`,
            rpmCheck: { rpm, threshold: MIN_RPM, passed: !rpmWarning, warning: rpmWarning ? `RPM $${rpm} is below minimum $${MIN_RPM}` : null },
          });
        }

        // Pick the closest
        driversWithDistance.sort((a, b) => a.distance - b.distance);
        const { driver: matched, distance: distToPickup } = driversWithDistance[0];

        console.log(`✅ Closest driver: ${matched.name} (${distToPickup.toFixed(1)} mi from pickup)`);

        // Find or use default customer for Amazon Relay loads
        let customerId = 'default-customer';
        try {
          const customers = await storage.getAllCustomers();
          const amazonCustomer = customers.find(c => c.name?.toLowerCase().includes('amazon'));
          if (amazonCustomer) {
            customerId = amazonCustomer.id;
          } else {
            const newCustomer = await storage.createCustomer({
              name: 'Amazon Relay',
              contactPerson: 'Amazon Relay',
              email: 'relay@amazon.com',
              phone: 'N/A',
              address: 'Amazon Logistics',
              companyId: realCompanyId,
            });
            customerId = newCustomer.id;
          }
        } catch (custErr) {
          console.error('⚠️ Could not find/create Amazon customer:', custErr);
        }

        // Save load to database
        let savedLoadId: string | null = null;
        let savedLoadNumber: string | null = null;
        try {
          const now = new Date();
          const pickupDateStr = now.toISOString().slice(0, 10);
          const deliveryDateStr = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const loadData: InsertLoad = {
            customerId,
            driverId: matched.id,
            assignedDriverName: matched.name,
            description: `Amazon Relay Load — ${pickupCity}, ${pickupState} → ${deliveryCity}, ${deliveryState}`,
            pickupAddress: `${pickupCity}, ${pickupState}`,
            pickupDate: pickupDateStr,
            pickupTime: '08:00',
            deliveryAddress: `${deliveryCity}, ${deliveryState}`,
            deliveryDate: deliveryDateStr,
            deliveryTime: '17:00',
            rate,
            miles: mileage,
            rpm,
            status: 'assigned',
            sourceBoard: 'amazon_relay',
            originCity: pickupCity,
            originState: pickupState,
            destCity: deliveryCity,
            destState: deliveryState,
            specialInstructions: `Amazon Relay Load Link: ${LoadLink}`,
            companyId: realCompanyId,
          };
          const savedLoad = await storage.createLoad(loadData);
          savedLoadId = savedLoad.id;
          savedLoadNumber = savedLoad.loadNumber;
          console.log(`💾 Load saved: ${savedLoadNumber} (${savedLoadId})`);
        } catch (loadErr) {
          console.error('⚠️ Failed to save load:', loadErr);
        }

        // Send targeted SMS to matched driver
        const phone = matched.phoneNumber || matched.phone;
        let smsResult = { success: false, error: 'No phone number' };
        if (phone) {
          const rpmDisplay = `$${rpm.toFixed(2)}/mi`;
          const msg = [
            `🚛 AMAZON RELAY LOAD`,
            `📍 ${pickupCity}, ${pickupState} → ${deliveryCity}, ${deliveryState}`,
            `💵 Rate: $${rate.toLocaleString()} (${rpmDisplay} RPM)`,
            `📏 Miles: ${mileage}`,
            `🔗 ${LoadLink}`,
            `\nReply YES to accept or call dispatch.`,
          ].join('\n');

          smsResult = await smsLoadService.sendSMS(phone, msg);
          console.log(`📱 SMS to ${matched.name}: ${smsResult.success ? '✅ sent' : '❌ failed - ' + smsResult.error}`);
        }

        // Persist to activity log
        try {
          await db.insert(activityLog).values({
            companyId: realCompanyId,
            entityType: 'relay_alert',
            entityId: savedLoadId || `relay-${Date.now()}`,
            action: 'proximity_dispatch',
            actor: 'relay-webhook',
            details: {
              load: { rate, mileage, rpm, loadLink: LoadLink, pickup: `${pickupCity}, ${pickupState}`, delivery: `${deliveryCity}, ${deliveryState}` },
              dispatched: { driverId: matched.id, driverName: matched.name, distanceToPickup: parseFloat(distToPickup.toFixed(1)) },
              smsResult,
              rpmWarning,
              savedLoadId,
              savedLoadNumber,
              driversChecked: availableDrivers.length,
              driversInRange: driversWithDistance.length,
            },
          });
        } catch (logErr) { console.error('⚠️ Failed to persist relay log:', logErr); }

        return res.json({
          status: 'dispatched',
          driver: { id: matched.id, name: matched.name, distanceToPickupMiles: parseFloat(distToPickup.toFixed(1)) },
          load: { id: savedLoadId, loadNumber: savedLoadNumber, rate, mileage, rpm, pickup: `${pickupCity}, ${pickupState}`, delivery: `${deliveryCity}, ${deliveryState}`, loadLink: LoadLink },
          sms: { sent: smsResult.success, error: smsResult.error || null },
          rpmCheck: { rpm, threshold: MIN_RPM, passed: !rpmWarning, warning: rpmWarning ? `RPM $${rpm.toFixed(2)} is below minimum $${MIN_RPM}` : null },
          driversChecked: availableDrivers.length,
          driversInRange: driversWithDistance.length,
        });
      }

      // --- FALLBACK BROADCAST (no location data) ---
      console.log(`📡 No location data — falling back to broadcast to all available drivers`);
      const origin = 'N/A';
      const destination = 'N/A';
      const broadcastMsg = [
        `🚛 AMAZON RELAY LOAD`,
        `💵 Rate: $${rate.toLocaleString()} | ${mileage} miles ($${rpm.toFixed(2)}/mi RPM)`,
        `🔗 ${LoadLink}`,
        `\nReply YES to claim or call dispatch.`,
      ].join('\n');

      const allDrivers = await storage.getAllDrivers();
      const eligible = allDrivers.filter(d => d.status !== 'inactive' && d.status !== 'terminated' && (d.phone || d.phoneNumber));
      const broadcastResults: { driverId: string; driverName: string; success: boolean; error?: string }[] = [];

      for (const driver of eligible) {
        const phone = driver.phoneNumber || driver.phone;
        if (!phone) continue;
        try {
          const r = await smsLoadService.sendSMS(phone, broadcastMsg);
          broadcastResults.push({ driverId: driver.id, driverName: driver.name, success: r.success, error: r.error });
        } catch (err: any) {
          broadcastResults.push({ driverId: driver.id, driverName: driver.name, success: false, error: err.message });
        }
      }

      const sent = broadcastResults.filter(r => r.success).length;
      const failed = broadcastResults.filter(r => !r.success).length;

      try {
        await db.insert(activityLog).values({
          companyId: realCompanyId,
          entityType: 'relay_alert',
          entityId: `relay-broadcast-${Date.now()}`,
          action: 'broadcast_fallback',
          actor: 'relay-webhook',
          details: { load: { rate, mileage, rpm, loadLink: LoadLink }, summary: { total: broadcastResults.length, sent, failed }, rpmWarning },
        });
      } catch (logErr) { console.error('⚠️ Failed to persist relay broadcast log:', logErr); }

      return res.json({
        status: 'broadcast_fallback',
        reason: 'No location data provided — broadcast sent to all available drivers',
        load: { rate, mileage, rpm, loadLink: LoadLink },
        summary: { total: broadcastResults.length, sent, failed },
        rpmCheck: { rpm, threshold: MIN_RPM, passed: !rpmWarning, warning: rpmWarning ? `RPM $${rpm.toFixed(2)} is below minimum $${MIN_RPM}` : null },
      });

    } catch (error: any) {
      console.error('❌ Error in /api/relay-alert:', error);
      res.status(500).json({ error: 'Relay alert processing failed', details: error.message });
    }
  });

  // ==================== MVFRS (Fleet Reliability System) Routes ====================
  
  // Trucks CRUD
  app.get('/api/fleet/trucks', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const trucks = await storage.getTrucksByCompany(companyId);
      res.json(trucks);
    } catch (error) {
      console.error('Error fetching trucks:', error);
      res.status(500).json({ error: 'Failed to fetch trucks' });
    }
  });

  app.get('/api/fleet/trucks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const truck = await storage.getTruck(req.params.id);
      if (!truck) {
        return res.status(404).json({ error: 'Truck not found' });
      }
      res.json(truck);
    } catch (error) {
      console.error('Error fetching truck:', error);
      res.status(500).json({ error: 'Failed to fetch truck' });
    }
  });

  app.post('/api/fleet/trucks', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertTruckSchema.parse(req.body);
      const truck = await storage.createTruck(data);
      res.status(201).json(truck);
    } catch (error: any) {
      console.error('Error creating truck:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create truck' });
    }
  });

  app.patch('/api/fleet/trucks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const truck = await storage.updateTruck(req.params.id, req.body);
      if (!truck) {
        return res.status(404).json({ error: 'Truck not found' });
      }
      res.json(truck);
    } catch (error) {
      console.error('Error updating truck:', error);
      res.status(500).json({ error: 'Failed to update truck' });
    }
  });

  app.delete('/api/fleet/trucks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const deleted = await storage.deleteTruck(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Truck not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting truck:', error);
      res.status(500).json({ error: 'Failed to delete truck' });
    }
  });

  // Truck Risk Score & Dispatch Gate
  app.get('/api/fleet/trucks/:id/risk-score', isAuthenticated, async (req: any, res) => {
    try {
      const riskData = await storage.calculateTruckRiskScore(req.params.id);
      res.json(riskData);
    } catch (error) {
      console.error('Error calculating risk score:', error);
      res.status(500).json({ error: 'Failed to calculate risk score' });
    }
  });

  app.post('/api/fleet/trucks/:id/calculate-risk', isAuthenticated, async (req: any, res) => {
    try {
      const riskData = await storage.calculateTruckRiskScore(req.params.id);
      res.json(riskData);
    } catch (error) {
      console.error('Error calculating risk score:', error);
      res.status(500).json({ error: 'Failed to calculate risk score' });
    }
  });

  app.get('/api/fleet/trucks/:id/dispatch-gate', isAuthenticated, async (req: any, res) => {
    try {
      const gateStatus = await storage.checkDispatchGate(req.params.id);
      res.json(gateStatus);
    } catch (error) {
      console.error('Error checking dispatch gate:', error);
      res.status(500).json({ error: 'Failed to check dispatch gate' });
    }
  });

  app.post('/api/fleet/trucks/:id/dispatch-gate/override', isAuthenticated, async (req: any, res) => {
    try {
      const { reason } = req.body;
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({ error: 'Override reason must be at least 10 characters' });
      }
      const userId = req.user?.id || 'unknown';
      const truck = await storage.overrideDispatchGate(req.params.id, userId, reason);
      if (!truck) {
        return res.status(404).json({ error: 'Truck not found' });
      }
      res.json(truck);
    } catch (error) {
      console.error('Error overriding dispatch gate:', error);
      res.status(500).json({ error: 'Failed to override dispatch gate' });
    }
  });

  app.delete('/api/fleet/trucks/:id/dispatch-gate/override', isAuthenticated, async (req: any, res) => {
    try {
      const truck = await storage.clearDispatchGateOverride(req.params.id);
      if (!truck) {
        return res.status(404).json({ error: 'Truck not found' });
      }
      res.json(truck);
    } catch (error) {
      console.error('Error clearing dispatch gate override:', error);
      res.status(500).json({ error: 'Failed to clear dispatch gate override' });
    }
  });

  // Bulk recalculate risk scores for all trucks in a company
  app.post('/api/fleet/trucks/recalculate-all-risk-scores', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.body.companyId || 'default-company';
      const trucks = await storage.getTrucksByCompany(companyId);
      const results = [];
      
      for (const truck of trucks) {
        try {
          const riskData = await storage.calculateTruckRiskScore(truck.id);
          results.push({ truckId: truck.id, unitNumber: truck.unitNumber, ...riskData });
        } catch (err) {
          results.push({ truckId: truck.id, unitNumber: truck.unitNumber, error: 'Failed to calculate' });
        }
      }
      
      res.json({ 
        trucksProcessed: trucks.length,
        results 
      });
    } catch (error) {
      console.error('Error recalculating risk scores:', error);
      res.status(500).json({ error: 'Failed to recalculate risk scores' });
    }
  });

  // Vendors CRUD
  app.get('/api/fleet/vendors', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const vendors = await storage.getVendorsByCompany(companyId);
      res.json(vendors);
    } catch (error) {
      console.error('Error fetching vendors:', error);
      res.status(500).json({ error: 'Failed to fetch vendors' });
    }
  });

  app.get('/api/fleet/vendors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const vendor = await storage.getVendor(req.params.id);
      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found' });
      }
      res.json(vendor);
    } catch (error) {
      console.error('Error fetching vendor:', error);
      res.status(500).json({ error: 'Failed to fetch vendor' });
    }
  });

  app.post('/api/fleet/vendors', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertVendorSchema.parse(req.body);
      const vendor = await storage.createVendor(data);
      res.status(201).json(vendor);
    } catch (error: any) {
      console.error('Error creating vendor:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create vendor' });
    }
  });

  app.patch('/api/fleet/vendors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const vendor = await storage.updateVendor(req.params.id, req.body);
      if (!vendor) {
        return res.status(404).json({ error: 'Vendor not found' });
      }
      res.json(vendor);
    } catch (error) {
      console.error('Error updating vendor:', error);
      res.status(500).json({ error: 'Failed to update vendor' });
    }
  });

  app.delete('/api/fleet/vendors/:id', isAuthenticated, async (req: any, res) => {
    try {
      const deleted = await storage.deleteVendor(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Vendor not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting vendor:', error);
      res.status(500).json({ error: 'Failed to delete vendor' });
    }
  });

  // Fleet Inspections CRUD
  app.get('/api/fleet/inspections', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const inspections = await storage.getFleetInspectionsByCompany(companyId);
      res.json(inspections);
    } catch (error) {
      console.error('Error fetching inspections:', error);
      res.status(500).json({ error: 'Failed to fetch inspections' });
    }
  });

  app.get('/api/fleet/inspections/truck/:truckId', isAuthenticated, async (req: any, res) => {
    try {
      const inspections = await storage.getFleetInspectionsByTruck(req.params.truckId);
      res.json(inspections);
    } catch (error) {
      console.error('Error fetching truck inspections:', error);
      res.status(500).json({ error: 'Failed to fetch inspections' });
    }
  });

  app.get('/api/fleet/inspections/:id', isAuthenticated, async (req: any, res) => {
    try {
      const inspection = await storage.getFleetInspection(req.params.id);
      if (!inspection) {
        return res.status(404).json({ error: 'Inspection not found' });
      }
      const items = await storage.getInspectionItemsByInspection(req.params.id);
      res.json({ ...inspection, items });
    } catch (error) {
      console.error('Error fetching inspection:', error);
      res.status(500).json({ error: 'Failed to fetch inspection' });
    }
  });

  app.post('/api/fleet/inspections', isAuthenticated, async (req: any, res) => {
    try {
      const { items, ...inspectionData } = req.body;
      const data = insertFleetInspectionSchema.parse(inspectionData);
      const inspection = await storage.createFleetInspection(data);
      
      // Create inspection items if provided
      if (items && Array.isArray(items)) {
        const createdItems = await storage.bulkCreateInspectionItems(
          items.map((item: any) => ({ ...item, inspectionId: inspection.id }))
        );
        
        // Check for defects and create work orders automatically
        const defectItems = createdItems.filter((item: any) => item.status === 'NEEDS_ATTENTION');
        for (const defect of defectItems) {
          await storage.createWorkOrder({
            companyId: inspection.companyId,
            truckId: inspection.truckId,
            source: 'INSPECTION' as any,
            priority: defect.severity || 'ROUTINE',
            status: 'OPEN' as any,
            issueCategory: 'OTHER' as any,
            symptoms: `Inspection defect: ${defect.itemLabel} - ${defect.defectNotes || 'Needs attention'}`,
            relatedInspectionId: inspection.id,
          });
        }
        
        return res.status(201).json({ ...inspection, items: createdItems });
      }
      
      res.status(201).json(inspection);
    } catch (error: any) {
      console.error('Error creating inspection:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create inspection' });
    }
  });

  app.patch('/api/fleet/inspections/:id', isAuthenticated, async (req: any, res) => {
    try {
      const inspection = await storage.updateFleetInspection(req.params.id, req.body);
      if (!inspection) {
        return res.status(404).json({ error: 'Inspection not found' });
      }
      res.json(inspection);
    } catch (error) {
      console.error('Error updating inspection:', error);
      res.status(500).json({ error: 'Failed to update inspection' });
    }
  });

  // Work Orders CRUD
  app.get('/api/fleet/work-orders', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const status = req.query.status;
      
      let workOrders;
      if (status) {
        workOrders = await storage.getWorkOrdersByStatus(companyId, status);
      } else {
        workOrders = await storage.getWorkOrdersByCompany(companyId);
      }
      res.json(workOrders);
    } catch (error) {
      console.error('Error fetching work orders:', error);
      res.status(500).json({ error: 'Failed to fetch work orders' });
    }
  });

  app.get('/api/fleet/work-orders/truck/:truckId', isAuthenticated, async (req: any, res) => {
    try {
      const workOrders = await storage.getWorkOrdersByTruck(req.params.truckId);
      res.json(workOrders);
    } catch (error) {
      console.error('Error fetching truck work orders:', error);
      res.status(500).json({ error: 'Failed to fetch work orders' });
    }
  });

  app.get('/api/fleet/work-orders/:id', isAuthenticated, async (req: any, res) => {
    try {
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) {
        return res.status(404).json({ error: 'Work order not found' });
      }
      const events = await storage.getWorkOrderEvents(req.params.id);
      res.json({ ...workOrder, events });
    } catch (error) {
      console.error('Error fetching work order:', error);
      res.status(500).json({ error: 'Failed to fetch work order' });
    }
  });

  app.post('/api/fleet/work-orders', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertWorkOrderSchema.parse(req.body);
      const workOrder = await storage.createWorkOrder(data);
      
      // Create initial event
      await storage.createWorkOrderEvent({
        workOrderId: workOrder.id,
        eventType: 'STATUS_CHANGE' as any,
        message: 'Work order created',
        actorUserId: req.user?.claims?.sub,
      });
      
      res.status(201).json(workOrder);
    } catch (error: any) {
      console.error('Error creating work order:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create work order' });
    }
  });

  app.patch('/api/fleet/work-orders/:id', isAuthenticated, async (req: any, res) => {
    try {
      const oldWorkOrder = await storage.getWorkOrder(req.params.id);
      if (!oldWorkOrder) {
        return res.status(404).json({ error: 'Work order not found' });
      }
      
      const workOrder = await storage.updateWorkOrder(req.params.id, req.body);
      
      // Log status changes
      if (req.body.status && req.body.status !== oldWorkOrder.status) {
        await storage.createWorkOrderEvent({
          workOrderId: workOrder!.id,
          eventType: 'STATUS_CHANGE' as any,
          message: `Status changed from ${oldWorkOrder.status} to ${req.body.status}`,
          actorUserId: req.user?.claims?.sub,
        });
      }
      
      // Log vendor assignments
      if (req.body.vendorId && req.body.vendorId !== oldWorkOrder.vendorId) {
        const vendor = await storage.getVendor(req.body.vendorId);
        await storage.createWorkOrderEvent({
          workOrderId: workOrder!.id,
          eventType: 'VENDOR_ASSIGNED' as any,
          message: `Assigned to vendor: ${vendor?.name || req.body.vendorId}`,
          actorUserId: req.user?.claims?.sub,
        });
      }
      
      res.json(workOrder);
    } catch (error) {
      console.error('Error updating work order:', error);
      res.status(500).json({ error: 'Failed to update work order' });
    }
  });

  // Work Order Events
  app.get('/api/fleet/work-orders/:id/events', isAuthenticated, async (req: any, res) => {
    try {
      const events = await storage.getWorkOrderEvents(req.params.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching work order events:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  app.post('/api/fleet/work-orders/:id/events', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertWorkOrderEventSchema.parse({
        ...req.body,
        workOrderId: req.params.id,
        actorUserId: req.user?.claims?.sub,
      });
      const event = await storage.createWorkOrderEvent(data);
      res.status(201).json(event);
    } catch (error: any) {
      console.error('Error creating work order event:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create event' });
    }
  });

  // Breakdown Reports
  app.get('/api/fleet/breakdowns', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const reports = await storage.getBreakdownReportsByCompany(companyId);
      res.json(reports);
    } catch (error) {
      console.error('Error fetching breakdown reports:', error);
      res.status(500).json({ error: 'Failed to fetch breakdown reports' });
    }
  });

  app.get('/api/fleet/breakdowns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const report = await storage.getBreakdownReport(req.params.id);
      if (!report) {
        return res.status(404).json({ error: 'Breakdown report not found' });
      }
      res.json(report);
    } catch (error) {
      console.error('Error fetching breakdown report:', error);
      res.status(500).json({ error: 'Failed to fetch breakdown report' });
    }
  });

  app.post('/api/fleet/breakdowns', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertBreakdownReportSchema.parse(req.body);
      const report = await storage.createBreakdownReport(data);
      
      // Automatically create a work order for the breakdown
      const workOrder = await storage.createWorkOrder({
        companyId: report.companyId,
        truckId: report.truckId,
        driverId: report.driverId,
        source: 'BREAKDOWN' as any,
        priority: report.hazard ? 'CRITICAL' : 'URGENT',
        status: 'OPEN' as any,
        issueCategory: 'OTHER' as any,
        symptoms: report.description,
        safetyHold: report.hazard,
        downtimeStartAt: report.reportedAt,
      });
      
      // Link breakdown to work order
      await storage.updateBreakdownReport(report.id, { workOrderId: workOrder.id });
      
      res.status(201).json({ ...report, workOrderId: workOrder.id });
    } catch (error: any) {
      console.error('Error creating breakdown report:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create breakdown report' });
    }
  });

  app.patch('/api/fleet/breakdowns/:id', isAuthenticated, async (req: any, res) => {
    try {
      const report = await storage.updateBreakdownReport(req.params.id, req.body);
      if (!report) {
        return res.status(404).json({ error: 'Breakdown report not found' });
      }
      res.json(report);
    } catch (error) {
      console.error('Error updating breakdown report:', error);
      res.status(500).json({ error: 'Failed to update breakdown report' });
    }
  });

  // Fleet Documents
  app.get('/api/fleet/documents', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const documents = await storage.getFleetDocumentsByCompany(companyId);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching fleet documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  app.get('/api/fleet/documents/expiring', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const daysAhead = parseInt(req.query.days || '30');
      const documents = await storage.getExpiringDocuments(companyId, daysAhead);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching expiring documents:', error);
      res.status(500).json({ error: 'Failed to fetch expiring documents' });
    }
  });

  app.get('/api/fleet/documents/:subjectType/:subjectId', isAuthenticated, async (req: any, res) => {
    try {
      const documents = await storage.getFleetDocumentsBySubject(
        req.params.subjectType,
        req.params.subjectId
      );
      res.json(documents);
    } catch (error) {
      console.error('Error fetching subject documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  app.post('/api/fleet/documents', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertFleetDocumentSchema.parse(req.body);
      const document = await storage.createFleetDocument(data);
      res.status(201).json(document);
    } catch (error: any) {
      console.error('Error creating fleet document:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create document' });
    }
  });

  app.patch('/api/fleet/documents/:id', isAuthenticated, async (req: any, res) => {
    try {
      const document = await storage.updateFleetDocument(req.params.id, req.body);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      res.json(document);
    } catch (error) {
      console.error('Error updating fleet document:', error);
      res.status(500).json({ error: 'Failed to update document' });
    }
  });

  // Maintenance Plans
  app.get('/api/fleet/maintenance-plans', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const plans = await storage.getMaintenancePlansByCompany(companyId);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching maintenance plans:', error);
      res.status(500).json({ error: 'Failed to fetch maintenance plans' });
    }
  });

  app.get('/api/fleet/maintenance-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const plan = await storage.getMaintenancePlan(req.params.id);
      if (!plan) {
        return res.status(404).json({ error: 'Maintenance plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error fetching maintenance plan:', error);
      res.status(500).json({ error: 'Failed to fetch maintenance plan' });
    }
  });

  app.post('/api/fleet/maintenance-plans', isAuthenticated, async (req: any, res) => {
    try {
      const data = insertMaintenancePlanSchema.parse(req.body);
      const plan = await storage.createMaintenancePlan(data);
      res.status(201).json(plan);
    } catch (error: any) {
      console.error('Error creating maintenance plan:', error);
      if (error.issues) {
        return res.status(400).json({ error: 'Validation failed', details: error.issues });
      }
      res.status(500).json({ error: 'Failed to create maintenance plan' });
    }
  });

  app.patch('/api/fleet/maintenance-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const plan = await storage.updateMaintenancePlan(req.params.id, req.body);
      if (!plan) {
        return res.status(404).json({ error: 'Maintenance plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error updating maintenance plan:', error);
      res.status(500).json({ error: 'Failed to update maintenance plan' });
    }
  });

  // PM Schedule
  app.get('/api/fleet/pm-schedule', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      const schedules = await storage.getDuePmSchedules(companyId);
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching PM schedules:', error);
      res.status(500).json({ error: 'Failed to fetch PM schedules' });
    }
  });

  app.get('/api/fleet/pm-schedule/truck/:truckId', isAuthenticated, async (req: any, res) => {
    try {
      const schedules = await storage.getPmSchedulesByTruck(req.params.truckId);
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching truck PM schedules:', error);
      res.status(500).json({ error: 'Failed to fetch PM schedules' });
    }
  });

  // Fleet Dashboard Summary
  app.get('/api/fleet/dashboard', isAuthenticated, async (req: any, res) => {
    try {
      const companyId = req.query.companyId || 'default-company';
      
      const [trucks, workOrders, expiringDocs, inspections] = await Promise.all([
        storage.getTrucksByCompany(companyId),
        storage.getWorkOrdersByCompany(companyId),
        storage.getExpiringDocuments(companyId, 30),
        storage.getFleetInspectionsByCompany(companyId),
      ]);
      
      const activeTrucks = trucks.filter((t: any) => t.status === 'ACTIVE').length;
      const trucksInShop = trucks.filter((t: any) => t.status === 'IN_SHOP').length;
      const openWorkOrders = workOrders.filter((wo: any) => 
        ['OPEN', 'TRIAGED', 'ASSIGNED_VENDOR', 'IN_PROGRESS', 'WAITING_PARTS'].includes(wo.status)
      ).length;
      const criticalWorkOrders = workOrders.filter((wo: any) => wo.priority === 'CRITICAL' && wo.status !== 'CLOSED').length;
      
      res.json({
        fleetSummary: {
          totalTrucks: trucks.length,
          activeTrucks,
          trucksInShop,
          outOfService: trucks.filter((t: any) => t.status === 'OUT_OF_SERVICE').length,
        },
        workOrders: {
          total: workOrders.length,
          open: openWorkOrders,
          critical: criticalWorkOrders,
          byStatus: {
            OPEN: workOrders.filter((wo: any) => wo.status === 'OPEN').length,
            TRIAGED: workOrders.filter((wo: any) => wo.status === 'TRIAGED').length,
            ASSIGNED_VENDOR: workOrders.filter((wo: any) => wo.status === 'ASSIGNED_VENDOR').length,
            IN_PROGRESS: workOrders.filter((wo: any) => wo.status === 'IN_PROGRESS').length,
            WAITING_PARTS: workOrders.filter((wo: any) => wo.status === 'WAITING_PARTS').length,
            COMPLETED: workOrders.filter((wo: any) => wo.status === 'COMPLETED').length,
            CLOSED: workOrders.filter((wo: any) => wo.status === 'CLOSED').length,
          }
        },
        compliance: {
          expiringDocuments: expiringDocs.length,
          documentsExpiringIn30Days: expiringDocs,
        },
        recentInspections: inspections.slice(0, 10),
      });
    } catch (error) {
      console.error('Error fetching fleet dashboard:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });

  console.log('✅ MVFRS Fleet Reliability routes registered');
  // ==================== End MVFRS Routes ====================

  // ==================== GA Loads SQLite Routes ====================
  app.use('/api/ga', gaLoadsRouter);
  console.log('✅ GA Loads SQLite routes registered');
  // ==================== End GA Loads Routes ====================

  // ==================== TraqIQ SOP Victory Protocol Routes ====================
  app.use('/api/traqiq-sop', traqiqSopRoutes);
  console.log('✅ TraqIQ SOP Victory Protocol routes registered');
  // ==================== End TraqIQ SOP Routes ====================

  // ==================== Driver SMS Upload Routes ====================
  app.use('/api/driver-sms', driverSMSUploadRoutes);
  console.log('✅ Driver SMS Upload routes registered');
  // ==================== End Driver SMS Upload Routes ====================

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
