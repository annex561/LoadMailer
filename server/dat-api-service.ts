import { storage } from './storage';

interface DATAPIConfig {
  apiKey: string;
  clientId: string;
  baseUrl: string;
  version: string;
}

interface DATLoad {
  loadId: string;
  origin: {
    city: string;
    state: string;
    zipCode?: string;
  };
  destination: {
    city: string;
    state: string;
    zipCode?: string;
  };
  pickup: {
    earliestDate: string;
    latestDate: string;
    earliestTime?: string;
    latestTime?: string;
  };
  delivery: {
    earliestDate: string;
    latestDate: string;
  };
  equipment: {
    type: string;
    length?: number;
  };
  rate: {
    amount: number;
    currency: string;
    rateType: string; // "linehaul", "total", etc.
  };
  distance: number;
  weight?: number;
  commodity?: string;
  company: {
    name: string;
    mcNumber?: string;
    dotNumber?: string;
  };
  contact: {
    name?: string;
    phone?: string;
    email?: string;
  };
  notes?: string;
  posted: string;
}

interface DATSearchParams {
  originRadius?: number;
  originCity?: string;
  originState?: string;
  destinationRadius?: number;
  destinationCity?: string;
  destinationState?: string;
  equipmentTypes?: string[];
  minRate?: number;
  maxRate?: number;
  pickupDateStart?: string;
  pickupDateEnd?: string;
  maxAge?: number; // hours
}

export class DATAPIService {
  private config: DATAPIConfig;
  private isRunning = false;
  private searchInterval: NodeJS.Timeout | null = null;
  private lastSearchTime: Date | null = null;

  constructor() {
    // SMS-only communication via Twilio
    this.config = {
      apiKey: process.env.DAT_API_KEY || '',
      clientId: process.env.DAT_CLIENT_ID || '',
      baseUrl: 'https://api.dat.com/v1',
      version: 'v1'
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey || !this.config.clientId) {
      throw new Error('DAT API credentials not configured. Please set DAT_API_KEY and DAT_CLIENT_ID environment variables.');
    }

    try {
      // Test API connectivity
      await this.testConnection();
      console.log('✅ DAT API connection verified');
    } catch (error) {
      console.error('❌ DAT API initialization failed:', error);
      throw error;
    }
  }

  private async testConnection(): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/equipment-types`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DAT-Client-ID': this.config.clientId
      }
    });

    if (!response.ok) {
      throw new Error(`DAT API test failed: ${response.status} ${response.statusText}`);
    }
  }

  async startAutomaticScraping(): Promise<void> {
    if (this.isRunning) {
      console.log('DAT API scraping already running');
      return;
    }

    this.isRunning = true;
    console.log('🚛 Starting DAT API load scraping for Tennessee region...');

    // Initial search
    await this.searchLoads();

    // Set up interval for continuous searching (every 5 minutes)
    this.searchInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.searchLoads();
      }
    }, 300000); // 5 minutes

    console.log('✅ DAT API scraping started - checking every 5 minutes');
  }

  async stopAutomaticScraping(): Promise<void> {
    this.isRunning = false;
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = null;
    }
    console.log('🛑 DAT API scraping stopped');
  }

  private async searchLoads(): Promise<void> {
    try {
      console.log('🔍 Searching DAT load board for Tennessee freight...');

      // Search parameters for Tennessee region (focused on Annex's location)
      const searchParams: DATSearchParams = {
        originCity: 'Chattanooga',
        originState: 'TN',
        originRadius: 150, // 150-mile radius
        equipmentTypes: ['V', 'VAN'], // Van/Box truck
        minRate: 1500,
        maxAge: 24, // Last 24 hours
        pickupDateStart: new Date().toISOString().split('T')[0],
        pickupDateEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Next 7 days
      };

      const loads = await this.performLoadSearch(searchParams);
      console.log(`📋 Found ${loads.length} loads from DAT API`);

      // Process each load
      for (const datLoad of loads) {
        await this.processNewDATLoad(datLoad);
      }

      this.lastSearchTime = new Date();

    } catch (error) {
      console.error('Error searching DAT loads:', error);
    }
  }

  private async performLoadSearch(params: DATSearchParams): Promise<DATLoad[]> {
    const queryParams = new URLSearchParams();
    
    if (params.originCity) queryParams.append('origin.city', params.originCity);
    if (params.originState) queryParams.append('origin.state', params.originState);
    if (params.originRadius) queryParams.append('origin.radius', params.originRadius.toString());
    if (params.destinationCity) queryParams.append('destination.city', params.destinationCity);
    if (params.destinationState) queryParams.append('destination.state', params.destinationState);
    if (params.equipmentTypes) queryParams.append('equipment.types', params.equipmentTypes.join(','));
    if (params.minRate) queryParams.append('rate.minimum', params.minRate.toString());
    if (params.maxAge) queryParams.append('maxAge', params.maxAge.toString());
    if (params.pickupDateStart) queryParams.append('pickup.dateStart', params.pickupDateStart);
    if (params.pickupDateEnd) queryParams.append('pickup.dateEnd', params.pickupDateEnd);

    const response = await fetch(`${this.config.baseUrl}/loads/search?${queryParams}`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DAT-Client-ID': this.config.clientId
      }
    });

    if (!response.ok) {
      throw new Error(`DAT API search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.loads || [];
  }

  private async processNewDATLoad(datLoad: DATLoad): Promise<void> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) return;

      // Convert DAT equipment types to our system
      const equipmentMapping: Record<string, string> = {
        'V': 'straight_box_truck',
        'VAN': 'dry_van',
        'R': 'refrigerated',
        'F': 'flatbed',
        'FSD': 'flatbed',
        'RGN': 'flatbed',
        'CONESTOGA': 'flatbed'
      };

      const originAddress = `${datLoad.origin.city}, ${datLoad.origin.state}`;
      const destinationAddress = `${datLoad.destination.city}, ${datLoad.destination.state}`;

      const loadData = {
        customerId: customers[0].id,
        description: `[DAT LIVE] ${datLoad.commodity || 'Freight'} - ${datLoad.company.name} (ID: ${datLoad.loadId})`,
        pickupAddress: originAddress,
        pickupDate: datLoad.pickup.earliestDate,
        pickupTime: datLoad.pickup.earliestTime || "08:00",
        deliveryAddress: destinationAddress,
        deliveryDate: datLoad.delivery.earliestDate,
        deliveryTime: "17:00",
        equipmentType: equipmentMapping[datLoad.equipment.type] || 'straight_box_truck',
        rate: datLoad.rate.amount,
        miles: datLoad.distance,
        weight: datLoad.weight || 8000,
        priority: "high" as const,
        status: "available" as const,
      };

      const load = await storage.createLoad(loadData);
      console.log(`📋 [DAT LIVE] Created load ${load.loadNumber}: ${originAddress} → ${destinationAddress} ($${datLoad.rate.amount})`);

    } catch (error) {
      console.error('Error processing DAT load:', error);
    }
  }

  async getLoadDetails(loadId: string): Promise<DATLoad | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/loads/${loadId}`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-DAT-Client-ID': this.config.clientId
        }
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching DAT load details:', error);
      return null;
    }
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      lastSearchTime: this.lastSearchTime,
      nextSearchIn: this.searchInterval ? '5 minutes' : 'Stopped',
      apiConfigured: !!(this.config.apiKey && this.config.clientId),
      searchRegion: 'Tennessee (150-mile radius from Chattanooga)'
    };
  }
}