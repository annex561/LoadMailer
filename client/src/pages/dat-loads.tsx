import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  RefreshCw,
  MapPin,
  DollarSign,
  Truck,
  Phone,
  Clock,
  Timer,
  User,
  Zap,
  CheckCircle,
  XCircle,
  Navigation,
  Settings,
  TrendingUp,
  AlertTriangle,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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

interface HotLoad {
  id: string;
  sourceLoadId: string;
  origin: string;
  destination: string;
  pickupDate: string;
  rate: number;
  miles: number;
  rpm: number;
  score: number;
  weight?: string;
  equipment?: string;
  broker?: string;
  brokerPhone?: string;
  company?: string;
  matchedDriverId?: string;
  matchedDriverName?: string;
  matchedDriverPhone?: string;
  driverDistanceMiles?: number;
  status: 'pending' | 'dispatched' | 'dismissed';
  createdAt: string;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-gray-400";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-white ${color}`}>
      <TrendingUp className="w-3 h-3" />
      {score}
    </span>
  );
}

function HotLoadCard({ hotLoad, onDispatch, onDismiss, isDispatching }: {
  hotLoad: HotLoad;
  onDispatch: (id: string) => void;
  onDismiss: (id: string) => void;
  isDispatching: boolean;
}) {
  return (
    <div className="bg-white border-2 border-amber-300 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <span className="font-bold text-gray-900 text-sm">
            {hotLoad.origin} → {hotLoad.destination}
          </span>
        </div>
        <ScoreBadge score={hotLoad.score} />
      </div>

      {/* Rate / Miles / RPM */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-green-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500">Rate</p>
          <p className="font-bold text-green-700">${hotLoad.rate.toLocaleString()}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500">Miles</p>
          <p className="font-bold text-blue-700">{hotLoad.miles}</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-2 text-center">
          <p className="text-xs text-gray-500">RPM</p>
          <p className="font-bold text-purple-700">${hotLoad.rpm.toFixed(2)}</p>
        </div>
      </div>

      {/* Matched Driver */}
      {hotLoad.matchedDriverName ? (
        <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-2 mb-3 text-sm">
          <Navigation className="w-4 h-4 text-indigo-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="font-medium text-gray-800">{hotLoad.matchedDriverName}</span>
            {hotLoad.driverDistanceMiles !== undefined && hotLoad.driverDistanceMiles > 0 && (
              <span className="text-gray-500 ml-1">· {hotLoad.driverDistanceMiles} mi away</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-amber-50 rounded-lg p-2 mb-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-amber-700">No driver GPS on file — manual assignment needed</span>
        </div>
      )}

      {/* Equipment & weight */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
        {hotLoad.equipment && <Badge variant="secondary">{hotLoad.equipment}</Badge>}
        {hotLoad.weight && <span>{hotLoad.weight} lbs</span>}
        {hotLoad.broker && <span className="truncate">· {hotLoad.broker}</span>}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          onClick={() => onDispatch(hotLoad.id)}
          disabled={isDispatching}
        >
          <Send className="w-3 h-3 mr-1" />
          {isDispatching ? "Sending..." : "Dispatch SMS"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-500 hover:bg-red-50"
          onClick={() => onDismiss(hotLoad.id)}
        >
          <XCircle className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function DATLoads() {
  const [searchTerm, setSearchTerm] = useState("");
  const [countdown, setCountdown] = useState(10);
  const [showCriteria, setShowCriteria] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Google Sheets loads (all loads)
  const { data: loads = [], isLoading, refetch, dataUpdatedAt } = useQuery<GoogleSheetsLoad[]>({
    queryKey: ["/api/dat-loads"],
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
  });

  // Hot loads (auto-matched by scorer)
  const { data: hotLoads = [], refetch: refetchHotLoads } = useQuery<HotLoad[]>({
    queryKey: ["/api/hot-loads"],
    refetchInterval: 30000, // check every 30s
  });

  // Dispatch criteria
  const { data: criteria } = useQuery({
    queryKey: ["/api/dispatch-criteria"],
  });

  // Fetch available drivers
  const { data: drivers = [] } = useQuery({
    queryKey: ["/api/drivers"],
    queryFn: async () => {
      const response = await fetch("/api/drivers");
      return response.json();
    }
  });

  // Driver assignment mutation
  const assignDriverMutation = useMutation({
    mutationFn: async ({ loadId, driverId }: { loadId: string; driverId: string }) => {
      return apiRequest('POST', `/api/loads/${loadId}/manual-assign`, {
        driverId,
        dispatcherId: 'dat-dispatcher',
        dispatcherName: 'DAT Loads Dispatcher',
        actionType: 'manual_assign',
        reasonCode: 'dat_assign',
        reasonDescription: 'Assignment from DAT Loads interface'
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Driver assigned successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to assign driver.", variant: "destructive" });
    }
  });

  // Dispatch hot load SMS
  const handleDispatch = async (id: string) => {
    setDispatchingId(id);
    try {
      const res = await fetch(`/api/hot-loads/${id}/dispatch`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast({ title: "✅ Dispatched!", description: "SMS sent to driver successfully." });
        refetchHotLoads();
      } else {
        toast({ title: "Error", description: data.error || "Dispatch failed.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
    } finally {
      setDispatchingId(null);
    }
  };

  // Dismiss hot load
  const handleDismiss = async (id: string) => {
    try {
      await fetch(`/api/hot-loads/${id}/dismiss`, { method: 'POST' });
      refetchHotLoads();
    } catch { /* noop */ }
  };

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = (Date.now() / 1000) % 10;
      setCountdown(Math.max(0, Math.ceil(10 - elapsed)));
    }, 100);
    return () => clearInterval(timer);
  }, [dataUpdatedAt]);

  // Filter loads based on search
  const filteredLoads = loads.filter((load: GoogleSheetsLoad) =>
    !searchTerm ||
    load.origin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    load.destination?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount: string) => {
    const num = parseInt(amount) || 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(num);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">DAT Load Board</h1>
          <div className="flex items-center gap-4 mt-1">
            <p className="text-gray-600">✅ Auto-importing every 10 seconds · {loads.length} loads available</p>
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1">
              <Timer className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">Next update in {countdown}s</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCriteria(!showCriteria)} variant="outline" size="sm">
            <Settings className="w-4 h-4 mr-2" />
            Criteria
          </Button>
          <Button onClick={() => { refetch(); refetchHotLoads(); }} variant="outline" size="sm">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Hot Loads Section ── */}
      {hotLoads.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-bold text-amber-900">
              🔥 Hot Loads — Auto-Matched to Drivers
            </h2>
            <Badge className="bg-amber-500 text-white ml-1">{hotLoads.length} ready</Badge>
            <p className="text-sm text-amber-700 ml-2">
              Scored ≥50 RPM · Nearest driver matched by GPS · One click to dispatch
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {hotLoads.map((hl) => (
              <HotLoadCard
                key={hl.id}
                hotLoad={hl}
                onDispatch={handleDispatch}
                onDismiss={handleDismiss}
                isDispatching={dispatchingId === hl.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Dispatch Criteria Panel ── */}
      {showCriteria && criteria && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Ideal Load Criteria (used for auto-matching)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Min RPM</p>
              <p className="font-bold text-gray-900">${(criteria as any).minRPM?.toFixed(2)}/mi</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Min Miles</p>
              <p className="font-bold text-gray-900">{(criteria as any).minMiles} mi</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Max Deadhead</p>
              <p className="font-bold text-gray-900">{(criteria as any).maxDeadheadMiles} mi</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Preferred Origins</p>
              <p className="font-bold text-gray-900 text-xs">{(criteria as any).preferredOriginStates?.join(", ")}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">To change criteria: contact your developer or use <code>/api/dispatch-criteria</code> PUT endpoint.</p>
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
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

      {/* All Loads Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">All Available Loads</h3>
          <p className="text-sm text-gray-500">({filteredLoads.length} shown)</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Pay</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Miles</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Pick Up</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Delivery</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Deadhead</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Weight</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Contact</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Company</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Assign Driver</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-500">Loading loads...</p>
                  </td>
                </tr>
              ) : filteredLoads.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center">
                    <Truck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium text-gray-500">No loads available</p>
                    <p className="text-sm text-gray-400">Check back later for new freight opportunities</p>
                  </td>
                </tr>
              ) : (
                filteredLoads.map((load: GoogleSheetsLoad) => (
                  <tr key={load.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <DollarSign className="w-4 h-4 text-green-600 mr-1" />
                        <span className="font-bold text-green-600">{formatCurrency(load.rate)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-900">{load.miles}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 text-green-600 mr-2" />
                        <span className="font-medium text-gray-900">{load.origin}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <MapPin className="w-4 h-4 text-red-600 mr-2" />
                        <span className="font-medium text-gray-900">{load.destination}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-orange-600 mr-1" />
                        <span className="text-gray-900">{load.pickup}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-900">{load.deadhead || 'N/A'}</td>
                    <td className="px-4 py-4 text-gray-900">{load.weight}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {load.equipment}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <Phone className="w-4 h-4 text-blue-600 mr-1" />
                        <span className="text-gray-900">{load.phone}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-900">{load.company || 'Unknown'}</td>
                    <td className="px-4 py-4">
                      <Select onValueChange={(driverId) => {
                        if (driverId && load.id) {
                          assignDriverMutation.mutate({ loadId: load.id, driverId });
                        }
                      }}>
                        <SelectTrigger className="w-40 bg-white border border-gray-300">
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-gray-300 shadow-lg">
                          {drivers
                            .filter((driver: any) => driver.status === 'available')
                            .map((driver: any) => (
                              <SelectItem key={driver.id} value={driver.id}>
                                <div className="flex items-center">
                                  <User className="w-4 h-4 mr-2 text-blue-600" />
                                  {driver.name}
                                </div>
                              </SelectItem>
                            ))}
                          {drivers.filter((driver: any) => driver.status === 'available').length === 0 && (
                            <SelectItem value="none" disabled>No available drivers</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </td>
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
