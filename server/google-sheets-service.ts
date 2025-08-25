import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

export class GoogleSheetsService {
  private sheets: any;
  private auth: JWT | null = null;

  constructor() {
    this.initializeAuth();
  }

  private async initializeAuth() {
    try {
      // Use service account credentials from environment variables
      const credentials = {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
        project_id: process.env.GOOGLE_PROJECT_ID
      };

      if (!credentials.client_email || !credentials.private_key) {
        console.log('⚠️ Google Sheets credentials not provided - service disabled');
        return;
      }

      this.auth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      console.log('✅ Google Sheets service initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize Google Sheets:', error);
    }
  }

  async isConfigured(): Promise<boolean> {
    return this.auth !== null && this.sheets !== null;
  }

  async getSheetData(spreadsheetId: string, range: string = 'Sheet1!A:Z') {
    // Try simple CSV export first (for publicly shared sheets)
    try {
      return await this.getSheetDataSimple(spreadsheetId);
    } catch (simpleError) {
      console.log('📊 Simple method failed, trying authenticated method...');
      
      if (!this.sheets) {
        throw new Error('Google Sheets not configured. Please either:\n1. Make your sheet publicly viewable, OR\n2. Add service account credentials.');
      }

      try {
        console.log(`📊 Fetching data from sheet: ${spreadsheetId}, range: ${range}`);
        
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
        });

        const rows = response.data.values || [];
        console.log(`✅ Retrieved ${rows.length} rows from Google Sheets`);
        
        return rows;
      } catch (error) {
        console.error('❌ Error fetching sheet data:', error);
        throw error;
      }
    }
  }

  // Simple method for publicly shared sheets
  async getSheetDataSimple(spreadsheetId: string) {
    try {
      // Use the CSV export URL for publicly shared sheets
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
      
      console.log(`📊 Fetching public sheet data: ${spreadsheetId}`);
      
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Sheet not publicly accessible or doesn't exist`);
      }
      
      const csvText = await response.text();
      
      // Parse CSV into rows
      const rows = this.parseCSV(csvText);
      
      console.log(`✅ Retrieved ${rows.length} rows from public Google Sheet`);
      
      return rows;
    } catch (error) {
      console.error('❌ Error fetching public sheet data:', error);
      throw error;
    }
  }

  // Simple CSV parser
  parseCSV(csvText: string): string[][] {
    const lines = csvText.trim().split('\n');
    const rows: string[][] = [];
    
    for (const line of lines) {
      // Basic CSV parsing (handles quoted fields)
      const row: string[] = [];
      let field = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"' && (i === 0 || line[i-1] === ',')) {
          inQuotes = true;
        } else if (char === '"' && inQuotes && (i === line.length - 1 || line[i+1] === ',')) {
          inQuotes = false;
        } else if (char === ',' && !inQuotes) {
          row.push(field.trim());
          field = '';
        } else {
          field += char;
        }
      }
      
      row.push(field.trim()); // Add the last field
      rows.push(row);
    }
    
    return rows;
  }

  // Convert Google Sheets rows to load format
  transformToLoads(rows: any[][], columnMapping?: { [key: string]: number }) {
    if (rows.length === 0) return [];

    // Column mapping based on user's exact sheet structure
    const defaultMapping = {
      rate: 0,             // Column A - Pay
      miles: 1,            // Column B - Total miles  
      origin: 2,           // Column C - Pick up address
      destination: 3,      // Column D - Delivery address
      pickup_date: 4,      // Column E - pick up date
      deadhead: 5,         // Column F - Deadhead
      weight: 6,           // Column G - Weight
      contact: 7,          // Column H - Contact info
      company: 8,          // Column I - Company
      phone: 7,            // Column H - Contact info (same as contact)
      equipment: 'dry_van', // Default since not in sheet
      commodity: 'General Freight'
    };

    const mapping = columnMapping || defaultMapping;
    
    // Always skip the first row as it contains headers (Pay, Total miles, etc.)
    const dataRows = rows.length > 1 ? rows.slice(1) : [];

    return dataRows.map((row, index) => {
      const load = {
        id: `gsheet_${Date.now()}_${index}`,
        source: 'Google Sheets',
        status: 'available',
        scrapedAt: new Date().toISOString(),
        
        // Map columns to load fields using correct sheet structure
        origin: this.getColumnValue(row, mapping.origin),
        destination: this.getColumnValue(row, mapping.destination),
        rate: this.parseRate(this.getColumnValue(row, mapping.rate)),
        miles: this.parseNumber(this.getColumnValue(row, mapping.miles)),
        equipmentType: typeof mapping.equipment === 'string' ? mapping.equipment : this.normalizeEquipment(this.getColumnValue(row, mapping.equipment)),
        company: this.getColumnValue(row, mapping.company),
        phone: this.getColumnValue(row, mapping.contact),
        pickupDate: this.parseDate(this.getColumnValue(row, mapping.pickup_date)),
        deliveryDate: null, // Not in user's sheet
        weight: this.parseWeight(this.getColumnValue(row, mapping.weight)),
        commodity: typeof mapping.commodity === 'string' ? mapping.commodity : this.getColumnValue(row, mapping.commodity),
        deadhead: this.getColumnValue(row, mapping.deadhead),

        // Parse origin/destination into city/state
        originCity: this.parseCity(this.getColumnValue(row, mapping.origin)),
        originState: this.parseState(this.getColumnValue(row, mapping.origin)),
        destinationCity: this.parseCity(this.getColumnValue(row, mapping.destination)),
        destinationState: this.parseState(this.getColumnValue(row, mapping.destination)),

        // Additional fields
        description: `${this.getColumnValue(row, mapping.company) || 'Freight'} - ${this.getColumnValue(row, mapping.origin)} to ${this.getColumnValue(row, mapping.destination)}`,
        loadNumber: `LOAD-${Date.now()}${String(index).padStart(3, '0')}`,
        priority: 'normal',
        ratePer: 'total'
      };

      // Clean up undefined/null values
      Object.keys(load).forEach(key => {
        if (load[key as keyof typeof load] === undefined || load[key as keyof typeof load] === null) {
          delete load[key as keyof typeof load];
        }
      });

      return load;
    }).filter(load => load.origin && load.destination); // Only include loads with basic info
  }

  private getColumnValue(row: any[], columnIndex: number): string {
    return row[columnIndex]?.toString().trim() || '';
  }

  private isHeaderRow(row: any[]): boolean {
    const firstCell = row[0]?.toString().toLowerCase() || '';
    return firstCell.includes('origin') || 
           firstCell.includes('pickup') || 
           firstCell.includes('from') ||
           firstCell.includes('pay') ||
           firstCell.includes('load');
  }

  private parseRate(value: string): number {
    if (!value) return 0;
    const cleaned = value.replace(/[$,]/g, '');
    return parseInt(cleaned) || 0;
  }

  private parseNumber(value: string): number {
    if (!value) return 0;
    const cleaned = value.replace(/[^\d]/g, '');
    return parseInt(cleaned) || 0;
  }

  private parseWeight(value: string): number {
    if (!value) return 0;
    const match = value.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private parseDate(value: string): string {
    if (!value) return new Date().toISOString();
    
    try {
      // Try to parse various date formats
      const date = new Date(value);
      return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private parseCity(location: string): string {
    if (!location) return '';
    const parts = location.split(',');
    return parts[0]?.trim() || '';
  }

  private parseState(location: string): string {
    if (!location) return '';
    const parts = location.split(',');
    return parts[parts.length - 1]?.trim().slice(0, 2) || '';
  }

  private normalizeEquipment(equipment: string): string {
    if (!equipment) return 'dry_van';
    
    const type = equipment.toLowerCase();
    if (type.includes('box') || type.includes('straight')) return 'straight_box_truck';
    if (type.includes('reefer') || type.includes('refrigerated')) return 'refrigerated_truck';
    if (type.includes('flat') || type.includes('flatbed')) return 'flatbed_truck';
    if (type.includes('van') || type.includes('dry')) return 'dry_van';
    return 'dry_van';
  }

  // Get sheet metadata
  async getSheetInfo(spreadsheetId: string) {
    if (!this.sheets) {
      throw new Error('Google Sheets not configured');
    }

    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId,
      });

      return {
        title: response.data.properties.title,
        sheets: response.data.sheets.map((sheet: any) => ({
          title: sheet.properties.title,
          sheetId: sheet.properties.sheetId,
          gridProperties: sheet.properties.gridProperties
        }))
      };
    } catch (error) {
      console.error('❌ Error getting sheet info:', error);
      throw error;
    }
  }

  // Test connection
  async testConnection(spreadsheetId: string): Promise<boolean> {
    try {
      await this.getSheetData(spreadsheetId);
      return true;
    } catch {
      return false;
    }
  }

  // Extract sheet ID from URL
  extractSheetId(urlOrId: string): string {
    const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : urlOrId;
  }
}

export const googleSheetsService = new GoogleSheetsService();