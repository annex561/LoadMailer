import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  // Use stripe connector for all environments
  // The environment field in the connection will distinguish between development and production
  const connectorName = 'stripe';

  // Determine which environment to use based on deployment status
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  const data = await response.json();
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret || !connectionSettings.settings.webhook_secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
    webhookSecretKey: connectionSettings.settings.webhook_secret,
  };
}

// WARNING: Never cache this client.
// Always call this function again to get a fresh client.
// Use getUncachableStripeClient() for server-side operations with secret key
export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    // Note that this is the latest API version, don't change it to a old version of the
    // API.
    apiVersion: '2025-08-27.basil',
  });
}

// Use getStripePublishableKey() for client-side operations
export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();

  return publishableKey;
}

// Use getStripeSecretKey() for server-side operations requiring the secret key
export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

// Use getStripeWebhookSecret() for server-side operations with webhook secret
export async function getStripeWebhookSecret() {
  const { webhookSecretKey } = await getCredentials();
  return webhookSecretKey;
}
