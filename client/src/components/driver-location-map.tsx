import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Zap, Clock, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

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

  // Map zoom and center state
  const [zoomLevel, setZoomLevel] = useState(4); // US view
  const [mapCenter, setMapCenter] = useState({ lat: 39.8283, lng: -98.5795 }); // Geographic center of US

  // Convert coordinates to map pixels
  const coordToPixel = (lat: number, lng: number, zoom: number) => {
    // Simplified web mercator projection
    const mapWidth = 800;
    const mapHeight = 600;
    
    // US bounds: roughly 24.7°N to 49.4°N, -125°W to -66.9°W
    const bounds = {
      north: 49.4,
      south: 24.7,
      west: -125.0,
      east: -66.9
    };

    // Scale based on zoom level
    const scale = Math.pow(2, zoom - 4);
    
    // Center the view on mapCenter
    const centerOffsetLat = (lat - mapCenter.lat) * scale;
    const centerOffsetLng = (lng - mapCenter.lng) * scale;
    
    const x = (mapWidth / 2) + (centerOffsetLng * mapWidth / (bounds.east - bounds.west));
    const y = (mapHeight / 2) - (centerOffsetLat * mapHeight / (bounds.north - bounds.south));
    
    return { x: Math.max(0, Math.min(mapWidth, x)), y: Math.max(0, Math.min(mapHeight, y)) };
  };

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 1, 10));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 1, 2));

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert pixel coordinates back to lat/lng for map centering
    const mapWidth = 800;
    const mapHeight = 600;
    const bounds = {
      north: 49.4,
      south: 24.7,
      west: -125.0,
      east: -66.9
    };
    
    const lng = bounds.west + (x / mapWidth) * (bounds.east - bounds.west);
    const lat = bounds.north - (y / mapHeight) * (bounds.north - bounds.south);
    
    setMapCenter({ lat, lng });
  };

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
            {/* Interactive US Map */}
            <div className="relative h-96 rounded-lg overflow-hidden border-2 border-gray-200 bg-gradient-to-br from-blue-50 to-green-50">
              {/* Map Controls */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-white/90 hover:bg-white"
                  onClick={handleZoomIn}
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-white/90 hover:bg-white"
                  onClick={handleZoomOut}
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
              </div>

              {/* Map Info */}
              <div className="absolute top-4 right-4 z-10 bg-white/90 px-3 py-2 rounded text-sm font-semibold">
                United States - Zoom: {zoomLevel}
              </div>

              {/* Interactive Map Area */}
              <div 
                className="relative w-full h-full cursor-crosshair"
                onClick={handleMapClick}
                style={{
                  backgroundImage: `url("data:image/svg+xml;base64,${btoa(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
                      <!-- US States outline -->
                      <rect width="800" height="600" fill="#f0f9ff"/>
                      <!-- Grid lines for reference -->
                      <defs>
                        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
                        </pattern>
                      </defs>
                      <rect width="800" height="600" fill="url(#grid)" opacity="0.3"/>
                      
                      <!-- Simplified US outline -->
                      <path d="M 150 400 L 150 200 L 250 150 L 400 180 L 550 200 L 650 250 L 700 300 L 680 400 L 600 450 L 400 480 L 200 450 Z" 
                            fill="#bfdbfe" stroke="#1e40af" stroke-width="2"/>
                      
                      <!-- State boundaries (simplified) -->
                      <g stroke="#6b7280" stroke-width="1" fill="none" opacity="0.5">
                        <line x1="200" y1="150" x2="200" y2="450"/>
                        <line x1="300" y1="180" x2="300" y2="480"/>
                        <line x1="400" y1="180" x2="400" y2="480"/>
                        <line x1="500" y1="200" x2="500" y2="450"/>
                        <line x1="600" y1="250" x2="600" y2="450"/>
                        <line x1="150" y1="250" x2="680" y2="250"/>
                        <line x1="150" y1="350" x2="680" y2="350"/>
                      </g>
                      
                      <!-- Major cities dots -->
                      <circle cx="250" cy="380" r="3" fill="#ef4444"/>
                      <circle cx="450" cy="320" r="3" fill="#ef4444"/>
                      <circle cx="180" cy="300" r="3" fill="#ef4444"/>
                      <circle cx="600" cy="280" r="3" fill="#ef4444"/>
                    </svg>
                  `)}")`
                }}
              >
                {/* Driver markers */}
                {locations.map((location) => {
                  const { x, y } = coordToPixel(location.latitude, location.longitude, zoomLevel);
                  
                  return (
                    <div
                      key={location.driverId}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 group cursor-pointer z-20"
                      style={{ 
                        left: `${(x / 800) * 100}%`, 
                        top: `${(y / 600) * 100}%`,
                        transform: `scale(${Math.min(zoomLevel / 4, 2)}) translate(-50%, -50%)`
                      }}
                      data-testid={`driver-marker-${location.driverId}`}
                    >
                      {/* Truck icon marker */}
                      <div className="relative">
                        <div className="w-8 h-8 bg-blue-600 rounded-full border-3 border-white shadow-lg flex items-center justify-center animate-pulse">
                          <Navigation className="w-4 h-4 text-white" />
                        </div>
                        
                        {/* Driver info tooltip */}
                        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-xs rounded px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30 min-w-[180px]">
                          <div className="font-semibold">{location.driverName}</div>
                          <div className="flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3" />
                            <span>{location.address}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1">
                              <Navigation className="w-3 h-3 text-blue-400" />
                              {formatSpeed(location.speed)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3 text-green-400" />
                              {formatBattery(location.batteryLevel)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <Badge variant={location.isMoving ? "default" : "secondary"} className="text-xs">
                              {location.isMoving ? 'Moving' : 'Stopped'}
                            </Badge>
                            <span className="text-xs opacity-75">
                              {new Date(location.lastUpdate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Zoom level indicator */}
                <div className="absolute bottom-4 left-4 text-xs text-gray-600 bg-white/80 px-2 py-1 rounded">
                  Click to center • Use zoom controls
                </div>
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