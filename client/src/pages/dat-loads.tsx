import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Search, 
  RefreshCw,
  MapPin, 
  DollarSign, 
  Truck, 
  Phone,
  Clock,
  Timer
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GoogleSheetsLoad {
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
  deadhead?: string;
  company?: string;
}

function DATLoads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [countdown, setCountdown] = useState(10);

  const { data: loads = [], isLoading, refetch } = useQuery<GoogleSheetsLoad[]>({
    queryKey: ["/api/dat-loads"],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Countdown timer for next refresh
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 10; // Reset to 10 seconds
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Reset countdown when data is refetched
  useEffect(() => {
    setCountdown(10);
  }, [loads]);

  // Filter loads based on search
  const filteredLoads = loads.filter((load: GoogleSheetsLoad) => {
    const matchesSearch = !searchTerm || 
      load.origin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.destination?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

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
          <div className="flex items-center gap-4 mt-1">
            <p className="text-gray-600">
              ✅ Google Sheets loads auto-imported every 10 seconds
            </p>
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1">
              <Timer className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">
                Next update in {countdown}s
              </span>
            </div>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            type="text"
            placeholder="Search by origin, destination..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Loads Display */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Google Sheets Freight Loads</h3>
          <p className="text-sm text-gray-500">({loads.length} loads available)</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Pay</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Total miles</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Pick Up</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Delivery</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">pick up date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Deadhead</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Weight</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Load Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Contact Info</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Company</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-500">Loading Google Sheets loads...</p>
                  </td>
                </tr>
              ) : filteredLoads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <Truck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium text-gray-500">No loads available</p>
                    <p className="text-sm text-gray-400">Check back later for new freight opportunities</p>
                  </td>
                </tr>
              ) : (
                filteredLoads.map((load: GoogleSheetsLoad) => (
                  <tr key={load.id} className="hover:bg-gray-50">
                    {/* Pay */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <DollarSign className="w-4 h-4 text-green-600 mr-1" />
                        <span className="font-bold text-green-600">{formatCurrency(load.rate)}</span>
                      </div>
                    </td>
                    {/* Total miles */}
                    <td className="px-4 py-4 text-gray-900">{load.miles}</td>
                    {/* Pick Up */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 text-green-600 mr-2" />
                        <span className="font-medium text-gray-900">{load.origin}</span>
                      </div>
                    </td>
                    {/* Delivery */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 text-red-600 mr-2" />
                        <span className="font-medium text-gray-900">{load.destination}</span>
                      </div>
                    </td>
                    {/* pick up date */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-orange-600 mr-1" />
                        <span className="text-gray-900">{load.pickup}</span>
                      </div>
                    </td>
                    {/* Deadhead */}
                    <td className="px-4 py-4 text-gray-900">{load.deadhead || 'N/A'}</td>
                    {/* Weight */}
                    <td className="px-4 py-4 text-gray-900">{load.weight}</td>
                    {/* Load Type */}
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {load.equipment}
                      </span>
                    </td>
                    {/* Contact Info */}
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <Phone className="w-4 h-4 text-blue-600 mr-1" />
                        <span className="text-gray-900">{load.phone}</span>
                      </div>
                    </td>
                    {/* Company */}
                    <td className="px-4 py-4 text-gray-900">{load.company || 'Unknown'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DATLoads;