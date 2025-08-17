import twilio from 'twilio';

interface SMSMessage {
  to: string;
  body: string;
}

class SMSService {
  private client: twilio.Twilio | null = null;
  private fromPhones: string[] = [];
  private isConfigured = false;
  private currentPhoneIndex = 0;

  constructor() {
    this.initialize();
  }

  private initialize() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone1 = process.env.TWILIO_PHONE_NUMBER;
    const fromPhone2 = process.env.TWILIO_PHONE_NUMBER_2;

    if (!accountSid || !authToken || !fromPhone1) {
      console.log('Twilio credentials not configured - SMS functionality disabled');
      return;
    }

    try {
      this.client = twilio(accountSid, authToken);
      this.fromPhones = [fromPhone1];
      
      // Add second phone number if available (ensure proper formatting)
      if (fromPhone2) {
        const formattedPhone2 = fromPhone2.startsWith('+') ? fromPhone2 : `+${fromPhone2}`;
        this.fromPhones.push(formattedPhone2);
        console.log(`📱 SMS Service initialized with ${this.fromPhones.length} phone numbers: ${this.fromPhones.join(', ')}`);
      } else {
        console.log(`📱 SMS Service initialized with 1 phone number: ${fromPhone1}`);
      }
      
      this.isConfigured = true;
      console.log('SMS Service initialized successfully with Twilio');
    } catch (error) {
      console.error('Failed to initialize Twilio client:', error);
      this.isConfigured = false;
    }
  }

  private getNextPhoneNumber(): string {
    if (this.fromPhones.length === 0) {
      throw new Error('No phone numbers configured');
    }
    
    const phone = this.fromPhones[this.currentPhoneIndex];
    this.currentPhoneIndex = (this.currentPhoneIndex + 1) % this.fromPhones.length;
    console.log(`📱 Using phone number: ${phone} (${this.currentPhoneIndex}/${this.fromPhones.length})`);
    return phone;
  }

  async sendSMS(message: SMSMessage): Promise<{ success: boolean; messageId?: string; error?: string; isTrialAccount?: boolean }> {
    if (!this.isConfigured || !this.client || this.fromPhones.length === 0) {
      return {
        success: false,
        error: 'SMS service not properly configured'
      };
    }

    const fromPhone = this.getNextPhoneNumber();
    
    try {
      const result = await this.client.messages.create({
        body: message.body,
        from: fromPhone,
        to: message.to
      });

      console.log(`📱 SMS sent successfully to ${message.to} with SID: ${result.sid}`);
      console.log(`📱 Message status: ${result.status}`);
      console.log(`📱 Message direction: ${result.direction}`);
      
      // Check if we have additional info about delivery status
      if (result.errorCode) {
        console.log(`⚠️  SMS Error Code: ${result.errorCode} - ${result.errorMessage}`);
      }
      
      return {
        success: true,
        messageId: result.sid
      };
    } catch (error: any) {
      console.error('❌ Failed to send SMS:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      
      // Check for various Twilio error codes
      if (error.code === 21608) {
        return {
          success: false,
          error: 'Trial account limitation: Phone number must be verified in Twilio console first. Visit https://console.twilio.com/us1/develop/phone-numbers/manage/verified to verify your number.',
          isTrialAccount: true
        };
      }
      
      // Invalid phone number format
      if (error.code === 21211 || error.message?.includes("Invalid 'To' Phone Number")) {
        return {
          success: false,
          error: 'Invalid phone number format. Please use a valid phone number (e.g., +1234567890)',
          isTrialAccount: false
        };
      }
      
      // Unverified phone number on trial account
      if (error.code === 21614) {
        return {
          success: false,
          error: 'Phone number is not verified. For trial accounts, verify this number at https://console.twilio.com/us1/develop/phone-numbers/manage/verified',
          isTrialAccount: true
        };
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SMS error'
      };
    }
  }

  async sendOnboardingLink(phone: string, onboardingLink: string): Promise<{ success: boolean; messageId?: string; error?: string; isTrialAccount?: boolean }> {
    const message = `🚛 Welcome to LAMP Logistics!

Complete your driver onboarding here: ${onboardingLink}

This secure link expires in 7 days. Once you complete registration, you'll be automatically added to our fleet and start receiving load offers.

Questions? Reply to this message or contact dispatch.`;

    return this.sendSMS({
      to: phone,
      body: message
    });
  }

  isServiceConfigured(): boolean {
    return this.isConfigured;
  }
}

// Export singleton instance
export const smsService = new SMSService();
export default smsService;