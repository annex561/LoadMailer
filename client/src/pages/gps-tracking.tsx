import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MapPin, Navigation, Route, Activity, Zap, Signal, Clock, AlertTriangle, Send, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import DriverLocationMap from "@/components/driver-location-map";

type DriverLocation = {
  id: string;
  driverId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  batteryLevel?: number;
  signalStrength?: number;
  address?: string;
  timestamp: string;
  isActive: boolean;
  createdAt: string;
};

type GpsDevice = {
  id: string;
  driverId: string;
  deviceId: string;
  batteryLevel?: number;
  isActive: boolean;
  status: string;
  deviceType: string;
  lastHeartbeat?: string;
  firmwareVersion?: string;
  createdAt: string;
  updatedAt: string;
};

type Route = {
  id: string;
  loadId: string;
  driverId: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  plannedDistance?: number;
  plannedDuration?: number;
  actualDistance?: number;
  actualDuration?: number;
  estimatedArrival?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function GPSTrackingPage() {
  const { toast } = useToast();
  const [newLocation, setNewLocation] = useState({
    driverId: "600e6379-6bf3-4aa0-b939-c26ccee04a17",
    latitude: "",
    longitude: "",
    speed: "",
    heading: "",
  });

  const [gpsLinkData, setGpsLinkData] = useState({
    driverId: "",
    loadId: ""
  });

  const { data: locationsResponse } = useQuery<{
    locations: DriverLocation[];
    count: number;
    serviceRunning: boolean;
    trackedDrivers: number;
  }>({
    queryKey: ["/api/driver-locations/active"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time tracking
  });
  
  const locations = locationsResponse?.locations || [];

  const { data: devices = [] } = useQuery<GpsDevice[]>({
    queryKey: ["/api/gps/devices"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: routes = [] } = useQuery<Route[]>({
    queryKey: ["/api/routes"],
    refetchInterval: 30000,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["/api/drivers"],
  });

  const { data: loads = [] } = useQuery({
    queryKey: ["/api/loads"],
  });

  const activeLoads = loads.filter((load: any) => 
    ['available', 'assigned', 'in_transit'].includes(load.status)
  );

  const sendGpsLinkMutation = useMutation({
    mutationFn: async (data: { driverId: string; loadId: string }) => {
      const response = await apiRequest("/api/gps/send-tracking-link", {
        method: "POST",
        body: JSON.stringify(data),
      });
      
      // Check if the response indicates failure
      if (!response.success) {
        throw new Error(response.error || "Failed to send GPS tracking link");
      }
      
      return response;
    },
    onSuccess: () => {
      toast({
        title: "GPS Link Sent",
        description: "Driver will receive GPS tracking link via SMS.",
      });
      setGpsLinkData({ driverId: "", loadId: "" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send GPS tracking link.",
        variant: "destructive",
      });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: (locationData: any) => apiRequest("/api/driver-locations", {
      method: "POST",
      body: JSON.stringify({
        ...locationData,
        timestamp: new Date().toISOString(),
        isActive: true,
        batteryLevel: 85,
        signalStrength: -65,
        accuracy: 5.0,
        altitude: 1050,
      }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-locations"] });
      toast({
        title: "Location Updated",
        description: "Driver location has been successfully updated.",
      });
      setNewLocation({ ...newLocation, latitude: "", longitude: "", speed: "", heading: "" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update driver location.",
        variant: "destructive",
      });
    },
  });

  const simulateLocationMutation = useMutation({
    mutationFn: () => {
      const atlantaRoutes = [
        { lat: 33.748995, lng: -84.387982, address: "Downtown Atlanta, GA" },
        { lat: 33.755, lng: -84.390, address: "Midtown Atlanta, GA" },
        { lat: 33.762, lng: -84.392, address: "Buckhead Atlanta, GA" },
        { lat: 33.770, lng: -84.395, address: "North Atlanta, GA" },
      ];
      
      const randomRoute = atlantaRoutes[Math.floor(Math.random() * atlantaRoutes.length)];
      const speedVariation = 45 + Math.random() * 30; // 45-75 mph
      const headingVariation = Math.floor(Math.random() * 360);
      
      return apiRequest("/api/driver-locations", {
        method: "POST",
        body: JSON.stringify({
          driverId: "600e6379-6bf3-4aa0-b939-c26ccee04a17",
          latitude: randomRoute.lat + (Math.random() - 0.5) * 0.01,
          longitude: randomRoute.lng + (Math.random() - 0.5) * 0.01,
          speed: speedVariation,
          heading: headingVariation,
          timestamp: new Date().toISOString(),
          isActive: true,
          batteryLevel: 80 + Math.floor(Math.random() * 20),
          signalStrength: -60 - Math.floor(Math.random() * 20),
          accuracy: 3.0 + Math.random() * 5.0,
          altitude: 1000 + Math.floor(Math.random() * 200),
          address: randomRoute.address,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-locations"] });
      toast({
        title: "Simulated Location Update",
        description: "Generated realistic location data for testing.",
      });
    },
  });

  const handleSubmitLocation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocation.latitude || !newLocation.longitude) {
      toast({
        title: "Validation Error",
        description: "Please enter both latitude and longitude.",
        variant: "destructive",
      });
      return;
    }

    updateLocationMutation.mutate({
      driverId: newLocation.driverId,
      latitude: parseFloat(newLocation.latitude),
      longitude: parseFloat(newLocation.longitude),
      speed: newLocation.speed ? parseFloat(newLocation.speed) : undefined,
      heading: newLocation.heading ? parseFloat(newLocation.heading) : undefined,
    });
  };

  const formatCoordinate = (coord: number) => coord.toFixed(6);
  const formatSpeed = (speed?: number) => speed ? `${speed.toFixed(1)} mph` : "N/A";
  const formatBattery = (level?: number) => level ? `${level}%` : "N/A";
  const formatSignal = (strength?: number) => strength ? `${strength} dBm` : "N/A";

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      active: { color: "bg-green-500", text: "Active" },
      inactive: { color: "bg-gray-500", text: "Inactive" },
      offline: { color: "bg-red-500", text: "Offline" },
      planned: { color: "bg-blue-500", text: "Planned" },
      active_route: { color: "bg-green-500", text: "In Progress" },
      completed: { color: "bg-gray-500", text: "Completed" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.inactive;
    return <Badge className={`${config.color} text-white`}>{config.text}</Badge>;
  };

  const getDriverName = (driverId: string) => {
    const driver = drivers.find((d: any) => d.id === driverId);
    return driver?.name || "Unknown Driver";
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">GPS Tracking System</h1>
          <p className="text-muted-foreground mt-1">
            Real-time driver location monitoring and route management
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => simulateLocationMutation.mutate()}
            disabled={simulateLocationMutation.isPending}
            data-testid="button-simulate-location"
          >
            <Navigation className="w-4 h-4 mr-2" />
            Simulate Location
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tracking" className="space-y-4">
        <TabsList data-testid="tabs-gps">
          <TabsTrigger value="tracking" data-testid="tab-tracking">
            <MapPin className="w-4 h-4 mr-2" />
            Live Tracking
          </TabsTrigger>
          <TabsTrigger value="devices" data-testid="tab-devices">
            <Activity className="w-4 h-4 mr-2" />
            GPS Devices
          </TabsTrigger>
          <TabsTrigger value="routes" data-testid="tab-routes">
            <Route className="w-4 h-4 mr-2" />
            Routes
          </TabsTrigger>
          <TabsTrigger value="manual" data-testid="tab-manual">
            <Navigation className="w-4 h-4 mr-2" />
            Manual Update
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card data-testid="card-stats-locations">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Locations</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-location-count">
                  {locations.length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Real-time tracking enabled
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-stats-devices">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">GPS Devices</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-device-count">
                  {devices.filter(d => d.isActive).length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Active devices online
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-stats-routes">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Routes</CardTitle>
                <Route className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-route-count">
                  {routes.filter(r => r.status === 'active').length}
                </div>
                <p className="text-xs text-muted-foreground">
                  Routes in progress
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Interactive Map with Driver Locations */}
          <DriverLocationMap />

          <Card data-testid="card-location-table">
            <CardHeader>
              <CardTitle>Current Driver Locations</CardTitle>
              <CardDescription>
                Real-time location data updated every 10 seconds
              </CardDescription>
            </CardHeader>
            <CardContent>
              {locations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-locations">
                  <MapPin className="mx-auto h-12 w-12 mb-4" />
                  <p>No location data available</p>
                  <p className="text-sm">Use the "Simulate Location" button to generate test data</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Speed</TableHead>
                      <TableHead>Heading</TableHead>
                      <TableHead>Battery</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead>Last Update</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((location) => (
                      <TableRow key={location.id} data-testid={`row-location-${location.id}`}>
                        <TableCell className="font-medium">
                          {getDriverName(location.driverId)}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="text-sm">
                              {formatCoordinate(location.latitude)}, {formatCoordinate(location.longitude)}
                            </div>
                            {location.address && (
                              <div className="text-xs text-muted-foreground">
                                {location.address}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{formatSpeed(location.speed)}</TableCell>
                        <TableCell>{location.heading ? `${location.heading}°` : "N/A"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {formatBattery(location.batteryLevel)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Signal className="w-3 h-3" />
                            {formatSignal(location.signalStrength)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(location.timestamp).toLocaleTimeString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(location.isActive ? 'active' : 'inactive')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <Card data-testid="card-devices-table">
            <CardHeader>
              <CardTitle>GPS Device Management</CardTitle>
              <CardDescription>
                Monitor and manage GPS tracking devices
              </CardDescription>
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-devices">
                  <Activity className="mx-auto h-12 w-12 mb-4" />
                  <p>No GPS devices registered</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Battery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Heartbeat</TableHead>
                      <TableHead>Firmware</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {devices.map((device) => (
                      <TableRow key={device.id} data-testid={`row-device-${device.id}`}>
                        <TableCell className="font-medium">{device.deviceId}</TableCell>
                        <TableCell>{getDriverName(device.driverId)}</TableCell>
                        <TableCell className="capitalize">{device.deviceType}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {formatBattery(device.batteryLevel)}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(device.status)}</TableCell>
                        <TableCell>
                          {device.lastHeartbeat 
                            ? new Date(device.lastHeartbeat).toLocaleString()
                            : "Never"
                          }
                        </TableCell>
                        <TableCell>{device.firmwareVersion || "Unknown"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routes" className="space-y-4">
          <Card data-testid="card-routes-table">
            <CardHeader>
              <CardTitle>Route Management</CardTitle>
              <CardDescription>
                Track active routes and driver progress
              </CardDescription>
            </CardHeader>
            <CardContent>
              {routes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-routes">
                  <Route className="mx-auto h-12 w-12 mb-4" />
                  <p>No active routes</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Load ID</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Start Location</TableHead>
                      <TableHead>End Location</TableHead>
                      <TableHead>Distance</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routes.map((route) => (
                      <TableRow key={route.id} data-testid={`row-route-${route.id}`}>
                        <TableCell className="font-medium">{route.loadId}</TableCell>
                        <TableCell>{getDriverName(route.driverId)}</TableCell>
                        <TableCell>
                          {formatCoordinate(route.startLatitude)}, {formatCoordinate(route.startLongitude)}
                        </TableCell>
                        <TableCell>
                          {formatCoordinate(route.endLatitude)}, {formatCoordinate(route.endLongitude)}
                        </TableCell>
                        <TableCell>
                          {route.plannedDistance ? `${route.plannedDistance} miles` : "Calculating..."}
                        </TableCell>
                        <TableCell>
                          {route.estimatedArrival 
                            ? new Date(route.estimatedArrival).toLocaleString()
                            : "Calculating..."
                          }
                        </TableCell>
                        <TableCell>{getStatusBadge(route.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="space-y-4">
          <Card data-testid="card-send-gps-link">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                Send GPS Tracking Link
              </CardTitle>
              <CardDescription>
                Manually send GPS tracking link to a driver for a specific load
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!gpsLinkData.driverId || !gpsLinkData.loadId) {
                  toast({
                    title: "Validation Error",
                    description: "Please select both driver and load.",
                    variant: "destructive",
                  });
                  return;
                }
                sendGpsLinkMutation.mutate(gpsLinkData);
              }} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="gps-driver">Driver</Label>
                    <Select
                      value={gpsLinkData.driverId}
                      onValueChange={(value) => 
                        setGpsLinkData({ ...gpsLinkData, driverId: value })
                      }
                    >
                      <SelectTrigger id="gps-driver" data-testid="select-gps-driver" 
                        className="bg-white border border-gray-300">
                        <SelectValue placeholder="Select driver" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-300 shadow-lg">
                        {drivers.map((driver: any) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="gps-load">Load</Label>
                    <Select
                      value={gpsLinkData.loadId}
                      onValueChange={(value) => 
                        setGpsLinkData({ ...gpsLinkData, loadId: value })
                      }
                    >
                      <SelectTrigger id="gps-load" data-testid="select-gps-load"
                        className="bg-white border border-gray-300">
                        <SelectValue placeholder="Select load" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-300 shadow-lg">
                        {activeLoads.map((load: any) => (
                          <SelectItem key={load.id} value={load.id}>
                            {load.loadNumber} - {load.pickupAddress} → {load.deliveryAddress}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <Button
                  type="submit"
                  disabled={sendGpsLinkMutation.isPending}
                  data-testid="button-send-gps-link"
                  className="w-full"
                >
                  {sendGpsLinkMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send GPS Tracking Link
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card data-testid="card-manual-update">
            <CardHeader>
              <CardTitle>Manual Location Update</CardTitle>
              <CardDescription>
                Manually update driver location for testing purposes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitLocation} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="latitude">Latitude</Label>
                    <Input
                      id="latitude"
                      type="number"
                      step="0.000001"
                      placeholder="33.748995"
                      value={newLocation.latitude}
                      onChange={(e) => setNewLocation({ ...newLocation, latitude: e.target.value })}
                      data-testid="input-latitude"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="longitude">Longitude</Label>
                    <Input
                      id="longitude"
                      type="number"
                      step="0.000001"
                      placeholder="-84.387982"
                      value={newLocation.longitude}
                      onChange={(e) => setNewLocation({ ...newLocation, longitude: e.target.value })}
                      data-testid="input-longitude"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="speed">Speed (mph)</Label>
                    <Input
                      id="speed"
                      type="number"
                      placeholder="65"
                      value={newLocation.speed}
                      onChange={(e) => setNewLocation({ ...newLocation, speed: e.target.value })}
                      data-testid="input-speed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="heading">Heading (degrees)</Label>
                    <Input
                      id="heading"
                      type="number"
                      min="0"
                      max="360"
                      placeholder="45"
                      value={newLocation.heading}
                      onChange={(e) => setNewLocation({ ...newLocation, heading: e.target.value })}
                      data-testid="input-heading"
                    />
                  </div>
                </div>
                <Button 
                  type="submit" 
                  disabled={updateLocationMutation.isPending}
                  data-testid="button-update-location"
                  className="w-full"
                >
                  <MapPin className="w-4 h-4 mr-2" />
                  {updateLocationMutation.isPending ? "Updating..." : "Update Location"}
                </Button>
              </form>

              <div className="mt-6 p-4 bg-muted rounded-lg">
                <h4 className="font-semibold mb-2 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Sample Coordinates
                </h4>
                <div className="text-sm space-y-1">
                  <p><strong>Atlanta, GA:</strong> 33.748995, -84.387982</p>
                  <p><strong>Charlotte, NC:</strong> 35.227087, -80.843127</p>
                  <p><strong>Jacksonville, FL:</strong> 30.332184, -81.655651</p>
                  <p><strong>Nashville, TN:</strong> 36.162664, -86.781602</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}