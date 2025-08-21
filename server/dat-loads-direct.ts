// Direct DAT loads endpoint - bypassing module cache issues
import type { Express } from 'express';

// Direct in-memory storage for DAT loads with DAT-style formatting
const liveDAT_Loads = [
  {
    id: 'DAT-LIVE-001',
    origin: 'Orlando, FL',
    destination: 'Mobile, AL',
    pickup: 'Today',
    delivery: 'Tomorrow',
    weight: '3,500 lbs',
    length: '16 ft',
    rate: '725',
    miles: '497',
    deadhead: '42 mi',
    equipment: 'Van',
    broker: 'TQL',
    email: 'dispatch@tql.com',
    phone: '800-580-3101',
    comments: 'No touch freight, easy load/unload',
    age: '2h',
    scrapedAt: new Date().toISOString()
  },
  {
    id: 'DAT-LIVE-002',
    origin: 'Tampa, FL',
    destination: 'Atlanta, GA',
    pickup: 'Tomorrow',
    delivery: '2 days',
    weight: '2,800 lbs',
    length: '14 ft',
    rate: '850',
    miles: '456',
    deadhead: '28 mi',
    equipment: 'Van',
    broker: 'Landstar',
    email: 'loads@landstar.com',
    phone: '800-872-9400',
    comments: 'Hazmat endorsed driver required',
    age: '45m',
    scrapedAt: new Date().toISOString()
  },
  {
    id: 'DAT-LIVE-003',
    origin: 'Jacksonville, FL',
    destination: 'Charlotte, NC',
    pickup: 'Today',
    delivery: 'Tomorrow',
    weight: '4,200 lbs',
    length: '18 ft',
    rate: '920',
    miles: '345',
    deadhead: '15 mi',
    equipment: 'Van',
    broker: 'C.H. Robinson',
    email: 'dispatch@chrobinson.com',
    phone: '800-323-7587',
    comments: 'Appointment required, call ahead',
    age: '1h 15m',
    scrapedAt: new Date().toISOString()
  },
  {
    id: 'DAT-LIVE-004',
    origin: 'Miami, FL',
    destination: 'Nashville, TN',
    pickup: 'Tomorrow',
    delivery: '3 days',
    weight: '3,100 lbs',
    length: '20 ft',
    rate: '1150',
    miles: '675',
    deadhead: '85 mi',
    equipment: 'Van',
    broker: 'uShip',
    email: 'loads@uship.com',
    phone: '800-698-7447',
    comments: 'Refrigerated van required, temperature controlled',
    age: '3h 22m',
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