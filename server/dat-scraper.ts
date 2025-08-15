import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { storage } from "./storage";
import type { Browser, Page } from "puppeteer";

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

export interface DATLoadData {
  loadNumber?: string;
  origin: string;
  destination: string;
  pickupDate: string;
  deliveryDate: string;
  weight: number;
  equipment: string;
  rate?: number;
  miles?: number;
  company?: string;
  contactPhone?: string;
  description?: string;
}

export interface ScraperConfig {
  enabled: boolean;
  loginUrl: string;
  searchUrl: string;
  username?: string;
  password?: string;
  searchCriteria: {
    origin?: string;
    destination?: string;
    radius?: number;
    equipmentType?: string;
    minRate?: number;
    maxAge?: number; // hours
  };
  schedule: string; // cron format
  autoCreateLoads: boolean;
  defaultCustomerId?: string;
}

export class DATScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isRunning = false;
  private config: ScraperConfig;

  constructor(config: ScraperConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      // Launch browser with stealth settings
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
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Set viewport
      await this.page.setViewport({ width: 1366, height: 768 });

      console.log('DAT Scraper initialized successfully');
    } catch (error) {
      console.error('Failed to initialize DAT scraper:', error);
      throw error;
    }
  }

  async login(): Promise<boolean> {
    if (!this.page || !this.config.username || !this.config.password) {
      throw new Error('Browser not initialized or credentials not provided');
    }

    try {
      await this.page.goto(this.config.loginUrl, { waitUntil: 'networkidle2' });
      
      // Wait for login form and enter credentials
      await this.page.waitForSelector('input[name="username"], input[name="email"], input[type="email"]');
      await this.page.waitForSelector('input[name="password"], input[type="password"]');
      
      // Fill in credentials
      await this.page.type('input[name="username"], input[name="email"], input[type="email"]', this.config.username);
      await this.page.type('input[name="password"], input[type="password"]', this.config.password);
      
      // Click login button
      await this.page.click('button[type="submit"], input[type="submit"]');
      
      // Wait for navigation after login
      await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Check if login was successful by looking for dashboard elements
      const isLoggedIn = await this.page.$('.dashboard, .main-content, [data-testid="dashboard"]') !== null;
      
      if (isLoggedIn) {
        console.log('Successfully logged into DAT');
        return true;
      } else {
        console.error('Login failed - could not find dashboard elements');
        return false;
      }
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }

  async scrapeLoads(): Promise<DATLoadData[]> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Navigate to load search page
      await this.page.goto(this.config.searchUrl, { waitUntil: 'networkidle2' });
      
      // Apply search criteria
      await this.applySearchCriteria();
      
      // Wait for results to load
      await this.page.waitForSelector('.load-row, .result-row, [data-testid="load-item"]', { timeout: 10000 });
      
      // Extract load data
      const loads = await this.page.evaluate(() => {
        const loadElements = document.querySelectorAll('.load-row, .result-row, [data-testid="load-item"]');
        const results: DATLoadData[] = [];
        
        loadElements.forEach((element, index) => {
          try {
            // Extract load information using common selectors
            const originElement = element.querySelector('.origin, .pickup-city, [data-field="origin"]');
            const destElement = element.querySelector('.destination, .delivery-city, [data-field="destination"]');
            const pickupDateElement = element.querySelector('.pickup-date, .pick-date, [data-field="pickup-date"]');
            const deliveryDateElement = element.querySelector('.delivery-date, .del-date, [data-field="delivery-date"]');
            const weightElement = element.querySelector('.weight, .load-weight, [data-field="weight"]');
            const equipmentElement = element.querySelector('.equipment, .equip-type, [data-field="equipment"]');
            const rateElement = element.querySelector('.rate, .load-rate, [data-field="rate"]');
            const milesElement = element.querySelector('.miles, .distance, [data-field="miles"]');
            const companyElement = element.querySelector('.company, .shipper, [data-field="company"]');
            const phoneElement = element.querySelector('.phone, .contact-phone, [data-field="phone"]');
            
            const origin = originElement?.textContent?.trim() || '';
            const destination = destElement?.textContent?.trim() || '';
            
            if (origin && destination) {
              const loadData: DATLoadData = {
                loadNumber: `DAT-${Date.now()}-${index + 1}`,
                origin,
                destination,
                pickupDate: pickupDateElement?.textContent?.trim() || new Date().toISOString().split('T')[0],
                deliveryDate: deliveryDateElement?.textContent?.trim() || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                weight: parseInt(weightElement?.textContent?.replace(/\D/g, '') || '0') || 1000,
                equipment: equipmentElement?.textContent?.trim() || 'Dry Van',
                rate: parseFloat(rateElement?.textContent?.replace(/[$,]/g, '') || '0'),
                miles: parseInt(milesElement?.textContent?.replace(/\D/g, '') || '0'),
                company: companyElement?.textContent?.trim() || 'DAT Shipper',
                contactPhone: phoneElement?.textContent?.trim() || '',
                description: `Load from ${origin} to ${destination} - Scraped from DAT`
              };
              
              results.push(loadData);
            }
          } catch (error) {
            console.log('Error extracting load data:', error);
          }
        });
        
        return results;
      });
      
      console.log(`Scraped ${loads.length} loads from DAT`);
      return loads;
    } catch (error) {
      console.error('Failed to scrape loads:', error);
      return [];
    }
  }

  private async applySearchCriteria(): Promise<void> {
    if (!this.page) return;

    try {
      const { searchCriteria } = this.config;
      
      // Apply origin filter if specified
      if (searchCriteria.origin) {
        const originInput = await this.page.$('input[name="origin"], input[placeholder*="origin"], [data-field="origin-input"]');
        if (originInput) {
          await originInput.click({ clickCount: 3 });
          await originInput.type(searchCriteria.origin);
        }
      }
      
      // Apply destination filter if specified
      if (searchCriteria.destination) {
        const destInput = await this.page.$('input[name="destination"], input[placeholder*="destination"], [data-field="destination-input"]');
        if (destInput) {
          await destInput.click({ clickCount: 3 });
          await destInput.type(searchCriteria.destination);
        }
      }
      
      // Apply equipment type filter
      if (searchCriteria.equipmentType) {
        const equipSelect = await this.page.$('select[name="equipment"], select[data-field="equipment"]');
        if (equipSelect) {
          await this.page.select('select[name="equipment"], select[data-field="equipment"]', searchCriteria.equipmentType);
        }
      }
      
      // Apply search
      const searchButton = await this.page.$('button[type="submit"], .search-button, [data-testid="search-loads"]');
      if (searchButton) {
        await searchButton.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
      }
    } catch (error) {
      console.error('Error applying search criteria:', error);
    }
  }

  async createLoadsFromScrapedData(loads: DATLoadData[]): Promise<number> {
    let createdCount = 0;
    
    for (const loadData of loads) {
      try {
        // Check if load already exists
        const existingLoads = await storage.getAllLoads();
        const isDuplicate = existingLoads.some(load => 
          load.description?.includes(loadData.loadNumber || '') ||
          (load.pickupAddress === loadData.origin && load.deliveryAddress === loadData.destination)
        );
        
        if (isDuplicate) {
          console.log(`Skipping duplicate load: ${loadData.loadNumber}`);
          continue;
        }
        
        // Get default customer or create one
        let customerId = this.config.defaultCustomerId;
        if (!customerId) {
          const customers = await storage.getAllCustomers();
          let datCustomer = customers.find(c => c.name === 'DAT Scraped Loads');
          
          if (!datCustomer) {
            datCustomer = await storage.createCustomer({
              name: 'DAT Scraped Loads',
              contactPerson: 'DAT System',
              email: 'dat@loadmaster.system',
              phone: '(555) 000-0000',
              address: 'Automated System',
              status: 'active'
            });
          }
          
          customerId = datCustomer.id;
        }
        
        // Create load
        const newLoad = await storage.createLoad({
          customerId,
          description: loadData.description || `${loadData.equipment} load from ${loadData.origin} to ${loadData.destination}`,
          weight: loadData.weight,
          priority: 'standard',
          pickupAddress: loadData.origin,
          pickupDate: loadData.pickupDate,
          pickupTime: '08:00 AM',
          deliveryAddress: loadData.destination,
          deliveryDate: loadData.deliveryDate,
          deliveryTime: '05:00 PM',
          specialInstructions: `DAT Scraped Load - Rate: $${loadData.rate || 0}, Miles: ${loadData.miles || 0}, Equipment: ${loadData.equipment}`,
          status: 'scheduled'
        });
        
        console.log(`Created load: ${newLoad.loadNumber} from DAT data`);
        createdCount++;
      } catch (error) {
        console.error('Error creating load from scraped data:', error);
      }
    }
    
    return createdCount;
  }

  async run(): Promise<{ success: boolean; loadsScraped: number; loadsCreated: number; error?: string }> {
    if (this.isRunning) {
      return { success: false, loadsScraped: 0, loadsCreated: 0, error: 'Scraper is already running' };
    }
    
    this.isRunning = true;
    
    try {
      await this.initialize();
      
      // Login if credentials are provided
      if (this.config.username && this.config.password) {
        const loginSuccess = await this.login();
        if (!loginSuccess) {
          throw new Error('Login failed');
        }
      }
      
      // Scrape loads
      const scrapedLoads = await this.scrapeLoads();
      
      // Create loads if auto-creation is enabled
      let loadsCreated = 0;
      if (this.config.autoCreateLoads && scrapedLoads.length > 0) {
        loadsCreated = await this.createLoadsFromScrapedData(scrapedLoads);
      }
      
      return {
        success: true,
        loadsScraped: scrapedLoads.length,
        loadsCreated
      };
    } catch (error) {
      console.error('DAT scraper run failed:', error);
      return {
        success: false,
        loadsScraped: 0,
        loadsCreated: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      await this.cleanup();
      this.isRunning = false;
    }
  }

  async cleanup(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  updateConfig(newConfig: Partial<ScraperConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getStatus(): { isRunning: boolean; config: ScraperConfig } {
    return {
      isRunning: this.isRunning,
      config: this.config
    };
  }
}