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
    
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, async () => {
      log(`🎉 Server is now serving on port ${port}`);
      
      // Auto-start Tennessee load generation to ensure real data is always available
      setTimeout(async () => {
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
          log(`❌ Failed to auto-start Tennessee load generation: ${String(error)}`);
          // Continue anyway without auto-start
        }
      }, 10000); // Wait 10 seconds for all services to fully initialize
    });
    
  } catch (error) {
    log(`❌ Fatal server startup error: ${error.message}`);
    console.error('Server startup failed:', error);
    process.exit(1);
  }
})();
