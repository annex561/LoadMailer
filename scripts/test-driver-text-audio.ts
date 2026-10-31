/**
 * Manual test-send script for the driver text audio feature.
 *
 * Sends 2 MMS to a test phone number:
 *   1. A simulated Text 1 body (cities + rate, no full addresses) with TTS audio attached.
 *   2. A simulated Text 2 body (full addresses) with TTS audio attached.
 *
 * Usage:
 *   npx tsx scripts/test-driver-text-audio.ts +15551234567
 *   TEST_TO=+15551234567 npx tsx scripts/test-driver-text-audio.ts
 *
 * Requires env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID,
 *   CLOUDINARY_URL, and either TEST_TO or a first arg.
 *
 * SAFETY: Script REFUSES to run without TEST_TO. Does NOT hit production
 * loads or drivers. Does NOT send to any driver phone. Real Twilio and
 * Cloudinary calls ARE made — this costs real spend. Only run with
 * DRIVER_TEXT_AUDIO_ENABLED=true explicitly confirmed by Annex.
 */

import 'dotenv/config';

const testTo: string = (process.argv[2] || process.env.TEST_TO || '').trim();

if (!testTo) {
  console.error(
    'ERROR: TEST_TO phone number required.\n' +
    'Pass it as the first argument:  npx tsx scripts/test-driver-text-audio.ts +15551234567\n' +
    'Or set env var:                  TEST_TO=+15551234567 npx tsx scripts/test-driver-text-audio.ts',
  );
  process.exit(1);
}

if (!/^\+1\d{10}$/.test(testTo)) {
  console.error(`ERROR: TEST_TO must be E.164 format (+1XXXXXXXXXX). Got: ${testTo}`);
  process.exit(1);
}

const REQUIRED_VARS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'CLOUDINARY_URL'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length) {
  console.error(`ERROR: Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const hasMsgSvc = !!process.env.TWILIO_MESSAGING_SERVICE_SID;
const hasPhone  = !!process.env.TWILIO_PHONE_NUMBER;
if (!hasMsgSvc && !hasPhone) {
  console.error('ERROR: TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER must be set.');
  process.exit(1);
}

import { audioUrlForText } from '../server/driver-text-audio';
import twilio from 'twilio';

const TEXT1_BODY = `LAMP Logistics
Please remember, you are working with LAMP Logistics.
============================
PU: 6/2 FCFS 08:00 to 12:00
Anderson, SC
============================
DROP: 6/3 Appt 08:00 to 10:00
Palm Bay, FL
============================
Weight: 850
============================
24/7 support: (855) 599-9983
Stay safe on the road!
============================
Rate $ 500
============================
Please confirm and provide ETA`;

const TEXT2_BODY = `LAMP Logistics
Please remember, you are working with LAMP Logistics.
============================
PU: 6/2 FCFS 08:00 to 12:00
123 Industrial Blvd, Anderson, SC 29621
============================
DROP: 6/3 Appt 08:00 to 10:00
456 Harbor Dr, Palm Bay, FL 32905
============================
Weight: 850
============================
24/7 support: (855) 599-9983
Stay safe on the road!
============================
Rate $ 500`;

async function main() {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
  const msgSvcSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  console.log(`\n📱 Sending 2 test MMS to ${testTo}\n`);

  for (const [label, body, sendLabel] of [
    ['Text 1', TEXT1_BODY, 'text1_test'],
    ['Text 2', TEXT2_BODY, 'text2_test'],
  ] as Array<[string, string, string]>) {
    console.log(`── ${label} ──────────────────────────────`);
    console.log('Generating TTS audio...');

    const audioUrl = await audioUrlForText(body, sendLabel);
    if (!audioUrl) {
      console.warn(`⚠️  TTS/Cloudinary failed for ${label} — sending text-only`);
    } else {
      console.log(`✅ Audio URL: ${audioUrl}`);
    }

    const params: any = {
      to: testTo,
      body,
      ...(audioUrl ? { mediaUrl: [audioUrl] } : {}),
      ...(msgSvcSid ? { messagingServiceSid: msgSvcSid } : { from: fromPhone }),
    };

    try {
      const msg = await client.messages.create(params);
      console.log(`✅ ${label} sent. SID: ${msg.sid}  numMedia: ${params.mediaUrl?.length ?? 0}\n`);
    } catch (err: any) {
      console.error(`❌ ${label} failed:`, err?.message || err, '\n');
    }
  }

  console.log('Done. Check your phone for 2 MMS messages.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
