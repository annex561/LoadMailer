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
      
      const result = await this.googleSheetsService.importLoadsFromSheet({
        spreadsheetId: this.config.spreadsheetId,
        range: this.config.range
      }, this.storage);

      if (result.success && result.loadsImported > 0) {
        console.log(`✅ Auto-imported ${result.loadsImported} loads from Google Sheets`);
      } else if (result.loadsImported === 0) {
        console.log('📋 No new loads found in Google Sheets');
      } else {
        console.log('⚠️ Google Sheets import failed:', result.error);
      }
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