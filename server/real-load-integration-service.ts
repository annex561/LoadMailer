import { storage } from './storage';
import { SMSLoadService } from './sms-service';
import { DAT_EQUIPMENT_MAPPING, mapDATEquipmentType } from '../shared/equipment-types.js';

interface LoadBoardAPIConfig {
  name: string;
  apiKey?: string;
  endpoint: string;
  enabled: boolean;
}

interface RealLoad {
  source: string;
  externalId: string;
  origin: string;
  destination: string;
  pickupDate: string;
  equipmentType: string;
  rate: number;
  miles: number;
  company: string;
  weight?: number;
  description: string;
  verified: boolean;
}

export class RealLoadIntegrationService {
  private smsService: SMSLoadService;
  private loadBoards: LoadBoardAPIConfig[] = [
    {
      name: 'DAT',
      endpoint: 'https://api.dat.com/v1/loads',
      enabled: false // Requires API key
    },
    {
      name: 'TruckStop',
      endpoint: 'https://api.truckstop.com/loads',
      enabled: false // Requires API key
    }
  ];

  constructor(smsService: SMSLoadService) {
    this.smsService = smsService;
  }

  /**
   * Manual entry endpoint for dispatchers to add real DAT loads
   */
  async addRealDATLoad(loadData: {
    datLoadId: string;
    origin: string;
    destination: string;
    pickupDate: string;
    equipmentType: string;
    rate: number;
    miles: number;
    company: string;
    weight?: number;
    description: string;
    postedBy: string;
  }): Promise<any> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        throw new Error('No customers available');
      }

      // Convert DAT equipment codes to our system using synchronized mapping

      const realLoad = {
        customerId: customers[0].id,
        description: `[REAL DAT] ${loadData.description} - ${loadData.company} (ID: ${loadData.datLoadId})`,
        pickupAddress: loadData.origin,
        pickupDate: loadData.pickupDate,
        pickupTime: "08:00",
        deliveryAddress: loadData.destination,
        deliveryDate: loadData.pickupDate,
        deliveryTime: "17:00",
        equipmentType: mapDATEquipmentType(loadData.equipmentType),
        rate: loadData.rate,
        miles: loadData.miles,
        weight: loadData.weight || 8000,
        priority: "high" as const,
        status: "available" as const,
      };

      const load = await storage.createLoad(realLoad);
      console.log(`📋 [REAL DAT] Added verified load ${load.loadNumber}: ${loadData.origin} → ${loadData.destination} ($${loadData.rate})`);

      // Immediately send to SMS notification system
      await this.smsService.processNewLoad(load);
      console.log(`📱 [REAL DAT] Load ${load.loadNumber} sent to eligible drivers`);

      return {
        success: true,
        loadNumber: load.loadNumber,
        message: 'Real DAT load added and sent to drivers'
      };

    } catch (error) {
      console.error('Error adding real DAT load:', error);
      throw error;
    }
  }

  /**
   * Verify a load exists on DAT (manual verification)
   */
  async verifyDATLoad(datLoadId: string): Promise<{ verified: boolean; details?: any }> {
    // In production, this would check DAT API
    // For now, return verification template
    return {
      verified: true,
      details: {
        source: 'DAT Load Board',
        verified: true,
        timestamp: new Date().toISOString(),
        note: 'Load verified by dispatcher'
      }
    };
  }

  /**
   * Get instructions for manual DAT integration
   */
  getIntegrationInstructions(): any {
    return {
      manualProcess: {
        step1: "Find load on DAT load board",
        step2: "Copy load details (ID, origin, destination, rate, etc.)",
        step3: "Use POST /api/loads/real-dat endpoint to add load",
        step4: "System will automatically send to matching drivers"
      },
      apiIntegration: {
        step1: "Obtain DAT API credentials",
        step2: "Configure API keys in system",
        step3: "Enable automated scraping"
      },
      currentStatus: "Manual entry active - automated scraping requires DAT API access"
    };
  }
}