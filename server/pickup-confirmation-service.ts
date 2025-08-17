import * as cron from 'node-cron';
import { storage } from './storage.js';
import { telegramLoadService } from './telegram-service.js';

class PickupConfirmationService {
  private isRunning = false;

  async initialize(): Promise<void> {
    console.log('Initializing Pickup Confirmation Service...');
    
    // Check for pickup confirmations every minute
    cron.schedule('* * * * *', async () => {
      await this.checkPickupTimes();
    });

    // Run initial check
    await this.checkPickupTimes();
    
    this.isRunning = true;
    console.log('Pickup Confirmation Service initialized successfully');
  }

  stop(): void {
    this.isRunning = false;
    console.log('Pickup Confirmation Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  private async checkPickupTimes(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get all assigned loads
      const loads = await storage.getAllLoads();
      const assignedLoads = loads.filter(load => 
        load.status === 'assigned' && 
        load.driver &&
        load.driver.telegramId
      );

      const now = new Date();
      
      for (const load of assignedLoads) {
        const pickupDate = new Date(load.pickupDate);
        const [hours, minutes] = (load.pickupTime || '12:00 PM').split(/[: ]/);
        let hour = parseInt(hours);
        const minute = parseInt(minutes);
        const period = load.pickupTime?.includes('PM') ? 'PM' : 'AM';
        
        if (period === 'PM' && hour !== 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        
        pickupDate.setHours(hour, minute, 0, 0);
        
        // Check if pickup time is within the next 15 minutes
        const timeDiff = pickupDate.getTime() - now.getTime();
        const minutesUntilPickup = timeDiff / (1000 * 60);
        
        // Send pickup confirmation if pickup is in 10-15 minutes and not already sent
        if (minutesUntilPickup <= 15 && minutesUntilPickup > 10) {
          const hasRecentPickupMessage = await this.hasRecentPickupConfirmation(load.id);
          
          if (!hasRecentPickupMessage) {
            console.log(`Sending pickup confirmation for load ${load.loadNumber} to ${load.driver?.name}`);
            await telegramLoadService.sendPickupConfirmation(load);
            
            // Update load status to indicate pickup confirmation sent
            await storage.updateLoad(load.id, {
              specialInstructions: (load.specialInstructions || '') + '\n[PICKUP_CONFIRMATION_SENT]'
            });
          }
        }
      }
    } catch (error) {
      console.error('Error checking pickup times:', error);
    }
  }

  private async hasRecentPickupConfirmation(loadId: string): Promise<boolean> {
    try {
      const load = await storage.getLoad(loadId);
      return load?.specialInstructions?.includes('[PICKUP_CONFIRMATION_SENT]') || false;
    } catch (error) {
      console.error('Error checking pickup confirmation status:', error);
      return false;
    }
  }
}

// Singleton instance
export const pickupConfirmationService = new PickupConfirmationService();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down Pickup Confirmation Service...');
  pickupConfirmationService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down Pickup Confirmation Service...');
  pickupConfirmationService.stop();
});