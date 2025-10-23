import { storage } from "./storage";
import type { Driver } from "@shared/schema";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { reverseGeocode } from "./geocoding-service";

// Real Tennessee area coordinates for authentic location simulation
const TENNESSEE_LOCATIONS = [
  // Nashville area
  { lat: 36.1627, lng: -86.7816, city: "Nashville, TN" },
  { lat: 36.0686, lng: -86.6831, city: "Brentwood, TN" },
  { lat: 36.1317, lng: -86.6478, city: "Hermitage, TN" },
  
  // Memphis area
  { lat: 35.1495, lng: -90.0490, city: "Memphis, TN" },
  { lat: 35.0428, lng: -89.8773, city: "Southaven, MS" },
  { lat: 35.2448, lng: -89.8681, city: "Bartlett, TN" },
  
  // Knoxville area
  { lat: 35.9606, lng: -83.9207, city: "Knoxville, TN" },
  { lat: 35.9097, lng: -84.0467, city: "Oak Ridge, TN" },
  { lat: 35.8314, lng: -83.9152, city: "Sevierville, TN" },
  
  // Chattanooga area
  { lat: 35.0457, lng: -85.3097, city: "Chattanooga, TN" },
  { lat: 34.9698, lng: -85.2685, city: "East Ridge, TN" },
  { lat: 35.0951, lng: -85.2683, city: "Red Bank, TN" },
  
  // Clarksville area
  { lat: 36.5298, lng: -87.3595, city: "Clarksville, TN" },
  { lat: 36.4784, lng: -87.5047, city: "Fort Campbell, KY" },
  
  // Jackson area
  { lat: 35.6145, lng: -88.8140, city: "Jackson, TN" },
  
  // Highway routes (I-40, I-75, I-65, I-24)
  { lat: 36.0772, lng: -87.2711, city: "Dickson, TN (I-40)" },
  { lat: 35.7717, lng: -84.3467, city: "Crossville, TN (I-40)" },
  { lat: 36.3134, lng: -86.3644, city: "Goodlettsville, TN (I-65)" },
  { lat: 35.6890, lng: -84.7524, city: "Sparta, TN (I-40)" },
];

// Interstate highways and major routes in Tennessee
const HIGHWAY_ROUTES = [
  {
    name: "I-40 East",
    points: [
      { lat: 35.1495, lng: -90.0490 }, // Memphis
      { lat: 35.6145, lng: -88.8140 }, // Jackson
      { lat: 36.1627, lng: -86.7816 }, // Nashville
      { lat: 35.7717, lng: -84.3467 }, // Crossville
      { lat: 35.9606, lng: -83.9207 }, // Knoxville
    ]
  },
  {
    name: "I-65 North",
    points: [
      { lat: 35.0457, lng: -85.3097 }, // Chattanooga
      { lat: 36.1627, lng: -86.7816 }, // Nashville
      { lat: 36.5298, lng: -87.3595 }, // Clarksville
    ]
  },
  {
    name: "I-75 North",
    points: [
      { lat: 35.0457, lng: -85.3097 }, // Chattanooga
      { lat: 35.9606, lng: -83.9207 }, // Knoxville
    ]
  },
  {
    name: "I-24 West",
    points: [
      { lat: 35.0457, lng: -85.3097 }, // Chattanooga
      { lat: 36.1627, lng: -86.7816 }, // Nashville
      { lat: 36.5298, lng: -87.3595 }, // Clarksville
    ]
  }
];

interface DriverLocationState {
  driverId: string;
  currentLat: number;
  currentLng: number;
  targetLat: number;
  targetLng: number;
  speed: number; // mph
  heading: number; // degrees
  routeName: string;
  routeProgress: number; // 0-1
  lastUpdate: Date;
  isMoving: boolean;
  batteryLevel: number;
}

export class RealDriverLocationService {
  private driverStates = new Map<string, DriverLocationState>();
  private isRunning = false;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    console.log('🚚 Initializing Real Driver Location Service...');
  }

  async initialize(): Promise<void> {
    try {
      console.log('🚚 Loading active drivers for location tracking...');
      const drivers = await storage.getDrivers();
      
      // Initialize location states for ALL available drivers (regardless of Telegram status)
      for (const driver of drivers) {
        if (driver.status === 'available' || driver.status === 'on_route') {
          await this.initializeDriverLocation(driver);
          console.log(`🚚 Auto-tracking GPS for driver: ${driver.name} (${driver.city})`);
        }
      }

      // Start real-time location updates every 30 seconds
      this.startLocationUpdates();
      
      this.isRunning = true;
      console.log(`🚚 Real Driver Location Service initialized with ${this.driverStates.size} active drivers`);
    } catch (error) {
      console.error('❌ Error initializing Real Driver Location Service:', error);
    }
  }

  private async initializeDriverLocation(driver: Driver): Promise<void> {
    // Check if driver has a recent location
    let currentLocation = await this.getDriverCurrentLocation(driver.id);
    
    // If driver has real GPS data, don't overwrite it with simulated location
    if (currentLocation && currentLocation.source === 'gps') {
      console.log(`🔒 Driver ${driver.name} has real GPS tracking active - skipping simulation initialization`);
      
      // Still create state but use real GPS coordinates
      const state: DriverLocationState = {
        driverId: driver.id,
        currentLat: currentLocation.lat,
        currentLng: currentLocation.lng,
        targetLat: currentLocation.lat,
        targetLng: currentLocation.lng,
        speed: 0, // Don't simulate movement
        heading: 0,
        routeName: 'Real GPS',
        routeProgress: 0,
        lastUpdate: new Date(),
        isMoving: false, // Don't move driver with real GPS
        batteryLevel: 80 + Math.random() * 20
      };
      this.driverStates.set(driver.id, state);
      return;
    }
    
    // If no recent location, assign a random Tennessee location
    if (!currentLocation) {
      const randomLocation = TENNESSEE_LOCATIONS[Math.floor(Math.random() * TENNESSEE_LOCATIONS.length)];
      currentLocation = {
        lat: randomLocation.lat + (Math.random() - 0.5) * 0.02, // Add small random offset
        lng: randomLocation.lng + (Math.random() - 0.5) * 0.02,
        address: randomLocation.city
      };
      
      // Save initial location to database
      await this.updateDriverLocation(driver.id, currentLocation.lat, currentLocation.lng, currentLocation.address);
    }

    // Assign a route based on driver status
    const route = this.assignDriverRoute(driver);
    const routePoint = Math.floor(Math.random() * route.points.length);
    const targetPoint = route.points[routePoint];

    const state: DriverLocationState = {
      driverId: driver.id,
      currentLat: currentLocation.lat,
      currentLng: currentLocation.lng,
      targetLat: targetPoint.lat,
      targetLng: targetPoint.lng,
      speed: driver.status === 'on_route' ? 55 + Math.random() * 10 : 0, // 55-65 mph if on route
      heading: Math.random() * 360,
      routeName: route.name,
      routeProgress: Math.random(),
      lastUpdate: new Date(),
      isMoving: driver.status === 'on_route',
      batteryLevel: 80 + Math.random() * 20 // 80-100%
    };

    this.driverStates.set(driver.id, state);
    console.log(`🚚 Initialized location for driver ${driver.name} on ${route.name}`);
  }

  private assignDriverRoute(driver: Driver): typeof HIGHWAY_ROUTES[0] {
    // Assign route based on driver equipment type and status
    if (driver.equipmentType === 'flatbed' || driver.equipmentType === 'step_deck') {
      return HIGHWAY_ROUTES[Math.floor(Math.random() * 2)]; // I-40 or I-65 for heavy equipment
    } else if (driver.equipmentType === 'refrigerated') {
      return HIGHWAY_ROUTES[0]; // I-40 for food transport
    } else {
      return HIGHWAY_ROUTES[Math.floor(Math.random() * HIGHWAY_ROUTES.length)]; // Any route
    }
  }

  private async getDriverCurrentLocation(driverId: string): Promise<{lat: number, lng: number, address?: string, source?: string} | null> {
    try {
      // Get recent locations from database (check last 50 to find any GPS data)
      const locations = await storage.getDriverLocations(driverId, 50);
      if (locations.length === 0) {
        return null;
      }
      
      // PRIORITY 1: Look for real GPS data first (within last 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentGpsLocation = locations.find(loc => {
        if (loc.source !== 'gps') return false;
        
        // Parse Postgres timestamp format (YYYY-MM-DD HH:MM:SS) to JavaScript Date
        const timestamp = typeof loc.timestamp === 'string' 
          ? new Date(loc.timestamp.replace(' ', 'T') + 'Z') // Convert to ISO format
          : new Date(loc.timestamp);
        
        return timestamp > tenMinutesAgo;
      });
      
      if (recentGpsLocation) {
        return {
          lat: recentGpsLocation.latitude,
          lng: recentGpsLocation.longitude,
          address: recentGpsLocation.address || undefined,
          source: 'gps'
        };
      }
      
      // PRIORITY 2: Fall back to most recent location if no GPS data
      const location = locations[0];
      return {
        lat: location.latitude,
        lng: location.longitude,
        address: location.address || undefined,
        source: location.source || 'simulated'
      };
    } catch (error) {
      console.error(`Error getting current location for driver ${driverId}:`, error);
      return null;
    }
  }

  private startLocationUpdates(): void {
    // Update driver locations every 15 seconds for more frequent tracking
    this.updateInterval = setInterval(async () => {
      await this.updateAllDriverLocations();
    }, 15000);

    // Also run cleanup and route assignment every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.refreshDriverStates();
    });

    console.log('🚚 Started real-time location updates (15-second intervals)');
  }

  private async updateAllDriverLocations(): Promise<void> {
    const updatePromises = Array.from(this.driverStates.entries()).map(([driverId, state]) => 
      this.updateDriverPosition(driverId, state)
    );

    await Promise.all(updatePromises);
  }

  private async updateDriverPosition(driverId: string, state: DriverLocationState): Promise<void> {
    try {
      // Check if driver has switched to real GPS tracking - if so, skip simulation
      const currentLocation = await this.getDriverCurrentLocation(driverId);
      if (currentLocation && currentLocation.source === 'gps') {
        console.log(`🔒 Driver ${driverId} is now using real GPS - stopping simulation`);
        state.isMoving = false; // Stop simulated movement
        return;
      }

      if (state.isMoving) {
        // Calculate movement towards target
        const latDiff = state.targetLat - state.currentLat;
        const lngDiff = state.targetLng - state.currentLng;
        const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

        if (distance > 0.001) { // Still moving towards target
          // Move towards target (speed converted to degrees per update)
          const moveDistance = (state.speed * 0.00014) * 0.5; // Approximate movement per 30-second update
          const moveLat = state.currentLat + (latDiff / distance) * moveDistance;
          const moveLng = state.currentLng + (lngDiff / distance) * moveDistance;

          state.currentLat = moveLat;
          state.currentLng = moveLng;
          state.heading = Math.atan2(lngDiff, latDiff) * 180 / Math.PI;
        } else {
          // Reached target, assign new target
          const route = HIGHWAY_ROUTES.find(r => r.name === state.routeName) || HIGHWAY_ROUTES[0];
          const newTargetIndex = Math.floor(Math.random() * route.points.length);
          const newTarget = route.points[newTargetIndex];
          state.targetLat = newTarget.lat;
          state.targetLng = newTarget.lng;
        }

        // Add small random variation for realism
        state.currentLat += (Math.random() - 0.5) * 0.0001;
        state.currentLng += (Math.random() - 0.5) * 0.0001;
        state.speed = 50 + Math.random() * 20; // Vary speed 50-70 mph
      }

      // Decrease battery gradually
      state.batteryLevel = Math.max(20, state.batteryLevel - Math.random() * 0.5);
      state.lastUpdate = new Date();

      // Save to database
      const address = await this.getAddressFromCoords(state.currentLat, state.currentLng);
      await this.updateDriverLocation(driverId, state.currentLat, state.currentLng, address);

      this.driverStates.set(driverId, state);
    } catch (error) {
      console.error(`Error updating position for driver ${driverId}:`, error);
    }
  }

  private async updateDriverLocation(driverId: string, lat: number, lng: number, address?: string): Promise<void> {
    try {
      await storage.createDriverLocation({
        driverId,
        latitude: lat,
        longitude: lng,
        altitude: 300 + Math.random() * 200, // Elevation in feet
        accuracy: 3 + Math.random() * 2, // GPS accuracy in meters
        speed: this.driverStates.get(driverId)?.speed || 0,
        heading: this.driverStates.get(driverId)?.heading || 0,
        timestamp: new Date(),
        address: address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        batteryLevel: Math.floor(this.driverStates.get(driverId)?.batteryLevel || 90),
        signalStrength: Math.floor(80 + Math.random() * 20), // Signal strength 80-100%
        isActive: true,
        source: 'simulated' // Mark as simulated data
      });

      // Deactivate old locations
      await this.deactivateOldLocations(driverId);
    } catch (error) {
      console.error(`Error saving location for driver ${driverId}:`, error);
    }
  }

  private async deactivateOldLocations(driverId: string): Promise<void> {
    try {
      const locations = await storage.getDriverLocations(driverId, 50);
      // Only deactivate old SIMULATED locations - preserve real GPS data
      const updatePromises = locations.slice(1)
        .filter(location => location.source !== 'gps') // Never deactivate real GPS data
        .map(location => 
          storage.updateDriverLocation(location.id, { isActive: false })
        );
      await Promise.all(updatePromises);
    } catch (error) {
      console.error(`Error deactivating old locations for driver ${driverId}:`, error);
    }
  }

  private async getAddressFromCoords(lat: number, lng: number): Promise<string> {
    // Use the shared geocoding service for reverse geocoding
    return await reverseGeocode(lat, lng);
  }

  private async refreshDriverStates(): Promise<void> {
    try {
      console.log('🚚 Refreshing driver location states...');
      const drivers = await storage.getDrivers();
      
      // Add new active drivers
      for (const driver of drivers) {
        if ((driver.status === 'available' || driver.status === 'on_route') && 
            !this.driverStates.has(driver.id)) {
          await this.initializeDriverLocation(driver);
        }
      }

      // Remove inactive drivers
      const activeDriverIds = new Set(drivers
        .filter(d => d.status === 'available' || d.status === 'on_route')
        .map(d => d.id));
      
      for (const driverId of this.driverStates.keys()) {
        if (!activeDriverIds.has(driverId)) {
          this.driverStates.delete(driverId);
          console.log(`🚚 Removed inactive driver ${driverId} from location tracking`);
        }
      }

      // Update movement status based on driver status
      for (const driver of drivers) {
        const state = this.driverStates.get(driver.id);
        if (state) {
          state.isMoving = driver.status === 'on_route';
          state.speed = driver.status === 'on_route' ? 55 + Math.random() * 10 : 0;
        }
      }

      console.log(`🚚 Driver location refresh complete. Tracking ${this.driverStates.size} drivers`);
    } catch (error) {
      console.error('❌ Error refreshing driver states:', error);
    }
  }

  async getActiveDriverLocations(): Promise<Array<{
    driverId: string;
    driverName?: string;
    latitude: number;
    longitude: number;
    speed: number;
    heading: number;
    address: string;
    lastUpdate: Date;
    isMoving: boolean;
    batteryLevel: number;
    routeName: string;
  }>> {
    try {
      const result = [];
      const drivers = await storage.getDrivers();
      const driverMap = new Map(drivers.map(d => [d.id, d]));

      for (const [driverId, state] of this.driverStates.entries()) {
        const driver = driverMap.get(driverId);
        const address = await this.getAddressFromCoords(state.currentLat, state.currentLng);
        
        result.push({
          driverId,
          driverName: driver?.name,
          latitude: state.currentLat,
          longitude: state.currentLng,
          speed: state.speed,
          heading: state.heading,
          address,
          lastUpdate: state.lastUpdate,
          isMoving: state.isMoving,
          batteryLevel: state.batteryLevel,
          routeName: state.routeName
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Error getting active driver locations:', error);
      return [];
    }
  }

  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isRunning = false;
    this.driverStates.clear();
    console.log('🚚 Real Driver Location Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  getTrackedDriverCount(): number {
    return this.driverStates.size;
  }
}

// Export singleton instance
export const realDriverLocationService = new RealDriverLocationService();