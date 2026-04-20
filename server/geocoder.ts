// Geocoder with in-memory cache + OpenStreetMap Nominatim fallback
// - First try: static CITY_COORDS table (zero latency)
// - Then: Nominatim (1 req/sec limit; result cached forever)
// - Graceful failure: returns null if lookup fails

import { getCityCoords as staticLookup } from './auto-load-matcher';

const CACHE = new Map<string, [number, number] | null>();
const CACHE_MAX = 5000;

let lastNominatimAt = 0;
const NOMINATIM_MIN_GAP_MS = 1100; // respect 1 req/sec policy

async function nominatimLookup(query: string): Promise<[number, number] | null> {
  // Throttle
  const now = Date.now();
  const wait = Math.max(0, NOMINATIM_MIN_GAP_MS - (now - lastNominatimAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'TRAQ-IQ/1.0 (dispatch@lamplogistics.example)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const arr: any[] = await res.json();
    if (!arr?.length) return null;
    const lat = parseFloat(arr[0].lat);
    const lon = parseFloat(arr[0].lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return [lat, lon];
  } catch (err) {
    console.warn('[geocoder] nominatim error:', (err as any)?.message || err);
    return null;
  }
}

export async function geocode(query: string): Promise<[number, number] | null> {
  if (!query) return null;
  const key = query.toLowerCase().trim();
  if (CACHE.has(key)) return CACHE.get(key)!;

  // Static table first
  const hit = staticLookup(key);
  if (hit) {
    CACHE.set(key, hit);
    return hit;
  }

  // Fall back to Nominatim
  const dyn = await nominatimLookup(key);
  if (CACHE.size > CACHE_MAX) {
    // evict oldest half (simple strategy)
    const keys = Array.from(CACHE.keys());
    for (let i = 0; i < keys.length / 2; i++) CACHE.delete(keys[i]);
  }
  CACHE.set(key, dyn);
  return dyn;
}

export function geocoderStats() {
  return { cacheSize: CACHE.size, cacheMax: CACHE_MAX };
}
