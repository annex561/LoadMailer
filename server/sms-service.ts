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

/**
 * Appends "👤 My Dashboard: <link>" to outbound SMS when the recipient is a
 * registered driver and the body doesn't already contain a personal portal URL.
 * This is the single source of truth so every driver-bound SMS carries a
 * one-tap link back to their dashboard.
 *
 * The footer is skipped when:
 *   - recipient phone doesn't match any driver row
 *   - driver has no trackingToken (one will be auto-minted at dispatch time)
 *   - body already contains /driver/ /my-pay/ /u/ or /statements/ — avoids
 *     doubling up when the calling code constructed its own portal link.
 */
async function appendDriverPortalFooter(phone: string, body: string): Promise<string> {
  try {
    if (!phone || !body) return body;
    if (/\/(driver|my-pay|u|statements)\//.test(body)) return body;

    // Normalize phone to E.164-ish so it matches however we stored it
    const digits = phone.replace(/\D/g, '');
    const e164 = phone.startsWith('+') ? phone : `+1${digits}`;

    const { db } = await import('./db');
    const { drivers } = await import('@shared/schema');
    const { or, eq } = await import('drizzle-orm');

    const [driver] = await db
      .select()
      .from(drivers)
      .where(or(eq(drivers.phone, phone), eq(drivers.phone, e164), eq(drivers.phone, digits)))
      .limit(1);

    if (!driver || !driver.trackingToken) return body;

    const baseUrl = process.env.CUSTOM_DOMAIN || process.env.PUBLIC_URL || 'https://traqiq.app';
    const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
    return `${body}\n\n👤 My Dashboard: ${normalizedBase}/driver/${driver.trackingToken}`;
  } catch (err) {
    // Footer is best-effort; never break message delivery.
    return body;
  }
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
    let body = typeof toOrParams === 'string' ? bodyParam! : toOrParams.body;

    // Auto-append driver portal footer when the recipient is a known driver.
    // Dedup: skip if the message already links to /driver/ /my-pay/ /u/ /statements.
    body = await appendDriverPortalFooter(to, body);

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

    // Helper to format dates nicely
    const formatDate = (dateVal: any): string => {
      if (!dateVal) return 'TBD';
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return 'TBD';
        // Format: "Wed, Jan 28 @ 8:00 AM"
        const options: Intl.DateTimeFormatOptions = { 
          weekday: 'short', 
          month: 'short', 
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        };
        return d.toLocaleString('en-US', options);
      } catch {
        return 'TBD';
      }
    };

    // Use FULL addresses if available, fallback to city names
    const pickupAddr = load.pickupAddress || load.pickup_address || load.originCity || load.origin_city || 'TBD';
    const deliveryAddr = load.deliveryAddress || load.delivery_address || load.destCity || load.dest_city || 'TBD';
    const hasAddress = pickupAddr && pickupAddr !== "Unknown" && pickupAddr !== "Address TBD";
    
    let details = "";
    if (hasAddress) {
      details = `
📍 PICKUP:
${pickupAddr}
${formatDate(load.pickupDate || load.pickup_dt)}

📍 DELIVERY:
${deliveryAddr}
${formatDate(load.deliveryDate || load.delivery_dt)}
`.trim();
    } else {
      details = "⚠️ Addresses pending. Stand by for Driver Sheet.";
    }

    const baseUrl = process.env.CUSTOM_DOMAIN || 'https://traqiq.app';
    // Tracking token lives on DRIVER, not load. Ensure one exists — without it /driver-tracker can't authenticate.
    let trackingToken: string = driver.trackingToken || driver.tracking_token || '';
    if (!trackingToken && driver.id) {
      try {
        const { storage } = await import('./storage');
        const gen = await storage.generateTrackingToken(driver.id);
        trackingToken = gen?.token || '';
      } catch (e: any) {
        console.warn('[SMS] failed to mint tracking token:', e?.message || e);
      }
    }
    const trackingLink = `${baseUrl}/driver-tracker?driver=${driver.id || load.driverId || load.driver_id || ''}&token=${trackingToken}`;

    const specialInstructions = load.specialInstructions || load.special_instructions || load.notes || '';
    const brokerContact = load.brokerPhone || load.broker_phone
      ? `\n📞 BROKER: ${load.brokerName || load.broker_name || 'Broker'} — ${load.brokerPhone || load.broker_phone}`
      : '';

    const rate  = load.rate || load.rate_total;
    const miles = load.miles;
    const rpm   = (rate && miles && miles > 0) ? (rate / miles).toFixed(2) : null;
    const payLine = rate
      ? `💰 PAY: $${Number(rate).toLocaleString()}${rpm ? ` ($${rpm}/mi)` : ''}${miles ? ` | ${miles} miles` : ''}`
      : '';

    const body = `
✅ LOAD CONFIRMED — DISPATCH INSTRUCTIONS
${payLine ? `\n${payLine}` : ''}

${details}
${brokerContact}${specialInstructions ? `\n\n📋 SPECIAL INSTRUCTIONS:\n${specialInstructions}` : ''}

ACTIVATE GPS TRACKING NOW:
${trackingLink}

LAMP SOP: Tracking ON always. (2) load locks. Pickup: BOL+securement pics, WAIT for GO. Delivery: POD, WAIT for GO. Late = $250. Full SOP: ${baseUrl}/sop
`.trim();

    return this.sendSMS(driver.phone, body);
  }
}

// Export singleton instance
export const smsLoadService = new SMSLoadService();
export const smsService = smsLoadService; // Compatibility alias