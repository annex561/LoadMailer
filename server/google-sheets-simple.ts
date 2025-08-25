// Simple Google Sheets CSV integration
// In-memory storage for Google Sheets loads
let googleSheetsLoads: any[] = [];
let processedLoadIds = new Set<string>(); // Track processed loads to avoid duplicates

// Import necessary services for driver notifications
import { telegramLoadService } from './telegram-service.js';
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
            email: 'dispatch@lampslogistics.com',
            phone: '(555) 000-0000',
            address: 'Various Locations'
          });
        }
      } catch (error) {
        // Fallback to a simple customer object for load creation
        customer = {
          id: 'default-customer',
          name: 'Google Sheets Customer',
          email: 'dispatch@lampslogistics.com',
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
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const values = this.parseCSVRow(row);
        
        if (values.length < 5) continue;

        // Based on the exact array output from debug logs, the actual mapping is:
        const pay = values[0] || '';        // '$361'
        const miles = values[1] || '';      // '837'
        const origin = values[2] || '';     // 'Woodstock, GA'
        const destination = values[3] || '';// 'Waco, TX'
        const pickupDate = values[4] || ''; // '8/24 - 8/27'
        const deadhead = values[5] || '';   // '-93'
        const weight = values[6] || '';     // '2,500 lbs'
        const loadType = values[7] || '';   // '8 ft - Partial' (EQUIPMENT)
        const contact = values[8] || '';    // '(224) 515-7265' (PHONE)
        const company = values[9] || '';    // 'Globaltranz/Afn' (COMPANY)

        if (!origin || !destination) continue;

        const load = {
          id: `GS-${Date.now()}-${i}`,
          origin: origin,
          destination: destination,
          pickup: pickupDate || 'ASAP',
          weight: this.cleanNumber(weight) || 0,
          rate: this.cleanNumber(pay),
          miles: this.cleanNumber(miles),
          equipment: loadType || 'Van',  // Use Load Type column for equipment
          broker: 'Google Sheets',
          email: 'dispatch@lampslogistics.com',
          phone: contact || 'N/A',      // Use Contact Info column for phone
          deadhead: this.cleanNumber(deadhead) || 0,  // Add deadhead from column F
          company: company || 'Unknown',  // Add company from column J
          scrapedAt: new Date()
        };

        googleSheetsLoadArray.push(load);
        newLoadsCount++;

        // Check if this is a new load that hasn't been processed for driver notifications
        if (!processedLoadIds.has(load.id)) {
          processedLoadIds.add(load.id);
          
          // Skip header row processing for notifications
          if (load.origin !== 'Pick Up' && load.destination !== 'Delivery') {
            // Convert to proper Load format and send to drivers
            try {
              const properLoad = await this.convertToLoadFormat(load);
              if (properLoad) {
                console.log(`🚛 NEW LOAD FOR DRIVERS: ${properLoad.loadNumber} - ${load.origin} → ${load.destination} ($${load.rate})`);
                
                // Send to Telegram notification system for driver proximity matching
                const notificationSent = await telegramLoadService.processNewLoad(properLoad);
                if (notificationSent) {
                  console.log(`📱 Load ${properLoad.loadNumber} sent to eligible drivers via Telegram`);
                } else {
                  console.log(`❌ No eligible drivers found for load ${properLoad.loadNumber}`);
                }
              }
            } catch (error) {
              console.error(`❌ Error processing load ${load.id} for driver notifications:`, error);
            }
          }
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