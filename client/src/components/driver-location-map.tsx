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
                      <rect width="900" height="500" fill="#b5d5e4"/>
                      
                      <!-- United States mainland with realistic coastlines -->
                      <g fill="#ffffff" stroke="#c0c5c8" stroke-width="0.6">
                        <path d="M 160 60 L 800 60 L 800 75 L 820 75 L 825 85 L 840 85 L 845 95 L 855 95 L 860 105 L 840 105 L 835 115 L 845 125 L 850 135 L 855 145 L 860 155 L 865 165 L 870 175 L 875 185 L 865 195 L 870 205 L 875 215 L 865 225 L 870 235 L 875 245 L 880 255 L 875 265 L 880 275 L 875 285 L 870 295 L 875 305 L 880 315 L 875 325 L 870 335 L 875 345 L 880 355 L 875 365 L 870 375 L 865 385 L 860 395 L 855 405 L 850 415 L 845 425 L 840 435 L 830 440 L 820 445 L 810 450 L 800 455 L 790 460 L 780 465 L 770 460 L 760 455 L 750 450 L 740 445 L 730 440 L 720 435 L 710 430 L 700 425 L 690 420 L 680 415 L 670 410 L 660 405 L 650 400 L 640 395 L 630 390 L 620 385 L 610 380 L 600 375 L 590 370 L 580 365 L 570 360 L 560 355 L 550 350 L 540 345 L 530 340 L 520 335 L 510 330 L 500 325 L 490 320 L 480 315 L 470 310 L 460 305 L 450 300 L 440 295 L 430 290 L 420 285 L 410 280 L 400 275 L 390 270 L 380 265 L 370 260 L 360 255 L 350 250 L 340 245 L 330 240 L 320 235 L 310 230 L 300 225 L 290 220 L 280 215 L 270 210 L 260 205 L 250 200 L 240 195 L 230 190 L 220 185 L 210 180 L 200 175 L 190 170 L 180 165 L 170 160 L 165 150 L 170 140 L 175 130 L 180 120 L 185 110 L 190 100 L 195 90 L 190 80 L 185 70 L 175 65 L 165 62 Z"/>
                        
                        <!-- Great Lakes -->
                        <path d="M 660 160 L 720 160 L 725 170 L 720 180 L 715 190 L 705 195 L 695 190 L 685 185 L 675 180 L 665 175 L 660 165 Z" fill="#b5d5e4"/>
                        <path d="M 700 130 L 740 130 L 745 140 L 740 150 L 735 155 L 725 155 L 715 150 L 705 145 L 700 135 Z" fill="#b5d5e4"/>
                        <path d="M 760 140 L 790 140 L 795 150 L 790 160 L 785 165 L 775 165 L 765 160 L 760 150 Z" fill="#b5d5e4"/>
                        <path d="M 620 190 L 680 190 L 685 200 L 680 210 L 675 215 L 665 215 L 655 210 L 645 205 L 635 200 L 625 195 L 620 192 Z" fill="#b5d5e4"/>
                        <path d="M 580 180 L 620 180 L 625 190 L 620 200 L 615 205 L 605 205 L 595 200 L 585 195 L 580 185 Z" fill="#b5d5e4"/>
                        
                        <!-- Florida -->
                        <path d="M 740 400 L 760 400 L 780 410 L 800 420 L 820 430 L 840 440 L 850 450 L 860 460 L 870 470 L 865 480 L 860 485 L 850 485 L 840 480 L 830 475 L 820 470 L 810 465 L 800 460 L 790 455 L 780 450 L 770 445 L 760 440 L 750 435 L 745 425 L 740 415 L 740 405 Z"/>
                        
                        <!-- Texas coastline -->
                        <path d="M 420 380 L 450 380 L 480 385 L 510 390 L 540 395 L 570 400 L 600 405 L 630 410 L 620 420 L 610 430 L 600 440 L 590 450 L 580 460 L 570 470 L 560 475 L 550 470 L 540 465 L 530 460 L 520 455 L 510 450 L 500 445 L 490 440 L 480 435 L 470 430 L 460 425 L 450 420 L 440 415 L 430 410 L 420 405 L 415 395 L 420 385 Z"/>
                        
                        <!-- California coastline -->
                        <path d="M 160 100 L 165 110 L 170 120 L 175 130 L 180 140 L 185 150 L 190 160 L 195 170 L 200 180 L 205 190 L 210 200 L 215 210 L 220 220 L 225 230 L 230 240 L 235 250 L 240 260 L 245 270 L 250 280 L 255 290 L 260 300 L 265 310 L 270 320 L 275 330 L 280 340 L 285 350 L 290 360 L 295 370 L 300 380 L 305 390 L 310 400 L 315 410 L 320 420 L 325 430 L 320 435 L 315 430 L 310 425 L 305 420 L 300 415 L 295 410 L 290 405 L 285 400 L 280 395 L 275 390 L 270 385 L 265 380 L 260 375 L 255 370 L 250 365 L 245 360 L 240 355 L 235 350 L 230 345 L 225 340 L 220 335 L 215 330 L 210 325 L 205 320 L 200 315 L 195 310 L 190 305 L 185 300 L 180 295 L 175 290 L 170 285 L 165 280 L 160 275 L 155 270 L 150 265 L 145 260 L 140 255 L 135 250 L 130 245 L 125 240 L 120 235 L 115 230 L 110 225 L 105 220 L 100 215 L 95 210 L 90 205 L 85 200 L 80 195 L 75 190 L 70 185 L 65 180 L 60 175 L 55 170 L 50 165 L 45 160 L 40 155 L 35 150 L 30 145 L 25 140 L 20 135 L 15 130 L 10 125 L 15 120 L 20 115 L 25 110 L 30 105 L 35 100 L 40 95 L 45 90 L 50 85 L 55 80 L 60 75 L 65 70 L 70 65 L 75 60 L 80 55 L 85 50 L 90 45 L 95 40 L 100 35 L 105 30 L 110 25 L 115 20 L 120 25 L 125 30 L 130 35 L 135 40 L 140 45 L 145 50 L 150 55 L 155 60 L 160 65 L 165 70 L 170 75 L 175 80 L 180 85 L 185 90 L 190 95 L 165 100 Z"/>
                        
                        <!-- Alaska -->
                        <path d="M 80 380 L 180 380 L 185 390 L 180 400 L 175 410 L 170 420 L 165 430 L 160 440 L 155 450 L 150 460 L 145 470 L 140 480 L 135 485 L 130 480 L 125 475 L 120 470 L 115 465 L 110 460 L 105 455 L 100 450 L 95 445 L 90 440 L 85 435 L 80 430 L 75 425 L 70 420 L 65 415 L 60 410 L 55 405 L 50 400 L 45 395 L 40 390 L 35 385 L 30 380 L 35 375 L 40 370 L 45 365 L 50 360 L 55 355 L 60 350 L 65 345 L 70 340 L 75 345 L 80 350 L 85 355 L 90 360 L 95 365 L 100 370 L 105 375 Z"/>
                        
                        <!-- Hawaii -->
                        <circle cx="220" cy="420" r="4" fill="#ffffff"/>
                        <circle cx="230" cy="425" r="3" fill="#ffffff"/>
                        <circle cx="240" cy="430" r="2" fill="#ffffff"/>
                      </g>
                      
                      <!-- State boundaries -->
                      <g stroke="#c0c5c8" stroke-width="0.5" fill="none">
                        <!-- Major state boundary lines -->
                        <line x1="320" y1="100" x2="320" y2="380"/>
                        <line x1="420" y1="100" x2="420" y2="380"/>
                        <line x1="520" y1="100" x2="520" y2="350"/>
                        <line x1="620" y1="120" x2="620" y2="380"/>
                        <line x1="720" y1="130" x2="720" y2="400"/>
                        <line x1="200" y1="180" x2="800" y2="180"/>
                        <line x1="220" y1="280" x2="750" y2="280"/>
                        <line x1="320" y1="200" x2="720" y2="200"/>
                        <line x1="320" y1="320" x2="620" y2="320"/>
                      </g>
                      
                      <!-- State labels -->
                      <g fill="#666666" font-family="Arial, sans-serif" font-size="9" text-anchor="middle">
                        <text x="110" y="120">WA</text>
                        <text x="110" y="180">OR</text>
                        <text x="200" y="250">CA</text>
                        <text x="270" y="200">NV</text>
                        <text x="270" y="140">ID</text>
                        <text x="370" y="140">MT</text>
                        <text x="370" y="190">WY</text>
                        <text x="270" y="240">UT</text>
                        <text x="370" y="240">CO</text>
                        <text x="270" y="320">AZ</text>
                        <text x="370" y="320">NM</text>
                        <text x="470" y="140">ND</text>
                        <text x="470" y="190">SD</text>
                        <text x="470" y="240">NE</text>
                        <text x="470" y="290">KS</text>
                        <text x="520" y="340">OK</text>
                        <text x="520" y="400">TX</text>
                        <text x="570" y="150">MN</text>
                        <text x="570" y="210">IA</text>
                        <text x="570" y="270">MO</text>
                        <text x="570" y="330">AR</text>
                        <text x="570" y="380">LA</text>
                        <text x="620" y="150">WI</text>
                        <text x="620" y="210">IL</text>
                        <text x="620" y="270">IN</text>
                        <text x="620" y="330">MS</text>
                        <text x="670" y="160">MI</text>
                        <text x="670" y="210">OH</text>
                        <text x="670" y="270">KY</text>
                        <text x="670" y="320">TN</text>
                        <text x="670" y="360">AL</text>
                        <text x="720" y="200">PA</text>
                        <text x="720" y="240">WV</text>
                        <text x="720" y="280">VA</text>
                        <text x="720" y="320">NC</text>
                        <text x="720" y="360">SC</text>
                        <text x="720" y="400">GA</text>
                        <text x="800" y="440">FL</text>
                        <text x="770" y="160">NY</text>
                        <text x="820" y="160">VT</text>
                        <text x="840" y="160">NH</text>
                        <text x="860" y="140">ME</text>
                        <text x="840" y="200">MA</text>
                        <text x="860" y="210">RI</text>
                        <text x="840" y="220">CT</text>
                        <text x="780" y="220">NJ</text>
                        <text x="800" y="240">DE</text>
                        <text x="780" y="240">MD</text>
                        <text x="130" y="420">AK</text>
                        <text x="235" y="440">HI</text>
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