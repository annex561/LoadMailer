// DAT Login Monitor - Initiates login and monitors for 2FA requirement
import { WorkingDATScraper } from './working-dat-scraper';

export class DATLoginMonitor {
  private scraper: WorkingDATScraper | null = null;
  private isMonitoring = false;
  
  async startLoginProcess() {
    try {
      console.log('🚀 Starting DAT login process...');
      
      if (!this.scraper) {
        this.scraper = new WorkingDATScraper();
        await this.scraper.initialize();
      }
      
      console.log('🔐 Initiating DAT login - this will trigger 2FA code to be sent to you');
      const loginResult = await this.scraper.loginToDAT();
      
      if (loginResult === 'needs_2fa') {
        console.log('📲 2FA code required - waiting for user to provide verification code');
        return {
          status: 'needs_2fa',
          message: 'DAT has sent a verification code to your registered device. Please enter it in the 2FA field.',
          ready: true
        };
      } else if (loginResult === true) {
        console.log('✅ Login successful - attempting to scrape loads immediately');
        const loads = await this.scraper.scrapeRealLoads();
        return {
          status: 'authenticated',
          message: 'Successfully authenticated with DAT',
          loads: loads,
          loadsFound: loads?.length || 0
        };
      } else {
        return {
          status: 'error',
          message: 'Failed to initiate DAT login process'
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
  
  async submit2FACode(code: string) {
    if (!this.scraper) {
      throw new Error('Login process not initiated');
    }
    
    return await this.scraper.submitTwoFACode(code);
  }
  
  getScraper() {
    return this.scraper;
  }
}

// Global instance
export const datLoginMonitor = new DATLoginMonitor();