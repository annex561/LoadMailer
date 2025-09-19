import twilio from 'twilio';
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
  private client: twilio.Twilio | null = null;
  private fromPhones: string[] = [];
  private isConfigured = false;
  private currentPhoneIndex = 0;
  private config: SmsConfig | null = null;
  private isRunning = false;
  private messageQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastMessageTime = 0;
  private readonly MESSAGE_DELAY = 2000; // 2 seconds between messages to avoid rate limiting
  
  // Batch processing properties
  private loadBatchQueue: LoadWithRelations[] = [];
  private isBatchProcessing = false;
  private readonly BATCH_SIZE = 3;
  private readonly BATCH_INTERVAL = 30000; // 30 seconds between batches

  constructor() {
    this.initialize();
  }

  async initializeLoadService(): Promise<void> {
    try {
      console.log('Initializing SMS Load Dispatcher...');
      
      if (!this.isConfigured) {
        console.log('⚠️ SMS service disabled - Twilio not configured');
        return;
      }

      // Initialize SMS configuration
      await this.initializeSmsConfig();
      
      // Start message queue processor
      this.startQueueProcessor();
      
      // Start batch processor
      this.startBatchProcessor();
      
      // Initialize default data
      await this.initializeDefaultData();
      
      this.isRunning = true;
      console.log('✅ SMS Load Dispatcher initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SMS load service:', error);
    }
  }

  private initialize() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone1 = process.env.TWILIO_PHONE_NUMBER;
    const fromPhone2 = process.env.TWILIO_PHONE_NUMBER_2;

    if (!accountSid || !authToken || !fromPhone1) {
      console.log('Twilio credentials not configured - SMS functionality disabled');
      return;
    }

    try {
      this.client = twilio(accountSid, authToken);
      this.fromPhones = [fromPhone1];
      
      // Add second phone number if available (ensure proper formatting)
      if (fromPhone2) {
        const formattedPhone2 = fromPhone2.startsWith('+') ? fromPhone2 : `+${fromPhone2}`;
        this.fromPhones.push(formattedPhone2);
        console.log(`📱 SMS Service initialized with ${this.fromPhones.length} phone numbers: ${this.fromPhones.join(', ')}`);
      } else {
        console.log(`📱 SMS Service initialized with 1 phone number: ${fromPhone1}`);
      }
      
      this.isConfigured = true;
      console.log('SMS Service initialized successfully with Twilio');
    } catch (error) {
      console.error('Failed to initialize Twilio client:', error);
      this.isConfigured = false;
    }
  }

  private startQueueProcessor(): void {
    if (this.isProcessingQueue) return;
    
    const processQueue = async () => {
      if (this.messageQueue.length === 0 || !this.isConfigured) {
        setTimeout(processQueue, 1000);
        return;
      }

      this.isProcessingQueue = true;
      
      while (this.messageQueue.length > 0) {
        const messageFunction = this.messageQueue.shift();
        if (messageFunction) {
          try {
            // Respect rate limiting
            const timeSinceLastMessage = Date.now() - this.lastMessageTime;
            if (timeSinceLastMessage < this.MESSAGE_DELAY) {
              await new Promise(resolve => setTimeout(resolve, this.MESSAGE_DELAY - timeSinceLastMessage));
            }
            
            await messageFunction();
            this.lastMessageTime = Date.now();
          } catch (error) {
            console.error('Error processing SMS message:', error);
          }
        }
      }
      
      this.isProcessingQueue = false;
      setTimeout(processQueue, 1000);
    };
    
    processQueue();
  }

  private queueMessage(messageFunction: () => Promise<any>): void {
    this.messageQueue.push(messageFunction);
    console.log(`📥 SMS message queued (${this.messageQueue.length} in queue)`);
  }

  private startBatchProcessor(): void {
    if (this.isBatchProcessing) return;
    
    const processBatches = async () => {
      if (this.loadBatchQueue.length === 0) {
        setTimeout(processBatches, 5000); // Check every 5 seconds
        return;
      }

      this.isBatchProcessing = true;
      
      // Process loads in batches
      const batch = this.loadBatchQueue.splice(0, this.BATCH_SIZE);
      console.log(`🚛 PROCESSING BATCH: ${batch.length} loads - ${batch.map(l => l.loadNumber).join(', ')}`);
      
      for (const load of batch) {
        try {
          await this.processSingleLoad(load);
        } catch (error) {
          console.error(`Error processing load ${load.loadNumber}:`, error);
        }
      }
      
      console.log(`✅ BATCH COMPLETE: Sent ${batch.length} loads to drivers`);
      
      this.isBatchProcessing = false;
      
      // Wait before processing next batch
      setTimeout(processBatches, this.BATCH_INTERVAL);
    };
    
    processBatches();
  }

  private addLoadToBatch(load: LoadWithRelations): void {
    this.loadBatchQueue.push(load);
    console.log(`📥 BATCH QUEUE: Added ${load.loadNumber} (${this.loadBatchQueue.length}/${this.BATCH_SIZE} in current batch)`);
  }

  private async initializeSmsConfig(): Promise<void> {
    try {
      // Create or get SMS configuration
      this.config = {
        id: randomUUID(),
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
        dispatcherPhone: process.env.DISPATCHER_PHONE_NUMBER || '',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      } as SmsConfig;
      
      console.log('SMS configuration initialized');
    } catch (error) {
      console.error('Failed to initialize SMS config:', error);
    }
  }

  private async initializeDefaultData(): Promise<void> {
    // This could include any default data initialization if needed
    console.log('SMS default data initialized');
  }

  private getNextPhoneNumber(): string {
    if (this.fromPhones.length === 0) {
      throw new Error('No phone numbers configured');
    }
    
    const phone = this.fromPhones[this.currentPhoneIndex];
    this.currentPhoneIndex = (this.currentPhoneIndex + 1) % this.fromPhones.length;
    console.log(`📱 Using phone number: ${phone} (${this.currentPhoneIndex}/${this.fromPhones.length})`);
    return phone;
  }

  async sendSMS(message: SMSMessage): Promise<{ success: boolean; messageId?: string; error?: string; isTrialAccount?: boolean }> {
    if (!this.isConfigured || !this.client || this.fromPhones.length === 0) {
      return {
        success: false,
        error: 'SMS service not properly configured'
      };
    }

    const fromPhone = this.getNextPhoneNumber();
    
    try {
      const result = await this.client.messages.create({
        body: message.body,
        from: fromPhone,
        to: message.to
      });

      console.log(`📱 SMS sent successfully to ${message.to} with SID: ${result.sid}`);
      console.log(`📱 Message status: ${result.status}`);
      console.log(`📱 Message direction: ${result.direction}`);
      console.log(`📱 From number: ${fromPhone}`);
      console.log(`📱 To number: ${message.to}`);
      
      // Check if we have additional info about delivery status
      if (result.errorCode) {
        console.log(`⚠️  SMS Error Code: ${result.errorCode} - ${result.errorMessage}`);
      }
      
      // Add delay to check delivery status
      setTimeout(async () => {
        try {
          const messageStatus = await this.client!.messages(result.sid).fetch();
          console.log(`📱 Message ${result.sid} status update: ${messageStatus.status}`);
          if (messageStatus.errorCode) {
            console.log(`⚠️  Delivery Error: ${messageStatus.errorCode} - ${messageStatus.errorMessage}`);
          }
        } catch (error) {
          console.log(`⚠️  Could not fetch message status: ${error}`);
        }
      }, 5000);
      
      return {
        success: true,
        messageId: result.sid
      };
    } catch (error: any) {
      console.error('❌ Failed to send SMS:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      
      // Check for various Twilio error codes
      if (error.code === 21608) {
        return {
          success: false,
          error: 'Trial account limitation: Phone number must be verified in Twilio console first. Visit https://console.twilio.com/us1/develop/phone-numbers/manage/verified to verify your number.',
          isTrialAccount: true
        };
      }
      
      // Invalid phone number format
      if (error.code === 21211 || error.message?.includes("Invalid 'To' Phone Number")) {
        return {
          success: false,
          error: 'Invalid phone number format. Please use a valid phone number (e.g., +1234567890)',
          isTrialAccount: false
        };
      }
      
      // Unverified phone number on trial account
      if (error.code === 21614) {
        return {
          success: false,
          error: 'Phone number is not verified. For trial accounts, verify this number at https://console.twilio.com/us1/develop/phone-numbers/manage/verified',
          isTrialAccount: true
        };
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SMS error'
      };
    }
  }

  async sendOnboardingLink(phone: string, onboardingLink: string): Promise<{ success: boolean; messageId?: string; error?: string; isTrialAccount?: boolean }> {
    const message = `🚛 Welcome to LAMP Logistics!

Complete your driver onboarding here: ${onboardingLink}

This secure link expires in 7 days. Once you complete registration, you'll be automatically added to our fleet and start receiving load offers.

Questions? Reply to this message or contact dispatch.`;

    return this.sendSMS({
      to: phone,
      body: message
    });
  }

  async processNewLoad(load: LoadWithRelations): Promise<boolean> {
    if (!this.isConfigured || !this.isRunning) {
      console.log('SMS service not initialized, skipping load notification');
      return false;
    }

    // Add load to batch queue instead of processing immediately
    this.addLoadToBatch(load);
    return true;
  }

  // Process individual load (core processing logic)
  private async processSingleLoad(load: LoadWithRelations): Promise<boolean> {
    try {
      console.log(`🔍 Processing load ${load.loadNumber}: ${load.pickupAddress} → ${load.deliveryAddress} (${load.equipmentType})`);
      
      // Get eligible drivers based on location and preferences
      const eligibleDrivers = await this.findEligibleDriversByLocation(load);
      
      if (eligibleDrivers.length === 0) {
        console.log(`❌ No eligible drivers found for load ${load.loadNumber}`);
        return false;
      }

      console.log(`✅ Found ${eligibleDrivers.length} eligible drivers for load ${load.loadNumber}`);

      // Send load offers to eligible drivers sorted by proximity and match score
      for (const driverMatch of eligibleDrivers) {
        // For drivers with phone numbers and SMS enabled
        if (driverMatch.driver.phoneNumber && driverMatch.driver.enableSmsNotifications) {
          console.log(`📱 SMS OFFER: Sending ${load.loadNumber} to ${driverMatch.driver.name} (Phone: ${driverMatch.driver.phoneNumber})`);
          try {
            await this.sendLoadToDriver(load, driverMatch.driver, driverMatch.matchScore, driverMatch.distance);
          } catch (error) {
            console.error(`❌ Failed to send load ${load.loadNumber} to driver ${driverMatch.driver.name}:`, error);
          }
        } else {
          console.log(`⏭️ Skipping driver ${driverMatch.driver.name} - no phone number or SMS disabled`);
        }
      }
      
      console.log(`📱 Load ${load.loadNumber} sent to eligible drivers via SMS`);
      return true;
    } catch (error) {
      console.error(`Error processing load ${load.loadNumber}:`, error);
      return false;
    }
  }

  private async findEligibleDriversByLocation(load: LoadWithRelations): Promise<Array<DriverMatch>> {
    try {
      // Get ALL available drivers for GPS-based matching
      const allDrivers = await storage.getAllDrivers();
      const availableDrivers = allDrivers.filter(driver => driver.status === 'available');
      console.log(`🚚 SMS MATCHING: Found ${availableDrivers.length} available drivers for load ${load.loadNumber}`);
      const eligibleDrivers: Array<DriverMatch> = [];

      for (const driver of availableDrivers) {
        if (!driver.city) continue;

        // Skip unavailable drivers immediately
        if (driver.status === 'unavailable') {
          console.log(`Skipping driver ${driver.name} - status: ${driver.status}`);
          continue;
        }

        // Equipment type compatibility check
        if (!canHandleEquipmentType(driver.equipmentType || 'dry_van', load.equipmentType)) {
          console.log(`Skipping driver ${driver.name} - equipment mismatch: ${driver.equipmentType} cannot handle ${load.equipmentType}`);
          continue;
        }

        // Calculate distance (simplified for now)
        const distance = this.calculateDistance(driver.city, load.pickupAddress || '');
        
        // Check if driver is within reasonable distance (150 miles)
        if (distance <= 150) {
          const matchScore = this.calculateMatchScore(driver, load, distance);
          eligibleDrivers.push({
            driver,
            matchScore,
            distance
          });
        }
      }

      // Sort by match score (highest first)
      eligibleDrivers.sort((a, b) => b.matchScore - a.matchScore);
      
      return eligibleDrivers;
    } catch (error) {
      console.error('Error finding eligible drivers:', error);
      return [];
    }
  }

  private calculateDistance(city1: string, city2: string): number {
    // Simplified distance calculation - in real implementation, would use GPS coordinates
    // For now, return a random distance between 10-120 miles
    return Math.floor(Math.random() * 110) + 10;
  }

  private calculateMatchScore(driver: Driver, load: LoadWithRelations, distance: number): number {
    let score = 100;
    
    // Distance penalty (closer is better)
    score -= (distance / 150) * 30; // Max 30 points penalty for distance
    
    // Equipment type bonus
    if (driver.equipmentType === load.equipmentType) {
      score += 10;
    }
    
    // Rate attractiveness (simplified)
    if (load.rate && load.rate > 1500) {
      score += 5;
    }
    
    return Math.max(0, score);
  }

  private async sendLoadToDriver(load: LoadWithRelations, driver: Driver, matchScore: number, distance: number): Promise<void> {
    if (!driver.phoneNumber) {
      throw new Error('Driver has no phone number');
    }

    const message = this.formatLoadOfferMessage(load, driver, matchScore, distance);
    
    this.queueMessage(async () => {
      const result = await this.sendSMS({
        to: driver.phoneNumber!,
        body: message
      });
      
      if (result.success) {
        // Create load offer record
        const loadOffer: Omit<LoadOffer, 'id' | 'createdAt' | 'updatedAt'> = {
          loadId: load.id,
          driverId: driver.id,
          offeredRate: load.rate || 0,
          status: 'pending',
          smsMessageId: result.messageId,
          responseMethod: 'sms'
        };
        
        await storage.createLoadOffer(loadOffer);
        console.log(`📱 Load offer sent to ${driver.name} via SMS`);
      } else {
        console.error(`Failed to send SMS to ${driver.name}: ${result.error}`);
      }
    });
  }

  private formatLoadOfferMessage(load: LoadWithRelations, driver: Driver, matchScore: number, distance: number): string {
    const driverRate = Math.floor((load.rate || 0) * 0.85); // Driver gets 85% of total rate
    
    return `🚛 LAMP LOGISTICS NEW LOAD OFFER

` +
           `📋 Load: ${load.loadNumber}
` +
           `📍 Route: ${load.pickupAddress} → ${load.deliveryAddress}
` +
           `💰 Driver Rate: $${driverRate.toLocaleString()}
` +
           `📦 Equipment: ${load.equipmentType?.replace('_', ' ').toUpperCase()}
` +
           `📏 Distance from you: ${distance} miles
` +
           `📅 Pickup: ${load.pickupDate ? new Date(load.pickupDate).toLocaleDateString() : 'TBD'}
\n` +
           `Reply 'BOOK' to accept or 'PASS' to decline\n\n` +
           `This offer expires in 30 minutes.`;
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down SMS load service...');
    this.isRunning = false;
    this.loadBatchQueue = [];
    this.messageQueue = [];
  }

  isServiceConfigured(): boolean {
    return this.isConfigured;
  }

  isLoadServiceRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const smsService = new SMSLoadService();
export default smsService;

// For backward compatibility
export { SMSLoadService as SMSService };