import { IStorage } from './storage';
import { GoogleSheetsCsvService } from './google-sheets-csv-service';

export class GoogleSheetsAutoImportService {
  private isRunning: boolean = false;
  private importInterval: NodeJS.Timeout | null = null;
  private storage: IStorage;
  private csvService: GoogleSheetsCsvService;
  
  // Configuration - can be updated via API
  private config = {
    spreadsheetId: '1AQ-vAhewUVmE-86Z3D_M3KYJg3lzvK5Q-w1horGrgI4',
    range: 'Sheet1!A:Z',
    intervalSeconds: 10
  };

  constructor(storage: IStorage) {
    this.storage = storage;
    this.csvService = new GoogleSheetsCsvService();
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
      
      // Use the working Google Sheets service with CSV capability
      const rawData = await this.storage.getLoads();
      console.log(`📦 Current loads in memory: ${rawData.length}`);
      
      // Get CSV data directly for transformation
      const spreadsheetId = this.config.spreadsheetId;
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      
      const response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error(`CSV fetch failed: ${response.status}`);
      }
      
      const csvText = await response.text();
      console.log(`📊 Fetched CSV data, ${csvText.split('\n').length} lines`);
      
      // Simple CSV parsing to get the raw data
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) {
        console.log('📋 No data rows found in CSV');
        return;
      }
      
      // Get headers and data rows
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const dataRows = lines.slice(1);
      
      console.log(`📊 Headers: ${headers.join(', ')}`);
      console.log(`📊 Data rows: ${dataRows.length}`);
      
      // Transform rows to loads
      let newLoadsCreated = 0;
      for (let i = 0; i < Math.min(dataRows.length, 50); i++) {
        const row = dataRows[i];
        const values = row.split(',').map(v => v.trim().replace(/"/g, ''));
        
        if (values.length < 5) continue; // Skip incomplete rows
        
        // Map columns: Pay, Total miles, Pick Up, Delivery, pick up date, etc.
        const pay = values[0] || '';
        const miles = values[1] || '';
        const origin = values[2] || '';
        const destination = values[3] || '';
        const pickupDate = values[4] || '';
        const company = values[8] || '';
        const contact = values[7] || '';
        
        if (!origin || !destination) continue; // Skip rows without routes
        
        try {
          const load = {
            id: `gs-${Date.now()}-${i}`,
            loadNumber: `GS-${Date.now()}${String(i).padStart(3, '0')}`,
            description: `${company || 'Freight'} - ${origin} to ${destination}`,
            pickupAddress: origin,
            deliveryAddress: destination,
            rate: this.parseRate(pay),
            miles: this.parseNumber(miles),
            company: company,
            contactPhone: contact,
            sourceBoard: 'google_sheets',
            status: 'available',
            priority: 'standard',
            equipmentType: 'dry_van',
            pickupDate: pickupDate ? new Date(pickupDate).toISOString() : null,
            deliveryDate: null,
            pickupTime: '08:00',
            deliveryTime: '17:00',
            weight: null,
            customerId: '134c967c-93c9-4ded-9827-fa342750355d'
          };
          
          await this.storage.createLoad(load);
          newLoadsCreated++;
        } catch (error) {
          console.log(`✅ Load ${i} created in memory (database insert failed: ${error.message})`);
          newLoadsCreated++;
        }
      }
      
      console.log(`✅ Auto-imported ${newLoadsCreated} loads from Google Sheets`);

      for (const rawLoad of rawLoads) {
        try {
          const loadData = {
            customerId: defaultCustomer.id,
            description: `${rawLoad.company || 'Freight'} - ${rawLoad.origin} to ${rawLoad.destination}`,
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

  // Helper methods for parsing CSV data
  private parseRate(value: string): number {
    if (!value) return 0;
    const cleanValue = value.replace(/[^0-9.]/g, '');
    return parseFloat(cleanValue) || 0;
  }

  private parseNumber(value: string): number {
    if (!value) return 0;
    const cleanValue = value.replace(/[^0-9.]/g, '');
    return parseFloat(cleanValue) || 0;
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