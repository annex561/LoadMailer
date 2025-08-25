import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Zap, Clock } from "lucide-react";
import { useState, useEffect, useRef } from "react";

type DriverLocation = {
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  address?: string;
  lastUpdate: string;
  speed?: number;
  batteryLevel?: number;
  isMoving: boolean;
  heading?: number;
  routeName?: string;
};

type LocationsResponse = {
  locations: DriverLocation[];
  count: number;
  serviceRunning: boolean;
  trackedDrivers: number;
};

export default function DriverLocationMap() {
  // Fetch real-time driver locations
  const { data: response, isLoading } = useQuery<LocationsResponse>({
    queryKey: ["/api/driver-locations/active"],
    refetchInterval: 15000, // Refresh every 15 seconds to match GPS tracking frequency
  });

  const locations = response?.locations || [];

  // Center map on Tennessee/Atlanta region
  const centerLat = 35.5;
  const centerLng = -85.0;

  // Calculate map bounds to show all drivers
  const bounds = locations.length > 0 ? {
    minLat: Math.min(...locations.map(l => l.latitude)) - 0.1,
    maxLat: Math.max(...locations.map(l => l.latitude)) + 0.1,
    minLng: Math.min(...locations.map(l => l.longitude)) - 0.1,
    maxLng: Math.max(...locations.map(l => l.longitude)) + 0.1,
  } : null;

  const formatSpeed = (speed?: number) => speed ? `${speed.toFixed(0)} mph` : "N/A";
  const formatBattery = (level?: number) => level ? `${Math.round(level)}%` : "N/A";

  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<google.maps.Marker[]>([]);

  // Initialize Google Maps
  useEffect(() => {
    if (!mapRef.current) return;

    // Load Google Maps script if not already loaded
    if (!window.google) {
      const script = document.createElement('script');
      script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dO-W_jnbGw5yM0&callback=initMap';
      script.async = true;
      script.defer = true;
      
      window.initMap = () => {
        const mapInstance = new google.maps.Map(mapRef.current!, {
          center: { lat: 39.8283, lng: -98.5795 }, // Center of US
          zoom: 4,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });
        setMap(mapInstance);
      };
      
      document.head.appendChild(script);
    } else {
      // Google Maps already loaded
      const mapInstance = new google.maps.Map(mapRef.current, {
        center: { lat: 39.8283, lng: -98.5795 },
        zoom: 4,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });
      setMap(mapInstance);
    }
  }, []);

  // Update markers when locations change
  useEffect(() => {
    if (!map || !locations) return;

    // Clear existing markers
    markers.forEach(marker => marker.setMap(null));

    // Create new markers
    const newMarkers = locations.map(location => {
      const marker = new google.maps.Marker({
        position: { lat: location.latitude, lng: location.longitude },
        map: map,
        title: location.driverName,
        icon: {
          url: 'data:image/svg+xml;base64,' + btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
              <circle cx="12" cy="12" r="10" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>
              <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" 
                    fill="#ffffff" transform="translate(3,3) scale(0.75)"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(32, 32),
          anchor: new google.maps.Point(16, 16),
        },
      });

      // Add info window
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family: Arial, sans-serif; min-width: 200px; padding: 8px;">
            <h3 style="margin: 0 0 8px 0; color: #1e40af;">${location.driverName}</h3>
            <div style="margin: 4px 0;">
              <strong>📍 Location:</strong> ${location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}
            </div>
            <div style="margin: 4px 0;">
              <strong>🚗 Speed:</strong> ${formatSpeed(location.speed)} | 
              <strong>🔋 Battery:</strong> ${formatBattery(location.batteryLevel)}
            </div>
            <div style="margin: 4px 0;">
              <strong>📅 Last Update:</strong> ${new Date(location.lastUpdate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            </div>
            <div style="margin: 4px 0;">
              <span style="padding: 2px 6px; border-radius: 4px; font-size: 12px; ${location.isMoving ? 'background: #10b981; color: white;' : 'background: #6b7280; color: white;'}">${location.isMoving ? 'Moving' : 'Stopped'}</span>
              ${location.routeName ? `<br><small style="color: #6b7280;">${location.routeName}</small>` : ''}
            </div>
          </div>
        `,
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });

      return marker;
    });

    setMarkers(newMarkers);

    // Auto-fit map to show all markers if multiple drivers
    if (locations.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      locations.forEach(location => {
        bounds.extend({ lat: location.latitude, lng: location.longitude });
      });
      map.fitBounds(bounds);
    } else if (locations.length === 1) {
      // Center on single driver
      map.setCenter({ lat: locations[0].latitude, lng: locations[0].longitude });
      map.setZoom(8);
    }
  }, [map, locations]);

  // Declare global initMap function
  declare global {
    interface Window {
      google: typeof google;
      initMap: () => void;
    }
  }

  if (isLoading) {
    return (
      <Card data-testid="card-driver-map">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Driver Locations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-64 bg-gray-200 rounded-lg"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-driver-map">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Real-Time Driver Locations
          </div>
          <Badge variant="secondary">
            {locations.length} Active
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {locations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-driver-locations">
            <MapPin className="mx-auto h-12 w-12 mb-4" />
            <p>No active driver locations available</p>
            <p className="text-sm">Driver GPS tracking will appear here when active</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Real Google Maps */}
            <div className="relative h-96 rounded-lg overflow-hidden border-2 border-gray-200">
              <div
                ref={mapRef}
                className="w-full h-full"
                data-testid="google-map-container"
              />
              {!map && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                  <div className="text-center">
                    <MapPin className="mx-auto h-8 w-8 mb-2 animate-spin" />
                    <p className="text-sm text-gray-600">Loading map...</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Driver list below map */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {locations.map((location) => (
                <div 
                  key={location.driverId} 
                  className="bg-gray-50 rounded-lg p-3 border"
                  data-testid={`driver-card-${location.driverId}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-semibold text-sm">{location.driverName}</div>
                      <div className="text-xs text-gray-500">{location.routeName || 'On Route'}</div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="w-3 h-3 mr-1" />
                      {location.isMoving ? 'Moving' : 'Stopped'}
                    </Badge>
                  </div>
                  
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-gray-400" />
                      <span className="truncate">
                        {location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Navigation className="w-3 h-3 text-blue-600" />
                          {formatSpeed(location.speed)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3 text-green-600" />
                          {formatBattery(location.batteryLevel)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-400">
                        <Clock className="w-3 h-3" />
                        {new Date(location.lastUpdate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}