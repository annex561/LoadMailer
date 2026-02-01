import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation, Clock, AlertCircle, Loader2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface LiveMapProps {
  load: any;
}

interface RouteInfo {
  distance: number;
  duration: number;
  coordinates: [number, number][];
}

export function LiveMap({ load }: LiveMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const driverId = load?.driverId || load?.driver?.id;

  const { data: driverLocation, isLoading: locationLoading } = useQuery({
    queryKey: [`/api/drivers/${driverId}/current-location`],
    enabled: !!driverId,
    refetchInterval: 30000,
  });

  useEffect(() => {
    const geocodePickup = async () => {
      const address = load?.pickupAddress || load?.originCity;
      if (!address) {
        setGeocodeError("No pickup address available");
        return;
      }

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
          { headers: { 'User-Agent': 'TraqIQ/1.0' } }
        );
        const data = await response.json();
        if (data && data[0]) {
          setPickupCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
          setGeocodeError(null);
        } else {
          setGeocodeError("Could not find pickup location");
        }
      } catch (error) {
        setGeocodeError("Failed to geocode pickup address");
      }
    };

    geocodePickup();
  }, [load?.pickupAddress, load?.originCity]);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!driverLocation?.latitude || !driverLocation?.longitude || !pickupCoords) return;

      try {
        const driverLat = driverLocation.latitude;
        const driverLon = driverLocation.longitude;
        const [pickupLat, pickupLon] = pickupCoords;

        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${driverLon},${driverLat};${pickupLon},${pickupLat}?overview=full&geometries=geojson`
        );
        const data = await response.json();

        if (data.routes && data.routes[0]) {
          const route = data.routes[0];
          setRouteInfo({
            distance: route.distance / 1609.34,
            duration: route.duration / 60,
            coordinates: route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]),
          });
        }
      } catch (error) {
        console.error("Failed to fetch route:", error);
      }
    };

    fetchRoute();
  }, [driverLocation?.latitude, driverLocation?.longitude, pickupCoords]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([35.0458, -85.3094], 8);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    const bounds: L.LatLngBoundsExpression = [];

    if (driverLocation?.latitude && driverLocation?.longitude) {
      const driverIcon = L.divIcon({
        className: 'driver-marker',
        html: `<div style="background: #10b981; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
      L.marker([driverLocation.latitude, driverLocation.longitude], { icon: driverIcon })
        .addTo(map)
        .bindPopup(`<b>${load?.driver?.name || 'Driver'}</b><br/>Current Location`);
      bounds.push([driverLocation.latitude, driverLocation.longitude]);
    }

    if (pickupCoords) {
      const pickupIcon = L.divIcon({
        className: 'pickup-marker',
        html: `<div style="background: #3b82f6; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });
      L.marker(pickupCoords, { icon: pickupIcon })
        .addTo(map)
        .bindPopup(`<b>Pickup</b><br/>${load?.pickupAddress || load?.originCity || 'Pickup Location'}`);
      bounds.push(pickupCoords);
    }

    if (routeInfo && routeInfo.coordinates.length > 0) {
      L.polyline(routeInfo.coordinates, {
        color: '#6366f1',
        weight: 5,
        opacity: 0.8,
        dashArray: '10, 10',
      }).addTo(map);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [50, 50] });
    }

    return () => {};
  }, [driverLocation, pickupCoords, routeInfo, load]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  if (!driverId) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-900">
        <div className="text-center text-slate-400">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No driver assigned to this load</p>
          <p className="text-sm text-slate-500 mt-1">Assign a driver to enable GPS tracking</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <div className="bg-slate-800/50 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm text-slate-300">{load?.driver?.name || 'Driver'}</span>
          </div>
          {routeInfo && (
            <>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Navigation className="w-4 h-4" />
                <span className="text-sm">{routeInfo.distance.toFixed(1)} mi</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock className="w-4 h-4" />
                <span className="text-sm">{Math.round(routeInfo.duration)} min</span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <MapPin className="w-3 h-3" />
          <span>To: {load?.pickupAddress || load?.originCity || 'Pickup'}</span>
        </div>
      </div>

      <div className="flex-1 relative">
        {locationLoading && (
          <div className="absolute inset-0 bg-slate-900/80 z-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          </div>
        )}
        {geocodeError && !pickupCoords && (
          <div className="absolute top-4 left-4 right-4 z-10 bg-amber-900/80 text-amber-200 px-3 py-2 rounded text-sm">
            {geocodeError}
          </div>
        )}
        <div ref={mapRef} className="h-full w-full" />
      </div>

      <div className="bg-slate-800/50 border-t border-slate-700 px-4 py-2 flex items-center justify-between text-xs text-slate-500">
        <span>Auto-refresh: 30s</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Driver</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>Pickup</span>
          </div>
        </div>
      </div>
    </div>
  );
}
