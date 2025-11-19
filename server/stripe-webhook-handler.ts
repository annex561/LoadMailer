import { StripeSync } from 'stripe-replit-sync';
import { getStripeSecretKey, getStripeWebhookSecret } from './stripe-client';

let stripeSync: StripeSync | null = null;

async function getStripeSync(): Promise<StripeSync> {
  if (!stripeSync) {
    const secretKey = await getStripeSecretKey();
    const webhookSecret = await getStripeWebhookSecret();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
      stripeWebhookSecret: webhookSecret,
    });
  }
  return stripeSync;
}

/**
 * WebhookHandlers: Processes Stripe webhooks using stripe-replit-sync
 * 
 * This class keeps webhook handling minimal following the blueprint pattern.
 * All Stripe events are automatically synced to PostgreSQL stripe.* schema.
 * 
 * CRITICAL: The payload MUST be a Buffer. If you get errors about payload type,
 * ensure the webhook route is registered BEFORE app.use(express.json())
 */
export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    // Validate payload is a Buffer
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }
    
    const sync = await getStripeSync();
    // Process webhook - stripe-replit-sync handles all event types automatically
    await sync.processWebhook(payload, signature, undefined);
  }
}
