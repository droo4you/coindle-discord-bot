const COINS = require("./coins.json");

// ── Price Tiers ──
const PRICE_TIER_BOUNDARIES = [0.0001, 0.001, 0.01, 0.1, 1, 10, 100, 1000, 10000];

function getPriceTier(price) {
  for (let i = 0; i < PRICE_TIER_BOUNDARIES.length; i++) {
    if (price < PRICE_TIER_BOUNDARIES[i]) return i;
  }
  return 9;
}

// ── FDV Buckets ──
const FDV_BUCKET_ORDER = ["<10M", "10M-100M", "100M-1B", "1B-10B", "10B-100B", ">100B"];

// ── Color Adjacency ──
const COLOR_ADJACENCY = {
  Red: ["Orange", "Pink"],
  Orange: ["Red", "Yellow"],
  Yellow: ["Orange", "Green"],
  Green: ["Yellow", "Blue"],
  Blue: ["Green", "Purple"],
  Purple: ["Blue", "Pink"],
  Pink: ["Purple", "Red"],
  Black: ["White", "Multi"],
  White: ["Black", "Multi"],
  Multi: ["Black", "White"],
};

function areColorsAdjacent(a, b) {
  return COLOR_ADJACENCY[a]?.includes(b) ?? false;
}

// ── Type Families ──
const TYPE_FAMILIES = {
  Hype: ["Memecoin", "Gaming"],
  Infrastructure: ["L1 Blockchain", "L2", "Layer-0"],
  Finance: ["DeFi Token", "Stablecoin", "Payment"],
  Data: ["Oracle", "AI Token", "RWA"],
};

function getCoinTypeFamily(type) {
  for (const [family, types] of Object.entries(TYPE_FAMILIES)) {
    if (types.includes(type)) return family;
  }
  return "Other";
}

// ── Daily Puzzle ──
const LAUNCH_DATE = new Date("2026-03-24T00:00:00Z");

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function hashDateString(dateStr) {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return Math.abs(h);
}

const COOLDOWN_DAYS = 60;
const resolvedCache = new Map();

function ensureResolvedUpTo(targetDateStr) {
  const target = new Date(targetDateStr + "T00:00:00Z");
  const launch = new Date("2026-03-24T00:00:00Z");
  const ws = new Date(target);
  ws.setUTCDate(ws.getUTCDate() - COOLDOWN_DAYS);
  const start = ws > launch ? ws : launch;
  const cursor = new Date(start);
  while (cursor <= target) {
    const ds = cursor.toISOString().split("T")[0];
    if (!resolvedCache.has(ds)) {
      const recent = new Set();
      for (let i = 1; i <= COOLDOWN_DAYS; i++) {
        const prev = new Date(cursor);
        prev.setUTCDate(prev.getUTCDate() - i);
        const c = resolvedCache.get(prev.toISOString().split("T")[0]);
        if (c !== undefined) recent.add(c);
      }
      let idx = hashDateString(ds) % COINS.length;
      let attempts = 0;
      while (recent.has(idx) && attempts < COINS.length) {
        idx = (idx + 1) % COINS.length;
        attempts++;
      }
      resolvedCache.set(ds, idx);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function getDailyCoinIndex(dateStr) {
  const date = dateStr ?? getTodayDateString();
  if (!resolvedCache.has(date)) {
    ensureResolvedUpTo(date);
  }
  return resolvedCache.get(date);
}

function getDailyPuzzleNumber(dateStr) {
  const date = dateStr ?? getTodayDateString();
  const target = new Date(date + "T00:00:00Z");
  const diffMs = target.getTime() - LAUNCH_DATE.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays + 1);
}

// ── Pyth Prices ──
async function fetchAllPrices() {
  const ids = COINS.map((c) => c.pythFeedId);
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids[]", id));
  params.append("parsed", "true");

  const url = `https://hermes.pyth.network/v2/updates/price/latest?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes API error: ${res.status}`);

  const data = await res.json();
  const prices = {};

  for (const parsed of data.parsed ?? []) {
    const feedId = "0x" + parsed.id;
    const coin = COINS.find((c) => c.pythFeedId === feedId);
    if (!coin) continue;
    const price = Number(parsed.price.price) * Math.pow(10, Number(parsed.price.expo));
    prices[coin.ticker] = { price, tier: getPriceTier(price) };
  }
  return prices;
}

// ── Guess Comparison ──
function compareNumericTier(guessVal, secretVal) {
  const diff = Math.abs(guessVal - secretVal);
  const match = diff === 0 ? "green" : diff === 1 ? "yellow" : "red";
  const direction = guessVal === secretVal ? "match" : guessVal < secretVal ? "up" : "down";
  return { match, direction };
}

function compareGuess(guess, secret, prices) {
  // Type
  let typeMatch;
  if (guess.type === secret.type) typeMatch = "green";
  else if (getCoinTypeFamily(guess.type) === getCoinTypeFamily(secret.type)) typeMatch = "yellow";
  else typeMatch = "red";

  // Color
  let colorMatch;
  if (guess.primaryColor === secret.primaryColor) colorMatch = "green";
  else if (areColorsAdjacent(guess.primaryColor, secret.primaryColor)) colorMatch = "yellow";
  else colorMatch = "red";

  // Launch Year
  const yearDiff = Math.abs(guess.launchYear - secret.launchYear);
  const launchYear = yearDiff === 0 ? "green" : yearDiff === 1 ? "yellow" : "red";
  const launchYearDir = guess.launchYear === secret.launchYear ? "match" : guess.launchYear < secret.launchYear ? "up" : "down";

  // Ticker Length
  const tickerResult = compareNumericTier(guess.tickerLength, secret.tickerLength);

  // Price Range
  const guessTier = prices[guess.ticker]?.tier ?? 5;
  const secretTier = prices[secret.ticker]?.tier ?? 5;
  const priceResult = compareNumericTier(guessTier, secretTier);

  // FDV Range
  const guessFdv = FDV_BUCKET_ORDER.indexOf(guess.fdvBucket);
  const secretFdv = FDV_BUCKET_ORDER.indexOf(secret.fdvBucket);
  const fdvResult = compareNumericTier(guessFdv, secretFdv);

  return {
    coin: guess,
    type: typeMatch,
    color: colorMatch,
    launchYear,
    launchYearDir,
    tickerLength: tickerResult.match,
    tickerLengthDir: tickerResult.direction,
    priceRange: priceResult.match,
    priceRangeDir: priceResult.direction,
    fdvRange: fdvResult.match,
    fdvRangeDir: fdvResult.direction,
  };
}

// ── Helpers ──
function findCoin(input) {
  const q = input.trim().toUpperCase();
  return COINS.find((c) => c.ticker.toUpperCase() === q || c.name.toUpperCase() === q);
}

function getAllCoinNames() {
  return COINS.map((c) => ({ name: c.name, value: c.ticker }));
}

module.exports = {
  COINS,
  getDailyCoinIndex,
  getDailyPuzzleNumber,
  getTodayDateString,
  fetchAllPrices,
  compareGuess,
  findCoin,
  getAllCoinNames,
  FDV_BUCKET_ORDER,
};
