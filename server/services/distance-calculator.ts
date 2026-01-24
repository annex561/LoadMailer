const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

interface Coordinates {
  lat: number;
  lon: number;
}

async function geocodeCity(cityState: string): Promise<Coordinates | null> {
  try {
    const query = encodeURIComponent(cityState + ', USA');
    const response = await fetch(
      `${NOMINATIM_URL}?q=${query}&format=json&limit=1`,
      {
        headers: {
          'User-Agent': 'TRAQ-IQ-Fleet-Management/1.0'
        }
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon)
      };
    }
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

async function getRoutingDistance(origin: Coordinates, destination: Coordinates): Promise<number | null> {
  try {
    const url = `${OSRM_URL}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false`;
    const response = await fetch(url);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const meters = data.routes[0].distance;
      const miles = meters * 0.000621371;
      return Math.round(miles);
    }
    return null;
  } catch (error) {
    console.error('Routing error:', error);
    return null;
  }
}

function haversineDistance(origin: Coordinates, destination: Coordinates): number {
  const R = 3959;
  const dLat = (destination.lat - origin.lat) * Math.PI / 180;
  const dLon = (destination.lon - origin.lon) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 1.15);
}

export async function calculateMiles(originCity: string, destinationCity: string): Promise<number | null> {
  console.log(`📍 Calculating distance: ${originCity} → ${destinationCity}`);
  
  const [originCoords, destCoords] = await Promise.all([
    geocodeCity(originCity),
    geocodeCity(destinationCity)
  ]);
  
  if (!originCoords || !destCoords) {
    console.warn('Could not geocode one or both cities');
    return null;
  }
  
  const routingMiles = await getRoutingDistance(originCoords, destCoords);
  
  if (routingMiles) {
    console.log(`✅ Routing distance: ${routingMiles} miles`);
    return routingMiles;
  }
  
  const haversineMiles = haversineDistance(originCoords, destCoords);
  console.log(`✅ Estimated distance (haversine): ${haversineMiles} miles`);
  return haversineMiles;
}

export async function fillMissingMiles(
  loads: Array<{id: string, origin_city?: string, origin_state?: string, dest_city?: string, dest_state?: string, miles?: number | null}>
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  
  for (const load of loads) {
    if (load.miles && load.miles > 0) continue;
    
    const origin = [load.origin_city, load.origin_state].filter(Boolean).join(', ');
    const dest = [load.dest_city, load.dest_state].filter(Boolean).join(', ');
    
    if (!origin || !dest) continue;
    
    const miles = await calculateMiles(origin, dest);
    if (miles) {
      results.set(load.id, miles);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
  
  return results;
}
