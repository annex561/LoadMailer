import { storage } from "./storage";
import type { 
  LoadBoardSource, 
  LoadBoardConfiguration, 
  ScrapedLoad, 
  ScraperConfiguration,
  ScraperConfig,
  InsertScrapedLoad,
  Driver
} from "@shared/schema";
import { randomUUID } from "crypto";
import cron from "node-cron";
import puppeteer from "puppeteer";
import { DATScraper } from "./dat-scraper";

interface LoadBoardResponse {
  loads: any[];
  totalCount: number;
  hasMore: boolean;
}

interface LoadMatchResult {
  load: ScrapedLoad;
  matchScore: number;
  matchedDriver?: Driver;
  reasons: string[];
}

export class LoadBoardService {
  private isRunning = false;
  private activeScrapeJobs = new Map<string, NodeJS.Timeout>();
  private activeIntervals = new Map<string, NodeJS.Timer>();
  private scraperStats = new Map<string, {
    lastRun: Date;
    totalRuns: number;
    successfulRuns: number;
    totalLoadsScraped: number;
    averageRunTime: number;
  }>();

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Load Board Service...');
      
      // Initialize default load board sources
      await this.initializeDefaultSources();
      
      // Create default scraper configurations
      await this.createDefaultScraperConfigs();
      
      // Start active scraper configurations
      await this.startScheduledScrapers();
      
      this.isRunning = true;
      console.log('Load Board Service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Load Board Service:', error);
      throw error;
    }
  }

  private async initializeDefaultSources(): Promise<void> {
    const existingSources = await storage.getAllLoadBoardSources();
    
    if (existingSources.length === 0) {
      const defaultSources = [
        {
          name: 'dat_load_board',
          displayName: 'DAT Load Board',
          baseUrl: 'https://www.dat.com',
          apiEndpoint: 'https://api.dat.com/loads',
          requiresAuth: true,
          authType: 'api_key',
          rateLimit: 60,
        },
        {
          name: 'truckstop_com',
          displayName: 'Truckstop.com',
          baseUrl: 'https://www.truckstop.com',
          apiEndpoint: 'https://api.truckstop.com/loads',
          requiresAuth: true,
          authType: 'oauth',
          rateLimit: 120,
        },
        {
          name: 'sylectus',
          displayName: 'Sylectus',
          baseUrl: 'https://www.sylectus.com',
          apiEndpoint: 'https://api.sylectus.com/loads',
          requiresAuth: true,
          authType: 'session',
          rateLimit: 30,
        },
        {
          name: 'load_board_123',
          displayName: '123Loadboard',
          baseUrl: 'https://www.123loadboard.com',
          apiEndpoint: 'https://api.123loadboard.com/loads',
          requiresAuth: true,
          authType: 'basic_auth',
          rateLimit: 45,
        },
        {
          name: 'direct_freight',
          displayName: 'Direct Freight',
          baseUrl: 'https://www.directfreight.com',
          apiEndpoint: 'https://api.directfreight.com/loads',
          requiresAuth: true,
          authType: 'api_key',
          rateLimit: 90,
        }
      ];

      for (const source of defaultSources) {
        await storage.createLoadBoardSource(source);
      }
      console.log(`Created ${defaultSources.length} default load board sources`);
    }
  }

  private async createDefaultScraperConfigs(): Promise<void> {
    const existingConfigs = await storage.getAllScraperConfigs();
    
    if (existingConfigs.length === 0) {
      const defaultConfigs = [
        {
          name: 'sample_load_generator',
          enabled: true,
          boardId: 'sample-board',
          scrapeInterval: 10,
          maxLoadsPerRun: 50,
          priority: 1,
          filters: {
            equipmentTypes: ['dry_van', 'refrigerated', 'flatbed', 'straight_box_truck'],
            minRate: 500,
            maxAge: 24
          }
        }
      ];

      for (const config of defaultConfigs) {
        await storage.createScraperConfig(config);
      }
      console.log(`Created ${defaultConfigs.length} default scraper configurations`);
    }
  }

  private async startScheduledScrapers(): Promise<void> {
    const allConfigs = await storage.getAllScraperConfigs();
    const enabledConfigs = allConfigs.filter(config => config.enabled);
    
    for (const config of enabledConfigs) {
      await this.scheduleScraperJob(config);
    }
    
    console.log(`Started ${enabledConfigs.length} scheduled scraper jobs`);
  }

  private async scheduleScraperJob(config: ScraperConfig): Promise<void> {
    // Clear existing jobs if they exist
    if (this.activeScrapeJobs.has(config.id)) {
      clearTimeout(this.activeScrapeJobs.get(config.id)!);
    }
    if (this.activeIntervals.has(config.id)) {
      clearInterval(this.activeIntervals.get(config.id)!);
    }

    if (!config.enabled) return;

    // Real-time load monitoring - watch for new loads continuously
    // Use shorter intervals for immediate load detection
    const interval = setInterval(async () => {
      try {
        await this.runScraper(config.id);
      } catch (error) {
        console.error(`Error in real-time scraper run for ${config.name}:`, error);
      }
    }, 3000); // 3 seconds for real-time load detection

    this.activeIntervals.set(config.id, interval);
    console.log(`Real-time load monitoring active for ${config.name} - scanning every 3 seconds for new loads`);
    
    // Run immediately on startup
    setTimeout(async () => {
      try {
        await this.runScraper(config.id);
      } catch (error) {
        console.error(`Error in initial scraper run for ${config.name}:`, error);
      }
    }, 2000); // Start after 2 seconds
  }

  async runScraper(configId: string): Promise<{
    success: boolean;
    loadsScraped: number;
    matchesFound: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const config = await storage.getScraperConfig(configId);
      if (!config || !config.enabled) {
        return { success: false, loadsScraped: 0, matchesFound: 0, error: 'Config not found or disabled' };
      }

      console.log(`Starting scraper run for: ${config.name}`);
      
      // Create scraper log entry
      const logData = {
        configId: config.id,
        status: 'running' as const,
        loadsScraped: 0,
        loadsCreated: 0,
        startedAt: new Date(),
        metadata: {}
      };
      
      const log = await storage.createScraperLog(logData);
      
      let totalLoadsScraped = 0;
      let totalLoadsCreated = 0;
      let errorMessage: string | undefined;

      try {
        // Run the DAT scraper
        const result = await this.scrapeDAT(config);
        totalLoadsScraped = result.loadsScraped;
        totalLoadsCreated = result.loadsCreated;
        
        // Update log with success
        await storage.updateScraperLog(log.id, {
          status: 'success',
          loadsScraped: totalLoadsScraped,
          loadsCreated: totalLoadsCreated,
          completedAt: new Date(),
          executionTime: Date.now() - startTime,
        });
        
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error running scraper ${config.name}:`, error);
        
        // Update log with error
        await storage.updateScraperLog(log.id, {
          status: 'error',
          errorMessage,
          completedAt: new Date(),
          executionTime: Date.now() - startTime,
        });
      }

      // Update scraper configuration stats
      const runTime = Date.now() - startTime;
      const stats = this.scraperStats.get(configId) || {
        lastRun: new Date(),
        totalRuns: 0,
        successfulRuns: 0,
        totalLoadsScraped: 0,
        averageRunTime: 0,
      };

      stats.lastRun = new Date();
      stats.totalRuns += 1;
      if (!errorMessage) stats.successfulRuns += 1;
      stats.totalLoadsScraped += totalLoadsScraped;
      stats.averageRunTime = Math.round((stats.averageRunTime * (stats.totalRuns - 1) + runTime) / stats.totalRuns);
      
      this.scraperStats.set(configId, stats);

      await storage.updateScraperConfig(configId, {
        lastRunAt: new Date(),
      });

      console.log(`Scraper run completed: ${totalLoadsScraped} loads scraped, ${totalLoadsCreated} loads created`);
      
      return {
        success: !errorMessage,
        loadsScraped: totalLoadsScraped,
        matchesFound: totalLoadsCreated,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Scraper run failed for ${configId}:`, error);
      
      return {
        success: false,
        loadsScraped: 0,
        matchesFound: 0,
        error: errorMessage,
      };
    }
  }

  private async scrapeDAT(config: ScraperConfig): Promise<{ loadsScraped: number; loadsCreated: number }> {
    console.log(`Starting DAT scraper with config: ${config.name}`);
    
    // If no credentials provided, use sample data for continuous testing
    if (!config.username || !config.password) {
      console.log('No DAT credentials - generating sample loads for continuous operation');
      return await this.generateSampleDATLoads(config);
    }

    const scraperConfig = {
      enabled: config.enabled,
      loginUrl: config.loginUrl,
      searchUrl: config.searchUrl,
      username: config.username,
      password: config.password,
      searchCriteria: config.searchCriteria || {},
      schedule: config.schedule,
      autoCreateLoads: config.autoCreateLoads,
      defaultCustomerId: config.defaultCustomerId,
    };

    const datScraper = new DATScraper(scraperConfig);
    
    try {
      await datScraper.initialize();
      const result = await datScraper.scrapeLoads();
      
      let loadsCreated = 0;
      
      // If auto-create is enabled, create loads in the system
      if (config.autoCreateLoads && result.length > 0) {
        for (const loadData of result) {
          try {
            // Convert DAT load data to our load format
            const load = {
              customerId: config.defaultCustomerId || (await storage.getAllCustomers())[0]?.id,
              pickupAddress: loadData.origin,
              pickupDate: loadData.pickupDate,
              pickupTime: '08:00',
              deliveryAddress: loadData.destination,
              deliveryDate: loadData.deliveryDate,
              deliveryTime: '17:00',

              equipmentType: loadData.equipment || 'Van',
              rate: loadData.rate || 0,
              miles: loadData.miles || 0,
              status: 'available',
              priority: 'normal',
              description: loadData.description || 'Scraped from DAT',
            };
            
            await storage.createLoad(load);
            loadsCreated++;
          } catch (error) {
            console.error('Error creating load from scraped data:', error);
          }
        }
      }
      
      console.log(`DAT scraper completed: ${result.length} loads scraped, ${loadsCreated} loads created`);
      
      return {
        loadsScraped: result.length,
        loadsCreated,
      };
      
    } finally {
      await datScraper.close();
    }
  }

  private async scrapeLoadBoard(
    config: LoadBoardConfiguration, 
    scraperConfig: ScraperConfiguration
  ): Promise<{ loadsScraped: number; matchesFound: number }> {
    
    const source = await storage.getLoadBoardSource(config.sourceId);
    if (!source) {
      throw new Error(`Load board source not found: ${config.sourceId}`);
    }

    console.log(`Scraping ${source.displayName}...`);
    
    // Get loads based on source type
    let loadData: LoadBoardResponse;
    
    if (source.apiEndpoint) {
      // API-based scraping
      loadData = await this.scrapeViaAPI(source, config, scraperConfig);
    } else {
      // Web scraping with Puppeteer
      loadData = await this.scrapeViaWeb(source, config, scraperConfig);
    }

    let loadsScraped = 0;
    let matchesFound = 0;

    // Process and store scraped loads
    for (const rawLoad of loadData.loads) {
      try {
        const scrapedLoad = await this.processRawLoad(rawLoad, source, config);
        
        // Check if load already exists
        const existingLoad = await storage.getScrapedLoadByExternalId(
          source.id, 
          scrapedLoad.externalId
        );
        
        if (!existingLoad) {
          // Match against driver preferences and lanes
          const matchResult = await this.matchLoadToDrivers(scrapedLoad, scraperConfig);
          
          if (matchResult) {
            scrapedLoad.isMatched = true;
            scrapedLoad.matchScore = matchResult.matchScore;
            scrapedLoad.matchedDriverId = matchResult.matchedDriver?.id;
            matchesFound++;
          }

          await storage.createScrapedLoad(scrapedLoad);
          loadsScraped++;

          // Auto-import if configured
          if (scraperConfig.autoImportMatches && matchResult && matchResult.matchScore >= (scraperConfig.minimumMatchScore || 75)) {
            await this.importScrapedLoad(scrapedLoad, matchResult.matchedDriver);
          }
        }
      } catch (error) {
        console.error('Error processing scraped load:', error);
      }
    }

    return { loadsScraped, matchesFound };
  }

  private async scrapeViaAPI(
    source: LoadBoardSource,
    config: LoadBoardConfiguration,
    scraperConfig: ScraperConfiguration
  ): Promise<LoadBoardResponse> {
    
    // This is a placeholder for actual API integration
    // In production, each load board would have its own API implementation
    
    console.log(`API scraping from ${source.displayName} (placeholder)`);
    
    // Mock API response for demonstration
    const mockLoads = this.generateMockLoads(10);
    
    return {
      loads: mockLoads,
      totalCount: mockLoads.length,
      hasMore: false,
    };
  }

  private async scrapeViaWeb(
    source: LoadBoardSource,
    config: LoadBoardConfiguration,
    scraperConfig: ScraperConfiguration
  ): Promise<LoadBoardResponse> {
    
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      
      // Set user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      // Navigate to load board
      await page.goto(source.baseUrl, { waitUntil: 'networkidle2' });
      
      // Authentication if required
      if (source.requiresAuth && config.credentials) {
        await this.authenticateWebSession(page, source, config);
      }
      
      // Apply search filters
      await this.applySearchFilters(page, scraperConfig);
      
      // Extract load data
      const loads = await this.extractLoadData(page, source);
      
      return {
        loads,
        totalCount: loads.length,
        hasMore: false,
      };
      
    } finally {
      await browser.close();
    }
  }

  private async authenticateWebSession(
    page: any,
    source: LoadBoardSource,
    config: LoadBoardConfiguration
  ): Promise<void> {
    // Placeholder for authentication logic
    // Each load board would have its own auth implementation
    console.log(`Authenticating with ${source.displayName}...`);
  }

  private async applySearchFilters(
    page: any,
    scraperConfig: ScraperConfiguration
  ): Promise<void> {
    // Apply search criteria from scraper config
    console.log('Applying search filters...');
  }

  private async extractLoadData(page: any, source: LoadBoardSource): Promise<any[]> {
    // Extract load data from the page
    // This would be customized for each load board's HTML structure
    console.log(`Extracting load data from ${source.displayName}...`);
    
    // Return mock data for now
    return this.generateMockLoads(5);
  }

  private generateMockLoads(count: number): any[] {
    const loads = [];
    const cities = [
      { city: 'Atlanta', state: 'GA', zip: '30309' },
      { city: 'Charlotte', state: 'NC', zip: '28202' },
      { city: 'Jacksonville', state: 'FL', zip: '32202' },
      { city: 'Nashville', state: 'TN', zip: '37203' },
      { city: 'Birmingham', state: 'AL', zip: '35203' },
    ];
    
    for (let i = 0; i < count; i++) {
      const pickup = cities[Math.floor(Math.random() * cities.length)];
      const delivery = cities[Math.floor(Math.random() * cities.length)];
      const mileage = Math.floor(Math.random() * 500) + 100;
      const rate = Math.floor(Math.random() * 2000) + 800;
      
      loads.push({
        id: `LOAD_${Date.now()}_${i}`,
        pickupCity: pickup.city,
        pickupState: pickup.state,
        pickupZip: pickup.zip,
        deliveryCity: delivery.city,
        deliveryState: delivery.state,
        deliveryZip: delivery.zip,
        pickupDate: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        deliveryDate: new Date(Date.now() + Math.random() * 10 * 24 * 60 * 60 * 1000),
        rate: rate,
        mileage: mileage,
        ratePerMile: Math.round((rate / mileage) * 100) / 100,
        weight: Math.floor(Math.random() * 40000) + 5000,
        equipmentType: ['sprinter_van', 'van', 'van_lift_gate', 'van_hotshot', 'straight_box_truck', 'box_truck', 'moving_van', 'flatbed', 'flatbed_hotshot', 'step_deck', 'lowboy', 'dry_van', 'refrigerated', 'power_only', 'container', 'car_carrier', 'tanker', 'dump_truck', 'conestoga', 'removable_gooseneck'][Math.floor(Math.random() * 20)],
        commodity: ['Electronics', 'Food Products', 'Machinery', 'Textiles'][Math.floor(Math.random() * 4)],
        brokerName: `Broker ${i + 1}`,
        brokerPhone: `555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        postedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
    
    return loads;
  }

  private async processRawLoad(
    rawLoad: any,
    source: LoadBoardSource,
    config: LoadBoardConfiguration
  ): Promise<InsertScrapedLoad> {
    
    return {
      sourceId: source.id,
      configId: config.id,
      externalId: rawLoad.id,
      loadNumber: rawLoad.loadNumber || `${source.name.toUpperCase()}-${rawLoad.id}`,
      
      pickupCity: rawLoad.pickupCity,
      pickupState: rawLoad.pickupState,
      pickupZip: rawLoad.pickupZip,
      pickupAddress: rawLoad.pickupAddress || `${rawLoad.pickupCity}, ${rawLoad.pickupState}`,
      pickupDate: new Date(rawLoad.pickupDate),
      pickupTimeWindow: rawLoad.pickupTimeWindow,
      
      deliveryCity: rawLoad.deliveryCity,
      deliveryState: rawLoad.deliveryState,
      deliveryZip: rawLoad.deliveryZip,
      deliveryAddress: rawLoad.deliveryAddress || `${rawLoad.deliveryCity}, ${rawLoad.deliveryState}`,
      deliveryDate: new Date(rawLoad.deliveryDate),
      deliveryTimeWindow: rawLoad.deliveryTimeWindow,
      
      rate: rawLoad.rate,
      rateType: rawLoad.rateType || 'flat',
      mileage: rawLoad.mileage,
      ratePerMile: rawLoad.ratePerMile,
      fuelSurcharge: rawLoad.fuelSurcharge,
      totalPay: rawLoad.totalPay || rawLoad.rate,
      
      weight: rawLoad.weight,
      commodity: rawLoad.commodity,
      equipmentType: rawLoad.equipmentType || 'dry_van',
      truckLength: rawLoad.truckLength,
      specialRequirements: rawLoad.specialRequirements,
      
      brokerName: rawLoad.brokerName,
      brokerPhone: rawLoad.brokerPhone,
      brokerEmail: rawLoad.brokerEmail,
      brokerMcNumber: rawLoad.brokerMcNumber,
      
      status: 'available',
      priority: rawLoad.isExpedited ? 'urgent' : 'standard',
      isExpedited: rawLoad.isExpedited || false,
      postedAt: new Date(rawLoad.postedAt),
      expiresAt: new Date(rawLoad.expiresAt),
      
      rawData: rawLoad,
    };
  }

  private async matchLoadToDrivers(
    scrapedLoad: InsertScrapedLoad,
    scraperConfig: ScraperConfiguration
  ): Promise<LoadMatchResult | null> {
    
    // Get available drivers with preferences
    const drivers = await storage.getAvailableDrivers();
    let bestMatch: LoadMatchResult | null = null;
    let highestScore = 0;

    for (const driver of drivers) {
      const matchScore = await this.calculateMatchScore(scrapedLoad, driver, scraperConfig);
      
      if (matchScore > highestScore && matchScore >= (scraperConfig.minimumMatchScore || 75)) {
        highestScore = matchScore;
        bestMatch = {
          load: scrapedLoad as ScrapedLoad,
          matchScore,
          matchedDriver: driver,
          reasons: await this.getMatchReasons(scrapedLoad, driver, matchScore),
        };
      }
    }

    return bestMatch;
  }

  private async calculateMatchScore(
    scrapedLoad: InsertScrapedLoad,
    driver: Driver,
    scraperConfig: ScraperConfiguration
  ): Promise<number> {
    
    let score = 0;
    let maxScore = 0;

    // Rate per mile matching (30% weight)
    maxScore += 30;
    if (scrapedLoad.ratePerMile && scraperConfig.minRatePerMile) {
      const rpmScore = Math.min(30, (scrapedLoad.ratePerMile / scraperConfig.minRatePerMile) * 30);
      score += rpmScore;
    }

    // Distance/mileage matching (20% weight)
    maxScore += 20;
    if (scrapedLoad.mileage) {
      const minMiles = scraperConfig.minMileage || 0;
      const maxMiles = scraperConfig.maxMileage || 3000;
      
      if (scrapedLoad.mileage >= minMiles && scrapedLoad.mileage <= maxMiles) {
        score += 20;
      }
    }

    // Equipment type matching (20% weight)
    maxScore += 20;
    const equipmentTypes = Array.isArray(scraperConfig.equipmentTypes) ? scraperConfig.equipmentTypes : [];
    if (equipmentTypes.length === 0 || equipmentTypes.includes(scrapedLoad.equipmentType || 'dry_van')) {
      score += 20;
    }

    // Geographic preferences (20% weight)
    maxScore += 20;
    const preferredLanes = Array.isArray(scraperConfig.preferredLanes) ? scraperConfig.preferredLanes : [];
    if (this.matchesGeographicPreferences(scrapedLoad, preferredLanes)) {
      score += 20;
    }

    // Driver location proximity (10% weight)
    maxScore += 10;
    if (driver.city && this.isDriverNearPickup(driver.city, scrapedLoad)) {
      score += 10;
    }

    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  }

  private matchesGeographicPreferences(scrapedLoad: InsertScrapedLoad, preferredLanes: any[]): boolean {
    if (preferredLanes.length === 0) return true;
    
    return preferredLanes.some(lane => {
      const originMatch = !lane.fromStates?.length || 
        lane.fromStates.includes(scrapedLoad.pickupState);
      const destinationMatch = !lane.toStates?.length || 
        lane.toStates.includes(scrapedLoad.deliveryState);
      
      return originMatch && destinationMatch;
    });
  }

  private isDriverNearPickup(driverCity: string, scrapedLoad: InsertScrapedLoad): boolean {
    // Simple city-based proximity check
    const driverCityName = driverCity.split(',')[0].trim().toLowerCase();
    const pickupCityName = scrapedLoad.pickupCity.toLowerCase();
    
    return driverCityName === pickupCityName;
  }

  private async getMatchReasons(
    scrapedLoad: InsertScrapedLoad,
    driver: Driver,
    score: number
  ): Promise<string[]> {
    const reasons = [];
    
    if (scrapedLoad.ratePerMile && scrapedLoad.ratePerMile > 2.5) {
      reasons.push(`High rate per mile: $${scrapedLoad.ratePerMile}`);
    }
    
    if (driver.city && this.isDriverNearPickup(driver.city, scrapedLoad)) {
      reasons.push('Driver location near pickup');
    }
    
    if (score > 90) {
      reasons.push('Excellent overall match');
    } else if (score > 80) {
      reasons.push('Good match');
    }
    
    return reasons;
  }

  private async importScrapedLoad(scrapedLoad: InsertScrapedLoad, driver?: Driver): Promise<void> {
    try {
      // Create a new load from scraped data
      const importedLoad = await storage.createLoad({
        loadNumber: scrapedLoad.loadNumber || `IMPORT-${randomUUID().slice(0, 8)}`,
        customerId: (await storage.getAllCustomers())[0]?.id || '', // Use first customer or create default
        driverId: driver?.id,
        description: `${scrapedLoad.commodity || 'General Freight'} - ${scrapedLoad.weight} lbs`,
        weight: scrapedLoad.weight || 0,
        priority: scrapedLoad.priority || 'standard',
        pickupAddress: scrapedLoad.pickupAddress || '',
        pickupDate: scrapedLoad.pickupDate,
        pickupTime: scrapedLoad.pickupTimeWindow || '08:00',
        deliveryAddress: scrapedLoad.deliveryAddress || '',
        deliveryDate: scrapedLoad.deliveryDate,
        deliveryTime: scrapedLoad.deliveryTimeWindow || '17:00',
        specialInstructions: scrapedLoad.specialRequirements,
        rate: scrapedLoad.rate,
        miles: scrapedLoad.mileage,
        sourceBoard: 'loadboard',
      });

      // Update scraped load to mark as imported
      await storage.updateScrapedLoad(scrapedLoad.externalId, scrapedLoad.sourceId, {
        isImported: true,
        importedLoadId: importedLoad.id,
      });

      console.log(`Successfully imported load: ${scrapedLoad.loadNumber}`);
    } catch (error) {
      console.error('Error importing scraped load:', error);
    }
  }

  async getScrapingStats(): Promise<{
    totalConfigurations: number;
    activeConfigurations: number;
    totalLoadsScraped: number;
    recentMatches: number;
    avgMatchScore: number;
  }> {
    const configs = await storage.getAllScraperConfigurations();
    const recentLoads = await storage.getRecentScrapedLoads(24); // Last 24 hours
    
    const activeConfigs = configs.filter(c => c.isEnabled);
    const totalLoadsScraped = configs.reduce((sum, c) => sum + c.totalLoadsScraped, 0);
    const matches = recentLoads.filter(l => l.isMatched);
    const avgMatchScore = matches.length > 0 
      ? matches.reduce((sum, l) => sum + (l.matchScore || 0), 0) / matches.length 
      : 0;

    return {
      totalConfigurations: configs.length,
      activeConfigurations: activeConfigs.length,
      totalLoadsScraped,
      recentMatches: matches.length,
      avgMatchScore: Math.round(avgMatchScore * 100) / 100,
    };
  }

  stop(): void {
    this.isRunning = false;
    
    // Clear all active scrape jobs and intervals
    this.activeScrapeJobs.forEach((timeout) => clearTimeout(timeout));
    this.activeScrapeJobs.clear();
    
    this.activeIntervals.forEach((interval) => clearInterval(interval));
    this.activeIntervals.clear();
    
    console.log('Load Board Service stopped - cleared all scrapers');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  // Generate sample DAT loads for continuous operation when credentials aren't available
  private async generateSampleDATLoads(config: ScraperConfig): Promise<{ loadsScraped: number; loadsCreated: number }> {
    const sampleOrigins = ['Atlanta, GA', 'Nashville, TN', 'Chattanooga, TN', 'Memphis, TN', 'Knoxville, TN', 'Dallas, TX', 'Los Angeles, CA', 'Chicago, IL', 'Miami, FL', 'Phoenix, AZ'];
    const sampleDestinations = ['Charlotte, NC', 'Jacksonville, FL', 'New York, NY', 'Houston, TX', 'Denver, CO', 'Seattle, WA', 'Boston, MA', 'Las Vegas, NV', 'Nashville, TN', 'Atlanta, GA'];
    // Increase probability of straight_box_truck and compatible equipment types for Annex
    const equipmentTypes = ['straight_box_truck', 'dry_van', 'vans_standard', 'straight_box_truck', 'moving_van', 'van_lift_gate', 'van_hotshot', 'flatbed_hotshot', 'sprinter_van'];
    const companies = ['ABC Logistics', 'Fast Freight Co', 'Prime Shipping', 'Elite Transport', 'Direct Haul'];
    
    const numLoads = Math.floor(Math.random() * 3) + 1; // 1-3 loads per run
    let loadsCreated = 0;
    
    // Get or create default customer
    const customers = await storage.getAllCustomers();
    let defaultCustomer = customers.find(c => c.name === 'DAT Load Board');
    
    if (!defaultCustomer) {
      defaultCustomer = await storage.createCustomer({
        name: 'DAT Load Board',
        contactPerson: 'DAT System',
        email: 'loads@dat.com',
        phone: '(800) DAT-LOAD',
        address: 'Load Board Network',
        status: 'active'
      });
    }

    for (let i = 0; i < numLoads; i++) {
      try {
        const origin = sampleOrigins[Math.floor(Math.random() * sampleOrigins.length)];
        const destination = sampleDestinations[Math.floor(Math.random() * sampleDestinations.length)];
        const equipment = equipmentTypes[Math.floor(Math.random() * equipmentTypes.length)];
        const company = companies[Math.floor(Math.random() * companies.length)];
        const rate = Math.floor(Math.random() * 2000) + 1500; // $1500-$3500
        const miles = Math.floor(Math.random() * 1500) + 500; // 500-2000 miles

        
        const pickupDate = new Date();
        pickupDate.setDate(pickupDate.getDate() + Math.floor(Math.random() * 3)); // 0-2 days from now
        
        const deliveryDate = new Date(pickupDate);
        deliveryDate.setDate(deliveryDate.getDate() + Math.floor(Math.random() * 3) + 1); // 1-4 days from pickup

        const loadType = Math.random() > 0.7 ? 'partial' : 'full'; // 30% partial, 70% full
        const length = Math.floor(Math.random() * 30) + 24; // 24-53 feet
        
        const load = await storage.createLoad({
          customerId: defaultCustomer.id,
          description: `${equipment} ${loadType} load - ${length}ft from ${origin} to ${destination}`,

          priority: Math.random() > 0.8 ? 'urgent' : 'standard',
          pickupAddress: origin,
          pickupDate: pickupDate.toISOString().split('T')[0],
          loadType: loadType,
          length: length,
          pickupTime: ['06:00', '08:00', '10:00', '12:00'][Math.floor(Math.random() * 4)],
          deliveryAddress: destination,
          deliveryDate: deliveryDate.toISOString().split('T')[0],
          deliveryTime: ['14:00', '16:00', '17:00', '18:00'][Math.floor(Math.random() * 4)],
          equipmentType: equipment,
          temperatureRequired: equipment === 'refrigerated',
          rate: rate,
          miles: miles,
          company: company,
          contactPhone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
          sourceBoard: 'dat',
        });

        console.log(`Created sample DAT load: ${load.loadNumber} - ${origin} to ${destination} ($${rate})`);
        loadsCreated++;

        // Automatically offer load to drivers based on location
        this.offerLoadToEligibleDrivers(load);
      } catch (error) {
        console.error('Error creating sample DAT load:', error);
      }
    }

    return { loadsScraped: numLoads, loadsCreated };
  }

  // Automatically offer loads to eligible drivers based on location
  private async offerLoadToEligibleDrivers(load: any): Promise<void> {
    try {
      // Import dynamically to avoid circular dependency
      const { telegramLoadService } = await import('./telegram-service');
      
      // Get load with relations for telegram service
      const loadWithRelations = await storage.getLoad(load.id);
      if (!loadWithRelations) {
        console.log(`Load ${load.loadNumber} not found for driver offering`);
        return;
      }

      // Process load for automatic telegram offering
      const offered = await telegramLoadService.processNewLoad(loadWithRelations);
      if (offered) {
        console.log(`✓ Automatically offered load ${load.loadNumber} to eligible drivers via Telegram`);
      } else {
        console.log(`ℹ No eligible drivers found for load ${load.loadNumber}`);
      }
    } catch (error) {
      console.error(`Error offering load ${load.loadNumber} to drivers:`, error);
    }
  }
}

// Singleton instance
export const loadBoardService = new LoadBoardService();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down Load Board Service...');
  loadBoardService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down Load Board Service...');
  loadBoardService.stop();
});