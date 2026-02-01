import { storage } from './storage';
import { traqiqSopService } from './traqiq-sop-service';
import { randomUUID } from 'crypto';

interface IncomingSMS {
  From: string;
  Body: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaContentType0?: string;
  MessageSid: string;
}

interface LoadMessage {
  id: string;
  loadId: string;
  driverPhone: string;
  direction: 'inbound' | 'outbound';
  body: string;
  mediaUrls: string[];
  mediaTypes: string[];
  docType?: 'bol' | 'freight_photos' | 'pod' | 'other';
  timestamp: Date;
}

const loadMessages = new Map<string, LoadMessage[]>();

export class DriverSMSUploadService {
  private twilioAccountSid: string;
  private twilioAuthToken: string;
  
  constructor() {
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
    console.log('📱 Driver SMS Upload Service initialized');
  }

  parseLoadCode(body: string): string | null {
    if (!body) return null;
    const patterns = [
      /LOAD[-:\s]?(\d+)/i,
      /^#(\d+)/,
      /TRIP[-:\s]?(\d+)/i,
      /^(\d{6,})/,
    ];
    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  detectDocType(body: string): 'bol' | 'freight_photos' | 'pod' | 'other' {
    const lower = body.toLowerCase();
    if (lower.includes('bol') || lower.includes('bill of lading')) return 'bol';
    if (lower.includes('pod') || lower.includes('delivery')) return 'pod';
    if (lower.includes('freight') || lower.includes('secured') || lower.includes('pickup')) return 'freight_photos';
    return 'other';
  }

  async processIncomingSMS(sms: IncomingSMS): Promise<{ success: boolean; loadId?: string; message?: string; error?: string }> {
    console.log(`📥 SMS from ${sms.From}: "${sms.Body}" (${sms.NumMedia} media)`);

    const loadCode = this.parseLoadCode(sms.Body);
    if (!loadCode) {
      return { success: false, error: 'No load code found. Include load number (e.g., LOAD35394084)' };
    }

    const load = await this.findLoadByCode(loadCode);
    if (!load) {
      return { success: false, error: `Load ${loadCode} not found.` };
    }

    const mediaUrls: string[] = [];
    const mediaTypes: string[] = [];
    const numMedia = parseInt(sms.NumMedia) || 0;

    for (let i = 0; i < numMedia; i++) {
      const url = (sms as any)[`MediaUrl${i}`];
      const type = (sms as any)[`MediaContentType${i}`];
      if (url) {
        const storedUrl = await this.downloadAndStoreMedia(url, type, load.id);
        mediaUrls.push(storedUrl);
        mediaTypes.push(type || 'image/jpeg');
      }
    }

    const docType = this.detectDocType(sms.Body);

    const message: LoadMessage = {
      id: randomUUID(),
      loadId: load.id,
      driverPhone: sms.From,
      direction: 'inbound',
      body: sms.Body,
      mediaUrls,
      mediaTypes,
      docType,
      timestamp: new Date(),
    };

    this.addMessageToLoad(load.id, message);

    if (mediaUrls.length > 0 && docType !== 'other') {
      await traqiqSopService.handleDocumentUpload(load.id, docType as any);
    }

    return {
      success: true,
      loadId: load.id,
      message: `Received ${mediaUrls.length} photo(s) for Load ${loadCode}. Tagged as: ${docType}`
    };
  }

  private async findLoadByCode(code: string): Promise<any | null> {
    try {
      const loads = await storage.getLoads();
      return loads.find((l: any) => 
        l.loadNumber === code || l.loadNumber?.includes(code) || l.id === code
      ) || null;
    } catch { return null; }
  }

  private async downloadAndStoreMedia(twilioUrl: string, contentType: string, loadId: string): Promise<string> {
    try {
      const authHeader = 'Basic ' + Buffer.from(`${this.twilioAccountSid}:${this.twilioAuthToken}`).toString('base64');
      const response = await fetch(twilioUrl, { headers: { 'Authorization': authHeader } });
      if (!response.ok) return twilioUrl;
      
      const ext = contentType?.includes('png') ? 'png' : 'jpg';
      const storedPath = `/uploads/loads/${loadId}/${Date.now()}.${ext}`;
      return storedPath;
    } catch { return twilioUrl; }
  }

  private addMessageToLoad(loadId: string, message: LoadMessage): void {
    const existing = loadMessages.get(loadId) || [];
    existing.push(message);
    loadMessages.set(loadId, existing);
  }

  getLoadMessages(loadId: string): LoadMessage[] {
    return loadMessages.get(loadId) || [];
  }

  getLoadDocuments(loadId: string): LoadMessage[] {
    return this.getLoadMessages(loadId).filter(m => m.mediaUrls.length > 0);
  }

  generateAutoReply(success: boolean, message: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
  }
}

export const driverSMSUploadService = new DriverSMSUploadService();
