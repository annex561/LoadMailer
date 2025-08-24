// LoadMailer – VA Paste-a-Load + Smart Router + Telegram
// Drop-in replacement for server.js

const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const TelegramBot = require("node-telegram-bot-api");

const {
  TELEGRAM_BOT_TOKEN,
  DISPATCHER_CHAT_ID,
  FORM_SECRET
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !DISPATCHER_CHAT_ID || !FORM_SECRET) {
  console.error("❌ Missing env vars: TELEGRAM_BOT_TOKEN, DISPATCHER_CHAT_ID, FORM_SECRET");
  process.exit(1);
}

const DRIVERS_PATH = path.join(__dirname, "drivers.json");

function loadDrivers() {
  try {
    const raw = fs.readFileSync(DRIVERS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
function saveDrivers(drivers) {
  fs.writeFileSync(DRIVERS_PATH, JSON.stringify(drivers, null, 2));
}
let DRIVERS = loadDrivers();

const app = express();
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/", rateLimit({ windowMs: 60_000, max: 150 }));
app.use(express.static("public"));

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const pending = new Map(); // messageId -> { timeoutId, driverName, loadId }
const loads = new Map(); // loadId -> { base fields..., assignedDriverChatId?, dims?, effectiveFeet? }
const loadPhotos = new Map(); // loadId -> [photo urls]

// Handle driver commands
bot.onText(/\/delivered/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    const driver = DRIVERS.find(d => String(d.chatId) === String(chatId));
    
    if (!driver) {
      await bot.sendMessage(chatId, "⚠️ Driver not found. Please contact dispatch.");
      return;
    }
    
    // Reset driver capacity
    driver.used = { feet: 0, weight: 0 };
    driver.status = "available";
    driver.currentLocation = null;
    driver.destination = null;
    saveDrivers(DRIVERS);
    
    await bot.sendMessage(chatId, 
      `✅ <b>Load Delivered!</b>\n\n` +
      `Your truck capacity has been reset:\n` +
      `📏 Available Space: ${effectiveUsableFeet(driver)} feet\n` +
      `⚖️ Available Weight: ${driver.vehicle?.maxWeight || 0} lbs\n\n` +
      `You're now available for new loads!`,
      { parse_mode: "HTML" }
    );
    
    await bot.sendMessage(DISPATCHER_CHAT_ID, 
      `🏁 ${driver.name} completed delivery. Truck capacity reset and available for new loads.`,
      { parse_mode: "HTML" }
    );
    
    // Trigger AI to find next loads
    findNextLoads(driver);
    
  } catch (e) {
    console.error("Delivered command error:", e);
  }
});

bot.onText(/\/setloc (.+)/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const location = match[1];
    const driver = DRIVERS.find(d => String(d.chatId) === String(chatId));
    
    if (!driver) {
      await bot.sendMessage(chatId, "⚠️ Driver not found. Please contact dispatch.");
      return;
    }
    
    // For now, store location as text. Later can geocode to lat/lon
    driver.currentLocation = {
      address: location,
      timestamp: new Date().toISOString(),
      manual: true
    };
    
    saveDrivers(DRIVERS);
    
    await bot.sendMessage(chatId, 
      `📍 <b>Location Updated</b>\n\n` +
      `Current Location: ${location}\n` +
      `Time: ${new Date().toLocaleTimeString()}\n\n` +
      `AI is now scanning for loads along your route!`,
      { parse_mode: "HTML" }
    );
    
    await bot.sendMessage(DISPATCHER_CHAT_ID, 
      `📍 ${driver.name} updated location: ${location}`,
      { parse_mode: "HTML" }
    );
    
    // Trigger route-aware load matching
    findRouteLoads(driver);
    
  } catch (e) {
    console.error("Set location command error:", e);
  }
});

// Handle photo uploads from drivers
bot.on("photo", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const photos = msg.photo;
    const largestPhoto = photos[photos.length - 1]; // Get highest resolution
    
    // Find active load for this driver
    const activeLoad = Array.from(loads.values()).find(load => 
      String(load.assignedDriverChatId) === String(chatId) && 
      load.status === "pickup_phase"
    );
    
    if (activeLoad) {
      // Store photo reference
      if (!loadPhotos.has(activeLoad.loadId)) {
        loadPhotos.set(activeLoad.loadId, []);
      }
      
      const photoArray = loadPhotos.get(activeLoad.loadId);
      photoArray.push({
        fileId: largestPhoto.file_id,
        uploadTime: new Date().toISOString(),
        caption: msg.caption || ""
      });
      
      await bot.sendMessage(chatId, 
        `📸 Photo received! Total photos: ${photoArray.length}\n` +
        `Upload more photos or tap "Confirm Pickup Complete" when ready.`
      );
      
      // Notify dispatcher
      await bot.sendMessage(DISPATCHER_CHAT_ID, 
        `📸 ${DRIVERS.find(d => String(d.chatId) === String(chatId))?.name || "Driver"} uploaded photo for load <b>${activeLoad.loadId}</b>. Total: ${photoArray.length} photos.`, 
        { parse_mode: "HTML" }
      );
    }
  } catch (e) {
    console.error("Photo upload error:", e);
  }
});

// ---------- Utilities ----------
const toStr = (v) => (v == null ? "" : String(v).trim());
const cap = (s, n = 600) => toStr(s).slice(0, n);
const num = (s) => {
  const n = Number(toStr(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const has = (v) => v != null && String(v).trim() !== "";

// ---------- AI LOAD MATCHING SERVICE ----------
function calculateRPM(load) {
  if (!load.rate || !load.miles) return 0;
  return load.rate / load.miles;
}

function meetsFinancialCriteria(load) {
  const rpm = calculateRPM(load);
  const equipment = (load.equipment || "").toLowerCase();
  
  // Car shoes: $1.40-$2.00 per mile
  if (equipment.includes("car") || equipment.includes("auto")) {
    return rpm >= 1.40 && rpm <= 2.00;
  }
  
  // Full loads: $1.90+ per mile
  return rpm >= 1.90;
}

function canCombineLoads(load1, load2, driver) {
  if (!load1 || !load2 || !driver) return false;
  
  // Check if loads are compatible for combining
  const totalFeet = (load1.effectiveFeet || load1.feet || 0) + (load2.effectiveFeet || load2.feet || 0);
  const totalWeight = (load1.weight || 0) + (load2.weight || 0);
  
  const usableFeet = effectiveUsableFeet(driver);
  const maxWeight = driver.vehicle?.maxWeight || 0;
  const { weightBufferPct } = getReserves(driver);
  const safeWeight = Math.floor(maxWeight * (1 - weightBufferPct));
  
  // Check capacity fit
  if (totalFeet > usableFeet || totalWeight > safeWeight) return false;
  
  // Check route compatibility (pickup/delivery sequence)
  const pickupDistance = haversineMiles(
    { lat: load1.originLat, lon: load1.originLon },
    { lat: load2.originLat, lon: load2.originLon }
  );
  
  const deliveryDistance = haversineMiles(
    { lat: load1.destLat, lon: load1.destLon },
    { lat: load2.destLat, lon: load2.destLon }
  );
  
  // Loads should be within reasonable pickup/delivery radius (100 miles)
  return pickupDistance <= 100 && deliveryDistance <= 100;
}

function findLoadCombinations(availableLoads, driver) {
  const combinations = [];
  const validLoads = availableLoads.filter(load => 
    meetsFinancialCriteria(load) && 
    load.status === "new"
  );
  
  // Single loads that meet criteria
  for (const load of validLoads) {
    const fitCheck = checkFitAndUpdate(driver, { 
      effectiveFeet: load.effectiveFeet || load.feet || 0, 
      weight: load.weight || 0 
    });
    
    if (fitCheck.fits) {
      combinations.push({
        loads: [load],
        totalRevenue: load.rate || 0,
        totalMiles: load.miles || 0,
        combinedRPM: calculateRPM(load),
        capacity: {
          feetUsed: load.effectiveFeet || load.feet || 0,
          weightUsed: load.weight || 0,
          feetRemaining: fitCheck.remainingFeet,
          weightRemaining: fitCheck.remainingWeight
        }
      });
    }
  }
  
  // Two-load combinations
  for (let i = 0; i < validLoads.length; i++) {
    for (let j = i + 1; j < validLoads.length; j++) {
      const load1 = validLoads[i];
      const load2 = validLoads[j];
      
      if (canCombineLoads(load1, load2, driver)) {
        const totalRevenue = (load1.rate || 0) + (load2.rate || 0);
        const totalMiles = Math.max(load1.miles || 0, load2.miles || 0); // Use longer route
        const combinedRPM = totalRevenue / totalMiles;
        
        // Combined load should still meet RPM criteria
        if (combinedRPM >= 1.90) {
          const totalFeet = (load1.effectiveFeet || load1.feet || 0) + (load2.effectiveFeet || load2.feet || 0);
          const totalWeight = (load1.weight || 0) + (load2.weight || 0);
          
          const fitCheck = checkFitAndUpdate(driver, { 
            effectiveFeet: totalFeet, 
            weight: totalWeight 
          });
          
          if (fitCheck.fits) {
            combinations.push({
              loads: [load1, load2],
              totalRevenue,
              totalMiles,
              combinedRPM,
              capacity: {
                feetUsed: totalFeet,
                weightUsed: totalWeight,
                feetRemaining: fitCheck.remainingFeet,
                weightRemaining: fitCheck.remainingWeight
              }
            });
          }
        }
      }
    }
  }
  
  // Sort by combined RPM descending
  return combinations.sort((a, b) => b.combinedRPM - a.combinedRPM);
}

async function findNextLoads(driver) {
  try {
    // Get all available loads from our load store
    const availableLoads = Array.from(loads.values()).filter(load => 
      load.status === "new" && !load.assignedDriverChatId
    );
    
    if (availableLoads.length === 0) return;
    
    // Find best load combinations for this driver
    const combinations = findLoadCombinations(availableLoads, driver);
    
    if (combinations.length > 0) {
      const bestCombo = combinations[0];
      
      // Send recommendation to dispatcher
      const comboMsg = bestCombo.loads.length === 1 
        ? `🎯 <b>Next Load Recommendation for ${driver.name}</b>\n\n` +
          `Load: ${bestCombo.loads[0].origin} → ${bestCombo.loads[0].destination}\n` +
          `Rate: $${bestCombo.totalRevenue} • RPM: $${bestCombo.combinedRPM.toFixed(2)}\n` +
          `Capacity: ${bestCombo.capacity.feetUsed}ft used, ${bestCombo.capacity.feetRemaining}ft remaining`
        : `🎯 <b>Multi-Load Combo for ${driver.name}</b>\n\n` +
          `Load 1: ${bestCombo.loads[0].origin} → ${bestCombo.loads[0].destination}\n` +
          `Load 2: ${bestCombo.loads[1].origin} → ${bestCombo.loads[1].destination}\n` +
          `Combined Rate: $${bestCombo.totalRevenue} • RPM: $${bestCombo.combinedRPM.toFixed(2)}\n` +
          `Total Capacity: ${bestCombo.capacity.feetUsed}ft used, ${bestCombo.capacity.feetRemaining}ft remaining`;
      
      await bot.sendMessage(DISPATCHER_CHAT_ID, comboMsg, { parse_mode: "HTML" });
    }
  } catch (e) {
    console.error("AI load matching error:", e);
  }
}

// Route-aware load matching for drivers en route
async function findRouteLoads(driver) {
  try {
    if (!driver.currentLocation || !driver.destination) return;
    
    const availableLoads = Array.from(loads.values()).filter(load => 
      load.status === "new" && !load.assignedDriverChatId
    );
    
    if (availableLoads.length === 0) return;
    
    // Find loads along the route or near destination
    const routeLoads = availableLoads.filter(load => {
      // Check if load pickup is along the route to destination
      const pickupNearRoute = isAlongRoute(driver.currentLocation.address, driver.destination, load.origin);
      const deliveryViable = isReasonableDetour(driver.destination, load.destination);
      
      return (pickupNearRoute && deliveryViable) || isNearDestination(driver.destination, load.origin, 50);
    });
    
    // Find best combination considering remaining capacity
    const routeCombinations = findLoadCombinations(routeLoads, driver);
    
    if (routeCombinations.length > 0) {
      const bestRoute = routeCombinations[0];
      
      const routeMsg = bestRoute.loads.length === 1 
        ? `🛣️ <b>Route Load for ${driver.name}</b>\n\n` +
          `📍 From your route: ${bestRoute.loads[0].origin}\n` +
          `📍 To: ${bestRoute.loads[0].destination}\n` +
          `💰 Rate: $${bestRoute.totalRevenue} • RPM: $${bestRoute.combinedRPM.toFixed(2)}\n` +
          `📦 Space: ${bestRoute.capacity.feetUsed}ft (+remaining ${bestRoute.capacity.feetRemaining}ft)\n\n` +
          `🎯 Perfect backhaul opportunity!`
        : `🛣️ <b>Multi-Route Combo for ${driver.name}</b>\n\n` +
          `Route Load 1: ${bestRoute.loads[0].origin} → ${bestRoute.loads[0].destination}\n` +
          `Route Load 2: ${bestRoute.loads[1].origin} → ${bestRoute.loads[1].destination}\n` +
          `💰 Combined: $${bestRoute.totalRevenue} • RPM: $${bestRoute.combinedRPM.toFixed(2)}\n` +
          `📦 Total Space: ${bestRoute.capacity.feetUsed}ft (${bestRoute.capacity.feetRemaining}ft remaining)\n\n` +
          `🎯 Maximum route utilization!`;
      
      await bot.sendMessage(DISPATCHER_CHAT_ID, routeMsg, { parse_mode: "HTML" });
    }
  } catch (e) {
    console.error("Route load matching error:", e);
  }
}

// Helper functions for route matching
function isAlongRoute(origin, destination, pickupLocation) {
  // Simple text matching for now - can enhance with geocoding later
  const originState = extractState(origin);
  const destState = extractState(destination);
  const pickupState = extractState(pickupLocation);
  
  // If pickup is in same state as origin or destination, consider it "along route"
  return pickupState === originState || pickupState === destState;
}

function isReasonableDetour(driverDestination, loadDestination) {
  // For now, allow deliveries within 100 miles of driver destination
  // Can enhance with actual distance calculation later
  const driverState = extractState(driverDestination);
  const loadState = extractState(loadDestination);
  
  return driverState === loadState; // Same state = reasonable detour
}

function isNearDestination(driverDestination, loadOrigin, maxMiles = 50) {
  // Simple proximity check - enhance with geocoding later
  const driverCity = extractCity(driverDestination);
  const loadCity = extractCity(loadOrigin);
  
  return driverCity === loadCity;
}

function extractState(location) {
  if (!location) return "";
  const parts = location.split(",");
  return parts.length > 1 ? parts[parts.length - 1].trim().toUpperCase() : "";
}

function extractCity(location) {
  if (!location) return "";
  return location.split(",")[0].trim().toUpperCase();
}

// Start continuous load scanning
setInterval(async () => {
  try {
    // Scan for all available drivers
    const availableDrivers = DRIVERS.filter(d => d.status === "available" && d.chatId);
    
    for (const driver of availableDrivers) {
      await findNextLoads(driver);
      
      // Also check for route-specific loads if driver has location/destination
      if (driver.currentLocation && driver.destination) {
        await findRouteLoads(driver);
      }
    }
  } catch (e) {
    console.error("Continuous load scanning error:", e);
  }
}, 60000); // Every minute

function haversineMiles(a, b) {
  if (!a?.lat || !a?.lon || !b?.lat || !b?.lon) return null;
  const R = 3958.8;
  const dLat = (Math.PI / 180) * (b.lat - a.lat);
  const dLon = (Math.PI / 180) * (b.lon - a.lon);
  const lat1 = (Math.PI / 180) * a.lat;
  const lat2 = (Math.PI / 180) * b.lat;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * (2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
}

// ---- DIMENSIONS & FIT HELPERS ----
function getReserves(drv) {
  const r = drv.reserves || {};
  return {
    doorClearanceFt: r.doorClearanceFt ?? 0.5,
    palletJackReserveFt: r.palletJackReserveFt ?? 3.0,
    carryPalletJack: !!r.carryPalletJack,
    weightBufferPct: r.weightBufferPct ?? 0.05
  };
}

function effectiveUsableFeet(drv) {
  const total = drv.vehicle?.feet || 0;
  const { doorClearanceFt, palletJackReserveFt, carryPalletJack } = getReserves(drv);
  const reserve = doorClearanceFt + (carryPalletJack ? palletJackReserveFt : 0);
  return Math.max(0, total - reserve);
}

// Standard pallet math (48x40 default). We place up to floor(width/40in) per row.
// If stackable, we count 2 layers.
function linearFeetFromPallets({ palletCount, palletLenIn = 48, palletWidIn = 40, truckWidthFt = 7.8, stackable = false }) {
  const widthIn = Math.floor(truckWidthFt * 12);
  const perRow = Math.max(1, Math.floor(widthIn / palletWidIn));
  const perLayer = perRow;
  const layers = stackable ? 2 : 1;
  const perRowAll = perLayer * layers;
  const rows = Math.ceil(palletCount / perRowAll);
  const feetPerRow = palletLenIn / 12;
  return rows * feetPerRow;
}

// Generic linear-feet calc for non-pallet items (each item occupies its length along truck)
function linearFeetFromItems(items = []) {
  // items: [{lenFt: number, qty: number}]
  return items.reduce((sum, it) => sum + (Number(it.lenFt) || 0) * (Number(it.qty) || 0), 0);
}

function computeLoadFeet(drv, dims) {
  const widthFt = drv.vehicle?.interiorWidthFt ?? 7.8;

  const fromPallets = dims.palletCount
    ? linearFeetFromPallets({
        palletCount: Number(dims.palletCount) || 0,
        palletLenIn: Number(dims.palletLenIn) || 48,
        palletWidIn: Number(dims.palletWidIn) || 40,
        truckWidthFt: widthFt,
        stackable: !!dims.stackable
      })
    : 0;

  const fromItems = dims.items?.length ? linearFeetFromItems(dims.items) : 0;

  const fromCustomFeet = Number(dims.customFeet) || 0;

  return Math.round((fromPallets + fromItems + fromCustomFeet) * 100) / 100;
}

function checkFitAndUpdate(drv, load) {
  // drv.used.feet/weight track cumulative used
  drv.used = drv.used || { feet: 0, weight: 0 };

  const usableFeet = effectiveUsableFeet(drv);
  const maxWeight = drv.vehicle?.maxWeight || 0;
  const { weightBufferPct } = getReserves(drv);
  const safeWeight = Math.floor(maxWeight * (1 - weightBufferPct));

  const nextFeet = drv.used.feet + (load.effectiveFeet || 0);
  const nextWeight = drv.used.weight + (Number(load.weight) || 0);

  const fitsFeet = nextFeet <= usableFeet + 1e-6;
  const fitsWeight = nextWeight <= safeWeight + 1e-6;

  return {
    fits: fitsFeet && fitsWeight,
    fitsFeet, fitsWeight,
    remainingFeet: Math.max(0, Math.round((usableFeet - nextFeet) * 100) / 100),
    remainingWeight: Math.max(0, safeWeight - nextWeight),
    usableFeet,
    safeWeight,
    nextFeet,
    nextWeight
  };
}

// ---------- "AI" rule scoring (transparent) ----------
function scoreDriver(driver, load) {
  if (driver.status !== "available") return { score: -999, reason: "unavailable" };

  const remainFeet = driver.remaining?.feet ?? driver.vehicle.feet;
  const remainWeight = driver.remaining?.weight ?? driver.vehicle.maxWeight;
  const fitFeet = has(load.feet) ? remainFeet - load.feet : 0;      // if no feet supplied, assume ok
  const fitWeight = has(load.weight) ? remainWeight - load.weight : 0;

  const hardFail = (has(load.feet) && fitFeet < 0) || (has(load.weight) && fitWeight < 0);
  if (hardFail) return { score: -500, reason: "no capacity" };

  // Proximity (if we have load.originLat/Lon, else partial credit if same state)
  let proxPts = 0;
  if (load.originGeo && driver.home) {
    const miles = haversineMiles(driver.home, load.originGeo);
    if (miles != null) {
      if (miles < 25) proxPts = 40;
      else if (miles < 75) proxPts = 30;
      else if (miles < 150) proxPts = 18;
      else if (miles < 300) proxPts = 8;
      else proxPts = 0;
    }
  }

  // RPM emphasis
  const rpmPts = has(load.rpm) ? Math.min(40, load.rpm * 12) : 0;

  // Smaller leftover penalty (we prefer better packing)
  const packPts =
    (has(load.feet) ? Math.max(0, 12 - Math.abs(fitFeet)) : 6) +
    (has(load.weight) ? Math.max(0, 6 - Math.abs(fitWeight / 1000)) : 4);

  const score = proxPts + rpmPts + packPts + 10; // small bias to accept
  return { score, fitFeet, fitWeight };
}

// ---------- Parser for "Raw paste" ----------
function parseRaw(raw) {
  const text = toStr(raw);

  // Try to extract common fields from mixed board/email text
  const pick = (re) => (text.match(re)?.[1] || "").trim();

  const origin = pick(/(?:Origin|Pickup|From|PU)[:\s]*([A-Za-z .'-]+,\s*[A-Z]{2})/i);
  const destination = pick(/(?:Destination|To|Dest)[:\s]*([A-Za-z .'-]+,\s*[A-Z]{2})/i);
  const pickupDate = pick(/(?:Pickup|PU Date|Date)[:\s]*([A-Za-z0-9\-\/, ]+)/i);
  const feet = num(pick(/(?:Length|Ft|Feet)[:\s]*([0-9.]+)/i));
  const weight = num(pick(/(?:Weight|Wgt|lbs)[:\s]*([0-9,\.]+)\s*(?:lbs)?/i));
  const miles = num(pick(/(?:Miles|mi)[:\s]*([0-9,\.]+)/i));
  const deadhead = num(pick(/(?:DH|Deadhead)[:\s]*([0-9,\.]+)/i));
  const rate = num(pick(/(?:Rate|Pay|\$)[:\s]*\$?([0-9,\.]+)/i));
  const rpm = num(pick(/(?:RPM|Rate\/mi)[:\s]*\$?([0-9,\.]+)/i));
  const equipment = pick(/(?:Equip(?:ment)?|Truck)[:\s]*([A-Za-z0-9 \/-]+)/i);
  const broker = pick(/(?:Broker|Company|Carrier)[:\s]*([A-Za-z0-9 .,&'/-]+)/i);
  const brokerPhone = pick(/(?:Phone|Tel|Contact)[:\s]*([+()0-9 \-]+)/i);
  const brokerEmail = pick(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  const link = pick(/(https?:\/\/[^\s>]+)/i);

  const notes = text.slice(0, 900);

  return {
    broker, brokerPhone, brokerEmail, link,
    origin, destination, pickupDate,
    miles, deadhead, equipment,
    feet, weight, rate, rpm,
    notes
  };
}

// Optional very light geocoding placeholder (enter known lat/lon from a small map you keep):
const KNOWN_CITIES = {
  "Atlanta, GA": { lat: 33.749, lon: -84.388 },
  "Charlotte, NC": { lat: 35.227, lon: -80.843 },
  "Englewood, CO": { lat: 39.648, lon: -104.987 }
};
function addGeo(load) {
  if (load.origin && KNOWN_CITIES[load.origin]) {
    load.originGeo = KNOWN_CITIES[load.origin];
  }
  return load;
}

// ---------- Telegram message ----------
function buildMessage(load, drvScore) {
  const fmt = (k, v) => (has(v) ? `<b>${k}:</b> ${v}<br/>` : "");
  const fitVerdict = (drvScore && (has(load.feet) || has(load.weight)))
    ? `Fit: <b>✅</b> (${has(load.feet) ? `~${Math.max(0, drvScore.fitFeet)} ft left` : ""}${has(load.feet)&&has(load.weight)?" / ":""}${has(load.weight) ? `~${Math.max(0, drvScore.fitWeight)} lbs left` : ""})`
    : "Fit: <b>✓</b>";

  return (
    `🚚 <b>NEW LOAD</b><br/>` +
    fmt("Broker", load.broker) +
    fmt("Phone", load.brokerPhone) +
    fmt("Email", load.brokerEmail) +
    fmt("Link", load.link) +
    `<hr/>` +
    fmt("Origin → Dest", `${load.origin} → ${load.destination}`) +
    fmt("Pickup", load.pickupDate) +
    fmt("Miles", load.miles) + fmt("Deadhead", load.deadhead) +
    fmt("Equip/Feet/Weight", `${load.equipment || "-"} / ${load.feet || "-"} ft / ${load.weight || "-"} lbs`) +
    fmt("Rate / RPM", (has(load.rate) ? `$${load.rate}` : "") + (has(load.rpm) ? ` / $${load.rpm}/mi` : "")) +
    `<br/>${fitVerdict}`
  );
}

function sendToDriver(driver, load, loadId, drvScore) {
  const msg = buildMessage(load, drvScore);
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ BOOK", callback_data: `book:${loadId}:${driver.chatId}` },
      { text: "❌ DECLINE", callback_data: `decline:${loadId}:${driver.chatId}` }
    ]]
  };

  return bot.sendMessage(driver.chatId, msg, { parse_mode: "HTML", reply_markup: keyboard })
    .then(sent => {
      const timeoutId = setTimeout(() => {
        if (pending.has(sent.message_id)) {
          bot.sendMessage(DISPATCHER_CHAT_ID,
            `⏰ No response in 3 min from <b>${driver.name}</b> for load <b>${loadId}</b>.`,
            { parse_mode: "HTML" }
          );
          pending.delete(sent.message_id);
        }
      }, 180_000);
      pending.set(sent.message_id, { timeoutId, driverName: driver.name, loadId });
    });
}

// ---------- Callback buttons ----------
bot.on("callback_query", async (q) => {
  try {
    const [action, loadId, driverChat] = (q.data || "").split(":");
    const msgId = q.message?.message_id;
    if (!msgId) return;

    const track = pending.get(msgId);
    if (track) { clearTimeout(track.timeoutId); pending.delete(msgId); }

    const driverName = q.from?.first_name ? `${q.from.first_name} ${q.from.last_name || ""}`.trim() : "Driver";

    if (action === "book") {
      await bot.answerCallbackQuery(q.id, { text: "Booked. Dispatcher notified!" });
      await bot.editMessageText(`✅ <b>BOOKED</b> by ${driverName}\n\n${q.message.text}`, {
        chat_id: q.message.chat.id, message_id: msgId, parse_mode: "HTML"
      });

      const host = process.env.PUBLIC_URL || ""; // set PUBLIC_URL in Replit (e.g., https://your-repl-name.your-user.repl.co)
      const dimsUrl = host
        ? `${host}/book-dims?loadId=${encodeURIComponent(loadId)}`
        : undefined;

      const phoneMatch = q.message.text.match(/Phone:<\/b>\s*([+0-9()\- ]+)/i);
      const tel = phoneMatch ? phoneMatch[1].replace(/\s+/g, "") : "";
      const kb = {
        inline_keyboard: [
          ...(tel ? [[{ text: "📞 Call Carrier", url: `tel:${tel}` }]] : []),
          ...(dimsUrl ? [[{ text: "🔧 Enter Load Dimensions", url: dimsUrl }]] : [])
        ]
      };

      // remember who accepted (to bind dims to the right driver)
      const rec = loads.get(loadId) || {};
      rec.assignedDriverChatId = String(q.from.id || "");
      loads.set(loadId, rec);
      
      // Set driver destination for route planning
      const assignedDriver = DRIVERS.find(d => String(d.chatId) === String(q.from.id));
      if (assignedDriver && rec.destination) {
        assignedDriver.destination = rec.destination;
        assignedDriver.status = "on_route";
        saveDrivers(DRIVERS);
      }

      await bot.sendMessage(
        DISPATCHER_CHAT_ID,
        `📣 <b>${driverName}</b> accepted load <b>${loadId}</b>.\nTap <b>Enter Load Dimensions</b> to complete booking.`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    } else if (action === "decline") {
      await bot.answerCallbackQuery(q.id, { text: "Declined." });
      await bot.editMessageText(`❌ <b>DECLINED</b> by ${driverName}\n\n${q.message.text}`, {
        chat_id: q.message.chat.id, message_id: msgId, parse_mode: "HTML"
      });
      await bot.sendMessage(DISPATCHER_CHAT_ID, `⚠️ ${driverName} declined load <b>${loadId}</b>.`, { parse_mode: "HTML" });
    } else if (action === "confirmdims") {
      // Move to pickup phase - request photos
      const rec = loads.get(loadId);
      if (rec) {
        const drv = DRIVERS.find(d => String(d.chatId) === String(driverChat));
        if (drv) {
          // Update load status to pickup phase
          rec.status = "pickup_phase";
          loads.set(loadId, rec);
          
          const pickupMsg = 
            `📸 <b>Load Pickup Confirmation</b>\n\n` +
            `Load: <b>${loadId}</b>\n` +
            `Please upload photos showing:\n` +
            `• Load secured in truck\n` +
            `• BOL/paperwork\n` +
            `• Any special handling\n\n` +
            `Send photos then tap <b>Confirm Pickup</b>`;
          
          const keyboard = {
            inline_keyboard: [
              [{ text: "✅ Confirm Pickup Complete", callback_data: `confirmpickup:${loadId}:${driverChat}` }]
            ]
          };
          
          await bot.sendMessage(driverChat, pickupMsg, { parse_mode: "HTML", reply_markup: keyboard });
          await bot.sendMessage(DISPATCHER_CHAT_ID, `📸 ${drv.name} is uploading pickup photos for <b>${loadId}</b>.`, { parse_mode: "HTML" });
        }
      }
      await bot.answerCallbackQuery(q.id, { text: "Ready for pickup photos" });
    } else if (action === "misdim") {
      const drv = DRIVERS.find(d => String(d.chatId) === String(driverChat));
      await bot.answerCallbackQuery(q.id, { text: "Dispatcher notified" });
      await bot.sendMessage(DISPATCHER_CHAT_ID, `⚠️ ${drv?.name || "Driver"} reported a dimension mismatch on <b>${loadId}</b>. Please review.`, { parse_mode: "HTML" });
    } else if (action === "confirmpickup") {
      // finalize: update driver used feet/weight after photos uploaded
      const rec = loads.get(loadId);
      if (rec) {
        const drv = DRIVERS.find(d => String(d.chatId) === String(driverChat));
        if (drv) {
          drv.used = drv.used || { feet: 0, weight: 0 };
          drv.used.feet = Math.round((drv.used.feet + (rec.effectiveFeet || 0)) * 100) / 100;
          drv.used.weight = (drv.used.weight + (Number(rec.weight) || 0));
          rec.status = "in_transit";
          rec.pickupTime = new Date().toISOString();
          loads.set(loadId, rec);
          saveDrivers(DRIVERS);
          
          await bot.sendMessage(driverChat, "🚛 Load confirmed! You're en route. Drive safely!");
          await bot.sendMessage(DISPATCHER_CHAT_ID, `🚛 ${drv.name} confirmed pickup of <b>${loadId}</b>. Now en route.`, { parse_mode: "HTML" });
          
          // Trigger AI load matching for next available loads
          findNextLoads(drv);
        }
      }
      await bot.answerCallbackQuery(q.id, { text: "Pickup confirmed!" });
    }
  } catch (e) {
    console.error("callback error", e);
  }
});

// ---------- API: VA Intake ----------
app.post("/api/load-intake", async (req, res) => {
  try {
    if (req.body.secret !== FORM_SECRET) return res.status(401).json({ ok: false, error: "Unauthorized" });

    // Either structured fields OR raw
    const raw = toStr(req.body.raw);
    const base = raw ? parseRaw(raw) : {
      broker: cap(req.body.broker),
      brokerPhone: cap(req.body.brokerPhone),
      brokerEmail: cap(req.body.brokerEmail),
      link: cap(req.body.link),
      origin: cap(req.body.origin),
      destination: cap(req.body.destination),
      pickupDate: cap(req.body.pickupDate),
      miles: num(req.body.miles),
      deadhead: num(req.body.deadhead),
      equipment: cap(req.body.equipment),
      feet: num(req.body.feet),
      weight: num(req.body.weight),
      rate: num(req.body.rate),
      rpm: num(req.body.rpm),
      notes: cap(req.body.notes, 900)
    };

    // compute rpm if missing
    if (!base.rpm && base.rate && base.miles) {
      base.rpm = Math.round((base.rate / base.miles) * 100) / 100;
    }

    addGeo(base);

    const loadId = cap(req.body.loadId || Date.now().toString(), 60);

    // Score drivers
    const scored = DRIVERS
      .filter(d => d.chatId)
      .map(d => ({ d, s: scoreDriver(d, base) }))
      .sort((a, b) => b.s.score - a.s.score);

    if (!scored.length) return res.json({ ok: false, error: "No drivers configured" });

    // Primary target
    const top = scored[0];

    // Broadcast to ties within 10 pts
    const targets = scored.filter(x => x.s.score >= top.s.score - 10).slice(0, 3);

    // Save the load so we can attach dims later
    loads.set(loadId, { ...base, loadId, status: "new" });

    await Promise.all(targets.map(t => sendToDriver(t.d, base, loadId, t.s)));

    // Dispatcher heads-up
    const summary = `${base.origin || "?"} → ${base.destination || "?"}${base.miles ? ` (${base.miles} mi)` : ""}  ${has(base.rate) ? `$${base.rate}` : ""}${has(base.rpm) ? ` • $${base.rpm}/mi` : ""}`;
    await bot.sendMessage(DISPATCHER_CHAT_ID,
      `🧭 Routed to: ${targets.map(t => t.d.name).join(", ")}\n${summary}`,
      { parse_mode: "HTML" }
    );

    res.json({ ok: true, routed: targets.map(t => t.d.name) });
  } catch (e) {
    console.error("intake error", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Optional: quick driver remaining reset (dispatcher only – protect with secret)
app.post("/api/driver-remaining", (req, res) => {
  if (req.body.secret !== FORM_SECRET) return res.status(401).json({ ok: false });
  const name = toStr(req.body.name);
  const feet = num(req.body.feet);
  const weight = num(req.body.weight);
  let found = false;
  DRIVERS = DRIVERS.map(d => {
    if (d.name.toLowerCase() === name.toLowerCase()) {
      found = true;
      d.remaining = {
        feet: feet ?? (d.vehicle?.feet || d.remaining?.feet || 0),
        weight: weight ?? (d.vehicle?.maxWeight || d.remaining?.weight || 0)
      };
    }
    return d;
  });
  if (found) saveDrivers(DRIVERS);
  res.json({ ok: found });
});

// ---------- Dispatcher dimensions page ----------
app.get("/book-dims", (req, res) => {
  const { loadId } = req.query;
  if (!loadId || !loads.get(loadId)) {
    return res.status(404).send("Load not found.");
  }
  // Simple inline HTML for dispatcher to enter dims
  res.send(`
<!doctype html><meta charset="utf-8"><title>Enter Load Dimensions</title>
<style>body{font-family:system-ui;max-width:720px;margin:24px auto;padding:8px}</style>
<h2>Enter Load Dimensions for Load ${loadId}</h2>
<form method="post" action="/api/dispatch/load-dims">
  <input type="hidden" name="loadId" value="${loadId}">
  <label>Secret <input name="secret" required placeholder="FORM_SECRET"></label><br><br>

  <fieldset>
    <legend>Standard Pallets</legend>
    <label>Count <input name="palletCount" type="number" min="0" step="1" value="0"></label>
    <label>Length (in) <input name="palletLenIn" type="number" min="1" value="48"></label>
    <label>Width (in) <input name="palletWidIn" type="number" min="1" value="40"></label>
    <label>Stackable <input name="stackable" type="checkbox"></label>
  </fieldset>

  <fieldset>
    <legend>Custom Items (optional)</legend>
    <small>Linear feet per item × quantity (for awkward pieces)</small><br>
    <label>Custom Feet <input name="customFeet" type="number" min="0" step="0.1" value="0"></label>
  </fieldset>

  <label>Total Weight (lbs) <input name="weight" type="number" min="0" step="1" required></label><br><br>

  <button type="submit">Save & Notify Driver</button>
</form>
  `);
});

// ---------- API: Dispatcher load dimensions ----------
app.post("/api/dispatch/load-dims", async (req, res) => {
  try {
    if (req.body.secret !== FORM_SECRET) return res.status(401).send("Unauthorized");
    const loadId = String(req.body.loadId || "");
    const rec = loads.get(loadId);
    if (!rec) return res.status(404).send("Load not found.");

    // gather dims
    const dims = {
      palletCount: Number(req.body.palletCount || 0),
      palletLenIn: Number(req.body.palletLenIn || 48),
      palletWidIn: Number(req.body.palletWidIn || 40),
      stackable: !!req.body.stackable,
      customFeet: Number(req.body.customFeet || 0),
      items: [] // (kept for future)
    };
    const weight = Number(req.body.weight || 0);

    rec.dims = dims;
    rec.weight = weight;

    // assigned driver (from BOOK action)
    const driverChatId = rec.assignedDriverChatId;
    const drv = DRIVERS.find(d => String(d.chatId) === String(driverChatId));
    if (!drv) return res.status(400).send("Assigned driver not found.");

    // compute effective LF
    const effFeet = computeLoadFeet(drv, dims);
    rec.effectiveFeet = effFeet;

    // check fit (but do not finalize until driver confirms)
    const check = checkFitAndUpdate(drv, { effectiveFeet: effFeet, weight });

    // Notify driver to confirm
    const explain =
      `📦 <b>Load Dimensions Entered</b>\n` +
      `<b>Effective LF:</b> ${effFeet} ft\n` +
      `<b>Weight:</b> ${weight} lbs\n` +
      `<b>Reserves:</b> door ${getReserves(drv).doorClearanceFt} ft` +
      (getReserves(drv).carryPalletJack ? ` + pallet jack ${getReserves(drv).palletJackReserveFt} ft` : ``) + `\n` +
      `<b>Usable LF:</b> ${check.usableFeet} ft\n` +
      `<b>After load:</b> ~${check.nextFeet.toFixed(2)} ft used, ~${check.remainingFeet.toFixed(2)} ft left\n` +
      `<b>Weight safe limit:</b> ${check.safeWeight} lbs\n` +
      `<b>After load:</b> ${check.nextWeight} lbs used, ~${check.remainingWeight} lbs left\n` +
      `<b>Fit check:</b> ${check.fits ? "✅ OK" : "❌ OVER CAPACITY"}`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "✅ Confirm Loaded Correct", callback_data: `confirmdims:${loadId}:${driverChatId}` }],
        [{ text: "⚠️ Report Mismatch", callback_data: `misdim:${loadId}:${driverChatId}` }]
      ]
    };

    await bot.sendMessage(driverChatId, explain, { parse_mode: "HTML", reply_markup: keyboard });
    await bot.sendMessage(DISPATCHER_CHAT_ID, `📨 Asked ${drv.name} to confirm dimensions for <b>${loadId}</b>.`, { parse_mode: "HTML" });

    loads.set(loadId, rec);
    res.send("OK");
  } catch (e) {
    console.error("load-dims error", e);
    res.status(500).send("Server error");
  }
});

app.get("/health", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on :${PORT}`));