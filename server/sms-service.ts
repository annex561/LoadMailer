// TWILIO DISABLED - SMS functionality removed to prevent authentication errors
import { storage } from './storage';
import { randomUUID } from 'crypto';
import { canHandleEquipmentType } from '@shared/equipment-types';
import type { LoadWithRelations, Driver, SmsConfig, LoadOffer } from '@shared/schema';

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
  
  constructor() {
    // Twilio disabled - no initialization
    console.log('⚠️ SMS service disabled - Twilio functionality removed');
  }

  async initializeLoadService(): Promise<void> {
    console.log('⚠️ SMS Load Dispatcher disabled - Twilio removed');
    return;
  }

  async sendSMS(to: string, body: string): Promise<void> {
    console.log(`[SMS DISABLED] Would send to ${to}: ${body}`);
    return;
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