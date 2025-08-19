import puppeteer from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

interface DATLoginStep {
  step: number;
  description: string;
  action: 'navigate' | 'wait_for_user' | 'enter_credentials' | 'wait_for_verification' | 'complete';
  url?: string;
  instructions?: string;
  completed: boolean;
}

export class ManualDATLogin {
  private browser: any = null;
  private page: any = null;
  private currentStep = 0;
  private steps: DATLoginStep[] = [
    {
      step: 1,
      description: 'Navigate to DAT login page',
      action: 'navigate',
      url: 'https://login.dat.com/u/login/identifier?state=hKFo2SBENVNTem1LVS1XQk1oX291Z0ZsazliMVhVOGRfTTYwOKFur3VuaXZlcnNhbC1sb2dpbqN0aWTZIDk3VHFFWGw4czFrd0dkdEtJUkZGWkd2UGQ2Q1lwZW5To2NpZNkgZTlsek1YYm5XTkowRDUwQzJoYWFkbzdEaVcxYWt3YUM',
      completed: false
    },
    {
      step: 2,
      description: 'Enter email credentials',
      action: 'enter_credentials',
      instructions: 'I will enter dispatch@lampslogistics.com in the email field',
      completed: false
    },
    {
      step: 3,
      description: 'Wait for user to complete Cloudflare challenge',
      action: 'wait_for_user',
      instructions: 'Please complete the Cloudflare security challenge manually',
      completed: false
    },
    {
      step: 4,
      description: 'Enter password when prompted',
      action: 'wait_for_user',
      instructions: 'Please enter your DAT password when prompted',
      completed: false
    },
    {
      step: 5,
      description: 'Handle any verification codes',
      action: 'wait_for_verification',
      instructions: 'Handle any 2FA or verification codes if required',
      completed: false
    },
    {
      step: 6,
      description: 'Complete login process',
      action: 'complete',
      instructions: 'Login completed successfully',
      completed: false
    }
  ];

  async startManualLogin(): Promise<{ success: boolean; currentStep: DATLoginStep; screenshot?: string }> {
    try {
      console.log('🚀 Starting manual DAT login process...');
      
      // Launch browser with stealth mode using system Chromium
      this.browser = await puppeteer.launch({
        headless: true, // Must be headless in server environment
        executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium', // Use system Chromium
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--single-process', // Required for Replit
          '--no-crash-upload'
        ]
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720 });
      
      // Set user agent to look more human
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      return await this.executeCurrentStep();
    } catch (error) {
      console.error('❌ Error starting manual DAT login:', error);
      return {
        success: false,
        currentStep: this.steps[this.currentStep],
      };
    }
  }

  async executeCurrentStep(): Promise<{ success: boolean; currentStep: DATLoginStep; screenshot?: string }> {
    const step = this.steps[this.currentStep];
    console.log(`📋 Executing Step ${step.step}: ${step.description}`);

    try {
      switch (step.action) {
        case 'navigate':
          await this.page.goto(step.url, { waitUntil: 'networkidle0', timeout: 30000 });
          console.log('✅ Successfully navigated to DAT login page');
          step.completed = true;
          this.currentStep++;
          break;

        case 'enter_credentials':
          // Look for email input field
          const emailInput = await this.page.$('input[type="email"], input[name="username"], input[id*="email"]');
          if (emailInput) {
            await emailInput.type('dispatch@lampslogistics.com', { delay: 100 });
            console.log('✅ Email address entered');
            
            // Look for submit button
            const submitButton = await this.page.$('button[type="submit"], input[type="submit"]');
            if (submitButton) {
              await submitButton.click();
              console.log('🔄 Clicked submit button');
            }
          }
          step.completed = true;
          this.currentStep++;
          break;

        case 'wait_for_user':
        case 'wait_for_verification':
          console.log(`⏳ ${step.instructions}`);
          // Don't auto-advance - wait for user input
          break;

        case 'complete':
          console.log('🎉 Manual DAT login process completed!');
          step.completed = true;
          break;
      }

      // Take screenshot for user reference
      const screenshot = await this.page.screenshot({ 
        encoding: 'base64',
        fullPage: false 
      });

      return {
        success: true,
        currentStep: this.steps[this.currentStep],
        screenshot: `data:image/png;base64,${screenshot}`
      };

    } catch (error) {
      console.error(`❌ Error executing step ${step.step}:`, error);
      return {
        success: false,
        currentStep: step
      };
    }
  }

  async nextStep(): Promise<{ success: boolean; currentStep: DATLoginStep; screenshot?: string }> {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
      return await this.executeCurrentStep();
    } else {
      return {
        success: true,
        currentStep: this.steps[this.currentStep]
      };
    }
  }

  getCurrentStep(): DATLoginStep {
    return this.steps[this.currentStep];
  }

  getAllSteps(): DATLoginStep[] {
    return this.steps;
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  isComplete(): boolean {
    return this.currentStep >= this.steps.length - 1 && this.steps[this.currentStep].completed;
  }

  async getStatus(): Promise<{ success: boolean; currentStep: DATLoginStep; allSteps: DATLoginStep[]; isComplete: boolean; screenshot?: string }> {
    let screenshot: string | undefined;
    
    // Capture screenshot if browser is active
    if (this.browser && this.page) {
      try {
        const screenshotBuffer = await this.page.screenshot({ 
          type: 'png', 
          fullPage: false,
          clip: { x: 0, y: 0, width: 1200, height: 800 }
        });
        screenshot = screenshotBuffer.toString('base64');
      } catch (error) {
        console.log('Could not capture screenshot:', (error as Error).message);
      }
    }
    
    return {
      success: true,
      currentStep: this.steps[this.currentStep],
      allSteps: this.steps,
      isComplete: this.isComplete(),
      screenshot
    };
  }

  async proceedToNextStep(input?: { verificationCode?: string; password?: string; userInput?: string }): Promise<{ success: boolean; currentStep: DATLoginStep; message?: string }> {
    try {
      console.log(`🚀 Proceeding from step ${this.currentStep + 1}...`);
      
      if (!this.page) {
        throw new Error('Browser page not available');
      }

      const currentStepIndex = this.currentStep;
      const step = this.steps[currentStepIndex];
      
      switch (step.action) {
        case 'navigate':
          // Already handled in startManualLogin
          step.completed = true;
          if (this.currentStep < this.steps.length - 1) this.currentStep++;
          break;
          
        case 'enter_credentials':
          await this.enterEmailCredentials();
          step.completed = true;
          if (this.currentStep < this.steps.length - 1) this.currentStep++;
          break;
          
        case 'wait_for_user':
          if (input?.userInput || input?.password) {
            if (input.password) {
              await this.enterPassword(input.password);
            }
            step.completed = true;
            if (this.currentStep < this.steps.length - 1) this.currentStep++;
          } else {
            return {
              success: false,
              currentStep: step,
              message: 'User input is required for this step'
            };
          }
          break;
          
        case 'wait_for_verification':
          if (input?.verificationCode) {
            await this.enterVerificationCode(input.verificationCode);
            step.completed = true;
            if (this.currentStep < this.steps.length - 1) this.currentStep++;
          } else {
            return {
              success: false,
              currentStep: step,
              message: 'Verification code is required for this step'
            };
          }
          break;
          
        case 'complete':
          step.completed = true;
          break;
      }
      
      return {
        success: true,
        currentStep: this.steps[this.currentStep],
        message: 'Step completed successfully'
      };
      
    } catch (error) {
      console.error(`❌ Error in step:`, error);
      return {
        success: false,
        currentStep: this.steps[this.currentStep],
        message: `Error: ${(error as Error).message}`
      };
    }
  }

  private async enterEmailCredentials(): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    console.log('📧 Entering email credentials...');
    
    // Try multiple selectors for email input
    const emailSelectors = [
      'input[name="username"]',
      'input[name="email"]', 
      'input[type="email"]',
      'input[placeholder*="email" i]',
      '#username',
      '#email'
    ];
    
    for (const selector of emailSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 2000 });
        await this.page.type(selector, 'dispatch@lampslogistics.com');
        console.log(`✅ Email entered using selector: ${selector}`);
        return;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('Could not find email input field');
  }

  private async enterPassword(password: string): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    console.log('🔒 Entering password...');
    
    // Try multiple selectors for password input
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password'
    ];
    
    for (const selector of passwordSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 2000 });
        await this.page.type(selector, password);
        console.log(`✅ Password entered using selector: ${selector}`);
        
        // Try to submit form
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:contains("Sign In")',
          'button:contains("Login")',
          '.auth0-lock-submit'
        ];
        
        for (const submitSelector of submitSelectors) {
          try {
            await this.page.click(submitSelector);
            console.log(`✅ Form submitted using: ${submitSelector}`);
            break;
          } catch (error) {
            continue;
          }
        }
        return;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('Could not find password input field');
  }

  private async enterVerificationCode(code: string): Promise<void> {
    if (!this.page) throw new Error('Page not available');
    
    console.log('🔢 Entering verification code...');
    
    // Try multiple selectors for verification code input
    const codeSelectors = [
      'input[name="code"]',
      'input[name="verificationCode"]',
      'input[name="otp"]',
      'input[placeholder*="code" i]',
      'input[placeholder*="verification" i]',
      '.verification-code input',
      '#code'
    ];
    
    for (const selector of codeSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 2000 });
        await this.page.type(selector, code);
        console.log(`✅ Verification code entered using selector: ${selector}`);
        
        // Try to submit
        const submitSelectors = [
          'button[type="submit"]',
          'button:contains("Verify")',
          'button:contains("Continue")',
          'button:contains("Submit")'
        ];
        
        for (const submitSelector of submitSelectors) {
          try {
            await this.page.click(submitSelector);
            console.log(`✅ Verification submitted using: ${submitSelector}`);
            break;
          } catch (error) {
            continue;
          }
        }
        return;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('Could not find verification code input field');
  }

  async reset(): Promise<void> {
    console.log('🔄 Resetting DAT login session...');
    
    if (this.page) {
      try {
        await this.page.close();
      } catch (error) {
        console.log('Error closing page:', (error as Error).message);
      }
    }
    
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        console.log('Error closing browser:', (error as Error).message);
      }
    }
    
    this.browser = null;
    this.page = null;
    this.currentStep = 0;
    this.steps.forEach(step => step.completed = false);
    
    console.log('✅ DAT login session reset');
  }


}

// Singleton instance
let manualDATLogin: ManualDATLogin | null = null;

export function getManualDATLoginInstance(): ManualDATLogin {
  if (!manualDATLogin) {
    manualDATLogin = new ManualDATLogin();
  }
  return manualDATLogin;
}