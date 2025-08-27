import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
    
    // Add timeout wrapper for route registration
    const routeRegistrationPromise = registerRoutes(app);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Route registration timeout after 30 seconds')), 30000);
    });
    
    log('⏳ Registering routes...');
    const server = await Promise.race([routeRegistrationPromise, timeoutPromise]);
    log('✅ Routes registered successfully');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

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
    
    // Start listening on the port - this must complete quickly for deployment
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, () => {
      log(`🎉 Server is now serving on port ${port}`);
      
      // Initialize all background services after server is listening
      initializeBackgroundServices();
    });
    
    // Initialize background services without blocking server startup
    async function initializeBackgroundServices() {
      // Wait a moment for server to fully stabilize
      setTimeout(async () => {
        try {
          log('🚀 Initializing background services...');
          
          // 1. Auto-start Google Sheets Import Service
          try {
            const { googleSheetsAutoImporter } = await import('./google-sheets-auto-importer.js');
            await googleSheetsAutoImporter.start();
            log('✅ Google Sheets auto-import running every 10 seconds');
            
            // Initialize Simple Google Sheets Integration
            try {
              const { googleSheetsSimple } = await import('./google-sheets-simple.js');
              await googleSheetsSimple.start();
              log('✅ Google Sheets Simple integration started');
            } catch (error) {
              log(`⚠️ Failed to start Google Sheets Simple integration: ${error}`);
            }
          } catch (error) {
            log(`⚠️ Failed to auto-start Google Sheets import service: ${error}`);
          }
          
          // 2. Session-based DAT scraper initialization
          try {
            log('🔄 Starting session-based DAT scraper for manual authentication...');
            log('🚫 NO SAMPLE LOADS - Real DAT data only as requested');
            
            const { sessionBasedDATScraper } = await import('./session-based-dat-scraper.js');
            
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
            log(`⚠️ Session-based DAT scraper initialization failed: ${error}`);
          }
          
          // 3. Auto-start Tennessee load generation
          try {
            const { simpleDATConnector } = await import('./simple-dat-connector.js');
            const { telegramService } = await import('./telegram-service.js');
            
            // Check if Telegram service is properly initialized before starting load generation
            if (telegramService.isServiceRunning()) {
              await simpleDATConnector.startRealLoadGeneration(telegramService);
              log('✅ Auto-started Tennessee load generation with Telegram notifications');
            } else {
              await simpleDATConnector.startRealLoadGeneration(null);
              log('✅ Auto-started Tennessee load generation without Telegram (service not running)');
            }
          } catch (error) {
            log(`⚠️ Failed to auto-start Tennessee load generation: ${String(error)}`);
          }
          
          log('✅ Background services initialization completed');
          
        } catch (error) {
          log(`⚠️ Background services initialization error: ${error}`);
          // Don't fail the entire server if background services fail
        }
      }, 2000); // Start background services 2 seconds after server is listening
    }
    
  } catch (error) {
    log(`❌ Fatal server startup error: ${error.message}`);
    console.error('Server startup failed:', error);
    process.exit(1);
  }
})();
