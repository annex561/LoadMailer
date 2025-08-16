import { storage } from "./storage";
import type { 
  DriverLocationUpdate, 
  DriverLocation, 
  Geofence, 
  GeofenceEvent, 
  Route, 
  LoadWithRelations, 
  Driver, 
  GpsDevice 
} from "@shared/schema";
import { randomUUID } from "crypto";
import cron from "node-cron";

interface GPSTrackingConfig {
  // Real-time tracking settings
  locationUpdateInterval: number; // seconds
  maxLocationHistory: number; // number of historical records to keep
  geofenceCheckInterval: number; // seconds
  
  // Geofencing settings
  defaultGeofenceRadius: number; // meters
  dwellTimeThreshold: number; // minutes to trigger dwell alert
  
  // Route optimization
  routeDeviationThreshold: number; // meters
  etaUpdateInterval: number; // seconds
  trafficApiEnabled: boolean;
  
  // Alerts and notifications
  enableSpeedingAlerts: boolean;
  speedLimitThreshold: number; // mph
  idleTimeThreshold: number; // minutes
  batteryLowThreshold: number; // percentage
}

export class GPSTrackingService {
  private config: GPSTrackingConfig;
  private isRunning = false;
  private activeDrivers = new Map<string, NodeJS.Timeout>(); // Driver ID to timeout
  private geofenceCheckers = new Map<string, NodeJS.Timeout>(); // Load ID to timeout

  constructor(config: Partial<GPSTrackingConfig> = {}) {
    this.config = {
      locationUpdateInterval: 30, // 30 seconds
      maxLocationHistory: 1000, // keep last 1000 locations per driver
      geofenceCheckInterval: 10, // 10 seconds
      defaultGeofenceRadius: 100, // 100 meters
      dwellTimeThreshold: 5, // 5 minutes
      routeDeviationThreshold: 500, // 500 meters
      etaUpdateInterval: 60, // 1 minute
      trafficApiEnabled: false, // Disabled by default
      enableSpeedingAlerts: true,
      speedLimitThreshold: 75, // 75 mph
      idleTimeThreshold: 30, // 30 minutes
      batteryLowThreshold: 20, // 20%
      ...config
    };
  }

  async initialize(): Promise<void> {
    console.log('Initializing GPS Tracking Service...');
    
    // Start periodic tasks
    this.startPeriodicTasks();
    
    // Initialize geofences for active loads
    await this.initializeActiveGeofences();
    
    this.isRunning = true;
    console.log('GPS Tracking Service initialized successfully');
  }

  private startPeriodicTasks(): void {
    // Cleanup old location data every hour
    cron.schedule('0 * * * *', async () => {
      await this.cleanupOldLocationData();
    });

    // Update ETAs for active routes every minute
    cron.schedule('* * * * *', async () => {
      await this.updateActiveRouteETAs();
    });

    // Check for offline devices every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await this.checkOfflineDevices();
    });
  }

  async updateDriverLocation(driverId: string, locationUpdate: DriverLocationUpdate): Promise<DriverLocation> {
    try {
      // Create location record
      const location = await storage.createDriverLocation({
        driverId,
        latitude: locationUpdate.latitude,
        longitude: locationUpdate.longitude,
        altitude: locationUpdate.altitude,
        accuracy: locationUpdate.accuracy,
        speed: locationUpdate.speed,
        heading: locationUpdate.heading,
        timestamp: locationUpdate.timestamp,
        batteryLevel: locationUpdate.batteryLevel,
        signalStrength: locationUpdate.signalStrength,
        isActive: true,
      });

      // Deactivate previous location
      await this.deactivateOldLocations(driverId, location.id);

      // Reverse geocode address (placeholder - would use actual geocoding service)
      const address = await this.reverseGeocode(locationUpdate.latitude, locationUpdate.longitude);
      if (address) {
        await storage.updateDriverLocation(location.id, { address });
      }

      // Check geofences
      await this.checkGeofences(driverId, locationUpdate);

      // Update route progress if driver has active route
      await this.updateRouteProgress(driverId, locationUpdate);

      // Check for alerts
      await this.checkLocationAlerts(driverId, locationUpdate);

      console.log(`Updated location for driver ${driverId}: ${locationUpdate.latitude}, ${locationUpdate.longitude}`);
      return location;
    } catch (error) {
      console.error('Error updating driver location:', error);
      throw error;
    }
  }

  private async deactivateOldLocations(driverId: string, currentLocationId: string): Promise<void> {
    try {
      const locations = await storage.getDriverLocationHistory(driverId);
      for (const location of locations) {
        if (location.id !== currentLocationId && location.isActive) {
          await storage.updateDriverLocation(location.id, { isActive: false });
        }
      }
    } catch (error) {
      console.error('Error deactivating old locations:', error);
    }
  }

  async createGeofence(geofenceData: {
    name: string;
    type: string;
    centerLatitude: number;
    centerLongitude: number;
    radius?: number;
    loadId?: string;
    customerId?: string;
    notificationSettings?: any;
  }): Promise<Geofence> {
    try {
      const geofence = await storage.createGeofence({
        ...geofenceData,
        radius: geofenceData.radius || this.config.defaultGeofenceRadius,
        notificationSettings: geofenceData.notificationSettings || {},
      });

      console.log(`Created geofence: ${geofence.name} at ${geofence.centerLatitude}, ${geofence.centerLongitude}`);
      return geofence;
    } catch (error) {
      console.error('Error creating geofence:', error);
      throw error;
    }
  }

  async createRouteForLoad(loadId: string, driverId: string): Promise<Route> {
    try {
      const load = await storage.getLoad(loadId);
      if (!load) {
        throw new Error('Load not found');
      }

      // Get pickup and delivery coordinates (placeholder - would use geocoding service)
      const pickupCoords = await this.geocodeAddress(load.pickupAddress);
      const deliveryCoords = await this.geocodeAddress(load.deliveryAddress);

      if (!pickupCoords || !deliveryCoords) {
        throw new Error('Unable to geocode addresses');
      }

      // Calculate planned route (placeholder - would use routing service)
      const routeData = await this.calculateRoute(pickupCoords, deliveryCoords);

      const route = await storage.createRoute({
        loadId,
        driverId,
        startLatitude: pickupCoords.latitude,
        startLongitude: pickupCoords.longitude,
        endLatitude: deliveryCoords.latitude,
        endLongitude: deliveryCoords.longitude,
        plannedRoute: routeData.coordinates,
        plannedDistance: routeData.distance,
        plannedDuration: routeData.duration,
        estimatedArrival: new Date(Date.now() + routeData.duration * 60000),
        status: 'planned',
      });

      // Create geofences for pickup and delivery
      await this.createGeofence({
        name: `Pickup - ${load.loadNumber}`,
        type: 'pickup',
        centerLatitude: pickupCoords.latitude,
        centerLongitude: pickupCoords.longitude,
        radius: 200, // 200 meters for pickup zones
        loadId,
        notificationSettings: {
          notifyOnEntry: true,
          notifyOnExit: true,
          notifyCustomer: true,
        },
      });

      await this.createGeofence({
        name: `Delivery - ${load.loadNumber}`,
        type: 'delivery',
        centerLatitude: deliveryCoords.latitude,
        centerLongitude: deliveryCoords.longitude,
        radius: 200, // 200 meters for delivery zones
        loadId,
        notificationSettings: {
          notifyOnEntry: true,
          notifyOnExit: true,
          notifyCustomer: true,
        },
      });

      console.log(`Created route for load ${loadId}`);
      return route;
    } catch (error) {
      console.error('Error creating route for load:', error);
      throw error;
    }
  }

  private async checkGeofences(driverId: string, location: DriverLocationUpdate): Promise<void> {
    try {
      const geofences = await storage.getActiveGeofences();
      
      for (const geofence of geofences) {
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          geofence.centerLatitude,
          geofence.centerLongitude
        );

        const isInside = distance <= geofence.radius;
        const wasInside = await this.wasDriverInGeofence(driverId, geofence.id);

        if (isInside && !wasInside) {
          // Driver entered geofence
          await this.handleGeofenceEntry(driverId, geofence, location);
        } else if (!isInside && wasInside) {
          // Driver exited geofence
          await this.handleGeofenceExit(driverId, geofence, location);
        } else if (isInside && wasInside) {
          // Driver dwelling in geofence
          await this.checkDwellTime(driverId, geofence, location);
        }
      }
    } catch (error) {
      console.error('Error checking geofences:', error);
    }
  }

  private async handleGeofenceEntry(driverId: string, geofence: Geofence, location: DriverLocationUpdate): Promise<void> {
    try {
      await storage.createGeofenceEvent({
        geofenceId: geofence.id,
        driverId,
        eventType: 'entered',
        timestamp: location.timestamp,
        latitude: location.latitude,
        longitude: location.longitude,
        loadId: geofence.loadId,
      });

      // Send notifications if configured
      if (geofence.notificationSettings?.notifyOnEntry) {
        await this.sendGeofenceNotification(driverId, geofence, 'entered');
      }

      console.log(`Driver ${driverId} entered geofence ${geofence.name}`);
    } catch (error) {
      console.error('Error handling geofence entry:', error);
    }
  }

  private async handleGeofenceExit(driverId: string, geofence: Geofence, location: DriverLocationUpdate): Promise<void> {
    try {
      const dwellTime = await this.calculateDwellTime(driverId, geofence.id);
      
      await storage.createGeofenceEvent({
        geofenceId: geofence.id,
        driverId,
        eventType: 'exited',
        timestamp: location.timestamp,
        latitude: location.latitude,
        longitude: location.longitude,
        dwellTime,
        loadId: geofence.loadId,
      });

      // Send notifications if configured
      if (geofence.notificationSettings?.notifyOnExit) {
        await this.sendGeofenceNotification(driverId, geofence, 'exited', dwellTime);
      }

      console.log(`Driver ${driverId} exited geofence ${geofence.name} after ${dwellTime} minutes`);
    } catch (error) {
      console.error('Error handling geofence exit:', error);
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  private async wasDriverInGeofence(driverId: string, geofenceId: string): Promise<boolean> {
    try {
      const recentEvents = await storage.getRecentGeofenceEvents(driverId, geofenceId, 1);
      return recentEvents.length > 0 && recentEvents[0].eventType === 'entered';
    } catch (error) {
      console.error('Error checking if driver was in geofence:', error);
      return false;
    }
  }

  private async calculateDwellTime(driverId: string, geofenceId: string): Promise<number> {
    try {
      const events = await storage.getRecentGeofenceEvents(driverId, geofenceId, 2);
      if (events.length >= 2 && events[0].eventType === 'entered') {
        const entryTime = new Date(events[0].timestamp);
        const exitTime = new Date();
        return Math.round((exitTime.getTime() - entryTime.getTime()) / 60000); // minutes
      }
      return 0;
    } catch (error) {
      console.error('Error calculating dwell time:', error);
      return 0;
    }
  }

  private async updateRouteProgress(driverId: string, location: DriverLocationUpdate): Promise<void> {
    try {
      const activeRoute = await storage.getActiveRouteForDriver(driverId);
      if (!activeRoute) return;

      // Add location to actual route
      const actualRoute = Array.isArray(activeRoute.actualRoute) ? activeRoute.actualRoute : [];
      actualRoute.push({
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: location.timestamp,
      });

      // Calculate actual distance traveled
      const actualDistance = this.calculateRouteDistance(actualRoute);

      // Update ETA based on current progress
      const estimatedArrival = await this.calculateETA(activeRoute, location);

      await storage.updateRoute(activeRoute.id, {
        actualRoute,
        actualDistance,
        estimatedArrival,
        status: 'active',
      });
    } catch (error) {
      console.error('Error updating route progress:', error);
    }
  }

  private calculateRouteDistance(route: any[]): number {
    if (route.length < 2) return 0;
    
    let totalDistance = 0;
    for (let i = 1; i < route.length; i++) {
      totalDistance += this.calculateDistance(
        route[i-1].latitude,
        route[i-1].longitude,
        route[i].latitude,
        route[i].longitude
      );
    }
    
    return totalDistance * 0.000621371; // Convert meters to miles
  }

  private async calculateETA(route: Route, currentLocation: DriverLocationUpdate): Promise<Date> {
    // Simple ETA calculation - in production would use traffic APIs
    const remainingDistance = this.calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      route.endLatitude,
      route.endLongitude
    );
    
    const averageSpeed = currentLocation.speed || 45; // Default 45 mph
    const remainingTimeMinutes = (remainingDistance * 0.000621371) / averageSpeed * 60;
    
    return new Date(Date.now() + remainingTimeMinutes * 60000);
  }

  private async checkLocationAlerts(driverId: string, location: DriverLocationUpdate): Promise<void> {
    try {
      // Check speeding
      if (this.config.enableSpeedingAlerts && location.speed && location.speed > this.config.speedLimitThreshold) {
        await this.sendSpeedingAlert(driverId, location.speed);
      }

      // Check low battery
      if (location.batteryLevel && location.batteryLevel < this.config.batteryLowThreshold) {
        await this.sendBatteryAlert(driverId, location.batteryLevel);
      }
    } catch (error) {
      console.error('Error checking location alerts:', error);
    }
  }

  private async sendGeofenceNotification(driverId: string, geofence: Geofence, eventType: string, dwellTime?: number): Promise<void> {
    // Placeholder for notification logic
    console.log(`Geofence notification: Driver ${driverId} ${eventType} ${geofence.name}${dwellTime ? ` (${dwellTime} min)` : ''}`);
  }

  private async sendSpeedingAlert(driverId: string, speed: number): Promise<void> {
    console.log(`Speeding alert: Driver ${driverId} traveling at ${speed} mph`);
  }

  private async sendBatteryAlert(driverId: string, batteryLevel: number): Promise<void> {
    console.log(`Low battery alert: Driver ${driverId} device at ${batteryLevel}%`);
  }

  private async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    // Placeholder for reverse geocoding - would use Google Maps API or similar
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  }

  private async geocodeAddress(address: string): Promise<{latitude: number, longitude: number} | null> {
    // Placeholder for geocoding - would use Google Maps API or similar
    // For demo purposes, return some coordinates
    return {
      latitude: 33.7490 + Math.random() * 0.1 - 0.05,
      longitude: -84.3880 + Math.random() * 0.1 - 0.05
    };
  }

  private async calculateRoute(start: {latitude: number, longitude: number}, end: {latitude: number, longitude: number}): Promise<{
    coordinates: any[];
    distance: number;
    duration: number;
  }> {
    // Placeholder for route calculation - would use Google Maps API or similar
    const distance = this.calculateDistance(start.latitude, start.longitude, end.latitude, end.longitude) * 0.000621371; // miles
    const duration = Math.round(distance / 45 * 60); // minutes at 45 mph average
    
    return {
      coordinates: [start, end], // Simplified - real route would have many waypoints
      distance,
      duration,
    };
  }

  private async initializeActiveGeofences(): Promise<void> {
    // Initialize geofences for loads that are currently in transit
    const activeLoads = await storage.getLoadsByStatus('in_transit');
    for (const load of activeLoads) {
      if (load.driver) {
        await this.createRouteForLoad(load.id, load.driver.id);
      }
    }
  }

  private async cleanupOldLocationData(): Promise<void> {
    try {
      console.log('Cleaning up old location data...');
      // Keep only the most recent locations per driver
      const drivers = await storage.getAllDrivers();
      for (const driver of drivers) {
        await storage.cleanupOldDriverLocations(driver.id, this.config.maxLocationHistory);
      }
    } catch (error) {
      console.error('Error cleaning up old location data:', error);
    }
  }

  private async updateActiveRouteETAs(): Promise<void> {
    try {
      const activeRoutes = await storage.getActiveRoutes();
      for (const route of activeRoutes) {
        const driver = await storage.getDriver(route.driverId);
        const currentLocation = await storage.getDriverCurrentLocation(route.driverId);
        
        if (currentLocation) {
          const eta = await this.calculateETA(route, {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
            speed: currentLocation.speed,
            timestamp: new Date(),
          });
          
          await storage.updateRoute(route.id, { estimatedArrival: eta });
        }
      }
    } catch (error) {
      console.error('Error updating route ETAs:', error);
    }
  }

  private async checkOfflineDevices(): Promise<void> {
    try {
      const devices = await storage.getAllGpsDevices();
      const offlineThreshold = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes

      for (const device of devices) {
        if (device.lastHeartbeat && new Date(device.lastHeartbeat) < offlineThreshold && device.status !== 'offline') {
          await storage.updateGpsDevice(device.id, { status: 'offline' });
          console.log(`GPS device ${device.deviceId} marked as offline`);
        }
      }
    } catch (error) {
      console.error('Error checking offline devices:', error);
    }
  }

  async getDriverTracking(driverId: string): Promise<{
    currentLocation?: DriverLocation;
    route?: Route;
    geofenceEvents: GeofenceEvent[];
    device?: GpsDevice;
  }> {
    try {
      const [currentLocation, route, geofenceEvents, device] = await Promise.all([
        storage.getDriverCurrentLocation(driverId),
        storage.getActiveRouteForDriver(driverId),
        storage.getDriverGeofenceEvents(driverId, 24), // Last 24 hours
        storage.getGpsDeviceByDriver(driverId),
      ]);

      return {
        currentLocation: currentLocation || undefined,
        route: route || undefined,
        geofenceEvents,
        device: device || undefined,
      };
    } catch (error) {
      console.error('Error getting driver tracking data:', error);
      throw error;
    }
  }

  async getAllDriverLocations(): Promise<DriverLocation[]> {
    try {
      return await storage.getAllCurrentDriverLocations();
    } catch (error) {
      console.error('Error getting all driver locations:', error);
      return [];
    }
  }

  stop(): void {
    this.isRunning = false;
    
    // Clear all timeouts
    this.activeDrivers.forEach((timeout) => clearTimeout(timeout));
    this.geofenceCheckers.forEach((timeout) => clearTimeout(timeout));
    
    this.activeDrivers.clear();
    this.geofenceCheckers.clear();
    
    console.log('GPS Tracking Service stopped');
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  getConfig(): GPSTrackingConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<GPSTrackingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('GPS Tracking Service config updated:', this.config);
  }
}

// Singleton instance
export const gpsTrackingService = new GPSTrackingService({
  locationUpdateInterval: 30, // 30 seconds
  maxLocationHistory: 1000,
  geofenceCheckInterval: 10,
  defaultGeofenceRadius: 100,
  dwellTimeThreshold: 5,
  routeDeviationThreshold: 500,
  etaUpdateInterval: 60,
  trafficApiEnabled: false,
  enableSpeedingAlerts: true,
  speedLimitThreshold: 75,
  idleTimeThreshold: 30,
  batteryLowThreshold: 20,
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('Shutting down GPS Tracking Service...');
  gpsTrackingService.stop();
});

process.on('SIGTERM', () => {
  console.log('Shutting down GPS Tracking Service...');
  gpsTrackingService.stop();
});