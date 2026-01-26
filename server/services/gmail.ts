import { google } from 'googleapis';
import { db } from "../db";
import { gmailAccounts, loads, activityLog } from "@shared/schema"; 
import { eq } from "drizzle-orm";
import { rateconParser } from "./ratecon-parser"; 

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
   * 1. Loops through ALL connected Gmail accounts.
   */
  async scanAllAccounts() {
    console.log("🔄 Starting Multi-Account Scan...");
    const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));

    if (accounts.length === 0) {
      console.log("⚠️ No Gmail accounts connected.");
      return;
    }

    for (const account of accounts) {
      console.log(`📧 Scanning account: ${account.email}...`);
      await this.scanSingleAccount(account);
    }
  },

  /**
   * 2. Scans a single account for emails with attachments
   */
  async scanSingleAccount(account: typeof gmailAccounts.$inferSelect) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: account.refreshToken });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Search for UNREAD emails that have attachments
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread has:attachment', // Broader search to catch "Load Details" too
        maxResults: 5
      });

      const messages = res.data.messages || [];
      console.log(`   🔎 Found ${messages.length} unread emails.`);

      for (const msg of messages) {
        await this.processMessage(gmail, msg.id!, account.companyId);
      }

      // Update "Last Synced" timestamp
      await db.update(gmailAccounts)
        .set({ lastSyncedAt: new Date() })
        .where(eq(gmailAccounts.id, account.id));

    } catch (error) {
      console.error(`❌ Error scanning ${account.email}:`, error);
    }
  },

  /**
   * 3. Process the Email: Finds ALL PDFs (RateCon AND Driver Sheet)
   */
  async processMessage(gmail: any, msgId: string, companyId: string) {
    try {
      const email = await gmail.users.messages.get({ userId: 'me', id: msgId });
      const parts = email.data.payload?.parts || [];
      const subject = email.data.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || "Unknown Subject";

      console.log(`   📨 Processing: "${subject}"`);

      let processedCount = 0;

      // Loop through ALL attachments in the email
      for (const part of parts) {
        if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
          
          console.log(`      📄 Found PDF: ${part.filename}`);

          // A. Download
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me', messageId: msgId, id: part.body!.attachmentId!
          });
          
          if (!attachment.data.data) continue;
          const buffer = Buffer.from(attachment.data.data, 'base64');

          // B. Parse (Extract Data)
          const extractedData = await rateconParser.parsePdf(buffer);
          
          // C. SMART MERGE (The new logic)
          await this.upsertLoad(extractedData, companyId, part.filename);
          
          processedCount++;
        }
      }

      // Only mark as read if we actually did something with it
      if (processedCount > 0) {
        await gmail.users.messages.batchModify({
          userId: 'me', ids: [msgId], removeLabelIds: ['UNREAD']
        });
        console.log("      ✅ Email marked as read.");
      }

    } catch (error) {
      console.error("      ❌ Failed to process message:", error);
    }
  },

  /**
   * 4. THE SMART MERGE FUNCTION
   * Checks if Load # exists. If yes, updates it. If no, creates it.
   */
  async upsertLoad(data: any, companyId: string, filename: string) {
    // 1. Validate Data
    const loadNum = data.loadNumber;
    if (!loadNum || loadNum === "MANUAL-REVIEW" || loadNum === "PENDING") {
      console.log("      ⚠️ Skipping invalid load number.");
      return;
    }

    // 2. Check if this load already exists in DB
    const existingLoad = await db.query.loads.findFirst({
      where: eq(loads.loadNumber, loadNum)
    });

    if (existingLoad) {
      console.log(`      🔄 Merging data into existing Load #${loadNum}...`);
      
      // MERGE LOGIC: Only overwrite if the new data is "better" or missing
      // e.g., If we have a Rate of $0, and this doc has $1000, update it.
      // e.g., If we have empty notes, and this doc has instructions, append them.
      
      const newNotes = existingLoad.specialInstructions 
        ? existingLoad.specialInstructions + "\n\n" + (data.notes || "") // Append
        : data.notes;

      await db.update(loads)
        .set({
          // Update Rate/Miles only if they are positive (don't overwrite with 0)
          rate: data.rate > 0 ? data.rate : existingLoad.rate,
          miles: data.miles > 0 ? data.miles : existingLoad.miles,
          
          // Always try to improve address data if missing
          originCity: existingLoad.originCity === "Unknown" ? data.origin : existingLoad.originCity,
          destCity: existingLoad.destCity === "Unknown" ? data.destination : existingLoad.destCity,
          
          // Merge Notes
          specialInstructions: newNotes,
          
          // Update Broker Info if missing
          brokerPhone: existingLoad.brokerPhone || data.brokerPhone,
          dispatcherName: existingLoad.dispatcherName || data.dispatcherName
        })
        .where(eq(loads.id, existingLoad.id));
        
      // Log the merge
      await db.insert(activityLog).values({
        entityType: "LOAD", entityId: existingLoad.id, action: "DOC_MERGE",
        details: { filename, note: "Merged secondary document" }, actor: "SYSTEM_AI"
      });

    } else {
      console.log(`      ✨ Creating NEW Load #${loadNum}...`);
      
      // CREATE LOGIC (Standard Insert)
      const [newLoad] = await db.insert(loads).values({
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
      }).returning();

      // Log the creation
      await db.insert(activityLog).values({
        entityType: "LOAD", entityId: newLoad.id, action: "AUTO_INGEST",
        details: { filename, rate: data.rate }, actor: "SYSTEM_AI"
      });
    }
  }
};
