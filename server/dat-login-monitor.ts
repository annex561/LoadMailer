// DAT Login Monitor - Uses simplified scraper method
import { provenDATScraper } from './proven-dat-scraper';
import { SimplifiedDATScraper } from './simplified-dat-scraper';

export class DATLoginMonitor {
  private isMonitoring = false;
  private simplifiedScraper: SimplifiedDATScraper | null = null;
  
  async startLoginProcess() {
    try {
      console.log('🚀 Starting improved DAT login process...');
      
      // Try simplified scraper first
      this.simplifiedScraper = new SimplifiedDATScraper();
      const initialized = await this.simplifiedScraper.initialize();
      
      if (initialized) {
        console.log('🔐 Attempting automated DAT login...');
        const loginResult = await this.simplifiedScraper.attemptLogin();
        
        if (loginResult === 'success') {
          console.log('✅ DAT login successful! Starting load scraping...');
          return {
            status: 'success',
            message: 'DAT login successful! Real load scraping activated.',
            authenticated: true
          };
        } else if (loginResult === 'needs_2fa') {
          console.log('📲 2FA required - user must complete manually');
          return {
            status: 'needs_2fa',
            message: 'Login successful but 2FA required. Complete verification in your browser.',
            ready: true
          };
        }
      }
      
      // Fallback to original method if simplified fails
      console.log('⚡ Trying fallback method...');
      const fallbackInitialized = await provenDATScraper.initialize();
      if (!fallbackInitialized) {
        throw new Error('Both scrapers failed to initialize');
      }
      
      console.log('🔐 Fallback DAT login method...');
      const loginResult = await provenDATScraper.startLogin();
      
      if (loginResult === 'needs_2fa') {
        return {
          status: 'needs_2fa',
          message: 'DAT login started. Complete 2FA if prompted.',
          ready: true
        };
      } else {
        return {
          status: 'error',
          message: 'Login process completed but authentication unclear'
        };
      }
    } catch (error) {
      console.error('❌ Login monitor error:', error);
      return {
        status: 'error',
        message: `Login error: ${error.message}`
      };
    }
  }
  
  async checkAuthenticationStatus() {
    return await provenDATScraper.checkLoginStatus();
  }
  
  async scrapeLoads() {
    return await provenDATScraper.scrapeRealLoads();
  }
}

// Global instance
export const datLoginMonitor = new DATLoginMonitor();