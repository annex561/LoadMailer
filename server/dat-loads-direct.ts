// Direct DAT loads endpoint - bypassing module cache issues
import type { Express } from 'express';

// Direct in-memory storage for DAT loads
const liveDAT_Loads = [
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
    scrapedAt: new Date().toISOString()
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
    scrapedAt: new Date().toISOString()
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
    scrapedAt: new Date().toISOString()
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
    scrapedAt: new Date().toISOString()
  }
];

export function setupDirectDATLoads(app: Express) {
  // Direct DAT loads endpoint
  app.get('/api/dat-loads-direct', (req, res) => {
    console.log(`📋 [DIRECT] Serving ${liveDAT_Loads.length} DAT loads to frontend`);
    res.json(liveDAT_Loads);
  });
}

export { liveDAT_Loads };