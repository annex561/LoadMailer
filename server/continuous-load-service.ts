import { storage } from './storage';
import { TelegramLoadService } from './telegram-service';

interface LoadTemplate {
  pickupAddress: string;
  deliveryAddress: string;
  equipmentType: 'straight_box_truck' | 'dry_van' | 'vans_standard';
  baseRate: number;
  baseMiles: number;
  description: string;
}

export class ContinuousLoadService {
  private isRunning = false;
  private loadInterval: NodeJS.Timeout | null = null;
  private telegramService: TelegramLoadService;

  // Load templates specifically designed for Annex and his routes
  private loadTemplates: LoadTemplate[] = [
    {
      pickupAddress: "Ooltewah, TN",
      deliveryAddress: "Nashville, TN", 
      equipmentType: "straight_box_truck",
      baseRate: 2400,
      baseMiles: 135,
      description: "🚛 URGENT: Nashville Box Truck Load - Perfect for Annex"
    },
    {
      pickupAddress: "Chattanooga, TN",
      deliveryAddress: "Nashville, TN",
      equipmentType: "straight_box_truck", 
      baseRate: 2200,
      baseMiles: 120,
      description: "📦 High Priority Delivery - Nashville Bound"
    },
    {
      pickupAddress: "Ooltewah, TN",
      deliveryAddress: "Memphis, TN",
      equipmentType: "straight_box_truck",
      baseRate: 2800,
      baseMiles: 340,
      description: "🚚 Long Haul Box Truck - Great Rate"
    },
    {
      pickupAddress: "Atlanta, GA",
      deliveryAddress: "Nashville, TN",
      equipmentType: "straight_box_truck",
      baseRate: 2600,
      baseMiles: 250,
      description: "⚡ Express Freight - Atlanta to Nashville"
    },
    {
      pickupAddress: "Knoxville, TN", 
      deliveryAddress: "Louisville, KY",
      equipmentType: "straight_box_truck",
      baseRate: 2100,
      baseMiles: 180,
      description: "📋 Standard Freight - Box Truck Required"
    }
  ];

  constructor(telegramService: TelegramLoadService) {
    this.telegramService = telegramService;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('🚛 Continuous Load Service already running');
      return;
    }

    this.isRunning = true;
    console.log('🚛 Starting 24/7 Continuous Load Generation Service for Annex...');

    // Generate initial load immediately
    await this.generateLoad();

    // Set up continuous generation every 20 seconds
    this.loadInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.generateLoad();
      }
    }, 20000); // Every 20 seconds

    console.log('✅ Continuous Load Service started - generating loads every 20 seconds');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.loadInterval) {
      clearInterval(this.loadInterval);
      this.loadInterval = null;
    }
    console.log('🛑 Continuous Load Service stopped');
  }

  private async generateLoad(): Promise<void> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        console.log('❌ No customers available for load generation');
        return;
      }

      // Select random template
      const template = this.loadTemplates[Math.floor(Math.random() * this.loadTemplates.length)];
      
      // Add some variation to rate and miles
      const rateVariation = Math.floor(Math.random() * 400) - 200; // ±$200
      const milesVariation = Math.floor(Math.random() * 20) - 10; // ±10 miles
      
      const loadData = {
        customerId: customers[0].id,
        description: template.description,
        pickupAddress: template.pickupAddress,
        pickupDate: "2025-08-19",
        pickupTime: "08:00",
        deliveryAddress: template.deliveryAddress,
        deliveryDate: "2025-08-20",
        deliveryTime: "17:00",
        equipmentType: template.equipmentType,
        rate: Math.max(1500, template.baseRate + rateVariation),
        miles: Math.max(50, template.baseMiles + milesVariation),
        weight: Math.floor(Math.random() * 3000) + 6000, // 6000-9000 lbs
        priority: "high" as const,
        status: "available" as const,
      };

      const load = await storage.createLoad(loadData);
      console.log(`🚛 Generated load ${load.loadNumber}: ${template.pickupAddress} → ${template.deliveryAddress} ($${loadData.rate}, ${loadData.miles}mi)`);

      // Immediately send to Telegram notification system
      await this.telegramService.processNewLoad(load);
      console.log(`📱 Load ${load.loadNumber} processed through Telegram system`);

    } catch (error) {
      console.error('Error generating continuous load:', error);
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}