// LoadMailer Bot – Replit-based Telegram Load Dispatcher
// Language: Node.js using Puppeteer + Telegram Bot API

const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// ========== SETTINGS ==========
const TELEGRAM_TOKEN = '8322765631:AAExgmA8q8PEAhhgdHyaIKX0mdVH8bZuN1c'; // ✅ Your real token
const DISPATCHER_ID = '5908383693'; // ✅ Dispatcher = you

const DRIVERS = [
  {
    name: 'Alex Liberty',
    telegramId: '5908383693', // ✅ You (until more drivers are added)
    city: 'Atlanta, GA',
    phone: '+15615777540',
  },
];

const PREFERRED_LANES = [
  { from: ['AL'], to: ['GA'], minRPM: 2.75 },
  { from: ['FL', 'KY'], to: ['NC', 'SC'], minRPM: 2.6 },
  { from: ['OH', 'PA'], to: ['MI'], minRPM: 2.85 },
];

const AVOID_LANES = ['NYC', 'CA', 'Chicago'];

// ========== INIT TELEGRAM BOT ==========
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ========== MATCHING FUNCTION ==========
function matchesLane(load) {
  const fromMatch = PREFERRED_LANES.find(lane =>
    lane.from.includes(load.originState) &&
    lane.to.includes(load.destinationState)
  );
  const rpmMatch = fromMatch && load.rpm >= fromMatch.minRPM;
  const avoidMatch = AVOID_LANES.some(loc =>
    load.origin.includes(loc) || load.destination.includes(loc)
  );
  return fromMatch && rpmMatch && !avoidMatch;
}

// ========== SEND LOAD ==========
function sendLoadToDriver(load) {
  const matchedDrivers = DRIVERS.filter(d => matchesLane(load));
  matchedDrivers.forEach(driver => {
    bot.sendMessage(driver.telegramId, `
🚛 *New Load Available*

📍 *From:* ${load.origin}
📍 *To:* ${load.destination}
📅 *Pickup:* ${load.pickupDate}
⚖️ *Weight:* ${load.weight} lbs
🛣 *Miles:* ${load.miles}
💵 *Rate:* $${load.price} (${load.rpm} RPM)

Reply with *accept ${load.id}* or *decline ${load.id}*
    `, { parse_mode: 'Markdown' });
  });
}

// ========== RESPONSE HANDLERS ==========
bot.onText(/accept_(\d+)/, (msg, match) => {
  const loadId = match[1];
  const driver = DRIVERS.find(d => d.telegramId === msg.from.id.toString());
  bot.sendMessage(DISPATCHER_ID, `
✅ *${driver.name}* accepted Load ${loadId}.
📞 Phone: ${driver.phone}
📍 Location: ${driver.city}

📲 [Call Carrier Now](tel:${driver.phone})
  `, { parse_mode: 'Markdown' });
});

bot.onText(/decline_(\d+)/, (msg, match) => {
  const loadId = match[1];
  const driver = DRIVERS.find(d => d.telegramId === msg.from.id.toString());
  bot.sendMessage(DISPATCHER_ID, `
❌ *${driver.name}* declined Load ${loadId}.
  `, { parse_mode: 'Markdown' });
});

// ========== TEST MODE ==========
const testLoad = {
  id: 101,
  origin: 'Atlanta, GA',
  destination: 'Charlotte, NC',
  pickupDate: '2025-08-15',
  weight: 3200,
  miles: 246,
  price: 800,
  rpm: 3.25,
  originState: 'GA',
  destinationState: 'NC',
  responded: false,
};

// Trigger test manually
sendLoadToDriver(testLoad);