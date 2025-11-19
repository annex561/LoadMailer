import { getUncachableStripeClient } from './stripe-client';
import { db } from './db';
import { sql } from 'drizzle-orm';

/**
 * StripeService: Handles direct Stripe API operations for multi-tenant subscription system
 * Pattern: Use Stripe client for write operations, storage layer for read operations
 */
export class StripeService {
  // Create customer in Stripe with company metadata
  async createCustomer(email: string, companyId: string, companyName?: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      name: companyName,
      metadata: { 
        companyId,
      },
    });
  }

  // Create checkout session for subscription
  async createCheckoutSession(
    customerId: string, 
    priceId: string, 
    successUrl: string, 
    cancelUrl: string,
    companyId: string,
    trialDays?: number
  ) {
    const stripe = await getUncachableStripeClient();
    
    const sessionParams: any = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        companyId,
      },
      subscription_data: {
        metadata: {
          companyId,
        },
      },
    };

    // Add trial period if specified
    if (trialDays && trialDays > 0) {
      sessionParams.subscription_data.trial_period_days = trialDays;
    }

    return await stripe.checkout.sessions.create(sessionParams);
  }

  // Create customer portal session for managing subscription
  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  // Create trial subscription (14-day trial by default)
  async createTrialSubscription(customerId: string, priceId: string, trialDays: number = 14) {
    const stripe = await getUncachableStripeClient();
    return await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
    });
  }

  // Read operations - query from PostgreSQL stripe.* schema (synced via webhooks)
  async getProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`
    );
    return result.rows[0] || null;
  }

  async listProducts(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} ORDER BY created DESC LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async getPrice(priceId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`
    );
    return result.rows[0] || null;
  }

  async listPrices(active = true, limit = 50, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE active = ${active} ORDER BY unit_amount ASC LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async getSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  async getCustomer(customerId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.customers WHERE id = ${customerId}`
    );
    return result.rows[0] || null;
  }

  // Get subscription by company (queries stripe schema)
  async getCompanySubscription(companyId: string) {
    const result = await db.execute(
      sql`
        SELECT s.* 
        FROM stripe.subscriptions s
        WHERE s.metadata->>'companyId' = ${companyId}
        ORDER BY s.created DESC
        LIMIT 1
      `
    );
    return result.rows[0] || null;
  }
}

export const stripeService = new StripeService();
