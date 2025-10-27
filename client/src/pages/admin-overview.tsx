import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Truck, MapPin, Package, Camera, Users, Navigation } from "lucide-react";

interface Driver {
  id: string;
  name: string;
  status: string;
  chatId?: string;
  currentLocation?: {
    address: string;
    timestamp: string;
    manual: boolean;
  };
  destination?: string;
  used?: {
    feet: number;
    weight: number;
  };
  vehicle?: {
    maxWeight: number;
    interiorWidth: number;
  };
}

interface Load {
  loadId: string;
  origin: string;
  destination: string;
  rate?: number;
  miles?: number;
  status: string;
  assignedDriverChatId?: string;
  pickupTime?: string;
  effectiveFeet?: number;
  weight?: number;
}

function AdminOverview() {
  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: loads = [], isLoading: loadsLoading } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
  });

  const effectiveUsableFeet = (driver: Driver) => {
    const baseLength = 22;
    const interiorWidth = driver.vehicle?.interiorWidth || 7.8;
    const doorClearance = 0.5;
    const palletJackReserve = 3.0;
    return Math.round((baseLength - doorClearance - palletJackReserve) * 100) / 100;
  };

  const calculateRPM = (load: Load) => {
    if (!load.rate || !load.miles) return 0;
    return load.rate / load.miles;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available": return "bg-green-500";
      case "on_route": return "bg-blue-500";
      case "unavailable": return "bg-gray-500";
      default: return "bg-yellow-500";
    }
  };

  const getLoadStatusColor = (status: string) => {
    switch (status) {
      case "new": return "bg-blue-500";
      case "pickup_phase": return "bg-orange-500";
      case "in_transit": return "bg-purple-500";
      case "delivered": return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  if (driversLoading || loadsLoading) {
    return <div className="p-4">Loading admin overview...</div>;
  }

  const activeLoads = loads.filter(l => l.status !== "delivered");
  const inTransitLoads = loads.filter(l => l.status === "in_transit");
  const availableDrivers = drivers.filter(d => d.status === "available");

  return (
    <div className="p-6 space-y-6" data-testid="admin-overview">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">TRAQ IQ Admin Overview</h1>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Users className="w-4 h-4" />
          <span>{drivers.length} Drivers</span>
          <Package className="w-4 h-4 ml-4" />
          <span>{activeLoads.length} Active Loads</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available Drivers</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{availableDrivers.length}</div>
            <p className="text-xs text-muted-foreground">Ready for loads</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Transit</CardTitle>
            <Navigation className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inTransitLoads.length}</div>
            <p className="text-xs text-muted-foreground">En route to delivery</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Loads</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeLoads.length}</div>
            <p className="text-xs text-muted-foreground">Total active</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg RPM</CardTitle>
            <span className="text-sm">💰</span>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${activeLoads.length > 0 
                ? (activeLoads.reduce((sum, load) => sum + calculateRPM(load), 0) / activeLoads.length).toFixed(2)
                : "0.00"
              }
            </div>
            <p className="text-xs text-muted-foreground">Revenue per mile</p>
          </CardContent>
        </Card>
      </div>

      {/* Driver Capacity Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" />
            Driver Capacity & Location Status
          </CardTitle>
          <CardDescription>Real-time driver availability and truck utilization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {drivers.map((driver, index) => {
              const usableFeet = effectiveUsableFeet(driver);
              const usedFeet = driver.used?.feet || 0;
              const remainingFeet = Math.max(0, usableFeet - usedFeet);
              const utilizationPct = usableFeet > 0 ? Math.round((usedFeet / usableFeet) * 100) : 0;
              
              return (
                <div key={driver.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(driver.status)}`} />
                      <span className="font-medium">{driver.name}</span>
                      <Badge variant="outline">{driver.status}</Badge>
                    </div>
                    
                    {driver.currentLocation && (
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <MapPin className="w-4 h-4" />
                        <span>{driver.currentLocation.address}</span>
                        {driver.destination && (
                          <span className="text-blue-600">→ {driver.destination}</span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium">{remainingFeet}ft</div>
                      <div className="text-gray-500">Available</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">{utilizationPct}%</div>
                      <div className="text-gray-500">Utilized</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">{(driver.vehicle?.maxWeight || 0) - (driver.used?.weight || 0)}lbs</div>
                      <div className="text-gray-500">Weight Avail</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Active Loads with Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Active Loads & Photo Status
          </CardTitle>
          <CardDescription>Current load status and pickup confirmations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activeLoads.map((load, index) => {
              const assignedDriver = drivers.find(d => String(d.chatId) === String(load.assignedDriverChatId));
              const rpm = calculateRPM(load);
              
              return (
                <div key={load.loadId} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <Badge className={getLoadStatusColor(load.status)}>
                      {load.status.replace("_", " ").toUpperCase()}
                    </Badge>
                    <div>
                      <div className="font-medium">{load.loadId}</div>
                      <div className="text-sm text-gray-600">
                        {load.origin} → {load.destination}
                      </div>
                    </div>
                    {assignedDriver && (
                      <div className="text-sm">
                        <span className="text-gray-500">Driver:</span> {assignedDriver.name}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="font-medium">${load.rate}</div>
                      <div className="text-gray-500">Rate</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">${rpm.toFixed(2)}</div>
                      <div className="text-gray-500">RPM</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">{load.effectiveFeet || 0}ft</div>
                      <div className="text-gray-500">Space</div>
                    </div>
                    {load.status === "pickup_phase" && (
                      <div className="flex items-center gap-1 text-orange-600">
                        <Camera className="w-4 h-4" />
                        <span>Photos Pending</span>
                      </div>
                    )}
                    {load.pickupTime && (
                      <div className="flex items-center gap-1 text-green-600">
                        <Camera className="w-4 h-4" />
                        <span>Confirmed</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminOverview;