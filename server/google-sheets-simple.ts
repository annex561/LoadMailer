// Simple Google Sheets CSV integration
// In-memory storage for Google Sheets loads
let googleSheetsLoads: any[] = [];
let processedLoadIds = new Set<string>(); // Track processed loads to avoid duplicates

// Import necessary services for driver notifications
import { storage } from './storage.js';
import type { LoadWithRelations, InsertLoad } from './storage';
import { randomUUID } from 'crypto';

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
  // Disabled by default. Override with GOOGLE_SHEETS_SPREADSHEET_ID env var
  // pointing to a real, actively-managed sheet. The old hardcoded ID was a
  // loadboard-scrape demo sheet that generated $0-rate GQ-UUID ghost loads
  // every 3 minutes. Real loads come in through Gmail ratecon intake.
  private spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';
  private importInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Convert Google Sheets load to proper Load format for driver notifications
  private async convertToLoadFormat(googleSheetsLoad: any): Promise<any> {
    try {
      // Create or find a default customer for Google Sheets loads
      let customer;
      try {
        const customers = await storage.getAllCustomers();
        customer = customers.find(c => c.name === 'Google Sheets Customer');

        if (!customer) {
          customer = await storage.createCustomer({
            name: 'Google Sheets Customer',
            contactPerson: 'VA Dispatcher',
            email: 'dispatch@traqiqs.io',
            phone: '(555) 000-0000',
            address: 'Various Locations'
          });
        }
      } catch (error) {
        // Fallback to a simple customer object for load creation
        customer = {
          id: 'default-customer',
          name: 'Google Sheets Customer',
          email: 'dispatch@traqiqs.io',
          phone: '(555) 000-0000',
          address: 'Various Locations',
          createdAt: new Date()
        };
      }

      // Parse pickup date - handle formats like "8/24 - 8/27", "8/24", "ASAP"
      let pickupDate = new Date();

      if (googleSheetsLoad.pickup && googleSheetsLoad.pickup !== 'ASAP') {
        const pickupStr = googleSheetsLoad.pickup.trim();

        // Handle date ranges like "8/24 - 8/27" by taking the first date
        if (pickupStr.includes(' - ')) {
          const firstDate = pickupStr.split(' - ')[0].trim();
          const parsedDate = new Date(firstDate + '/2025'); // Add current year
          if (!isNaN(parsedDate.getTime())) {
            pickupDate = parsedDate;
          }
        } else {
          // Handle single dates like "8/24"
          const parsedDate = new Date(pickupStr + '/2025'); // Add current year
          if (!isNaN(parsedDate.getTime())) {
            pickupDate = parsedDate;
          }
        }
      }

      // Create delivery date (add 2 days to pickup)
      let deliveryDate = new Date(pickupDate);
      deliveryDate.setDate(deliveryDate.getDate() + 2);

      // Parse rate and miles as numbers
      const rateNumber = parseFloat(googleSheetsLoad.rate) || 0;
      const milesNumber = parseInt(googleSheetsLoad.miles) || 0;

      // Map equipment type from Google Sheets to standard types
      const equipmentMapping: Record<string, string> = {
        'van': 'dry_van',
        'box truck': 'box_truck',
        'sprinter': 'sprinter_van',
        'flatbed': 'flatbed',
        'reefer': 'refrigerated',
        'partial': 'dry_van',
        'full': 'dry_van'
      };

      const equipmentType = equipmentMapping[googleSheetsLoad.equipment?.toLowerCase()] || 'dry_van';

      // Validate dates before converting to ISO string
      if (isNaN(pickupDate.getTime())) {
        pickupDate = new Date(); // Fallback to current date
      }
      if (isNaN(deliveryDate.getTime())) {
        deliveryDate = new Date(pickupDate.getTime() + 2 * 24 * 60 * 60 * 1000); // Add 2 days
      }

      const insertLoad: InsertLoad = {
        customerId: customer.id,
        pickupAddress: googleSheetsLoad.origin || '',
        deliveryAddress: googleSheetsLoad.destination || '',
        pickupDate: pickupDate.toISOString(),
        deliveryDate: deliveryDate.toISOString(),
        commodity: 'General Freight',
        weight: googleSheetsLoad.weight || '2000 lbs',
        length: '48',
        width: '8.5',
        height: '9',
        equipmentType: equipmentType,
        priority: 'standard',
        specialInstructions: `Rate: $${rateNumber}, Miles: ${milesNumber}, Contact: ${googleSheetsLoad.phone}`,
        rate: rateNumber,
        miles: milesNumber,
        company: googleSheetsLoad.company || 'Unknown',
        contactPhone: googleSheetsLoad.phone || '',
        sourceBoard: 'google_sheets'
      };

      // Create the load in storage
      const load = await storage.createLoad(insertLoad);
      return load;
    } catch (error) {
      console.error('Error converting Google Sheets load to Load format:', error);
      return null;
    }
  }

  async start() {
    if (!this.spreadsheetId) {
      console.log('ℹ️  Google Sheets import disabled — set GOOGLE_SHEETS_SPREADSHEET_ID to enable.');
      return;
    }
    if (this.isRunning) return;
    this.isRunning = true;

    // Import immediately
    await this.importGoogleSheetsLoads();

    // Set up 30-second interval — loads come in fast, timing is everything
    this.importInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.importGoogleSheetsLoads();
      }
    }, 30000);

    console.log('✅ Google Sheets auto-import started - checking every 30 seconds');
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

      const dataRows = lines.slice(1);
      let newLoadsCount = 0;
      const googleSheetsLoadArray: any[] = [];

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const values = this.parseCSVRow(row);
        if (values.length < 5) continue;

        const rowId        = values[0] || '';
        const miles        = values[1] || '';
        const origin       = values[2] || '';
        const destination  = values[3] || '';
        const pickupOffset = values[4] || '';
        const deadheadRaw  = values[5] || '';
        const weight       = values[6] || '';
        const trailerSpec  = values[7] || '';
        const contactInfo  = values[8] || '';
        const companyName  = values[9] || '';

        if (origin.toLowerCase().includes('pick up') ||
            origin.toLowerCase().includes('delivery') ||
            destination.toLowerCase().includes('delivery') ||
            destination.toLowerCase().includes('pick up')) continue;

        if (!this.isValidLoad(origin, destination, pickupOffset, contactInfo, companyName)) continue;

        const pickupDate = this.convertDayOffset(pickupOffset);
        const equipment = this.parseEquipment(trailerSpec);
        const isPhone = /^\(?\d/.test(contactInfo.trim());
        const phone   = isPhone ? contactInfo.trim() : '';
        const email   = (!isPhone && contactInfo.includes('@'))
                          ? contactInfo.trim()
                          : 'dispatch@lampslogistics.com';
        const stableId = `GQ-${rowId}`.substring(0, 100);

        const load = {
          id: stableId,
          origin: origin,
          destination: destination,
          pickup: pickupDate,
          weight: this.cleanNumber(weight) || 0,
          rate: '0',
          miles: this.cleanNumber(miles),
          equipment: equipment,
          broker: 'Google Sheets',
          email: email,
          phone: phone || 'N/A',
          deadhead: 0,
          company: companyName || 'Unknown',
          trailerSpec: trailerSpec,
          scrapedAt: new Date()
        };

        googleSheetsLoadArray.push(load);
        newLoadsCount++;
        if (!processedLoadIds.has(load.id)) processedLoadIds.add(load.id);
      }

      googleSheetsLoads = googleSheetsLoadArray;
      console.log(`📋 Stored ${googleSheetsLoads.length} loads in memory for API serving`);
      console.log(`✅ Google Sheets import complete: ${newLoadsCount} loads added`);

      // Feed loads into auto-matcher for driver proximity matching
      try {
        const { autoLoadMatcher } = await import('./auto-load-matcher');
        autoLoadMatcher.feedLoads(googleSheetsLoadArray);
      } catch (e) {
        // non-fatal
      }

    } catch (error) {
      console.error('❌ Google Sheets import error:', (error as Error).message);
    }
  }

  private convertDayOffset(offsetStr: string): string {
    if (!offsetStr || offsetStr.trim() === '') return 'ASAP';
    const offset = parseInt(offsetStr.trim(), 10);
    if (isNaN(offset)) return offsetStr.trim();
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
  }

  private parseEquipment(trailerSpec: string): string {
    if (!trailerSpec) return 'Van';
    const spec = trailerSpec.toLowerCase();
    if (spec.includes('53') || spec.includes('48')) return 'Van';
    if (spec.includes('26') || spec.includes('24') || spec.includes('20')) return 'Box Truck';
    if (spec.includes('sprinter') || spec.includes('cargo van')) return 'Sprinter';
    if (spec.includes('flatbed')) return 'Flatbed';
    if (spec.includes('reefer') || spec.includes('refrigerat')) return 'Reefer';
    if (spec.includes('van')) return 'Van';
    if (spec.includes('box')) return 'Box Truck';
    return trailerSpec;
  }

  private parseCSVRow(row: string): string[] {
    const values: string[] = [];
    let currentValue = '';
    let insideQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') { insideQuotes = !insideQuotes; }
      else if (char === ',' && !insideQuotes) { values.push(currentValue.trim()); currentValue = ''; }
      else { currentValue += char; }
    }
    values.push(currentValue.trim());
    return values;
  }

  private cleanNumber(value: string): string {
    if (!value) return '0';
    return value.replace(/[^0-9.]/g, '') || '0';
  }

  private isValidLoad(origin: string, destination: string, pickupDate: string, contact: string, company: string): boolean {
    if (!origin || origin.trim().length < 2) return false;
    return true;
  }
}

export const googleSheetsSimple = new GoogleSheetsSimple();

export function getGoogleSheetsLoads() {
  console.log(`🔍 getGoogleSheetsLoads() called - returning ${googleSheetsLoads.length} loads`);
  if (!googleSheetsLoads || googleSheetsLoads.length === 0) { return []; }
  return [...googleSheetsLoads];
}
