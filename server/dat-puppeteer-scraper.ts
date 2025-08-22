import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

interface DATLoad {
  company: string;
  phone: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  rate: number;
  equipment_type: string;
  weight: number;
  commodity: string;
  pickup_date: string;
  miles: number;
  dat_load_id: string;
}

export class DATScraperService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isLoggedIn = false;
  private isLoggingIn = false;
  private loginAttempts = 0;

  async initialize() {
    if (this.browser) return;

    console.log('🚀 Initializing DAT scraper with Puppeteer...');
    
    this.browser = await puppeteer.launch({
      headless: false, // Keep visible for 2FA entry
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    this.page = await this.browser.newPage();
    
    // Set user agent
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('✅ DAT scraper initialized');
  }

  async login() {
    if (this.isLoggedIn || this.isLoggingIn || !this.page) return;
    
    this.isLoggingIn = true;
    this.loginAttempts++;
    console.log(`🔐 Starting DAT login process (attempt ${this.loginAttempts})...`);

    try {
      // Step 1: Navigate to DAT.com homepage
      console.log('📍 Navigating to DAT.com...');
      await this.page.goto('https://www.dat.com', { waitUntil: 'networkidle2', timeout: 30000 });

      // Step 2: Look for and click login/carriers button
      console.log('🔗 Looking for login access...');
      
      // Try multiple approaches to get to login
      const loginSelectors = [
        'a[href*="login"]',
        'a[href="#carriers"]', 
        'button:contains("Log In")',
        'a:contains("Log In")',
        '.login-btn',
        '#login-button'
      ];
      
      let loginClicked = false;
      for (const selector of loginSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          await this.page.click(selector);
          console.log(`✅ Clicked login element: ${selector}`);
          loginClicked = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!loginClicked) {
        // Try direct navigation to login page
        console.log('🔗 Direct navigation to login page...');
        await this.page.goto('https://www.dat.com/login', { waitUntil: 'networkidle2' });
      }

      // Give time for any redirects or modals
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 3: Look for DAT One Web link if needed
      try {
        const datOneLink = await this.page.$$eval('a', links => 
          links.filter(link => link.textContent?.includes('DAT One Web') || link.textContent?.includes('DAT One'))
        );
        if (datOneLink.length > 0) {
          console.log('🔗 Found DAT One Web link, clicking...');
          await this.page.click('a:has-text("DAT One Web"), a:has-text("DAT One")').catch(() => {});
          await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        }
      } catch (e) {
        console.log('⚠️ No DAT One Web link found, continuing...');
      }

      // Step 4: Enter credentials
      console.log('📧 Looking for login form...');
      
      // Wait for login form to appear
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[id*="email"]',
        'input[placeholder*="email"]'
      ];
      
      let emailInput = null;
      for (const selector of emailSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 5000 });
          emailInput = await this.page.$(selector);
          if (emailInput) {
            console.log(`✅ Found email input: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!emailInput) {
        throw new Error('Could not find email input field');
      }

      // Clear and enter email
      const emailSelector = emailSelectors.find(sel => emailInput);
      if (emailSelector) {
        await this.page.evaluate((sel) => {
          const element = document.querySelector(sel) as HTMLInputElement;
          if (element) element.value = '';
        }, emailSelector);
      }
      
      await emailInput.type('dispatch@lampslogistics.com', { delay: 100 });
      console.log('📧 Email entered');

      // Look for password field
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id*="password"]'
      ];
      
      let passwordInput = null;
      for (const selector of passwordSelectors) {
        try {
          passwordInput = await this.page.$(selector);
          if (passwordInput) {
            console.log(`✅ Found password input: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (passwordInput) {
        await passwordInput.type('Anonymous#56111', { delay: 100 });
        console.log('🔑 Password entered');
      }

      // Submit the form
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:contains("Log In")',
        'button:contains("Sign In")',
        '.login-btn',
        '.submit-btn'
      ];
      
      for (const selector of submitSelectors) {
        try {
          const submitBtn = await this.page.$(selector);
          if (submitBtn) {
            console.log(`🚀 Submitting login form with: ${selector}`);
            await submitBtn.click();
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Wait for login to process
      console.log('⏳ Waiting for login to process...');
      console.log('💡 Complete 2FA in the browser window if prompted');
      
      // Monitor for successful login or 2FA
      const maxWaitTime = 300000; // 5 minutes
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const currentUrl = this.page.url();
        
        if (currentUrl.includes('one.dat.com') || 
            (currentUrl.includes('dat.com') && !currentUrl.includes('login'))) {
          this.isLoggedIn = true;
          console.log('✅ Successfully logged into DAT!');
          console.log(`📍 Current URL: ${currentUrl}`);
          return;
        }
        
        // Check if 2FA is required
        if (this.page) {
          const pageContent = await this.page.content();
          if (pageContent.includes('verification') || pageContent.includes('2FA') || pageContent.includes('authenticator')) {
            console.log('🛑 2FA detected - please complete in browser window');
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      throw new Error('Login timeout - please check browser window for issues');

    } catch (error) {
      console.error('❌ DAT login failed:', error);
      this.isLoggedIn = false;
      
      // Debug information
      if (this.page) {
        const currentUrl = this.page.url();
        const title = await this.page.title();
        console.log(`📍 Current URL: ${currentUrl}`);
        console.log(`📄 Page Title: ${title}`);
      }
    } finally {
      this.isLoggingIn = false;
    }
  }

  async scrapeLoads(): Promise<DATLoad[]> {
    if (!this.isLoggedIn || !this.page) {
      console.log('⚠️ Not logged in, attempting login first...');
      await this.login();
      if (!this.isLoggedIn) {
        throw new Error('Cannot scrape loads - login failed');
      }
    }

    console.log('🔍 Starting load scraping...');

    try {
      // Navigate to load search
      console.log('📍 Navigating to load search...');
      await this.page.goto('https://one.dat.com/load-search', { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Apply filters for our target loads
      await this.applyFilters();

      // Extract load data
      const loads = await this.extractLoadData();
      
      console.log(`🎯 Successfully extracted ${loads.length} loads from DAT`);
      return loads;

    } catch (error) {
      console.error('❌ Error scraping loads:', error);
      return [];
    }
  }

  private async applyFilters() {
    if (!this.page) return;

    console.log('🔧 Applying search filters...');

    try {
      // Equipment type filters - target box trucks, sprinter vans, dry vans
      const equipmentSelectors = [
        'input[value*="Van"]',
        'input[value*="van"]', 
        'input[value*="Box"]',
        'input[value*="Straight"]',
        'select[name*="equipment"] option[value*="Van"]',
        'select[name*="equipment"] option[value*="Box"]'
      ];
      
      for (const selector of equipmentSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000 });
          await this.page.click(selector);
          console.log(`✅ Applied equipment filter: ${selector}`);
          break;
        } catch (e) {
          continue;
        }
      }

      // Geographic filter - southeastern states
      const originSelectors = [
        'input[name*="origin"]',
        'input[placeholder*="Origin"]',
        'input[placeholder*="origin"]',
        '#origin-input'
      ];
      
      for (const selector of originSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000 });
          await this.page.evaluate((sel) => {
            const element = document.querySelector(sel) as HTMLInputElement;
            if (element) element.value = '';
          }, selector);
          await this.page.type(selector, 'TN, KY, GA, AL, NC, SC, FL');
          console.log('✅ Applied geographic filter');
          break;
        } catch (e) {
          continue;
        }
      }

      // Rate filter - minimum $500
      const rateSelectors = [
        'input[name*="rate"]',
        'input[placeholder*="Rate"]',
        'input[name*="min"]'
      ];
      
      for (const selector of rateSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000 });
          await this.page.evaluate((sel) => {
            const element = document.querySelector(sel) as HTMLInputElement;
            if (element) element.value = '';
          }, selector);
          await this.page.type(selector, '500');
          console.log('✅ Applied rate filter');
          break;
        } catch (e) {
          continue;
        }
      }

      // Submit search
      const searchButtons = [
        'button[type="submit"]',
        'button:contains("Search")',
        'button:contains("Apply")',
        '.search-button',
        '#search-btn'
      ];
      
      for (const selector of searchButtons) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000 });
          await this.page.click(selector);
          console.log('✅ Submitted search');
          break;
        } catch (e) {
          continue;
        }
      }

      // Wait for results to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.log('⚠️ Filter application had issues, continuing with default search...');
    }
  }

  private async extractLoadData(): Promise<DATLoad[]> {
    if (!this.page) return [];

    console.log('📋 Extracting load data from page...');

    const loads = await this.page.evaluate(() => {
      const extractedLoads: any[] = [];
      
      // Multiple possible selectors for load rows
      const loadRowSelectors = [
        '.load-row',
        '.search-result',
        'tr[data-load-id]',
        '.load-item',
        '[data-testid*="load"]',
        '.result-row'
      ];
      
      let loadElements: NodeListOf<Element> | null = null;
      for (const selector of loadRowSelectors) {
        loadElements = document.querySelectorAll(selector);
        if (loadElements.length > 0) break;
      }
      
      // If no specific load rows found, try table rows
      if (!loadElements || loadElements.length === 0) {
        loadElements = document.querySelectorAll('table tr, .table tr');
      }
      
      loadElements.forEach((element, index) => {
        try {
          const text = element.textContent || '';
          
          // Skip header rows and empty rows
          if (text.toLowerCase().includes('company') || 
              text.toLowerCase().includes('rate') || 
              text.trim().length < 50) {
            return;
          }
          
          // Look for phone numbers
          const phoneMatch = text.match(/(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/);
          if (!phoneMatch) return;
          
          // Look for rates
          const rateMatch = text.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
          if (!rateMatch) return;
          
          // Look for state abbreviations
          const stateMatches = text.match(/\b[A-Z]{2}\b/g);
          if (!stateMatches || stateMatches.length < 2) return;
          
          // Look for city/state patterns
          const cityStatePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*([A-Z]{2})/g;
          const cityStateMatches = Array.from(text.matchAll(cityStatePattern));
          
          if (cityStateMatches.length < 2) return;
          
          // Extract company name
          const companyMatch = text.match(/^[^a-z]*([A-Z][A-Za-z\s&.-]+(?:LLC|Inc|Corp|Co)?)/);
          const company = companyMatch ? companyMatch[1].trim() : `DAT Company ${index + 1}`;
          
          // Parse data
          const phone = phoneMatch[0];
          const rate = parseInt(rateMatch[1].replace(/[^0-9]/g, ''));
          const originCity = cityStateMatches[0][1];
          const originState = cityStateMatches[0][2];
          const destCity = cityStateMatches[1][1];
          const destState = cityStateMatches[1][2];
          
          // Determine equipment type
          let equipmentType = 'dry_van';
          const lowerText = text.toLowerCase();
          if (lowerText.includes('reefer') || lowerText.includes('refrigerat')) equipmentType = 'reefer';
          if (lowerText.includes('flatbed') || lowerText.includes('flat')) equipmentType = 'flatbed';
          if (lowerText.includes('box') || lowerText.includes('straight')) equipmentType = 'box_truck';
          if (lowerText.includes('sprinter') || lowerText.includes('cargo van')) equipmentType = 'sprinter_van';
          
          // Extract weight and miles
          const weightMatch = text.match(/(\d{1,2}[,.]?\d{0,3})\s*(?:lbs?|pounds?|#)/i);
          const weight = weightMatch ? parseInt(weightMatch[1].replace(/[^0-9]/g, '')) : 0;
          
          const milesMatch = text.match(/(\d{1,4})\s*(?:mi|miles?)/i);
          const miles = milesMatch ? parseInt(milesMatch[1]) : 0;
          
          // Only include loads with viable data and reasonable rates
          if (rate >= 500 && rate <= 10000 && company.length > 3) {
            extractedLoads.push({
              company: company,
              phone: phone,
              origin_city: originCity,
              origin_state: originState,
              destination_city: destCity,
              destination_state: destState,
              rate: rate,
              equipment_type: equipmentType,
              weight: weight,
              commodity: 'General Freight',
              pickup_date: new Date().toISOString().split('T')[0] + 'T08:00:00Z',
              miles: miles,
              dat_load_id: `DAT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            });
          }
          
        } catch (error) {
          console.log('Error extracting load:', error);
        }
      });
      
      return extractedLoads;
    });

    return loads;
  }

  async getLoginStatus(): Promise<{ isLoggedIn: boolean; isLoggingIn: boolean }> {
    return {
      isLoggedIn: this.isLoggedIn,
      isLoggingIn: this.isLoggingIn
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      console.log('🔒 DAT scraper browser closed');
    }
  }
}

export const datScraperService = new DATScraperService();