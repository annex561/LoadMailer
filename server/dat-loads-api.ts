// DAT Loads API endpoint for serving scraped DAT loads
import type { Express } from 'express';

export interface DATLoad {
  id: string;
  origin: string;
  destination: string;
  pickup: string;
  weight: string;
  rate: string;
  miles: string;
  equipment: string;
  broker: string;
  email: string;
  phone: string;
  scrapedAt: Date;
}

// In-memory storage for DAT loads (replace with database in production)
let datLoads: DATLoad[] = [];

export function setupDATLoadsAPI(app: Express) {
  
  // Get all scraped DAT loads
  app.get('/api/dat-loads', (req, res) => {
    res.json(datLoads);
  });

  // Add new DAT loads (called by scraper)
  app.post('/api/dat-loads', (req, res) => {
    const newLoads = req.body.loads;
    
    if (!Array.isArray(newLoads)) {
      return res.status(400).json({ error: 'Invalid loads data' });
    }

    // Clear old loads and add new ones
    datLoads = newLoads.map((load: any, index: number) => ({
      id: `DAT-${Date.now()}-${index}`,
      origin: load.origin,
      destination: load.destination,
      pickup: load.pickup,
      weight: load.weight,
      rate: load.rate,
      miles: load.miles,
      equipment: load.equipment || 'Van',
      broker: load.broker || 'Unknown',
      email: load.email,
      phone: load.phone,
      scrapedAt: new Date()
    }));

    console.log(`📋 Updated DAT loads database with ${datLoads.length} real loads`);
    res.json({ success: true, count: datLoads.length });
  });

  // Get DAT load by ID
  app.get('/api/dat-loads/:id', (req, res) => {
    const load = datLoads.find(l => l.id === req.params.id);
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }
    res.json(load);
  });

  // Clear all DAT loads
  app.delete('/api/dat-loads', (req, res) => {
    datLoads = [];
    res.json({ success: true, message: 'All DAT loads cleared' });
  });
}

export { datLoads };