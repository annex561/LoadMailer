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
/**
 * A2P 10DLC compliance: refuse to send to a driver who has previously replied STOP.
 * Returns the driver row if the recipient is a known opted-out driver, otherwise null.
 * Looks up by phone in any of the three formats we store (+E164, raw digits, original).
 */
async function findOptedOutDriver(phone: string): Promise<{ id: string; smsOptedOutAt: Date | null } | null> {
  try {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    const e164 = phone.startsWith('+') ? phone : `+1${digits}`;
    const { db } = await import('./db');
    const { drivers } = await import('@shared/schema');
    const { or, eq } = await import('drizzle-orm');
    const [d] = await db
      .select({ id: drivers.id, smsOptedOutAt: drivers.smsOptedOutAt })
      .from(drivers)
      .where(or(eq(drivers.phone, phone), eq(drivers.phone, e164), eq(drivers.phone, digits)))
      .limit(1);
    if (d?.smsOptedOutAt) return d;
    return null;
  } catch {
    return null;
  }
}

/**
 * A2P 10DLC compliance: standardize first-touch / marketing-flavored SMS with the
 * required brand identifier and opt-out language. Idempotent — won't double up
 * if the brand or STOP suffix is already present.
 *
 * The brand prefix MUST match the brand registered with TCR (The Campaign
 * Registry). LAMP Logistics is the registered brand on this Twilio account
 * and the campaign sample messages all start with "LAMP Dispatch:" — so
 * outbound traffic that uses a different prefix (e.g. "TRAQ-IQ:") gets
 * filtered by carriers as content-mismatch (Twilio error 30007).
 *
 * Override via SMS_BRAND_PREFIX env var if the brand changes.
 */
export function withBrandAndOptOut(body: string, opts: { includeStopSuffix?: boolean } = {}): string {
  const { includeStopSuffix = true } = opts;
  const brandPrefix = (process.env.SMS_BRAND_PREFIX || "LAMP Dispatch").trim();
  let out = body.trim();
  // Strip any pre-existing TRAQ-IQ prefix from older code paths.
  out = out.replace(/^TRAQ[- ]?IQ\s+Dispatch\s*\n?/i, "").replace(/^TRAQ[- ]?IQ:\s*/i, "");
  // Add the registered brand prefix if not already there.
  const brandRegex = new RegExp(`^${brandPrefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[:\\s]`, "i");
  if (!brandRegex.test(out)) {
    out = `${brandPrefix}: ${out}`;
  }
  if (includeStopSuffix && !/reply\s+stop/i.test(out)) {
    out = `${out}\nReply STOP to opt out, HELP for help.`;
  }
  return out;
}

async function appendDriverPortalFooter(phone: string, body: string): Promise<string> {
  try {
    if (!phone || !body) return body;
    if (/\/(driver|my-pay|u|statements)\//.test(body)) return body;

    // Normalize phone to all 3 forms we might have stored.
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    const e164 = phone.startsWith('+') ? phone : `+1${last10}`;

    const { db } = await import('./db');
    const { drivers } = await import('@shared/schema');
    const { or, eq } = await import('drizzle-orm');

    // Check BOTH columns (phone and phoneNumber) in all 3 normalized forms.
    // Drivers have been imported through multiple onboarding paths over time
    // and the phone may be stored without +1, with +1, or in either column.
    const [driver] = await db
      .select()
      .from(drivers)
      .where(
        or(
          eq(drivers.phone, phone),
          eq(drivers.phone, e164),
          eq(drivers.phone, digits),
          eq(drivers.phone, last10),
          eq(drivers.phoneNumber, phone),
          eq(drivers.phoneNumber, e164),
          eq(drivers.phoneNumber, digits),
          eq(drivers.phoneNumber, last10),
        ),
      )
      .limit(1);

    if (!driver) {
      console.log(`[footer] no driver row for phone ${phone} (tried ${e164}, ${digits}, ${last10}) — skipping dashboard footer`);
      return body;
    }
    if (!driver.trackingToken) {
      console.log(`[footer] driver ${driver.id} has no trackingToken — skipping dashboard footer`);
      return body;
    }

    const baseUrl = process.env.CUSTOM_DOMAIN || process.env.PUBLIC_URL || 'https://traqiq.app';
    const normalizedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
    // Drop the URL onto its own line (under a label) instead of inlining it
    // beside text. Long tracking tokens hard-wrap awkwardly on phones; isolating
    // the URL keeps the message scannable while driving.
    return `${body}\n\nMy Dashboard:\n${normalizedBase}/driver/${driver.trackingToken}`;
  } catch (err) {
    // Footer is best-effort; never break message delivery.
    console.error('[footer] error:', err);
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

  async sendSMS(
    toOrParams: string | { to: string, body: string, skipFooter?: boolean },
    bodyParam?: string,
  ): Promise<{ success: boolean, error?: string, messageSid?: string }> {
    // Handle both calling patterns: sendSMS(to, body) or sendSMS({ to, body, skipFooter? })
    const to = typeof toOrParams === 'string' ? toOrParams : toOrParams.to;
    let body = typeof toOrParams === 'string' ? bodyParam! : toOrParams.body;
    const skipFooter = typeof toOrParams === 'object' && !!toOrParams.skipFooter;

    // KILL SWITCH — set SMS_DISABLED=true on Railway to instantly halt every
    // outbound SMS without removing Twilio credentials. Hits BEFORE any other
    // logic so absolutely nothing fires. Restore by unsetting the env var.
    if (process.env.SMS_DISABLED === 'true') {
      console.log(`🚫 [SMS_DISABLED] would have sent to ${to}: "${body.slice(0, 60).replace(/\n/g, ' ')}..."`);
      return { success: false, error: 'SMS_DISABLED=true — outbound SMS halted' };
    }

    // DRY-RUN MODE — set DRY_RUN_OUTBOUND=true to validate the full flow
    // in production without spending real Twilio money. Returns success
    // so the downstream chain (markFulfilled, status updates, etc.)
    // continues as if the SMS sent. Different from SMS_DISABLED which
    // halts the chain. See server/dry-run.ts.
    const { isDryRunOutbound, logDryRun, dryRunFakeId } = await import('./dry-run');
    if (isDryRunOutbound()) {
      logDryRun({
        vendor: 'twilio',
        action: 'sendSMS',
        payload: {
          to,
          bodyPreview: body.slice(0, 200) + (body.length > 200 ? '... [+' + (body.length - 200) + ' chars]' : ''),
          bodyLength: body.length,
          skipFooter,
        },
      });
      return { success: true, messageSid: dryRunFakeId('twilio') };
    }

    // A2P 10DLC: never send to a driver who has replied STOP. This is a hard guard
    // — Twilio also enforces this, but we double-check to keep our audit clean.
    const optedOut = await findOptedOutDriver(to);
    if (optedOut) {
      console.log(`🛑 SMS blocked — driver ${optedOut.id} opted out at ${optedOut.smsOptedOutAt?.toISOString()}`);
      return { success: false, error: 'Recipient has opted out (STOP)' };
    }

    // Auto-append driver portal footer when the recipient is a known driver.
    // Dedup: skip if the message already links to /driver/ /my-pay/ /u/ /statements.
    // Also skip when the caller opts out (e.g. dispatch SMS uses a carrier-friendly
    // minimal template and a URL would trigger Twilio error 30007).
    if (!skipFooter) {
      body = await appendDriverPortalFooter(to, body);
    }

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