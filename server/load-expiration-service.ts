import cron from "node-cron";
import { storage } from "./storage";
import type { Load } from "@shared/schema";

interface ExpirationConfig {
  // Auto-expire loads after X days if not delivered
  defaultExpirationDays: number;
  // Specific date of month when loads should expire (e.g., 18th)
  monthlyExpirationDay: number;
  // Enable/disable automatic cleanup of expired loads
  autoCleanup: boolean;
  // How many days to keep expired loads before deletion
  cleanupRetentionDays: number;
}

export class LoadExpirationService {
  private config: ExpirationConfig;
  private isRunning = false;

  constructor(config: Partial<ExpirationConfig> = {}) {
    this.config = {
      defaultExpirationDays: 7,
      monthlyExpirationDay: 18,
      autoCleanup: true,
      cleanupRetentionDays: 3,
      ...config
    };
  }

  async initialize(): Promise<void> {
    console.log('Initializing Load Expiration Service...');
    
    // Schedule load expiration check every hour
    cron.schedule('0 * * * *', async () => {
      await this.processLoadExpirations();
    });

    // Schedule cleanup at 2 AM daily
    cron.schedule('0 2 * * *', async () => {
      await this.cleanupExpiredLoads();
    });

    // Run initial check
    await this.processLoadExpirations();
    
    this.isRunning = true;
    console.log('Load Expiration Service initialized successfully');
  }

  async processLoadExpirations(): Promise<void> {
    try {
      console.log('Processing load expirations...');
      
      const loads = await storage.getAllLoads();
      const now = new Date();
      let expiredCount = 0;
      let monthlyExpiredCount = 0;

      for (const load of loads) {
        // Skip already delivered, cancelled, or expired loads
        if (['delivered', 'cancelled', 'expired'].includes(load.status)) {
          continue;
        }

        let shouldExpire = false;
        let expirationReason = '';

        // Check if load has passed its explicit expiration date
        if (load.expiresAt && new Date(load.expiresAt.toString()) <= now) {
          shouldExpire = true;
          expirationReason = 'explicit_expiration';
        }

        // Check monthly expiration (e.g., all loads expire on the 18th)
        if (!shouldExpire && this.shouldExpireOnMonthlyDate(load, now)) {
          shouldExpire = true;
          expirationReason = 'monthly_expiration';
          monthlyExpiredCount++;
        }

        // Check default expiration based on age
        if (!shouldExpire && this.shouldExpireByAge(load, now)) {
          shouldExpire = true;
          expirationReason = 'age_expiration';
        }

        // Check if load is from DAT and should expire based on freshness
        if (!shouldExpire && this.shouldExpireDATLoad(load, now)) {
          shouldExpire = true;
          expirationReason = 'dat_freshness_expiration';
        }

        if (shouldExpire) {
          await this.expireLoad(load.id, expirationReason);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        console.log(`Expired ${expiredCount} loads (${monthlyExpiredCount} by monthly rule)`);
      }
    } catch (error) {
      console.error('Error processing load expirations:', error);
    }
  }

  private shouldExpireOnMonthlyDate(load: Load, now: Date): boolean {
    // If today is the monthly expiration day (e.g., 18th), expire loads
    if (now.getDate() === this.config.monthlyExpirationDay) {
      // Only expire loads that were created before this month's expiration date
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const loadDate = new Date(load.createdAt.toString());
      
      // If load was created in previous month or earlier, expire it
      if (loadDate.getFullYear() < currentYear || 
          (loadDate.getFullYear() === currentYear && loadDate.getMonth() < currentMonth)) {
        return true;
      }
      
      // If load was created this month but before the expiration day, expire it
      if (loadDate.getFullYear() === currentYear && 
          loadDate.getMonth() === currentMonth && 
          loadDate.getDate() < this.config.monthlyExpirationDay) {
        return true;
      }
    }
    
    return false;
  }

  private shouldExpireByAge(load: Load, now: Date): boolean {
    const createdAt = new Date(load.createdAt.toString());
    const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return ageInDays > this.config.defaultExpirationDays;
  }

  private shouldExpireDATLoad(load: Load, now: Date): boolean {
    // DAT loads should expire more quickly as they represent real-time freight
    if (load.sourceBoard === 'dat') {
      const createdAt = new Date(load.createdAt.toString());
      const ageInHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      return ageInHours > 24; // DAT loads expire after 24 hours
    }
    return false;
  }

  private async expireLoad(loadId: string, reason: string): Promise<void> {
    try {
      await storage.updateLoad(loadId, {
        status: 'expired',
        isExpired: true
      });
      
      console.log(`Load ${loadId} expired due to: ${reason}`);
    } catch (error) {
      console.error(`Failed to expire load ${loadId}:`, error);
    }
  }

  async cleanupExpiredLoads(): Promise<void> {
    if (!this.config.autoCleanup) {
      return;
    }

    try {
      console.log('Cleaning up old expired loads...');
      
      const loads = await storage.getAllLoads();
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - (this.config.cleanupRetentionDays * 24 * 60 * 60 * 1000));
      
      let deletedCount = 0;
      
      for (const load of loads) {
        if (load.status === 'expired' && 
            load.updatedAt && 
            new Date(load.updatedAt.toString()) < cutoffDate) {
          
          await storage.deleteLoad(load.id);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old expired loads`);
      }
    } catch (error) {
      console.error('Error cleaning up expired loads:', error);
    }
  }

  // Manual methods for immediate operations
  async expireLoadManually(loadId: string): Promise<boolean> {
    try {
      await this.expireLoad(loadId, 'manual');
      return true;
    } catch (error) {
      console.error(`Failed to manually expire load ${loadId}:`, error);
      return false;
    }
  }

  async setLoadExpiration(loadId: string, expiresAt: Date): Promise<boolean> {
    try {
      await storage.updateLoad(loadId, {
        expiresAt
      });
      return true;
    } catch (error) {
      console.error(`Failed to set expiration for load ${loadId}:`, error);
      return false;
    }
  }

  async getExpirationStats(): Promise<{
    totalLoads: number;
    expiredLoads: number;
    expiringToday: number;
    expiringSoon: number; // within 24 hours
  }> {
    try {
      const loads = await storage.getAllLoads();
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      const stats = {
        totalLoads: loads.length,
        expiredLoads: loads.filter(load => load.status === 'expired').length,
        expiringToday: 0,
        expiringSoon: 0
      };

      for (const load of loads) {
        if (load.expiresAt) {
          const expirationDate = new Date(load.expiresAt);
          if (expirationDate >= today && expirationDate < tomorrow) {
            stats.expiringToday++;
          } else if (expirationDate >= now && expirationDate < new Date(now.getTime() + 24 * 60 * 60 * 1000)) {
            stats.expiringSoon++;
          }
        }
      }

      return stats;
    } catch (error) {
      console.error('Error getting expiration stats:', error);
      return { totalLoads: 0, expiredLoads: 0, expiringToday: 0, expiringSoon: 0 };
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Load Expiration Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  getConfig(): ExpirationConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<ExpirationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('Load Expiration Service config updated:', this.config);
  }
}

// Singleton instance
export const loadExpirationService = new LoadExpirationService({
  defaultExpirationDays: 7,
  monthlyExpirationDay: 18, // User's requirement: expire on the 18th
  autoCleanup: true,
  cleanupRetentionDays: 3
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down Load Expiration Service...');
  loadExpirationService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down Load Expiration Service...');
  loadExpirationService.stop();
});