import { google } from 'googleapis';

// Setup the Gmail Connection using your Secrets
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

export const gmailIngest = {
  /**
   * Check if Gmail credentials are configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
    );
  },

  /**
   * Scans inbox for unread "Rate Confirmation" emails, downloads PDFs, and marks as read.
   */
  async scanInbox() {
    console.log("📧 Starting Gmail Scan...");
    
    try {
      // 1. Search for UNREAD emails with Rate Confirmation keywords in the subject
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread subject:("Rate Confirmation" OR "RateCon" OR "Load Confirmation" OR "Booking Confirmation") has:attachment',
        maxResults: 10
      });

      const messages = res.data.messages || [];
      console.log(`🔎 Found ${messages.length} new RateCons.`);

      const results = [];

      for (const msg of messages) {
        const email = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
        const parts = email.data.payload?.parts || [];

        // 2. Look for PDF attachments
        for (const part of parts) {
          if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
            
            // 3. Download the PDF data
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: msg.id!,
              id: part.body!.attachmentId!
            });

            // In a real app, you would save this buffer to your DB or Storage here
            const buffer = Buffer.from(attachment.data.data!, 'base64');
            const fileSize = buffer.length;

            console.log(`✅ Downloaded: ${part.filename} (${fileSize} bytes)`);
            results.push({ filename: part.filename, size: fileSize });
          }
        }

        // 4. Mark as READ so we don't process it again
        await gmail.users.messages.batchModify({
          userId: 'me',
          ids: [msg.id!],
          removeLabelIds: ['UNREAD']
        });
      }

      return results;

    } catch (error) {
      console.error("❌ Gmail Connection Error:", error);
      throw error; // Throw so we see it in the API response
    }
  }
};
