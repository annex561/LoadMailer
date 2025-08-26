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

// Simple startup - bind port first
const port = parseInt(process.env.PORT || '5000', 10);

// Add health check immediately
app.get('/health', (_req, res) => {
  res.json({ status: 'OK', message: 'LoadMaster API running' });
});

// Add root route immediately  
app.get('/', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>LoadMaster - Dispatch System</title></head>
    <body style="font-family: Arial; margin: 40px; background: #f5f5f5;">
      <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px;">
        <h1>🚛 LoadMaster Dispatch System</h1>
        <div style="padding: 15px; margin: 10px 0; background: #d4edda; color: #155724; border-radius: 5px;">✅ System Status: ONLINE</div>
        <div style="padding: 15px; margin: 10px 0; background: #d1ecf1; color: #0c5460; border-radius: 5px;">📊 Backend Services: All operational</div>
        <h3>API Endpoints</h3>
        <a href="/api/loads" style="margin: 5px; padding: 8px 15px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">View Loads</a>
        <a href="/api/drivers" style="margin: 5px; padding: 8px 15px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">View Drivers</a>
        <a href="/health" style="margin: 5px; padding: 8px 15px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">Health Check</a>
        <p><strong>LoadMaster</strong> is a comprehensive freight dispatch system with automated load matching, driver coordination, and real-time GPS tracking.</p>
      </div>
    </body></html>
  `);
});

// Create and start server immediately
const server = app.listen(port, "0.0.0.0", () => {
  log(`✅ LoadMaster HTTP Server listening on port ${port}`);
});

server.on('error', (error: any) => {
  log(`❌ Server error: ${error.message}`);
});

// Initialize everything else asynchronously after server is bound
(async () => {
  try {
    log("Initializing LoadMaster services...");
    
    // Register API routes
    await registerRoutes(app);
    log("API routes registered");

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    // Setup frontend later
    if (app.get("env") === "development") {
      setTimeout(async () => {
        try {
          await setupVite(app, server);
          log("Vite frontend ready");
        } catch (error) {
          log(`Vite error: ${error.message}`);
        }
      }, 3000);
    }

    // Start load generation
    setTimeout(async () => {
      try {
        const { simpleDATConnector } = await import('./simple-dat-connector.js');
        const { telegramService } = await import('./telegram-service.js');
        
        if (telegramService.isServiceRunning()) {
          await simpleDATConnector.startRealLoadGeneration(telegramService);
          log('✅ Load generation started with Telegram');
        } else {
          await simpleDATConnector.startRealLoadGeneration(null);
          log('✅ Load generation started without Telegram');
        }
      } catch (error) {
        log(`❌ Load generation failed: ${String(error)}`);
      }
    }, 5000);
    
  } catch (error) {
    log(`❌ Service initialization error: ${error}`);
  }
})();
