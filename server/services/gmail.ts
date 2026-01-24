import { google } from 'googleapis';
import { db } from "../db";
import { gmailAccounts, loads, activityLog, customers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { rateconParser } from "./ratecon-parser";
import { nanoid } from "nanoid";
import gaDb, { logActivity as gaLogActivity } from "../ga-db";
import { scoreLoad } from "../ga-scoring";

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
   * 1. Loops through ALL connected Gmail accounts in the DB.
   * 2. Scans each inbox for RateCons.
   */
  async scanAllAccounts() {
    console.log("🔄 Starting Multi-Account Scan...");

    if (!this.isConfigured()) {
      console.log("⚠️ Gmail OAuth credentials not configured in environment.");
      return [];
    }

    const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));

    if (accounts.length === 0) {
      console.log("⚠️ No Gmail accounts connected.");
      return [];
    }

    const results = [];
    for (const account of accounts) {
      console.log(`📧 Scanning account: ${account.email}...`);
      const accountResult = await this.scanSingleAccount(account);
      results.push(accountResult);
    }

    return results;
  },

  /**
   * Process a single account using its unique stored Refresh Token
   */
  async scanSingleAccount(account: typeof gmailAccounts.$inferSelect) {
    const result = {
      accountId: account.id,
      email: account.email,
      companyId: account.companyId,
      filesProcessed: 0,
      loadsCreated: 0,
      error: null as string | null
    };

    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );

      oauth2Client.setCredentials({ refresh_token: account.refreshToken });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread subject:("Rate Confirmation" OR "RateCon" OR "Load Confirmation" OR "Booking Confirmation") has:attachment',
        maxResults: 10
      });

      const messages = res.data.messages || [];
      console.log(`   🔎 Found ${messages.length} emails for ${account.email}`);

      for (const msg of messages) {
        const processed = await this.processMessage(gmail, msg.id!, account.companyId);
        if (processed.success) {
          result.filesProcessed++;
          if (processed.loadCreated) result.loadsCreated++;
        }
      }

      await db.update(gmailAccounts)
        .set({ lastSyncedAt: new Date() })
        .where(eq(gmailAccounts.id, account.id));

      console.log(`   ✅ ${account.email}: ${result.filesProcessed} PDFs processed, ${result.loadsCreated} loads created`);

    } catch (error: any) {
      console.error(`❌ Error scanning ${account.email}:`, error.message);
      result.error = error.message;
    }

    return result;
  },

  /**
   * Helper to download PDF, parse with AI, and create load
   */
  async processMessage(gmail: any, msgId: string, companyId: string): Promise<{ success: boolean; loadCreated: boolean }> {
    try {
      const email = await gmail.users.messages.get({ userId: 'me', id: msgId });
      const headers = email.data.payload?.headers || [];
      const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
      const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
      const parts = email.data.payload?.parts || [];

      let loadCreated = false;

      for (const part of parts) {
        if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
          // 1. Download
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msgId,
            id: part.body.attachmentId
          });

          console.log(`   📄 Processing: ${part.filename}...`);

          // 2. Parse (Send to OpenAI)
          const extractedData = await rateconParser.parsePdf(attachment.data.data!);
          console.log(`   🤖 AI Parsed: Load ${extractedData.loadNumber}, Rate $${extractedData.rate}`);

          // 3. Find or create customer based on broker name
          const brokerName = extractedData.brokerName || 'Unknown Broker';
          let customer = await db.query.customers.findFirst({
            where: and(eq(customers.name, brokerName), eq(customers.companyId, companyId))
          });
          
          if (!customer) {
            // Create new customer for this broker
            const [newCustomer] = await db.insert(customers).values({
              id: nanoid(),
              companyId,
              name: brokerName,
              contactPerson: 'Rate Confirmation Import',
              email: from || 'unknown@broker.com',
              phone: 'N/A',
              address: 'Auto-created from email import',
              status: 'active'
            }).returning();
            customer = newCustomer;
            console.log(`   📇 Created new customer: ${brokerName}`);
          }
          
          // 4. Save to Database
          const loadNumber = extractedData.loadNumber || `LOAD-${Date.now()}-${nanoid(6)}`;
          
          const [newLoad] = await db.insert(loads).values({
            id: nanoid(),
            loadNumber,
            companyId,
            customerId: customer.id,
            description: `${extractedData.origin} → ${extractedData.destination}`,
            status: 'booked',
            lifecycleStatus: 'booked',
            origin: extractedData.origin || 'Unknown',
            destination: extractedData.destination || 'Unknown',
            pickupAddress: extractedData.origin || 'See Rate Confirmation',
            deliveryAddress: extractedData.destination || 'See Rate Confirmation',
            pickupTime: extractedData.pickupTime || 'TBD',
            deliveryTime: extractedData.deliveryTime || 'TBD',
            pickupDate: extractedData.pickupDate ? new Date(extractedData.pickupDate) : new Date(),
            deliveryDate: extractedData.deliveryDate ? new Date(extractedData.deliveryDate) : undefined,
            rate: String(extractedData.rate),
            offeredRate: String(extractedData.rate),
            weight: extractedData.weight ? String(extractedData.weight) : undefined,
            equipmentType: 'Dry Van',
            rateconPath: part.filename,
            bookedAt: new Date(),
            notes: `Auto-imported from email: ${subject}\nFrom: ${from}\nBroker: ${extractedData.brokerName}`
          }).returning();

          console.log(`   ✅ Load #${newLoad.loadNumber} Created in DB!`);

          // 4. Log Activity
          await db.insert(activityLog).values({
            companyId,
            entityType: 'LOAD',
            entityId: newLoad.id,
            action: 'AUTO_INGEST',
            actor: 'SYSTEM_AI',
            details: {
              filename: part.filename,
              rate: extractedData.rate,
              brokerName: extractedData.brokerName,
              emailSubject: subject,
              emailFrom: from
            }
          });

          // 5. Also insert into GA Loads (RateCon Inbox) SQLite table
          try {
            const originParts = (extractedData.origin || '').split(',').map((s: string) => s.trim());
            const destParts = (extractedData.destination || '').split(',').map((s: string) => s.trim());
            
            const gaLoadData = {
              id: newLoad.id,
              source: 'email',
              origin_city: originParts[0] || null,
              origin_state: originParts[1] || null,
              origin_zip: null,
              dest_city: destParts[0] || null,
              dest_state: destParts[1] || null,
              dest_zip: null,
              pickup_dt: extractedData.pickupDate || null,
              delivery_dt: extractedData.deliveryDate || null,
              miles: extractedData.miles || null,
              deadhead_miles: 0,
              rate_total: extractedData.rate || null,
              rpm: extractedData.miles && extractedData.rate ? Math.round((extractedData.rate / extractedData.miles) * 100) / 100 : null,
              equipment: 'Dry Van',
              weight_lbs: extractedData.weight || null,
              length_ft: null,
              broker_name: extractedData.brokerName || null,
              broker_email: from || null,
              broker_phone: null,
              status: 'new',
              score: 0,
              notes: `Auto-imported from email: ${subject}`,
              raw_json: JSON.stringify(extractedData)
            };
            
            // Calculate score
            gaLoadData.score = scoreLoad(gaLoadData, { minRPM: 1.8, idealRPM: 2.3, maxRPM: 3.25 });
            
            const insertStmt = gaDb.prepare(`
              INSERT INTO ga_loads (
                id, source,
                origin_city, origin_state, origin_zip,
                dest_city, dest_state, dest_zip,
                pickup_dt, delivery_dt,
                miles, deadhead_miles,
                rate_total, rpm,
                equipment, weight_lbs, length_ft,
                broker_name, broker_email, broker_phone,
                status, score, notes, raw_json
              ) VALUES (
                @id, @source,
                @origin_city, @origin_state, @origin_zip,
                @dest_city, @dest_state, @dest_zip,
                @pickup_dt, @delivery_dt,
                @miles, @deadhead_miles,
                @rate_total, @rpm,
                @equipment, @weight_lbs, @length_ft,
                @broker_name, @broker_email, @broker_phone,
                @status, @score, @notes, @raw_json
              )
              ON CONFLICT(id) DO NOTHING
            `);
            
            insertStmt.run(gaLoadData);
            gaLogActivity(newLoad.id, 'email_ingested', 'system', { source: 'gmail', subject, from });
            console.log(`   📥 Load also added to RateCon Inbox (GA Loads)`);
          } catch (gaError: any) {
            console.error(`   ⚠️ Failed to add to GA Loads:`, gaError.message);
          }

          loadCreated = true;
        }
      }

      await gmail.users.messages.batchModify({
        userId: 'me',
        ids: [msgId],
        removeLabelIds: ['UNREAD']
      });

      return { success: true, loadCreated };

    } catch (error: any) {
      console.error(`   ❌ Error processing message ${msgId}:`, error.message);
      return { success: false, loadCreated: false };
    }
  },

  /**
   * Get accounts for a specific company
   */
  async getAccountsForCompany(companyId: string) {
    return db.select().from(gmailAccounts).where(
      and(
        eq(gmailAccounts.companyId, companyId),
        eq(gmailAccounts.isActive, true)
      )
    );
  },

  /**
   * Add a new Gmail account
   */
  async addAccount(data: { companyId: string; email: string; refreshToken: string }) {
    const [account] = await db.insert(gmailAccounts).values(data).returning();
    return account;
  },

  /**
   * Update an account (company-scoped for security)
   */
  async updateAccountForCompany(id: string, companyId: string, updates: Partial<{
    email: string;
    refreshToken: string;
    isActive: boolean;
  }>) {
    const [updated] = await db.update(gmailAccounts)
      .set(updates)
      .where(and(eq(gmailAccounts.id, id), eq(gmailAccounts.companyId, companyId)))
      .returning();
    return updated || null;
  },

  /**
   * Delete an account (company-scoped for security)
   */
  async deleteAccountForCompany(id: string, companyId: string) {
    const result = await db.delete(gmailAccounts)
      .where(and(eq(gmailAccounts.id, id), eq(gmailAccounts.companyId, companyId)))
      .returning();
    return result.length > 0;
  },

  /**
   * Test a refresh token against the shared OAuth app
   */
  async testAccount(refreshToken: string): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      if (!this.isConfigured()) {
        return { success: false, error: 'GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET not configured' };
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });

      return { success: true, email: profile.data.emailAddress || undefined };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Scan accounts for a specific company only
   */
  async scanAccountsForCompany(companyId: string) {
    console.log(`📧 Starting Gmail Scan for company ${companyId}...`);

    const accounts = await this.getAccountsForCompany(companyId);
    console.log(`📧 Found ${accounts.length} accounts for company ${companyId}`);

    const results = [];
    for (const account of accounts) {
      const result = await this.scanSingleAccount(account);
      results.push(result);
    }

    return results;
  }
};
