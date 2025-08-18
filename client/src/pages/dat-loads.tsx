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
  RefreshCw,
  ExternalLink
} from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface DATLoad {
  id: string;
  loadNumber: string;
  description: string;
  origin: string;
  destination: string;
  pickupDate: string;
  deliveryDate: string;
  rate: number;
  miles: number;
  weight: number;
  equipmentType: string;
  status: string;
  priority: string;
  company: string;
  contact: string;
  commodity: string;
  createdAt: string;
  source: string;
  comments?: string;
}

export default function DATLoads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: loads = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/dat-loads"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time DAT updates
  });

  // Book load mutation
  const bookLoadMutation = useMutation({
    mutationFn: async (loadId: string) => {
      const response = await apiRequest("POST", `/api/loads/${loadId}/book`, {});
      return response.json();
    },
    onSuccess: (data, loadId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dat-loads"] });
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

  // Filter loads based on search and filters
  const filteredLoads = loads.filter((load: DATLoad) => {
    const matchesSearch = !searchTerm || 
      load.loadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.origin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.destination?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.commodity?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesEquipment = equipmentFilter === "all" || load.equipmentType === equipmentFilter;
    const matchesStatus = statusFilter === "all" || load.status === statusFilter;

    return matchesSearch && matchesEquipment && matchesStatus;
  });

  const getEquipmentIcon = (equipmentType: string) => {
    switch (equipmentType) {
      case 'refrigerated_truck':
        return <Thermometer className="w-4 h-4" />;
      case 'flatbed_truck':
        return <Truck className="w-4 h-4" />;
      case 'straight_box_truck':
        return <Truck className="w-4 h-4" />;
      default:
        return <Truck className="w-4 h-4" />;
    }
  };

  const getEquipmentBadge = (load: DATLoad) => {
    const equipmentDisplay = {
      straight_box_truck: { label: "Box Truck", className: "bg-blue-100 text-blue-800 border-blue-200" },
      refrigerated_truck: { label: "Reefer", className: "bg-cyan-100 text-cyan-800 border-cyan-200" },
      flatbed_truck: { label: "Flatbed", className: "bg-orange-100 text-orange-800 border-orange-200" },
      tractor_trailer: { label: "Tractor", className: "bg-purple-100 text-purple-800 border-purple-200" },
    };

    const config = equipmentDisplay[load.equipmentType as keyof typeof equipmentDisplay] || equipmentDisplay.straight_box_truck;
    
    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        {getEquipmentIcon(load.equipmentType)}
        {config.label}
      </Badge>
    );
  };

  const getStatusBadge = (load: DATLoad) => {
    const statusConfig = {
      available: { label: "Available", className: "bg-green-100 text-green-800 border-green-200", icon: "✓" },
      active: { label: "Active", className: "bg-blue-100 text-blue-800 border-blue-200", icon: "🔄" },
      booked: { label: "Booked", className: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: "📋" },
      completed: { label: "Completed", className: "bg-gray-100 text-gray-800 border-gray-200", icon: "✅" },
    };

    const config = statusConfig[load.status as keyof typeof statusConfig] || statusConfig.available;
    
    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        <span className="text-xs">{config.icon}</span>
        {config.label}
      </Badge>
    );
  };

  const getAgeInHours = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60));
    return diffHours;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatRate = (rate: number, miles: number) => {
    const ratePerMile = miles > 0 ? rate / miles : 0;
    return {
      total: formatCurrency(rate),
      perMile: `$${ratePerMile.toFixed(2)}/mi`
    };
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">DAT LoadLink Loads</h1>
          <p className="text-gray-600 mt-1">
            Real-time loads scraped from your DAT LoadLink account • Updates every 10 seconds
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => refetch()} 
            variant="outline" 
            size="sm"
            disabled={isLoading}
            data-testid="button-refresh-dat-loads"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          <div className="flex-1 max-w-lg">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="Search by origin, destination, company..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-dat-loads"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <Select value={equipmentFilter} onValueChange={setEquipmentFilter} data-testid="select-equipment-filter">
              <SelectTrigger className="w-48 bg-white border border-gray-300">
                <SelectValue placeholder="All Equipment" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Equipment</SelectItem>
                <SelectItem value="straight_box_truck">Box Truck</SelectItem>
                <SelectItem value="refrigerated_truck">Refrigerated</SelectItem>
                <SelectItem value="flatbed_truck">Flatbed</SelectItem>
                <SelectItem value="tractor_trailer">Tractor Trailer</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
              <SelectTrigger className="w-40 bg-white border border-gray-300">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-300 shadow-lg">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="booked">Booked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total DAT Loads</p>
                <p className="text-2xl font-bold text-gray-900">{loads.length}</p>
              </div>
              <Truck className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Available Now</p>
                <p className="text-2xl font-bold text-green-600">
                  {loads.filter((load: DATLoad) => load.status === 'available').length}
                </p>
              </div>
              <Clock className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Average Rate</p>
                <p className="text-2xl font-bold text-blue-600">
                  {loads.length > 0 ? formatCurrency(loads.reduce((sum: number, load: DATLoad) => sum + load.rate, 0) / loads.length) : '$0'}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Fresh Loads</p>
                <p className="text-2xl font-bold text-orange-600">
                  {loads.filter((load: DATLoad) => getAgeInHours(load.createdAt) < 1).length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DAT Loads Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mr-3" />
            <span className="text-gray-500">Loading DAT loads from LoadLink...</span>
          </div>
        ) : filteredLoads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Load ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origin</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Distance</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Equipment</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comments</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredLoads.map((load: DATLoad) => {
                  const ageHours = getAgeInHours(load.createdAt);
                  const rateInfo = formatRate(load.rate, load.miles);
                  
                  return (
                    <tr key={load.id} className="hover:bg-gray-50 transition-colors" data-testid={`dat-load-row-${load.id}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex items-center">
                          <Clock className="w-3 h-3 text-gray-400 mr-1" />
                          <span className={ageHours < 1 ? "text-green-600 font-medium" : "text-gray-600"}>
                            {ageHours < 1 ? "New" : `${ageHours}h`}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-blue-600">{load.loadNumber}</div>
                        <div className="text-xs text-gray-500">{load.commodity}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-bold text-green-600">{rateInfo.total}</div>
                        <div className="text-xs text-gray-500">{rateInfo.perMile}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900">
                          <MapPin className="w-3 h-3 text-gray-400 mr-1" />
                          {load.origin}
                        </div>
                        <div className="text-xs text-gray-500">
                          {load.pickupDate ? format(new Date(load.pickupDate), 'MMM d') : 'ASAP'}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center text-sm text-gray-900">
                          <Navigation className="w-3 h-3 text-gray-400 mr-1" />
                          {load.destination}
                        </div>
                        <div className="text-xs text-gray-500">
                          {load.deliveryDate ? format(new Date(load.deliveryDate), 'MMM d') : 'Flexible'}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {load.miles} mi
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getEquipmentBadge(load)}
                        <div className="text-xs text-gray-500 mt-1">{load.weight ? `${load.weight}lbs` : 'Any'}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{load.company}</div>
                        <div className="text-xs text-gray-500 flex items-center">
                          <Phone className="w-3 h-3 mr-1" />
                          {load.contact}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(load)}
                      </td>
                      <td className="px-4 py-3 text-sm max-w-xs">
                        <div className="bg-amber-50 border border-amber-200 rounded-md p-2">
                          <div className="text-xs font-medium text-amber-800 mb-1">DAT Comments:</div>
                          <div className="text-xs text-amber-700 break-words">
                            {load.comments || load.description?.includes('COMMENTS: ') 
                              ? load.description?.split('COMMENTS: ')[1] || load.comments || 'No specific comments from shipper'
                              : 'No specific comments from shipper'
                            }
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            onClick={() => handleBookLoad(load.id)}
                            disabled={bookLoadMutation.isPending || load.status !== 'available'}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            data-testid={`button-book-load-${load.id}`}
                          >
                            {bookLoadMutation.isPending ? "Booking..." : "Book"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Card className="m-6">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Truck className="w-12 h-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No DAT loads available
              </h3>
              <p className="text-gray-500 mb-4 max-w-md">
                {searchTerm || equipmentFilter !== "all" || statusFilter !== "all"
                  ? "Try adjusting your search filters to see more loads."
                  : "No DAT loads are currently being scraped. Check your DAT LoadLink connection and scraper status."}
              </p>
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <ExternalLink className="w-4 h-4" />
                <span>Connected to DAT LoadLink: dispatch@lampslogistics.com</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}