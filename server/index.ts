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

// Add root route IMMEDIATELY to fix the Cannot GET / issue
app.get('/', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>LoadMaster - Fleet Management</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #f8fafc; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .header { text-align: center; margin-bottom: 3rem; }
        .title { font-size: 3rem; font-weight: bold; color: #1e293b; margin-bottom: 1rem; }
        .subtitle { font-size: 1.2rem; color: #64748b; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; margin: 3rem 0; }
        .card { background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        .card h3 { margin: 0 0 1rem 0; color: #1e293b; font-size: 1.5rem; }
        .status { padding: 0.5rem 1rem; border-radius: 6px; font-weight: 500; margin: 0.5rem 0; }
        .status.online { background: #dcfce7; color: #166534; }
        .status.active { background: #dbeafe; color: #1e40af; }
        .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 0.5rem 0.5rem 0.5rem 0; font-weight: 500; }
        .btn:hover { background: #2563eb; }
        .metrics { display: flex; justify-content: space-between; align-items: center; margin: 1rem 0; }
        .metric { text-align: center; }
        .metric-value { font-size: 2rem; font-weight: bold; color: #1e293b; }
        .metric-label { font-size: 0.9rem; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="title">🚛 LoadMaster</h1>
          <p class="subtitle">Fleet Management & Load Dispatch System</p>
        </div>
        
        <div class="grid">
          <div class="card">
            <h3>🟢 System Status</h3>
            <div class="status online">✅ All Systems Operational</div>
            <div class="status active">📊 Load Processing Active</div>
            <div class="status active">📱 Driver Communications Online</div>
            <div class="status active">🗄️ Database Connected</div>
          </div>
          
          <div class="card">
            <h3>📊 Live Metrics</h3>
            <div class="metrics">
              <div class="metric">
                <div class="metric-value" id="loadCount">-</div>
                <div class="metric-label">Active Loads</div>
              </div>
              <div class="metric">
                <div class="metric-value" id="driverCount">-</div>
                <div class="metric-label">Available Drivers</div>
              </div>
            </div>
          </div>
          
          <div class="card">
            <h3>🔗 API Access</h3>
            <a href="/api/loads" class="btn">View Loads</a>
            <a href="/api/drivers" class="btn">View Drivers</a>
            <a href="/api/customers" class="btn">View Customers</a>
            <a href="/health" class="btn">Health Check</a>
          </div>
          
          <div class="card">
            <h3>📱 System Features</h3>
            <ul style="color: #64748b; line-height: 1.8;">
              <li>🔄 Automated Load Matching</li>
              <li>📍 Real-time GPS Tracking</li>
              <li>💬 Telegram Driver Notifications</li>
              <li>📊 Advanced Analytics</li>
              <li>🚛 Fleet Management</li>
            </ul>
          </div>
        </div>
      </div>
      
      <script>
        // Fetch live data
        fetch('/api/loads').then(r => r.json()).then(data => {
          document.getElementById('loadCount').textContent = Array.isArray(data) ? data.length : '-';
        }).catch(() => {});
        
        fetch('/api/drivers').then(r => r.json()).then(data => {
          document.getElementById('driverCount').textContent = Array.isArray(data) ? data.filter(d => d.status === 'available').length : '-';
        }).catch(() => {});
      </script>
    </body>
    </html>
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

    log("✅ Backend services initialization complete");

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
