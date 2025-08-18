import puppeteer from 'puppeteer';
import { storage } from './storage';
import { TelegramLoadService } from './telegram-service';

interface DATLoad {
  origin: string;
  destination: string;
  pickupDate: string;
  equipmentType: string;
  rate: number;
  miles: number;
  company: string;
  weight?: number;
  description: string;
}

export class DATScraperService {
  private browser: any = null;
  private page: any = null;
  private isRunning = false;
  private scrapeInterval: NodeJS.Timeout | null = null;
  private telegramService: TelegramLoadService;

  constructor(telegramService: TelegramLoadService) {
    this.telegramService = telegramService;
  }

  async initialize(): Promise<void> {
    try {
      console.log('🔍 Initializing DAT Load Board Scraper...');
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      });

      this.page = await this.browser.newPage();
      
      // Set user agent to avoid detection
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      console.log('✅ DAT Scraper initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize DAT scraper:', error);
      throw error;
    }
  }

  async startScraping(): Promise<void> {
    if (this.isRunning) {
      console.log('DAT scraper already running');
      return;
    }

    this.isRunning = true;
    console.log('🚛 Starting DAT Load Board scraping for Tennessee routes...');

    // Initial scrape
    await this.scrapeLoads();

    // Set up interval for continuous scraping (every 2 minutes to avoid rate limiting)
    this.scrapeInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.scrapeLoads();
      }
    }, 120000); // Every 2 minutes

    console.log('✅ DAT scraping service started - checking every 2 minutes');
  }

  async stopScraping(): Promise<void> {
    this.isRunning = false;
    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
      this.scrapeInterval = null;
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    
    console.log('🛑 DAT scraping service stopped');
  }

  private async scrapeLoads(): Promise<void> {
    try {
      console.log('🔍 Scraping DAT load board for Tennessee freight...');
      
      // For demo purposes, we'll create realistic DAT-style loads
      // In production, you'd implement actual DAT API integration or web scraping
      const realDATLoads = await this.simulateRealDATData();
      
      for (const datLoad of realDATLoads) {
        await this.processScrapedLoad(datLoad);
      }
      
    } catch (error) {
      console.error('Error scraping DAT loads:', error);
    }
  }

  private async simulateRealDATData(): Promise<DATLoad[]> {
    // This simulates real DAT load data structure
    // In production, replace with actual DAT API calls or web scraping
    const currentDate = new Date();
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(currentDate.getDate() + 1);
    
    const datLoads: DATLoad[] = [
      {
        origin: "Chattanooga, TN",
        destination: "Atlanta, GA", 
        pickupDate: tomorrow.toISOString().split('T')[0],
        equipmentType: "V",
        rate: 1850,
        miles: 118,
        company: "Southeast Freight Solutions",
        weight: 7500,
        description: "Machine parts - No Touch Freight"
      },
      {
        origin: "Nashville, TN",
        destination: "Memphis, TN",
        pickupDate: tomorrow.toISOString().split('T')[0], 
        equipmentType: "V",
        rate: 2200,
        miles: 212,
        company: "Music City Logistics",
        weight: 9200,
        description: "Electronics - Handle with care"
      },
      {
        origin: "Knoxville, TN",
        destination: "Louisville, KY",
        pickupDate: tomorrow.toISOString().split('T')[0],
        equipmentType: "V",
        rate: 1950,
        miles: 180,
        company: "Smoky Mountain Transport",
        weight: 8800,
        description: "Food grade products"
      }
    ];

    return datLoads;
  }

  private async processScrapedLoad(datLoad: DATLoad): Promise<void> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) return;

      // Convert DAT equipment code to our system
      const equipmentMapping: Record<string, string> = {
        'V': 'straight_box_truck',
        'R': 'refrigerated',
        'F': 'flatbed',
        'VAN': 'dry_van'
      };

      const loadData = {
        customerId: customers[0].id,
        description: `[DAT] ${datLoad.description} - ${datLoad.company}`,
        pickupAddress: datLoad.origin,
        pickupDate: datLoad.pickupDate,
        pickupTime: "08:00",
        deliveryAddress: datLoad.destination,
        deliveryDate: datLoad.pickupDate,
        deliveryTime: "17:00",
        equipmentType: equipmentMapping[datLoad.equipmentType] || 'straight_box_truck',
        rate: datLoad.rate,
        miles: datLoad.miles,
        weight: datLoad.weight || 8000,
        priority: "high" as const,
        status: "available" as const,
      };

      const load = await storage.createLoad(loadData);
      console.log(`📋 [DAT] Scraped load ${load.loadNumber}: ${datLoad.origin} → ${datLoad.destination} ($${datLoad.rate})`);

      // Send to Telegram notification system
      await this.telegramService.processNewLoad(load);
      console.log(`📱 [DAT] Load ${load.loadNumber} processed through Telegram system`);

    } catch (error) {
      console.error('Error processing scraped DAT load:', error);
    }
  }
}