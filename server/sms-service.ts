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
  
  constructor() {
    // Initialize Twilio if credentials are available
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '';
    
    if (accountSid && authToken && this.twilioPhoneNumber) {
      this.twilioClient = twilio(accountSid, authToken);
      this.isConfigured = true;
      console.log('✅ SMS service initialized with Twilio');
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

  async sendSMS(toOrParams: string | { to: string, body: string }, bodyParam?: string): Promise<{ success: boolean, error?: string }> {
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
      
      await this.twilioClient.messages.create({
        body: body,
        from: this.twilioPhoneNumber,
        to: normalizedPhone
      });
      
      console.log(`✅ SMS sent to ${normalizedPhone}: ${body.substring(0, 50)}...`);
      return { success: true };
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
      isConfigured: false,
      isRunning: false,
      phoneNumbers: [],
      config: null
    };
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
}

// Export singleton instance
export const smsLoadService = new SMSLoadService();
export const smsService = smsLoadService; // Compatibility alias