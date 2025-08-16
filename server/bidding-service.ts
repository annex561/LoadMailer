import { storage } from "./storage";
import { telegramLoadService } from "./telegram-service";
import type { 
  LoadBid,
  InsertLoadBid,
  BidResponse,
  InsertBidResponse,
  EmailCampaign,
  InsertEmailCampaign,
  EmailFollowUp,
  InsertEmailFollowUp,
  DispatcherNotification,
  InsertDispatcherNotification,
  LoadBidWithRelations,
  ScrapedLoad,
  Driver,
  LoadWithRelations
} from "@shared/schema";
import { randomUUID } from "crypto";
import cron from "node-cron";
import nodemailer from "nodemailer";

interface BiddingConfig {
  // Bid calculation settings
  defaultMargin: number; // percentage
  minMargin: number; // percentage
  maxBidTimeoutMinutes: number;
  
  // Email settings
  maxFollowUps: number;
  followUpIntervalHours: number;
  emailTimeoutHours: number;
  
  // Driver notification settings
  driverResponseTimeoutMinutes: number;
  
  // Dispatcher settings
  dispatcherChatId: string;
}

export class BiddingService {
  private config: BiddingConfig;
  private emailTransporter: nodemailer.Transporter;
  private isRunning = false;

  constructor(config: Partial<BiddingConfig> = {}) {
    this.config = {
      defaultMargin: 15, // 15% default margin
      minMargin: 8, // 8% minimum margin
      maxBidTimeoutMinutes: 60, // 1 hour to submit bid
      maxFollowUps: 3,
      followUpIntervalHours: 4, // 4 hours between follow-ups
      emailTimeoutHours: 24, // 24 hours to get response
      driverResponseTimeoutMinutes: 10, // 10 minutes for driver to respond
      dispatcherChatId: process.env.DISPATCHER_TELEGRAM_ID || "5908383693",
      ...config
    };

    // Email transporter configuration
    this.emailTransporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
      },
    });
  }

  async initialize(): Promise<void> {
    console.log('Initializing Bidding Service...');
    
    // Start periodic tasks
    this.startPeriodicTasks();
    
    this.isRunning = true;
    console.log('Bidding Service initialized successfully');
  }

  private startPeriodicTasks(): void {
    // Check for follow-up emails every hour
    cron.schedule('0 * * * *', async () => {
      await this.processScheduledFollowUps();
    });

    // Check for expired bids every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      await this.processExpiredBids();
    });

    // Check for driver response timeouts every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.processDriverTimeouts();
    });
  }

  /**
   * Create a bid from a scraped load
   */
  async createBidFromScrapedLoad(scrapedLoadId: string, driverId: string): Promise<LoadBid> {
    const scrapedLoad = await storage.getScrapedLoad(scrapedLoadId);
    if (!scrapedLoad) {
      throw new Error('Scraped load not found');
    }

    const driver = await storage.getDriver(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }

    // Calculate recommended bid amount
    const originalRate = scrapedLoad.rate;
    const recommendedAmount = originalRate * (1 - this.config.defaultMargin / 100);
    const margin = originalRate - recommendedAmount;

    const bidData: InsertLoadBid = {
      scrapedLoadId: scrapedLoad.id,
      loadNumber: scrapedLoad.loadNumber || `BID-${randomUUID().slice(0, 8)}`,
      brokerName: scrapedLoad.brokerName || 'Unknown Broker',
      brokerEmail: scrapedLoad.brokerEmail,
      brokerPhone: scrapedLoad.brokerPhone,
      bidAmount: recommendedAmount,
      recommendedAmount,
      margin,
      ratePerMile: scrapedLoad.ratePerMile,
      pickupAddress: scrapedLoad.pickupAddress || `${scrapedLoad.pickupCity}, ${scrapedLoad.pickupState}`,
      deliveryAddress: scrapedLoad.deliveryAddress || `${scrapedLoad.deliveryCity}, ${scrapedLoad.deliveryState}`,
      pickupDate: scrapedLoad.pickupDate,
      deliveryDate: scrapedLoad.deliveryDate,
      weight: scrapedLoad.weight,
      commodity: scrapedLoad.commodity,
      equipmentType: scrapedLoad.equipmentType,
      miles: scrapedLoad.mileage,
      assignedDriverId: driverId,
      bidExpiresAt: new Date(Date.now() + this.config.maxBidTimeoutMinutes * 60 * 1000),
    };

    const bid = await storage.createLoadBid(bidData);
    
    // Send bid offer to driver
    await this.sendBidToDriver(bid, driver);
    
    console.log(`Created bid ${bid.id} for load ${scrapedLoad.loadNumber} assigned to ${driver.name}`);
    return bid;
  }

  /**
   * Send bid offer to driver via Telegram
   */
  private async sendBidToDriver(bid: LoadBid, driver: Driver): Promise<void> {
    if (!driver.telegramId) {
      throw new Error('Driver does not have Telegram configured');
    }

    const message = this.formatBidOfferMessage(bid);
    
    try {
      const telegramResponse = await telegramLoadService.sendBidOffer(
        driver.telegramId,
        {
          bidId: bid.id,
          loadNumber: bid.loadNumber,
          pickupAddress: bid.pickupAddress,
          deliveryAddress: bid.deliveryAddress,
          pickupDate: bid.pickupDate.toISOString().split('T')[0],
          deliveryDate: bid.deliveryDate.toISOString().split('T')[0],
          bidAmount: bid.bidAmount,
          margin: bid.margin || 0,
          miles: bid.miles || 0,
          commodity: bid.commodity || 'General Freight',
          equipment: bid.equipmentType,
          timeoutMinutes: this.config.driverResponseTimeoutMinutes,
        }
      );

      console.log(`Sent bid offer to driver ${driver.name} via Telegram`);
    } catch (error) {
      console.error('Error sending bid offer to driver:', error);
      throw error;
    }
  }

  private formatBidOfferMessage(bid: LoadBid): string {
    return `🚛 *NEW LOAD OPPORTUNITY*\n\n` +
      `📦 Load: ${bid.loadNumber}\n` +
      `🏭 Broker: ${bid.brokerName}\n` +
      `📍 Pickup: ${bid.pickupAddress}\n` +
      `📍 Delivery: ${bid.deliveryAddress}\n` +
      `📅 Pickup: ${bid.pickupDate.toLocaleDateString()}\n` +
      `📅 Delivery: ${bid.deliveryDate.toLocaleDateString()}\n` +
      `💰 Bid Amount: $${bid.bidAmount?.toFixed(2)}\n` +
      `📏 Miles: ${bid.miles || 'TBD'}\n` +
      `📦 Commodity: ${bid.commodity || 'General Freight'}\n` +
      `🚚 Equipment: ${bid.equipmentType}\n` +
      `💵 Your Profit: $${bid.margin?.toFixed(2)}\n\n` +
      `⏰ Respond within ${this.config.driverResponseTimeoutMinutes} minutes\n\n` +
      `Accept this load opportunity?`;
  }

  /**
   * Handle driver response to bid offer
   */
  async handleDriverResponse(bidId: string, driverId: string, response: 'accepted' | 'declined' | 'negotiate', options: {
    counterOffer?: number;
    reason?: string;
    notes?: string;
    telegramMessageId?: string;
  } = {}): Promise<void> {
    const bid = await storage.getLoadBid(bidId);
    if (!bid) {
      throw new Error('Bid not found');
    }

    // Record the response
    const bidResponse: InsertBidResponse = {
      bidId,
      driverId,
      response,
      responseTime: new Date(),
      counterOffer: options.counterOffer,
      reason: options.reason,
      notes: options.notes,
      telegramMessageId: options.telegramMessageId,
    };

    await storage.createBidResponse(bidResponse);

    // Update bid status
    if (response === 'accepted') {
      await storage.updateLoadBid(bidId, {
        status: 'driver_accepted',
        driverResponse: 'accepted',
        driverResponseAt: new Date(),
        driverNotes: options.notes,
      });

      // Start email campaign if required
      if (bid.requiresEmail && bid.brokerEmail) {
        await this.startEmailCampaign(bid);
      }

      // Notify dispatcher
      await this.notifyDispatcher({
        bidId,
        notificationType: 'driver_accepted',
        priority: 'high',
        message: `🎉 Driver accepted load ${bid.loadNumber}! Starting email campaign to win the load.`,
      });

    } else if (response === 'declined') {
      await storage.updateLoadBid(bidId, {
        status: 'driver_declined',
        driverResponse: 'declined',
        driverResponseAt: new Date(),
        driverNotes: options.notes,
      });

      // Notify dispatcher
      await this.notifyDispatcher({
        bidId,
        notificationType: 'driver_declined',
        priority: 'normal',
        message: `❌ Driver declined load ${bid.loadNumber}. Reason: ${options.reason || 'Not specified'}`,
      });
    }

    console.log(`Driver ${driverId} ${response} bid ${bidId}`);
  }

  /**
   * Start email campaign to win the load
   */
  private async startEmailCampaign(bid: LoadBid): Promise<EmailCampaign> {
    if (!bid.brokerEmail) {
      throw new Error('Broker email not available for campaign');
    }

    // Generate compelling email content
    const emailContent = this.generateCompellingEmail(bid);
    
    const campaignData: InsertEmailCampaign = {
      bidId: bid.id,
      brokerEmail: bid.brokerEmail,
      brokerName: bid.brokerName,
      subject: emailContent.subject,
      initialEmailBody: emailContent.body,
      bidAmount: bid.bidAmount,
      nextFollowUpAt: new Date(Date.now() + this.config.followUpIntervalHours * 60 * 60 * 1000),
    };

    const campaign = await storage.createEmailCampaign(campaignData);

    // Send initial email
    await this.sendCampaignEmail(campaign, emailContent.subject, emailContent.body, 'initial');

    // Update bid with campaign ID
    await storage.updateLoadBid(bid.id, {
      emailCampaignId: campaign.id,
      status: 'bid_submitted',
      bidSubmittedAt: new Date(),
    });

    console.log(`Started email campaign ${campaign.id} for bid ${bid.id}`);
    return campaign;
  }

  private generateCompellingEmail(bid: LoadBid): { subject: string; body: string } {
    const subject = `COMPETITIVE RATE - ${bid.loadNumber} - ${bid.equipmentType.toUpperCase()} - ${bid.pickupDate.toLocaleDateString()}`;
    
    const body = `Dear ${bid.brokerName},\n\n` +
      `I hope this email finds you well. I am writing to submit a competitive rate for the following shipment:\n\n` +
      `**LOAD DETAILS:**\n` +
      `• Load Number: ${bid.loadNumber}\n` +
      `• Equipment: ${bid.equipmentType.toUpperCase()}\n` +
      `• Pickup: ${bid.pickupAddress}\n` +
      `• Delivery: ${bid.deliveryAddress}\n` +
      `• Pickup Date: ${bid.pickupDate.toLocaleDateString()}\n` +
      `• Delivery Date: ${bid.deliveryDate.toLocaleDateString()}\n` +
      `• Commodity: ${bid.commodity || 'General Freight'}\n` +
      `• Weight: ${bid.weight ? bid.weight.toLocaleString() + ' lbs' : 'TBD'}\n\n` +
      `**OUR COMPETITIVE RATE: $${bid.bidAmount?.toFixed(2)}**\n\n` +
      `**WHY CHOOSE US:**\n` +
      `✅ **Reliable Service** - 99.8% on-time delivery rate\n` +
      `✅ **Professional Drivers** - All background checked and experienced\n` +
      `✅ **Real-time Tracking** - GPS monitoring throughout transit\n` +
      `✅ **Excellent Communication** - Regular updates during transport\n` +
      `✅ **Cargo Insurance** - Full coverage for peace of mind\n` +
      `✅ **Quick Response** - Ready to pick up immediately upon award\n\n` +
      `We understand the importance of competitive pricing while maintaining the highest service standards. ` +
      `Our rate reflects our commitment to both value and reliability.\n\n` +
      `**IMMEDIATE AVAILABILITY** - We can confirm pickup within 30 minutes of load award.\n\n` +
      `I would be happy to discuss any details or answer questions you may have. ` +
      `Please let me know if you need any additional information to move forward.\n\n` +
      `Looking forward to earning your business and building a long-term partnership.\n\n` +
      `Best regards,\n\n` +
      `LoadMaster Transportation\n` +
      `Phone: ${process.env.COMPANY_PHONE || '(555) 123-4567'}\n` +
      `Email: ${process.env.COMPANY_EMAIL || 'dispatch@loadmaster.com'}\n` +
      `MC#: ${process.env.MC_NUMBER || 'MC-123456'}\n` +
      `DOT#: ${process.env.DOT_NUMBER || '12345678'}`;

    return { subject, body };
  }

  /**
   * Send campaign email and track it
   */
  private async sendCampaignEmail(campaign: EmailCampaign, subject: string, body: string, followUpType: string): Promise<void> {
    try {
      await this.emailTransporter.sendMail({
        from: process.env.COMPANY_EMAIL || 'dispatch@loadmaster.com',
        to: campaign.brokerEmail,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
      });

      // Record the follow-up
      const followUp: InsertEmailFollowUp = {
        campaignId: campaign.id,
        bidId: campaign.bidId,
        subject,
        body,
        sentAt: new Date(),
        followUpType,
        strategy: this.getEmailStrategy(followUpType),
      };

      await storage.createEmailFollowUp(followUp);

      // Update campaign
      await storage.updateEmailCampaign(campaign.id, {
        totalEmails: campaign.totalEmails + 1,
        lastEmailSentAt: new Date(),
      });

      console.log(`Sent ${followUpType} email for campaign ${campaign.id}`);
    } catch (error) {
      console.error('Error sending campaign email:', error);
      throw error;
    }
  }

  private getEmailStrategy(followUpType: string): string {
    switch (followUpType) {
      case 'initial': return 'rate_highlight';
      case 'follow_up_1': return 'urgency';
      case 'follow_up_2': return 'relationship';
      case 'final_push': return 'compromise';
      default: return 'rate_highlight';
    }
  }

  /**
   * Process scheduled follow-up emails
   */
  private async processScheduledFollowUps(): Promise<void> {
    try {
      const activeCampaigns = await storage.getActiveCampaigns();
      
      for (const campaign of activeCampaigns) {
        if (campaign.nextFollowUpAt && new Date() >= campaign.nextFollowUpAt) {
          await this.sendFollowUpEmail(campaign);
        }
      }
    } catch (error) {
      console.error('Error processing scheduled follow-ups:', error);
    }
  }

  private async sendFollowUpEmail(campaign: EmailCampaign): Promise<void> {
    if (campaign.followUpCount >= campaign.maxFollowUps) {
      // Mark campaign as expired
      await storage.updateEmailCampaign(campaign.id, {
        status: 'expired',
        finalOutcome: 'no_response',
      });
      return;
    }

    const followUpContent = this.generateFollowUpEmail(campaign);
    const followUpType = `follow_up_${campaign.followUpCount + 1}`;
    
    await this.sendCampaignEmail(campaign, followUpContent.subject, followUpContent.body, followUpType);

    // Schedule next follow-up
    const nextFollowUp = campaign.followUpCount + 1 < campaign.maxFollowUps 
      ? new Date(Date.now() + this.config.followUpIntervalHours * 60 * 60 * 1000)
      : null;

    await storage.updateEmailCampaign(campaign.id, {
      followUpCount: campaign.followUpCount + 1,
      nextFollowUpAt: nextFollowUp,
    });
  }

  private generateFollowUpEmail(campaign: EmailCampaign): { subject: string; body: string } {
    const followUpNumber = campaign.followUpCount + 1;
    
    if (followUpNumber === 1) {
      return {
        subject: `FOLLOWING UP - ${campaign.bidAmount} - Quick Response Needed`,
        body: `Hi ${campaign.brokerName},\n\n` +
          `I wanted to follow up on my rate submission for load ${campaign.bidId}.\n\n` +
          `Our competitive rate of $${campaign.bidAmount} is still available, and we're ready for immediate pickup.\n\n` +
          `Time-sensitive opportunities require quick decisions - please let me know if you need any additional information to move forward.\n\n` +
          `Best regards,\nLoadMaster Transportation`
      };
    } else if (followUpNumber === 2) {
      return {
        subject: `FINAL OPPORTUNITY - Flexible on Rate - ${campaign.bidAmount}`,
        body: `Dear ${campaign.brokerName},\n\n` +
          `I understand you're likely reviewing multiple carriers for this shipment.\n\n` +
          `While our initial rate was $${campaign.bidAmount}, I'm authorized to work with you on pricing if needed to secure this load.\n\n` +
          `We value long-term partnerships over single transactions. What rate would work for you?\n\n` +
          `Ready to confirm within minutes of your response.\n\n` +
          `Best regards,\nLoadMaster Transportation`
      };
    } else {
      return {
        subject: `LAST CHANCE - Let's Make This Work`,
        body: `Hi ${campaign.brokerName},\n\n` +
          `This is my final follow-up on this opportunity.\n\n` +
          `If there's any way we can work together on this load, please let me know. I'm open to discussing rate adjustments.\n\n` +
          `Otherwise, I hope we can connect on future shipments.\n\n` +
          `Thank you for your time.\n\n` +
          `Best regards,\nLoadMaster Transportation`
      };
    }
  }

  /**
   * Handle load won notification
   */
  async markLoadAsWon(bidId: string, finalRate: number, brokerResponse?: string): Promise<void> {
    const bid = await storage.getLoadBid(bidId);
    if (!bid) {
      throw new Error('Bid not found');
    }

    // Update bid status
    await storage.updateLoadBid(bidId, {
      status: 'won',
      finalRate,
      actualMargin: finalRate - (bid.bidAmount || 0),
      brokerResponse: brokerResponse || 'load_awarded',
      brokerResponseAt: new Date(),
    });

    // Update email campaign if exists
    if (bid.emailCampaignId) {
      await storage.updateEmailCampaign(bid.emailCampaignId, {
        status: 'won',
        finalOutcome: 'won',
        winningRate: finalRate,
      });
    }

    // Create load in system if from scraped load
    if (bid.scrapedLoadId) {
      await this.createLoadFromWonBid(bid, finalRate);
    }

    // Notify dispatcher about win
    await this.notifyDispatcher({
      bidId,
      notificationType: 'load_won',
      priority: 'high',
      message: `🎉 LOAD WON! ${bid.loadNumber} at $${finalRate.toFixed(2)}. Profit: $${(finalRate - (bid.bidAmount || 0)).toFixed(2)}`,
    });

    console.log(`Load ${bid.loadNumber} won at $${finalRate}`);
  }

  private async createLoadFromWonBid(bid: LoadBid, finalRate: number): Promise<void> {
    try {
      // Get default customer or create one
      const customers = await storage.getAllCustomers();
      const defaultCustomer = customers[0];
      
      if (!defaultCustomer) {
        console.error('No customers available to assign load');
        return;
      }

      const loadData = {
        customerId: defaultCustomer.id,
        driverId: bid.assignedDriverId,
        description: `${bid.commodity || 'General Freight'} - ${bid.weight || 0} lbs`,
        weight: bid.weight || 0,
        priority: 'standard' as const,
        pickupAddress: bid.pickupAddress,
        pickupDate: bid.pickupDate.toISOString().split('T')[0],
        pickupTime: '08:00',
        deliveryAddress: bid.deliveryAddress,
        deliveryDate: bid.deliveryDate.toISOString().split('T')[0],
        deliveryTime: '17:00',
        rate: finalRate,
        miles: bid.miles,
        equipmentType: bid.equipmentType,
        sourceBoard: 'loadboard' as const,
      };

      const load = await storage.createLoad(loadData);
      
      // Update bid with created load ID
      await storage.updateLoadBid(bid.id, {
        loadId: load.id,
      });

      console.log(`Created load ${load.loadNumber} from won bid ${bid.id}`);
    } catch (error) {
      console.error('Error creating load from won bid:', error);
    }
  }

  /**
   * Send notification to dispatcher via Telegram
   */
  private async notifyDispatcher(notification: {
    bidId?: string;
    loadId?: string;
    notificationType: string;
    priority: string;
    message: string;
  }): Promise<void> {
    try {
      const notificationData: InsertDispatcherNotification = {
        bidId: notification.bidId,
        loadId: notification.loadId,
        notificationType: notification.notificationType,
        priority: notification.priority,
        message: notification.message,
        telegramChatId: this.config.dispatcherChatId,
      };

      const savedNotification = await storage.createDispatcherNotification(notificationData);

      // Send to Telegram
      const telegramMessage = await telegramLoadService.sendDispatcherNotification(
        this.config.dispatcherChatId,
        notification.message
      );

      // Update notification with Telegram message ID
      if (telegramMessage) {
        await storage.updateDispatcherNotification(savedNotification.id, {
          status: 'sent',
          sentAt: new Date(),
          telegramMessageId: telegramMessage.toString(),
        });
      }

      console.log(`Sent dispatcher notification: ${notification.notificationType}`);
    } catch (error) {
      console.error('Error sending dispatcher notification:', error);
    }
  }

  /**
   * Process expired bids
   */
  private async processExpiredBids(): Promise<void> {
    try {
      const expiredBids = await storage.getExpiredBids();
      
      for (const bid of expiredBids) {
        await storage.updateLoadBid(bid.id, {
          status: 'expired',
        });

        if (bid.emailCampaignId) {
          await storage.updateEmailCampaign(bid.emailCampaignId, {
            status: 'expired',
            finalOutcome: 'expired',
          });
        }

        await this.notifyDispatcher({
          bidId: bid.id,
          notificationType: 'bid_expired',
          priority: 'normal',
          message: `⏰ Bid expired for load ${bid.loadNumber}`,
        });
      }
    } catch (error) {
      console.error('Error processing expired bids:', error);
    }
  }

  /**
   * Process driver response timeouts
   */
  private async processDriverTimeouts(): Promise<void> {
    try {
      const timedOutBids = await storage.getDriverTimeoutBids(this.config.driverResponseTimeoutMinutes);
      
      for (const bid of timedOutBids) {
        await storage.updateLoadBid(bid.id, {
          status: 'driver_declined',
          driverResponse: 'no_response',
        });

        await this.notifyDispatcher({
          bidId: bid.id,
          notificationType: 'driver_timeout',
          priority: 'normal',
          message: `⏰ Driver did not respond to load ${bid.loadNumber} in time`,
        });
      }
    } catch (error) {
      console.error('Error processing driver timeouts:', error);
    }
  }

  /**
   * Get bidding statistics
   */
  async getBiddingStats(): Promise<{
    totalBids: number;
    activeBids: number;
    wonBids: number;
    lostBids: number;
    winRate: number;
    avgMargin: number;
    activeCampaigns: number;
  }> {
    try {
      const allBids = await storage.getAllLoadBids();
      const activeBids = allBids.filter(b => ['pending_driver', 'driver_accepted', 'bid_submitted'].includes(b.status));
      const wonBids = allBids.filter(b => b.status === 'won');
      const lostBids = allBids.filter(b => b.status === 'lost');
      const completedBids = wonBids.length + lostBids.length;
      const winRate = completedBids > 0 ? (wonBids.length / completedBids) * 100 : 0;
      const avgMargin = wonBids.length > 0 
        ? wonBids.reduce((sum, b) => sum + (b.actualMargin || 0), 0) / wonBids.length 
        : 0;
      
      const activeCampaigns = (await storage.getActiveCampaigns()).length;

      return {
        totalBids: allBids.length,
        activeBids: activeBids.length,
        wonBids: wonBids.length,
        lostBids: lostBids.length,
        winRate: Math.round(winRate * 100) / 100,
        avgMargin: Math.round(avgMargin * 100) / 100,
        activeCampaigns,
      };
    } catch (error) {
      console.error('Error getting bidding stats:', error);
      return {
        totalBids: 0,
        activeBids: 0,
        wonBids: 0,
        lostBids: 0,
        winRate: 0,
        avgMargin: 0,
        activeCampaigns: 0,
      };
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Bidding Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

// Singleton instance
export const biddingService = new BiddingService();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down Bidding Service...');
  biddingService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down Bidding Service...');
  biddingService.stop();
});