import { google } from 'googleapis';
import { db } from "../db";
import { gmailAccounts, loads, activityLog } from "@shared/schema"; 
import { eq, and } from "drizzle-orm";
import { rateconParser } from "./ratecon-parser"; 

interface ScanResult {
  account: string;
  filesProcessed: number;
  loadsCreated: number;
  loadsUpdated: number;
  errors: string[];
}

export const gmailIngest = {
  /**
   * Check if shared OAuth credentials are configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET
    );
  },

  /**
   * Scan accounts for a specific company
   */
  async scanAccountsForCompany(companyId: string): Promise<ScanResult[]> {
    console.log(`🔄 Starting Gmail Scan for company: ${companyId}`);
    const accounts = await db.select().from(gmailAccounts).where(
      and(eq(gmailAccounts.isActive, true), eq(gmailAccounts.companyId, companyId))
    );

    if (accounts.length === 0) {
      console.log("⚠️ No Gmail accounts connected for this company.");
      return [];
    }

    const results: ScanResult[] = [];
    for (const account of accounts) {
      console.log(`📧 Scanning account: ${account.email}...`);
      const result = await this.scanSingleAccount(account);
      results.push(result);
    }
    return results;
  },

  /**
   * 1. Loops through ALL connected Gmail accounts.
   */
  async scanAllAccounts(forceRescan: boolean = false): Promise<ScanResult[]> {
    console.log("🔄 Starting Multi-Account Gmail Scan...");
    const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));

    if (accounts.length === 0) {
      console.log("⚠️ No Gmail accounts connected.");
      return [];
    }

    const results: ScanResult[] = [];
    for (const account of accounts) {
      console.log(`📧 Scanning account: ${account.email}...`);
      const result = await this.scanSingleAccount(account, forceRescan);
      results.push(result);
    }
    return results;
  },

  /**
   * 2. Scans a single account for emails with attachments
   */
  async scanSingleAccount(account: typeof gmailAccounts.$inferSelect, forceRescan: boolean = false): Promise<ScanResult> {
    const result: ScanResult = {
      account: account.email,
      filesProcessed: 0,
      loadsCreated: 0,
      loadsUpdated: 0,
      errors: []
    };

    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: account.refreshToken });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Search query - if forceRescan, include read emails too
      const query = forceRescan 
        ? 'has:attachment (subject:rate confirmation OR subject:ratecon OR subject:load details OR subject:driver sheet)'
        : 'is:unread has:attachment';
      
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 10
      });

      const messages = res.data.messages || [];
      console.log(`   🔎 Found ${messages.length} emails to process.`);

      for (const msg of messages) {
        const msgResult = await this.processMessage(gmail, msg.id!, account.companyId);
        result.filesProcessed += msgResult.filesProcessed;
        result.loadsCreated += msgResult.loadsCreated;
        result.loadsUpdated += msgResult.loadsUpdated;
        if (msgResult.error) {
          result.errors.push(msgResult.error);
        }
      }

      // Update "Last Synced" timestamp
      await db.update(gmailAccounts)
        .set({ lastSyncedAt: new Date() })
        .where(eq(gmailAccounts.id, account.id));

    } catch (error: any) {
      console.error(`❌ Error scanning ${account.email}:`, error);
      result.errors.push(error.message || 'Unknown error');
    }

    return result;
  },

  /**
   * 3. Process the Email: Finds ALL PDFs (RateCon AND Driver Sheet)
   */
  async processMessage(gmail: any, msgId: string, companyId: string): Promise<{filesProcessed: number, loadsCreated: number, loadsUpdated: number, error?: string}> {
    const result = { filesProcessed: 0, loadsCreated: 0, loadsUpdated: 0, error: undefined as string | undefined };
    
    try {
      const email = await gmail.users.messages.get({ userId: 'me', id: msgId });
      const payload = email.data.payload;
      const subject = payload?.headers?.find((h: any) => h.name === 'Subject')?.value || "Unknown Subject";

      console.log(`   📨 Processing: "${subject}"`);

      // Get all parts including nested ones
      const allParts = this.getAllParts(payload);
      
      // Loop through ALL attachments in the email
      for (const part of allParts) {
        if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
          
          console.log(`      📄 Found PDF: ${part.filename}`);

          try {
            // A. Download
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me', messageId: msgId, id: part.body.attachmentId
            });
            
            if (!attachment.data.data) continue;
            const buffer = Buffer.from(attachment.data.data, 'base64');

            // B. Parse (Extract Data)
            const extractedData = await rateconParser.parsePdf(buffer);
            
            // C. SMART MERGE (The new logic)
            const upsertResult = await this.upsertLoad(extractedData, companyId, part.filename);
            
            result.filesProcessed++;
            if (upsertResult === 'created') result.loadsCreated++;
            if (upsertResult === 'updated') result.loadsUpdated++;
          } catch (parseErr: any) {
            console.error(`      ❌ Failed to parse PDF ${part.filename}:`, parseErr);
          }
        }
      }

      // Only mark as read if we actually did something with it
      if (result.filesProcessed > 0) {
        try {
          await gmail.users.messages.modify({
            userId: 'me', 
            id: msgId, 
            requestBody: { removeLabelIds: ['UNREAD'] }
          });
          console.log("      ✅ Email marked as read.");
        } catch (modifyErr) {
          console.log("      ⚠️ Could not mark email as read");
        }
      }

    } catch (error: any) {
      console.error("      ❌ Failed to process message:", error);
      result.error = error.message;
    }
    
    return result;
  },

  /**
   * Recursively get all parts from email payload (handles nested multipart)
   */
  getAllParts(payload: any): any[] {
    const parts: any[] = [];
    
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.parts) {
          // Nested multipart - recurse
          parts.push(...this.getAllParts(part));
        } else {
          parts.push(part);
        }
      }
    } else if (payload.body?.attachmentId) {
      // Single part with attachment
      parts.push(payload);
    }
    
    return parts;
  },

  /**
   * 4. THE SMART MERGE FUNCTION
   * Checks if Load # exists. If yes, updates it. If no, creates it.
   */
  async upsertLoad(data: any, companyId: string, filename: string): Promise<'created' | 'updated' | 'skipped'> {
    // 1. Validate Data
    const loadNum = data.loadNumber;
    if (!loadNum || loadNum === "MANUAL-REVIEW" || loadNum === "PENDING") {
      console.log("      ⚠️ Skipping invalid load number.");
      return 'skipped';
    }

    // 2. Check if this load already exists in DB
    const existingLoad = await db.query.loads.findFirst({
      where: eq(loads.loadNumber, loadNum)
    });

    if (existingLoad) {
      console.log(`      🔄 Merging data into existing Load #${loadNum}...`);
      
      // MERGE LOGIC: Only overwrite if the new data is "better" or missing
      const newNotes = existingLoad.specialInstructions 
        ? existingLoad.specialInstructions + "\n\n" + (data.notes || "")
        : data.notes;

      await db.update(loads)
        .set({
          rate: data.rate > 0 ? data.rate : existingLoad.rate,
          miles: data.miles > 0 ? data.miles : existingLoad.miles,
          originCity: existingLoad.originCity === "Unknown" ? data.origin : existingLoad.originCity,
          destCity: existingLoad.destCity === "Unknown" ? data.destination : existingLoad.destCity,
          specialInstructions: newNotes,
          brokerPhone: existingLoad.brokerPhone || data.brokerPhone,
          dispatcherName: existingLoad.dispatcherName || data.dispatcherName
        })
        .where(eq(loads.id, existingLoad.id));
        
      await db.insert(activityLog).values({
        entityType: "LOAD", entityId: existingLoad.id, action: "DOC_MERGE",
        details: { filename, note: "Merged secondary document" }, actor: "SYSTEM_AI",
        companyId: existingLoad.companyId || companyId
      });

      return 'updated';

    } else {
      console.log(`      ✨ Creating NEW Load #${loadNum}...`);
      
      // Parse dates properly - handle string dates from AI parsing
      const parseDate = (dateVal: any): Date => {
        if (!dateVal) return new Date();
        if (dateVal instanceof Date) return dateVal;
        try {
          return new Date(dateVal);
        } catch {
          return new Date();
        }
      };

      const [newLoad] = await db.insert(loads).values({
        loadNumber: loadNum,
        rate: data.rate || 0,
        miles: data.miles || 0,
        rpm: data.rpm ? String(data.rpm) : "0",
        brokerName: data.brokerName || "Unknown",
        brokerPhone: data.brokerPhone || "",
        brokerEmail: data.brokerEmail || "",
        dispatcherName: data.dispatcherName || "",
        pickupDate: parseDate(data.pickupDate),
        deliveryDate: parseDate(data.deliveryDate),
        originCity: data.origin || "Unknown",
        destCity: data.destination || "Unknown",
        weight: data.weight || 0,
        specialInstructions: data.notes || "",
        status: "booked",
        companyId: companyId,
        sopProgress: {}, 
      }).returning();

      await db.insert(activityLog).values({
        entityType: "LOAD", entityId: newLoad.id, action: "AUTO_INGEST",
        details: { filename, rate: data.rate }, actor: "SYSTEM_AI",
        companyId: companyId
      });

      return 'created';
    }
  }
};
