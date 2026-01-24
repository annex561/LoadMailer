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
  private spreadsheetId = '1AQ-vAhewUVmE-86Z3D_M3KYJg3lzvK5Q-w1horGrgI4';
  private importInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Convert Google Sheets load to proper Load format for driver notifications
  private async convertToLoadFormat(googleSheetsLoad: any): Promise<LoadWithRelations | null> {
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
    if (this.isRunning) return;
    this.isRunning = true;

    // Import immediately
    await this.importGoogleSheetsLoads();

    // Set up 3-minute interval (180 seconds)
    this.importInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.importGoogleSheetsLoads();
      }
    }, 180000);

    console.log('✅ Google Sheets auto-import started - checking every 3 minutes');
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
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const values = this.parseCSVRow(row);
        
        if (values.length < 5) continue;

        // Fixed mapping based on screenshot showing: Pay | Total miles | Pick Up | Delivery | pick up date | Deadhead | Weight | Load Type | Contact Info | Company
        const pay = values[0] || '';        // '$361'
        const miles = values[1] || '';      // '837'
        const origin = values[2] || '';     // 'Pick Up location'
        const destination = values[3] || '';// 'Delivery location'
        const pickupDate = values[4] || ''; // 'pick up date'
        const deadhead = values[5] || '';   // 'Deadhead'
        const weight = values[6] || '';     // 'Weight'
        const loadType = values[7] || '';   // 'Load Type' (EQUIPMENT)
        const contact = values[8] || '';    // 'Contact Info' (PHONE)
        const company = values[9] || '';    // 'Company'

        // Skip header row data - detect if this looks like header content
        if (origin.toLowerCase().includes('pick up') || 
            origin.toLowerCase().includes('delivery') ||
            destination.toLowerCase().includes('delivery') ||
            destination.toLowerCase().includes('pick up')) {
          console.log(`📋 Skipping header row: ${origin} → ${destination}`);
          continue;
        }

        // Comprehensive validation for complete loads only
        if (!this.isValidLoad(origin, destination, pickupDate, contact, company)) {
          console.log(`📋 Skipping incomplete load: ${origin} → ${destination} (missing required fields)`);
          continue;
        }

        // Create stable ID from load content to prevent duplicates across runs
        const stableId = `GS-${origin}-${destination}-${pay}-${miles}`.replace(/[^a-zA-Z0-9-]/g, '').substring(0, 100);
        
        const load = {
          id: stableId,
          origin: origin,
          destination: destination,
          pickup: pickupDate || 'ASAP',
          weight: this.cleanNumber(weight) || 0,
          rate: this.cleanNumber(pay),
          miles: this.cleanNumber(miles),
          equipment: 'Van',  // Default equipment type
          broker: 'Google Sheets',
          email: 'dispatch@lampslogistics.com',
          phone: loadType || 'N/A',      // loadType actually contains phone numbers
          deadhead: this.cleanNumber(deadhead) || 0,  // Add deadhead from column F
          company: contact || 'Unknown',  // contact actually contains company names
          scrapedAt: new Date()
        };

        googleSheetsLoadArray.push(load);
        newLoadsCount++;

        // Track load IDs for deduplication (note: in-memory only, resets on restart)
        // Database load creation is disabled to prevent server overload
        // Loads are stored in memory for API display only
        if (!processedLoadIds.has(load.id)) {
          processedLoadIds.add(load.id);
        }
      }

      // Store loads directly in memory for API serving
      googleSheetsLoads = googleSheetsLoadArray;
      console.log(`📋 Stored ${googleSheetsLoads.length} loads in memory for API serving`);

      console.log(`✅ Google Sheets import complete: ${newLoadsCount} loads added, ${processedLoadIds.size} total tracked for notifications`);
      
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

  // Validation function to ensure loads are complete before sending to drivers
  private isValidLoad(origin: string, destination: string, pickupDate: string, contact: string, company: string): boolean {
    // For now, allow loads to show in dashboard but add validation for driver notifications
    // Check pickup location - must exist and not be completely empty
    if (!origin || origin.trim().length < 2) {
      return false;
    }

    // Allow loads to pass validation for dashboard display
    // Only strict validation will be for actual driver notifications later
    return true;
  }
}

// Export singleton instance
export const googleSheetsSimple = new GoogleSheetsSimple();

// Export function to get current loads
export function getGoogleSheetsLoads() {
  console.log(`🔍 getGoogleSheetsLoads() called - returning ${googleSheetsLoads.length} loads`);
  
  // If no loads, return empty array but log the issue
  if (!googleSheetsLoads || googleSheetsLoads.length === 0) {
    console.log('⚠️ No loads found in memory, returning empty array');
    return [];
  }
  
  return [...googleSheetsLoads]; // Return a copy to prevent mutations
}