// Simple Google Sheets CSV integration
// In-memory storage for Google Sheets loads
let googleSheetsLoads: any[] = [];

interface GoogleSheetsLoad {
  pay: string;
  miles: string;
  origin: string;
  destination: string;
  pickupDate: string;
  company: string;
  contact: string;
}

class GoogleSheetsSimple {
  private spreadsheetId = '1AQ-vAhewUVmE-86Z3D_M3KYJg3lzvK5Q-w1horGrgI4';
  private importInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Import immediately
    await this.importGoogleSheetsLoads();

    // Set up 10-second interval
    this.importInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.importGoogleSheetsLoads();
      }
    }, 10000);

    console.log('✅ Google Sheets auto-import started - checking every 10 seconds');
  }

  stop() {
    this.isRunning = false;
    if (this.importInterval) {
      clearInterval(this.importInterval);
      this.importInterval = null;
    }
    console.log('⏹️ Google Sheets auto-import stopped');
  }

  private async importGoogleSheetsLoads() {
    try {
      console.log('🔄 Importing Google Sheets loads...');
      
      // Fetch CSV data
      const csvUrl = `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/export?format=csv&gid=0`;
      console.log(`📡 Fetching CSV from: ${csvUrl}`);
      
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch CSV: ${response.status}`);
      }
      
      const csvText = await response.text();
      console.log(`📊 CSV data length: ${csvText.length} chars, first 200 chars: ${csvText.substring(0, 200)}`);
      
      const lines = csvText.trim().split('\n');
      console.log(`📋 Found ${lines.length} lines total`);
      
      if (lines.length < 2) {
        console.log('📋 No data found in Google Sheets');
        return;
      }

      // Parse CSV and create loads
      const dataRows = lines.slice(1); // Skip header row
      let newLoadsCount = 0;

      // Parse CSV and create loads array
      const googleSheetsLoadArray = [];
      
      for (let i = 0; i < Math.min(dataRows.length, 50); i++) {
        const row = dataRows[i];
        const values = this.parseCSVRow(row);
        
        if (values.length < 5) continue;

        // Map your columns: A(Pay), B(Total miles), C(Pick up address), D(Delivery address), E(pick up date), etc.
        const pay = values[0] || '';
        const miles = values[1] || '';  
        const origin = values[2] || '';
        const destination = values[3] || '';
        const pickupDate = values[4] || '';
        const deadhead = values[5] || '';
        const weight = values[6] || '';
        const contact = values[7] || '';
        const company = values[8] || '';

        if (!origin || !destination) continue;

        const load = {
          id: `GS-${Date.now()}-${i}`,
          origin: origin,
          destination: destination,
          pickup: pickupDate || 'ASAP',
          weight: weight || 'N/A',
          rate: this.cleanNumber(pay),
          miles: this.cleanNumber(miles),
          equipment: 'Van',
          broker: 'Google Sheets',
          email: 'dispatch@lampslogistics.com',
          phone: contact || 'N/A',
          scrapedAt: new Date()
        };

        googleSheetsLoadArray.push(load);
        newLoadsCount++;
      }

      // Store loads directly in memory
      googleSheetsLoads = googleSheetsLoadArray;
      console.log(`📋 Stored ${googleSheetsLoads.length} loads in memory for API serving`);

      console.log(`✅ Google Sheets import complete: ${newLoadsCount} loads added`);
      
    } catch (error) {
      console.error('❌ Google Sheets import error:', error.message);
    }
  }

  private parseCSVRow(row: string): string[] {
    // Simple CSV parser that handles quoted values
    const values: string[] = [];
    let currentValue = '';
    let insideQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }
    
    values.push(currentValue.trim());
    return values;
  }

  private cleanNumber(value: string): string {
    if (!value) return '0';
    // Remove non-numeric characters except decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    return cleaned || '0';
  }
}

// Export singleton instance
export const googleSheetsSimple = new GoogleSheetsSimple();

// Export function to get current loads
export function getGoogleSheetsLoads() {
  console.log(`🔍 getGoogleSheetsLoads() called - returning ${googleSheetsLoads.length} loads`);
  return googleSheetsLoads;
}