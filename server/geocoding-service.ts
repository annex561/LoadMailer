/**
 * Reverse Geocoding Service
 * Converts GPS coordinates (latitude, longitude) to human-readable addresses (City, State)
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 */

interface GeocodingResult {
  address: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * Convert GPS coordinates to a human-readable address
 * @param lat Latitude (-90 to 90)
 * @param lng Longitude (-180 to 180)
 * @returns Promise<string> Address in format "City, State" or coordinates as fallback
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    // Use OpenStreetMap Nominatim for reverse geocoding (free, no API key required)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
      {
        headers: {
          'User-Agent': 'LoadSignal-Fleet-Management/1.0' // Required by Nominatim
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract city and state from the response
    const address = data.address || {};
    const city = address.city || address.town || address.village || address.hamlet || address.county || '';
    const state = address.state || '';
    
    if (city && state) {
      return `${city}, ${state}`;
    } else if (city) {
      return city;
    } else if (state) {
      return state;
    }
    
    // Fallback to coordinates if no address found
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (error) {
    console.error('Error getting address from coordinates:', error);
    // Fallback to coordinates on error
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/**
 * Get detailed geocoding result with city, state, and country
 * @param lat Latitude
 * @param lng Longitude
 * @returns Promise<GeocodingResult>
 */
export async function reverseGeocodeDetailed(lat: number, lng: number): Promise<GeocodingResult> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`,
      {
        headers: {
          'User-Agent': 'LoadSignal-Fleet-Management/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json();
    const addressData = data.address || {};
    
    const city = addressData.city || addressData.town || addressData.village || addressData.hamlet || addressData.county || '';
    const state = addressData.state || '';
    const country = addressData.country || '';
    
    let address = '';
    if (city && state) {
      address = `${city}, ${state}`;
    } else if (city) {
      address = city;
    } else if (state) {
      address = state;
    } else {
      address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    
    return {
      address,
      city: city || undefined,
      state: state || undefined,
      country: country || undefined
    };
  } catch (error) {
    console.error('Error getting detailed address from coordinates:', error);
    return {
      address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    };
  }
}
