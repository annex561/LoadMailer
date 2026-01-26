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
   * Scan accounts for a specific company
   */
  async scanAccountsForCompany(companyId: string): Promise<ScanResult[]> {
    console.log(`🔄 [GMAIL] Starting Scan for company: ${companyId}`);
    const accounts = await db.select().from(gmailAccounts).where(
      and(eq(gmailAccounts.isActive, true), eq(gmailAccounts.companyId, companyId))
    );

    if (accounts.length === 0) {
      console.log("⚠️ [GMAIL] No connected accounts found for this company.");
      return [];
    }

    const results: ScanResult[] = [];
    for (const account of accounts) {
      console.log(`📧 [GMAIL] Scanning: ${account.email}`);
      const result = await this.scanSingleAccount(account);
      results.push(result);
    }
    return results;
  },

  /**
   * 1. MASTER SCAN: Loops through all connected accounts
   */
  async scanAllAccounts(forceRescan: boolean = false): Promise<ScanResult[]> {
    console.log("🔄 [GMAIL] Starting Scan Cycle...");
    const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));

    if (accounts.length === 0) {
      console.log("⚠️ [GMAIL] No connected accounts found.");
      return [];
    }

    const results: ScanResult[] = [];
    for (const account of accounts) {
      console.log(`📧 [GMAIL] Scanning: ${account.email}`);
      const result = await this.scanSingleAccount(account);
      results.push(result);
    }
    return results;
  },

  /**
   * 2. ACCOUNT SCAN: Finds unread emails with attachments
   */
  async scanSingleAccount(account: typeof gmailAccounts.$inferSelect): Promise<ScanResult> {
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

      // SEARCH QUERY: Unread emails that might have files
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults: 10
      });

      const messages = res.data.messages || [];
      console.log(`   🔎 Found ${messages.length} unread emails.`);

      for (const msg of messages) {
        const msgResult = await this.processMessage(gmail, msg.id!, account.companyId);
        result.filesProcessed += msgResult.filesProcessed;
        result.loadsCreated += msgResult.loadsCreated;
        result.loadsUpdated += msgResult.loadsUpdated;
        if (msgResult.error) {
          result.errors.push(msgResult.error);
        }
      }

      // Update Timestamp
      await db.update(gmailAccounts)
        .set({ lastSyncedAt: new Date() })
        .where(eq(gmailAccounts.id, account.id));

    } catch (error: any) {
      console.error(`❌ [GMAIL] Error scanning ${account.email}:`, error);
      result.errors.push(error.message || 'Unknown error');
    }

    return result;
  },

  /**
   * 3. PROCESS EMAIL: Deep-dives for PDFs
   */
  async processMessage(gmail: any, msgId: string, companyId: string): Promise<{filesProcessed: number, loadsCreated: number, loadsUpdated: number, error?: string}> {
    const result = { filesProcessed: 0, loadsCreated: 0, loadsUpdated: 0, error: undefined as string | undefined };

    try {
      const email = await gmail.users.messages.get({ userId: 'me', id: msgId });
      const subject = email.data.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || "Unknown Subject";
      
      console.log(`   📨 Processing: "${subject}"`);

      // A. RECURSIVE ATTACHMENT FINDER
      const attachments = this.findAttachmentsRecursively(email.data.payload);
      
      if (attachments.length === 0) {
        console.log("      ⚠️ No PDF attachments found. Marking read.");
        await gmail.users.messages.batchModify({ userId: 'me', ids: [msgId], removeLabelIds: ['UNREAD'] });
        return result;
      }

      console.log(`      📄 Found ${attachments.length} PDFs. Parsing...`);

      for (const att of attachments) {
        try {
          // B. DOWNLOAD
          const attachmentData = await gmail.users.messages.attachments.get({
            userId: 'me', messageId: msgId, id: att.body.attachmentId
          });

          if (!attachmentData.data.data) continue;
          const buffer = Buffer.from(attachmentData.data.data, 'base64');

          // C. PARSE
          const extractedData = await rateconParser.parsePdf(buffer);
          
          // D. UPSERT (Merge or Create)
          const upsertResult = await this.upsertLoad(extractedData, companyId, att.filename || "unknown.pdf");
          result.filesProcessed++;
          if (upsertResult === 'created') result.loadsCreated++;
          if (upsertResult === 'updated') result.loadsUpdated++;

        } catch (parseError: any) {
          console.error(`      ❌ Failed to parse ${att.filename}:`, parseError);
        }
      }

      // Only mark read if we successfully processed at least one file
      if (result.filesProcessed > 0) {
        await gmail.users.messages.batchModify({
          userId: 'me', ids: [msgId], removeLabelIds: ['UNREAD']
        });
        console.log("      ✅ Email processed & marked as read.");
      }

    } catch (error: any) {
      console.error("      ❌ Failed to process message:", error);
      result.error = error.message;
    }

    return result;
  },

  /**
   * HELPER: Finds attachments no matter how deep they are nested
   */
  findAttachmentsRecursively(payload: any): any[] {
    let results: any[] = [];

    // 1. Check if current part is a PDF
    if (payload.filename && payload.filename.toLowerCase().endsWith('.pdf') && payload.body?.attachmentId) {
      results.push(payload);
    }

    // 2. Dig deeper if there are parts
    if (payload.parts) {
      for (const part of payload.parts) {
        results = results.concat(this.findAttachmentsRecursively(part));
      }
    }

    return results;
  },

  /**
   * 4. UPSERT: Handles Creating AND Merging
   */
  async upsertLoad(data: any, companyId: string, filename: string): Promise<'created' | 'updated' | 'skipped'> {
    // Validate
    const loadNum = data.loadNumber;
    if (!loadNum || loadNum === "MANUAL-REVIEW" || loadNum === "PENDING" || loadNum === "PARSER-ERROR") {
      console.log("      ⚠️ Skipping invalid/empty load number.");
      return 'skipped';
    }

    // Check Existence
    const existingLoad = await db.query.loads.findFirst({
      where: eq(loads.loadNumber, loadNum)
    });

    if (existingLoad) {
      console.log(`      🔄 Merging data into Load #${loadNum}...`);
      
      // MERGE LOGIC
      const newNotes = existingLoad.specialInstructions 
        ? existingLoad.specialInstructions + "\n\n" + (data.notes || "")
        : data.notes;

      await db.update(loads)
        .set({
          rate: data.rate > 0 ? data.rate : existingLoad.rate,
          miles: data.miles > 0 ? data.miles : existingLoad.miles,
          originCity: existingLoad.originCity === "Unknown" || existingLoad.originCity === "Error" ? data.origin : existingLoad.originCity,
          destCity: existingLoad.destCity === "Unknown" || existingLoad.destCity === "Error" ? data.destination : existingLoad.destCity,
          specialInstructions: newNotes,
          brokerPhone: existingLoad.brokerPhone || data.brokerPhone,
          dispatcherName: existingLoad.dispatcherName || data.dispatcherName,
        })
        .where(eq(loads.id, existingLoad.id));
        
      return 'updated';

    } else {
      console.log(`      ✨ Creating NEW Load #${loadNum}...`);
      
      await db.insert(loads).values({
        loadNumber: loadNum,
        rate: data.rate || 0,
        miles: data.miles || 0,
        rpm: data.rpm ? String(data.rpm) : "0",
        brokerName: data.brokerName || "Unknown",
        brokerPhone: data.brokerPhone || "",
        brokerEmail: data.brokerEmail || "",
        dispatcherName: data.dispatcherName || "",
        pickupDate: data.pickupDate || new Date().toISOString(),
        deliveryDate: data.deliveryDate || new Date().toISOString(),
        originCity: data.origin || "Unknown",
        destCity: data.destination || "Unknown",
        weight: data.weight || 0,
        specialInstructions: data.notes || "",
        status: "booked",
        companyId: companyId,
        sopProgress: {}, 
      });
      
      return 'created';
    }
  }
};
