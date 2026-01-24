import { google, gmail_v1 } from 'googleapis';
import { db } from '../db';
import { gmailAccounts, GmailAccount } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

interface ScanResult {
  filename: string;
  size: number;
  emailSubject?: string;
  from?: string;
}

interface AccountScanResult {
  accountId: string;
  email: string;
  files: ScanResult[];
  error?: string;
}

function createGmailClient(refreshToken: string): gmail_v1.Gmail {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be configured in environment');
  }
  
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function scanSingleAccount(gmail: gmail_v1.Gmail, accountEmail: string): Promise<ScanResult[]> {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread subject:("Rate Confirmation" OR "RateCon" OR "Load Confirmation" OR "Booking Confirmation") has:attachment',
    maxResults: 10
  });

  const messages = res.data.messages || [];
  const results: ScanResult[] = [];

  for (const msg of messages) {
    const email = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
    const headers = email.data.payload?.headers || [];
    const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
    const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
    const parts = email.data.payload?.parts || [];

    for (const part of parts) {
      if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: msg.id!,
          id: part.body!.attachmentId!
        });

        const buffer = Buffer.from(attachment.data.data!, 'base64');
        console.log(`✅ [${accountEmail}] Downloaded: ${part.filename} (${buffer.length} bytes)`);
        results.push({ 
          filename: part.filename, 
          size: buffer.length,
          emailSubject: subject,
          from
        });
      }
    }

    await gmail.users.messages.batchModify({
      userId: 'me',
      ids: [msg.id!],
      removeLabelIds: ['UNREAD']
    });
  }

  return results;
}

export const gmailIngest = {
  isConfigured(): boolean {
    return !!(
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
    );
  },

  async scanInbox(): Promise<ScanResult[]> {
    console.log("📧 Starting Gmail Scan (default account)...");
    
    if (!this.isConfigured()) {
      throw new Error('Gmail credentials not configured');
    }

    try {
      const gmail = createGmailClient(process.env.GMAIL_REFRESH_TOKEN!);
      return await scanSingleAccount(gmail, 'Default');
    } catch (error) {
      console.error("❌ Gmail Connection Error:", error);
      throw error;
    }
  },

  async getAccountsForCompany(companyId: string): Promise<GmailAccount[]> {
    return db.select().from(gmailAccounts).where(
      and(
        eq(gmailAccounts.companyId, companyId),
        eq(gmailAccounts.isActive, true)
      )
    );
  },

  async getAllActiveAccounts(): Promise<GmailAccount[]> {
    return db.select().from(gmailAccounts).where(eq(gmailAccounts.isActive, true));
  },

  async addAccount(data: {
    companyId: string;
    email: string;
    refreshToken: string;
  }): Promise<GmailAccount> {
    const [account] = await db.insert(gmailAccounts).values(data).returning();
    return account;
  },

  async updateAccountForCompany(id: string, companyId: string, updates: Partial<{
    email: string;
    refreshToken: string;
    isActive: boolean;
  }>): Promise<GmailAccount | null> {
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

  async scanAccountsForCompany(companyId: string): Promise<AccountScanResult[]> {
    console.log(`📧 Starting Gmail Scan for company ${companyId}...`);
    const results: AccountScanResult[] = [];

    const dbAccounts = await this.getAccountsForCompany(companyId);
    console.log(`📧 Found ${dbAccounts.length} accounts for company ${companyId}`);

    for (const account of dbAccounts) {
      try {
        const gmail = createGmailClient(account.refreshToken);
        const files = await scanSingleAccount(gmail, account.email);

        await db.update(gmailAccounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(gmailAccounts.id, account.id));

        results.push({
          accountId: account.id,
          email: account.email,
          files
        });
      } catch (error: any) {
        console.error(`❌ [${account.email}] Error:`, error.message);
        results.push({
          accountId: account.id,
          email: account.email,
          files: [],
          error: error.message
        });
      }
    }

    const totalFiles = results.reduce((sum, r) => sum + r.files.length, 0);
    console.log(`📧 Company Scan Complete: ${totalFiles} files from ${results.length} accounts`);

    return results;
  },

  async scanAllAccounts(): Promise<AccountScanResult[]> {
    console.log("📧 Starting Multi-Account Gmail Scan...");
    const results: AccountScanResult[] = [];

    if (this.isConfigured()) {
      try {
        const gmail = createGmailClient(process.env.GMAIL_REFRESH_TOKEN!);
        const files = await scanSingleAccount(gmail, 'Default (Environment)');
        results.push({
          accountId: 'default',
          email: 'configured-via-secrets',
          files
        });
      } catch (error: any) {
        console.error("❌ Default account error:", error.message);
        results.push({
          accountId: 'default',
          email: 'configured-via-secrets',
          files: [],
          error: error.message
        });
      }
    }

    const dbAccounts = await this.getAllActiveAccounts();
    console.log(`📧 Found ${dbAccounts.length} database-configured accounts`);

    for (const account of dbAccounts) {
      try {
        const gmail = createGmailClient(account.refreshToken);
        const files = await scanSingleAccount(gmail, account.email);

        await db.update(gmailAccounts)
          .set({ lastSyncedAt: new Date() })
          .where(eq(gmailAccounts.id, account.id));

        results.push({
          accountId: account.id,
          email: account.email,
          files
        });
      } catch (error: any) {
        console.error(`❌ [${account.email}] Error:`, error.message);
        results.push({
          accountId: account.id,
          email: account.email,
          files: [],
          error: error.message
        });
      }
    }

    const totalFiles = results.reduce((sum, r) => sum + r.files.length, 0);
    console.log(`📧 Multi-Account Scan Complete: ${totalFiles} files from ${results.length} accounts`);

    return results;
  },

  async testAccount(refreshToken: string): Promise<{ success: boolean; email?: string; error?: string }> {
    try {
      const gmail = createGmailClient(refreshToken);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return { success: true, email: profile.data.emailAddress || undefined };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};
