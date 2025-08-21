// DAT Login Monitor - Uses proven scraper method
import { provenDATScraper } from './proven-dat-scraper';

export class DATLoginMonitor {
  private isMonitoring = false;
  
  async startLoginProcess() {
    try {
      console.log('🚀 Starting proven DAT login process...');
      
      // Initialize the proven scraper
      const initialized = await provenDATScraper.initialize();
      if (!initialized) {
        throw new Error('Failed to initialize proven DAT scraper');
      }
      
      console.log('🔐 Initiating DAT login with proven method');
      const loginResult = await provenDATScraper.startLogin();
      
      if (loginResult === 'needs_2fa') {
        console.log('📲 2FA required - user must complete manually in browser');
        return {
          status: 'needs_2fa',
          message: 'Please complete 2FA verification in the browser window that opened. Once complete, the system will detect authentication and load your real DAT loads.',
          ready: true
        };
      } else {
        return {
          status: 'error',
          message: 'Unexpected login result'
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