import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Search, 
  Filter, 
  Clock, 
  Thermometer, 
  MapPin, 
  DollarSign, 
  Truck, 
  AlertTriangle,
  Calendar,
  Weight,
  Phone,
  Building,
  Navigation,
  RefreshCw
} from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import type { LoadWithRelations } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function DATLoads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [temperatureFilter, setTemperatureFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: loads = [], isLoading, refetch } = useQuery<LoadWithRelations[]>({
    queryKey: ["/api/loads"],
    refetchInterval: 30000, // Refresh every 30 seconds for real-time updates
  });

  const { data: expirationStats } = useQuery({
    queryKey: ["/api/load-expiration-stats"],
    refetchInterval: 60000, // Check expiration stats every minute
  });

  // Book load mutation
  const bookLoadMutation = useMutation({
    mutationFn: async (loadId: string) => {
      const response = await apiRequest("POST", `/api/loads/${loadId}/book`, {});
      return response.json();
    },
    onSuccess: (data, loadId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      toast({
        title: "Booking Request Sent",
        description: `Your booking request for Load ${data.loadNumber} has been sent to the dispatcher. You will receive confirmation shortly.`,
      });
    },
    onError: () => {
      toast({
        title: "Booking Failed",
        description: "Unable to book this load. Please try again or contact dispatch.",
        variant: "destructive",
      });
    },
  });

  const handleBookLoad = (loadId: string) => {
    bookLoadMutation.mutate(loadId);
  };

  // Filter loads to show only DAT loads and apply filters
  const filteredLoads = loads.filter(load => {
    // Only show DAT loads (from scraper)
    if (load.sourceBoard !== 'dat') return false;
    
    const matchesSearch = !searchTerm || 
      load.loadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.pickupAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.deliveryAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.company?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesEquipment = !equipmentFilter || equipmentFilter === "all" || load.equipmentType === equipmentFilter;
    const matchesStatus = !statusFilter || statusFilter === "all" || load.status === statusFilter;
    
    const matchesTemperature = !temperatureFilter || temperatureFilter === "all" || 
      (temperatureFilter === "refrigerated" && load.temperatureRequired) ||
      (temperatureFilter === "dry" && !load.temperatureRequired);
    
    return matchesSearch && matchesEquipment && matchesStatus && matchesTemperature;
  });

  const getEquipmentIcon = (equipmentType: string) => {
    switch (equipmentType) {
      case 'refrigerated':
        return <Thermometer className="w-4 h-4" />;
      case 'flatbed':
        return <Truck className="w-4 h-4" />;
      default:
        return <Truck className="w-4 h-4" />;
    }
  };

  const getEquipmentBadge = (load: LoadWithRelations) => {
    const equipmentDisplay = {
      dry_van: { label: "Dry Van", className: "bg-blue-100 text-blue-800 border-blue-200" },
      refrigerated: { label: "Reefer", className: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      flatbed: { label: "Flatbed", className: "bg-orange-100 text-orange-800 border-orange-200" },
      step_deck: { label: "Step Deck", className: "bg-purple-100 text-purple-800 border-purple-200" },
    };

    const config = equipmentDisplay[load.equipmentType as keyof typeof equipmentDisplay] || equipmentDisplay.dry_van;
    
    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        {getEquipmentIcon(load.equipmentType)}
        {config.label}
      </Badge>
    );
  };

  const getStatusBadge = (load: LoadWithRelations) => {
    const now = new Date();
    const isExpired = load.expiresAt && new Date(load.expiresAt.toString()) <= now;
    const isExpiringSoon = load.expiresAt && 
      new Date(load.expiresAt.toString()) > now && 
      new Date(load.expiresAt.toString()) <= addDays(now, 1);

    if (isExpired || load.status === 'expired') {
      return (
        <Badge className="bg-red-100 text-red-800 border-red-200 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Expired
        </Badge>
      );
    }

    if (isExpiringSoon) {
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Expires Soon
        </Badge>
      );
    }

    const statusConfig = {
      scheduled: { label: "Available", className: "bg-green-100 text-green-800 border-green-200", icon: "✓" },
      in_transit: { label: "Booked", className: "bg-blue-100 text-blue-800 border-blue-200", icon: "🚛" },
      delivered: { label: "Completed", className: "bg-gray-100 text-gray-800 border-gray-200", icon: "✅" },
    };

    const config = statusConfig[load.status as keyof typeof statusConfig] || statusConfig.scheduled;
    
    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        <span>{config.icon}</span>
        {config.label}
      </Badge>
    );
  };

  const getTemperatureDisplay = (load: LoadWithRelations) => {
    if (!load.temperatureRequired) return null;

    return (
      <div className="flex items-center gap-2 text-sm text-cyan-700 bg-cyan-50 px-2 py-1 rounded">
        <Thermometer className="w-4 h-4" />
        <span>
          {load.minTemperature && load.maxTemperature 
            ? `${load.minTemperature}° - ${load.maxTemperature}°${load.temperatureUnit || 'F'}`
            : "Temp Controlled"
          }
        </span>
      </div>
    );
  };

  const getRateDisplay = (load: LoadWithRelations) => {
    if (!load.rate) return "Rate TBD";
    
    return (
      <div className="flex items-center gap-1 text-green-700 font-medium">
        <DollarSign className="w-4 h-4" />
        {load.rate.toLocaleString()}
      </div>
    );
  };

  const getExpirationDisplay = (load: LoadWithRelations) => {
    if (!load.expiresAt) return null;

    const expirationDate = new Date(load.expiresAt.toString());
    const now = new Date();
    const timeLeft = expirationDate.getTime() - now.getTime();
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));

    if (timeLeft <= 0) {
      return (
        <div className="flex items-center gap-1 text-red-600 text-xs">
          <AlertTriangle className="w-3 h-3" />
          Expired
        </div>
      );
    }

    if (hoursLeft < 24) {
      return (
        <div className="flex items-center gap-1 text-yellow-600 text-xs">
          <Clock className="w-3 h-3" />
          {hoursLeft}h left
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1 text-gray-500 text-xs">
        <Calendar className="w-3 h-3" />
        {format(expirationDate, "MMM d")}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-20 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="h-32 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header with Stats */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">DAT Load Board</h1>
            <p className="text-gray-500">Real-time freight from DAT Power</p>
          </div>
          <Button 
            onClick={() => refetch()}
            className="flex items-center gap-2"
            data-testid="button-refresh-loads"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Available Loads</p>
                  <p className="text-2xl font-bold">{filteredLoads.filter(l => l.status === 'scheduled').length}</p>
                </div>
                <Truck className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Refrigerated</p>
                  <p className="text-2xl font-bold">{filteredLoads.filter(l => l.temperatureRequired).length}</p>
                </div>
                <Thermometer className="w-8 h-8 text-cyan-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Expiring Today</p>
                  <p className="text-2xl font-bold text-yellow-600">{(expirationStats as any)?.expiringToday || 0}</p>
                </div>
                <Clock className="w-8 h-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Avg Rate</p>
                  <p className="text-2xl font-bold text-green-600">
                    ${Math.round(filteredLoads.reduce((sum, l) => sum + (l.rate || 0), 0) / Math.max(filteredLoads.length, 1)).toLocaleString()}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 lg:space-x-4">
            <div className="flex-1 max-w-lg">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="Search by origin, destination, or company..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-dat-loads"
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
                <SelectTrigger className="w-40 bg-white border border-gray-300 shadow-sm">
                  <SelectValue placeholder="Equipment" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-300 shadow-lg z-50">
                  <SelectItem value="all">All Equipment</SelectItem>
                  <SelectItem value="sprinter_van">Sprinter Van</SelectItem>
                  <SelectItem value="van">Standard Van</SelectItem>
                  <SelectItem value="van_lift_gate">Van with Lift Gate</SelectItem>
                  <SelectItem value="van_hotshot">Van Hotshot</SelectItem>
                  <SelectItem value="straight_box_truck">Straight Box Truck</SelectItem>
                  <SelectItem value="box_truck">Box Truck</SelectItem>
                  <SelectItem value="moving_van">Moving Van</SelectItem>
                  <SelectItem value="flatbed">Flatbed</SelectItem>
                  <SelectItem value="flatbed_hotshot">Flatbed Hotshot</SelectItem>
                  <SelectItem value="step_deck">Step Deck</SelectItem>
                  <SelectItem value="lowboy">Lowboy</SelectItem>
                  <SelectItem value="dry_van">Dry Van</SelectItem>
                  <SelectItem value="refrigerated">Refrigerated</SelectItem>
                  <SelectItem value="power_only">Power Only</SelectItem>
                  <SelectItem value="container">Container</SelectItem>
                  <SelectItem value="car_carrier">Car Carrier</SelectItem>
                  <SelectItem value="tanker">Tanker</SelectItem>
                  <SelectItem value="dump_truck">Dump Truck</SelectItem>
                  <SelectItem value="conestoga">Conestoga</SelectItem>
                  <SelectItem value="removable_gooseneck">Removable Gooseneck (RGN)</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={temperatureFilter} onValueChange={setTemperatureFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Temperature" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="refrigerated">Temp Controlled</SelectItem>
                  <SelectItem value="dry">Dry Freight</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="scheduled">Available</SelectItem>
                  <SelectItem value="in_transit">Booked</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Load Cards - DAT Style */}
      <div className="space-y-4">
        {filteredLoads.map((load) => (
          <Card key={load.id} className="border border-gray-200 hover:shadow-md transition-shadow" data-testid={`dat-load-card-${load.id}`}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="text-lg font-bold text-primary">{load.loadNumber}</div>
                  {getEquipmentBadge(load)}
                  {getStatusBadge(load)}
                  {getExpirationDisplay(load)}
                </div>
                <div className="text-right">
                  {getRateDisplay(load)}
                  {load.miles && (
                    <div className="flex items-center gap-1 text-gray-600 text-sm mt-1">
                      <Navigation className="w-3 h-3" />
                      {load.miles} mi
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Route Information */}
                <div className="lg:col-span-2">
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-gray-500">PICKUP</span>
                      </div>
                      <div className="font-medium text-gray-900">{load.pickupAddress}</div>
                      <div className="text-sm text-gray-600">
                        {format(new Date(load.pickupDate), "MMM d, yyyy")} at {load.pickupTime}
                      </div>
                    </div>
                    
                    <div className="flex-shrink-0 text-gray-300">
                      <div className="w-8 h-px bg-gray-300 relative">
                        <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-2 border-r-2 border-t-2 border-gray-300 rotate-45"></div>
                      </div>
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-4 h-4 text-red-600" />
                        <span className="text-sm font-medium text-gray-500">DELIVERY</span>
                      </div>
                      <div className="font-medium text-gray-900">{load.deliveryAddress}</div>
                      <div className="text-sm text-gray-600">
                        {format(new Date(load.deliveryDate), "MMM d, yyyy")} by {load.deliveryTime}
                      </div>
                    </div>
                  </div>

                  {/* Temperature Requirements */}
                  {getTemperatureDisplay(load)}
                </div>

                {/* Load Details */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Weight className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">
                      Weight: <span className="font-medium">{load.weight.toLocaleString()} lbs</span>
                    </span>
                  </div>
                  
                  {load.company && (
                    <div className="flex items-center gap-2">
                      <Building className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{load.company}</span>
                    </div>
                  )}
                  
                  {load.contactPhone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">{load.contactPhone}</span>
                    </div>
                  )}

                  <div className="pt-2">
                    <Button 
                      onClick={() => handleBookLoad(load.id)}
                      disabled={bookLoadMutation.isPending || load.status === 'assigned' || load.status === 'in_transit' || load.status === 'delivered'}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400"
                      data-testid={`button-book-load-${load.id}`}
                    >
                      {bookLoadMutation.isPending ? "Booking..." : 
                       load.status === 'assigned' ? "Already Assigned" : 
                       load.status === 'in_transit' ? "In Transit" : 
                       load.status === 'delivered' ? "Delivered" : "Book This Load"}
                    </Button>
                  </div>
                </div>
              </div>

              {load.specialInstructions && (
                <>
                  <Separator className="my-4" />
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Special Instructions: </span>
                    {load.specialInstructions}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}

        {filteredLoads.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <Truck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No loads found</h3>
              <p className="text-gray-500">
                {searchTerm || equipmentFilter !== "all" || statusFilter !== "all" || temperatureFilter !== "all"
                  ? "Try adjusting your search filters to see more loads."
                  : "No DAT loads are currently available. Check back soon!"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}