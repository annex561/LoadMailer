import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { ArrowRight, Truck, Phone, RefreshCw } from "lucide-react";

interface GALoad {
  id: string;
  load_number?: string;
  origin_city: string;
  origin_state: string;
  dest_city: string;
  dest_state: string;
  broker_name?: string;
  broker_phone?: string;
  assigned_driver_id?: string;
  assigned_truck_id?: string;
  status: string;
  rate_total?: number;
  booked_rate?: number;
  miles?: number;
  sop_progress?: Record<string, boolean>;
}

export default function ActiveLoads() {
  const { data, isLoading, refetch, isFetching } = useQuery<{ ok: boolean; loads: GALoad[] }>({
    queryKey: ["/api/ga/loads", { includeAssigned: "true" }],
    queryFn: async () => {
      const res = await fetch("/api/ga/loads?includeAssigned=true&limit=200");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const activeLoads = data?.loads?.filter((load: GALoad) => 
    ["dispatched", "in_transit", "delivered"].includes(load.status)
  ) || [];

  if (isLoading) return <div className="p-8">Loading Active Fleet...</div>;

  return (
    <div className="p-6 space-y-6 bg-slate-50 dark:bg-slate-900 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Active Loads</h1>
          <p className="text-slate-500 dark:text-slate-400">Real-time tracking of dispatched freight.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Badge variant="outline" className="text-lg px-4 py-1 bg-white dark:bg-slate-800">
            {activeLoads.length} Trucks Rolling
          </Badge>
        </div>
      </div>

      <div className="grid gap-6">
        {activeLoads.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-xl border border-dashed dark:border-slate-700">
            <p className="text-slate-400">No active loads. Go to "RateCon Inbox" to book one.</p>
            <Link href="/loads-inbox">
              <Button className="mt-4" variant="outline">Go to RateCon Inbox</Button>
            </Link>
          </div>
        ) : (
          activeLoads.map((load: GALoad) => (
            <ActiveLoadCard key={load.id} load={load} />
          ))
        )}
      </div>
    </div>
  );
}

function ActiveLoadCard({ load }: { load: GALoad }) {
  const steps = load.sop_progress || {};
  const completedSteps = Object.values(steps).filter(Boolean).length;
  const progressPercent = (completedSteps / 13) * 100;
  
  const getNextStep = () => {
    if (!steps.initialSms) return "Waiting: Send Load Details";
    if (!steps.tripMessage) return "Waiting: Driver Trip Msg";
    if (!steps.puArrived) return "Transit: Arriving at Pickup";
    if (!steps.puDocs) return "Action: Upload Pickup Docs";
    if (!steps.brokerConfirmed) return "Admin: Confirm w/ Broker";
    if (!steps.driverReleased) return "Transit: En Route to Delivery";
    if (!steps.docsToEinstein) return "Final: Upload POD/Invoice";
    return "Load Complete";
  };

  const getStatusColor = () => {
    switch (load.status) {
      case "dispatched": return "border-l-blue-600";
      case "in_transit": return "border-l-amber-500";
      case "delivered": return "border-l-emerald-500";
      default: return "border-l-slate-400";
    }
  };

  const getStatusBadge = () => {
    switch (load.status) {
      case "dispatched": return <Badge className="bg-blue-100 text-blue-700 border-0">Dispatched</Badge>;
      case "in_transit": return <Badge className="bg-amber-100 text-amber-700 border-0">In Transit</Badge>;
      case "delivered": return <Badge className="bg-emerald-100 text-emerald-700 border-0">Delivered</Badge>;
      default: return <Badge variant="secondary">{load.status}</Badge>;
    }
  };

  return (
    <Card className={`hover:shadow-md transition-shadow border-l-4 ${getStatusColor()} dark:bg-slate-800`}>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row gap-6 items-center">
          
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-0">
                #{load.load_number || load.id.slice(0, 8)}
              </Badge>
              {getStatusBadge()}
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {load.broker_name || "Unknown Broker"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-lg font-bold text-slate-800 dark:text-white">
              <span>{load.origin_city}, {load.origin_state}</span>
              <ArrowRight className="w-5 h-5 text-slate-400" />
              <span>{load.dest_city}, {load.dest_state}</span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex gap-4">
              <span className="flex items-center gap-1">
                <Truck className="w-3 h-3"/> 
                Driver #{load.assigned_driver_id || "Unassigned"}
              </span>
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3"/> 
                {load.broker_phone || "No Phone"}
              </span>
              {load.booked_rate && (
                <span className="font-semibold text-emerald-600">
                  ${load.booked_rate.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 w-full md:w-auto">
            <div className="flex justify-between text-xs mb-2 font-medium">
              <span className="text-blue-600 dark:text-blue-400">{getNextStep()}</span>
              <span className="text-slate-400">{completedSteps} / 13 Steps</span>
            </div>
            <Progress value={progressPercent} className="h-2 bg-slate-100 dark:bg-slate-700" />
          </div>

          <div>
            <Link href={`/driver/load/${load.id}`}>
              <Button className="bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600">
                Manage Load
              </Button>
            </Link>
          </div>

        </div>
      </CardContent>
    </Card>
  );
}
