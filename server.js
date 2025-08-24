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

      const phoneMatch = q.message.text.match(/Phone:<\/b>\s*([+0-9()\- ]+)/i);
      const tel = phoneMatch ? phoneMatch[1].replace(/\s+/g, "") : "";
      const kb = tel ? { inline_keyboard: [[{ text: "📞 Call Carrier", url: `tel:${tel}` }]] } : undefined;

      await bot.sendMessage(
        DISPATCHER_CHAT_ID,
        `📣 <b>${driverName}</b> accepted load <b>${loadId}</b>.`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    } else if (action === "decline") {
      await bot.answerCallbackQuery(q.id, { text: "Declined." });
      await bot.editMessageText(`❌ <b>DECLINED</b> by ${driverName}\n\n${q.message.text}`, {
        chat_id: q.message.chat.id, message_id: msgId, parse_mode: "HTML"
      });
      await bot.sendMessage(DISPATCHER_CHAT_ID, `⚠️ ${driverName} declined load <b>${loadId}</b>.`, { parse_mode: "HTML" });
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

app.get("/health", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on :${PORT}`));