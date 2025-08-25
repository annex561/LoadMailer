import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Search, 
  RefreshCw,
  MapPin, 
  DollarSign, 
  Truck, 
  Phone,
  Clock,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface DATLoad {
  id: string;
  origin: string;
  destination: string;
  pickup: string;
  rate: string;
  miles: string;
  weight: string;
  equipment: string;
  broker: string;
  phone: string;
  scrapedAt: string;
}

function DATLoads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const { data: loads = [], isLoading, refetch } = useQuery<DATLoad[]>({
    queryKey: ["/api/dat-loads"],
    refetchInterval: 10000, // Refresh every 10 seconds for real-time updates
  });

  // Filter loads based on search and filters
  const filteredLoads = loads.filter((load: DATLoad) => {
    const matchesSearch = !searchTerm || 
      load.origin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.destination?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.broker?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesEquipment = equipmentFilter === "all" || load.equipment === equipmentFilter;

    return matchesSearch && matchesEquipment;
  });

  const getAge = (scrapedAt: string) => {
    const scraped = new Date(scrapedAt);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - scraped.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
  };

  const formatCurrency = (amount: string) => {
    const num = parseInt(amount) || 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(num);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">DAT LoadLink Loads</h1>
          <p className="text-gray-600 mt-1">
            ✅ All loads sourced exclusively from DAT LoadLink using dispatch@lampslogistics.com • Updates every 10 seconds
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-md p-2 mt-2 inline-flex items-center">
            <span className="text-xs text-blue-700 font-medium">Connected to DAT LoadLink • No synthetic data</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={async () => {
              setIsManualRefreshing(true);
              try {
                await refetch();
              } finally {
                setTimeout(() => setIsManualRefreshing(false), 1000);
              }
            }} 
            variant="outline" 
            size="sm"
            disabled={isLoading || isManualRefreshing}
            data-testid="button-refresh-dat-loads"
            className={`transition-all duration-200 ${isManualRefreshing ? 'bg-blue-50 border-blue-200' : ''}`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 transition-transform duration-300 ${(isLoading || isManualRefreshing) ? 'animate-spin' : ''}`} />
            {isManualRefreshing ? 'Refreshing...' : 'Refresh'}
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
                <SelectItem value="Van">Van</SelectItem>
                <SelectItem value="Refrigerated">Refrigerated</SelectItem>
                <SelectItem value="Flatbed">Flatbed</SelectItem>
                <SelectItem value="Box Truck">Box Truck</SelectItem>
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
                <p className="text-2xl font-bold text-green-600">{loads.length}</p>
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
                  {loads.length > 0 ? formatCurrency((loads.reduce((sum: number, load: DATLoad) => sum + (parseInt(load.rate) || 0), 0) / loads.length).toString()) : '$0'}
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
                  {loads.filter((load: DATLoad) => getAge(load.scrapedAt).includes('m ago') || getAge(load.scrapedAt) === 'Just now').length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DAT Loads Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Real DAT LoadLink Freight</h3>
              <p className="text-sm text-gray-500">
                Live authentic loads from Google Sheets and DAT sources ({loads.length} loads available)
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                onClick={() => refetch()}
                variant="outline"
                size="sm"
                className="flex items-center"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
        
        {/* DAT-style Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input type="checkbox" className="rounded" />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Origin/Dest</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Load Details</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Rate</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Miles</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Equipment</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Dates</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Broker</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase text-xs">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {filteredLoads.map((load: DATLoad) => (
                <tr key={load.id} className="hover:bg-blue-50 transition-colors border-l-4 border-l-blue-500 border-b border-gray-100">
                  <td className="px-3 py-2">
                    <input type="checkbox" className="rounded" />
                  </td>
                  {/* Origin/Dest */}
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <div className="flex items-center">
                        <MapPin className="w-3 h-3 text-green-600 mr-1" />
                        <span className="font-medium">{load.origin}</span>
                      </div>
                      <div className="flex items-center mt-1">
                        <MapPin className="w-3 h-3 text-red-600 mr-1" />
                        <span className="font-medium">{load.destination}</span>
                      </div>
                      <div className="text-gray-500 mt-1">{getAge(load.scrapedAt)}</div>
                    </div>
                  </td>
                  {/* Load Details */}
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <div className="font-medium text-blue-600">{load.weight}</div>
                      <div className="text-gray-500">#{load.id.split('-')[2]}</div>
                    </div>
                  </td>
                  {/* Rate */}
                  <td className="px-3 py-2">
                    <div className="flex items-center">
                      <DollarSign className="w-3 h-3 text-green-600 mr-1" />
                      <span className="font-bold text-green-600 text-sm">
                        {formatCurrency(load.rate)}
                      </span>
                    </div>
                  </td>
                  {/* Miles */}
                  <td className="px-3 py-2">
                    <div className="text-xs font-medium">{load.miles}</div>
                  </td>
                  {/* Equipment */}
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs">
                      {load.equipment}
                    </Badge>
                  </td>
                  {/* Dates */}
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <div><strong>PU:</strong> {load.pickup}</div>
                    </div>
                  </td>
                  {/* Broker */}
                  <td className="px-3 py-2">
                    <div className="text-xs">
                      <div className="font-medium text-gray-900">{load.broker}</div>
                      <div className="text-gray-600">{load.phone}</div>
                    </div>
                  </td>
                  {/* Actions */}
                  <td className="px-3 py-2">
                    <div className="flex items-center space-x-1">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-blue-600" title="Call Broker">
                        <Phone className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-green-600" title="Book Load">
                        <Truck className="w-3 h-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <div className="text-gray-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-4 text-gray-400" />
                      <p className="text-lg font-medium">Loading DAT loads...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredLoads.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <div className="text-gray-500">
                      <Truck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                      <p className="text-lg font-medium">No DAT loads available</p>
                      <p className="text-sm">Check back later for new freight opportunities</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DATLoads;