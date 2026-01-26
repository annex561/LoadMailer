import { storage } from './storage';
import { randomUUID } from 'crypto';
import { canHandleEquipmentType } from '@shared/equipment-types';
import type { LoadWithRelations, Driver, SmsConfig, LoadOffer } from '@shared/schema';

// Twilio SMS imports
import twilio from 'twilio';

interface SMSMessage {
  to: string;
  body: string;
}

interface DriverMatch {
  driver: Driver;
  matchScore: number;
  distance: number;
}

export class SMSLoadService {
  private isConfigured = false;
  private isRunning = false;
  private config: SmsConfig | null = null;
  private twilioClient: any = null;
  private twilioPhoneNumber: string = '';
  private twilioMessagingServiceSid: string = '';
  
  constructor() {
    // Initialize Twilio if credentials are available
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '';
    this.twilioMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
    
    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
      this.isConfigured = true;
      console.log('✅ SMS service initialized with Twilio');
      if (this.twilioMessagingServiceSid) {
        console.log(`✅ Using Messaging Service SID: ${this.twilioMessagingServiceSid}`);
      } else {
        console.log('⚠️ No Messaging Service SID - using direct phone number (may have delivery issues)');
      }
    } else {
      console.log('⚠️ SMS service not configured - missing Twilio credentials');
    }
  }

  async initializeLoadService(): Promise<void> {
    if (!this.isConfigured) {
      console.log('⚠️ SMS Load Dispatcher not available - Twilio not configured');
      return;
    }
    console.log('✅ SMS Load Dispatcher ready');
  }

  async sendSMS(toOrParams: string | { to: string, body: string }, bodyParam?: string): Promise<{ success: boolean, error?: string, messageSid?: string }> {
    // Handle both calling patterns: sendSMS(to, body) or sendSMS({ to, body })
    const to = typeof toOrParams === 'string' ? toOrParams : toOrParams.to;
    const body = typeof toOrParams === 'string' ? bodyParam! : toOrParams.body;
    
    if (!this.isConfigured || !this.twilioClient) {
      console.log(`[SMS NOT CONFIGURED] Would send to ${to}: ${body}`);
      return { success: false, error: 'SMS service not configured' };
    }

    try {
      // Normalize phone number
      const normalizedPhone = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
      
      // Build message params - use Messaging Service SID if available, otherwise use phone number
      const messageParams: any = {
        body: body,
        to: normalizedPhone
      };

      // Get the base URL for status callbacks
      const customDomain = process.env.CUSTOM_DOMAIN || 'traqiqs.io';
      const replitDomain = process.env.REPL_SLUG 
        ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
        : process.env.REPLIT_DEV_DOMAIN;
      
      const domain = replitDomain || customDomain;
      const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;
      
      // Prefer Messaging Service SID (required for A2P 10DLC compliance)
      if (this.twilioMessagingServiceSid) {
        messageParams.messagingServiceSid = this.twilioMessagingServiceSid;
        messageParams.statusCallback = `${baseUrl}/api/sms/status-callback`;
      } else {
        // Fallback to direct phone number
        messageParams.from = this.twilioPhoneNumber;
      }
      
      const message = await this.twilioClient.messages.create(messageParams);
      
      console.log(`✅ SMS sent to ${normalizedPhone} (SID: ${message.sid}): ${body.substring(0, 50)}...`);
      return { success: true, messageSid: message.sid };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to send SMS to ${to}:`, error);
      return { success: false, error: errorMsg };
    }
  }

  async sendLoadOffer(load: LoadWithRelations, driver: Driver): Promise<void> {
    console.log(`[SMS DISABLED] Would send load ${load.id} to ${driver.name}`);
    return;
  }

  async processSMSCommand(from: string, command: string): Promise<string> {
    console.log(`[SMS DISABLED] Command from ${from}: ${command}`);
    return 'SMS service is disabled';
  }

  async sendLoadOfferToEligibleDrivers(load: LoadWithRelations): Promise<void> {
    console.log(`[SMS DISABLED] Would process load ${load.id}`);
    return;
  }

  async handleSMSWebhook(from: string, body: string): Promise<string> {
    console.log(`[SMS DISABLED] Webhook from ${from}: ${body}`);
    return 'SMS service is disabled';
  }

  getServiceStatus(): { 
    isConfigured: boolean; 
    isRunning: boolean; 
    phoneNumbers: string[];
    config: SmsConfig | null;
  } {
    return {
      isConfigured: this.isConfigured,
      isRunning: this.isRunning,
      phoneNumbers: this.twilioPhoneNumber ? [this.twilioPhoneNumber] : [],
      config: this.config
    };
  }

  // Public method to check if service is configured
  isServiceConfigured(): boolean {
    return this.isConfigured;
  }

  // Public method to check if load service is running
  isLoadServiceRunning(): boolean {
    return this.isRunning;
  }

  // Stub methods to maintain interface compatibility
  async initializeSmsConfig(): Promise<void> {
    return;
  }

  async initializeDefaultData(): Promise<void> {
    return;
  }

  async processLoadBatch(loads: LoadWithRelations[]): Promise<void> {
    console.log(`[SMS DISABLED] Would process batch of ${loads.length} loads`);
    return;
  }

  // Add missing processNewLoad method that google-sheets-simple.ts expects
  async processNewLoad(load: any): Promise<boolean> {
    console.log(`[SMS DISABLED] Would process new load ${load?.loadNumber || load?.id}`);
    return false; // Return false as if no notifications were sent
  }

  // THE "PLEASE CONFIRM" MESSAGE (Sent immediately when you Book)
  async sendBookingRequest(load: any, driver: any): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!driver || !driver.phone) {
      console.log(`[SMS] No phone for driver, skipping booking request`);
      return { success: false, error: 'No driver phone' };
    }

    const body = `
🚨 NEW LOAD ASSIGNMENT
------------------
Load #${load.loadNumber || load.load_number || 'TBD'}
Rate: $${load.rate || load.rate_total || 0}
Trip: ${load.originCity || load.origin_city || 'TBD'} ➝ ${load.destCity || load.dest_city || 'TBD'}

Reply "YES" to confirm and receive address details.
`.trim();

    return this.sendSMS(driver.phone, body);
  }

  // THE "INSTRUCTIONS & TRACKING" MESSAGE (Sent after Confirmation)
  async sendDispatchInstructions(load: any, driver: any): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!driver || !driver.phone) {
      console.log(`[SMS] No phone for driver, skipping dispatch instructions`);
      return { success: false, error: 'No driver phone' };
    }

    // CHECK: Do we have the address? (Driver Sheet logic)
    const originCity = load.originCity || load.origin_city;
    const destCity = load.destCity || load.dest_city;
    const hasAddress = originCity && originCity !== "Unknown";
    
    let details = "";
    if (hasAddress) {
      details = `
📍 PICKUP:
${originCity}
${load.pickupDate || load.pickup_dt || 'TBD'}

📍 DELIVERY:
${destCity}
${load.deliveryDate || load.delivery_dt || 'TBD'}
`.trim();
    } else {
      details = "⚠️ Addresses pending. Stand by for Driver Sheet.";
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
      : 'https://traq-iq.replit.app';
    const trackingLink = `${baseUrl}/driver/tracking/${load.id}`;

    const body = `
✅ CONFIRMED. Thank you!

${details}

PLEASE ACTIVATE TRACKING NOW:
${trackingLink}
`.trim();

    return this.sendSMS(driver.phone, body);
  }
}

// Export singleton instance
export const smsLoadService = new SMSLoadService();
export const smsService = smsLoadService; // Compatibility alias