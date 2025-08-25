// Simple Google Sheets DAT Loads API - the proper way
import type { Express } from 'express';

export interface GoogleSheetsDATLoad {
  id: string;
  origin: string;
  destination: string;
  pickup: string;
  rate: string;
  miles: string;
  weight: string;
  equipment: string;
  broker: string;
  phone: string;
  scrapedAt: Date;
}

// In-memory storage for all DAT loads (Google Sheets + any other sources)
let allDATLoads: GoogleSheetsDATLoad[] = [];

export function setupGoogleSheetsDATAPI(app: Express) {
  
  // Get all DAT loads (including Google Sheets loads)
  app.get('/api/dat-loads', (req, res) => {
    console.log(`📋 Serving ${allDATLoads.length} DAT loads from all sources`);
    res.json(allDATLoads);
  });

  // Add/update Google Sheets loads (called by Google Sheets service)
  app.post('/api/dat-loads/google-sheets', (req, res) => {
    const { loads } = req.body;
    
    if (!Array.isArray(loads)) {
      return res.status(400).json({ error: 'Invalid loads data' });
    }

    // Remove existing Google Sheets loads
    allDATLoads = allDATLoads.filter(load => load.broker !== 'Google Sheets');

    // Add new Google Sheets loads
    const googleSheetsLoads = loads.map((load: any, index: number) => ({
      id: `GS-${Date.now()}-${index}`,
      origin: load.origin,
      destination: load.destination,
      pickup: load.pickup || 'ASAP',
      rate: load.rate.toString(),
      miles: load.miles.toString(),
      weight: load.weight || 'N/A',
      equipment: load.equipment || 'Van',
      broker: 'Google Sheets',
      phone: load.phone || 'N/A',
      scrapedAt: new Date()
    }));

    allDATLoads.push(...googleSheetsLoads);

    console.log(`📋 Updated with ${googleSheetsLoads.length} Google Sheets loads. Total: ${allDATLoads.length}`);
    res.json({ success: true, added: googleSheetsLoads.length, total: allDATLoads.length });
  });

  // Clear all loads
  app.delete('/api/dat-loads', (req, res) => {
    allDATLoads = [];
    res.json({ success: true, message: 'All DAT loads cleared' });
  });
}

export { allDATLoads };