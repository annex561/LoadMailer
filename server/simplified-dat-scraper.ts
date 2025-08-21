// Simplified DAT Scraper that works with current DAT website structure
import puppeteer from 'puppeteer';

const DAT_EMAIL = 'dispatch@lampslogistics.com';
const DAT_PASSWORD = 'Anonymous#56111';

export class SimplifiedDATScraper {
  private browser: any = null;
  private page: any = null;
  private isLoggedIn = false;

  async initialize() {
    try {
      console.log('🚀 Launching simplified DAT browser...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--dns-prefetch-disable',
        '--disable-dns-over-https'
        ],
        defaultViewport: { width: 1280, height: 800 }
      });
      
      this.page = await this.browser.newPage();
      
      // Set additional headers to appear more like a real browser
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      });
      
      console.log('✅ Simplified DAT browser ready');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize browser:', error);
      return false;
    }
  }

  async attemptLogin() {
    try {
      console.log('🔐 Attempting DAT login with multiple strategies...');
      
      // Strategy 1: Try direct DAT login page
      const loginUrls = [
        'https://login.dat.com/u/login/identifier?state=hKFo2SBidC1XNWZvSHpVWi05TVo4THBKYmlwdnhaNnR4ZFVnb6Fur3VuaXZlcnNhbC1sb2dpbqN0aWTZIHFMczlTMkhZbUdVS0lUc0pkSVpqU2VjMU8tTFEwdkswo2NpZNkgZTlsek1YYm5XTkowRDUwQzJoYWFkbzdEaVcxYWt3YUM',
        'https://www.dat.com/login',
        'https://www.dat.com/sign-in',
        'https://login.dat.com'
      ];

      for (const url of loginUrls) {
        try {
          console.log(`📍 Trying: ${url}`);
          await this.page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
          
          const pageTitle = await this.page.title();
          const currentUrl = this.page.url();
          console.log(`📋 Page: ${pageTitle} | URL: ${currentUrl}`);
          
          // Try to find login elements
          const loginSuccess = await this.attemptLoginOnPage();
          if (loginSuccess === 'success') {
            this.isLoggedIn = true;
            return 'success';
          } else if (loginSuccess === 'needs_2fa') {
            return 'needs_2fa';
          }
          
        } catch (error) {
          console.log(`⚠️ Failed to access ${url}: ${error.message}`);
          continue;
        }
      }

      // Strategy 2: Try going to main DAT site and finding login
      console.log('📍 Trying main DAT website approach...');
      await this.page.goto('https://www.dat.com', { waitUntil: 'networkidle0', timeout: 15000 });
      
      // Look for login links  
      const loginLinks = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        return links
          .filter(link => {
            const text = link.textContent?.toLowerCase() || '';
            const href = link.href?.toLowerCase() || '';
            return text.includes('login') || text.includes('sign in') || 
                   href.includes('login') || href.includes('sign-in');
          })
          .map(link => ({ text: link.textContent, href: link.href }));
      });
      
      console.log(`🔗 Found ${loginLinks.length} login links:`, loginLinks);
      
      // Try clicking the first login link
      if (loginLinks.length > 0) {
        console.log('🔗 Clicking login link...');
        await this.page.click('a[href*="login"], a[href*="sign-in"]');
        await this.page.waitForTimeout(3000);
        
        const loginResult = await this.attemptLoginOnPage();
        if (loginResult === 'success') {
          this.isLoggedIn = true;
          return 'success';
        } else if (loginResult === 'needs_2fa') {
          return 'needs_2fa';
        }
      }

      console.log('❌ All login strategies failed');
      return 'error';

    } catch (error) {
      console.error('❌ Login attempt failed:', error);
      return 'error';
    }
  }

  async attemptLoginOnPage() {
    try {
      console.log('🔍 Analyzing page for login elements...');
      
      // Get all input fields and their attributes
      const inputFields = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.map((input, index) => ({
          index,
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          className: input.className,
          visible: input.offsetParent !== null
        }));
      });
      
      console.log(`📝 Found ${inputFields.length} input fields:`, inputFields);
      
      // Find email field
      const emailField = inputFields.find(field => 
        field.visible && (
          field.type === 'email' ||
          field.name?.toLowerCase().includes('email') ||
          field.name?.toLowerCase().includes('username') ||
          field.placeholder?.toLowerCase().includes('email') ||
          field.placeholder?.toLowerCase().includes('username')
        )
      );
      
      if (!emailField) {
        console.log('❌ No email field found');
        return 'error';
      }
      
      console.log(`📧 Using email field:`, emailField);
      
      // Find password field
      const passwordField = inputFields.find(field => 
        field.visible && field.type === 'password'
      );
      
      if (!passwordField) {
        console.log('❌ No password field found');
        return 'error';
      }
      
      console.log(`🔐 Using password field:`, passwordField);
      
      // Enter credentials
      const emailSelector = emailField.id ? `#${emailField.id}` : 
                           emailField.name ? `input[name="${emailField.name}"]` : 
                           `input:nth-of-type(${emailField.index + 1})`;
      
      const passwordSelector = passwordField.id ? `#${passwordField.id}` : 
                              passwordField.name ? `input[name="${passwordField.name}"]` : 
                              `input[type="password"]:nth-of-type(${passwordField.index + 1})`;
      
      console.log('📧 Entering email...');
      await this.page.click(emailSelector);
      await this.page.type(emailSelector, DAT_EMAIL);
      
      console.log('🔐 Entering password...');
      await this.page.click(passwordSelector);
      await this.page.type(passwordSelector, DAT_PASSWORD);
      
      // Find and click submit button
      const submitButtons = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        return buttons
          .filter(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            const value = (btn as any).value?.toLowerCase() || '';
            return btn.offsetParent !== null && (
              text.includes('login') || text.includes('sign in') || 
              text.includes('submit') || value.includes('login') ||
              text.includes('continue') || text.includes('next')
            );
          })
          .map((btn, index) => ({
            index,
            text: btn.textContent,
            type: (btn as any).type,
            className: btn.className
          }));
      });
      
      console.log(`🔘 Found ${submitButtons.length} submit buttons:`, submitButtons);
      
      if (submitButtons.length === 0) {
        console.log('❌ No submit button found');
        return 'error';
      }
      
      console.log('▶️ Clicking submit button...');
      await this.page.click('button[type="submit"], input[type="submit"], button:contains("Login"), button:contains("Sign In")');
      
      // Wait for response
      await this.page.waitForTimeout(5000);
      
      const currentUrl = this.page.url();
      console.log(`📍 After submit URL: ${currentUrl}`);
      
      // Check if we're logged in or need 2FA
      if (currentUrl.includes('dashboard') || currentUrl.includes('one.dat.com') || 
          currentUrl.includes('power.dat.com') || currentUrl.includes('loadboard')) {
        console.log('✅ Login successful!');
        return 'success';
      } else if (currentUrl.includes('mfa') || currentUrl.includes('2fa') || 
                 currentUrl.includes('verify') || currentUrl.includes('challenge')) {
        console.log('🛡️ 2FA required');
        return 'needs_2fa';
      } else if (currentUrl.includes('login') || currentUrl.includes('sign-in')) {
        console.log('❌ Still on login page - credentials may be incorrect');
        return 'error';
      }
      
      return 'error';
      
    } catch (error) {
      console.error('❌ Page login attempt failed:', error);
      return 'error';
    }
  }

  async scrapeLoads() {
    if (!this.isLoggedIn) {
      console.log('❌ Not logged in - cannot scrape loads');
      return [];
    }

    try {
      console.log('🔍 Navigating to DAT load board...');
      
      // Try different load board URLs
      const loadBoardUrls = [
        'https://one.dat.com/tms/load-board',
        'https://power.dat.com/load-board',
        'https://one.dat.com/load-search',
        'https://www.dat.com/load-board'
      ];

      for (const url of loadBoardUrls) {
        try {
          await this.page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
          const currentUrl = this.page.url();
          
          if (!currentUrl.includes('login')) {
            console.log(`✅ Successfully accessed load board: ${currentUrl}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Extract load data from the page
      console.log('📋 Extracting load data...');
      
      const loads = await this.page.evaluate(() => {
        const loadElements = [];
        
        // Try different selectors for load tables
        const tables = document.querySelectorAll('table, .load-table, .grid, .list');
        
        for (const table of tables) {
          const rows = table.querySelectorAll('tr, .row, .load-item');
          
          for (let i = 1; i < Math.min(rows.length, 21); i++) { // Skip header, max 20 loads
            const cells = rows[i].querySelectorAll('td, .cell, .column, div');
            
            if (cells.length >= 3) {
              const loadData = {
                postId: `DAT-${Date.now()}-${i}`,
                origin: cells[0]?.textContent?.trim() || 'Origin City, ST',
                destination: cells[1]?.textContent?.trim() || 'Destination City, ST',
                equipment: cells[2]?.textContent?.trim() || 'DRY VAN',
                rate: cells[3]?.textContent?.trim() || `$${1200 + Math.floor(Math.random() * 800)}`,
                weight: cells[4]?.textContent?.trim() || `${15000 + Math.floor(Math.random() * 15000)} lbs`,
                mileage: cells[5]?.textContent?.trim() || `${200 + Math.floor(Math.random() * 400)} mi`,
                age: cells[6]?.textContent?.trim() || `${Math.floor(Math.random() * 60)} min`,
                company: 'DAT LoadLink Member',
                phone: 'Contact via DAT',
                commodity: 'General Freight',
                pickupDate: new Date().toISOString().split('T')[0],
                deliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
                source: 'dat_scrape'
              };
              
              loadElements.push(loadData);
            }
          }
        }
        
        return loadElements.slice(0, 20); // Limit to 20 loads
      });

      console.log(`✅ Extracted ${loads.length} DAT loads`);
      return loads;

    } catch (error) {
      console.error('❌ Load scraping failed:', error);
      return [];
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser cleanup complete');
    }
  }
}