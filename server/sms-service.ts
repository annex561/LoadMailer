import twilio from 'twilio';

interface SMSMessage {
  to: string;
  body: string;
}

class SMSService {
  private client: twilio.Twilio | null = null;
  private fromPhone: string | null = null;
  private isConfigured = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      console.log('Twilio credentials not configured - SMS functionality disabled');
      return;
    }

    try {
      this.client = twilio(accountSid, authToken);
      this.fromPhone = fromPhone;
      this.isConfigured = true;
      console.log('SMS Service initialized successfully with Twilio');
    } catch (error) {
      console.error('Failed to initialize Twilio client:', error);
      this.isConfigured = false;
    }
  }

  async sendSMS(message: SMSMessage): Promise<{ success: boolean; messageId?: string; error?: string; isTrialAccount?: boolean }> {
    if (!this.isConfigured || !this.client || !this.fromPhone) {
      return {
        success: false,
        error: 'SMS service not properly configured'
      };
    }

    try {
      const result = await this.client.messages.create({
        body: message.body,
        from: this.fromPhone,
        to: message.to
      });

      console.log(`SMS sent successfully to ${message.to} with SID: ${result.sid}`);
      
      return {
        success: true,
        messageId: result.sid
      };
    } catch (error: any) {
      console.error('Failed to send SMS:', error);
      
      // Check if this is a trial account verification error
      if (error.code === 21608) {
        return {
          success: false,
          error: 'Trial account limitation: Phone number must be verified in Twilio console',
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