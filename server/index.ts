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
    log("Starting server initialization...");
    const server = await registerRoutes(app);
    log("Routes registered successfully, server created");

    // BIND TO PORT IMMEDIATELY for Replit detection
    const port = parseInt(process.env.PORT || '5000', 10);
    log(`Attempting to bind to port ${port}...`);
    
    server.listen(port, "0.0.0.0", () => {
      log(`✅ Server successfully listening on port ${port}`);
    });
    
    server.on('error', (error: any) => {
      log(`❌ Server error: ${error.message}`);
      if (error.code === 'EADDRINUSE') {
        log(`Port ${port} is already in use`);
      }
    });

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      throw err;
    });

    // Setup Vite and other services after port is bound
    if (app.get("env") === "development") {
      log("Setting up Vite in development mode...");
      setupVite(app, server).then(() => {
        log("Vite setup completed");
      }).catch((error) => {
        log(`Vite setup error: ${error}`);
      });
    } else {
      serveStatic(app);
    }

    // Auto-start load generation after everything is set up
    setTimeout(async () => {
      try {
        const { simpleDATConnector } = await import('./simple-dat-connector.js');
        const { telegramService } = await import('./telegram-service.js');
        
        if (telegramService.isServiceRunning()) {
          await simpleDATConnector.startRealLoadGeneration(telegramService);
          log('✅ Auto-started Tennessee load generation with Telegram notifications');
        } else {
          await simpleDATConnector.startRealLoadGeneration(null);
          log('✅ Auto-started Tennessee load generation without Telegram (service not running)');
        }
      } catch (error) {
        log(`❌ Failed to auto-start Tennessee load generation: ${String(error)}`);
      }
    }, 10000);
    
  } catch (error) {
    log(`❌ Failed to start server: ${error}`);
    throw error;
  }
})();
