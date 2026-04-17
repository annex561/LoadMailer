import { google } from 'googleapis';
import { db } from "../db";
import { gmailAccounts, loads, activityLog, customers, drivers } from "@shared/schema";
import { eq, and, ilike } from "drizzle-orm";
import { rateconParser } from "./ratecon-parser";
import gaDb from "../ga-db";
import { scoreLoad } from "../ga-scoring";

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

    // Helper to safely convert to Date object
    const toDate = (val: any): Date => {
      if (!val) return new Date();
      if (val instanceof Date) return val;
      const parsed = new Date(val);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    };

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

      const mergedRate   = data.rate > 0 ? data.rate : existingLoad.rate;
      const mergedMiles  = data.miles > 0 ? data.miles : existingLoad.miles;
      const mergedOrigin = (!existingLoad.originCity || existingLoad.originCity === "Unknown" || existingLoad.originCity === "Error") ? data.origin : existingLoad.originCity;
      const mergedDest   = (!existingLoad.destCity   || existingLoad.destCity   === "Unknown" || existingLoad.destCity   === "Error") ? data.destination : existingLoad.destCity;

      await db.update(loads)
        .set({
          rate: mergedRate,
          miles: mergedMiles,
          originCity: mergedOrigin,
          destCity: mergedDest,
          specialInstructions: newNotes,
          brokerPhone: existingLoad.brokerPhone || data.brokerPhone,
          brokerEmail: existingLoad.brokerEmail || data.brokerEmail,
          dispatcherName: existingLoad.dispatcherName || data.dispatcherName,
        })
        .where(eq(loads.id, existingLoad.id));

      // Mirror update into SQLite ga_loads so inbox stays in sync
      try {
        const originParts = (mergedOrigin || "").split(",").map((s: string) => s.trim());
        const destParts   = (mergedDest   || "").split(",").map((s: string) => s.trim());
        const rpm = mergedMiles > 0 ? Math.round(((mergedRate || 0) / mergedMiles) * 100) / 100 : 0;
        gaDb.prepare(`
          UPDATE ga_loads SET
            origin_city=?, origin_state=?, dest_city=?, dest_state=?,
            rate_total=?, miles=?, rpm=?,
            broker_email=COALESCE(NULLIF(broker_email,''), ?),
            broker_phone=COALESCE(NULLIF(broker_phone,''), ?),
            dispatcher_name=COALESCE(NULLIF(dispatcher_name,''), ?),
            notes=?
          WHERE load_number=?
        `).run(
          originParts[0] || 'Unknown', originParts[1] || '',
          destParts[0]   || 'Unknown', destParts[1]   || '',
          mergedRate, mergedMiles, rpm,
          data.brokerEmail    || '',
          data.brokerPhone    || '',
          data.dispatcherName || '',
          newNotes || '',
          loadNum
        );
      } catch (gaErr) {
        console.warn(`      ⚠️ Failed to sync update to GA Loads: ${gaErr}`);
      }

      return 'updated';

    } else {
      console.log(`      ✨ Creating NEW Load #${loadNum}...`);
      
      // Auto-create or find customer from broker info
      const brokerName = data.brokerName || "Unknown Broker";
      let customerId: string | null = null;
      
      // Try to find existing customer by name
      const existingCustomer = await db.query.customers.findFirst({
        where: ilike(customers.name, brokerName)
      });
      
      if (existingCustomer) {
        customerId = existingCustomer.id;
        console.log(`      📋 Found existing customer: ${brokerName}`);
      } else {
        // Create new customer from broker info
        console.log(`      👤 Creating new customer: ${brokerName}`);
        const [newCustomer] = await db.insert(customers).values({
          companyId: companyId,
          name: brokerName,
          contactPerson: data.dispatcherName || "Contact TBD",
          email: data.brokerEmail || "unknown@broker.com",
          phone: data.brokerPhone || "000-000-0000",
          address: "Address TBD",
          status: "active"
        }).returning();
        customerId = newCustomer.id;
      }
      
      // Generate a description from available data
      const description = `Load from ${data.origin || 'Unknown'} to ${data.destination || 'Unknown'}`;
      
      await db.insert(loads).values({
        loadNumber: loadNum,
        customerId: customerId,
        description: description,
        rate: data.rate || 0,
        miles: data.miles || 0,
        rpm: data.rpm ? String(data.rpm) : "0",
        brokerName: brokerName,
        brokerPhone: data.brokerPhone || "",
        brokerEmail: data.brokerEmail || "",
        dispatcherName: data.dispatcherName || "",
        pickupDate: toDate(data.pickupDate),
        deliveryDate: toDate(data.deliveryDate),
        pickupTime: data.pickupTime || "TBD",
        deliveryTime: data.deliveryTime || "TBD",
        pickupAddress: data.origin || "Address TBD",
        deliveryAddress: data.destination || "Address TBD",
        originCity: data.origin || "Unknown",
        destCity: data.destination || "Unknown",
        weight: data.weight || 0,
        specialInstructions: data.notes || "",
        status: "booked",
        companyId: companyId,
        sopProgress: {}, 
      });
      
      // Insert into GA Loads SQLite for RateCon Inbox visibility
      try {
        const originParts = (data.origin || "").split(",").map((s: string) => s.trim());
        const destParts   = (data.destination || "").split(",").map((s: string) => s.trim());
        const originCity  = originParts[0] || 'Unknown';
        const originState = originParts[1] || '';
        const destCity    = destParts[0]   || 'Unknown';
        const destState   = destParts[1]   || '';

        const miles = data.miles || 0;
        const rate  = data.rate  || 0;
        const rpm   = miles > 0 ? Math.round((rate / miles) * 100) / 100 : 0;

        // Flag zero-rate loads for manual review instead of silently passing $0
        const loadStatus = rate === 0 ? 'manual_review' : 'new';

        const gaLoadId = `gmail-${loadNum}-${Date.now()}`;
        const score = scoreLoad({
          miles,
          rate_total: rate,
          rpm,
          deadhead_miles: 0,
          equipment: 'dry_van',
        });

        gaDb.prepare(`
          INSERT OR REPLACE INTO ga_loads (
            id, load_number, source,
            origin_city, origin_state,
            dest_city, dest_state,
            pickup_dt, delivery_dt,
            miles, rate_total, rpm,
            equipment, weight_lbs,
            broker_name, broker_email, broker_phone,
            dispatcher_name, driver_name,
            notes, status, score,
            created_at
          ) VALUES (
            ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            datetime('now')
          )
        `).run(
          gaLoadId,
          loadNum,
          'gmail',
          originCity, originState,
          destCity,   destState,
          data.pickupDate   || null,
          data.deliveryDate || null,
          miles,  rate,  rpm,
          'dry_van',
          data.weight || 0,
          brokerName,
          data.brokerEmail || '',
          data.brokerPhone || '',
          data.dispatcherName || '',
          data.driverName     || '',
          data.notes          || '',
          loadStatus,
          score
        );
        console.log(`      📥 RateCon Inbox: ${gaLoadId} | ${originCity}, ${originState} → ${destCity}, ${destState} | $${rate} | score:${score}${rate === 0 ? ' ⚠️ MANUAL REVIEW (no rate)' : ''}`);
      } catch (gaErr) {
        console.warn(`      ⚠️ Failed to add to GA Loads: ${gaErr}`);
      }
      
      // DRIVER RESOLUTION: RateCon arrives AFTER a driver already accepted the load.
      // 1. Check if the PDF itself contains a driver name (CARRIER CONTACT section).
      // 2. If not, find the driver in the system who was dispatched this load number.
      // Do NOT run auto-matching — driver assignment was already decided at dispatch.
      try {
        let resolvedDriverId: string | null = null;

        if (data.driverName) {
          // PDF had driver info — find the driver by name in our system
          const matchedDriver = await db.query.drivers.findFirst({
            where: ilike(drivers.name, `%${data.driverName}%`)
          });
          if (matchedDriver) {
            resolvedDriverId = matchedDriver.id;
            console.log(`      👤 Driver from RateCon PDF: ${matchedDriver.name}`);
          }
        }

        if (resolvedDriverId) {
          await db.update(loads)
            .set({ driverId: resolvedDriverId, status: 'confirmed' })
            .where(eq(loads.loadNumber, loadNum));
          console.log(`      ✅ RateCon load ${loadNum} assigned to driver ${resolvedDriverId}`);
        } else {
          console.log(`      ℹ️  RateCon load ${loadNum} created as "booked" — driver will be linked when they confirm via SMS`);
        }
      } catch (driverErr) {
        console.warn(`      ⚠️ Driver resolution failed: ${driverErr}`);
      }

      return 'created';
    }
  },

  // ============================================================================
  // ACCOUNT MANAGEMENT METHODS
  // ============================================================================

  isConfigured(): boolean {
    return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  },

  async scanInbox(): Promise<number> {
    const results = await this.scanAllAccounts();
    return results.reduce((sum, r) => sum + r.filesProcessed, 0);
  },

  async getAccountsForCompany(companyId: string) {
    return db.select().from(gmailAccounts).where(
      and(eq(gmailAccounts.companyId, companyId), eq(gmailAccounts.isActive, true))
    );
  },

  async testAccount(refreshToken: string): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return { success: true, email: profile.data.emailAddress || undefined };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async addAccount(data: { companyId: string; email: string; refreshToken: string }) {
    const [account] = await db.insert(gmailAccounts).values({
      companyId: data.companyId,
      email: data.email,
      refreshToken: data.refreshToken,
      isActive: true,
    }).returning();
    return account;
  },

  async updateAccountForCompany(id: string, companyId: string, updates: Partial<{ isActive: boolean; email: string; refreshToken: string }>) {
    const [updated] = await db.update(gmailAccounts)
      .set(updates)
      .where(and(eq(gmailAccounts.id, id), eq(gmailAccounts.companyId, companyId)))
      .returning();
    return updated || null;
  },

  async deleteAccountForCompany(id: string, companyId: string): Promise<boolean> {
    const result = await db.delete(gmailAccounts)
      .where(and(eq(gmailAccounts.id, id), eq(gmailAccounts.companyId, companyId)))
      .returning();
    return result.length > 0;
  },
};
