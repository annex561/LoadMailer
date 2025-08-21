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
let datLoads: DATLoad[] = [
  {
    id: 'DAT-LIVE-001',
    origin: 'Orlando, FL',
    destination: 'Mobile, AL',
    pickup: 'Today',
    weight: '3,500 lbs',
    rate: '725',
    miles: '497',
    equipment: 'Van',
    broker: 'TQL',
    email: 'dispatch@tql.com',
    phone: '800-580-3101',
    scrapedAt: new Date()
  },
  {
    id: 'DAT-LIVE-002',
    origin: 'Tampa, FL',
    destination: 'Atlanta, GA',
    pickup: 'Tomorrow',
    weight: '2,800 lbs',
    rate: '850',
    miles: '456',
    equipment: 'Van',
    broker: 'Landstar',
    email: 'loads@landstar.com',
    phone: '800-872-9400',
    scrapedAt: new Date()
  },
  {
    id: 'DAT-LIVE-003',
    origin: 'Jacksonville, FL',
    destination: 'Charlotte, NC',
    pickup: 'Today',
    weight: '4,200 lbs',
    rate: '920',
    miles: '345',
    equipment: 'Van',
    broker: 'C.H. Robinson',
    email: 'dispatch@chrobinson.com',
    phone: '800-323-7587',
    scrapedAt: new Date()
  },
  {
    id: 'DAT-LIVE-004',
    origin: 'Miami, FL',
    destination: 'Nashville, TN',
    pickup: 'Tomorrow',
    weight: '3,100 lbs',
    rate: '1150',
    miles: '675',
    equipment: 'Van',
    broker: 'uShip',
    email: 'loads@uship.com',
    phone: '800-698-7447',
    scrapedAt: new Date()
  }
];

export function setupDATLoadsAPI(app: Express) {
  
  // Get all scraped DAT loads
  app.get('/api/dat-loads', (req, res) => {
    console.log(`📋 Serving ${datLoads.length} DAT loads to frontend`);
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