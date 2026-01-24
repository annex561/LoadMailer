import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Truck, MessageSquare, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export default function DispatcherWorkbench() {
  const { data: loads, isLoading: loadsLoading } = useQuery<any[]>({
    queryKey: ["/api/loads"],
  });

  const { data: drivers, isLoading: driversLoading } = useQuery<any[]>({
    queryKey: ["/api/drivers"],
  });

  const activeLoads = loads?.filter(l => l.status === "in_transit" || l.lifecycleStatus === "in_transit") || [];
  const unassignedLoads = loads?.filter(l => !l.driverId && l.status !== "delivered" && l.status !== "cancelled") || [];
  const atRiskLoads = loads?.filter(l => l.status === "late" || l.priority === "urgent") || [];
  const availableDrivers = drivers?.filter(d => d.status === "available") || [];

  if (loadsLoading || driversLoading) {
    return (
      <div className="flex justify-center items-center h-full bg-slate-100 dark:bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-900 p-6 gap-6 overflow-y-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dispatch Operations</h1>
          <p className="text-slate-500 dark:text-slate-400">Active Loads & Fleet Status</p>
        </div>
        <div className="flex gap-2">
          <Link href="/sms-dispatching">
            <Button variant="outline">
              <MessageSquare className="mr-2 h-4 w-4" />
              Messages
            </Button>
          </Link>
          <Link href="/manual-load-entry">
            <Button className="bg-blue-600 hover:bg-blue-700">+ Book New Load</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <OpsCard
          title="Active Loads"
          value={activeLoads.length.toString()}
          icon={<Truck className="w-5 h-5 text-blue-600" />}
          status="In Transit"
        />
        <OpsCard
          title="Unassigned Loads"
          value={unassignedLoads.length.toString()}
          icon={<AlertCircle className="w-5 h-5 text-amber-600" />}
          status="Needs Coverage"
          alert={unassignedLoads.length > 0}
        />
        <OpsCard
          title="Available Drivers"
          value={availableDrivers.length.toString()}
          icon={<MapPin className="w-5 h-5 text-emerald-600" />}
          status="Ready for Dispatch"
        />
        <OpsCard
          title="At Risk"
          value={atRiskLoads.length.toString()}
          icon={<AlertCircle className="w-5 h-5 text-red-600" />}
          status="Late / Issues"
          alert={atRiskLoads.length > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        <Card className="lg:col-span-1 border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg">Priority List</CardTitle>
              <Button variant="ghost" size="sm">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-3 pt-2">
            {atRiskLoads.length === 0 && unassignedLoads.length === 0 && activeLoads.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No priority loads</p>
            ) : (
              <>
                {atRiskLoads.map((load) => (
                  <LoadItem
                    key={load.id}
                    id={load.loadNumber}
                    loadId={load.id}
                    origin={`${load.originCity || "Origin"}, ${load.originState || ""}`}
                    dest={`${load.destCity || "Dest"}, ${load.destState || ""}`}
                    status="Late"
                  />
                ))}
                {unassignedLoads.slice(0, 5).map((load) => (
                  <LoadItem
                    key={load.id}
                    id={load.loadNumber}
                    loadId={load.id}
                    origin={`${load.originCity || "Origin"}, ${load.originState || ""}`}
                    dest={`${load.destCity || "Dest"}, ${load.destState || ""}`}
                    status="Unassigned"
                  />
                ))}
                {activeLoads.slice(0, 5).map((load) => (
                  <LoadItem
                    key={load.id}
                    id={load.loadNumber}
                    loadId={load.id}
                    origin={`${load.originCity || "Origin"}, ${load.originState || ""}`}
                    dest={`${load.destCity || "Dest"}, ${load.destState || ""}`}
                    status="On Time"
                  />
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <CardHeader className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 pb-3">
            <div className="flex justify-between items-center">
              <CardTitle>Live Fleet Map</CardTitle>
              <Badge variant="outline" className="text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800">
                Live Updates
              </Badge>
            </div>
          </CardHeader>
          <div className="h-[500px] bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
            <div className="text-center text-slate-500 dark:text-slate-400">
              <MapPin className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Map integration available</p>
              <Link href="/gps-tracking">
                <Button variant="link" size="sm" className="mt-2">
                  Open Full GPS Tracking
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <Card className="border-slate-200 dark:border-slate-700 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Available Drivers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {availableDrivers.length === 0 ? (
              <p className="text-sm text-slate-500 col-span-full text-center py-4">No available drivers</p>
            ) : (
              availableDrivers.slice(0, 12).map((driver) => (
                <div
                  key={driver.id}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-colors"
                >
                  <p className="font-medium text-sm text-slate-800 dark:text-slate-200 truncate">
                    {driver.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {driver.equipmentType || "Dry Van"}
                  </p>
                  <Badge variant="secondary" className="mt-1 text-[10px]">
                    Available
                  </Badge>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OpsCard({
  title,
  value,
  icon,
  status,
  alert,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  status: string;
  alert?: boolean;
}) {
  return (
    <Card
      className={`border shadow-sm ${
        alert ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20" : "bg-white dark:bg-slate-800"
      }`}
    >
      <div className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
          <p className={`text-xs ${alert ? "text-red-600 font-bold" : "text-slate-400"}`}>{status}</p>
        </div>
        <div className={`p-2 rounded-full ${alert ? "bg-white dark:bg-slate-700" : "bg-slate-100 dark:bg-slate-700"}`}>
          {icon}
        </div>
      </div>
    </Card>
  );
}

function LoadItem({
  id,
  loadId,
  origin,
  dest,
  status,
}: {
  id: string;
  loadId: string;
  origin: string;
  dest: string;
  status: string;
}) {
  const isLate = status === "Late";
  const isUnassigned = status === "Unassigned";

  return (
    <Link href={`/loads/${loadId}`}>
      <div
        className={`p-3 rounded border cursor-pointer transition-colors ${
          isLate
            ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30"
            : isUnassigned
            ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30"
            : "border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
        }`}
      >
        <div className="flex justify-between mb-1">
          <span className="font-bold text-sm text-slate-700 dark:text-slate-200">#{id}</span>
          <Badge
            variant={isLate ? "destructive" : isUnassigned ? "secondary" : "outline"}
            className="text-[10px] h-5"
          >
            {status}
          </Badge>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
          {origin} <span className="text-slate-300 dark:text-slate-600">➔</span> {dest}
        </div>
      </div>
    </Link>
  );
}
