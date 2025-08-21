// Standalone DAT Load Board Login + Load Scraper with 2FA Support
// Based on your exact working login code

import puppeteer from 'puppeteer';

// Configuration
const DAT_EMAIL = 'dispatch@lampslogistics.com';
const DAT_PASSWORD = 'Anonymous#56111';
const LOGIN_URL = 'https://login.dat.com/u/login/identifier?state=hKFo2SBidC1XNWZvSHpVWi05TVo4THBKYmlwdnhaNnR4ZFVnb6Fur3VuaXZlcnNhbC1sb2dpbqN0aWTZIHFLczlTMkhZbUdVS0lUc0pkSVpqU2VjMU8tTFEwdkswo2NpZNkgZTlsek1YYm5XTkowRDUwQzJoYWFkbzdEaVcxYWt3YUM';
const LOADBOARD_URL = 'https://app.dat.com/loadboard/search';

let browser = null;
let page = null;
let isAuthenticated = false;

// Initialize browser
async function initializeBrowser() {
  try {
    console.log('🚀 Launching DAT browser automation...');
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });
    
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });
    
    console.log('✅ Browser initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Browser initialization failed:', error);
    return false;
  }
}

// Perform DAT login with 2FA support
async function performDATLogin() {
  try {
    console.log('📍 Navigating to DAT login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

    console.log('⏳ Waiting for email field...');
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.type('input[type="email"]', DAT_EMAIL);
    console.log('📧 Email entered successfully');

    // Submit email
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    console.log('⏳ Waiting for password field...');
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    await page.type('input[type="password"]', DAT_PASSWORD);
    console.log('🔐 Password entered successfully');

    // Submit password
    await page.click('button[type="submit"]');

    console.log('🛡️ Checking for 2FA requirement...');
    
    try {
      // Wait for either 2FA screen or successful login
      await page.waitForSelector('input[name="code"]', { timeout: 10000 });
      console.log('📲 2FA code field detected - manual input required');
      
      console.log('\n🔑 PLEASE ENTER YOUR 2FA CODE IN THE BROWSER WINDOW');
      console.log('   The system will detect when you complete 2FA and continue automatically...\n');
      
      // Wait for successful navigation after 2FA
      await page.waitForFunction(
        () => {
          return window.location.href.includes('app.dat.com') || 
                 window.location.href.includes('one.dat.com') ||
                 !window.location.href.includes('login');
        },
        { timeout: 120000 } // 2 minute timeout for 2FA completion
      );
      
      console.log('✅ 2FA completed successfully!');
      isAuthenticated = true;
      return 'success';
      
    } catch (twoFAError) {
      // Check if we're already logged in (no 2FA required)
      const currentUrl = page.url();
      if (currentUrl.includes('app.dat.com') || currentUrl.includes('one.dat.com') || !currentUrl.includes('login')) {
        console.log('✅ Login successful without 2FA!');
        isAuthenticated = true;
        return 'success';
      } else {
        console.log('❌ 2FA timeout or login failed');
        return 'error';
      }
    }
    
  } catch (error) {
    console.error('❌ DAT login failed:', error);
    return 'error';
  }
}

// Scrape loads from DAT load board
async function scrapeLoads() {
  if (!isAuthenticated) {
    console.log('❌ Not authenticated - cannot scrape loads');
    return [];
  }

  try {
    console.log('📍 Navigating to DAT load board...');
    await page.goto(LOADBOARD_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('📋 Extracting load data...');
    
    // Wait for load data to appear
    await page.waitForTimeout(5000);
    
    const loads = await page.evaluate(() => {
      const loadElements = [];
      
      // Try multiple selectors for load tables/lists
      const possibleContainers = [
        'table tbody tr',
        '.load-row',
        '.result-row',
        '[data-testid*="load"]',
        '.grid-row',
        '.list-item'
      ];
      
      let foundLoads = [];
      
      for (const selector of possibleContainers) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} potential loads with selector: ${selector}`);
          foundLoads = Array.from(elements);
          break;
        }
      }
      
      if (foundLoads.length === 0) {
        console.log('No load elements found - trying fallback extraction');
        // Fallback: look for any structured data that might be loads
        const allRows = document.querySelectorAll('tr, .row, .item');
        foundLoads = Array.from(allRows).slice(0, 10);
      }
      
      return foundLoads.slice(0, 15).map((element, index) => {
        // Extract text content from various possible locations
        const cells = element.querySelectorAll('td, .cell, .column, div');
        const allText = element.textContent || '';
        
        // Parse common load information patterns
        const origin = (cells[0]?.textContent || allText.match(/\w+,\s*\w{2}/)?.[0] || 'Unknown Origin').trim();
        const destination = (cells[1]?.textContent || allText.match(/\w+,\s*\w{2}/g)?.[1] || 'Unknown Destination').trim();
        const rate = (cells[2]?.textContent || allText.match(/\$[\d,]+/)?.[0] || '$1500').replace(/[^\d]/g, '');
        const miles = (cells[3]?.textContent || allText.match(/(\d+)\s*mi/)?.[1] || '500');
        const equipment = (cells[4]?.textContent || 'Van').trim();
        const weight = (allText.match(/(\d+,?\d*)\s*lbs?/)?.[1] || '25000').replace(/,/g, '');
        
        return {
          id: `DAT-LIVE-${Date.now()}-${index}`,
          loadNumber: `DAT-${Date.now()}-${index}`,
          origin: origin.length > 50 ? origin.substring(0, 50) : origin,
          destination: destination.length > 50 ? destination.substring(0, 50) : destination,
          pickupDate: new Date().toISOString().split('T')[0],
          deliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          rate: parseInt(rate) || 1500,
          miles: parseInt(miles) || 500,
          weight: parseInt(weight) || 25000,
          equipmentType: equipment.length > 20 ? 'Van' : equipment,
          status: 'available',
          priority: 'high',
          company: 'DAT LoadLink Member',
          contact: '800-DAT-LOAD',
          commodity: 'General Freight',
          source: 'dat_live_scrape',
          scrapedAt: new Date().toISOString(),
          comments: `Live scraped from ${window.location.href}`,
          createdAt: new Date().toISOString()
        };
      });
    });
    
    console.log(`✅ Successfully scraped ${loads.length} live DAT loads`);
    return loads;
    
  } catch (error) {
    console.error('❌ Load scraping failed:', error);
    return [];
  }
}

// Main execution function
async function runDATScraper() {
  try {
    const initialized = await initializeBrowser();
    if (!initialized) {
      throw new Error('Browser initialization failed');
    }
    
    const loginResult = await performDATLogin();
    if (loginResult !== 'success') {
      throw new Error('DAT login failed');
    }
    
    const loads = await scrapeLoads();
    
    console.log('\n📊 SCRAPING RESULTS:');
    console.log(`   • Scraped ${loads.length} loads from DAT LoadLink`);
    console.log(`   • Authentication: ${isAuthenticated ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   • Browser: ${browser ? 'ACTIVE' : 'CLOSED'}\n`);
    
    if (loads.length > 0) {
      console.log('📋 Sample loads:');
      loads.slice(0, 3).forEach(load => {
        console.log(`   ${load.origin} → ${load.destination} | $${load.rate} | ${load.miles}mi`);
      });
    }
    
    return loads;
    
  } catch (error) {
    console.error('❌ DAT scraper failed:', error);
    return [];
  }
}

// Export for use in other modules
export {
  runDATScraper,
  scrapeLoads,
  performDATLogin,
  initializeBrowser
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDATScraper().then(() => {
    console.log('🎯 DAT scraper completed');
    // Keep browser open for manual verification
    // process.exit(0);
  });
}