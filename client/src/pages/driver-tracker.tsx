import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Truck, Navigation, Clock, Power, Wifi, WifiOff, MapPin, RefreshCw } from 'lucide-react';
import { queryClient } from '@/lib/queryClient';

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface LocationData {
  lat: number;
  lon: number;
  timestamp: Date;
}

export default function DriverTracker() {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState('Starting GPS...');
  const [lastUpdate, setLastUpdate] = useState<string>('—');
  const [updateCount, setUpdateCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [isUpdatingManually, setIsUpdatingManually] = useState(false);

  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const watchIdRef = useRef<number | null>(null);   // watchPosition ID
  const intervalRef = useRef<NodeJS.Timeout | null>(null); // fallback 30s ping

  // Get driver ID and tracking token from URL parameters or path
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const driver = params.get('driver');
    const token = params.get('token');
    
    // Check for /driver/tracking/:loadId format
    const pathMatch = window.location.pathname.match(/\/driver\/tracking\/([^/]+)/);
    const loadIdFromPath = pathMatch ? pathMatch[1] : null;
    
    if (loadIdFromPath) {
      // Fetch load details to get driver info
      fetch(`/api/loads/${loadIdFromPath}`)
        .then(res => res.json())
        .then(load => {
          if (load && load.driverId) {
            setDriverId(String(load.driverId));
            // Generate a simple token from load ID for tracking auth
            setTrackingToken(`load-${loadIdFromPath}`);
            setStatus('Ready to start tracking');
          } else {
            setStatus('❌ No driver assigned to this load yet.');
          }
        })
        .catch(() => {
          setStatus('❌ Failed to load tracking info. Please try again.');
        });
      return;
    }
    
    // Fallback to query params
    if (!driver) {
      setStatus('❌ No driver ID provided. Please use the link from your dashboard.');
      return;
    }
    
    if (!token) {
      setStatus('❌ No tracking token provided. Please start tracking from your dashboard.');
      return;
    }
    
    setDriverId(driver);
    setTrackingToken(token);
    setStatus('Ready to start tracking');
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Default center: Nashville, TN
    const defaultCenter: [number, number] = [36.1627, -86.7816];
    
    const map = L.map(mapContainerRef.current).setView(defaultCenter, 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    
    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update map when location changes
  useEffect(() => {
    if (!mapRef.current || !location) return;

    const latLng: [number, number] = [location.lat, location.lon];

    if (!markerRef.current) {
      markerRef.current = L.marker(latLng).addTo(mapRef.current);
      markerRef.current.bindPopup(
        `<div>
          <strong>Current Location</strong><br />
          Lat: ${location.lat.toFixed(6)}<br />
          Lon: ${location.lon.toFixed(6)}<br />
          ${location.timestamp.toLocaleTimeString()}
        </div>`
      );
    } else {
      markerRef.current.setLatLng(latLng);
      markerRef.current.setPopupContent(
        `<div>
          <strong>Current Location</strong><br />
          Lat: ${location.lat.toFixed(6)}<br />
          Lon: ${location.lon.toFixed(6)}<br />
          ${location.timestamp.toLocaleTimeString()}
        </div>`
      );
    }

    mapRef.current.setView(latLng);
  }, [location]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Request wake lock to keep screen on
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        const lock = await navigator.wakeLock.request('screen');
        setWakeLock(lock);
        console.log('Wake lock acquired');
        
        lock.addEventListener('release', () => {
          console.log('Wake lock released');
        });
      }
    } catch (err) {
      console.warn('Wake lock not supported or denied:', err);
    }
  };

  // Send location to server with authentication token
  const sendLocation = async (lat: number, lon: number, positionData?: GeolocationPosition): Promise<boolean> => {
    if (!driverId) {
      setStatus('❌ No driver ID');
      return false;
    }

    if (!trackingToken) {
      setStatus('❌ No tracking token. Please restart from dashboard.');
      return false;
    }

    try {
      // Extract all available GPS metadata from position
      const locationData: any = {
        driverId,
        lat,
        lon,
        timestamp: new Date().toISOString(),
        trackingToken
      };

      // Add optional GPS metadata if available
      if (positionData?.coords) {
        if (positionData.coords.accuracy !== null) locationData.accuracy = positionData.coords.accuracy;
        if (positionData.coords.altitude !== null) locationData.altitude = positionData.coords.altitude;
        if (positionData.coords.speed !== null) locationData.speed = positionData.coords.speed;
        if (positionData.coords.heading !== null) locationData.heading = positionData.coords.heading;
      }

      // Add battery level if available
      if ('getBattery' in navigator) {
        try {
          const battery = await (navigator as any).getBattery();
          if (battery?.level !== undefined) {
            locationData.batteryLevel = Math.round(battery.level * 100);
          }
        } catch (e) {
          // Battery API not available or permission denied
        }
      }

      const response = await fetch('/api/driver-location/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(locationData)
      });

      if (!response.ok) {
        if (response.status === 401) {
          setStatus('🔒 Authentication failed. Please restart tracking from dashboard.');
          stopTracking();
          return false;
        }
        throw new Error('Failed to update location');
      }

      const time = new Date().toLocaleTimeString();
      setStatus(`✓ Location sent (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      setLastUpdate(time);
      
      // Invalidate all driver location queries to sync across the app
      queryClient.invalidateQueries({ queryKey: ['/api/driver-locations/active'] });
      
      return true;
    } catch (err) {
      console.error('Error sending location:', err);
      setStatus('⚠️ Failed to send location');
      return false;
    }
  };

  // Get current position
  const getCurrentPosition = () => {
    if (!navigator.geolocation) {
      setStatus('❌ GPS not supported on this device');
      return;
    }

    setStatus('📍 Getting GPS location...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({
          lat: latitude,
          lon: longitude,
          timestamp: new Date()
        });
        sendLocation(latitude, longitude, position);
      },
      (error) => {
        console.error('GPS error:', error);
        let errorMsg = 'GPS error';
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMsg = '❌ Location permission denied. Please enable GPS access.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMsg = '⚠️ Location unavailable. Check GPS signal.';
            break;
          case error.TIMEOUT:
            errorMsg = '⏱️ GPS timeout. Trying again...';
            break;
        }
        
        setStatus(errorMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  // Start continuous tracking — auto-called when credentials are ready
  const startTracking = async () => {
    if (!driverId || !trackingToken || !navigator.geolocation) return;
    if (isTracking) return; // already running

    setIsTracking(true);
    setStatus('🚛 Tracking active — updating continuously');
    await requestWakeLock();

    // watchPosition fires on every movement AND at device-defined intervals
    // This is far more reliable on mobile than setInterval + getCurrentPosition
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lon: longitude, timestamp: new Date() });
        setUpdateCount(c => c + 1);
        await sendLocation(latitude, longitude, position);
      },
      (error) => {
        console.error('GPS watch error:', error);
        if (error.code === error.PERMISSION_DENIED) {
          setStatus('❌ Location permission denied. Enable GPS in browser settings.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Fallback: also push an update every 30 seconds in case watchPosition
    // goes quiet (e.g. driver parked and not moving)
    intervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setLocation({ lat: latitude, lon: longitude, timestamp: new Date() });
          setUpdateCount(c => c + 1);
          await sendLocation(latitude, longitude, position);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    }, 30000);
  };

  // Stop tracking — only called by driver tapping the Stop button
  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wakeLock) {
      wakeLock.release();
      setWakeLock(null);
    }
    setIsTracking(false);
    setStatus('⏸️ Tracking stopped');
  };

  // Manual ping — sends current position immediately without stopping tracking
  const updateLocationNow = async () => {
    if (!driverId || !trackingToken || !isOnline || !navigator.geolocation) return;

    setIsUpdatingManually(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lon: longitude, timestamp: new Date() });
        setUpdateCount(c => c + 1);
        await sendLocation(latitude, longitude, position);
        setIsUpdatingManually(false);
      },
      () => { setIsUpdatingManually(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Auto-start tracking as soon as credentials are available
  useEffect(() => {
    if (driverId && trackingToken && !isTracking) {
      startTracking();
    }
  }, [driverId, trackingToken]); // eslint-disable-line

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wakeLock) wakeLock.release();
    };
  }, [wakeLock]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Truck className="w-8 h-8 text-teal-400" />
              <div>
                <h1 className="text-xl font-bold text-white">TRAQ IQ GPS Tracker</h1>
                <p className="text-sm text-slate-400">Real-time driver location</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="w-5 h-5 text-green-400" data-testid="icon-online" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-400" data-testid="icon-offline" />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Tracking status banner */}
        <div className={`rounded-xl p-4 flex items-center justify-between ${isTracking ? 'bg-green-900/40 border border-green-500/50' : 'bg-slate-800 border border-slate-700'}`}>
          <div className="flex items-center gap-3">
            {isTracking ? (
              <div className="w-4 h-4 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full bg-slate-600 flex-shrink-0" />
            )}
            <div>
              <p className="font-bold text-white text-sm">
                {isTracking ? '🚛 TRACKING ACTIVE' : '⏸️ Tracking stopped'}
              </p>
              <p className="text-xs text-slate-400">
                {isTracking
                  ? `${updateCount} update${updateCount !== 1 ? 's' : ''} sent · continuous`
                  : 'Tap Start Tracking to resume'}
              </p>
            </div>
          </div>
          {isTracking ? (
            <button
              onClick={stopTracking}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all"
              data-testid="button-stop-auto-tracking"
            >
              <Power className="w-4 h-4" />
              Stop
            </button>
          ) : (
            <button
              onClick={startTracking}
              disabled={!driverId || !isOnline || !trackingToken}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm transition-all"
              data-testid="button-start-auto-tracking"
            >
              <Power className="w-4 h-4" />
              Start Tracking
            </button>
          )}
        </div>

        {/* Manual ping button */}
        <div className="flex justify-center">
          <button
            onClick={updateLocationNow}
            disabled={!driverId || !trackingToken || !isOnline || isUpdatingManually}
            className="flex items-center gap-3 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white px-10 py-5 rounded-xl font-bold text-lg shadow-2xl transition-all transform hover:scale-105 active:scale-95"
            data-testid="button-update-location"
          >
            {isUpdatingManually ? (
              <>
                <RefreshCw className="w-6 h-6 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <MapPin className="w-6 h-6" />
                Ping Location Now
              </>
            )}
          </button>
        </div>

        {/* Map */}
        <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 shadow-xl">
          <div 
            ref={mapContainerRef} 
            className="h-[60vh] min-h-[400px]" 
            data-testid="map-container"
          />
        </div>

        {/* Status Card */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                {isTracking ? (
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" data-testid="status-active" />
                ) : (
                  <div className="w-3 h-3 bg-slate-600 rounded-full" data-testid="status-inactive" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Status</p>
                <p className="text-sm text-slate-300" data-testid="text-status">{status}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-slate-400 mt-1" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Last Update</p>
                <p className="text-sm text-slate-300" data-testid="text-last-update">{lastUpdate}</p>
              </div>
            </div>

            {location && (
              <div className="flex items-start gap-3">
                <Navigation className="w-4 h-4 text-slate-400 mt-1" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Coordinates</p>
                  <p className="text-sm text-slate-300 font-mono">
                    {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>


        {!isOnline && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
            <p className="text-red-400 text-sm text-center">
              ⚠️ No internet connection
            </p>
          </div>
        )}

        {/* Tips */}
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <p className="text-xs text-slate-400 text-center">
            💡 Keep this page open while driving. Tracking runs automatically and stops only when you tap <strong>Stop</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
