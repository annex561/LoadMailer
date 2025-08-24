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

// ---------- Utilities ----------
const toStr = (v) => (v == null ? "" : String(v).trim());
const cap = (s, n = 600) => toStr(s).slice(0, n);
const num = (s) => {
  const n = Number(toStr(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const has = (v) => v != null && String(v).trim() !== "";

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
      // finalize: update driver used feet/weight
      const rec = loads.get(loadId);
      if (rec) {
        const drv = DRIVERS.find(d => String(d.chatId) === String(driverChat));
        if (drv) {
          drv.used = drv.used || { feet: 0, weight: 0 };
          drv.used.feet = Math.round((drv.used.feet + (rec.effectiveFeet || 0)) * 100) / 100;
          drv.used.weight = (drv.used.weight + (Number(rec.weight) || 0));
          saveDrivers(DRIVERS);
          await bot.sendMessage(driverChat, "✅ Dimensions confirmed. Capacity updated.");
          await bot.sendMessage(DISPATCHER_CHAT_ID, `✅ ${drv.name} confirmed load <b>${loadId}</b>. Capacity updated.`, { parse_mode: "HTML" });
        }
      }
      await bot.answerCallbackQuery(q.id, { text: "Confirmed" });
    } else if (action === "misdim") {
      const drv = DRIVERS.find(d => String(d.chatId) === String(driverChat));
      await bot.answerCallbackQuery(q.id, { text: "Dispatcher notified" });
      await bot.sendMessage(DISPATCHER_CHAT_ID, `⚠️ ${drv?.name || "Driver"} reported a dimension mismatch on <b>${loadId}</b>. Please review.`, { parse_mode: "HTML" });
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