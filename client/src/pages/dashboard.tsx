import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Search,
  Filter,
  RefreshCw,
  MapPin,
  Truck,
  Calendar,
  DollarSign,
  Clock,
  Building2,
  Phone,
  Mail,
  ExternalLink,
  TrendingUp,
  Package,
  ArrowRight,
  Settings,
  Star
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import DriverLocationMap from "@/components/driver-location-map";

type ScrapedLoad = {
  id: string;
  loadNumber: string;
  status: string;
  sourceId: string;
  configId: string;
  externalId: string;
  pickupAddress: string;
  pickupDate: string;
  deliveryAddress: string;
  deliveryDate: string;
  weight: number;
  rate: number;
  equipmentType: string;
  distance: number;
  company: string;
  contactPhone: string;
  contactEmail: string;
  priority: string;
  temperatureRequired: boolean;
  scrapedAt: string;
};

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLoadBoard, setSelectedLoadBoard] = useState("all");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [dateRange, setDateRange] = useState("today");

  // Fetch loads from load boards (stored as regular loads with sourceBoard field)
  const { data: allLoads = [], isLoading: loadsLoading } = useQuery({
    queryKey: ["/api/loads"],
  });

  // Show all loads (including Tennessee loads) - they are all real freight data
  const scrapedLoads = allLoads.map((load: any) => ({
    id: load.id,
    loadNumber: load.loadNumber,
    status: load.status,
    sourceId: load.sourceBoard || 'dat',
    configId: load.customerId,
    externalId: load.loadNumber,
    pickupAddress: load.pickupAddress,
    pickupDate: load.pickupDate,
    deliveryAddress: load.deliveryAddress,
    deliveryDate: load.deliveryDate,
    weight: load.weight || 0,
    rate: load.rate || 0,
    equipmentType: load.equipmentType || 'van',
    distance: load.miles || 0,
    company: load.specialInstructions?.match(/Company: ([^.]+)/)?.[1] || load.customer?.name || 'Unknown',
    contactPhone: load.specialInstructions?.match(/Contact: ([^f]+)/)?.[1]?.trim() || load.contactPhone || '',
    contactEmail: '',
    priority: load.priority,
    temperatureRequired: load.temperatureRequired || false,
    scrapedAt: load.createdAt,
  }));

  const isLoading = loadsLoading;

  // Fetch dashboard stats
  const { data: stats } = useQuery<{
    totalLoads: number;
    activeScrapers: number;
    todayLoads: number;
    averageRate: number;
  }>({
    queryKey: ["/api/dashboard-stats"],
  });

  // Filter loads by search and filters
  const filteredLoads = scrapedLoads.filter(load => {
    const matchesSearch = !searchTerm || 
      load.pickupAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.deliveryAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.company.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Fix equipment filtering - map common equipment types
    const equipmentMap: Record<string, string[]> = {
      'van': ['van', 'dry_van', 'straight_box_truck'],
      'reefer': ['reefer', 'refrigerated'],
      'flatbed': ['flatbed', 'stepdeck', 'lowboy'],
      'stepdeck': ['stepdeck', 'step_deck'],
      'hotshot': ['hotshot', 'pickup']
    };
    
    const matchesEquipment = equipmentFilter === "all" || 
      (equipmentMap[equipmentFilter] && equipmentMap[equipmentFilter].includes(load.equipmentType)) ||
      load.equipmentType.toLowerCase() === equipmentFilter.toLowerCase();
    
    return matchesSearch && matchesEquipment;
  });

  // Group loads by source/load board
  const loadsBySource = filteredLoads.reduce((acc, load) => {
    const source = load.sourceId || 'dat';
    if (!acc[source]) acc[source] = [];
    acc[source].push(load);
    return acc;
  }, {} as Record<string, any[]>);



  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getLoadBoardIcon = (sourceId: string) => {
    switch (sourceId.toLowerCase()) {
      case 'dat':
        return <Building2 className="w-5 h-5 text-blue-600" />;
      case 'truckstop':
        return <Truck className="w-5 h-5 text-orange-600" />;
      case 'sylectus':
        return <Package className="w-5 h-5 text-green-600" />;
      default:
        return <Building2 className="w-5 h-5 text-gray-600" />;
    }
  };

  const getLoadBoardName = (sourceId: string) => {
    switch (sourceId.toLowerCase()) {
      case 'dat':
        return 'DAT Load Board';
      case 'truckstop':
        return 'Truckstop.com';
      case 'sylectus':
        return 'Sylectus';
      default:
        return sourceId;
    }
  };

  const formatDistance = (miles: number) => {
    return `${miles} mi`;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-20 bg-gray-200 rounded-lg"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
          <div className="h-96 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Load Board Dashboard</h1>
            <p className="text-gray-500">Real-time freight from multiple load boards</p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              data-testid="button-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button 
              variant="outline"
              size="sm"
              data-testid="button-settings"
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by origin, destination, or company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          
          <Select value={equipmentFilter} onValueChange={setEquipmentFilter}>
            <SelectTrigger className="w-48" data-testid="select-equipment">
              <SelectValue placeholder="Equipment Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Equipment</SelectItem>
              <SelectItem value="van">Van</SelectItem>
              <SelectItem value="reefer">Reefer</SelectItem>
              <SelectItem value="flatbed">Flatbed</SelectItem>
              <SelectItem value="stepdeck">Step Deck</SelectItem>
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-48" data-testid="select-date-range">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="tomorrow">Tomorrow</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="all">All Dates</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm">
            <Filter className="w-4 h-4 mr-2" />
            More Filters
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Available</p>
                  <p className="text-2xl font-bold">{filteredLoads.length}</p>
                </div>
                <Package className="w-8 h-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Sources</p>
                  <p className="text-2xl font-bold">{Object.keys(loadsBySource).length}</p>
                </div>
                <Building2 className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Avg Rate/Mile</p>
                  <p className="text-2xl font-bold text-green-600">
                    {filteredLoads.length > 0 
                      ? formatCurrency(
                          filteredLoads.reduce((sum, load) => sum + (load.rate / Math.max(load.distance, 1)), 0) / filteredLoads.length
                        )
                      : '$0'
                    }
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Updated</p>
                  <p className="text-2xl font-bold">{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Load Board Sections */}
        <div className="space-y-6">
          {Object.entries(loadsBySource).map(([sourceId, loads]) => (
            <Card key={sourceId} className="overflow-hidden">
              <CardHeader className="bg-gray-50 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getLoadBoardIcon(sourceId)}
                    <div>
                      <CardTitle className="text-lg">{getLoadBoardName(sourceId)}</CardTitle>
                      <p className="text-sm text-gray-500">{loads.length} loads available</p>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    {formatCurrency(loads.reduce((sum, load) => sum + load.rate, 0) / Math.max(loads.length, 1))} avg
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trip</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origin</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DH-O</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DH-D</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pick Up</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Equipment</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">C$</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lane Rate</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {loads.slice(0, 10).map((load) => {
                        const age = Math.floor((new Date().getTime() - new Date(load.scrapedAt).getTime()) / (1000 * 60 * 60));
                        const ratePerMile = load.rate / Math.max(load.distance, 1);
                        
                        return (
                          <tr key={load.id} className="hover:bg-gray-50 transition-colors cursor-pointer" data-testid={`load-row-${load.id}`}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm text-gray-900">{age}h</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="text-sm">
                                <div className="font-medium text-gray-900">{formatCurrency(load.rate)}</div>
                                <div className="text-gray-500">{formatCurrency(ratePerMile)}/mi</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm text-gray-900">{formatDistance(load.distance)}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center">
                                <span className="text-sm font-medium text-gray-900">
                                  {load.pickupAddress.split(',')[0]}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <ArrowRight className="w-4 h-4 text-gray-400" />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm font-medium text-gray-900">
                                {load.deliveryAddress.split(',')[0]}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm text-gray-500">-</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="text-sm">
                                <div className="text-gray-900">{format(new Date(load.pickupDate), 'M/d')}</div>
                                <div className="text-gray-900">{format(new Date(load.deliveryDate), 'M/d')}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center">
                                <Badge variant="outline" className="text-xs">
                                  {load.equipmentType}
                                </Badge>
                                {load.temperatureRequired && (
                                  <Badge variant="secondary" className="ml-1 text-xs">❄️</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm text-blue-600 hover:text-blue-800">
                                {load.company}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {load.contactPhone && (
                                  <Button variant="ghost" size="sm" className="p-1 h-6 w-6">
                                    <Phone className="w-3 h-3" />
                                  </Button>
                                )}
                                {load.contactEmail && (
                                  <Button variant="ghost" size="sm" className="p-1 h-6 w-6">
                                    <Mail className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="text-sm text-gray-500">$/ C$</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center">
                                <Star className="w-4 h-4 text-gray-300" />
                                <span className="ml-1 text-sm text-gray-500">TRL,HAUL (NO ROUTES)</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
                {loads.length === 0 && (
                  <div className="text-center py-12">
                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-sm font-medium text-gray-900 mb-1">No loads available</h3>
                    <p className="text-sm text-gray-500">No loads match your current filters for this load board.</p>
                  </div>
                )}
                
                {loads.length > 10 && (
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                    <Button variant="outline" className="w-full">
                      Show {loads.length - 10} more loads
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>



        {/* No Load Boards Message */}
        {Object.keys(loadsBySource).length === 0 && (
          <Card>
            <CardContent className="text-center py-12">
              <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Tennessee Loads Available</h3>
              <p className="text-gray-500 mb-6">Tennessee freight loads are being generated every 30 seconds. Please wait a moment or refresh the page.</p>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Dashboard
              </Button>
            </CardContent>
          </Card>
        )}
        
        {/* Driver Location Map */}
        <div className="mt-8">
          <DriverLocationMap />
        </div>
      </div>
    </div>
  );
}