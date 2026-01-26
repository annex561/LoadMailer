import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  MapPin, Truck, Phone, MessageSquare, Send, 
  FileText, Navigation, Clock, CheckCircle2, AlertCircle, ArrowRight 
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { EVChecklist } from "@/components/load-lifecycle/EVChecklist";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function ActiveLoads() {
  const { data: loads, isLoading } = useQuery({
    queryKey: ["/api/loads"],
  });

  const activeLoads = loads?.filter((load: any) => 
    ["dispatched", "in_transit", "delivered"].includes(load.status)
  ) || [];

  const [selectedLoadId, setSelectedLoadId] = useState<number | null>(null);

  useEffect(() => {
    if (activeLoads.length > 0 && !selectedLoadId) {
      setSelectedLoadId(activeLoads[0].id);
    }
  }, [activeLoads, selectedLoadId]);

  const selectedLoad = activeLoads.find((l: any) => l.id === selectedLoadId);

  if (isLoading) return <div className="p-8 text-slate-500">Loading Command Center...</div>;

  return (
    <div className="flex h-[calc(100vh-60px)] bg-slate-950 text-slate-100 overflow-hidden">
      
      {/* --- LEFT PANEL: FLEET LIST (320px) --- */}
      <div className="w-[320px] border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-500" /> Active Fleet ({activeLoads.length})
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {activeLoads.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No trucks active.</div>
            ) : (
              activeLoads.map((load: any) => (
                <button
                  key={load.id}
                  onClick={() => setSelectedLoadId(load.id)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-all border border-transparent",
                    selectedLoadId === load.id 
                      ? "bg-blue-600/10 border-blue-600/50 shadow-md" 
                      : "hover:bg-slate-800"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <Badge variant="outline" className={cn(
                      "text-[10px] px-1 py-0 h-5 border-slate-600 text-slate-400",
                      selectedLoadId === load.id && "text-blue-200 border-blue-400"
                    )}>
                      #{load.loadNumber}
                    </Badge>
                    <StatusBadge status={load.status} />
                  </div>
                  <div className="font-bold text-sm text-slate-200 truncate flex items-center gap-1">
                    {load.originCity || "Origin"} <ArrowRight className="w-3 h-3 text-slate-600"/> {load.destCity || "Dest"}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <Avatar className="w-5 h-5">
                       <AvatarFallback className="bg-emerald-900 text-emerald-400 text-[9px]">DR</AvatarFallback>
                    </Avatar>
                    <span className="truncate">Driver #{(load.driverId || load.assignedDriverId || "N/A").toString().slice(0, 8)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* --- RIGHT PANEL: COMMAND WORKSPACE --- */}
      <div className="flex-1 flex flex-col bg-slate-950">
        {selectedLoad ? (
          <>
            {/* HEADER: TRIP CONTEXT */}
            <div className="h-16 border-b border-slate-800 bg-slate-900/50 px-6 flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  {selectedLoad.originCity || "Origin"} 
                  <ArrowRight className="w-5 h-5 text-slate-500" /> 
                  {selectedLoad.destCity || "Destination"}
                </h1>
                <p className="text-xs text-slate-400 flex gap-4">
                  <span className="text-emerald-400 font-mono">${(selectedLoad.rate || 0).toLocaleString()}</span>
                  <span className="border-l border-slate-700 pl-4">Pickup: {selectedLoad.pickupDate?.slice(0, 10) || "TBD"}</span>
                  <span className="border-l border-slate-700 pl-4">Del: {selectedLoad.deliveryDate?.slice(0, 10) || "TBD"}</span>
                </p>
              </div>
              <div className="flex gap-2">
                 <Button size="sm" variant="outline" className="border-slate-700 hover:bg-slate-800 text-slate-300">
                    <FileText className="w-4 h-4 mr-2" /> View RateCon
                 </Button>
                 <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Phone className="w-4 h-4 mr-2" /> Call Driver
                 </Button>
              </div>
            </div>

            {/* MAIN CONTENT AREA WITH TABS */}
            <div className="flex-1 overflow-hidden">
              <Tabs defaultValue="sop" className="h-full flex flex-col">
                <TabsList className="w-full justify-start rounded-none border-b border-slate-800 bg-slate-900/50 p-0 h-12">
                  <TabsTrigger value="sop" className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:bg-transparent h-12 px-6 text-slate-300 data-[state=active]:text-white">
                    <FileText className="w-4 h-4 mr-2" /> SOP Steps
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:bg-transparent h-12 px-6 text-slate-300 data-[state=active]:text-white">
                    <MessageSquare className="w-4 h-4 mr-2" /> Driver Chat
                  </TabsTrigger>
                  <TabsTrigger value="map" className="rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-500 data-[state=active]:bg-transparent h-12 px-6 text-slate-300 data-[state=active]:text-white">
                    <Navigation className="w-4 h-4 mr-2" /> Live Map
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sop" className="flex-1 overflow-hidden m-0 p-0">
                  <ScrollArea className="h-full">
                    <div className="p-6">
                      <EVChecklist load={selectedLoad} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 overflow-hidden m-0 p-0">
                  <DriverChatWindow load={selectedLoad} />
                </TabsContent>

                <TabsContent value="map" className="flex-1 overflow-hidden m-0 p-0">
                  <LiveMapPanel load={selectedLoad} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <Truck className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p>Select a load from the fleet list</p>
              {activeLoads.length === 0 && (
                <a href="/loads-inbox" className="mt-4 inline-block">
                  <Button variant="outline" className="border-slate-700">Go to RateCon Inbox</Button>
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    dispatched: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Dispatched" },
    in_transit: { bg: "bg-amber-500/20", text: "text-amber-400", label: "In Transit" },
    delivered: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Delivered" },
  };
  const c = config[status] || { bg: "bg-slate-500/20", text: "text-slate-400", label: status };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>{c.label}</span>;
}

function DriverChatWindow({ load }: { load: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const driverId = load.driverId || load.assignedDriverId;

  const { data: driver } = useQuery({
    queryKey: ["/api/drivers", driverId],
    enabled: !!driverId,
  });

  const { data: messages = [], refetch } = useQuery({
    queryKey: ["/api/driver-communications", driverId],
    enabled: !!driverId,
    refetchInterval: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      return apiRequest("POST", `/api/drivers/${driverId}/sms`, { message: msg });
    },
    onSuccess: () => {
      setMessage("");
      refetch();
      toast({ title: "Message sent" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!driverId) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <p>No driver assigned to this load</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Driver Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10">
            <AvatarFallback className="bg-emerald-900 text-emerald-400">
              {driver?.name?.slice(0, 2).toUpperCase() || "DR"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-white">{driver?.name || "Driver"}</p>
            <p className="text-xs text-slate-400">{driver?.phone || "No phone"}</p>
          </div>
        </div>
        {driver?.phone && (
          <a href={`tel:${driver.phone}`}>
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300">
              <Phone className="w-4 h-4" />
            </Button>
          </a>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-slate-500 text-sm py-8">No messages yet</p>
          ) : (
            messages.map((msg: any, i: number) => (
              <div key={i} className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[75%] rounded-lg px-4 py-2",
                  msg.direction === "outbound" 
                    ? "bg-blue-600 text-white" 
                    : "bg-slate-800 text-slate-100"
                )}>
                  <p className="text-sm">{msg.message || msg.body}</p>
                  <p className="text-[10px] mt-1 opacity-60">
                    {new Date(msg.createdAt || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50">
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && message.trim() && sendMutation.mutate(message)}
          />
          <Button 
            onClick={() => message.trim() && sendMutation.mutate(message)}
            disabled={!message.trim() || sendMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function LiveMapPanel({ load }: { load: any }) {
  const driverId = load.driverId || load.assignedDriverId;

  const { data: gpsData } = useQuery({
    queryKey: ["/api/gps/drivers", driverId, "location"],
    enabled: !!driverId,
    refetchInterval: 30000,
  });

  const lat = gpsData?.latitude || 35.2271;
  const lng = gpsData?.longitude || -80.8431;
  const hasGps = !!gpsData?.latitude;

  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.5}%2C${lat - 0.3}%2C${lng + 0.5}%2C${lat + 0.3}&layer=mapnik&marker=${lat}%2C${lng}`;

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Map Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <Navigation className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold">Live Location</span>
        </div>
        <Badge className={hasGps ? "bg-emerald-600" : "bg-amber-600"}>
          {hasGps ? "GPS Active" : "No Signal"}
        </Badge>
      </div>

      {/* Map - Using OpenStreetMap iframe */}
      <div className="flex-1 relative">
        <iframe
          src={mapUrl}
          style={{ border: 0, width: "100%", height: "100%" }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Driver Location Map"
        />
        {/* Driver marker overlay */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
          <div className="bg-emerald-500 text-white px-3 py-1 rounded-lg shadow-lg text-sm font-medium flex items-center gap-1">
            🚚 Driver
          </div>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 text-center">
        <p className="text-xs text-slate-400">
          {gpsData?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
        </p>
      </div>

      {/* Route Info Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Pickup</p>
          <p className="font-semibold text-white text-sm">{load.originCity}, {load.originState || ""}</p>
          <p className="text-xs text-slate-400">{load.pickupDate?.slice(0, 10) || "TBD"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Delivery</p>
          <p className="font-semibold text-white text-sm">{load.destCity}, {load.destState || ""}</p>
          <p className="text-xs text-slate-400">{load.deliveryDate?.slice(0, 10) || "TBD"}</p>
        </div>
      </div>
    </div>
  );
}
