import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Search,
  ArrowRight,
  Bot,
  AlertCircle,
  CheckCircle2,
  Clock,
  Truck,
  Activity,
  RefreshCw,
} from "lucide-react";
import { getLifecycleStatus, PHASE_COLOR_MAP } from "@/components/load-lifecycle/EVChecklist";
import { cn } from "@/lib/utils";

/**
 * Live Tracking — the dispatcher's command-center view of every in-flight load.
 *
 * Each card shows: load #, broker, route, current lifecycle phase, current
 * step, who's working on it (AI vs human), and a progress bar. Click a card
 * to drill into the full lifecycle panel on the load detail page.
 *
 * Refreshes every 5 seconds so a status change (driver replies YES, BOL
 * uploads, etc.) propagates without a manual reload.
 */

interface Load {
  id: string;
  loadNumber?: string;
  brokerName?: string;
  originCity?: string;
  originState?: string;
  destCity?: string;
  destState?: string;
  status?: string;
  rate?: number;
  sopProgress?: Record<string, boolean>;
  driverConfirmedAt?: string;
  driverId?: string;
  pickupDate?: string;
  deliveryDate?: string;
  assignedDriverName?: string;
}

const STATUS_FILTERS = {
  all: "All Active",
  booking: "Booking",
  pickup: "At Pickup",
  transit: "In Transit",
  delivery: "Delivering",
  settlement: "Settling",
  complete: "Complete",
} as const;

type FilterKey = keyof typeof STATUS_FILTERS;

function phaseToFilterKey(phase: string | null): FilterKey {
  switch (phase) {
    case "BOOKING":
      return "booking";
    case "PICKUP":
      return "pickup";
    case "TRANSIT":
      return "transit";
    case "DELIVERY":
      return "delivery";
    case "SETTLEMENT":
      return "settlement";
    default:
      return "all";
  }
}

export default function LiveTrackingPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data: loads, isLoading, isFetching, refetch } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
    refetchInterval: 5000,
  });

  // Active = anything not in the inbox / archived buckets.
  const activeLoads = (loads || []).filter((l) => {
    const s = (l.status || "").toLowerCase();
    return !["booked", "archived"].includes(s);
  });

  // Build per-load status with derived lifecycle info.
  const loadsWithStatus = activeLoads.map((load) => ({
    load,
    lifecycle: getLifecycleStatus(load),
  }));

  // Filter + search.
  const filtered = loadsWithStatus.filter(({ load, lifecycle }) => {
    if (filter !== "all") {
      if (filter === "complete") {
        if (!lifecycle.isComplete) return false;
      } else {
        if (phaseToFilterKey(lifecycle.activePhase) !== filter) return false;
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = [
        load.loadNumber,
        load.brokerName,
        load.originCity,
        load.destCity,
        load.assignedDriverName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Phase counts for tabs.
  const counts = {
    all: loadsWithStatus.length,
    booking: 0,
    pickup: 0,
    transit: 0,
    delivery: 0,
    settlement: 0,
    complete: 0,
  } as Record<FilterKey, number>;
  for (const { lifecycle } of loadsWithStatus) {
    if (lifecycle.isComplete) counts.complete++;
    else counts[phaseToFilterKey(lifecycle.activePhase)]++;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-500" />
            Live Tracking
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every in-flight load with its current lifecycle phase. AI handles automated steps;
            human icons flag where a dispatcher action is needed. Refreshes every 5 seconds.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by load #, broker, city, driver…"
          className="pl-9"
        />
      </div>

      {/* Phase tabs */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
        <TabsList className="grid grid-cols-7 w-full">
          {(Object.keys(STATUS_FILTERS) as FilterKey[]).map((k) => (
            <TabsTrigger key={k} value={k} className="text-xs">
              {STATUS_FILTERS[k]} <span className="ml-1.5 text-muted-foreground">({counts[k]})</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={filter} className="mt-5">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center border rounded-lg bg-muted/30">
              No loads in this phase.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(({ load, lifecycle }) => (
                <LoadCard key={load.id} load={load} lifecycle={lifecycle} onOpen={() => setLocation(`/loads/${load.id}`)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LoadCard({
  load,
  lifecycle,
  onOpen,
}: {
  load: Load;
  lifecycle: ReturnType<typeof getLifecycleStatus>;
  onOpen: () => void;
}) {
  const phaseClass = lifecycle.activePhase ? PHASE_COLOR_MAP[lifecycle.activePhase] : "";

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-lg transition-shadow border-l-4",
        lifecycle.isComplete && "border-l-emerald-500",
        !lifecycle.isComplete && lifecycle.activeIsAi && "border-l-blue-500",
        !lifecycle.isComplete && !lifecycle.activeIsAi && "border-l-amber-500",
      )}
      onClick={onOpen}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-bold truncate">
              Load #{load.loadNumber ?? load.id.slice(0, 8)}
            </CardTitle>
            {load.brokerName && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{load.brokerName}</p>
            )}
          </div>
          {lifecycle.isComplete ? (
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">
              ✓ DONE
            </Badge>
          ) : (
            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-mono", phaseClass)}>
              {lifecycle.activePhase}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-3">
        {/* Route */}
        <div className="flex items-center gap-1.5 text-sm">
          <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-medium truncate">
            {load.originCity ?? "—"}
            {load.originState ? `, ${load.originState}` : ""}
          </span>
          <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          <span className="font-medium truncate">
            {load.destCity ?? "—"}
            {load.destState ? `, ${load.destState}` : ""}
          </span>
        </div>

        {/* Current status */}
        {!lifecycle.isComplete && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-muted/40 border">
            {lifecycle.activeIsAi ? (
              <Bot className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="text-xs leading-tight min-w-0">
              <div className="font-medium truncate">{lifecycle.activeStepLabel}</div>
              <div className="text-muted-foreground mt-0.5">
                {lifecycle.activeIsAi ? "AI tracking" : "Needs dispatcher"}
              </div>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>
              {lifecycle.completedCount}/{lifecycle.totalCount} steps
            </span>
            <span>{lifecycle.progressPct}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                lifecycle.isComplete && "bg-emerald-500",
                !lifecycle.isComplete && "bg-gradient-to-r from-emerald-500 to-blue-500",
              )}
              style={{ width: `${lifecycle.progressPct}%` }}
            />
          </div>
        </div>

        {/* Footer meta */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          {load.assignedDriverName && (
            <span className="truncate">👤 {load.assignedDriverName}</span>
          )}
          {load.pickupDate && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <Clock className="w-3 h-3" />
              {new Date(load.pickupDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
