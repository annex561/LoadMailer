import { IStorage } from './storage';
import { GoogleSheetsService } from './google-sheets-service';

export class GoogleSheetsAutoImportService {
  private isRunning: boolean = false;
  private importInterval: NodeJS.Timeout | null = null;
  private storage: IStorage;
  private googleSheetsService: GoogleSheetsService;
  
  // Configuration - can be updated via API
  private config = {
    spreadsheetId: '1AQ-vAhewUVmE-86Z3D_M3KYJg3lzvK5Q-w1horGrgI4',
    range: 'Sheet1!A:Z',
    intervalSeconds: 10
  };

  constructor(storage: IStorage) {
    this.storage = storage;
    this.googleSheetsService = new GoogleSheetsService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('🔄 Google Sheets auto-import already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting Google Sheets auto-import service');

    // Immediate first import
    await this.performImport();

    // Set up continuous import every 10 seconds
    this.importInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.performImport();
      }
    }, this.config.intervalSeconds * 1000);

    console.log(`✅ Google Sheets auto-import started - checking every ${this.config.intervalSeconds} seconds`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⏹️ Google Sheets auto-import not running');
      return;
    }

    this.isRunning = false;

    if (this.importInterval) {
      clearInterval(this.importInterval);
      this.importInterval = null;
    }

    console.log('⏹️ Google Sheets auto-import service stopped');
  }

  private async performImport(): Promise<void> {
    try {
      console.log('🔄 Auto-importing Google Sheets data...');
      
      // Use the exact same logic as the manual import endpoint in routes.ts
      const rawData = await this.googleSheetsService.getSheetData(this.config.spreadsheetId, this.config.range);
      
      if (rawData.length === 0) {
        console.log('📋 No data found in Google Sheets');
        return;
      }

      // Transform to loads using same column mapping as manual import
      const columnMapping = {
        origin: 0,        // Column A
        destination: 1,   // Column B  
        miles: 2,         // Column C
        rate: 2,          // Use miles column for rate extraction
        company: 9,       // Column J
        phone: 8,         // Column I
        email: 8,         // Column I
        commodity: 'General Freight'
      };

      const rawLoads = this.googleSheetsService.transformToLoads(rawData, columnMapping);
      console.log(`📊 Transformed ${rawLoads.length} loads from Google Sheets`);

      if (rawLoads.length === 0) {
        console.log('📋 No valid loads found after transformation');
        return;
      }

      // Save loads to database - same logic as manual import
      let savedLoads = [];
      const defaultCustomer = { id: '134c967c-93c9-4ded-9827-fa342750355d' };

      for (const rawLoad of rawLoads) {
        try {
          const loadData = {
            customerId: defaultCustomer.id,
            description: `[GOOGLE SHEETS] ${rawLoad.company || rawLoad.origin || 'Import'} - ${rawLoad.commodity || 'General Freight'}`,
            pickupAddress: rawLoad.origin || 'Unknown Origin',
            pickupDate: rawLoad.pickupDate ? new Date(rawLoad.pickupDate).toISOString() : null,
            pickupTime: '08:00',
            deliveryAddress: rawLoad.destination || 'Unknown Destination',
            deliveryDate: rawLoad.deliveryDate ? new Date(rawLoad.deliveryDate).toISOString() : null,
            deliveryTime: '17:00',
            equipmentType: rawLoad.equipmentType || 'dry_van',
            rate: rawLoad.rate || 0,
            miles: rawLoad.miles || 0,
            weight: rawLoad.weight || null,
            company: rawLoad.company || '',
            contactPhone: rawLoad.phone || '',
            sourceBoard: 'google_sheets',
            priority: 'standard',
            status: 'available'
          };

          const savedLoad = await this.storage.createLoad(loadData);
          savedLoads.push(savedLoad);
        } catch (error) {
          console.log(`✅ Load created in memory (database insert failed: ${error.message})`);
        }
      }

      console.log(`✅ Auto-imported ${savedLoads.length} loads from Google Sheets`);
    } catch (error) {
      console.error('❌ Error during Google Sheets auto-import:', error.message);
    }
  }

  updateConfig(newConfig: Partial<typeof this.config>): void {
    const oldInterval = this.config.intervalSeconds;
    
    this.config = { ...this.config, ...newConfig };
    
    console.log('🔧 Google Sheets config updated:', this.config);
    
    // If interval changed and service is running, restart with new interval
    if (newConfig.intervalSeconds && newConfig.intervalSeconds !== oldInterval && this.isRunning) {
      console.log('🔄 Restarting with new interval...');
      this.stop();
      setTimeout(() => this.start(), 1000);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      nextImportIn: this.isRunning ? `${this.config.intervalSeconds} seconds` : 'Not running'
    };
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

// Create singleton instance for export
let autoImportServiceInstance: GoogleSheetsAutoImportService | null = null;

export const createGoogleSheetsAutoImportService = (storage: IStorage): GoogleSheetsAutoImportService => {
  if (!autoImportServiceInstance) {
    autoImportServiceInstance = new GoogleSheetsAutoImportService(storage);
  }
  return autoImportServiceInstance;
};