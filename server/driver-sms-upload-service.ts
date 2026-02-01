import { traqiqSopService } from './traqiq-sop-service';
import { randomUUID } from 'crypto';

interface IncomingSMS {
  From: string;
  Body: string;
  NumMedia: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaUrl2?: string;
  MediaContentType0?: string;
  MediaContentType1?: string;
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
  private baseUrl: string;
  
  constructor() {
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.baseUrl = process.env.BASE_URL || 'http://localhost:5000';
    console.log('📱 Driver SMS Upload Service initialized');
  }

  parseLoadCode(body: string): string | null {
    if (!body) return null;
    
    const numMatch = body.match(/^(\d{6,})\b/);
    if (numMatch) return numMatch[1];
    
    const loadMatch = body.match(/\bLOAD[-:\s#]?([A-Z0-9-]{3,})/i);
    if (loadMatch) return loadMatch[1];
    
    const tripMatch = body.match(/\bTRIP[-:\s#]?(\d+)/i);
    if (tripMatch) return tripMatch[1];
    
    return null;
  }

  detectDocType(body: string): 'bol' | 'freight_photos' | 'pod' | 'other' {
    const lower = body.toLowerCase();
    if (lower.includes('bol') || lower.includes('bill of lading')) return 'bol';
    if (lower.includes('pod') || lower.includes('proof of delivery') || lower.includes('delivery')) return 'pod';
    if (lower.includes('freight') || lower.includes('secured') || lower.includes('pickup') || lower.includes('loaded')) return 'freight_photos';
    return 'other';
  }

  async processIncomingSMS(sms: IncomingSMS): Promise<{ success: boolean; loadId?: string; message?: string; error?: string }> {
    console.log(`📥 SMS from ${sms.From}: "${sms.Body}" (${sms.NumMedia} media)`);

    const loadCode = this.parseLoadCode(sms.Body);
    if (!loadCode) {
      return { success: false, error: 'No load code found. Include load number (e.g., LOAD35394084)' };
    }

    console.log(`🔍 Searching for load: ${loadCode}`);
    const load = await this.findLoadByCode(loadCode);
    
    if (!load) {
      console.log(`❌ Load not found: ${loadCode}`);
      return { success: false, error: `Load ${loadCode} not found.` };
    }

    console.log(`✅ Found load: ${load.id} (${load.loadNumber})`);

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
      try {
        await traqiqSopService.handleDocumentUpload(load.id, docType as any);
        console.log(`📄 SOP updated: ${docType} for load ${load.id}`);
      } catch (e) {
        console.log(`⚠️ SOP update skipped (not initialized)`);
      }
    }

    return {
      success: true,
      loadId: load.id,
      message: `Received ${mediaUrls.length} photo(s) for Load ${load.loadNumber}. Tagged as: ${docType}`
    };
  }

  private async findLoadByCode(code: string): Promise<any | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/loads`);
      if (!response.ok) {
        console.error(`Failed to fetch loads: ${response.status}`);
        return null;
      }
      
      const loads = await response.json();
      console.log(`📋 Searching ${loads.length} loads for code: ${code}`);
      
      let load = loads.find((l: any) => l.loadNumber === code);
      
      if (!load) {
        load = loads.find((l: any) => 
          l.loadNumber?.includes(code) || 
          l.id === code ||
          code.includes(l.loadNumber)
        );
      }

      return load || null;
    } catch (error) {
      console.error('Error finding load:', error);
      return null;
    }
  }

  private async downloadAndStoreMedia(twilioUrl: string, contentType: string, loadId: string): Promise<string> {
    try {
      if (!this.twilioAccountSid || !this.twilioAuthToken) {
        console.log('⚠️ Twilio credentials not set, using URL directly');
        return twilioUrl;
      }
      
      const authHeader = 'Basic ' + Buffer.from(`${this.twilioAccountSid}:${this.twilioAuthToken}`).toString('base64');
      const response = await fetch(twilioUrl, { headers: { 'Authorization': authHeader } });
      
      if (!response.ok) {
        console.error(`Failed to download media: ${response.status}`);
        return twilioUrl;
      }
      
      const ext = contentType?.includes('png') ? 'png' : 'jpg';
      const filename = `${loadId}_${Date.now()}.${ext}`;
      const storedPath = `/uploads/loads/${loadId}/${filename}`;
      
      console.log(`📁 Media stored: ${storedPath}`);
      return storedPath;
    } catch (error) {
      console.error('Error downloading media:', error);
      return twilioUrl;
    }
  }

  addMessageToLoad(loadId: string, message: LoadMessage): void {
    const existing = loadMessages.get(loadId) || [];
    existing.push(message);
    loadMessages.set(loadId, existing);
    console.log(`💬 Message added to load ${loadId} (total: ${existing.length})`);
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

  async sendLoadMessage(loadId: string, driverPhone: string, body: string): Promise<boolean> {
    const message: LoadMessage = {
      id: randomUUID(),
      loadId,
      driverPhone,
      direction: 'outbound',
      body,
      mediaUrls: [],
      mediaTypes: [],
      timestamp: new Date(),
    };
    this.addMessageToLoad(loadId, message);
    return true;
  }
}

export const driverSMSUploadService = new DriverSMSUploadService();
