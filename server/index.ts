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
      
      // 1. Google Sheets Import Service (completely independent)
      setTimeout(() => {
        (async () => {
          try {
            const { googleSheetsSimple } = await import('./google-sheets-simple.js');
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
            log(`⚠️ DAT scraper failed to start: ${error.message || error}`);
          }
        })();
      }, 2000);
        
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
