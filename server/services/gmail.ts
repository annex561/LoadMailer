import { google } from 'googleapis';
import { db } from "../db";
import { gmailAccounts, loads, activityLog } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { rateConParser } from "../ratecon-parser";
import { nanoid } from "nanoid";

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
          const attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msgId,
            id: part.body.attachmentId
          });

          const pdfBuffer = Buffer.from(attachment.data.data, 'base64');
          console.log(`   📄 Downloaded: ${part.filename} (${pdfBuffer.length} bytes)`);

          const parsed = await rateConParser.parse(pdfBuffer);
          console.log(`   🤖 AI Parsed: Load ${parsed.loadId}, Rate $${parsed.rate}`);

          const loadNumber = `LOAD-${Date.now()}-${nanoid(6)}`;
          
          await db.insert(loads).values({
            id: nanoid(),
            loadNumber,
            companyId,
            status: 'booked',
            lifecycleStatus: 'booked',
            origin: parsed.pickupLocation || 'Unknown',
            destination: parsed.deliveryLocation || 'Unknown',
            pickupDate: parsed.pickupDate ? new Date(parsed.pickupDate) : new Date(),
            deliveryDate: parsed.deliveryDate ? new Date(parsed.deliveryDate) : undefined,
            rate: String(parsed.rate),
            offeredRate: String(parsed.rate),
            weight: parsed.weight ? String(parsed.weight) : undefined,
            equipmentType: parsed.equipment || 'Dry Van',
            rateconPath: part.filename,
            bookedAt: new Date(),
            notes: `Auto-imported from email: ${subject}\nFrom: ${from}\nOriginal Load ID: ${parsed.loadId}`
          });

          await db.insert(activityLog).values({
            entityType: 'load',
            entityId: loadNumber,
            action: 'RATECON_INGESTED',
            actor: 'gmail-ingestion',
            details: {
              companyId,
              emailSubject: subject,
              emailFrom: from,
              filename: part.filename,
              parsedRate: parsed.rate,
              parsedLoadId: parsed.loadId
            }
          });

          console.log(`   ✅ Created load: ${loadNumber} for company ${companyId}`);
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
