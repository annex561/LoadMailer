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
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 500">
                      <!-- Ocean background -->
                      <rect width="900" height="500" fill="#b8dbed"/>
                      
                      <!-- United States with detailed state boundaries -->
                      <g fill="#ffffff" stroke="#d0d0d0" stroke-width="0.8">
                        <!-- Washington -->
                        <path d="M30 60 L170 60 L170 130 L30 130 Z"/>
                        <!-- Oregon -->
                        <path d="M30 130 L170 130 L170 200 L30 200 Z"/>
                        <!-- California -->
                        <path d="M30 200 L170 200 L170 350 L30 350 Z"/>
                        <!-- Nevada -->
                        <path d="M170 130 L220 130 L220 290 L170 290 Z"/>
                        <!-- Idaho -->
                        <path d="M170 60 L240 60 L240 200 L170 200 Z"/>
                        <!-- Montana -->
                        <path d="M240 60 L400 60 L400 140 L240 140 Z"/>
                        <!-- Wyoming -->
                        <path d="M240 140 L400 140 L400 200 L240 200 Z"/>
                        <!-- Utah -->
                        <path d="M220 200 L320 200 L320 290 L220 290 Z"/>
                        <!-- Colorado -->
                        <path d="M320 200 L420 200 L420 290 L320 290 Z"/>
                        <!-- Arizona -->
                        <path d="M170 290 L320 290 L320 380 L170 380 Z"/>
                        <!-- New Mexico -->
                        <path d="M320 290 L420 290 L420 380 L320 380 Z"/>
                        <!-- North Dakota -->
                        <path d="M400 60 L500 60 L500 140 L400 140 Z"/>
                        <!-- South Dakota -->
                        <path d="M400 140 L500 140 L500 200 L400 200 Z"/>
                        <!-- Nebraska -->
                        <path d="M420 200 L520 200 L520 260 L420 260 Z"/>
                        <!-- Kansas -->
                        <path d="M420 260 L520 260 L520 320 L420 320 Z"/>
                        <!-- Oklahoma -->
                        <path d="M420 320 L600 320 L600 380 L420 380 Z"/>
                        <!-- Texas -->
                        <path d="M420 380 L600 380 L600 460 L420 460 Z"/>
                        <!-- Minnesota -->
                        <path d="M500 60 L580 60 L580 180 L500 180 Z"/>
                        <!-- Iowa -->
                        <path d="M520 180 L600 180 L600 240 L520 240 Z"/>
                        <!-- Missouri -->
                        <path d="M520 240 L620 240 L620 320 L520 320 Z"/>
                        <!-- Arkansas -->
                        <path d="M600 320 L680 320 L680 380 L600 380 Z"/>
                        <!-- Louisiana -->
                        <path d="M600 380 L680 380 L680 440 L600 440 Z"/>
                        <!-- Wisconsin -->
                        <path d="M580 60 L640 60 L640 180 L580 180 Z"/>
                        <!-- Illinois -->
                        <path d="M600 180 L650 180 L650 280 L600 280 Z"/>
                        <!-- Mississippi -->
                        <path d="M680 300 L720 300 L720 400 L680 400 Z"/>
                        <!-- Alabama -->
                        <path d="M720 300 L760 300 L760 400 L720 400 Z"/>
                        <!-- Tennessee -->
                        <path d="M650 280 L780 280 L780 320 L650 320 Z"/>
                        <!-- Kentucky -->
                        <path d="M650 240 L780 240 L780 280 L650 280 Z"/>
                        <!-- Indiana -->
                        <path d="M650 180 L700 180 L700 280 L650 280 Z"/>
                        <!-- Ohio -->
                        <path d="M700 180 L760 180 L760 280 L700 280 Z"/>
                        <!-- Michigan -->
                        <path d="M640 80 L720 80 L720 180 L640 180 Z"/>
                        <!-- West Virginia -->
                        <path d="M760 200 L800 200 L800 260 L760 260 Z"/>
                        <!-- Virginia -->
                        <path d="M780 240 L840 240 L840 300 L780 300 Z"/>
                        <!-- North Carolina -->
                        <path d="M780 300 L860 300 L860 340 L780 340 Z"/>
                        <!-- South Carolina -->
                        <path d="M780 340 L830 340 L830 380 L780 380 Z"/>
                        <!-- Georgia -->
                        <path d="M760 340 L820 340 L820 420 L760 420 Z"/>
                        <!-- Florida -->
                        <path d="M760 420 L860 420 L870 460 L760 460 Z"/>
                        <!-- Pennsylvania -->
                        <path d="M760 160 L840 160 L840 220 L760 220 Z"/>
                        <!-- New York -->
                        <path d="M760 100 L840 100 L840 180 L760 180 Z"/>
                        <!-- Vermont -->
                        <path d="M840 100 L860 100 L860 160 L840 160 Z"/>
                        <!-- New Hampshire -->
                        <path d="M860 100 L880 100 L880 160 L860 160 Z"/>
                        <!-- Maine -->
                        <path d="M860 60 L900 60 L900 140 L860 140 Z"/>
                        <!-- Massachusetts -->
                        <path d="M840 160 L900 160 L900 180 L840 180 Z"/>
                        <!-- Rhode Island -->
                        <path d="M880 180 L890 180 L890 190 L880 190 Z"/>
                        <!-- Connecticut -->
                        <path d="M840 180 L880 180 L880 200 L840 200 Z"/>
                        <!-- New Jersey -->
                        <path d="M820 200 L840 200 L840 240 L820 240 Z"/>
                        <!-- Delaware -->
                        <path d="M830 220 L840 220 L840 240 L830 240 Z"/>
                        <!-- Maryland -->
                        <path d="M800 220 L840 220 L840 240 L800 240 Z"/>
                        <!-- Alaska (simplified, positioned separately) -->
                        <path d="M30 400 L150 400 L150 480 L30 480 Z"/>
                        <!-- Hawaii (simplified, positioned separately) -->
                        <circle cx="200" cy="440" r="8"/>
                        <circle cx="210" cy="445" r="6"/>
                        <circle cx="220" cy="450" r="4"/>
                      </g>
                      
                      <!-- State labels -->
                      <g fill="#666666" font-family="Arial, sans-serif" font-size="10" text-anchor="middle">
                        <text x="100" y="95">WA</text>
                        <text x="100" y="165">OR</text>
                        <text x="100" y="275">CA</text>
                        <text x="195" y="210">NV</text>
                        <text x="205" y="130">ID</text>
                        <text x="320" y="100">MT</text>
                        <text x="320" y="170">WY</text>
                        <text x="270" y="245">UT</text>
                        <text x="370" y="245">CO</text>
                        <text x="245" y="335">AZ</text>
                        <text x="370" y="335">NM</text>
                        <text x="450" y="100">ND</text>
                        <text x="450" y="170">SD</text>
                        <text x="470" y="230">NE</text>
                        <text x="470" y="290">KS</text>
                        <text x="510" y="350">OK</text>
                        <text x="510" y="420">TX</text>
                        <text x="540" y="120">MN</text>
                        <text x="560" y="210">IA</text>
                        <text x="570" y="280">MO</text>
                        <text x="640" y="350">AR</text>
                        <text x="640" y="410">LA</text>
                        <text x="610" y="120">WI</text>
                        <text x="625" y="230">IL</text>
                        <text x="700" y="350">MS</text>
                        <text x="740" y="350">AL</text>
                        <text x="715" y="300">TN</text>
                        <text x="715" y="260">KY</text>
                        <text x="675" y="230">IN</text>
                        <text x="730" y="230">OH</text>
                        <text x="680" y="130">MI</text>
                        <text x="780" y="230">WV</text>
                        <text x="810" y="270">VA</text>
                        <text x="820" y="320">NC</text>
                        <text x="805" y="360">SC</text>
                        <text x="790" y="380">GA</text>
                        <text x="815" y="440">FL</text>
                        <text x="800" y="190">PA</text>
                        <text x="800" y="140">NY</text>
                        <text x="850" y="130">VT</text>
                        <text x="870" y="130">NH</text>
                        <text x="880" y="100">ME</text>
                        <text x="870" y="170">MA</text>
                        <text x="885" y="185">RI</text>
                        <text x="860" y="190">CT</text>
                        <text x="830" y="220">NJ</text>
                        <text x="835" y="230">DE</text>
                        <text x="820" y="230">MD</text>
                        <text x="90" y="440">AK</text>
                        <text x="215" y="455">HI</text>
                      </g>
                    </svg>
                  `)}")`
                }}
              >
                {/* Driver Status Dropdown */}
                <div className="absolute top-4 left-4 z-10">
                  <select className="bg-white border border-gray-300 rounded px-3 py-1 text-sm shadow-sm">
                    <option>Unlocated Drivers ({5 - locations.length})</option>
                    <option>All Drivers ({5})</option>
                    <option>Active Drivers ({locations.length})</option>
                  </select>
                </div>

                {/* Zoom Controls */}
                <div className="absolute top-4 right-4 z-10 flex flex-col gap-1 bg-white rounded shadow-lg border border-gray-300">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleZoomIn(); }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 text-lg font-bold"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleZoomOut(); }}
                    className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 text-lg font-bold border-t border-gray-300"
                    title="Zoom Out"
                  >
                    −
                  </button>
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