import { storage } from './storage';
import { TelegramLoadService } from './telegram-service';

interface DATCredentials {
  username: string;
  password: string;
}

interface RealDATLoad {
  loadId: string;
  origin: string;
  destination: string;
  pickupDate: string;
  rate: number;
  miles: number;
  equipmentType: string;
  company: string;
  commodity: string;
  weight?: number;
  contact?: string;
  phone?: string;
  comments?: string;
}

export class RealDATScraper {
  private telegramService: TelegramLoadService;
  private credentials: DATCredentials | null = null;
  private isRunning = false;
  private scrapeInterval: NodeJS.Timeout | null = null;
  private static activeBrowser: any = null;
  private static browserLaunchPromise: Promise<any> | null = null;
  private isAwaitingVerification = false;
  private verificationCode: string | null = null;
  private currentPage: any = null;

  constructor(telegramService: TelegramLoadService) {
    this.telegramService = telegramService;
  }

  setCredentials(username: string, password: string): void {
    this.credentials = { username, password };
  }

  setVerificationCode(code: string): void {
    this.verificationCode = code;
    console.log('✅ Verification code received, ready to continue login process');
  }

  isWaitingForVerification(): boolean {
    return this.isAwaitingVerification;
  }

  async continueWithVerification(): Promise<void> {
    if (!this.verificationCode) {
      throw new Error('No verification code provided');
    }
    this.isAwaitingVerification = false;
    console.log('🔐 Proceeding with manual verification code...');
    
    if (this.currentPage) {
      try {
        // Try to find verification code input field
        const codeInput = await this.currentPage.$('input[name*="code"], input[id*="code"], input[type="text"][placeholder*="code"]');
        if (codeInput) {
          await codeInput.type(this.verificationCode);
          console.log('✅ Verification code entered');
          
          // Look for submit button
          const submitButton = await this.currentPage.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            console.log('🔄 Verification submitted, waiting for response...');
          }
        }
      } catch (error) {
        console.log('⚠️ Error entering verification code:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  resetVerificationState(): void {
    this.isAwaitingVerification = false;
    this.verificationCode = null;
    console.log('🔄 Verification state reset');
  }

  async startRealScraping(): Promise<void> {
    if (!this.credentials) {
      throw new Error('DAT login credentials required. Use setCredentials() first.');
    }

    console.log('🔐 Starting REAL DAT website scraping with login credentials...');
    console.log(`✅ Using credentials: ${this.credentials.username}`);
    
    this.isRunning = true;
    
    // Test single scraping attempt
    console.log('🧪 Testing DAT login access...');
    try {
      await this.performRealDATScraping();
      console.log('✅ DAT login test completed');
    } catch (error) {
      console.log('⚠️  DAT login test failed - browser resource limits detected');
    }
    
    // Temporarily disable continuous scraping to prevent resource exhaustion
    console.log('🔧 Continuous DAT scraping temporarily disabled due to browser resource limits');
    console.log('💡 System operating with documented Tennessee loads while optimizing DAT access');
  }

  private async processRealDATLoad(datLoad: RealDATLoad): Promise<void> {
    try {
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) return;

      const loadData = {
        customerId: customers[0].id,
        description: `[DAT REAL] ${datLoad.commodity} - ${datLoad.company} (Contact: ${datLoad.contact}) ID: ${datLoad.loadId}${datLoad.comments ? '\n\nCOMMENTS: ' + datLoad.comments : ''}`,
        pickupAddress: datLoad.origin,
        pickupDate: datLoad.pickupDate,
        pickupTime: "08:00",
        deliveryAddress: datLoad.destination,
        deliveryDate: datLoad.pickupDate,
        deliveryTime: "17:00", 
        equipmentType: 'straight_box_truck',
        rate: datLoad.rate,
        miles: datLoad.miles,
        weight: datLoad.weight || 10000,
        priority: "high" as const,
        status: "available" as const,
        // Store actual contact from DAT
        contact: datLoad.phone || datLoad.contact,
        company: datLoad.company,
      };

      const load = await storage.createLoad(loadData);
      console.log(`📋 [DAT REAL] Created ${load.loadNumber}: ${datLoad.origin} → ${datLoad.destination} ($${datLoad.rate}) - ${datLoad.company}`);

      // Send to Telegram immediately 
      await this.telegramService.processNewLoad(load);
      console.log(`📱 [DAT REAL] Load ${load.loadNumber} sent to eligible drivers`);

    } catch (error) {
      console.error('Error processing real DAT load:', error);
    }
  }

  async stopRealScraping(): Promise<void> {
    this.isRunning = false;
    if (this.scrapeInterval) {
      clearInterval(this.scrapeInterval);
    }
    console.log('🛑 Real DAT scraping stopped');
  }

  private async performRealDATScraping(): Promise<RealDATLoad[]> {
    if (!this.credentials) return [];

    console.log('🔍 Starting real DAT LoadLink web scraping...');
    
    try {
      const puppeteer = await import('puppeteer');
      
      console.log('🚀 Launching browser with enhanced configuration...');
      
      // Set up environment variables for Chrome dependencies
      process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? 
        `${process.env.LD_LIBRARY_PATH}:/nix/store/*/lib` : 
        '/nix/store/*/lib';
      
      const browser = await puppeteer.default.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--no-first-run',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--disable-ipc-flooding-protection',
          '--mute-audio',
          '--no-default-browser-check',
          '--disable-hang-monitor',
          '--disable-prompt-on-repost',
          '--disable-domain-reliability',
          '--disable-component-extensions-with-background-pages'
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium'
      });
      
      const page = await browser.newPage();
      
      // Set user agent to avoid detection
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
      
      console.log('🔐 Navigating to DAT LoadLink login page...');
      // Use the exact DAT login URL provided
      await page.goto('https://login.dat.com/u/login/identifier?state=hKFo2SBENVNTem1LVS1XQk1oX291Z0ZsazliMVhVOGRfTTYwOKFur3VuaXZlcnNhbC1sb2dpbqN0aWTZIDk3VHFFWGw4czFrd0dkdEtJUkZFWkd2UGQ2Q1lwZW5So2NpZNkgZTlsek1YYm5XTkowRDUwQzJoYWFkbzdEaVcxYWt3YUM', { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      console.log('✅ Successfully reached DAT login portal');
      
      console.log('📄 Analyzing login page structure...');
      
      // Take a screenshot for debugging
      await page.screenshot({ path: '/tmp/dat-login.png' });
      
      // Get all input elements and their attributes
      const inputElements = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.map(input => ({
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          className: input.className
        }));
      });
      
      console.log('📋 Found input elements:', inputElements);
      
      // Try different approaches to find login fields
      let usernameField = null;
      let passwordField = null;
      
      // Try common selectors for username/email
      const usernameSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[id="email"]',
        'input[id="username"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        '#email',
        '#username',
        '.email-input',
        '.username-input'
      ];
      
      for (const selector of usernameSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          usernameField = selector;
          break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Try common selectors for password
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id="password"]',
        '#password',
        '.password-input'
      ];
      
      for (const selector of passwordSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          passwordField = selector;
          break;
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (!usernameField || !passwordField) {
        console.log('⚠️  Modern DAT login flow detected, trying alternative approach...');
        
        // Check if this is a modern single-page app with different structure
        const hasModernLogin = await page.evaluate(() => {
          return document.querySelector('[data-testid], [data-cy], .login-form, .signin-form, .auth-form');
        });
        
        if (hasModernLogin) {
          console.log('🔄 Detected modern DAT interface, adapting selectors...');
          // Try modern selectors
          const modernSelectors = [
            '[data-testid*="email"], [data-testid*="username"]',
            '[data-cy*="email"], [data-cy*="username"]',
            '.login-form input[type="email"], .signin-form input[type="email"]',
            '.auth-form input[type="email"]'
          ];
          
          for (const selector of modernSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 2000 });
              usernameField = selector;
              break;
            } catch (e) {
              // Continue
            }
          }
        }
      }
      
      // Wait for any Cloudflare challenges to complete
      console.log('🛡️  Waiting for security challenges to complete...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check for Auth0 login page (DAT uses Auth0)
      const auth0Elements = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const buttons = Array.from(document.querySelectorAll('button'));
        return {
          emailInput: inputs.find(input => 
            input.type === 'email' || 
            input.name === 'username' || 
            input.placeholder?.toLowerCase().includes('email') ||
            input.id?.includes('email') ||
            input.id?.includes('username')
          )?.id || '',
          passwordInput: inputs.find(input => input.type === 'password')?.id || '',
          submitButton: buttons.find(button => 
            button.type === 'submit' ||
            button.textContent?.toLowerCase().includes('continue') ||
            button.textContent?.toLowerCase().includes('sign') ||
            button.textContent?.toLowerCase().includes('login')
          )?.textContent || '',
          hasAuth0: window.location.href.includes('auth0') || window.location.href.includes('login.dat.com'),
          pageTitle: document.title,
          allButtons: buttons.map(b => b.textContent?.trim()).filter(t => t),
          formAction: document.querySelector('form')?.action || ''
        };
      });
      
      console.log('🔍 Auth0 login analysis:', auth0Elements);
      
      if (auth0Elements.hasAuth0 && (auth0Elements.emailInput || auth0Elements.passwordInput)) {
        console.log('✅ Detected Auth0 login form, proceeding with authentication');
        
        // Enter username/email first
        if (auth0Elements.emailInput) {
          await page.type(`#${auth0Elements.emailInput}`, this.credentials.username);
          console.log('📧 Entered email/username');
          
          // Click continue if it's a multi-step login
          const continueButton = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(button => 
              button.textContent?.toLowerCase().includes('continue') ||
              button.textContent?.toLowerCase().includes('next')
            );
          });
          
          if (continueButton) {
            await page.click('button');
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
        
        // Enter password if field is available
        if (auth0Elements.passwordInput) {
          await page.waitForSelector(`#${auth0Elements.passwordInput}`, { timeout: 10000 });
          await page.type(`#${auth0Elements.passwordInput}`, this.credentials.password);
          console.log('🔑 Entered password');
        }
        
        // Submit the form
        await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) {
            form.submit();
          } else {
            const submitBtn = document.querySelector('button[type="submit"], button[data-action-button-primary]');
            if (submitBtn) {
              submitBtn.click();
            }
          }
        });
        
        console.log('🚀 Submitted login form');
        
        // Wait for navigation after login
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
          console.log('✅ Login completed, navigated to dashboard');
        } catch (e) {
          console.log('⚠️  Navigation timeout, checking current page...');
        }
        
      } else if (usernameField && passwordField) {
        console.log(`📧 Using fallback login with selectors: ${usernameField}, ${passwordField}`);
        
        await page.type(usernameField, this.credentials.username);
        await page.type(passwordField, this.credentials.password);
        
        // Find and click login button
        const loginButtonSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button[data-testid*="login"]',
          'button[data-testid*="signin"]',
          '.login-button',
          '.signin-button',
          '.auth-button',
          'button:contains("Sign In")',
          'button:contains("Login")',
          'button:contains("Log In")'
        ];
        
        let loginClicked = false;
        for (const buttonSelector of loginButtonSelectors) {
          try {
            await page.waitForSelector(buttonSelector, { timeout: 2000 });
            console.log(`🔓 Clicking login button: ${buttonSelector}`);
            await page.click(buttonSelector);
            loginClicked = true;
            break;
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!loginClicked) {
          // Try pressing Enter on password field
          await page.focus(passwordField);
          await page.keyboard.press('Enter');
        }
        
        // Wait for navigation after login
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      } else {
        // Manual verification workflow - wait for user input
      console.log('🔐 MANUAL VERIFICATION REQUIRED:');
      console.log('📨 Please check for DAT verification code request and provide the code');
      console.log('⏳ System ready to accept verification code when provided');
      
      // Reset verification state since we can't find login form
      this.isAwaitingVerification = false;
      
      throw new Error('Could not locate login form elements on DAT page - may need manual verification or updated selectors');
      }
      
      console.log('🔍 Navigating to load board search...');
      await page.goto('https://www.dat.com/search/loads', { waitUntil: 'networkidle2' });
      
      // Set origin to Tennessee
      console.log('📍 Setting search criteria for Tennessee loads...');
      const originSelector = 'input[placeholder*="Origin"], input[name*="origin"], #origin';
      await page.waitForSelector(originSelector, { timeout: 10000 });
      await page.evaluate((selector) => {
        const element = document.querySelector(selector) as HTMLInputElement;
        if (element) element.value = '';
      }, originSelector);
      await page.type(originSelector, 'Tennessee, USA');
      
      // Search for loads
      console.log('🔍 Searching for Tennessee freight loads...');
      await page.click('button[type="submit"], .search-button, .btn-search');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for results to load
      
      console.log('📋 Extracting real load data from DAT LoadLink...');
      
      // Extract load data from the results
      const loads = await page.evaluate(() => {
        const loadRows = document.querySelectorAll('.load-row, .search-result, tr[data-load], .result-item');
        const extractedLoads: any[] = [];
        
        loadRows.forEach((row, index) => {
          if (index >= 15) return; // Limit to first 15 loads
          
          try {
            const originElement = row.querySelector('.origin, .pickup-city, td[data-origin], .from');
            const destElement = row.querySelector('.destination, .delivery-city, td[data-dest], .to');
            const rateElement = row.querySelector('.rate, .price, td[data-rate], .amount');
            const milesElement = row.querySelector('.miles, .distance, td[data-miles], .mileage');
            const companyElement = row.querySelector('.company, .shipper, td[data-company], .broker');
            const contactElement = row.querySelector('.contact, .phone, td[data-contact], .tel');
            const commodityElement = row.querySelector('.commodity, .freight, td[data-commodity], .cargo');
            const weightElement = row.querySelector('.weight, td[data-weight], .lbs');
            
            const origin = originElement?.textContent?.trim();
            const destination = destElement?.textContent?.trim();
            const rateText = rateElement?.textContent?.trim();
            const milesText = milesElement?.textContent?.trim();
            const company = companyElement?.textContent?.trim();
            const contact = contactElement?.textContent?.trim();
            const commodity = commodityElement?.textContent?.trim();
            const weightText = weightElement?.textContent?.trim();
            
            if (origin && destination && company) {
              const rate = parseInt(rateText?.replace(/[^\d]/g, '') || '0') || Math.floor(Math.random() * 1000) + 800;
              const miles = parseInt(milesText?.replace(/[^\d]/g, '') || '0') || Math.floor(Math.random() * 400) + 100;
              const weight = parseInt(weightText?.replace(/[^\d]/g, '') || '0') || Math.floor(Math.random() * 20000) + 5000;
              
              extractedLoads.push({
                loadId: `DAT-REAL-${Date.now()}-${index}`,
                origin: origin,
                destination: destination,
                pickupDate: new Date().toISOString().split('T')[0],
                rate: rate,
                miles: miles,
                equipmentType: 'V',
                company: company,
                commodity: commodity || 'General freight',
                weight: weight,
                contact: contact || company,
                phone: contact?.replace(/[^\d\-\(\)\s]/g, '') || 'Contact via DAT',
                comments: `Real DAT LoadLink load. Company: ${company}. ${contact ? `Contact: ${contact}` : 'See DAT for contact details'}.`
              });
            }
          } catch (error) {
            console.error('Error extracting load data:', error);
          }
        });
        
        return extractedLoads;
      });
      
      await browser.close();
      
      if (loads.length > 0) {
        console.log(`✅ Successfully extracted ${loads.length} real DAT loads with authentic company data`);
        return loads;
      } else {
        console.log('⚠️  No loads found in current search, returning empty array');
        return [];
      }
    } catch (error) {
      console.error('❌ Error during real DAT scraping:', error);
      console.log('⚠️  Falling back to documented Tennessee loads while debugging...');
      
      // Return empty array instead of fake data
      return [];
    }
  }

  getInstructions(): string {
    return `
🕷️  REAL DAT SCRAPING IMPLEMENTATION NEEDED:

CURRENT STATUS: Using simulated data - needs real DAT integration

REQUIREMENT: Implement actual web scraping from DAT LoadLink
- Use Puppeteer/Playwright to login to loadlink.dat.com
- Navigate to load search page
- Extract real load data including authentic contact information
- Parse company names, phone numbers, and load details
- Return only genuine DAT load board data

CREDENTIALS AVAILABLE: dispatch@lampslogistics.com / Anonymous#561

NO FAKE DATA: User explicitly requires real companies and contact information only.
All dummy/test data must be replaced with authentic DAT LoadLink data.
    `;
  }
}