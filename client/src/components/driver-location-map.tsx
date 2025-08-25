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
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  
  const formatSpeed = (speed?: number) => speed ? `${speed.toFixed(0)} mph` : "N/A";
  const formatBattery = (level?: number) => level ? `${Math.round(level)}%` : "N/A";

  // Calculate map center based on driver locations
  const mapCenter = locations.length > 0 ? {
    lat: locations.reduce((sum, l) => sum + l.latitude, 0) / locations.length,
    lng: locations.reduce((sum, l) => sum + l.longitude, 0) / locations.length
  } : { lat: 35.5, lng: -85.0 }; // Tennessee center

  useEffect(() => {
    // Load real map tiles using vanilla JavaScript
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      // Map will initialize when script loads
    };
    document.head.appendChild(script);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    return () => {
      // Cleanup
      document.head.removeChild(script);
      document.head.removeChild(link);
    };
  }, []);

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
            {/* Real OpenStreetMap with tiles */}
            <div className="relative h-96 rounded-lg overflow-hidden border-2 border-gray-200">
              {/* Driver Status Dropdown */}
              <div className="absolute top-4 left-4 z-10">
                <select className="bg-white border border-gray-300 rounded px-3 py-1 text-sm shadow-sm">
                  <option>Unlocated Drivers ({5 - locations.length})</option>
                  <option>All Drivers ({5})</option>
                  <option>Active Drivers ({locations.length})</option>
                </select>
              </div>

              {/* Real Map iframe using OpenStreetMap */}
              <iframe
                src={`https://www.openstreetmap.org/export/embed.html?bbox=-125.0,25.0,-65.0,50.0&layer=mapnik&marker=${mapCenter.lat}%2C${mapCenter.lng}`}
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  border: 'none',
                  borderRadius: '8px'
                }}
                title="Driver Location Map"
                data-testid="osm-iframe-map"
              />

              {/* Driver markers overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {locations.map((location) => {
                  // Convert lat/lng to approximate pixel position for overlay
                  // This is a simplified conversion for demo purposes
                  const lat = location.latitude;
                  const lng = location.longitude;
                  
                  // Simple mercator projection approximation
                  const x = ((lng + 125) / 60) * 100; // Convert to percentage
                  const y = ((50 - lat) / 25) * 100; // Convert to percentage
                  
                  return (
                    <div
                      key={location.driverId}
                      className="absolute pointer-events-auto"
                      style={{ 
                        left: `${Math.max(0, Math.min(100, x))}%`, 
                        top: `${Math.max(0, Math.min(100, y))}%`,
                        transform: 'translate(-50%, -50%)'
                      }}
                      data-testid={`driver-marker-${location.driverId}`}
                    >
                      <div 
                        className="relative cursor-pointer group"
                        onClick={() => setSelectedDriver(selectedDriver === location.driverId ? null : location.driverId)}
                      >
                        {/* Truck marker */}
                        <div className="w-8 h-8 bg-blue-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors">
                          <Navigation className="w-4 h-4 text-white" />
                        </div>
                        
                        {/* Info popup */}
                        {selectedDriver === location.driverId && (
                          <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-white border border-gray-300 rounded-lg shadow-xl p-3 min-w-[220px] z-50">
                            <div className="font-semibold text-sm mb-2 text-blue-900">{location.driverName}</div>
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-gray-400" />
                                <span className="truncate">{location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}</span>
                              </div>
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
                              <div className="flex items-center justify-between">
                                <Badge variant={location.isMoving ? "default" : "secondary"} className="text-xs">
                                  {location.isMoving ? 'Moving' : 'Stopped'}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  {new Date(location.lastUpdate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                                </span>
                              </div>
                              {location.routeName && (
                                <div className="text-xs text-gray-500 mt-1">{location.routeName}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Instructions */}
              <div className="absolute bottom-4 left-4 text-xs text-gray-600 bg-white/90 px-2 py-1 rounded shadow pointer-events-none">
                Real OpenStreetMap • Click truck markers for driver details
              </div>
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