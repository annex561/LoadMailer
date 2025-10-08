import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation, Zap, Clock, Send, Truck } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon paths issue
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

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
  const [, setLocation] = useLocation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  
  // Fetch real-time driver locations
  const { data: response, isLoading } = useQuery<LocationsResponse>({
    queryKey: ["/api/driver-locations/active"],
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const locations = response?.locations || [];
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  
  const formatSpeed = (speed?: number) => speed ? `${speed.toFixed(0)} mph` : "0 mph";
  const formatBattery = (level?: number) => level ? `${Math.round(level)}%` : "100%";

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Create map centered on Tennessee/Southeast US
    const map = L.map(mapContainerRef.current, {
      center: [35.5175, -86.5804], // Tennessee center
      zoom: 7,
      zoomControl: true
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers when locations change
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => {
      mapRef.current!.removeLayer(marker);
    });
    markersRef.current.clear();

    // Add new markers for each driver
    locations.forEach(location => {
      // Create custom icon for moving trucks
      const iconHtml = `
        <div style="background: ${location.isMoving ? '#2563eb' : '#6b7280'}; 
                    width: 36px; height: 36px; 
                    border-radius: 50%; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center;
                    border: 2px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
            <path d="M1 3h15v13H1z"></path>
            <path d="M16 8h4l3 3v5h-7V8z"></path>
            <circle cx="5.5" cy="18.5" r="2.5"></circle>
            <circle cx="18.5" cy="18.5" r="2.5"></circle>
          </svg>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
        className: 'custom-driver-icon'
      });

      const marker = L.marker([location.latitude, location.longitude], {
        icon: customIcon,
        title: location.driverName
      });

      // Create popup content
      const popupContent = `
        <div style="min-width: 250px; padding: 8px;">
          <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #1f2937;">
            ${location.driverName}
          </h3>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 14px;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="color: #6b7280;">📍</span>
              <span>${location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}</span>
            </div>
            <div style="display: flex; gap: 12px;">
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="color: #2563eb;">⚡</span>
                ${formatSpeed(location.speed)}
              </span>
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="color: #10b981;">🔋</span>
                ${formatBattery(location.batteryLevel)}
              </span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="padding: 2px 8px; border-radius: 4px; font-size: 12px; 
                         background: ${location.isMoving ? '#dbeafe' : '#f3f4f6'}; 
                         color: ${location.isMoving ? '#1e40af' : '#6b7280'};">
                ${location.isMoving ? '🚚 Moving' : '⏸️ Stopped'}
              </span>
              <span style="color: #9ca3af; font-size: 12px;">
                ${new Date(location.lastUpdate).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
              </span>
            </div>
            ${location.routeName ? `
              <div style="color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 6px; margin-top: 4px;">
                Route: ${location.routeName}
              </div>
            ` : ''}
            <button onclick="window.sendLoadToDriver('${location.driverId}', '${location.driverName}')"
                    style="width: 100%; padding: 6px; margin-top: 8px; 
                           background: #2563eb; color: white; 
                           border: none; border-radius: 4px; 
                           cursor: pointer; font-size: 14px;">
              📦 Send Load to Driver
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, {
        maxWidth: 300,
        closeButton: true
      });

      marker.on('click', () => {
        setSelectedDriver(location.driverId);
      });

      marker.addTo(mapRef.current!);
      markersRef.current.set(location.driverId, marker);
    });

    // Auto-fit map to show all drivers if there are locations
    if (locations.length > 0 && mapRef.current) {
      const bounds = L.latLngBounds(
        locations.map(loc => [loc.latitude, loc.longitude])
      );
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [locations]);

  // Add global function for sending loads to drivers
  useEffect(() => {
    (window as any).sendLoadToDriver = (driverId: string, driverName: string) => {
      // Navigate to load management with driver pre-selected
      setLocation(`/load-management?assignTo=${driverId}&driverName=${encodeURIComponent(driverName)}`);
    };

    return () => {
      delete (window as any).sendLoadToDriver;
    };
  }, [setLocation]);

  if (isLoading) {
    return (
      <Card data-testid="card-driver-map">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Real-Time Driver Locations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-96 bg-gray-200 rounded-lg"></div>
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
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {locations.length} Active
            </Badge>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setLocation('/gps-tracking')}
              data-testid="button-view-gps-details"
            >
              <Navigation className="w-4 h-4 mr-1" />
              GPS Details
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {locations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground" data-testid="text-no-driver-locations">
            <Truck className="mx-auto h-12 w-12 mb-4" />
            <p className="font-semibold">No Active Driver Locations</p>
            <p className="text-sm mt-2">Driver locations will appear here when they're online</p>
            <Button 
              className="mt-4" 
              variant="outline" 
              size="sm"
              onClick={() => setLocation('/drivers')}
            >
              Manage Drivers
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Interactive Leaflet Map */}
            <div 
              ref={mapContainerRef}
              className="h-[500px] rounded-lg border-2 border-gray-200 relative z-10"
              data-testid="leaflet-map-container"
            />
            
            {/* Driver List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {locations.map(location => (
                <div 
                  key={location.driverId}
                  className={`p-3 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                    selectedDriver === location.driverId ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  onClick={() => {
                    setSelectedDriver(location.driverId);
                    // Open marker popup on map
                    const marker = markersRef.current.get(location.driverId);
                    if (marker && mapRef.current) {
                      marker.openPopup();
                      mapRef.current.setView([location.latitude, location.longitude], 12);
                    }
                  }}
                  data-testid={`driver-card-${location.driverId}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{location.driverName}</span>
                    <Badge 
                      variant={location.isMoving ? "default" : "secondary"} 
                      className="text-xs"
                    >
                      {location.isMoving ? 'Moving' : 'Stopped'}
                    </Badge>
                  </div>
                  <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">
                        {location.address || `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Navigation className="w-3 h-3 text-blue-500" />
                        {formatSpeed(location.speed)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-green-500" />
                        {formatBattery(location.batteryLevel)}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation(`/load-management?assignTo=${location.driverId}&driverName=${encodeURIComponent(location.driverName)}`);
                    }}
                    data-testid={`button-send-load-${location.driverId}`}
                  >
                    <Send className="w-3 h-3 mr-1" />
                    Send Load
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}