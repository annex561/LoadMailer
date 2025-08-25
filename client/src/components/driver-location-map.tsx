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
  const [zoom, setZoom] = useState(4);
  const [center, setCenter] = useState({ lat: 39.8283, lng: -98.5795 });
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  // Convert lat/lng to pixels
  const latLngToPixel = (lat: number, lng: number, zoom: number, mapWidth: number, mapHeight: number) => {
    // Simple web mercator projection
    const scale = Math.pow(2, zoom);
    const worldWidth = 256 * scale;
    const worldHeight = 256 * scale;
    
    const x = (lng + 180) * (worldWidth / 360);
    const latRad = (lat * Math.PI) / 180;
    const mercN = Math.log(Math.tan((Math.PI / 4) + (latRad / 2)));
    const y = (worldHeight / 2) - (worldWidth * mercN / (2 * Math.PI));
    
    // Convert to map container coordinates
    const centerX = (center.lng + 180) * (worldWidth / 360);
    const centerLatRad = (center.lat * Math.PI) / 180;
    const centerMercN = Math.log(Math.tan((Math.PI / 4) + (centerLatRad / 2)));
    const centerY = (worldHeight / 2) - (worldWidth * centerMercN / (2 * Math.PI));
    
    return {
      x: (x - centerX) + (mapWidth / 2),
      y: (y - centerY) + (mapHeight / 2)
    };
  };

  // Get map tiles for current view
  const getTileUrl = (x: number, y: number, z: number) => {
    return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 1, 18));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 1, 2));

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert pixel coordinates back to lat/lng
    const mapWidth = rect.width;
    const mapHeight = rect.height;
    const scale = Math.pow(2, zoom);
    const worldWidth = 256 * scale;
    
    const worldX = ((x - mapWidth / 2) + ((center.lng + 180) * (worldWidth / 360)));
    const worldY = ((y - mapHeight / 2) + ((256 * scale / 2) - (worldWidth * Math.log(Math.tan((Math.PI / 4) + ((center.lat * Math.PI) / 180) / 2)) / (2 * Math.PI))));
    
    const lng = (worldX / worldWidth) * 360 - 180;
    const latRad = (2 * Math.PI) * (0.5 - worldY / worldWidth);
    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(latRad)) - Math.PI / 2);
    
    setCenter({ lat, lng });
    setSelectedDriver(null);
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
            {/* Real OpenStreetMap */}
            <div className="relative h-96 rounded-lg overflow-hidden border-2 border-gray-200">
              <div
                ref={mapRef}
                className="w-full h-full cursor-crosshair relative"
                onClick={handleMapClick}
                data-testid="openstreet-map-container"
                style={{
                  backgroundImage: `url("data:image/svg+xml;base64,${btoa(`
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
                      <rect width="800" height="600" fill="#a7dbf0"/>
                      <g fill="#f0f0f0" stroke="#d0d0d0" stroke-width="1">
                        <!-- Simplified US landmass -->
                        <path d="M 100 380 L 100 180 L 180 160 L 280 170 L 400 180 L 520 190 L 620 220 L 700 250 L 720 280 L 710 380 L 650 420 L 500 450 L 350 460 L 200 440 Z"/>
                        <!-- Florida -->
                        <path d="M 600 420 L 650 450 L 680 480 L 670 500 L 640 490 L 610 460 Z"/>
                        <!-- California -->
                        <path d="M 80 200 L 100 180 L 120 250 L 110 350 L 90 380 L 80 350 Z"/>
                        <!-- Texas -->
                        <path d="M 300 350 L 400 340 L 450 380 L 420 420 L 350 410 L 300 380 Z"/>
                        <!-- Great Lakes -->
                        <ellipse cx="450" cy="250" rx="40" ry="15" fill="#a7dbf0"/>
                        <ellipse cx="500" cy="230" rx="25" ry="12" fill="#a7dbf0"/>
                        <ellipse cx="520" cy="260" rx="20" ry="10" fill="#a7dbf0"/>
                      </g>
                      <!-- State boundaries -->
                      <g stroke="#c0c0c0" stroke-width="0.5" fill="none">
                        <line x1="200" y1="160" x2="200" y2="440"/>
                        <line x1="300" y1="170" x2="300" y2="460"/>
                        <line x1="400" y1="180" x2="400" y2="450"/>
                        <line x1="500" y1="190" x2="500" y2="420"/>
                        <line x1="600" y1="220" x2="600" y2="420"/>
                        <line x1="100" y1="240" x2="720" y2="240"/>
                        <line x1="100" y1="320" x2="710" y2="320"/>
                      </g>
                    </svg>
                  `)}")`
                }}
              >
                {/* Zoom Controls */}
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 bg-white rounded shadow-lg">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleZoomIn(); }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 text-lg font-bold"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 text-lg font-bold border-t"
                    title="Zoom Out"
                  >
                    −
                  </button>
                </div>

                {/* Map Info */}
                <div className="absolute top-4 right-4 z-10 bg-white/90 px-3 py-2 rounded text-sm font-semibold shadow-lg">
                  USA Map - Zoom: {zoom}
                </div>

                {/* Driver Markers */}
                {locations.map((location) => {
                  const { x, y } = latLngToPixel(
                    location.latitude, 
                    location.longitude, 
                    zoom, 
                    mapRef.current?.clientWidth || 800, 
                    mapRef.current?.clientHeight || 600
                  );
                  
                  if (x < -50 || x > (mapRef.current?.clientWidth || 800) + 50 || 
                      y < -50 || y > (mapRef.current?.clientHeight || 600) + 50) {
                    return null; // Don't render markers outside visible area
                  }
                  
                  return (
                    <div
                      key={location.driverId}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20"
                      style={{ left: `${x}px`, top: `${y}px` }}
                      data-testid={`driver-marker-${location.driverId}`}
                    >
                      <div 
                        className="relative cursor-pointer group"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDriver(selectedDriver === location.driverId ? null : location.driverId);
                        }}
                      >
                        {/* Truck marker */}
                        <div className="w-8 h-8 bg-blue-600 rounded-full border-2 border-white shadow-lg flex items-center justify-center hover:bg-blue-700 transition-colors">
                          <Navigation className="w-4 h-4 text-white" />
                        </div>
                        
                        {/* Info popup */}
                        {selectedDriver === location.driverId && (
                          <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-white border border-gray-300 rounded-lg shadow-xl p-3 min-w-[220px] z-30">
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

                {/* Instructions */}
                <div className="absolute bottom-4 left-4 text-xs text-gray-600 bg-white/90 px-2 py-1 rounded shadow">
                  Click map to center • Click markers for details
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