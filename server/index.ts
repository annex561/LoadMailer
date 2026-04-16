import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes, createHTTPServer } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// CRITICAL: Stripe webhook route MUST be registered BEFORE express.json()
// The webhook needs raw Buffer, not parsed JSON
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature' });
    }
    
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      const { WebhookHandlers } = await import('./stripe-webhook-handler');
      
      // Validate that req.body is a Buffer (not parsed JSON)
      if (!Buffer.isBuffer(req.body)) {
        const errorMsg = 'STRIPE WEBHOOK ERROR: req.body is not a Buffer. ' +
          'This means express.json() ran before this webhook route. ' +
          'FIX: Move this webhook route registration BEFORE app.use(express.json()) in your code.';
        log(errorMsg);
        return res.status(500).json({ error: 'Webhook processing error' });
      }
      
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      
      res.status(200).json({ received: true });
    } catch (error: any) {
      log(`Webhook error: ${error.message}`);
      
      // Log helpful error message if it's the common "payload must be Buffer" error
      if (error.message && error.message.includes('payload must be provided as a string or a Buffer')) {
        const helpfulMsg = 'STRIPE WEBHOOK ERROR: Payload is not a Buffer. ' +
          'This usually means express.json() parsed the body before the webhook handler. ' +
          'FIX: Ensure the webhook route is registered BEFORE app.use(express.json()).';
        log(helpfulMsg);
      }
      
      res.status(400).json({ error: 'Webhook processing error' });
    }
  }
);

// Now apply JSON middleware for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Health check for Railway (must respond quickly)
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Diagnostic: show actual DB columns and test insert
app.get("/api/debug/schema", async (_req, res) => {
  try {
    const { pool } = await import('./db');
    const result = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'drivers' ORDER BY ordinal_position`
    );
    res.json({ columns: result.rows.map((r: any) => r.column_name), count: result.rows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message, code: (e as any).code, detail: (e as any).detail });
  }
});

app.get("/api/debug/insert-test", async (_req, res) => {
  try {
    const { pool } = await import('./db');
    const { randomUUID } = await import('crypto');
    const testId = randomUUID();
    const testEmail = `test_${Date.now()}@test.com`;
    await pool.query(
      `INSERT INTO drivers (id, name, email, phone, status, is_onboarded, created_at) VALUES ($1, 'Test', $2, '+19995550001', 'available', true, NOW())`,
      [testId, testEmail]
    );
    await pool.query(`DELETE FROM drivers WHERE id = $1`, [testId]);
    res.json({ success: true, message: 'Insert + delete worked!' });
  } catch (e: any) {
    res.status(500).json({ error: e.message, code: (e as any).code, detail: (e as any).detail, constraint: (e as any).constraint });
  }
});

// API route protection middleware - ensures API routes are handled before Vite fallback
app.use('/api', (req, res, next) => {
  // Mark this request as an API request
  req.isAPIRequest = true;
  res.setHeader('Content-Type', 'application/json');
  
  // Override the Vite fallback for API routes
  const originalSend = res.send;
  const originalJson = res.json;
  const originalStatus = res.status;
  
  // Track if response was sent by API routes
  let apiResponseSent = false;
  
  res.send = function(data) {
    apiResponseSent = true;
    res.setHeader('X-API-Response', 'true');
    res.setHeader('Content-Type', 'application/json');
    return originalSend.call(this, data);
  };
  
  res.json = function(data) {
    apiResponseSent = true;
    res.setHeader('X-API-Response', 'true');
    res.setHeader('Content-Type', 'application/json');
    return originalJson.call(this, data);
  };
  
  res.status = function(code) {
    if (code >= 400) {
      // For error responses, ensure we send JSON
      const result = originalStatus.call(this, code);
      if (!apiResponseSent) {
        // If no response sent yet, this will be handled by error middleware
        req.shouldSendJSONError = true;
      }
      return result;
    }
    return originalStatus.call(this, code);
  };
  
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    log('🚀 Starting server initialization...');

    // Ensure all DB columns exist (idempotent ALTER TABLE IF NOT EXISTS)
    try {
      const { ensureSchema } = await import('./ensure-schema');
      await ensureSchema();
    } catch (e: any) {
      log(`⚠️ ensureSchema failed: ${e.message}`);
    }

    // Initialize Stripe schema and sync data BEFORE route registration
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      try {
        log('⚙️ Initializing Stripe schema...');
        const { runMigrations } = await import('stripe-replit-sync');
        await runMigrations({ databaseUrl, schema: 'stripe' });
        log('✅ Stripe schema ready');

        log('🔄 Syncing Stripe data from Stripe API...');
        const { StripeSync } = await import('stripe-replit-sync');
        const { getStripeSecretKey, getStripeWebhookSecret } = await import('./stripe-client');
        
        const secretKey = await getStripeSecretKey();
        const webhookSecret = await getStripeWebhookSecret();
        
        const stripeSync = new StripeSync({
          poolConfig: {
            connectionString: databaseUrl,
            max: 10,
          },
          stripeSecretKey: secretKey,
          stripeWebhookSecret: webhookSecret,
        });
        await stripeSync.syncBackfill();
        log('✅ Stripe data synced to PostgreSQL');
      } catch (error: any) {
        log(`⚠️ Stripe initialization failed: ${error.message}`);
        log('⚠️ Continuing without Stripe - please configure STRIPE_SECRET_KEY in Railway environment variables');
      }
    } else {
      log('⚠️ DATABASE_URL not found - skipping Stripe initialization');
    }
    
    // Add timeout wrapper for route registration on main app
    const routeRegistrationPromise = registerRoutes(app);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Route registration timeout after 30 seconds')), 30000);
    });
    
    log('⏳ Registering routes...');
    await Promise.race([routeRegistrationPromise, timeoutPromise]);
    log('✅ Routes registered successfully');

    // Create HTTP server after route registration
    const server = createHTTPServer(app);
    log('✅ HTTP server created');

    // DISABLED: This catch-all was blocking valid API routes from registerRoutes()
    // The dashboard link endpoints and other routes defined in routes.ts were being blocked
    // Vite will properly handle 404s for unmatched routes
    // app.use('/api', (_req, res) => res.status(404).json({ message: 'API endpoint not found' }));
    // log('✅ API 404 handler added');

    // Enhanced error handling that ensures API routes return JSON
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      // Always send JSON for API routes
      if (req.originalUrl.startsWith('/api/') || req.isAPIRequest || req.shouldSendJSONError) {
        if (!res.headersSent) {
          res.status(status).json({ message });
        }
        return;
      }

      res.status(status).json({ message });
      throw err;
    });


    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    log('⚙️ Setting up Vite...');
    if (app.get("env") === "development") {
      await setupVite(app, server);
      log('✅ Vite setup completed');
    } else {
      serveStatic(app);
      log('✅ Static files setup completed');
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Other ports are firewalled. Default to 5000 if not specified.
    // this serves both the API and the client.
    // It is the only port that is not firewalled.
    const port = parseInt(process.env.PORT || '5000', 10);
    log(`🔌 Starting server on port ${port}...`);
    
    // Initialize typing indicator WebSocket using noServer mode to coexist with Vite HMR
    // The service only handles upgrade requests for /ws/typing path, leaving other paths for Vite
    try {
      const { typingIndicatorService } = await import('./typing-indicator-service');
      typingIndicatorService.initialize(server);
      log('✅ Typing indicator WebSocket service initialized (noServer mode)');
    } catch (error: any) {
      log(`⚠️ Typing indicator service failed to initialize: ${error.message}`);
    }
    
    // Start listening on the port - this must complete quickly for deployment
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, () => {
      log(`🎉 Server is now serving on port ${port}`);
      
      // Schedule background services to start AFTER server is fully responsive
      // Use a delay to ensure the server is completely ready before starting background tasks
      setTimeout(() => {
        initializeBackgroundServicesAsync();
      }, 2000); // 2 second delay to ensure deployment completes first
    });
    
    // Initialize background services completely separate from server startup
    function initializeBackgroundServicesAsync() {
      log('🚀 Starting background services AFTER server deployment...');
      
      // Fire-and-forget approach - start each service independently without blocking anything
      
      // 0. SMS Communication Service (primary communication channel)
      setTimeout(() => {
        (async () => {
          try {
            const { smsCommunicationService } = await import('./sms-communication-service');
            await smsCommunicationService.initialize();
            log('✅ SMS Communication Service initialized - ready for bidirectional SMS communication');
          } catch (error) {
            log(`⚠️ SMS Communication Service failed to initialize: ${error.message || error}`);
          }
        })();
      }, 500);
      
      // 0.5 GPS Health Monitor Service (monitors active drivers for stale GPS tracking)
      setTimeout(() => {
        (async () => {
          try {
            const { gpsHealthMonitorService } = await import('./gps-health-monitor');
            await gpsHealthMonitorService.initialize();
            log('✅ GPS Health Monitor Service initialized - checking GPS health every 3 minutes');
          } catch (error) {
            log(`⚠️ GPS Health Monitor Service failed to initialize: ${error.message || error}`);
          }
        })();
      }, 750);
      
      // 0.75 Document Reminder Service (automated SMS reminders for missing documents)
      setTimeout(() => {
        (async () => {
          try {
            const { documentReminderService } = await import('./document-reminder-service');
            await documentReminderService.start();
            log('✅ Document Reminder Service initialized - checking for missing documents every 30 minutes');
          } catch (error) {
            log(`⚠️ Document Reminder Service failed to initialize: ${error.message || error}`);
          }
        })();
      }, 900);
      
      // 1. Google Sheets Import Service (completely independent)
      setTimeout(() => {
        (async () => {
          try {
            const { googleSheetsSimple } = await import('./google-sheets-simple');
            await googleSheetsSimple.start();
            log('✅ Google Sheets Simple integration started - pulling loads every 3 minutes');
          } catch (error) {
            log(`⚠️ Google Sheets service failed to start: ${error.message || error}`);
          }
        })();
      }, 1000);
        
      // 2. DAT Scraper Service (completely independent)
      setTimeout(() => {
        (async () => {
          try {
            log('🔄 Starting session-based DAT scraper for manual authentication...');
            log('🚫 NO SAMPLE LOADS - Real DAT data only as requested');
            
            const { sessionBasedDATScraper } = await import('./session-based-dat-scraper');
            
            log('🔍 Checking for existing authenticated DAT session...');
            const isAuthenticated = await sessionBasedDATScraper.checkAuthenticatedSession();
            
            if (isAuthenticated) {
              log('✅ Authenticated DAT session detected - starting real load scraping!');
              await sessionBasedDATScraper.startSessionBasedScraping();
              log('📋 System now pulling REAL loads from your authenticated DAT session');
            } else {
              log('🔐 No authenticated session detected');
              log('📋 Please log into DAT manually, then visit /dat-login to activate scraping');
              log('🚫 System will show NO loads until DAT authentication is completed');
            }
          } catch (error) {
            log(`⚠️ DAT scraper failed to start: ${error.message || error}`);
          }
        })();
      }, 2000);
        
      // 2.5 Auto Load Matcher (scores loads, finds nearest driver, surfaces hot loads)
      setTimeout(() => {
        (async () => {
          try {
            const { autoLoadMatcher } = await import('./auto-load-matcher');
            autoLoadMatcher.start();
            log('✅ Auto Load Matcher started — scanning every 5 minutes for ideal loads');
          } catch (error: any) {
            log(`⚠️ Auto Load Matcher failed to start: ${error.message || error}`);
          }
        })();
      }, 2500);

      // 3. Tennessee Load Generation (completely independent)
      setTimeout(() => {
        (async () => {
          try {
            const { simpleDATConnector } = await import('./simple-dat-connector.js');
            const { telegramService } = await import('./telegram-service.js');
            
            // Check if Telegram service is properly initialized before starting load generation
            if (telegramService.isServiceRunning()) {
              await simpleDATConnector.startRealLoadGeneration(telegramService);
              log('✅ Tennessee load generation started with Telegram notifications');
            } else {
              await simpleDATConnector.startRealLoadGeneration(null);
              log('✅ Tennessee load generation started without Telegram (service not running)');
            }
          } catch (error) {
            log(`⚠️ Tennessee load generation failed to start: ${error.message || error}`);
          }
        })();
      }, 3000);
      
      log('✅ Background services scheduled to start independently after server deployment');
    }
    
  } catch (error) {
    log(`❌ Fatal server startup error: ${error.message}`);
    console.error('Server startup failed:', error);
    process.exit(1);
  }
})();
