/**
 * Reverse Geocoding Service
 * Converts GPS coordinates (latitude, longitude) to human-readable addresses (City, State)
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 * 
 * Features:
 * - Request timeout (10 seconds)
 * - Response caching (reduces API calls)
 * - Rate limiting (respects Nominatim 1 req/sec limit)
 * - Silent error handling (logs reduced to prevent spam)
 */

interface GeocodingResult {
  address: string;
  city?: string;
  state?: string;
  country?: string;
}

// Cache for geocoding results (key: "lat,lng", value: address)
const geocodeCache = new Map<string, { address: string; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

// Rate limiting state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second between requests (Nominatim limit)

// Error tracking to reduce log spam
let errorCount = 0;
let lastErrorLog = 0;
const ERROR_LOG_INTERVAL = 60000; // Only log errors once per minute

/**
 * Round coordinates to reduce cache misses for nearby locations
 */
function roundCoords(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Convert GPS coordinates to a human-readable address
 * @param lat Latitude (-90 to 90)
 * @param lng Longitude (-180 to 180)
 * @returns Promise<string> Address in format "City, State" or coordinates as fallback
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    // Check cache first
    const cacheKey = roundCoords(lat, lng);
    const cached = geocodeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.address;
    }

    // Rate limiting - wait if needed
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    // Use OpenStreetMap Nominatim for reverse geocoding with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
      {
        headers: {
          'User-Agent': 'TRAQ-IQ-Fleet-Management/1.0'
        },
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract city and state from the response
    const address = data.address || {};
    const city = address.city || address.town || address.village || address.hamlet || address.county || '';
    const state = address.state || '';
    
    let result: string;
    if (city && state) {
      result = `${city}, ${state}`;
    } else if (city) {
      result = city;
    } else if (state) {
      result = state;
    } else {
      result = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    // Cache the result
    geocodeCache.set(cacheKey, { address: result, timestamp: Date.now() });
    
    // Reset error count on success
    errorCount = 0;
    
    return result;
  } catch (error) {
    // Only log errors occasionally to prevent log spam
    const now = Date.now();
    errorCount++;
    if (now - lastErrorLog > ERROR_LOG_INTERVAL) {
      console.warn(`⚠️ Geocoding service temporarily unavailable (${errorCount} errors in last minute)`);
      lastErrorLog = now;
      errorCount = 0;
    }
    
    // Fallback to coordinates on error
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/**
 * Get detailed geocoding result with city, state, and country
 * Uses the same caching and rate limiting as reverseGeocode
 * @param lat Latitude
 * @param lng Longitude
 * @returns Promise<GeocodingResult>
 */
export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<GeocodingResult> {
  try {
    // Use the cached/rate-limited reverseGeocode for the address
    const address = await reverseGeocode(lat, lng);
    
    // If it's just coordinates (fallback), return simple result
    if (address.includes(',') && !isNaN(parseFloat(address.split(',')[0]))) {
      return { address };
    }
    
    // Parse the cached address for detailed components
    const parts = address.split(', ');
    if (parts.length === 2) {
      return {
        address,
        city: parts[0],
        state: parts[1],
        country: 'USA'
      };
    } else if (parts.length === 1) {
      return {
        address,
        city: parts[0]
      };
    }
    
    return { address };
  } catch (error) {
    return {
      address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    };
  }
}
