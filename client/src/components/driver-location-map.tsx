import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation, Zap, Clock, Send, Truck } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";

declare global {
  interface Window {
    L: any;
    initializeMap?: () => void;
  }
}

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
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const initAttemptedRef = useRef(false);
  
  // Fetch real-time driver locations
  const { data: response, isLoading } = useQuery<LocationsResponse>({
    queryKey: ["/api/driver-locations/active"],
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const locations = response?.locations || [];
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  
  const formatSpeed = (speed?: number) => speed ? `${speed.toFixed(0)} mph` : "0 mph";
  const formatBattery = (level?: number) => level ? `${Math.round(level)}%` : "100%";

  // Initialize map with retry logic
  const initializeMap = useCallback(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    // Ensure container has dimensions
    const container = mapContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) {
      console.log("Map container has no dimensions, retrying...");
      setTimeout(() => initializeMap(), 100);
      return;
    }

    if (!window.L) {
      console.log("Leaflet not loaded yet, retrying...");
      setTimeout(() => initializeMap(), 100);
      return;
    }

    try {
      console.log("Creating Leaflet map with dimensions:", rect.width, "x", rect.height);
      
      // Create map with simple configuration
      const map = window.L.map(container, {
        center: [35.5175, -86.5804],
        zoom: 7,
        scrollWheelZoom: true,
        zoomControl: true
      });
      
      // Add tile layer with proper attribution
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
        minZoom: 3
      }).addTo(map);
      
      mapRef.current = map;
      setMapReady(true);
      console.log("Map created successfully");
      
      // Trigger resize after initialization
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
          console.log("Map resized successfully");
        }
      }, 100);
      
    } catch (error) {
      console.error("Failed to initialize map:", error);
      // Retry on error
      setTimeout(() => initializeMap(), 500);
    }
  }, []);

  // Load Leaflet library
  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    // Check if Leaflet is already loaded
    if (window.L) {
      console.log("Leaflet already available");
      // Delay initialization to ensure DOM is ready
      setTimeout(() => initializeMap(), 50);
      return;
    }

    // Add Leaflet CSS
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(cssLink);

    // Add Leaflet JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    
    script.onload = () => {
      console.log("Leaflet loaded via script tag");
      
      if (window.L) {
        // Fix default marker icons
        delete (window.L.Icon.Default.prototype as any)._getIconUrl;
        window.L.Icon.Default.mergeOptions({
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });
        
        // Delay initialization to ensure DOM is ready
        setTimeout(() => initializeMap(), 50);
      }
    };
    
    script.onerror = () => {
      console.error("Failed to load Leaflet script");
    };
    
    document.head.appendChild(script);
    
    // Set global function for re-initialization if needed
    window.initializeMap = initializeMap;
    
    return () => {
      // Cleanup on unmount
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
          setMapReady(false);
        } catch (e) {
          console.error("Error removing map:", e);
        }
      }
    };
  }, [initializeMap]);

  // Trigger map initialization when container becomes visible
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !mapRef.current) {
            console.log("Map container is visible, initializing...");
            initializeMap();
          }
        });
      },
      { threshold: 0.1 }
    );
    
    observer.observe(mapContainerRef.current);
    
    return () => {
      observer.disconnect();
    };
  }, [initializeMap, locations.length]);

  // Update markers when locations change
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;

    try {
      // Clear existing markers
      markersRef.current.forEach(marker => {
        mapRef.current.removeLayer(marker);
      });
      markersRef.current.clear();

      // Add new markers
      locations.forEach(location => {
        const marker = window.L.marker([location.latitude, location.longitude], {
          title: location.driverName
        });

        // Create popup content
        const popupHtml = `
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; font-weight: bold;">${location.driverName}</h3>
            <p style="margin: 5px 0;">
              <strong>Location:</strong><br/>
              ${location.address || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`}
            </p>
            <p style="margin: 5px 0;">
              <strong>Speed:</strong> ${formatSpeed(location.speed)}<br/>
              <strong>Battery:</strong> ${formatBattery(location.batteryLevel)}<br/>
              <strong>Status:</strong> ${location.isMoving ? 'Moving' : 'Stopped'}
            </p>
            <p style="margin: 5px 0; font-size: 0.9em; color: #666;">
              Last update: ${new Date(location.lastUpdate).toLocaleTimeString()}
            </p>
          </div>
        `;

        marker.bindPopup(popupHtml);
        marker.addTo(mapRef.current);
        markersRef.current.set(location.driverId, marker);
      });

      // Fit map bounds if we have locations
      if (locations.length > 0) {
        const bounds = window.L.latLngBounds(
          locations.map(loc => [loc.latitude, loc.longitude])
        );
        mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
      }
      
      console.log(`Map updated with ${locations.length} markers`);
    } catch (error) {
      console.error("Error updating markers:", error);
    }
  }, [locations, mapReady]);

  // Handle send load to driver
  useEffect(() => {
    (window as any).sendLoadToDriver = (driverId: string, driverName: string) => {
      setLocation(`/load-management?assignTo=${driverId}&driverName=${encodeURIComponent(driverName)}`);
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
            <Badge variant="secondary" data-testid="text-location-count">
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
            {/* Map Container */}
            <div 
              ref={mapContainerRef}
              id="driver-map"
              className="w-full h-[500px] rounded-lg border border-gray-300 bg-gray-50 relative"
              data-testid="leaflet-map-container"
              style={{ 
                position: 'relative',
                zIndex: 1,
                minHeight: '500px'
              }}
            >
              {!mapReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <MapPin className="h-8 w-8 text-gray-400 mx-auto mb-2 animate-pulse" />
                    <p className="text-sm text-gray-500">Loading map...</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Driver Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {locations.map(location => (
                <div 
                  key={location.driverId}
                  className={`p-3 border rounded-lg cursor-pointer transition-all hover:shadow-md ${
                    selectedDriver === location.driverId ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                  onClick={() => {
                    setSelectedDriver(location.driverId);
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