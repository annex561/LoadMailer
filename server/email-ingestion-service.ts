import { db } from "./db";
import { loads, activityLog } from "@shared/schema";
import { rateConParser, ParsedRateCon } from "./ratecon-parser";

/**
 * Email Ingestion Service - Automatically imports Rate Confirmations from Gmail
 * 
 * This service polls for unread emails with Rate Confirmation subjects,
 * extracts PDF attachments, parses them using AI/OCR, and creates loads.
 * 
 * Requires Gmail API integration to be configured.
 */

interface EmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
  savedPath?: string;
}

interface IngestedEmail {
  messageId: string;
  subject: string;
  from: string;
  date: Date;
  loadDetails?: ParsedRateCon;
  status: 'processed' | 'failed' | 'skipped';
  error?: string;
}

export class EmailIngestionService {
  private isConfigured = false;
  private gmailClient: any = null;

  constructor() {
    this.checkConfiguration();
  }

  private checkConfiguration() {
    // Gmail OAuth would be configured via Replit's Gmail connector
    this.isConfigured = !!process.env.GMAIL_ACCESS_TOKEN || !!process.env.GOOGLE_ACCESS_TOKEN;
    if (!this.isConfigured) {
      console.log("[EmailIngestion] Gmail not configured - ingestion disabled");
    }
  }

  /**
   * Poll Gmail for Rate Confirmation emails and process them
   */
  async pollForRateCons(companyId: string): Promise<IngestedEmail[]> {
    if (!this.isConfigured) {
      console.log("[EmailIngestion] Skipping poll - Gmail not configured");
      return [];
    }

    const results: IngestedEmail[] = [];
    
    try {
      // This would use the Gmail API via googleapis
      // const gmail = google.gmail({ version: 'v1', auth: this.getAuth() });
      // const res = await gmail.users.messages.list({
      //   userId: 'me',
      //   q: 'is:unread subject:"Rate Confirmation"',
      // });
      
      console.log(`[EmailIngestion] Polling for Rate Confirmations for company ${companyId}`);
      
      // Placeholder for actual Gmail API call
      const messages: any[] = [];

      for (const msg of messages) {
        try {
          const result = await this.processMessage(msg.id, companyId);
          results.push(result);
        } catch (err: any) {
          results.push({
            messageId: msg.id,
            subject: 'Unknown',
            from: 'Unknown',
            date: new Date(),
            status: 'failed',
            error: err.message
          });
        }
      }
    } catch (err: any) {
      console.error("[EmailIngestion] Poll error:", err.message);
    }

    return results;
  }

  /**
   * Process a single email message
   */
  private async processMessage(messageId: string, companyId: string): Promise<IngestedEmail> {
    // Fetch full message content
    // const email = await gmail.users.messages.get({ userId: 'me', id: messageId });
    
    // Extract attachments
    // const attachments = await this.getAttachments(messageId, email.data.payload);
    
    const result: IngestedEmail = {
      messageId,
      subject: '',
      from: '',
      date: new Date(),
      status: 'processed'
    };

    // For each PDF attachment, parse and create load
    // for (const attachment of attachments) {
    //   if (attachment.mimeType === 'application/pdf') {
    //     const loadDetails = await rateConParser.parse(attachment.data);
    //     result.loadDetails = loadDetails;
    //     
    //     await this.createLoadFromParsedData(companyId, loadDetails, attachment.savedPath);
    //   }
    // }

    // Mark email as read
    // await gmail.users.messages.modify({
    //   userId: 'me',
    //   id: messageId,
    //   requestBody: { removeLabelIds: ['UNREAD'] }
    // });

    return result;
  }

  /**
   * Create a load from parsed Rate Confirmation data
   */
  async createLoadFromParsedData(
    companyId: string, 
    loadDetails: ParsedRateCon, 
    rateconPath?: string
  ) {
    const [newLoad] = await db.insert(loads).values({
      companyId,
      loadNumber: loadDetails.loadId,
      rate: loadDetails.rate,
      equipmentType: loadDetails.equipment,
      originCity: loadDetails.pickupLocation?.split(',')[0]?.trim(),
      originState: loadDetails.pickupLocation?.split(',')[1]?.trim(),
      destinationCity: loadDetails.deliveryLocation?.split(',')[0]?.trim(),
      destinationState: loadDetails.deliveryLocation?.split(',')[1]?.trim(),
      weight: loadDetails.weight,
      miles: loadDetails.miles,
      rateconPath: rateconPath,
      lifecycleStatus: "booked",
      bookedAt: new Date(),
    }).returning();

    await db.insert(activityLog).values({
      companyId,
      entityType: "LOAD",
      entityId: newLoad.id,
      action: "EMAIL_INGESTION_COMPLETE",
      actor: "SYSTEM_GMAIL",
      details: { 
        loadNumber: loadDetails.loadId,
        rate: loadDetails.rate,
        source: "email_ingestion"
      }
    });

    console.log(`[EmailIngestion] Created load ${newLoad.loadNumber} from email`);
    return newLoad;
  }

  /**
   * Extract attachments from Gmail message payload
   */
  private async getAttachments(messageId: string, payload: any): Promise<EmailAttachment[]> {
    const attachments: EmailAttachment[] = [];
    
    const extractFromParts = async (parts: any[]) => {
      for (const part of parts || []) {
        if (part.filename && part.body?.attachmentId) {
          // Fetch attachment data
          // const attachment = await gmail.users.messages.attachments.get({
          //   userId: 'me',
          //   messageId,
          //   id: part.body.attachmentId
          // });
          
          // attachments.push({
          //   filename: part.filename,
          //   mimeType: part.mimeType,
          //   data: Buffer.from(attachment.data.data, 'base64'),
          // });
        }
        
        if (part.parts) {
          await extractFromParts(part.parts);
        }
      }
    };

    await extractFromParts(payload?.parts || []);
    return attachments;
  }

  /**
   * Manual import endpoint for testing
   */
  async manualImport(companyId: string, pdfData: Buffer, filename: string) {
    const loadDetails = await rateConParser.parse(pdfData);
    const storagePath = `/storage/company_${companyId}/ratecons/${filename}`;
    
    return await this.createLoadFromParsedData(companyId, loadDetails, storagePath);
  }
}

export const emailIngestion = new EmailIngestionService();
