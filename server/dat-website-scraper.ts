import { storage } from './storage';
import { zelloService } from './zello-service';
import { DAT_EQUIPMENT_MAPPING, mapDATEquipmentType } from '../shared/equipment-types.js';

interface ScrapedLoad {
  loadId: string;
  origin: string;
  destination: string;
  pickupDate: string;
  rate: number;
  miles: number;
  equipmentType: string;
  company: string;
  weight?: number;
  commodity?: string;
  postedTime?: string;
}

export class DATWebsiteScraper {
  private isRunning = false;
  private scrapeInterval: NodeJS.Timeout | null = null;
  private lastScrapeTime: Date | null = null;
  private seenLoadIds = new Set<string>();
  private scrapeIntervalSeconds = 10; // Start with 10 seconds

  constructor() {
    // Zello-only communication - no other services needed
  }

  async startScraping(intervalSeconds: number = 10): Promise<void> {
    if (this.isRunning) {
      console.log('DAT website scraper already running');
      return;
    }

    this.scrapeIntervalSeconds = Math.max(3, Math.min(15, intervalSeconds));
    this.isRunning = true;
    
    console.log(`🕷️  Starting DAT website scraping every ${this.scrapeIntervalSeconds} seconds for Tennessee loads...`);

    // Initial scrape
    await this.scrapeLoads();

    // Set up rapid interval scraping
    this.scrapeInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.scrapeLoads();
      }
    }, this.scrapeIntervalSeconds * 1000);

    console.log(`✅ DAT website scraper active - checking every ${this.scrapeIntervalSeconds} seconds`);
  }

  async stopScraping(): Promise<void> {
    this.isRunning = false;
    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
      this.scrapeInterval = null;
    }
    console.log('🛑 DAT website scraping stopped');
  }

  private async scrapeLoads(): Promise<void> {
    try {
      console.log('🔍 Scraping DAT website for fresh Tennessee loads...');
      
      // Simulate realistic DAT website scraping results
      // In production, this would use actual web scraping techniques
      const freshLoads = await this.simulateWebScraping();
      
      let newLoadsFound = 0;
      for (const scrapedLoad of freshLoads) {
        if (!this.seenLoadIds.has(scrapedLoad.loadId)) {
          this.seenLoadIds.add(scrapedLoad.loadId);
          await this.processScrapedLoad(scrapedLoad);
          newLoadsFound++;
        }
      }

      if (newLoadsFound > 0) {
        console.log(`📋 [DAT SCRAPE] Found ${newLoadsFound} new loads from website`);
      }

      this.lastScrapeTime = new Date();
      
      // Clean up old seen IDs to prevent memory bloat
      if (this.seenLoadIds.size > 1000) {
        const idsArray = Array.from(this.seenLoadIds);
        this.seenLoadIds = new Set(idsArray.slice(-500));
      }

    } catch (error) {
      console.error('Error scraping DAT website:', error);
    }
  }

  private async simulateWebScraping(): Promise<ScrapedLoad[]> {
    // IMPORTANT: This is currently simulated data
    // To implement real DAT scraping, you would need:
    // 1. Valid DAT login credentials
    // 2. Browser automation (Puppeteer/Playwright)
    // 3. Proper session management and CSRF handling
    // 4. Compliance with DAT's terms of service
    
    console.log('⚠️  WARNING: Currently returning simulated data - real DAT scraping requires login credentials');
    
    // Return empty array to stop fake data generation
    // Uncomment the code below if you want to continue with test data while implementing real scraping
    return [];
    
    /*
    // Real DAT scraping would look like this:
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    try {
      // Navigate to DAT LoadLink
      await page.goto('https://one.dat.com/');
      
      // Login with credentials (you'd need actual DAT account)
      await page.type('#username', 'YOUR_DAT_USERNAME');
      await page.type('#password', 'YOUR_DAT_PASSWORD');
      await page.click('#login-button');
      
      // Wait for load board to load
      await page.waitForSelector('.load-results');
      
      // Extract load data from the page
      const loads = await page.evaluate(() => {
        const loadRows = document.querySelectorAll('.load-row');
        const scrapedLoads = [];
        
        loadRows.forEach(row => {
          const origin = row.querySelector('.origin')?.textContent?.trim();
          const destination = row.querySelector('.destination')?.textContent?.trim();
          const rate = row.querySelector('.rate')?.textContent?.replace(/[^0-9]/g, '');
          const miles = row.querySelector('.miles')?.textContent?.replace(/[^0-9]/g, '');
          
          if (origin && destination && rate && miles) {
            scrapedLoads.push({
              loadId: row.getAttribute('data-load-id'),
              origin,
              destination,
              rate: parseInt(rate),
              miles: parseInt(miles),
              equipmentType: 'V',
              company: row.querySelector('.company')?.textContent?.trim() || 'Unknown',
              commodity: row.querySelector('.commodity')?.textContent?.trim() || 'General freight'
            });
          }
        });
        
        return scrapedLoads;
      });
      
      await browser.close();
      return loads;
      
    } catch (error) {
      await browser.close();
      throw error;
    }
    */
  }

  private async processScrapedLoad(scrapedLoad: ScrapedLoad): Promise<void> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) return;

      // Convert equipment types using synchronized mapping

      const loadData = {
        customerId: customers[0].id,
        description: `[DAT LIVE] ${scrapedLoad.commodity} - ${scrapedLoad.company} (ID: ${scrapedLoad.loadId})`,
        pickupAddress: scrapedLoad.origin,
        pickupDate: scrapedLoad.pickupDate,
        pickupTime: "08:00",
        deliveryAddress: scrapedLoad.destination,
        deliveryDate: scrapedLoad.pickupDate,
        deliveryTime: "17:00",
        equipmentType: mapDATEquipmentType(scrapedLoad.equipmentType),
        rate: scrapedLoad.rate,
        miles: scrapedLoad.miles,
        weight: scrapedLoad.weight || 8000,
        priority: "high" as const,
        status: "available" as const,
      };

      const load = await storage.createLoad(loadData);
      console.log(`📋 [DAT LIVE] Scraped load ${load.loadNumber}: ${scrapedLoad.origin} → ${scrapedLoad.destination} ($${scrapedLoad.rate})`);

      // Immediately send to Zello WebSocket
      try {
        await zelloService.sendLoadNotification(load);
        console.log(`🎙️ [DAT LIVE] Load ${load.loadNumber} broadcast via Zello to drivers`);
      } catch (error) {
        console.error(`❌ Failed to broadcast load ${load.loadNumber} via Zello:`, error);
      }

    } catch (error) {
      console.error('Error processing scraped load:', error);
    }
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      scrapeInterval: `${this.scrapeIntervalSeconds} seconds`,
      lastScrapeTime: this.lastScrapeTime,
      totalSeenLoads: this.seenLoadIds.size,
      nextScrapeIn: this.isRunning ? `${this.scrapeIntervalSeconds} seconds` : 'Stopped'
    };
  }

  setScrapeInterval(seconds: number): void {
    const newInterval = Math.max(3, Math.min(15, seconds));
    if (newInterval !== this.scrapeIntervalSeconds) {
      this.scrapeIntervalSeconds = newInterval;
      
      if (this.isRunning && this.scrapeInterval) {
        // Restart with new interval
        clearInterval(this.scrapeInterval);
        this.scrapeInterval = setInterval(async () => {
          if (this.isRunning) {
            await this.scrapeLoads();
          }
        }, this.scrapeIntervalSeconds * 1000);
        
        console.log(`⚡ Updated scrape interval to ${this.scrapeIntervalSeconds} seconds`);
      }
    }
  }
}