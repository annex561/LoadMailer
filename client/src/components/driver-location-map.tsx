import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Zap, Clock } from "lucide-react";

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
            {/* Simple coordinate-based map representation */}
            <div className="relative bg-gradient-to-br from-blue-50 to-green-50 rounded-lg p-6 h-64 overflow-hidden border-2 border-gray-200">
              {/* Map background grid */}
              <div className="absolute inset-0 opacity-20">
                <div className="grid grid-cols-8 grid-rows-6 h-full w-full">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <div key={i} className="border border-gray-300"></div>
                  ))}
                </div>
              </div>
              
              {/* Map title */}
              <div className="absolute top-2 left-2 bg-white/90 px-2 py-1 rounded text-xs font-semibold">
                Tennessee/Georgia Region
              </div>
              
              {/* Driver markers */}
              {locations.map((location, index) => {
                // Convert GPS coordinates to map position (simple projection)
                const mapWidth = 100;
                const mapHeight = 100;
                
                // Tennessee/Georgia region bounds (more accurate)
                const regionBounds = {
                  minLat: 32.0, maxLat: 37.0,
                  minLng: -91.0, maxLng: -82.0
                };
                
                // Calculate map positions based on actual coordinates
                const x = ((location.longitude - regionBounds.minLng) / (regionBounds.maxLng - regionBounds.minLng)) * 100;
                const y = ((regionBounds.maxLat - location.latitude) / (regionBounds.maxLat - regionBounds.minLat)) * 100;
                
                return (
                  <div
                    key={location.driverId}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
                    style={{ 
                      left: `${Math.max(2, Math.min(98, x))}%`, 
                      top: `${Math.max(2, Math.min(98, y))}%` 
                    }}
                    data-testid={`driver-marker-${location.driverId}`}
                  >
                    {/* Driver marker */}
                    <div className="relative">
                      <div className="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-lg animate-pulse"></div>
                      <Navigation 
                        className="absolute top-0 left-0 w-4 h-4 text-white" 
                        style={{ transform: 'translate(-50%, -50%)' }}
                      />
                    </div>
                    
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <div className="font-semibold">{location.driverName}</div>
                      <div>{location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}</div>
                      <div className="flex items-center gap-2 text-xs">
                        <span>{formatSpeed(location.speed)}</span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {formatBattery(location.batteryLevel)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
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