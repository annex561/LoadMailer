// Email Ingestion Service - Gmail Integration for Rate Confirmation Auto-Booking
// Uses Replit's Gmail connector for OAuth management

import { db } from "./db";
import { loads, activityLog } from "@shared/schema";
import { rateConParser, ParsedRateCon } from "./ratecon-parser";
import { getGmailClient, isGmailConfigured } from "./gmail-client";

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
  
  async checkConfiguration(): Promise<boolean> {
    return await isGmailConfigured();
  }

  async pollForRateCons(companyId: string): Promise<IngestedEmail[]> {
    const isConfigured = await this.checkConfiguration();
    if (!isConfigured) {
      console.log("[EmailIngestion] Skipping poll - Gmail not configured");
      return [];
    }

    const results: IngestedEmail[] = [];
    
    try {
      const gmail = await getGmailClient();
      
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread subject:"Rate Confirmation" OR subject:"RateCon" OR subject:"Load Confirmation"',
        maxResults: 10,
      });
      
      const messages = res.data.messages || [];
      console.log(`[EmailIngestion] Found ${messages.length} unread Rate Confirmation emails`);

      for (const msg of messages) {
        if (!msg.id) continue;
        try {
          const result = await this.processMessage(msg.id, companyId);
          results.push(result);
        } catch (err: any) {
          console.error(`[EmailIngestion] Error processing message ${msg.id}:`, err.message);
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

  private async processMessage(messageId: string, companyId: string): Promise<IngestedEmail> {
    const gmail = await getGmailClient();
    
    const email = await gmail.users.messages.get({ 
      userId: 'me', 
      id: messageId,
      format: 'full'
    });
    
    const headers = email.data.payload?.headers || [];
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find(h => h.name?.toLowerCase() === 'date')?.value;
    const date = dateStr ? new Date(dateStr) : new Date();
    
    const result: IngestedEmail = {
      messageId,
      subject,
      from,
      date,
      status: 'processed'
    };

    const attachments = await this.getAttachments(gmail, messageId, email.data.payload);
    
    for (const attachment of attachments) {
      if (attachment.mimeType === 'application/pdf' || attachment.filename?.toLowerCase().endsWith('.pdf')) {
        console.log(`[EmailIngestion] Processing PDF: ${attachment.filename}`);
        
        try {
          const loadDetails = await rateConParser.parse(attachment.data);
          result.loadDetails = loadDetails;
          
          await this.createLoadFromParsedData(companyId, loadDetails, undefined, messageId);
        } catch (parseErr: any) {
          console.error(`[EmailIngestion] Parse error for ${attachment.filename}:`, parseErr.message);
          result.status = 'failed';
          result.error = parseErr.message;
        }
      }
    }

    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });
    } catch (markErr: any) {
      console.warn(`[EmailIngestion] Could not mark email as read:`, markErr.message);
    }

    return result;
  }

  async createLoadFromParsedData(
    companyId: string, 
    loadDetails: ParsedRateCon, 
    rateconPath?: string,
    emailId?: string
  ) {
    const [newLoad] = await db.insert(loads).values({
      companyId,
      loadNumber: loadDetails.loadId || `AUTO-${Date.now()}`,
      rate: loadDetails.rate,
      equipmentType: loadDetails.equipment || 'dry_van',
      originCity: loadDetails.pickupLocation?.split(',')[0]?.trim(),
      originState: loadDetails.pickupLocation?.split(',')[1]?.trim(),
      destCity: loadDetails.deliveryLocation?.split(',')[0]?.trim(),
      destState: loadDetails.deliveryLocation?.split(',')[1]?.trim(),
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
        source: "email_ingestion",
        emailId
      }
    });

    console.log(`[EmailIngestion] Created load ${newLoad.loadNumber} from email`);
    return newLoad;
  }

  private async getAttachments(gmail: any, messageId: string, payload: any): Promise<EmailAttachment[]> {
    const attachments: EmailAttachment[] = [];
    
    const extractFromParts = async (parts: any[]) => {
      for (const part of parts || []) {
        if (part.filename && part.body?.attachmentId) {
          try {
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId,
              id: part.body.attachmentId
            });
            
            if (attachment.data.data) {
              const base64Data = attachment.data.data.replace(/-/g, '+').replace(/_/g, '/');
              attachments.push({
                filename: part.filename,
                mimeType: part.mimeType,
                data: Buffer.from(base64Data, 'base64'),
              });
            }
          } catch (err: any) {
            console.error(`[EmailIngestion] Error fetching attachment ${part.filename}:`, err.message);
          }
        }
        
        if (part.parts) {
          await extractFromParts(part.parts);
        }
      }
    };

    await extractFromParts(payload?.parts || []);
    return attachments;
  }

  async manualImport(companyId: string, pdfData: Buffer, filename: string) {
    const loadDetails = await rateConParser.parse(pdfData);
    const storagePath = `/storage/company_${companyId}/ratecons/${filename}`;
    
    return await this.createLoadFromParsedData(companyId, loadDetails, storagePath);
  }

  async processIncomingRateCon(pdfBuffer: Buffer, companyId: string, emailId?: string) {
    try {
      const extracted = await rateConParser.parse(pdfBuffer);

      const [newLoad] = await db.insert(loads).values({
        companyId,
        loadNumber: extracted.loadId || `AUTO-${Date.now()}`,
        lifecycleStatus: "booked",
        rate: extracted.rate,
        originCity: extracted.pickupLocation?.split(',')[0]?.trim(),
        originState: extracted.pickupLocation?.split(',')[1]?.trim(),
        destCity: extracted.deliveryLocation?.split(',')[0]?.trim(),
        destState: extracted.deliveryLocation?.split(',')[1]?.trim(),
        weight: extracted.weight,
        equipmentType: extracted.equipment || 'dry_van',
        bookedAt: new Date(),
      }).returning();

      await db.insert(activityLog).values({
        companyId,
        entityType: "LOAD",
        entityId: newLoad.id,
        action: "AUTO_BOOKED_FROM_EMAIL",
        actor: "SYSTEM_AI",
        details: { 
          loadNumber: extracted.loadId, 
          rate: extracted.rate,
          emailId,
          extractedFields: Object.keys(extracted).filter(k => (extracted as any)[k])
        }
      });

      console.log(`[EmailIngestion] Auto-booked load ${newLoad.loadNumber} via AI extraction`);
      return { success: true, load: newLoad, extracted };
    } catch (error: any) {
      console.error("[EmailIngestion] Ingestion Error:", error.message);
      return { success: false, error: error.message };
    }
  }

  async getStatus(): Promise<{ configured: boolean; lastPoll?: Date }> {
    const configured = await this.checkConfiguration();
    return { configured };
  }
}

export const emailIngestion = new EmailIngestionService();
