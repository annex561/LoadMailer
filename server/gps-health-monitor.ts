import cron from "node-cron";
import { storage } from "./storage";
import { smsService } from "./sms-service";
import type { LoadWithRelations, Driver, DriverLocation } from "@shared/schema";

export class GPSHealthMonitorService {
  private isRunning = false;
  private cronJob: cron.ScheduledTask | null = null;
  private lastReminderSent: Map<string, Date> = new Map();
  
  private readonly GPS_STALE_THRESHOLD_MINUTES = 5;
  private readonly REMINDER_COOLDOWN_MINUTES = 15;
  private readonly CHECK_INTERVAL_CRON = '*/3 * * * *';

  constructor() {}

  async initialize(): Promise<void> {
    try {
      console.log('🚀 Initializing GPS Health Monitor Service...');
      
      if (!smsService.isServiceConfigured()) {
        console.log('⚠️ GPS Health Monitor disabled - SMS service not configured');
        return;
      }

      this.startMonitoring();
      this.isRunning = true;
      console.log('✅ GPS Health Monitor Service initialized - checking every 3 minutes');
    } catch (error) {
      console.error('Failed to initialize GPS Health Monitor service:', error);
    }
  }

  private startMonitoring(): void {
    this.cronJob = cron.schedule(this.CHECK_INTERVAL_CRON, async () => {
      await this.checkActiveDriversGPS();
    });
    
    console.log(`📡 GPS Health Monitor scheduled - runs every 3 minutes`);
  }

  private async checkActiveDriversGPS(): Promise<void> {
    try {
      console.log('🔍 GPS Health Monitor: Starting check for stale GPS tracking...');
      
      const activeLoads = await storage.getLoadsByStatus('in_transit');
      
      if (activeLoads.length === 0) {
        console.log('📋 No active loads in transit - skipping GPS health check');
        return;
      }
      
      console.log(`📋 Checking GPS health for ${activeLoads.length} active load(s) in transit`);
      
      let checkedDrivers = 0;
      let remindersNeeded = 0;
      let remindersSent = 0;
      
      for (const load of activeLoads) {
        if (!load.driverId) {
          continue;
        }
        
        checkedDrivers++;
        
        const needsReminder = await this.checkDriverGPSHealth(load);
        
        if (needsReminder) {
          remindersNeeded++;
          const reminderSent = await this.sendGPSReminder(load);
          if (reminderSent) {
            remindersSent++;
          }
        }
      }
      
      console.log(`✅ GPS Health Check Complete: ${checkedDrivers} drivers checked, ${remindersNeeded} needed reminders, ${remindersSent} sent`);
    } catch (error) {
      console.error('❌ Error in GPS health check:', error);
    }
  }

  private async checkDriverGPSHealth(load: LoadWithRelations): Promise<boolean> {
    try {
      if (!load.driverId) {
        return false;
      }
      
      const currentLocation = await storage.getDriverCurrentLocation(load.driverId);
      
      if (!currentLocation) {
        console.log(`⚠️ No GPS data found for driver ${load.driver?.name || load.driverId} on load ${load.loadNumber}`);
        return true;
      }
      
      const now = new Date();
      const locationTimestamp = new Date(currentLocation.timestamp);
      const minutesSinceUpdate = (now.getTime() - locationTimestamp.getTime()) / (1000 * 60);
      
      if (minutesSinceUpdate > this.GPS_STALE_THRESHOLD_MINUTES) {
        console.log(`🚨 STALE GPS: Driver ${load.driver?.name || load.driverId} last updated ${Math.round(minutesSinceUpdate)} minutes ago (Load: ${load.loadNumber})`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error checking GPS health for load ${load.loadNumber}:`, error);
      return false;
    }
  }

  private async sendGPSReminder(load: LoadWithRelations): Promise<boolean> {
    try {
      if (!load.driverId || !load.driver) {
        console.log(`⚠️ Cannot send reminder - no driver assigned to load ${load.loadNumber}`);
        return false;
      }
      
      const lastReminder = this.lastReminderSent.get(load.driverId);
      
      if (lastReminder) {
        const minutesSinceLastReminder = (Date.now() - lastReminder.getTime()) / (1000 * 60);
        
        if (minutesSinceLastReminder < this.REMINDER_COOLDOWN_MINUTES) {
          console.log(`⏸️ Reminder cooldown: Driver ${load.driver.name} was reminded ${Math.round(minutesSinceLastReminder)} minutes ago (waiting ${this.REMINDER_COOLDOWN_MINUTES} min)`);
          return false;
        }
      }
      
      const trackingToken = await storage.generateTrackingToken(load.driverId);
      
      if (!trackingToken?.token) {
        console.error(`❌ Failed to generate tracking token for driver ${load.driver.name}`);
        return false;
      }
      
      const driverPhone = load.driver.phoneNumber || load.driver.phone;
      
      if (!driverPhone) {
        console.log(`⚠️ Cannot send SMS - Driver ${load.driver.name} has no phone number`);
        return false;
      }
      
      const normalizedPhone = this.normalizePhoneToE164(driverPhone);
      
      if (!normalizedPhone) {
        console.log(`⚠️ Cannot send SMS - Driver ${load.driver.name} has invalid phone number: ${driverPhone}`);
        return false;
      }
      
      const trackingUrl = `${this.getBaseUrl()}/driver-tracker?driver=${load.driverId}&token=${trackingToken.token}`;
      
      const smsMessage = `🚨 GPS tracking stopped for Load ${load.loadNumber}

Please reopen this link to continue tracking:
${trackingUrl}

This helps dispatch monitor your delivery.`;
      
      console.log(`📱 Sending GPS reminder to ${load.driver.name} (${normalizedPhone}) for load ${load.loadNumber}`);
      
      const result = await smsService.sendSMS({
        to: normalizedPhone,
        body: smsMessage
      });
      
      if (result.success) {
        this.lastReminderSent.set(load.driverId, new Date());
        console.log(`✅ GPS reminder sent successfully to ${load.driver.name} (SID: ${result.messageSid})`);
        return true;
      } else {
        console.error(`❌ Failed to send GPS reminder to ${load.driver.name}: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error(`Error sending GPS reminder for load ${load.loadNumber}:`, error);
      return false;
    }
  }

  private normalizePhoneToE164(phoneNumber: string | undefined | null): string | null {
    if (!phoneNumber) return null;
    
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    
    if (digitsOnly.length === 10) {
      return `+1${digitsOnly}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return `+${digitsOnly}`;
    } else {
      console.error(`❌ Invalid phone number format: "${phoneNumber}" (${digitsOnly.length} digits) - cannot normalize to E.164`);
      return null;
    }
  }

  private getBaseUrl(): string {
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

  getStatus(): {
    isRunning: boolean;
    activeMonitors: number;
    lastCheckTime: string | null;
    config: {
      staleThresholdMinutes: number;
      reminderCooldownMinutes: number;
      checkIntervalCron: string;
    }
  } {
    return {
      isRunning: this.isRunning,
      activeMonitors: this.lastReminderSent.size,
      lastCheckTime: this.cronJob ? new Date().toISOString() : null,
      config: {
        staleThresholdMinutes: this.GPS_STALE_THRESHOLD_MINUTES,
        reminderCooldownMinutes: this.REMINDER_COOLDOWN_MINUTES,
        checkIntervalCron: this.CHECK_INTERVAL_CRON
      }
    };
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    this.isRunning = false;
    this.lastReminderSent.clear();
    
    console.log('🛑 GPS Health Monitor Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

export const gpsHealthMonitorService = new GPSHealthMonitorService();

process.on('SIGINT', () => {
  console.log('Shutting down GPS Health Monitor Service...');
  gpsHealthMonitorService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down GPS Health Monitor Service...');
  gpsHealthMonitorService.stop();
});
